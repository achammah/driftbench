import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, relative, sep } from 'node:path';
import { Observed } from '@agent-nexus/driftbench-core';
import type { GuardCase, UnitDecision, UnitOutcome, UnitTest } from '@agent-nexus/driftbench-generate';
import {
  reapFolder,
  trackFolder,
  trackGroup,
  untrackFolder,
  untrackGroup,
} from '@agent-nexus/driftbench-sandbox';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { estatePath, estateSource } from '../paths';
import { guardName } from '../scan/code';
import type { EstateReader, GuardDecl } from '../scan/reader';

/**
 * The estate unit runner: runs the guards and scripts of an estate directly, with no model in the loop.
 *
 * A guard case is a hook payload in the runtime's input shape. The runner adds the session fields the
 * runtime sends (session id, a transcript that holds the case's last reply, the working folder, the event
 * name, the permission mode), finds the guard in the estate as it is now (the event, the matcher and the
 * guard's name; a guard the estate no longer configures fails every case), and runs the guard's command on a
 * copy of the estate, its stdin the payload, `CLAUDE_PROJECT_DIR` the copy. What the runtime would read from
 * the run is the outcome: deny on exit 2 or a JSON decision that blocks, ask, allow, or error on any other
 * exit code; the message (stderr on exit 2, the reason of a JSON decision) and what the guard printed.
 *
 * `record` runs each case twice on the original estate and writes the outcome into the test (a message or an
 * output that differs between the two runs is not kept). A positive case recorded with no effect is inert; a
 * hostile case recorded allowed is a weakness of the guard. Without `record`, every recorded case that is not
 * inert must give its recorded outcome again; guard_speed also holds every run under its budget.
 *
 * A script test runs the fixtures the estate declares for the script (`scripts:` in driftbench.estate.yaml),
 * each in a fresh working folder, and compares its exit code and stdout with the declared ones.
 *
 * Runs are sandboxed where the platform has a sandbox (macOS sandbox-exec): no network, no read of the
 * credential folders of the home folder, writes only into the copy and the run's temporary folder. The
 * environment holds PATH, a fresh HOME and CLAUDE_PROJECT_DIR, nothing else.
 */

export const ESTATE_CONFIG_FILE = 'driftbench.estate.yaml';

export type UnitCaseResult = {
  case: string;
  material: string;
  outcome: UnitOutcome;
  expected?: UnitOutcome;
  inert?: boolean;
  /** The outcome varied across the record runs: the case is reported, never compared. */
  flaky?: boolean;
  pass: boolean;
  ms: number;
  detail: string;
  command?: string;
  workspace?: WorkspaceDiff;
};

export type UnitResult = {
  id: string;
  testType: UnitTest['testType'];
  atom: string;
  status: 'pass' | 'fail' | 'unrecorded' | 'inert';
  detail: string;
  cases: UnitCaseResult[];
  /** With record: the test with its recorded cases, to write back. */
  recorded?: UnitTest;
  /** A catalogue check's test: whether the host hook's answer to its trigger names the check. */
  exercised?: boolean;
};

export type UnitRunOptions = {
  root: string;
  reader: EstateReader;
  record?: boolean;
  /** Run without the sandbox even where one exists. */
  noSandbox?: boolean;
  /** How many tests run at once (1 by default). The results keep the order of the tests. */
  jobs?: number;
  /** Report, for each observed case, the files its working folder gained, changed or lost. */
  observeWorkspace?: boolean;
};

export type UnitRun = { results: UnitResult[]; sandbox: 'sandbox-exec' | 'none'; notes: string[] };

/** The files a case created, changed or deleted in its working folder, as paths relative to that folder. */
export type WorkspaceDiff = { created: string[]; changed: string[]; deleted: string[] };

type Exec = {
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
  workspace?: WorkspaceDiff;
  command?: string;
  spawnError?: string;
};

const CREDENTIAL_FOLDERS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.config/gcloud',
  '.azure',
  '.kube',
  '.docker',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
  '.claude',
  '.claude.json',
  'Library/Keychains',
];

export async function runUnitTests(tests: readonly UnitTest[], options: UnitRunOptions): Promise<UnitRun> {
  const observed = await withRunner(options, async (runner, raw, config) => {
    const results: UnitResult[] = new Array(tests.length);
    const runOne = async (test: UnitTest): Promise<UnitResult> => {
      if (test.target.kind === 'script') return runScriptTest(test, config, runner, options.record === true);
      if (test.target.kind === 'subagent') return runHelperTest(test, options);
      const result = await runGuardTest(test, raw.guards, options.record === true, runner);
      const check = test.target.check;
      if (check === undefined) return result;
      const named = new RegExp(`(^|[^\\w-])${check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`);
      const exercised = result.cases.some((entry) =>
        named.test(`${entry.outcome.message ?? ''}\n${entry.outcome.output ?? ''}`),
      );
      return { ...result, exercised };
    };
    let next = 0;
    const lanes = Math.max(1, Math.min(Math.floor(options.jobs ?? 1), tests.length));
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        while (next < tests.length) {
          const index = next++;
          results[index] = await runOne(tests[index] as UnitTest);
        }
      }),
    );
    return results;
  });
  return { results: observed.value, sandbox: observed.sandbox, notes: observed.notes };
}

async function withRunner<T>(
  options: UnitRunOptions,
  action: (
    runner: Runner,
    raw: Awaited<ReturnType<EstateReader['read']>>,
    config: Record<string, unknown>,
  ) => Promise<T>,
): Promise<{ value: T; sandbox: UnitRun['sandbox']; notes: string[] }> {
  const notes: string[] = [];
  const raw = await options.reader.read(options.root);
  const work = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-unit-')));
  // Removed at exit or on a signal if the run never reaches its finally, with what still runs in it.
  trackFolder(work);
  const copy = join(work, 'estate');
  try {
    await copyListed(options.root, copy, options.reader);
    const sandbox =
      !options.noSandbox && process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
    if (!sandbox)
      notes.push('no sandbox: the guards and scripts ran with the network and the home folder open');
    const runner = { work, copy, sandbox, counter: 0, workspace: options.observeWorkspace === true };
    const config = await readConfig(options.root);
    const value = await action(runner, raw, config);
    return { value, sandbox: sandbox ? 'sandbox-exec' : 'none', notes };
  } finally {
    // A guard may start a daemon that leaves its process group (a new session) and outlives the run: what
    // still names or stands in the run's folder ends before the folder goes.
    await reapFolder([work]);
    await rm(work, { recursive: true, force: true });
    untrackFolder(work);
  }
}

/** A case executed without recording or inventing an expected outcome. A spec supplies its assertions. */
export type UnitObservation = {
  id: string;
  target: UnitTest['target'];
  cases: Array<{
    id: string;
    outcome: UnitOutcome;
    ms: number;
    timedOut: boolean;
    command?: string;
    workspace?: WorkspaceDiff;
  }>;
  error?: string;
  declared?: boolean;
  inputError?: string;
};

export async function observeUnitTests(
  tests: readonly UnitTest[],
  options: UnitRunOptions,
): Promise<{ observations: UnitObservation[]; sandbox: UnitRun['sandbox']; notes: string[] }> {
  const run = await withRunner(options, async (runner, raw, config) => {
    const observations: UnitObservation[] = [];
    for (const test of tests) {
      const observed: UnitObservation = { id: test.id, target: test.target, cases: [] };
      if (test.target.kind === 'script') {
        if (!existsSync(await estatePath(runner.copy, test.target.path))) {
          observed.error = `the estate no longer holds ${test.target.path}`;
          observations.push(observed);
          continue;
        }
        // Declared fixtures have their own independent oracle; use the normal script runner for them.
        const scripts = config.scripts as Record<string, unknown> | undefined;
        if (scripts?.[test.target.path] !== undefined) {
          observed.declared = true;
          const result = await runScriptTest(test, config, runner, false);
          observed.cases = result.cases.map((entry) => ({
            id: entry.case,
            outcome: entry.outcome,
            ms: entry.ms,
            timedOut: entry.outcome.message === 'timed out',
            command: entry.command,
            ...(entry.workspace ? { workspace: entry.workspace } : {}),
          }));
          if (result.status === 'unrecorded') observed.inputError = result.detail;
          else if (result.status !== 'pass') observed.error = result.detail;
        } else {
          for (const fixture of test.cases) {
            const result = await runScript(test.target.path, fixture, runner);
            observed.cases.push({
              id: fixture.id,
              outcome: scriptOutcome(result),
              ms: result.ms,
              timedOut: result.timedOut,
              ...(result.workspace ? { workspace: result.workspace } : {}),
              command: result.command,
            });
          }
        }
      } else if (test.target.kind === 'subagent') {
        observed.error = 'a helper unit test is run by runUnitTests, which records and compares its answers';
      } else {
        const target = test.target;
        const guard = raw.guards.find(
          (candidate) =>
            guardName(candidate) === target.name &&
            candidate.event === target.event &&
            (candidate.matcher ?? '') === (target.matcher ?? ''),
        );
        if (!guard) observed.error = `the estate no longer runs the ${target.event} guard ${target.name}`;
        else
          for (const fixture of test.cases) {
            const result = await runGuard(
              guard,
              test,
              fixture,
              runner,
              Math.round((guard.timeout ?? target.timeout ?? 60) * 1000),
              true,
            );
            observed.cases.push({
              id: fixture.id,
              outcome: outcomeOf(result),
              ms: result.ms,
              timedOut: result.timedOut,
              ...(result.workspace ? { workspace: result.workspace } : {}),
              command: result.command,
            });
          }
      }
      observations.push(observed);
    }
    return observations;
  });
  return { observations: run.value, sandbox: run.sandbox, notes: run.notes };
}

type Runner = { work: string; copy: string; sandbox: boolean; counter: number; workspace?: boolean };

async function runGuardTest(
  test: UnitTest,
  guards: readonly GuardDecl[],
  record: boolean,
  runner: Runner,
): Promise<UnitResult> {
  const base = { id: test.id, testType: test.testType, atom: test.atom };
  const target = test.target;
  if (target.kind !== 'guard') throw new Error('not a guard test');
  const guard = guards.find(
    (candidate) =>
      guardName(candidate) === target.name &&
      candidate.event === target.event &&
      (candidate.matcher ?? '') === (target.matcher ?? ''),
  );
  if (!guard) {
    return {
      ...base,
      status: 'fail',
      detail: `the estate no longer runs the ${target.event} guard ${target.name}${target.matcher ? ` on ${target.matcher}` : ''}`,
      cases: [],
    };
  }
  if (!record && test.recordedOn === undefined) {
    return {
      ...base,
      status: 'unrecorded',
      detail: 'no outcome recorded: run --record on the original first',
      cases: [],
    };
  }
  const timeoutMs = Math.round((guard.timeout ?? target.timeout ?? 60) * 1000);
  const repeats = test.testType === 'guard_speed' || record ? RECORD_RUNS : 1;
  const cases: UnitCaseResult[] = [];
  const recordedCases: GuardCase[] = [];
  for (const unitCase of test.cases) {
    const runs: Exec[] = [];
    for (let index = 0; index < repeats; index++)
      runs.push(await runGuard(guard, test, unitCase, runner, timeoutMs));
    const outcomes = runs.map(outcomeOf);
    const first = outcomes[0] as UnitOutcome;
    const ms = Math.max(...runs.map((run) => run.ms));
    if (record) {
      const stable: UnitOutcome = {
        decision: first.decision,
        exitCode: first.exitCode,
        ...(first.message !== undefined && outcomes.every((other) => other.message === first.message)
          ? { message: first.message }
          : {}),
        ...(first.output !== undefined && outcomes.every((other) => other.output === first.output)
          ? { output: first.output }
          : {}),
      };
      const flaky = varies(outcomes);
      const noEffect =
        stable.decision === 'allow' && stable.message === undefined && stable.output === undefined;
      const inert =
        (test.testType === 'guard_positive' || test.testType === 'guard_speed') && noEffect
          ? true
          : test.testType === 'guard_hostile' && stable.decision === 'allow';
      recordedCases.push({
        ...unitCase,
        expected: stable,
        ...(flaky ? { flaky: true } : inert ? { inert: true } : {}),
      });
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: stable,
        ...(inert ? { inert } : {}),
        pass: true,
        ms,
        detail: inert
          ? test.testType === 'guard_hostile'
            ? 'slips past the guard'
            : 'no effect'
          : 'recorded',
      });
      continue;
    }
    const expected = unitCase.expected;
    if (unitCase.flaky) {
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: first,
        flaky: true,
        pass: true,
        ms,
        detail: 'flaky on the original: not compared',
      });
      continue;
    }
    if (unitCase.inert || expected === undefined) {
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: first,
        inert: true,
        pass: true,
        ms,
        detail: 'inert',
      });
      continue;
    }
    const differences = outcomes.flatMap((outcome) => differ(expected, outcome));
    const slow = test.budgetMs !== undefined && ms > test.budgetMs;
    const pass = differences.length === 0 && !slow;
    cases.push({
      case: unitCase.id,
      material: unitCase.material,
      outcome: first,
      expected,
      pass,
      ms,
      detail: pass
        ? `${first.decision} as recorded`
        : [
            ...new Set(differences),
            ...(slow ? [`took ${ms} ms, over the budget of ${test.budgetMs} ms`] : []),
          ].join('; '),
    });
  }
  if (record) {
    const active = recordedCases.filter((entry) => !entry.inert).length;
    return {
      ...base,
      status: 'pass',
      detail: `recorded ${recordedCases.length} cases, ${active} active, ${recordedCases.length - active} ${test.testType === 'guard_hostile' ? 'slipping past the guard' : 'inert'}`,
      cases,
      recorded: { ...test, cases: recordedCases, recordedOn: test.mapHash },
    };
  }
  const active = cases.filter((entry) => !entry.inert && !entry.flaky);
  if (active.length === 0)
    return { ...base, status: 'inert', detail: 'no recorded case shows the guard at work', cases };
  const failed = active.filter((entry) => !entry.pass);
  return {
    ...base,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail:
      failed.length === 0
        ? `${active.length} of ${active.length} cases as recorded`
        : `${failed.length} of ${active.length} cases changed: ${failed.map((entry) => `${entry.case} ${entry.detail}`).join(' | ')}`,
    cases,
  };
}

/**
 * A helper run alone, by the executor the estate declares for it (`helpers:` in driftbench.estate.yaml). The case
 * holds the task and the seeded files. `record` runs the helper `RECORD_RUNS` times on the original estate and keeps
 * its answer when the runs agree (the case is flaky otherwise, and never compared); a later run must answer the same,
 * so an agent file that lost its body or changed its meaning turns the test red. An executor that is not configured,
 * or fails, is a failed run, never a pass.
 */
async function runHelperTest(test: UnitTest, options: UnitRunOptions): Promise<UnitResult> {
  const base = { id: test.id, testType: test.testType, atom: test.atom };
  const target = test.target;
  if (target.kind !== 'subagent') throw new Error('not a helper test');
  const record = options.record === true;
  if (!record && test.recordedOn === undefined) {
    return {
      ...base,
      status: 'unrecorded',
      detail: 'no outcome recorded: run --record on the original first',
      cases: [],
    };
  }
  const outcomeOfRun = (observation: HelperObservation): UnitOutcome =>
    observation.status === 'executed'
      ? { decision: 'allow', exitCode: 0, output: observation.observed.text.trim() }
      : {
          decision: 'error',
          exitCode: observation.status === 'failed' ? observation.exit : 1,
          message: observation.error,
        };
  const cases: UnitCaseResult[] = [];
  const recordedCases: GuardCase[] = [];
  for (const unitCase of test.cases) {
    const task = typeof unitCase.payload.task === 'string' ? unitCase.payload.task : '';
    const files =
      typeof unitCase.payload.files === 'object' && unitCase.payload.files !== null
        ? (unitCase.payload.files as Record<string, string>)
        : {};
    const outcomes: UnitOutcome[] = [];
    let ms = 0;
    for (let index = 0; index < (record ? RECORD_RUNS : 1); index++) {
      const observation = await observeHelper({ name: target.name, file: target.file }, task, files, options);
      outcomes.push(outcomeOfRun(observation));
      if (observation.status !== 'not-run') ms = Math.max(ms, observation.ms);
    }
    const first = outcomes[0] as UnitOutcome;
    if (record) {
      const flaky = varies(outcomes) || outcomes.some((outcome) => outcome.output !== first.output);
      const failed = first.decision === 'error';
      recordedCases.push({
        ...unitCase,
        expected: first,
        ...(flaky ? { flaky: true } : failed ? { inert: true } : {}),
      });
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: first,
        ...(failed ? { inert: true } : {}),
        pass: !failed,
        ms,
        detail: failed ? (first.message ?? 'the helper did not run') : 'recorded',
      });
      continue;
    }
    const expected = unitCase.expected;
    if (unitCase.flaky) {
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: first,
        flaky: true,
        pass: true,
        ms,
        detail: 'flaky on the original: not compared',
      });
      continue;
    }
    if (expected === undefined || unitCase.inert) {
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: first,
        inert: true,
        pass: false,
        ms,
        detail: 'the helper did not run on the original, so nothing is recorded to compare',
      });
      continue;
    }
    const differences = differ(expected, first);
    cases.push({
      case: unitCase.id,
      material: unitCase.material,
      outcome: first,
      expected,
      pass: differences.length === 0,
      ms,
      detail: differences.length === 0 ? 'answered as recorded' : differences.join('; '),
    });
  }
  if (record) {
    const failed = cases.filter((entry) => !entry.pass);
    return {
      ...base,
      status: failed.length === 0 ? 'pass' : 'fail',
      detail:
        failed.length === 0
          ? `recorded ${recordedCases.length} helper runs`
          : failed.map((entry) => `${entry.case} ${entry.detail}`).join(' | '),
      cases,
      recorded: { ...test, cases: recordedCases, recordedOn: test.mapHash },
    };
  }
  const active = cases.filter((entry) => !entry.flaky);
  const failed = active.filter((entry) => !entry.pass);
  return {
    ...base,
    status: active.length === 0 ? 'inert' : failed.length === 0 ? 'pass' : 'fail',
    detail:
      active.length === 0
        ? 'no recorded case shows the helper at work'
        : failed.length === 0
          ? `${active.length} of ${active.length} runs answered as recorded`
          : `${failed.length} of ${active.length} runs changed: ${failed.map((entry) => `${entry.case} ${entry.detail}`).join(' | ')}`,
    cases,
  };
}

/** Record runs per case: an outcome that varies across them marks the case flaky. */
export const RECORD_RUNS = 3;

/** True when the decision or the exit code differs between runs of one case. */
function varies(outcomes: readonly UnitOutcome[]): boolean {
  const first = outcomes[0];
  return outcomes.some((other) => other.decision !== first?.decision || other.exitCode !== first?.exitCode);
}

/** How a recorded outcome and a new one differ, in words; empty when they agree. */
function differ(expected: UnitOutcome, actual: UnitOutcome): string[] {
  const out: string[] = [];
  if (expected.decision !== actual.decision)
    out.push(`${actual.decision} where ${expected.decision} was recorded`);
  if (expected.exitCode !== actual.exitCode)
    out.push(`exit ${actual.exitCode} where ${expected.exitCode} was recorded`);
  if (expected.message !== undefined && expected.message !== actual.message) out.push('another message');
  if (expected.output !== undefined && expected.output !== actual.output) out.push('another output');
  return out;
}

/** What the runtime reads from a guard run. */
export function outcomeOf(run: Pick<Exec, 'exitCode' | 'stdout' | 'stderr' | 'timedOut'>): UnitOutcome {
  const stdout = run.stdout.trim();
  const stderr = run.stderr.trim();
  if (run.timedOut) return { decision: 'error', exitCode: run.exitCode, message: 'timed out' };
  if (run.exitCode === 2) return { decision: 'deny', exitCode: 2, ...(stderr ? { message: stderr } : {}) };
  if (run.exitCode !== 0)
    return { decision: 'error', exitCode: run.exitCode, ...(stderr ? { message: stderr } : {}) };
  let decision: UnitDecision = 'allow';
  let message: string | undefined;
  try {
    const json: unknown = stdout.startsWith('{') ? JSON.parse(stdout) : undefined;
    if (json !== null && typeof json === 'object') {
      const record = json as Record<string, unknown>;
      const specific = record.hookSpecificOutput as Record<string, unknown> | undefined;
      const permission = specific?.permissionDecision;
      if (permission === 'deny' || permission === 'ask' || permission === 'allow') {
        decision = permission;
        if (typeof specific?.permissionDecisionReason === 'string')
          message = specific.permissionDecisionReason;
      } else if (record.decision === 'block') {
        decision = 'deny';
        if (typeof record.reason === 'string') message = record.reason;
      } else if (record.continue === false) {
        decision = 'deny';
        if (typeof record.stopReason === 'string') message = record.stopReason;
      }
    }
  } catch {
    // Plain text on stdout: kept as the output, the decision stays allow.
  }
  return {
    decision,
    exitCode: 0,
    ...(message !== undefined ? { message } : {}),
    ...(stdout ? { output: stdout } : {}),
  };
}

async function runGuard(
  guard: GuardDecl,
  test: UnitTest,
  unitCase: GuardCase,
  runner: Runner,
  timeoutMs: number,
  literalPayload = false,
): Promise<Exec> {
  runner.counter += 1;
  const number = runner.counter;
  const folder = join(runner.work, `case-${number}`);
  await estatePath(runner.work, `case-${number}`);
  await mkdir(folder, { recursive: true });
  const transcript = await estatePath(folder, 'transcript.jsonl');
  const reply =
    literalPayload && typeof unitCase.payload.last_assistant_message === 'string'
      ? unitCase.payload.last_assistant_message
      : typeof unitCase.payload.last_reply === 'string'
        ? unitCase.payload.last_reply
        : '';
  const prompt = typeof unitCase.payload.prompt === 'string' ? unitCase.payload.prompt : 'unit test';
  await writeFile(
    transcript,
    [
      { type: 'user', message: { role: 'user', content: prompt } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: literalPayload ? reply : reply || 'ok' }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n')
      .concat('\n'),
  );
  const payload: Record<string, unknown> = {
    session_id: `unit-${test.id}-${unitCase.id}`,
    transcript_path: transcript,
    cwd: runner.copy,
    hook_event_name: guard.event,
    permission_mode: 'default',
    ...(unitCase.payload.tool_name !== undefined ? { tool_use_id: `toolu_unit_${number}` } : {}),
    ...unitCase.payload,
  };
  // Recorded JSON tests use a shorthand. Explicit task payloads retain their declared keys and values;
  // add the runtime's canonical alias only when the task did not already supply it.
  if ('last_reply' in payload) {
    if (!literalPayload || !('last_assistant_message' in payload))
      payload.last_assistant_message = literalPayload ? reply : reply || 'ok';
    if (!literalPayload) delete payload.last_reply;
  }
  return watched(runner, runner.copy, () =>
    execute(['/bin/sh', '-c', guard.command], `${JSON.stringify(payload)}\n`, runner, runner.copy, timeoutMs),
  );
}

async function runScriptTest(
  test: UnitTest,
  config: Record<string, unknown>,
  runner: Runner,
  record: boolean,
): Promise<UnitResult> {
  const base = { id: test.id, testType: test.testType, atom: test.atom };
  if (test.target.kind !== 'script') throw new Error('not a script test');
  const path = test.target.path;
  if (!existsSync(await estatePath(runner.copy, path))) {
    return { ...base, status: 'fail', detail: `the estate no longer holds ${path}`, cases: [] };
  }
  const scripts = config.scripts as Record<string, unknown> | undefined;
  const declaration = scripts?.[path];
  if (declaration === undefined) return runRecordedScript(test, path, runner, record);
  const contract = ScriptFixtures.safeParse(
    Array.isArray(declaration) ? declaration : (declaration as { fixtures?: unknown })?.fixtures,
  );
  if (!contract.success)
    return {
      ...base,
      status: 'unrecorded',
      detail: `invalid script contract for ${path}: ${contract.error.issues[0]?.message}`,
      cases: [],
    };
  const declared = contract.data;
  const cases: UnitCaseResult[] = [];
  for (const [index, fixture] of declared.entries()) {
    const entry = (fixture ?? {}) as Record<string, unknown>;
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    const expect = (entry.expect ?? {}) as Record<string, unknown>;
    runner.counter += 1;
    const folder = join(runner.work, `case-${runner.counter}`);
    await writeFixtures(runner, folder, (entry.files ?? {}) as Record<string, unknown>);
    const argv = [
      ...(await interpreterFor(await estatePath(runner.copy, path))),
      await estatePath(runner.copy, path),
      ...args,
    ];
    const run = await watched(runner, folder, () =>
      execute(argv, typeof entry.stdin === 'string' ? entry.stdin : '', runner, folder, 60_000),
    );
    const problems: string[] = [];
    if (run.timedOut) problems.push('timed out');
    const wantedExit = typeof expect.exitCode === 'number' ? expect.exitCode : 0;
    if (run.exitCode !== wantedExit) problems.push(`exit ${run.exitCode} where ${wantedExit} is declared`);
    if (typeof expect.stdout === 'string' && run.stdout.trim() !== expect.stdout.trim())
      problems.push('another stdout');
    const includes = Array.isArray(expect.stdoutIncludes) ? expect.stdoutIncludes.map(String) : [];
    for (const piece of includes) if (!run.stdout.includes(piece)) problems.push(`stdout lacks "${piece}"`);
    const outcome: UnitOutcome = {
      decision: run.exitCode === 0 ? 'allow' : 'error',
      exitCode: run.exitCode,
      ...(run.stdout.trim() ? { output: run.stdout.trim() } : {}),
      ...(run.timedOut ? { message: 'timed out' } : {}),
    };
    cases.push({
      case: `fixture-${index + 1}`,
      material: args.join(' '),
      outcome,
      pass: problems.length === 0,
      command: run.command,
      ms: run.ms,
      detail: problems.length === 0 ? 'as declared' : problems.join('; '),
      ...(run.workspace ? { workspace: run.workspace } : {}),
    });
  }
  const failed = cases.filter((entry) => !entry.pass);
  return {
    ...base,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail:
      failed.length === 0
        ? `${cases.length} of ${cases.length} fixtures as declared`
        : failed.map((entry) => `${entry.case}: ${entry.detail}`).join(' | '),
    cases,
  };
}

/**
 * A script with no declared fixture runs its minimal fixtures (from the generator, else from its own
 * argument parsing): recorded on the original like a guard's cases, compared on a copy.
 */
async function runRecordedScript(
  test: UnitTest,
  path: string,
  runner: Runner,
  record: boolean,
): Promise<UnitResult> {
  const base = { id: test.id, testType: test.testType, atom: test.atom };
  let fixtures = test.cases;
  if (fixtures.length === 0) {
    if (!record) {
      return {
        ...base,
        status: 'inert',
        detail: `${ESTATE_CONFIG_FILE} declares no fixture for ${path}`,
        cases: [],
      };
    }
    fixtures = casesFromSource(await readFile(await estatePath(runner.copy, path), 'utf8'));
  }
  if (!record && test.recordedOn === undefined) {
    return {
      ...base,
      status: 'unrecorded',
      detail: 'no outcome recorded: run --record on the original first',
      cases: [],
    };
  }
  const cases: UnitCaseResult[] = [];
  const recorded: GuardCase[] = [];
  for (const fixture of fixtures) {
    const runs: Exec[] = [];
    for (let index = 0; index < (record ? RECORD_RUNS : 1); index++)
      runs.push(await runScript(path, fixture, runner));
    const outcomes = runs.map(scriptOutcome);
    const first = outcomes[0] as UnitOutcome;
    const ms = Math.max(...runs.map((run) => run.ms));
    if (record) {
      const stable: UnitOutcome = {
        decision: first.decision,
        exitCode: first.exitCode,
        ...(first.message !== undefined && outcomes.every((other) => other.message === first.message)
          ? { message: first.message }
          : {}),
        ...(first.output !== undefined && outcomes.every((other) => other.output === first.output)
          ? { output: first.output }
          : {}),
      };
      const flaky = varies(outcomes);
      recorded.push({ ...fixture, expected: stable, ...(flaky ? { flaky: true } : {}) });
      cases.push({
        case: fixture.id,
        material: fixture.material,
        outcome: stable,
        pass: true,
        ms,
        detail: 'recorded',
      });
      continue;
    }
    const expected = fixture.expected;
    if (fixture.flaky) {
      cases.push({
        case: fixture.id,
        material: fixture.material,
        outcome: first,
        flaky: true,
        pass: true,
        ms,
        detail: 'flaky on the original: not compared',
      });
      continue;
    }
    if (expected === undefined) {
      cases.push({
        case: fixture.id,
        material: fixture.material,
        outcome: first,
        inert: true,
        pass: true,
        ms,
        detail: 'inert',
      });
      continue;
    }
    const differences = differ(expected, first);
    cases.push({
      case: fixture.id,
      material: fixture.material,
      outcome: first,
      expected,
      pass: differences.length === 0,
      ms,
      detail: differences.length === 0 ? `exit ${first.exitCode} as recorded` : differences.join('; '),
    });
  }
  if (record) {
    return {
      ...base,
      status: 'pass',
      detail: `recorded ${recorded.length} minimal fixtures`,
      cases,
      recorded: { ...test, cases: recorded, recordedOn: test.mapHash },
    };
  }
  const compared = cases.filter((entry) => !entry.flaky);
  if (compared.length === 0)
    return { ...base, status: 'inert', detail: 'every fixture is flaky on the original', cases };
  const failed = compared.filter((entry) => !entry.pass);
  return {
    ...base,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail:
      failed.length === 0
        ? `${compared.length} of ${compared.length} fixtures as recorded`
        : failed.map((entry) => `${entry.case}: ${entry.detail}`).join(' | '),
    cases,
  };
}

/** A script's outcome: allow on exit 0, error otherwise; stderr the message, stdout the output. */
function scriptOutcome(run: Exec): UnitOutcome {
  const stdout = run.stdout.trim();
  const stderr = run.stderr.trim();
  return {
    decision: run.exitCode === 0 && !run.timedOut ? 'allow' : 'error',
    exitCode: run.exitCode,
    ...(stderr ? { message: stderr } : {}),
    ...(stdout ? { output: stdout } : {}),
  };
}

async function runScript(path: string, fixture: GuardCase, runner: Runner): Promise<Exec> {
  runner.counter += 1;
  const folder = join(runner.work, `case-${runner.counter}`);
  await writeFixtures(runner, folder, (fixture.payload.files ?? {}) as Record<string, unknown>);
  const args = Array.isArray(fixture.payload.args) ? fixture.payload.args.map(String) : [];
  const argv = [
    ...(await interpreterFor(await estatePath(runner.copy, path))),
    await estatePath(runner.copy, path),
    ...args,
  ];
  return watched(runner, folder, () =>
    execute(
      argv,
      typeof fixture.payload.stdin === 'string' ? fixture.payload.stdin : '',
      runner,
      folder,
      60_000,
    ),
  );
}

/** A run with the working folder compared before and after, when the caller asked to observe it. */
async function watched(runner: Runner, folder: string, run: () => Promise<Exec>): Promise<Exec> {
  if (!runner.workspace) return run();
  const before = await snapshot(folder);
  const result = await run();
  return { ...result, workspace: diffOf(before, await snapshot(folder)) };
}

/** Every file below a folder with a digest of its content; a link is its target, never followed. */
async function snapshot(folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      const info = await lstat(path).catch(() => undefined);
      if (!info) continue;
      const name = relative(folder, path).split('\\').join('/');
      if (info.isSymbolicLink()) files.set(name, `link:${await readlink(path).catch(() => '')}`);
      else if (info.isDirectory()) await visit(path);
      else if (info.isFile())
        files.set(
          name,
          info.size > 1_000_000
            ? `big:${info.size}:${info.mtimeMs}`
            : createHash('sha256')
                .update(await readFile(path).catch(() => ''))
                .digest('hex'),
        );
    }
  };
  await visit(folder);
  return files;
}

function diffOf(before: Map<string, string>, after: Map<string, string>): WorkspaceDiff {
  const created = [...after.keys()].filter((name) => !before.has(name));
  const changed = [...after.keys()].filter(
    (name) => before.has(name) && before.get(name) !== after.get(name),
  );
  const deleted = [...before.keys()].filter((name) => !after.has(name));
  return { created: created.sort(), changed: changed.sort(), deleted: deleted.sort() };
}

/**
 * Minimal fixtures from a script's own argument parsing: no argument, then as many as the script reads
 * (the highest `sys.argv[n]`, `argv[n]` or `$n` it names, or the count a `len(argv) != n` or `"$#" -ne n`
 * check demands), each an empty file in the working folder.
 */
export function casesFromSource(source: string): GuardCase[] {
  const indexes = [
    ...[...source.matchAll(/\bargv\[(\d+)\]/g)].map((match) => Number(match[1])),
    ...[...source.matchAll(/\$\{?([1-9])\}?/g)].map((match) => Number(match[1])),
    ...[...source.matchAll(/len\([\w.]*argv\)\s*[!=<>]=?\s*(\d+)/g)].map((match) => Number(match[1]) - 1),
    ...[...source.matchAll(/"\$#"\s*-(?:ne|lt|eq)\s*(\d+)/g)].map((match) => Number(match[1])),
  ];
  const count = Math.max(0, ...indexes);
  const cases: GuardCase[] = [{ id: 'case-01', payload: { args: [] }, material: 'no argument' }];
  if (count > 0) {
    const args = Array.from({ length: count }, (_, index) => `arg-${index + 1}`);
    cases.push({
      id: 'case-02',
      payload: { args, files: Object.fromEntries(args.map((arg) => [arg, ''])) },
      material: args.join(' '),
    });
  }
  return cases;
}

/**
 * How a TypeScript script runs offline: the tsx loader where available, else Node's own type stripping.
 * The loader avoids the CLI's Unix socket, which cannot represent long temporary paths.
 * Never `npx tsx`, which reaches for the network the sandbox closes and waits out the timeout.
 */
function typeScriptRunner(): string[] {
  try {
    return [process.execPath, '--import', createRequire(import.meta.url).resolve('tsx')];
  } catch {
    return [process.execPath, '--experimental-strip-types', '--no-warnings'];
  }
}

/** Honor the estate's interpreter declaration; extension inference is only a fallback. */
async function interpreterFor(path: string): Promise<string[]> {
  const source = await readFile(path, 'utf8');
  const first = source.split('\n', 1)[0]?.trim() ?? '';
  const shebang = /^#!\s*(\S+)(?:\s+(.+))?$/.exec(first);
  if (shebang) return [shebang[1] as string, ...(shebang[2] ? [shebang[2]] : [])];
  return interpreterOf(path);
}

function interpreterOf(path: string): string[] {
  switch (extname(path)) {
    case '.py':
      return ['python3'];
    case '.js':
    case '.mjs':
    case '.cjs':
      return ['node'];
    case '.ts':
      return typeScriptRunner();
    case '.rb':
      return ['ruby'];
    default:
      return ['/bin/sh'];
  }
}

/** The macOS sandbox profile of a run: no network, no credential folder, writes only where the run may. */
export function sandboxProfile(writable: readonly string[], home: string): string {
  const quote = (path: string) => JSON.stringify(path);
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    // Local sockets inside the run only (a TypeScript runner talks to its child through one); no network.
    `(allow network* ${writable.map((path) => `(local unix-socket (subpath ${quote(path)})) (remote unix-socket (subpath ${quote(path)}))`).join(' ')})`,
    `(deny file-read* ${CREDENTIAL_FOLDERS.map((name) => `(subpath ${quote(join(home, name))})`).join(' ')})`,
    '(deny file-write*)',
    `(allow file-write* ${writable.map((path) => `(subpath ${quote(path)})`).join(' ')} (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/"))`,
  ].join('\n');
}

async function execute(
  argv: string[],
  stdin: string,
  runner: Runner,
  cwd: string,
  timeoutMs: number,
): Promise<Exec> {
  const home = await estatePath(runner.work, 'home');
  await mkdir(home, { recursive: true });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    TMPDIR: runner.work,
    CLAUDE_PROJECT_DIR: runner.copy,
  };
  const realHome = await realpath(homedir()).catch(() => homedir());
  const command = runner.sandbox
    ? ['/usr/bin/sandbox-exec', '-p', sandboxProfile([runner.work], realHome), ...argv]
    : argv;
  const started = performance.now();
  return await new Promise<Exec>((resolve) => {
    // Its own process group, so what it leaves running in the background ends with it.
    const child = spawn(command[0] as string, command.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) trackGroup(child.pid);
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The group already ended.
      }
    };
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: `${stderr}${error.message}`,
        spawnError: error.message,
        ms: performance.now() - started,
        timedOut,
        command: argv.map(shellWord).join(' '),
      });
    });
    child.on('exit', killGroup);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (child.pid !== undefined) untrackGroup(child.pid);
      resolve({
        exitCode: code ?? 1,
        stdout: neutral(stdout, runner.work),
        stderr: neutral(stderr, runner.work),
        ms: Math.round(performance.now() - started),
        timedOut,
        command: argv.map(shellWord).join(' '),
      });
    });
  });
}

/**
 * Output with the run's own folders named the same way on every run: the temporary folder (with or without
 * the /private prefix macOS adds) becomes `$RUN`, a case folder `case`. A message that holds the path of the
 * copy is then the same on the original and on a mutant.
 */
export function neutral(text: string, work: string): string {
  const bare = work.replace(/^\/private(?=\/)/, '');
  return text
    .split(`/private${bare}`)
    .join('$RUN')
    .split(bare)
    .join('$RUN')
    .replace(/\$RUN\/case-\d+/g, '$RUN/case');
}

/** Where the estate configuration lives: the root, else inside the runtime's own folder (the root file wins). */
export const ESTATE_CONFIG_PLACES: readonly string[] = [ESTATE_CONFIG_FILE, `.claude/${ESTATE_CONFIG_FILE}`];

/** The estate configuration, when the estate has one. */
async function readConfig(root: string): Promise<Record<string, unknown>> {
  let text: string | undefined;
  for (const place of ESTATE_CONFIG_PLACES) {
    text = await readFile(await estatePath(root, place), 'utf8').catch(() => undefined);
    if (text !== undefined) break;
  }
  if (text === undefined) return {};
  try {
    const parsed: unknown = parseYaml(text);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A copy of the files the reader lists, cloned where the file system can, never linked to the source. */
async function copyListed(root: string, to: string, reader: EstateReader): Promise<void> {
  const files = reader.listFiles ? await reader.listFiles(root) : [];
  // Validate the entire copy before creating any destination.
  const paths = await Promise.all(
    files.map(async (file) => ({
      source: estateSource(root, file),
      target: await estatePath(to, file),
    })),
  );
  for (const { source, target } of paths) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target, constants.COPYFILE_FICLONE);
  }
  await mkdir(to, { recursive: true });
}

/** No fixture content is written until every name and existing symlink has passed validation. */
async function writeFixtures(runner: Runner, folder: string, files: Record<string, unknown>): Promise<void> {
  await estatePath(runner.work, folder.slice(runner.work.length + 1));
  const paths = await Promise.all(
    Object.entries(files).map(async ([name, text]) => ({
      path: await estatePath(folder, name),
      text: String(text),
    })),
  );
  await mkdir(folder, { recursive: true });
  for (const { path, text } of paths) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { flag: 'wx' });
  }
}

/** Declared script fixtures are independent oracles, not a guess from a successful process start. */
const ScriptFixtures = z
  .array(
    z.object({
      args: z.array(z.string()).optional(),
      stdin: z.string().optional(),
      files: z.record(z.string(), z.string()).optional(),
      expect: z
        .object({
          exitCode: z.number().int().optional(),
          stdout: z.string().optional(),
          stdoutIncludes: z.array(z.string().min(1)).min(1).optional(),
        })
        .refine(
          (e) => e.exitCode !== undefined || e.stdout !== undefined || e.stdoutIncludes !== undefined,
          'declare an expected exitCode, stdout or stdoutIncludes',
        ),
    }),
  )
  .min(1);

function shellWord(word: string): string {
  return /^[\w./:=@+-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

export type HelperObservation =
  | { status: 'not-run'; error: string }
  | { status: 'failed'; error: string; exit: number; ms: number; observed?: undefined }
  | { status: 'executed'; observed: Observed; exit: number; ms: number; error?: undefined };

/** Execute the helper's current body with the estate's explicitly declared local runtime. */
export async function observeHelper(
  target: { name: string; file: string },
  task: string,
  files: Record<string, string>,
  options: UnitRunOptions,
): Promise<HelperObservation> {
  try {
    const result = await withRunner(options, async (runner, _raw, config): Promise<HelperObservation> => {
      const declaration = (config.helpers as Record<string, unknown> | undefined)?.[target.name];
      const executor = z
        .strictObject({
          command: z.array(z.string().min(1)).min(1),
          timeoutMs: z.number().int().positive().default(60000),
        })
        .safeParse(declaration);
      if (!executor.success)
        return {
          status: 'not-run',
          error: 'a helper needs a configured executor in driftbench.estate.yaml helpers',
        };
      const path = await estatePath(runner.copy, target.file);
      const source = await readFile(path, 'utf8');
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
      const frontmatter = header ? parseYaml(header[1] ?? '') : {};
      const body = header ? source.slice(header[0].length) : source;
      if (!task.trim()) return { status: 'not-run', error: 'the helper has no task' };
      // Every fixture path is validated, links resolved, before the first one is written.
      const fixtures = await Promise.all(
        Object.entries(files).map(async ([name, text]) => ({
          file: await estatePath(runner.copy, name),
          text,
        })),
      );
      const canonicalCopy = await estatePath(runner.copy, '.');
      for (const { file } of fixtures)
        if (
          file.startsWith(join(canonicalCopy, '.claude') + sep) ||
          file === join(canonicalCopy, ESTATE_CONFIG_FILE)
        )
          return { status: 'not-run', error: 'helper workspace fixtures cannot replace runtime files' };
      for (const { file, text } of fixtures) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, text);
      }
      const before = await snapshot(runner.copy);
      const execution = await execute(
        executor.data.command,
        `${JSON.stringify({ name: target.name, systemPrompt: body, frontmatter, task })}\n`,
        runner,
        runner.copy,
        executor.data.timeoutMs,
      );
      const workspaceDiff = diffOf(before, await snapshot(runner.copy));
      if (execution.spawnError)
        return { status: 'not-run', error: `helper executor could not start: ${execution.spawnError}` };
      const stamp = { exit: execution.exitCode, ms: execution.ms };
      if (execution.timedOut || execution.exitCode !== 0)
        return {
          status: 'failed',
          ...stamp,
          error: execution.timedOut
            ? 'helper executor timed out'
            : `helper executor exited ${execution.exitCode}: ${execution.stderr}`,
        };
      let value: unknown;
      try {
        value = JSON.parse(execution.stdout);
      } catch {
        return { status: 'failed', ...stamp, error: 'helper executor returned invalid JSON' };
      }
      // The protocol requires actual reply and tool-call observations; metadata is supplied by this runner.
      const observed = Observed.omit({ cost: true, latencyMs: true }).safeParse(value);
      if (!observed.success)
        return {
          status: 'failed',
          ...stamp,
          error: `invalid helper observations: ${observed.error.issues[0]?.message}`,
        };
      return {
        status: 'executed',
        ...stamp,
        // The runner watched the copy itself: a diff the executor did not report is the one it saw.
        observed: { workspaceDiff, ...observed.data, cost: {}, latencyMs: execution.ms },
      };
    });
    return result.value;
  } catch (cause) {
    return { status: 'not-run', error: cause instanceof Error ? cause.message : String(cause) };
  }
}

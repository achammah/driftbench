import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { loadSpecFile, type Spec } from '@agent-nexus/driftbench-core';
import { RUNTIMES, readerFor, runUnitTests, type UnitResult } from '@agent-nexus/driftbench-estate';
import { formatJson, UnitTest } from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import type { Io } from '../io';
import { runUnitSpecs } from './estate-unit-spec';

export type EstateUnitOptions = {
  estate?: string;
  runtime?: string;
  record?: boolean;
  /** False with --no-sandbox. */
  sandbox?: boolean;
  /** How many tests run at once, from --jobs (1 by default). */
  jobs?: string;
  json?: boolean;
};

/**
 * `driftbench estate unit <tests...> --estate <root>`: runs the unit tests `estate generate` wrote
 * (`unit/**.json`: guards with hook payloads, scripts with their declared fixtures) directly, with no model.
 * `--record` runs them on the original estate and writes each guard's outcomes into its test file, the oracle
 * a later run on a mutant copy compares with. Exit 0 every test passes, 1 one fails, 2 a usage or input
 * error (an unrecorded guard test included).
 */
export function registerEstateUnitCommand(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('unit')
    .description(
      'Run the unit tests of a generated suite (guards and scripts, no model) against an estate root',
    )
    .argument('<tests...>', 'JSON unit records or unit-mode YAML/JSON task specs, or their folders')
    .option('--estate <root>', 'the estate root: the original (with --record) or a mutant copy')
    .option('--runtime <name>', `the runtime that reads the estate: ${RUNTIMES.join(', ')}`, 'claude-code')
    .option('--record', 'run on the original estate and write the outcomes into the test files')
    .option(
      '--no-sandbox',
      'run without the sandbox (no network, no credential folders) even where one exists',
    )
    .option('--jobs <n>', 'how many tests run at once; the results keep their order', '1')
    .option('--json', 'print the results as JSON')
    .action(async (paths: string[], options: EstateUnitOptions) => {
      setExit(await estateUnitCommand(paths, options, io));
    });
}

export async function estateUnitCommand(
  paths: string[],
  options: EstateUnitOptions,
  io: Io,
): Promise<number> {
  if (!options.estate) {
    io.err("error: required option '--estate <root>' not specified\n");
    return 2;
  }
  const reader = readerFor(options.runtime ?? 'claude-code');
  if (!reader) {
    io.err(`error: unknown runtime "${options.runtime}": use ${RUNTIMES.join(', ')}\n`);
    return 2;
  }
  const root = resolve(io.cwd, options.estate);
  if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
    io.err(`Cannot find the estate folder ${root}.\n`);
    return 2;
  }
  const files: string[] = [];
  for (const path of paths) {
    const full = resolve(io.cwd, path);
    const info = await stat(full).catch(() => undefined);
    if (!info) {
      io.err(`Cannot find ${path}.\n`);
      return 2;
    }
    if (info.isDirectory()) files.push(...(await unitFiles(full)));
    else files.push(full);
  }
  const tests: Array<{ file: string; test: UnitTest }> = [];
  const specs: Spec[] = [];
  for (const file of files.sort()) {
    if (/\.ya?ml$/i.test(file)) {
      const loaded = await loadSpecFile(file);
      if (!loaded.ok) {
        io.err(`✗ ${relative(io.cwd, file)}  invalid spec: ${JSON.stringify(loaded)}\n`);
        return 2;
      }
      if ((loaded.spec.metadata?.estate as { mode?: string } | undefined)?.mode !== 'unit') {
        io.err(`✗ ${relative(io.cwd, file)}  not an estate unit spec\n`);
        return 2;
      }
      specs.push(loaded.spec);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (cause) {
      io.err(
        `✗ ${relative(io.cwd, file)}  not JSON: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      return 2;
    }
    const parsed = UnitTest.safeParse(raw);
    if (!parsed.success && raw !== null && typeof raw === 'object' && 'blocks' in raw) {
      const loaded = await loadSpecFile(file);
      if (loaded.ok && (loaded.spec.metadata?.estate as { mode?: string } | undefined)?.mode === 'unit') {
        specs.push(loaded.spec);
        continue;
      }
    }
    if (!parsed.success) {
      io.err(
        `✗ ${relative(io.cwd, file)}  not a unit test: ${parsed.error.issues[0]?.message ?? 'invalid'}\n`,
      );
      return 2;
    }
    tests.push({ file, test: parsed.data });
  }
  if (tests.length + specs.length === 0) {
    io.err('No unit test found.\n');
    return 2;
  }
  if (options.record && specs.length > 0) {
    io.err('--record writes JSON unit tests; YAML specs use their declared assertions\n');
    return 2;
  }
  const jobs = Number(options.jobs ?? '1');
  if (!Number.isInteger(jobs) || jobs < 1) {
    io.err(`--jobs takes a whole number of 1 or more, not ${options.jobs}\n`);
    return 2;
  }
  const run = await runUnitTests(
    tests.map((entry) => entry.test),
    { root, reader, record: options.record === true, noSandbox: options.sandbox === false, jobs },
  );
  if (options.record) {
    for (const [index, result] of run.results.entries()) {
      const entry = tests[index];
      if (entry && result.recorded) await writeFile(entry.file, formatJson(result.recorded));
    }
  }
  const counts = { pass: 0, fail: 0, inert: 0, unrecorded: 0 };
  for (const result of run.results) counts[result.status] += 1;
  const specContract = await runUnitSpecs(specs, {
    root,
    reader,
    noSandbox: options.sandbox === false,
    jobs,
  });
  if (specContract.inputErrors.length > 0) {
    io.err(specContract.inputErrors.map((error) => `Cannot run ${error}\n`).join(''));
    return 2;
  }
  const legacyContract = contractOf(
    run.results,
    tests.map((entry) => entry.test),
  );
  const combined = {
    runs: [...legacyContract.runs, ...specContract.runs],
    guards: [...legacyContract.guards, ...specContract.guards],
    scripts: [...legacyContract.scripts, ...specContract.scripts],
    ...(specContract.helpers ? { helpers: specContract.helpers } : {}),
  };
  if (options.json) {
    io.out(formatJson(combined));
  } else {
    io.out(report(run.results, counts, run.sandbox, run.notes, options.record === true));
    for (const result of specContract.runs)
      io.out(`${result.pass ? '✓' : '✗'} ${result.spec}  ${result.failing.join('; ')}\n`);
  }
  if (counts.unrecorded > 0 && !options.record) return 2;
  return combined.runs.some((result) => !result.pass) ? 1 : 0;
}

/**
 * The JSON the estate validator reads (a frozen contract, kept in step with that lane):
 * `{ runs: [{ spec, pass, failing }], guards: [{ guard, event, decision, message?, ms }], scripts: [{ script,
 * exit, stdout }] }`. One run per unit test; one guard entry per guard case run, its decision as the runtime
 * acts on it (a guard that fails with another exit code than 2 does not block: allow, its stderr the
 * message); one script entry per fixture run. An inert test passes: nothing in it can fail.
 */
export type UnitContract = {
  runs: Array<{ spec: string; pass: boolean; failing: string[] }>;
  guards: Array<{
    guard: string;
    event: string;
    decision: 'allow' | 'deny' | 'ask';
    message?: string;
    ms: number;
  }>;
  scripts: Array<{ script: string; exit: number; stdout: string }>;
  helpers?: Array<{ helper: string; exit: number; ms: number; text: string }>;
};

export function contractOf(results: readonly UnitResult[], tests: readonly UnitTest[]): UnitContract {
  const contract: UnitContract = { runs: [], guards: [], scripts: [] };
  results.forEach((result, index) => {
    const test = tests[index];
    const failedCases = result.cases.filter((entry) => !entry.pass);
    const failing =
      result.status === 'fail'
        ? failedCases.length > 0
          ? failedCases.map((entry) => `${entry.case}: ${entry.detail}`)
          : [result.detail]
        : result.status === 'unrecorded'
          ? [result.detail]
          : [];
    contract.runs.push({
      spec: result.id,
      pass: result.status === 'pass' || result.status === 'inert',
      failing,
    });
    if (!test) return;
    for (const entry of result.cases) {
      if (test.target.kind === 'guard') {
        const decision = entry.outcome.decision === 'error' ? 'allow' : entry.outcome.decision;
        contract.guards.push({
          guard: test.target.name,
          event: test.target.event,
          decision,
          ...(entry.outcome.message !== undefined ? { message: entry.outcome.message } : {}),
          ms: Math.round(entry.ms),
        });
      } else if (test.target.kind === 'subagent') {
        contract.helpers ??= [];
        contract.helpers.push({
          helper: test.target.name,
          exit: entry.outcome.exitCode,
          ms: Math.round(entry.ms),
          text: entry.outcome.output ?? '',
        });
      } else {
        contract.scripts.push({
          script: test.target.path,
          exit: entry.outcome.exitCode,
          stdout: entry.outcome.output ?? '',
        });
      }
    }
  });
  return contract;
}

function report(
  results: readonly UnitResult[],
  counts: Record<UnitResult['status'], number>,
  sandbox: string,
  notes: readonly string[],
  record: boolean,
): string {
  const mark = { pass: '✓', fail: '✗', inert: '·', unrecorded: '?' } as const;
  const lines = results.map((result) => `${mark[result.status]} ${result.id}  ${result.detail}`);
  for (const note of notes) lines.push(`note: ${note}`);
  const flaky = results.flatMap((result) => result.cases.filter((entry) => entry.flaky).map(() => result.id));
  if (flaky.length > 0) {
    lines.push(
      `Flaky: ${flaky.length} cases in ${new Set(flaky).size} tests vary on the original; they are reported, never compared.`,
    );
  }
  const checks = results.filter((result) => result.exercised !== undefined);
  if (checks.length > 0) {
    const exercised = checks.filter((result) => result.exercised).length;
    lines.push(
      `Catalogue checks: ${exercised} of ${checks.length} exercised (the host hook's answer to the trigger names the check).`,
    );
  }
  lines.push(
    record
      ? `Recorded ${results.length} unit tests (sandbox: ${sandbox}); ${counts.inert} have no fixture.`
      : `${counts.pass} of ${results.length} unit tests pass, ${counts.fail} fail, ${counts.inert} inert, ${counts.unrecorded} unrecorded (sandbox: ${sandbox}).`,
    '',
  );
  return lines.join('\n');
}

/** Both supported unit formats, never unrelated file extensions. */
async function unitFiles(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await unitFiles(path)));
    else if (/\.(?:json|ya?ml)$/i.test(entry.name)) files.push(path);
  }
  return files;
}

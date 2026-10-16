import { defaultChecks, someCall } from '@agent-nexus/driftbench-checks';
import type { CheckContext, Observed, Spec } from '@agent-nexus/driftbench-core';
import {
  observeHelper,
  observeUnitTests,
  type UnitObservation,
  type UnitRunOptions,
} from '@agent-nexus/driftbench-estate';
import { type UnitOutcome, UnitTest } from '@agent-nexus/driftbench-generate';
import type { UnitContract } from './estate-unit';
import { replayRegistry } from './replay';

/** The expectation kinds a guard process can decide: its decisions, its exit, and the files it writes. */
const EVALUATED: ReadonlySet<string> = new Set(['guards', 'execution', 'workspace']);

type WorkspaceDiff = NonNullable<UnitObservation['cases'][number]['workspace']>;

type WorkspaceExpect = {
  created?: string[];
  changed?: string[];
  deleted?: string[];
  others_untouched?: boolean;
};

/** `expect.workspace` against the files the operation's cases created, changed or deleted in its folder. */
function workspaceFailures(
  expect: WorkspaceExpect,
  cases: ReadonlyArray<{ workspace?: WorkspaceDiff }>,
): string[] {
  const seen: Record<'created' | 'changed' | 'deleted', Set<string>> = {
    created: new Set(),
    changed: new Set(),
    deleted: new Set(),
  };
  for (const entry of cases)
    for (const set of ['created', 'changed', 'deleted'] as const)
      for (const path of entry.workspace?.[set] ?? []) seen[set].add(path);
  const norm = (path: string) => path.replace(/^\.\//, '');
  const failing: string[] = [];
  const named = new Set<string>();
  for (const set of ['created', 'changed', 'deleted'] as const) {
    const wanted = expect[set]?.map(norm);
    if (wanted === undefined) continue;
    for (const path of wanted) named.add(path);
    const observed = [...seen[set]];
    if (wanted.length === 0 && observed.length > 0)
      failing.push(`workspace ${set}: ${observed.join(', ')}; the block expects nothing ${set}`);
    for (const path of wanted) if (!seen[set].has(path)) failing.push(`workspace: ${path} was not ${set}`);
  }
  if (expect.others_untouched === true) {
    const others = (['created', 'changed', 'deleted'] as const).flatMap((set) =>
      [...seen[set]].filter((path) => !named.has(path)).map((path) => `${path} (${set})`),
    );
    if (others.length > 0) failing.push(`workspace: other paths changed: ${others.join(', ')}`);
  }
  return failing;
}

/**
 * The expectation kinds of a block. In a spec the generator marked incomplete, `criteria` only names the
 * unmet gaps (metadata.estate.needs); it asserts nothing, so it is not a kind the runner must evaluate.
 */
function expectedKinds(expect: object | undefined, estate: Record<string, unknown> | undefined): string[] {
  const found = new Set(
    (Array.isArray(estate?.needs) ? (estate.needs as Array<{ marker?: unknown }>) : []).map(
      (entry) => entry.marker,
    ),
  );
  const criteria = (expect as { criteria?: unknown } | undefined)?.criteria;
  const placeholder =
    Array.isArray(criteria) && criteria.length > 0 && criteria.every((name) => found.has(name));
  return Object.keys(expect ?? {}).filter((key) => !(key === 'criteria' && placeholder));
}

/** Executes only explicit operations. The user ask is never parsed into shell commands or hook payloads. */
export async function runUnitSpecs(
  specs: readonly Spec[],
  options: UnitRunOptions,
): Promise<UnitContract & { inputErrors: string[] }> {
  const contract: UnitContract = { runs: [], guards: [], scripts: [] };
  const inputErrors: string[] = [];
  for (const spec of specs) {
    const estate = spec.metadata?.estate as Record<string, unknown> | undefined;
    const operation = estate?.unit as
      | { target?: Record<string, unknown>; cases?: unknown[]; budgetMs?: number }
      | undefined;
    const failing: string[] = [];
    const invalid = (reason: string) => {
      failing.push(reason);
      inputErrors.push(`${spec.id}: ${reason}`);
    };
    const finish = () => contract.runs.push({ spec: spec.id, pass: failing.length === 0, failing });
    if (estate?.mode !== 'unit') {
      invalid('the spec is not declared for unit execution');
      finish();
      continue;
    }
    if (spec.blocks.length !== 1) {
      invalid('a unit operation needs one block; use separate specs for separate operations');
      finish();
      continue;
    }
    if (operation?.target?.kind === 'subagent') {
      const target = operation.target;
      if (typeof target.name !== 'string' || typeof target.file !== 'string') {
        invalid('a helper operation needs its declared name and file');
        finish();
        continue;
      }
      const block = spec.blocks[0];
      if (!block) throw new Error('unit spec has no block');
      const when = block.when;
      const task = 'user' in when ? when.user : 'burst' in when ? when.burst.join('\n') : when.injection.user;
      const files = { ...spec.given?.world?.workspace?.files, ...block.given?.world?.workspace?.files };
      const result = await observeHelper({ name: target.name, file: target.file }, task, files, options);
      if (result.status === 'not-run') invalid(result.error ?? 'helper was not run');
      else {
        contract.helpers ??= [];
        contract.helpers.push({
          helper: target.name,
          exit: result.exit,
          ms: result.ms,
          text: result.observed?.text ?? '',
        });
        if (result.error) failing.push(result.error);
        if (result.observed) await evaluateHelper(spec, result.observed, failing, invalid);
      }
      finish();
      continue;
    }
    if (!operation?.target) {
      invalid('metadata.estate.unit declares no executable operation');
      finish();
      continue;
    }
    const { verdict: _declared, ...target } = operation.target;
    const parsed = UnitTest.safeParse({
      id: spec.id,
      planRow: typeof estate?.planRow === 'string' ? estate.planRow : spec.id,
      atom: Array.isArray(estate?.atoms) ? estate.atoms[0] : spec.id,
      title: spec.title,
      mapHash: typeof estate?.mapHash === 'string' ? estate.mapHash : (spec.version ?? spec.id),
      testType:
        target.kind === 'script'
          ? 'script_fixture'
          : estate?.testType === 'guard_register'
            ? 'guard_positive'
            : estate?.testType,
      target,
      cases: operation.cases ?? [],
      ...(operation.budgetMs !== undefined ? { budgetMs: operation.budgetMs } : {}),
    });
    if (!parsed.success) {
      invalid(`invalid unit operation: ${parsed.error.issues[0]?.message}`);
      finish();
      continue;
    }
    const test = parsed.data;
    for (const block of spec.blocks) {
      // Fail closed as the schema grows: a process run has no agent transcript, tool calls or stages.
      if (test.target.kind === 'guard')
        for (const key of expectedKinds(block.expect, estate))
          if (!EVALUATED.has(key)) invalid(`unit runner cannot evaluate expect.${key}; not_run`);
      if (test.target.kind === 'script' && (block.expect?.guards?.length ?? 0) > 0)
        invalid('a script operation does not execute guard assertions');
      if (test.target.kind === 'guard' && block.expect?.execution !== undefined)
        invalid('use case outcomes for guard processes; execution assertions describe script operations');
    }
    if (test.target.kind === 'script') {
      for (const key of expectedKinds(spec.blocks[0]?.expect, estate))
        if (key !== 'execution' && key !== 'workspace')
          invalid(`unit script operations do not evaluate expect.${key} assertions; not_run`);
      const some = spec.rules?.custom?.some_call;
      if (some !== undefined) {
        const container = some as { calls?: unknown };
        const entries = container && Array.isArray(container.calls) ? container.calls : [some];
        for (const value of entries) {
          const call = value as { label?: unknown; input?: unknown } | null;
          if (
            call?.label !== 'Bash' ||
            (call.input !== undefined &&
              (typeof call.input !== 'object' ||
                call.input === null ||
                Array.isArray(call.input) ||
                Object.keys(call.input).some((key) => key !== 'command')))
          )
            invalid(
              'script some_call supports only observed Bash command inputs; internal tool calls are not traced',
            );
        }
      }
      for (const key of Object.keys(spec.rules?.custom ?? {}))
        if (key !== 'some_call') invalid(`unit runner does not evaluate script custom check ${key}`);
    }
    if (failing.length > 0) {
      finish();
      continue;
    }
    const wantsWorkspace = spec.blocks.some((block) => block.expect?.workspace !== undefined);
    let run: Awaited<ReturnType<typeof observeUnitTests>>;
    try {
      run = await observeUnitTests([test], { ...options, observeWorkspace: wantsWorkspace });
    } catch (cause) {
      invalid(`unit operation not_run: ${cause instanceof Error ? cause.message : String(cause)}`);
      finish();
      continue;
    }
    const observed = run.observations[0];
    if (observed?.inputError) invalid(observed.inputError);
    if (observed?.error) failing.push(observed.error);
    if (!observed || (observed.cases.length === 0 && !observed.error))
      invalid('the unit operation executed no case');
    for (const entry of observed?.cases ?? []) {
      if (entry.timedOut) failing.push(`${entry.id}: timed out`);
      if (operation.budgetMs !== undefined && entry.ms > operation.budgetMs)
        failing.push(`${entry.id}: exceeded ${operation.budgetMs} ms`);
      const expected = test.cases.find((c) => c.id === entry.id)?.expected;
      if (expected) {
        for (const key of ['decision', 'exitCode', 'message', 'output'] as const) {
          if (expected[key] !== undefined && expected[key] !== entry.outcome[key])
            failing.push(`${entry.id}: ${key} differs from the declared outcome`);
        }
      }
      if (test.target.kind === 'guard') {
        contract.guards.push({
          guard: test.target.name,
          event: test.target.event,
          decision: entry.outcome.decision === 'error' ? 'allow' : entry.outcome.decision,
          ...(entry.outcome.message !== undefined ? { message: entry.outcome.message } : {}),
          ms: Math.round(entry.ms),
        });
      } else if (test.target.kind === 'script') {
        contract.scripts.push({
          script: test.target.path,
          exit: entry.outcome.exitCode,
          stdout: entry.outcome.output ?? '',
        });
      }
    }
    if (wantsWorkspace) {
      const observedCases = observed?.cases ?? [];
      if (observedCases.some((entry) => entry.workspace === undefined))
        invalid(
          'unit operation not_run: its cases report no workspace diff, so expect.workspace is not evaluated',
        );
      else
        for (const block of spec.blocks)
          if (block.expect?.workspace)
            failing.push(...workspaceFailures(block.expect.workspace, observedCases));
    }
    if (test.target.kind === 'guard') {
      const name = test.target.name;
      const outcomes = (observed?.cases ?? []).map((c) => c.outcome);
      const active = outcomes.filter(
        (outcome) =>
          outcome.decision !== 'allow' || outcome.message !== undefined || outcome.output !== undefined,
      );
      const verdictOf = (outcome: UnitOutcome) => {
        if (outcome.decision === 'deny' || outcome.decision === 'ask') return outcome.decision;
        if (outcome.decision === 'error') return 'warn';
        return outcome.output !== undefined ? 'nudge' : undefined;
      };
      let assertions = 0;
      for (const block of spec.blocks) {
        for (const expect of block.expect?.guards ?? []) {
          if (expect.name !== name) {
            invalid(`the operation runs ${name}, not the asserted guard ${expect.name}`);
            continue;
          }
          assertions++;
          const wanted = expect.count;
          // No verdict: a required firing is a blocking decision (deny or ask); a bound on firings (a count
          // of 0, a max) also counts a warning, so a guard that only warns does not pass "no firing".
          const requires =
            wanted === undefined || (typeof wanted === 'number' ? wanted > 0 : (wanted.min ?? 0) > 0);
          const counted = (outcome: UnitOutcome) => {
            const kind = verdictOf(outcome);
            if (expect.verdict !== undefined) return kind === expect.verdict;
            return kind === 'deny' || kind === 'ask' || (!requires && kind === 'warn');
          };
          const count = outcomes.filter(counted).length;
          const holds =
            typeof wanted === 'number'
              ? count === wanted
              : count >= (wanted === undefined ? 1 : (wanted.min ?? 0)) &&
                (wanted?.max === undefined || count <= wanted.max);
          if (!holds)
            failing.push(
              `${name}: ${count} matching guard decisions; expected ${JSON.stringify(wanted ?? { min: 1 })}${expect.verdict ? ` with verdict ${expect.verdict}` : ''}`,
            );
        }
      }
      const custom = spec.rules?.custom ?? {};
      for (const [key, value] of Object.entries(custom)) {
        if (key !== 'guard_message' && key !== 'guard_finished') {
          invalid(`unit runner does not evaluate custom check ${key}`);
          continue;
        }
        const check = value as { name?: string; mustNot?: string[]; must?: string[] };
        if (check.name !== name) {
          invalid(`custom check ${key} does not name the operation's guard ${name}`);
          continue;
        }
        assertions++;
        if (key === 'guard_message') {
          const messages = active.map((o) => o.message ?? o.output ?? '');
          if (!messages.length || messages.some((m) => !m))
            failing.push(`${name}: no message from an active guard`);
          for (const pattern of check.mustNot ?? [])
            if (messages.some((m) => new RegExp(pattern, 'm').test(m)))
              failing.push(`${name}: message matches forbidden pattern ${pattern}`);
          for (const pattern of check.must ?? [])
            if (messages.some((m) => !new RegExp(pattern, 'm').test(m)))
              failing.push(`${name}: message lacks required pattern ${pattern}`);
        }
      }
      if (!assertions && !test.cases.some((c) => c.expected))
        invalid('the guard spec declares no outcome assertion');
    } else {
      // A process merely starting is not an oracle: require a declared fixture or an explicit exit/output.
      const expects = spec.blocks.flatMap((b) => (b.expect?.execution ? [b.expect.execution] : []));
      const commands = observed?.cases ?? [];
      if (spec.rules?.custom?.some_call !== undefined) {
        if (commands.some((c) => !c.command)) invalid('the script trace holds no executed command');
        else {
          const observation: Observed = {
            text: commands.map((c) => c.outcome.output ?? '').join('\n'),
            segments: [],
            cost: {},
            latencyMs: commands.reduce((sum, c) => sum + c.ms, 0),
            toolCalls: commands.map((c) => ({
              label: 'Bash',
              input: { command: c.command },
              output: c.outcome.output,
              ...(c.outcome.exitCode !== 0 ? { error: `exit ${c.outcome.exitCode}` } : {}),
            })),
          };
          try {
            const verdicts = await someCall(unitContext(spec, observation), spec.rules.custom.some_call);
            for (const verdict of Array.isArray(verdicts) ? verdicts : [verdicts])
              if (verdict.outcome !== 'pass') failing.push(verdict.evidence);
          } catch (cause) {
            invalid(`invalid some_call: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        }
      }
      for (const expect of expects) {
        if (expect.ran_code !== undefined && expect.ran_code !== commands.length > 0)
          failing.push(`script ran_code differs from ${expect.ran_code}`);
        if (expect.max_commands !== undefined && commands.length > expect.max_commands)
          failing.push(`script ran ${commands.length} commands, over the limit of ${expect.max_commands}`);
        if (expect.exit_code !== undefined && commands.at(-1)?.outcome.exitCode !== expect.exit_code)
          failing.push(`last script exit differs from ${expect.exit_code}`);
      }
      if (
        !observed?.declared &&
        !test.cases.some((c) => c.expected) &&
        !expects.some((e) => e.exit_code !== undefined)
      )
        invalid('the script spec declares no expected exit or output; record its fixtures first');
    }
    finish();
  }
  return { ...contract, inputErrors };
}

function unitContext(spec: Spec, observed: Observed): CheckContext {
  const block = spec.blocks[0];
  if (!block) throw new Error('unit spec has no block');
  return {
    spec,
    mode: 'T',
    blockIndex: 0,
    block,
    expect: block.expect ?? {},
    observed,
    history: [],
    ledger: {},
    given: {
      prefix: block.given?.prefix ?? [],
      ledger: { ...spec.given?.ledger, ...block.given?.ledger },
      world: { ...spec.given?.world, ...block.given?.world },
      vars: { ...spec.given?.vars, ...block.given?.vars },
      target: spec.target ?? { adapter: 'unit' },
      hash: 'unit',
    },
  };
}

/** Reuse the machine checks; no helper assertion passes on prompt presence or a zero exit alone. */
async function evaluateHelper(
  spec: Spec,
  observed: Observed,
  failing: string[],
  invalid: (s: string) => void,
) {
  const context = unitContext(spec, observed);
  if ((context.expect.criteria?.length ?? 0) > 0 || (spec.criteria?.length ?? 0) > 0) {
    invalid('helper criteria require a configured judge; unit execution evaluates machine checks');
    return;
  }
  let count = 0;
  for (const check of defaultChecks({ registry: replayRegistry() })) {
    if (!check.applies(context)) continue;
    const verdicts = await check.evaluate(context);
    count += verdicts.length;
    for (const verdict of verdicts) {
      if (verdict.gating && verdict.outcome === 'fail') failing.push(verdict.evidence);
      if (verdict.gating && (verdict.outcome === 'inconclusive' || verdict.outcome === 'not_applicable'))
        invalid(verdict.evidence);
    }
  }
  if (count === 0) invalid('helper spec declares no evaluated outcome assertion');
}

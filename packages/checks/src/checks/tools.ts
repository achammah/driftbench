import {
  type Assertion,
  type By,
  type Check,
  type CheckContext,
  type CompareMode,
  contentHash,
  isZero,
  machineVerdict,
  objectContextOfSpec,
  resolveBlockObjects,
  type Stimulus,
  sentStimulus,
  shippedObjectContext,
  type ToolCall,
  type ToolExpect,
  type UsedObject,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { initializeShippedObjects } from '../initialize';
import { checkAssertion } from '../support/assert';
import { countAllows, describeCount, minimumOf } from '../support/count';
import { entryKeys, isRecord, listed, plural, show, times } from '../support/values';
import {
  DEFAULT_VALUE_POLICY,
  type LadderResult,
  policyOf,
  runLadder,
  type Settles,
  type ValueCase,
  type ValuePolicy,
  type ValueServices,
  valuePolicyProblems,
} from '../value-check/ladder';

const NAME = 'tools';

/** What the tools check compares input values with: a value-check policy and the services its rungs use. */
export type ToolsCheckOptions = {
  /** The resolved `policy/value-check` object. The shipped `policy/value-check:default` when absent. */
  policy?: ValuePolicy;
  /** The tool replayer (rung 1) and the same-referent judge (rung 3). A rung without its service does not apply. */
  services?: ValueServices;
};

/**
 * The expected tool calls of a block. Per expected tool: the call count with Count semantics, and every
 * input assertion on every call of that tool. `tool_order` lines the expected tools up with the observed
 * calls (exact, in_order, any_order, the Google ADK trajectory match types). The share of expected arguments
 * that matched is computed from these verdicts by the argument-accuracy diagnostic: a check never aggregates
 * its own verdicts into another verdict.
 *
 * An input value the block names (a bare value, `exact`, or a leaf of `subset`) is decided by the value-check
 * ladder: equal passes; otherwise the policy's rungs decide whether the agent's value is the right one where it
 * matters (the tool's outcome, its stated contract, the source the agent copied, a calibrated judge), and a
 * value no rung settles is inconclusive with every rung's reason. `compare` on the expected tool names one rung,
 * or `exact` with a reason. The other assertion forms (`regex`, `contains`, `one_of`, `nonempty`, `absent`)
 * state their own accepted writings and compare as written. A demand for a writing no contract states adds a
 * non-gating lint verdict on the test.
 *
 * A tool expected 0 times belongs to the forbidden check, so its fact is never reported twice.
 */
export function createToolsCheck(options: ToolsCheckOptions = {}): Check {
  const configured = options.policy;
  if (configured !== undefined) {
    const problems = valuePolicyProblems(configured);
    if (problems.length > 0) {
      throw new Error(
        `the value-check policy ${configured.ref ?? configured.id ?? ''} cannot run: ${problems.join('; ')}`,
      );
    }
  }
  const services = options.services ?? {};
  return {
    name: NAME,
    applies: (ctx) => expectedTools(ctx).length > 0 || ctx.expect.tool_order !== undefined,
    async evaluate(ctx) {
      initializeShippedObjects();
      const chosen = policyFor(ctx, configured);
      const verdicts = (await evaluate(ctx, chosen.policy, services)).map((verdict) =>
        stampValues(verdict, chosen),
      );
      return chosen.problem === undefined
        ? verdicts
        : [machineVerdict(NAME, 'value_check', 'fail', chosen.problem), ...verdicts];
    },
  };
}

/** The tools check with the shipped value-check policy and no service: no replay, no judge. */
export const tools: Check = createToolsCheck();

/**
 * The value-check policy of one block, read through the object resolver with the objects its spec was loaded
 * against: shipped, project and suite objects, `uses.yaml` files included. A layer that names a `value_check`
 * (the block, the spec, a suite or project `uses.yaml`, the command line) wins; else the configured policy;
 * else the shipped `policy/value-check:default`. A spec no loader produced resolves against the shipped objects.
 * An object that cannot resolve or cannot run is never replaced silently: the block gets a failing
 * `tools.value_check` verdict, and its values are compared exactly, so its count, input and order verdicts stay.
 */
function policyFor(ctx: CheckContext, configured: ValuePolicy | undefined): ChosenPolicy {
  const context = objectContextOfSpec(ctx.spec) ?? shippedObjectContext();
  let used: UsedObject | undefined;
  try {
    used = resolveBlockObjects(ctx.spec, ctx.blockIndex, context).find(
      (entry) => entry.key === 'value_check',
    );
  } catch (cause) {
    return {
      policy: EXACT_ONLY,
      problem: `the value-check object of this block cannot resolve, so its values are compared exactly: ${message(cause)}`,
    };
  }
  if (configured !== undefined && (used === undefined || used.setAt === 'shipped')) {
    return {
      policy: configured,
      provenance: {
        object: configured.ref ?? `policy/value-check:(caller)@${contentHash(configured).slice(0, 8)}`,
        layer: 'cli',
      },
    };
  }
  if (used === undefined) return { policy: DEFAULT_VALUE_POLICY };
  const policy = policyOf(used.object);
  const problems = valuePolicyProblems(policy);
  if (problems.length > 0) {
    return {
      policy: EXACT_ONLY,
      problem: `the value-check object ${used.object.ref} (set at ${used.place || used.setAt}) cannot run, so its values are compared exactly: ${problems.join('; ')}`,
    };
  }
  return { policy, provenance: { object: used.object.ref, layer: used.object.layer } };
}

type ChosenPolicy = {
  policy: ValuePolicy;
  provenance?: Pick<By, 'object' | 'layer'>;
  problem?: string;
};

/** Keep every value decision; the aggregate names the decision responsible for its outcome. */
function stampValues(verdict: Verdict, chosen: ChosenPolicy): Verdict {
  const decisions = verdict.valueCheck;
  if (!decisions?.length || !chosen.provenance) return verdict;
  const order = chosen.policy.order ?? chosen.policy.items.map((item) => item.id);
  const deciding =
    verdict.outcome === 'fail'
      ? decisions.find((entry) => entry.outcome === 'fail')
      : verdict.outcome === 'inconclusive'
        ? decisions.find((entry) => entry.outcome === 'inconclusive')
        : decisions.reduce((latest, entry) =>
            order.indexOf(entry.rung) > order.indexOf(latest.rung) ? entry : latest,
          );
  if (!deciding) return verdict;
  const item = chosen.policy.items.find((entry) => entry.id === deciding.rung);
  const impl =
    item?.impl ??
    (deciding.rung === 'identity' || deciding.rung === 'exact_fallback'
      ? 'builtin:value-check/exact'
      : undefined);
  if (!impl) return verdict;
  return { ...verdict, by: { ...chosen.provenance, item: deciding.rung, impl } };
}

/** A policy with no rung: every value that differs from the gold falls back to the exact compare. */
const EXACT_ONLY: ValuePolicy = { id: 'exact-only', items: [] };

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function evaluate(ctx: CheckContext, policy: ValuePolicy, services: ValueServices): Promise<Verdict[]> {
  const expected = expectedTools(ctx);
  const keys = entryKeys(expected.map((tool) => tool.label));
  const calls = ctx.observed.toolCalls;
  const verdicts: Verdict[] = [];
  // What the user wrote is read only by a rung that compares a value with it, so it is collected when one asks
  // and once for the block: a block whose values all match the gold never walks the history.
  let collected: string[] | undefined;
  const sources = () => (collected ??= userTexts(ctx));

  for (const [index, tool] of expected.entries()) {
    const key = keys[index] ?? tool.label;
    const own = calls.filter((call) => call.label === tool.label);
    verdicts.push(countVerdict(key, tool, own, calls));
    if (tool.input_closed === true) verdicts.push(closedInputVerdict(key, tool, own));
    for (const [field, assertion] of Object.entries(tool.input ?? {})) {
      const values: ValueContext = { ctx, tool, field, policy, services, sources };
      const [verdict, lint] = await inputVerdict(key, values, own, assertion);
      verdicts.push(verdict);
      verdicts.push(...lint);
    }
  }

  if (ctx.expect.tool_order !== undefined) {
    verdicts.push(orderVerdict(ctx.expect.tool_order, expected, calls));
  }

  return verdicts;
}

/** The block's expected tools, without the ones expected 0 times. */
function expectedTools(ctx: CheckContext): ToolExpect[] {
  return (ctx.expect.tools ?? []).filter((tool) => !isZero(tool.count));
}

function countVerdict(key: string, tool: ToolExpect, own: ToolCall[], calls: ToolCall[]): Verdict {
  const ok = countAllows(tool.count, own.length);
  const seen = ok ? '' : `; calls in this block: ${listed(calls.map((call) => call.label))}`;
  return machineVerdict(
    NAME,
    `${key}.count`,
    ok ? 'pass' : 'fail',
    `${tool.label} called ${times(own.length)}, expected ${describeCount(tool.count)}${seen}`,
  );
}

/** Everything the ladder needs about one expected argument. */
type ValueContext = {
  ctx: CheckContext;
  tool: ToolExpect;
  field: string;
  policy: ValuePolicy;
  services: ValueServices;
  /** The user texts of the block, collected on the first call. */
  sources: () => string[];
};

/** One call's answer for an argument: its outcome, a note for the evidence, and a lint on the test. */
type CallAnswer = {
  outcome: Settles;
  note?: string;
  lints?: NonNullable<LadderResult['lint']>[];
  /** The values a rung decided: their path, the rung and its outcome. */
  decided?: { path: string; rung: string; outcome: Settles }[];
};

/** One entry of `Verdict.valueCheck`. */
type Decision = NonNullable<Verdict['valueCheck']>[number];

/**
 * One argument on every call of its tool. A value the block names goes through the value-check ladder; the
 * other assertion forms compare as written. The argument passes when every call passes, fails when one call
 * fails, and is inconclusive otherwise.
 */
async function inputVerdict(
  key: string,
  values: ValueContext,
  own: ToolCall[],
  assertion: Assertion,
): Promise<[Verdict, Verdict[]]> {
  const { tool, field } = values;
  const label = tool.label;
  const id = `${key}.input.${field}`;
  if (own.length === 0) {
    const { expected } = checkAssertion(undefined, assertion);
    return [
      machineVerdict(NAME, id, 'fail', `${label} was not called, so input.${field} could not be ${expected}`),
      [],
    ];
  }
  const failures: string[] = [];
  const open: string[] = [];
  const notes: string[] = [];
  const lints = new Map<string, Set<string>>();
  const decisions: Decision[] = [];
  let expected = '';
  let problem: string | undefined;
  for (const [index, call] of own.entries()) {
    const value = isRecord(call.input) ? call.input[field] : undefined;
    const result = checkAssertion(value, assertion);
    expected = result.expected;
    problem = result.problem ?? problem;
    const at = `call ${index + 1}${callId(call)}`;
    const answer = result.ok
      ? ({ outcome: 'pass' } as CallAnswer)
      : named(assertion)
        ? await ladderAnswer(values, call, value, assertion)
        : ({ outcome: 'fail' } as CallAnswer);
    if (answer.note !== undefined) notes.push(`${at}: ${answer.note}`);
    for (const entry of answer.decided ?? []) decisions.push({ call: index + 1, ...entry });
    for (const lint of answer.lints ?? [])
      lints.set(lint.id, (lints.get(lint.id) ?? new Set()).add(lint.text));
    if (answer.outcome === 'fail') failures.push(`${at}: input.${field} is ${show(value)}`);
    if (answer.outcome === 'inconclusive') open.push(`${at}: input.${field} is ${show(value)}`);
  }
  const lint = [...lints.entries()].map(([kind, texts]) =>
    machineVerdict(NAME, `${id}.${kind}`, 'fail', `test lint: ${[...texts].join('; ')}`, { gating: false }),
  );
  const how = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  if (problem) return [machineVerdict(NAME, id, 'fail', `input.${field} ${expected}: ${problem}`), lint];
  const decided = (made: Verdict): Verdict =>
    decisions.length === 0 ? made : { ...made, valueCheck: decisions };
  if (failures.length > 0) {
    return [
      decided(
        machineVerdict(NAME, id, 'fail', `${label} ${failures.join('; ')}; expected ${expected}${how}`),
      ),
      lint,
    ];
  }
  if (open.length > 0) {
    return [
      decided(
        machineVerdict(NAME, id, 'inconclusive', `${label} ${open.join('; ')}; expected ${expected}${how}`),
      ),
      lint,
    ];
  }
  const shown = own.map((call) => show(isRecord(call.input) ? call.input[field] : undefined));
  return [
    decided(
      machineVerdict(
        NAME,
        id,
        'pass',
        `${label} input.${field} is ${expected} on ${plural(own.length, 'call')}: ${[...new Set(shown)].join(', ')}${how}`,
      ),
    ),
    lint,
  ];
}

/** True for the assertion forms that name a value: a bare value, `exact`, and `subset`, whose leaves are values. */
function named(assertion: Assertion): boolean {
  if (assertion === null || typeof assertion !== 'object') return true;
  return 'exact' in assertion || 'subset' in assertion;
}

/**
 * The ladder's answer for one call: on the value itself, or on each leaf of a `subset`. A leaf that fails fails
 * the call; one that is inconclusive leaves it inconclusive.
 */
async function ladderAnswer(
  values: ValueContext,
  call: ToolCall,
  value: unknown,
  assertion: Assertion,
): Promise<CallAnswer> {
  const results: { path: string; result: LadderResult }[] = [];
  const decide = async (path: string, gold: unknown, agent: unknown) => {
    results.push({
      path,
      result: await runLadder(valueCase(values, call, path, gold, agent), values.policy, values.services),
    });
  };
  if (assertion !== null && typeof assertion === 'object' && 'subset' in assertion) {
    const walk = async (
      path: string,
      expected: Record<string, unknown>,
      observed: unknown,
    ): Promise<boolean> => {
      if (!isRecord(observed)) return false;
      for (const [key, part] of Object.entries(expected)) {
        const at = `${path}.${key}`;
        if (isRecord(part)) {
          if (!(await walk(at, part, observed[key]))) {
            results.push({ path: at, result: notAnObject(observed[key]) });
          }
        } else {
          await decide(at, part, observed[key]);
        }
      }
      return true;
    };
    if (!(await walk(values.field, assertion.subset, value))) {
      return { outcome: 'fail', note: `${show(value)} is not an object` };
    }
  } else {
    const gold =
      assertion !== null && typeof assertion === 'object' && 'exact' in assertion
        ? assertion.exact
        : assertion;
    await decide(values.field, gold, value);
  }
  const settled = results.filter(
    (entry) => entry.result.rung !== 'identity' || entry.result.outcome !== 'pass',
  );
  const outcome: Settles = results.some((entry) => entry.result.outcome === 'fail')
    ? 'fail'
    : results.some((entry) => entry.result.outcome === 'inconclusive')
      ? 'inconclusive'
      : 'pass';
  const note = settled
    .map((entry) => {
      return `${entry.path} ${entry.result.rung}: ${entry.result.evidence}`;
    })
    .join('; ');
  const lints = results
    .map((entry) => entry.result.lint)
    .filter((lint): lint is NonNullable<LadderResult['lint']> => lint !== undefined);
  const decided = settled.map((entry) => ({
    path: entry.path,
    rung: entry.result.rung,
    outcome: entry.result.outcome,
  }));
  return {
    outcome,
    ...(decided.length === 0 ? {} : { decided }),
    ...(note === '' ? {} : { note }),
    ...(lints.length === 0 ? {} : { lints }),
  };
}

function notAnObject(value: unknown): LadderResult {
  return {
    outcome: 'fail',
    rung: 'identity',
    evidence: `${show(value)} is not an object`,
    names: {},
    tried: [],
  };
}

/** The value case of one argument path on one call: the gold, the value and what the rungs read. */
function valueCase(
  values: ValueContext,
  call: ToolCall,
  path: string,
  gold: unknown,
  value: unknown,
): ValueCase {
  const { ctx, tool } = values;
  const schemas = ctx.spec.metadata?.tool_schemas;
  const definition = isRecord(schemas) ? schemas[tool.label] : undefined;
  // A context built by hand may carry no Given: no store, no prefix.
  const store = ctx.given?.world?.store;
  const compare = compareFor(tool.compare, path);
  return {
    tool: tool.label,
    field: path,
    gold,
    value,
    ...(isRecord(call.input) ? { input: call.input } : {}),
    ...(compare === undefined ? {} : { compare }),
    ...(definition === undefined ? {} : { definition }),
    // A getter: the texts are collected only if a rung reads them.
    get sources() {
      return { user: values.sources() };
    },
    ...(store === undefined ? {} : { world: store }),
  };
}

/** The `compare` mode of one argument path: one mode for all, or the mode of the path or of its top-level name. */
function compareFor(compare: ToolExpect['compare'], path: string): CompareMode | undefined {
  if (compare === undefined) return undefined;
  if (typeof compare === 'string') return compare;
  if (Object.keys(compare).length === 1 && typeof (compare as { exact?: unknown }).exact === 'string') {
    return compare as CompareMode;
  }
  const byName = compare as Record<string, CompareMode>;
  return byName[path] ?? byName[path.split('.')[0] as string];
}

/** What the user wrote before and in this block: the prefix, the earlier blocks' turns, and this block's turn. */
function userTexts(ctx: CheckContext): string[] {
  const texts = (ctx.given?.prefix ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content);
  for (const block of ctx.spec.blocks.slice(0, ctx.blockIndex)) texts.push(...stimulusTexts(block.when));
  texts.push(...stimulusTexts(sentStimulus(ctx)));
  return texts;
}

function stimulusTexts(stimulus: Stimulus): string[] {
  if ('user' in stimulus) return [stimulus.user];
  if ('burst' in stimulus) return [...stimulus.burst];
  return [stimulus.injection.user];
}

/** Closing the input restricts top-level argument names, without changing the value assertions. */
function closedInputVerdict(key: string, tool: ToolExpect, own: ToolCall[]): Verdict {
  const allowed = new Set(Object.keys(tool.input ?? {}));
  const failures: string[] = [];
  own.forEach((call, index) => {
    const at = `call ${index + 1}${callId(call)}`;
    if (!isRecord(call.input)) {
      failures.push(`${at}: input is not an object`);
      return;
    }
    const extra = Object.keys(call.input).filter((field) => !allowed.has(field));
    if (extra.length > 0) failures.push(`${at}: extra input keys ${listed(extra)}`);
  });
  return machineVerdict(
    NAME,
    `${key}.input_closed`,
    failures.length === 0 ? 'pass' : 'fail',
    `${tool.label} ${failures.length === 0 ? `only allowed input keys on ${plural(own.length, 'call')}` : failures.join('; ')}; allowed keys: ${listed([...allowed])}`,
  );
}

function callId(call: ToolCall): string {
  return call.id === undefined ? '' : ` (${call.id})`;
}

type Mode = NonNullable<CheckContext['expect']['tool_order']>;

function orderVerdict(mode: Mode, expected: ToolExpect[], calls: ToolCall[]): Verdict {
  const labels = calls.map((call) => call.label);
  const saw = labels.length === 0 ? 'no call' : labels.join(', ');
  const wanted = expected.map((tool) => `${tool.label} (${describeCount(tool.count)})`);
  let ok: boolean;
  let rule: string;
  if (mode === 'exact') {
    ok = matchesExactly(expected, labels);
    rule = 'exactly these calls, in this order, and no other';
  } else if (mode === 'in_order') {
    ok = isSubsequence(expansion(expected), labels);
    rule = 'these calls in this order, other calls allowed between them';
  } else {
    ok = includesAll(expansion(expected), labels);
    rule = 'these calls in any order';
  }
  const argument = mode === 'exact' ? argumentNote(expected, calls) : undefined;
  const where =
    mode === 'exact' && !ok
      ? `; first difference: ${firstDifference(expansion(expected), labels)}`
      : argument
        ? `; first argument difference: ${argument}`
        : '';
  return machineVerdict(
    NAME,
    'order',
    ok ? 'pass' : 'fail',
    `${mode}: expected ${rule}: ${listed(wanted)}; saw ${saw}${where}`,
  );
}

/**
 * The first argument, in call order, whose value fails its expected assertion, with the call's name and position.
 * Calls are compared position by position against the expected sequence; a call with the right name still
 * names its argument here when that argument is wrong.
 */
function argumentNote(expected: ToolExpect[], calls: ToolCall[]): string | undefined {
  const tools = expected.flatMap((tool) => Array<ToolExpect>(minimumOf(tool.count)).fill(tool));
  for (let index = 0; index < Math.min(tools.length, calls.length); index++) {
    const tool = tools[index];
    const call = calls[index];
    if (!tool || !call || tool.label !== call.label) continue;
    for (const [field, assertion] of Object.entries(tool.input ?? {})) {
      const value = isRecord(call.input) ? call.input[field] : undefined;
      const result = checkAssertion(value, assertion);
      if (!result.ok) {
        return `call ${index + 1} (${call.label}) input.${field}: expected ${result.expected}, saw ${show(value)}`;
      }
    }
  }
  return undefined;
}

/** The first call where the observed calls leave the expected ones: a difference, an extra call or a missing call. */
function firstDifference(wanted: string[], labels: string[]): string {
  const length = Math.max(wanted.length, labels.length);
  for (let index = 0; index < length; index++) {
    const want = wanted[index];
    const got = labels[index];
    if (want === got) continue;
    const at = `call ${index + 1}`;
    if (got === undefined) return `${at} is missing: expected ${want}`;
    if (want === undefined) return `${at} is extra: saw ${got}`;
    return `${at} differs: expected ${want}, saw ${got}`;
  }
  return 'none';
}

/** The expected calls one by one: each tool as many times as its count requires at the least. */
function expansion(expected: ToolExpect[]): string[] {
  return expected.flatMap((tool) => Array<string>(minimumOf(tool.count)).fill(tool.label));
}

function isSubsequence(wanted: string[], labels: string[]): boolean {
  let next = 0;
  for (const label of labels) if (label === wanted[next]) next += 1;
  return next >= wanted.length;
}

function includesAll(wanted: string[], labels: string[]): boolean {
  const left = [...labels];
  return wanted.every((label) => {
    const at = left.indexOf(label);
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/**
 * Exact: the observed calls split into consecutive runs, one per expected tool in order, each run made of
 * that tool only and as long as its count allows, with no call left over.
 */
function matchesExactly(expected: ToolExpect[], labels: string[]): boolean {
  const memo = new Map<string, boolean>();
  const from = (entry: number, position: number): boolean => {
    if (entry === expected.length) return position === labels.length;
    const key = `${entry}:${position}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const tool = expected[entry];
    if (tool === undefined) return position === labels.length;
    let run = 0;
    while (labels[position + run] === tool.label) run += 1;
    let result = false;
    for (let length = 0; length <= run && !result; length += 1) {
      result = countAllows(tool.count, length) && from(entry + 1, position + length);
    }
    memo.set(key, result);
    return result;
  };
  return from(0, 0);
}

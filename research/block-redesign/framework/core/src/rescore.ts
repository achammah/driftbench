// Stand-in re-scorer: runs a resolved check-set and value-check policy over a stored observation and stamps
// every verdict with `by` (config_framework.md 2.11). The item implementations reproduce the parts of
// packages/checks/src/checks/tools.ts at 6a6f88ecd (copied below where the helpers are not exported) and
// call main's support code (checkAssertion, countAllows, entryKeys, ...) and core's isZero unchanged.
import { z } from 'zod';
import { checkAssertion } from '../../../../../packages/checks/src/support/assert.ts';
import { countAllows, describeCount, minimumOf } from '../../../../../packages/checks/src/support/count.ts';
import { entryKeys, isRecord, listed, plural, show, times } from '../../../../../packages/checks/src/support/values.ts';
import { machineVerdict } from '../../../../../packages/core/src/contracts/check.ts';
import { isZero } from '../../../../../packages/core/src/spec/semantics.ts';
import type { ImplRegistry, Layer, ObjectStore, ResolvedItem, ResolvedObject } from './objects.ts';

export type Call = { label: string; input: unknown; output?: unknown; error?: string; id?: string };
type Count = number | { min?: number; max?: number } | undefined;
type ToolExpect = { label: string; count?: Count; input?: Record<string, unknown>; input_closed?: boolean };
export type Expect = { tools?: ToolExpect[]; tool_order?: 'exact' | 'in_order' | 'any_order' };

export type By = { object: string; item: string; impl: string; layer: Layer };
export type Verdict = {
  id: string;
  kind: 'machine';
  name: string;
  gating: boolean;
  outcome: 'pass' | 'fail' | 'inconclusive';
  evidence: string;
  score?: number;
  by?: By;
};

type InputVerdict = Verdict & { tool: string; field: string };
type Ctx = { expect: Expect; calls: Call[]; inputs: InputVerdict[] };
type CheckImpl = (ctx: Ctx, item: ResolvedItem) => Verdict[];
type ValueImpl = (value: unknown, assertion: unknown, params: Record<string, unknown>) => { ok: boolean; expected: string; problem?: string };

const NAME = 'tools';
const expectedTools = (expect: Expect) => (expect.tools ?? []).filter((tool) => !isZero(tool.count as never));
const appliesTools = (expect: Expect) => expectedTools(expect).length > 0 || expect.tool_order !== undefined;

// ---- value-check rung 4: today's assertion vocabulary, with two typed params that default to today ----
const ExactParams = z.strictObject({ case_insensitive: z.boolean().default(false), strip_punctuation: z.boolean().default(false) });

function fold(text: string, params: { case_insensitive: boolean; strip_punctuation: boolean }): string {
  let out = text;
  if (params.strip_punctuation) out = out.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (params.case_insensitive) out = out.toLowerCase();
  return out;
}

const exact: ValueImpl = (value, assertion, raw) => {
  const params = ExactParams.parse(raw);
  const base = checkAssertion(value, assertion as never);
  if (!params.case_insensitive && !params.strip_punctuation) return base;
  // Only string comparisons fold; every other form keeps today's answer.
  if (typeof value !== 'string') return base;
  const v = fold(value, params);
  const a = assertion as Record<string, unknown> | string;
  if (typeof a === 'string') return { ...base, ok: v === fold(a, params) };
  if (a && typeof a === 'object') {
    if (typeof a.exact === 'string') return { ...base, ok: v === fold(a.exact, params) };
    if (Array.isArray(a.one_of)) return { ...base, ok: a.one_of.some((x) => typeof x === 'string' && v === fold(x, params)) };
    if (typeof a.contains === 'string') return { ...base, ok: v.includes(fold(a.contains, params)) };
    if (typeof a.regex === 'string' && params.case_insensitive && !params.strip_punctuation) {
      try {
        return { ...base, ok: new RegExp(a.regex, 'i').test(value) };
      } catch {
        return base;
      }
    }
  }
  return base;
};

// ---- check-set items ----
function countVerdict(key: string, tool: ToolExpect, own: Call[], calls: Call[]): Verdict {
  const ok = countAllows(tool.count as never, own.length);
  const seen = ok ? '' : `; calls in this block: ${listed(calls.map((call) => call.label))}`;
  return machineVerdict(NAME, `${key}.count`, ok ? 'pass' : 'fail', `${tool.label} called ${times(own.length)}, expected ${describeCount(tool.count as never)}${seen}`) as Verdict;
}

function callId(call: Call): string {
  return call.id === undefined ? '' : ` (${call.id})`;
}

function closedInputVerdict(key: string, tool: ToolExpect, own: Call[]): Verdict {
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
  return machineVerdict(NAME, `${key}.input_closed`, failures.length === 0 ? 'pass' : 'fail', `${tool.label} ${failures.length === 0 ? `only allowed input keys on ${plural(own.length, 'call')}` : failures.join('; ')}; allowed keys: ${listed([...allowed])}`) as Verdict;
}

// orderVerdict and its helpers: verbatim from tools.ts (not exported there).
function orderVerdict(mode: NonNullable<Expect['tool_order']>, expected: ToolExpect[], calls: Call[]): Verdict {
  const labels = calls.map((call) => call.label);
  const saw = labels.length === 0 ? 'no call' : labels.join(', ');
  const wanted = expected.map((tool) => `${tool.label} (${describeCount(tool.count as never)})`);
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
  return machineVerdict(NAME, 'order', ok ? 'pass' : 'fail', `${mode}: expected ${rule}: ${listed(wanted)}; saw ${saw}${where}`) as Verdict;
}
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
function expansion(expected: ToolExpect[]): string[] {
  return expected.flatMap((tool) => Array<string>(minimumOf(tool.count as never)).fill(tool.label));
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
      result = countAllows(tool.count as never, length) && from(entry + 1, position + length);
    }
    memo.set(key, result);
    return result;
  };
  return from(0, 0);
}
function argumentNote(expected: ToolExpect[], calls: Call[]): string | undefined {
  const tools = expected.flatMap((tool) => Array<ToolExpect>(minimumOf(tool.count as never)).fill(tool));
  for (let index = 0; index < Math.min(tools.length, calls.length); index++) {
    const tool = tools[index];
    const call = calls[index];
    if (!tool || !call || tool.label !== call.label) continue;
    for (const [field, assertion] of Object.entries(tool.input ?? {})) {
      const value = isRecord(call.input) ? call.input[field] : undefined;
      const result = checkAssertion(value, assertion as never);
      if (!result.ok) {
        return `call ${index + 1} (${call.label}) input.${field}: expected ${result.expected}, saw ${show(value)}`;
      }
    }
  }
  return undefined;
}

const NoParams = z.strictObject({});

const checkImpls: Record<string, CheckImpl> = {
  'builtin:checks/tools-count': (ctx) => {
    if (!appliesTools(ctx.expect)) return [];
    const expected = expectedTools(ctx.expect);
    const keys = entryKeys(expected.map((tool) => tool.label));
    return expected.map((tool, index) => countVerdict(keys[index] ?? tool.label, tool, ctx.calls.filter((c) => c.label === tool.label), ctx.calls));
  },
  'builtin:checks/tools-input-closed': (ctx) => {
    if (!appliesTools(ctx.expect)) return [];
    const expected = expectedTools(ctx.expect);
    const keys = entryKeys(expected.map((tool) => tool.label));
    return expected.flatMap((tool, index) =>
      tool.input_closed === true ? [closedInputVerdict(keys[index] ?? tool.label, tool, ctx.calls.filter((c) => c.label === tool.label))] : [],
    );
  },
  'builtin:checks/tools-order': (ctx) =>
    appliesTools(ctx.expect) && ctx.expect.tool_order !== undefined ? [orderVerdict(ctx.expect.tool_order, expectedTools(ctx.expect), ctx.calls)] : [],
  'builtin:checks/tools-argument-accuracy': (ctx, item) => {
    if (!appliesTools(ctx.expect) || ctx.inputs.length === 0) return [];
    const missed = ctx.inputs.filter((v) => v.outcome !== 'pass').map((v) => `${v.tool} input.${v.field}`);
    const total = ctx.inputs.length;
    const matched = total - missed.length;
    const note = missed.length > 0 ? `; missed: ${missed.join(', ')}` : '';
    return [
      machineVerdict(NAME, 'argument_accuracy', matched === total ? 'pass' : 'fail', `${matched} of ${plural(total, 'expected argument')} matched${note}`, {
        gating: (item.effect.gating as boolean | undefined) ?? false,
        score: matched / total,
      }) as Verdict,
    ];
  },
  'builtin:checks/forbidden-count0': (ctx) =>
    (ctx.expect.tools ?? [])
      .filter((tool) => isZero(tool.count as never))
      .map((tool) => {
        const own = ctx.calls.filter((call) => call.label === tool.label);
        // The stored oracle's id for this verdict: `<label>.count0`.
        return {
          id: `${tool.label}.count0`,
          kind: 'machine',
          name: 'forbidden',
          gating: true,
          outcome: own.length === 0 ? 'pass' : 'fail',
          evidence: `${tool.label} called ${times(own.length)}; expected 0`,
        } as Verdict;
      }),
};

const valueImpls: Record<string, ValueImpl> = { 'builtin:value-check/exact': exact };

export function implRegistry(): ImplRegistry {
  const registry: ImplRegistry = new Map();
  for (const [name, run] of Object.entries(checkImpls)) registry.set(name, { params: NoParams, run });
  for (const [name, run] of Object.entries(valueImpls)) registry.set(name, { params: ExactParams, run });
  registry.set('builtin:run-profile/model', { params: z.strictObject({ model: z.string().min(1) }) });
  return registry;
}

function stamp(verdict: Verdict, object: ResolvedObject, item: ResolvedItem): Verdict {
  return { ...verdict, by: { object: object.ref, item: item.id, impl: item.impl, layer: item.layer } };
}

/** Does a rung's `when` hold for an assertion? Only the empty condition and `compare` are read here. */
function rungApplies(item: ResolvedItem, assertion: unknown): boolean {
  const when = item.when;
  if (Object.keys(when).length === 0) return true;
  if ('compare' in when) {
    const compare = isRecord(assertion) ? assertion.compare : undefined;
    return compare === when.compare;
  }
  // Evidence the prototype does not compute (tool_replayable, contract) never holds.
  return false;
}

/** The input verdicts: one per tool and field, decided and stamped by the first value-check rung that settles. */
function inputVerdicts(expect: Expect, calls: Call[], policy: ResolvedObject): InputVerdict[] {
  if (!appliesTools(expect)) return [];
  const expected = expectedTools(expect);
  const keys = entryKeys(expected.map((tool) => tool.label));
  const out: InputVerdict[] = [];
  expected.forEach((tool, index) => {
    const key = keys[index] ?? tool.label;
    const own = calls.filter((call) => call.label === tool.label);
    for (const [field, assertion] of Object.entries(tool.input ?? {})) {
      const rung = policy.order
        .map((name) => policy.items.get(name) as ResolvedItem)
        .find((item) => item.enabled && rungApplies(item, assertion));
      const id = `${key}.input.${field}`;
      if (!rung) {
        out.push({ ...(machineVerdict(NAME, id, 'inconclusive', `no value-check rung settles input.${field}`) as Verdict), tool: tool.label, field });
        continue;
      }
      const impl = valueImpls[rung.impl] as ValueImpl;
      let verdict: Verdict;
      if (own.length === 0) {
        const { expected: wanted } = checkAssertion(undefined, assertion as never);
        verdict = machineVerdict(NAME, id, 'fail', `${tool.label} was not called, so input.${field} could not be ${wanted}`) as Verdict;
      } else {
        const failures: string[] = [];
        let wanted = '';
        let problem: string | undefined;
        own.forEach((call, i) => {
          const value = isRecord(call.input) ? call.input[field] : undefined;
          const result = impl(value, assertion, rung.params);
          wanted = result.expected;
          problem = result.problem ?? problem;
          if (!result.ok) failures.push(`call ${i + 1}${callId(call)}: input.${field} is ${show(value)}`);
        });
        if (problem) verdict = machineVerdict(NAME, id, 'fail', `input.${field} ${wanted}: ${problem}`) as Verdict;
        else if (failures.length > 0) verdict = machineVerdict(NAME, id, 'fail', `${tool.label} ${failures.join('; ')}; expected ${wanted}`) as Verdict;
        else verdict = machineVerdict(NAME, id, 'pass', `${tool.label} input.${field} is ${wanted} on ${plural(own.length, 'call')}`) as Verdict;
      }
      out.push({ ...stamp(verdict, policy, rung), tool: tool.label, field });
    }
  });
  return out;
}

export type Resolution = { checkSet: ResolvedObject; valueCheck: ResolvedObject };

export function resolveScoring(store: ObjectStore, uses: { check_set?: string; value_check?: string }): Resolution {
  return {
    checkSet: store.resolve('check-set', uses.check_set ?? 'default'),
    valueCheck: store.resolve('policy/value-check', uses.value_check ?? 'default'),
  };
}

/**
 * Scores one stored observation. Emission order follows today's tools check: counts, input_closed, the
 * input verdicts, order, argument accuracy; then the forbidden share.
 */
export function score(expect: Expect, calls: Call[], resolution: Resolution): Verdict[] {
  const { checkSet, valueCheck } = resolution;
  const inputs = inputVerdicts(expect, calls, valueCheck);
  const ctx: Ctx = { expect, calls, inputs };
  const out: Verdict[] = [];
  for (const name of checkSet.order) {
    const item = checkSet.items.get(name) as ResolvedItem;
    if (!item.enabled) continue;
    const impl = checkImpls[item.impl] as CheckImpl;
    for (const verdict of impl(ctx, item)) out.push(stamp(verdict, checkSet, item));
    if (name === 'tools.input_closed') out.push(...inputs.map(({ tool: _t, field: _f, ...v }) => v));
  }
  // Input verdicts are emitted even when the check-set leaves out input_closed: they belong to value-check.
  if (!checkSet.order.includes('tools.input_closed') || !checkSet.items.get('tools.input_closed')?.enabled) {
    out.push(...inputs.map(({ tool: _t, field: _f, ...v }) => v));
  }
  return out;
}

/** The stored oracle's shape: the ids of the failed gating verdicts. */
export function failedGating(verdicts: Verdict[]): string[] {
  return verdicts.filter((v) => v.gating !== false && v.outcome !== 'pass').map((v) => v.id);
}

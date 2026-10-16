import {
  type Assertion,
  type Check,
  type CheckContext,
  isZero,
  machineVerdict,
  rulesFor,
  type ToolCall,
  type ToolExpect,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { checkAssertion, describeSteps } from '../support/assert';
import { countAllows, describeCount, minimumOf } from '../support/count';
import { entryKeys, isRecord, listed, plural, show, times } from '../support/values';

const NAME = 'tools';

/**
 * The expected tool calls of a block. Per expected tool: the call count with Count semantics, and every
 * input assertion on every call of that tool. `tool_order` lines the expected tools up with the observed
 * calls (exact, in_order, any_order, the Google ADK trajectory match types). The argument accuracy, the
 * share of expected arguments that matched, is reported with a score and never gates.
 *
 * A tool expected 0 times belongs to the forbidden check, so its fact is never reported twice.
 */
export const tools: Check = {
  name: NAME,
  applies: (ctx) => expectedTools(ctx).length > 0 || ctx.expect.tool_order !== undefined,
  evaluate(ctx) {
    const expected = expectedTools(ctx);
    const keys = entryKeys(expected.map((tool) => tool.label));
    const calls = ctx.observed.toolCalls;
    const verdicts: Verdict[] = [];
    let argumentsExpected = 0;
    const missed: string[] = [];

    expected.forEach((tool, index) => {
      const key = keys[index] ?? tool.label;
      const own = calls.filter((call) => call.label === tool.label);
      verdicts.push(countVerdict(key, tool, own, calls));
      if (tool.input_closed === true) verdicts.push(closedInputVerdict(key, tool, own));
      for (const [field, assertion] of Object.entries(tool.input ?? {})) {
        argumentsExpected += 1;
        const verdict = inputVerdict(key, tool, field, own, assertion);
        if (verdict.outcome !== 'pass') missed.push(`${tool.label} input.${field}`);
        verdicts.push(verdict);
      }
    });

    if (ctx.expect.tool_order !== undefined) {
      verdicts.push(orderVerdict(ctx.expect.tool_order, expected, calls));
    }

    if (argumentsExpected > 0) {
      const matched = argumentsExpected - missed.length;
      const missedNote = missed.length > 0 ? `; missed: ${missed.join(', ')}` : '';
      verdicts.push(
        machineVerdict(
          NAME,
          'argument_accuracy',
          matched === argumentsExpected ? 'pass' : 'fail',
          `${matched} of ${plural(argumentsExpected, 'expected argument')} matched${missedNote}`,
          { gating: false, score: matched / argumentsExpected },
        ),
      );
    }
    return verdicts;
  },
};

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

/**
 * One argument on every call of its tool. With a `normalise` rule on the argument, the raw and the
 * normalised values both reach the evidence.
 */
function inputVerdict(
  key: string,
  tool: ToolExpect,
  field: string,
  own: ToolCall[],
  assertion: Assertion,
): Verdict {
  const label = tool.label;
  const id = `${key}.input.${field}`;
  const rules = rulesFor(tool.normalise, field);
  if (own.length === 0) {
    const { expected } = checkAssertion(undefined, assertion);
    return machineVerdict(
      NAME,
      id,
      'fail',
      `${label} was not called, so input.${field} could not be ${expected}`,
    );
  }
  const failures: string[] = [];
  const notes: string[] = [];
  let expected = '';
  let problem: string | undefined;
  own.forEach((call, index) => {
    const value = isRecord(call.input) ? call.input[field] : undefined;
    const result = checkAssertion(value, assertion, rules);
    expected = result.expected;
    problem = result.problem ?? problem;
    const note = describeSteps(result.steps);
    if (note !== '') notes.push(`call ${index + 1}${note}`);
    if (!result.ok) failures.push(`call ${index + 1}${callId(call)}: input.${field} is ${show(value)}`);
  });
  const normalised = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  if (problem) return machineVerdict(NAME, id, 'fail', `input.${field} ${expected}: ${problem}`);
  if (failures.length > 0) {
    return machineVerdict(
      NAME,
      id,
      'fail',
      `${label} ${failures.join('; ')}; expected ${expected}${normalised}`,
    );
  }
  const values = own.map((call) => show(isRecord(call.input) ? call.input[field] : undefined));
  return machineVerdict(
    NAME,
    id,
    'pass',
    `${label} input.${field} is ${expected} on ${plural(own.length, 'call')}: ${[...new Set(values)].join(', ')}${normalised}`,
  );
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
      const result = checkAssertion(value, assertion, rulesFor(tool.normalise, field));
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

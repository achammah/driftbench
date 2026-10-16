import {
  type Check,
  machineVerdict,
  rulesFor,
  type ToolExpect,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { checkAssertion } from '../support/assert';
import { isRecord } from '../support/values';

/**
 * `expect.tool_f1`: the tool calls of the block against the expected ones, as one set-level score. Each
 * expected tool counts as many times as its count says (a range counts its minimum, none counts once, and
 * a count of 0 is not expected at all). An expected call matches a call with the same label whose input
 * satisfies each argument assertion of that expectation; each call matches at most one expectation, in the
 * order the spec lists them. Precision is matched calls over calls made, recall is matched calls over calls
 * expected, and F1 is their harmonic mean. The verdict passes at `min` or above and names the unmatched
 * calls and expectations.
 */
type Expected = { label: string; input?: ToolExpect['input']; normalise?: ToolExpect['normalise'] };

function expand(tools: ToolExpect[]): Expected[] {
  return tools.flatMap((tool) => {
    const count = tool.count;
    const times = count === undefined ? 1 : typeof count === 'number' ? count : (count.min ?? 1);
    return Array.from({ length: times }, () => ({
      label: tool.label,
      input: tool.input,
      normalise: tool.normalise,
    }));
  });
}

function argumentsMatch(input: unknown, want: Expected): boolean {
  if (!want.input) return true;
  return Object.entries(want.input).every(([field, assertion]) => {
    const value = isRecord(input) ? input[field] : undefined;
    return checkAssertion(value, assertion, rulesFor(want.normalise, field)).ok;
  });
}

export const toolF1: Check = {
  name: 'tool_f1',
  applies: (ctx) => ctx.expect.tool_f1 !== undefined,
  evaluate(ctx) {
    const declared = ctx.expect.tool_f1;
    if (!declared) return [];
    const expected = expand((ctx.expect.tools ?? []).filter((tool) => tool.count !== 0));
    const calls = ctx.observed.toolCalls;
    const used = calls.map(() => false);
    const missed: string[] = [];
    let matched = 0;
    for (const want of expected) {
      const at = calls.findIndex(
        (call, index) => !used[index] && call.label === want.label && argumentsMatch(call.input, want),
      );
      if (at >= 0) {
        used[at] = true;
        matched += 1;
      } else {
        missed.push(want.label);
      }
    }
    const unexpected = calls.filter((_, index) => !used[index]).map((call) => call.label);
    const precision = calls.length === 0 ? (expected.length === 0 ? 1 : 0) : matched / calls.length;
    const recall = expected.length === 0 ? (calls.length === 0 ? 1 : 0) : matched / expected.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const parts = [
      `precision ${precision.toFixed(2)} (${matched} of ${calls.length} calls)`,
      `recall ${recall.toFixed(2)} (${matched} of ${expected.length} expected)`,
      `F1 ${f1.toFixed(2)}`,
      `minimum ${declared.min.toFixed(2)}`,
    ];
    if (unexpected.length > 0) parts.push(`unexpected: ${unexpected.join(', ')}`);
    if (missed.length > 0) parts.push(`missed: ${missed.join(', ')}`);
    const pass = f1 >= declared.min;
    const verdict: Verdict = machineVerdict('tool_f1', 'f1', pass ? 'pass' : 'fail', parts.join(', '));
    return [verdict];
  },
};

import { describe, expect, it } from 'vitest';
import { evidence } from '../../src';
import type { Observed, Verdict } from '../../src/schema/run';

const verdict: Verdict = {
  id: 'tools.fetch.count',
  name: 'tools',
  kind: 'machine',
  gating: true,
  outcome: 'fail',
  evidence: '',
};
function input(observed: Partial<Observed> = {}): evidence.EvidenceInput {
  return {
    verdict,
    block: {
      verdicts: [verdict],
      observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, ...observed },
    },
  };
}

describe('process exit codes and HTTP statuses have distinct meanings', () => {
  it.each(['exitCode', 'exit_code', 'returncode', 'returnCode'])('%s is a process exit', (field) => {
    for (const code of [1, 200, -1]) expect(evidence.outputFailed({ [field]: code })).toBe(true);
    expect(evidence.outputFailed({ [field]: 0 })).toBe(false);
  });
  it.each(['status', 'statusCode', 'status_code', 'httpStatus'])('%s is an HTTP status', (field) => {
    for (const status of [200, 204, 301, 399]) expect(evidence.outputFailed({ [field]: status })).toBe(false);
    for (const status of [400, 404, 500]) expect(evidence.outputFailed({ [field]: status })).toBe(true);
  });
  it('does not guess the meaning of a bare code; explicit errors still fail', () => {
    expect(evidence.outputFailed({ code: 200 })).toBe(false);
    expect(evidence.outputFailed({ code: 42 })).toBe(false);
    expect(evidence.outputFailed({ code: 200, is_error: true })).toBe(true);
    expect(evidence.outputFailed({ isError: true })).toBe(true);
    expect(evidence.outputFailed({ exitCode: 0, status: 500 })).toBe(true);
    expect(evidence.outputFailed({ exitCode: 1, status: 200 })).toBe(true);
  });
  it('does not diagnose an HTTP success as tool_failed', () => {
    const given = input({ toolCalls: [{ label: 'fetch', input: {}, output: { code: 200, status: 200 } }] });
    expect(evidence.computeEvidence(given, ['tool_failed']).tool_failed).toBe(false);
    given.block.observed.toolCalls[0]!.output = { status: 404 };
    expect(evidence.computeEvidence(given, ['tool_failed']).tool_failed).toBe(true);
  });
});

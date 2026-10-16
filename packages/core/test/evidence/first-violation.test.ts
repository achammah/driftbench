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

describe('first violation counts only failing gating verdicts', () => {
  it('skips not_applicable, inconclusive, passing and non-gating verdicts before a failure', () => {
    const given = input();
    given.block.verdicts = [
      ...(['not_applicable', 'inconclusive', 'pass'] as const).map((outcome) => ({
        ...verdict,
        id: outcome,
        outcome,
      })),
      { ...verdict, id: 'lint', gating: false },
      verdict,
    ];
    expect(evidence.computeEvidence(given, ['first_violation']).first_violation).toBe(verdict.id);
  });
  it('has no first violation when no gating verdict failed', () => {
    const given = input();
    given.block.verdicts = [{ ...verdict, outcome: 'not_applicable' }];
    expect(evidence.computeEvidence(given, ['first_violation']).first_violation).toBeUndefined();
  });
});

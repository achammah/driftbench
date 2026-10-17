import { describe, expect, it } from 'vitest';
import type { BlockResult, Spec } from '../../src/index';
import { recoveryOf } from '../../src/runner';

/**
 * Blast-radius audit (PR 428): the recovery's collateral counts the blocks after the recovery that failed. A
 * block not run or blocked after it was never measured, so it is no collateral damage.
 */
const spec = {
  id: 'recovering',
  kind: 'conversation',
  blocks: [{ when: { user: 'a' } }, { when: { user: 'b' } }, { when: { user: 'c' } }],
  perturbations: [
    { id: 'p', class: 'D1_topic_shift', inject_at: 1, user: 'off topic', recovery: { within_blocks: 0 } },
  ],
} as unknown as Spec;

function block(index: number, kind: 'pass' | 'fail' | 'not_run' | 'blocked', injected = false): BlockResult {
  return {
    index,
    ...(injected ? { injected: true, blockId: 'p' } : {}),
    givenHash: `g${index}`,
    observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts: [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: kind === 'pass',
    ...(kind === 'not_run'
      ? {
          status: 'not_run' as const,
          notRun: {
            kind: 'unsupported' as const,
            layer: '1 history',
            check: 'capability',
            expected: 'e',
            got: 'g',
          },
        }
      : {}),
    ...(kind === 'blocked'
      ? { status: 'blocked' as const, blocked: { by: 'block 2', root: 'block 2' } }
      : {}),
  };
}

describe('blast radius: recovery collateral and blocks not run', () => {
  it('a recovery followed by a block not run and a blocked one has no collateral', () => {
    const blocks = [block(0, 'pass'), block(1, 'pass', true), block(2, 'not_run'), block(3, 'blocked')];
    const recovery = recoveryOf(spec, { blocks, perturbationId: 'p' });
    expect(recovery?.label).toBe('immediate');
    expect(recovery?.collateral).toBe(0);
  });

  it('a recovery followed by a failed block still counts it', () => {
    const blocks = [block(0, 'pass'), block(1, 'pass', true), block(2, 'fail'), block(3, 'not_run')];
    expect(recoveryOf(spec, { blocks, perturbationId: 'p' })?.collateral).toBe(1);
  });
});

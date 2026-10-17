// Blast radius of unit F2 on the vitest plugin: the failure message of a block names its failing gating
// verdicts and their evidence, whether the record carries `by`, `resolved` and `diagnoses` or not.
import type { BlockResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blockFailure } from '../src/index';

const old: BlockResult = {
  index: 1,
  blockId: 'b1',
  givenHash: 'g1',
  observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
  verdicts: [
    {
      id: 'must.0',
      kind: 'machine',
      name: 'must',
      gating: true,
      outcome: 'fail',
      evidence: 'no "plan" in the reply',
    },
    { id: 'pii.email', kind: 'machine', name: 'pii', gating: false, outcome: 'fail', evidence: 'an email' },
    { id: 'tools.count', kind: 'machine', name: 'tools', gating: true, outcome: 'pass', evidence: 'ok' },
  ],
  ledgerCheck: { ok: true, contradictions: [] },
  drift: ['X1_local'],
  pass: false,
};

const stamped: BlockResult = {
  ...old,
  verdicts: old.verdicts.map((verdict) => ({
    ...verdict,
    by: {
      object: 'check-set:house@0123abcd',
      item: verdict.name,
      impl: `builtin:check/${verdict.name}`,
      layer: 'project',
    },
  })),
  resolved: {
    objects: [{ key: 'check_set', kind: 'check-set', id: 'house', hash: 'feedc0de', setAt: 'project' }],
    hash: 'a1b2c3d4',
  },
  diagnoses: [
    {
      diagnostic: 'diagnostic:probe@89abcdef',
      summary: 'MARKER-DIAGNOSIS',
      by: { object: 'diagnostic:probe@89abcdef', impl: 'builtin:probe', layer: 'shipped' },
    },
  ],
  skippedForBudget: 1,
};

describe('blast stamps: the vitest plugin failure message', () => {
  it('is the same for a stamped block as for the old record', () => {
    const message = blockFailure(stamped);
    expect(message).toBe(blockFailure(old));
    expect(message).toBe('block 1 (b1) failed\n  must.0 fail: no "plan" in the reply');
    expect(message).not.toContain('MARKER-DIAGNOSIS');
  });
});

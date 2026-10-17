import type { Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { completionApplies, completionContract } from '../../src/ladders/estate/completion-contract';
import type { EstateRun, GeneratedSpec } from '../../src/ladders/estate/pipeline';

/** A hand-written run of an invented harbour estate: one guard, its negative control, nothing else. */
function runOf(verdict: string, evidence: unknown[] = []): { run: EstateRun; source: GeneratedSpec } {
  const guard = {
    id: 'guard.settings.berth-check',
    kind: 'guard',
    fields: { name: 'berth-check.sh' },
    evidence,
  };
  const spec = {
    id: 'estate.guard_negative.berth-check',
    blocks: [{ id: 'ask', when: { user: 'Moor the Aster.' }, expect: {} }],
  } as unknown as Spec;
  const run = {
    plan: { plan: { rows: [{ id: 'guard_negative.berth-check', atomIds: [guard.id] }] } },
    scanned: { map: { atoms: [guard] } },
    estate: { guards: [{ name: 'berth-check.sh', verdict }] },
    situations: [],
  } as unknown as EstateRun;
  const source = {
    record: { row: 'guard_negative.berth-check', testType: 'guard_negative' },
    loaded: { spec },
  } as unknown as GeneratedSpec;
  return { run, source };
}

describe('the negative control of a guard that answers without stopping', () => {
  it.each(['warn', 'nudge'])('%s: the contract applies and forbids that verdict', (verdict) => {
    const { run, source } = runOf(verdict);
    expect(completionApplies(run, source)).toBe(true);
    const contract = completionContract(run, source);
    expect(contract.blocks[0]?.expect?.guards).toEqual([{ name: 'berth-check.sh', verdict, count: 0 }]);
  });

  it.each(['deny', 'block', 'allow'])(
    '%s: no extra contract (the guard stops the act, or says nothing)',
    (verdict) => {
      const { run, source } = runOf(verdict);
      expect(completionApplies(run, source)).toBe(false);
      expect(completionContract(run, source).blocks[0]?.expect?.guards).toBeUndefined();
    },
  );

  it.each(['warn', 'nudge'])(
    "%s: a declaration that names another verdict cannot hide the guard's own verdict",
    (verdict) => {
      const { run, source } = runOf(verdict, [{ type: 'guard', verdict: 'deny' }]);
      const guards = completionContract(run, source).blocks[0]?.expect?.guards ?? [];
      expect(guards.map((g) => g.verdict).sort()).toEqual(['deny', verdict].sort());
      expect(guards.every((g) => g.name === 'berth-check.sh' && g.count === 0)).toBe(true);
    },
  );

  it.each(['warn', 'nudge'])('%s: a declaration with no verdict forbids every acting verdict', (verdict) => {
    const { run, source } = runOf(verdict, [{ type: 'guard' }]);
    const guards = completionContract(run, source).blocks[0]?.expect?.guards ?? [];
    expect(guards.map((g) => g.verdict).sort()).toEqual(['block', 'deny', 'nudge', 'warn']);
  });
});

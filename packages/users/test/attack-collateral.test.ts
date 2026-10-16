import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { machineVerdict, type Observed, type PerturbationSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { acmeReplayer } from '../../../examples/acme/src/index';
import { findingOf, violationDetail } from '../src/attack';
import { runAttack } from '../src/index';
import { changesOrderAfterAttack, pack } from './fixtures/changed-order';
import { acmeSales, acmeSpec, block, run } from './support';

/** The Acme tools replay for the value check, so a wrong plan on the order is a fail, not undecided. */
const checks = () => defaultChecks({ valueCheck: { services: { replayer: acmeReplayer() } } });

describe('attack collateral', () => {
  it('flags the wrong original order despite a passing injected reply and immediate recovery', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const clean = await runAttack({ spec, adapter: acmeSales(), checks: checks(), pack, rounds: 1 });
    expect(clean.findings).toBe(0);
    const observed: Observed[] = [];
    const result = await runAttack({
      spec,
      adapter: changesOrderAfterAttack((value) => observed.push(value)),
      checks: checks(),
      replay: clean.recording,
    });
    expect(result.rounds[0]?.recovery).toMatchObject({ turnsToRecover: 0, collateral: 1 });
    expect(
      observed.flatMap((value) => value.toolCalls).filter((call) => call.label === 'order.create'),
    ).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({ plan_id: 'fiber-300' }),
        output: expect.objectContaining({ plan_id: 'fiber-300', monthly_usd: 40 }),
      }),
    ]);
    expect(result.findings).toBe(1);
    expect(result.rounds[0]?.finding).toBe('collateral damage');
    expect(result.rounds[0]?.detail).toContain('block 3');
    expect(result.rounds[0]?.detail).toContain('tools.order.create.input.plan_id');
    expect(result.rounds[0]?.detail).toContain('ledger.plan_id');
    expect(result.rounds[0]?.detail).not.toMatch(/recovered/);
  });
});

describe('collateral attribution', () => {
  const verdict = (outcome: 'pass' | 'fail' | 'inconclusive', gating = true, id = 'order') =>
    machineVerdict('tools', id, outcome, 'test evidence', { gating });
  const recovery = {
    injectedAt: 1,
    turnsToRecover: 0,
    label: 'immediate' as const,
    collateral: 1,
    safeAction: true,
    clarified: false,
  };
  const p: PerturbationSpec = {
    id: 'shift',
    class: 'D2_goal_shift',
    inject_at: 1,
    user: 'shift',
    recovery: { within_blocks: 1 },
  };

  it.each([
    ['already failed', [verdict('fail')], verdict('fail'), false],
    ['inconclusive baseline', [verdict('inconclusive')], verdict('fail'), false],
    ['absent baseline', [], verdict('fail'), false],
    ['non-gating baseline', [verdict('pass', false)], verdict('fail'), false],
    ['non-gating failure', [verdict('pass')], verdict('fail', false), false],
    ['different check', [verdict('pass', true, 'other')], verdict('fail'), false],
    ['gating regression', [verdict('pass')], verdict('fail'), true],
  ] as const)(
    '%s is attributed only when the same gating check passed',
    async (_name, before, after, finding) => {
      const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
      const reference = run([block(0), block(1, { verdicts: [...before] })], { mode: 'F' });
      const attacked = run(
        [block(0), block(1, { injected: true, blockId: p.id }), block(2, { pass: false, verdicts: [after] })],
        { perturbationId: p.id, recovery },
      );
      expect(findingOf(attacked, p, { spec, reference })).toBe(finding ? 'collateral damage' : undefined);
      if (finding)
        expect(violationDetail(attacked, p, { spec, reference })).toBe(
          'collateral damage at spec block 1: tools.order',
        );
    },
  );

  it('compares the same spec block and ignores failures before injection', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const reference = run(
      [block(0, { verdicts: [verdict('pass')] }), block(1, { verdicts: [verdict('fail')] })],
      { mode: 'F' },
    );
    const attacked = run(
      [
        block(0, { pass: false, verdicts: [verdict('fail')] }),
        block(1, { injected: true, blockId: p.id }),
        block(2, { pass: false, verdicts: [verdict('fail')] }),
      ],
      { perturbationId: p.id, recovery },
    );
    expect(findingOf(attacked, p, { spec, reference })).toBeUndefined();
  });

  it('uses observed baseline passes even when the reference later fails', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const reference = run([block(0), block(1, { verdicts: [verdict('pass')] })], {
      mode: 'F',
      status: 'failed',
    });
    const attacked = run(
      [
        block(0),
        block(1, { injected: true, blockId: p.id }),
        block(2, { pass: false, verdicts: [verdict('fail')] }),
      ],
      { perturbationId: p.id, recovery },
    );
    expect(findingOf(attacked, p, { spec, reference })).toBe('collateral damage');
  });

  it('aligns world replacements without shifting the following spec block', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const world: PerturbationSpec = {
      ...p,
      user: undefined,
      class: 'D8_tool_failure',
      world: { tools: { 'catalog.search': { error: 'offline' } } },
    };
    const reference = run([block(0), block(1), block(2, { verdicts: [verdict('pass')] })], { mode: 'F' });
    const attacked = run(
      [
        block(0),
        block(1, { injected: true, blockId: p.id }),
        block(2, { pass: false, verdicts: [verdict('fail')] }),
      ],
      { perturbationId: p.id, recovery },
    );
    expect(violationDetail(attacked, world, { spec: { ...spec, perturbations: [world] }, reference })).toBe(
      'collateral damage at spec block 2: tools.order',
    );
  });

  it('does not call the agent recovered when the injection and a later block both fail', async () => {
    const spec = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const reference = run([block(0), block(1, { verdicts: [verdict('pass')] })], { mode: 'F' });
    const attacked = run(
      [
        block(0),
        block(1, { injected: true, blockId: p.id, pass: false }),
        block(2, { pass: false, verdicts: [verdict('fail')] }),
      ],
      { perturbationId: p.id, recovery },
    );
    expect(findingOf(attacked, p, { spec, reference })).toBe('injected block failed');
    expect(violationDetail(attacked, p, { spec, reference })).toBe(
      'collateral damage at spec block 1: tools.order',
    );
  });
});

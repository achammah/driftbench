import { describe, expect, it, vi } from 'vitest';
import { blame } from '../../src';
import { f7, verdict } from '../fixtures/blame/cases';

const run: blame.PlannedRun = {
  block: 'b1',
  verdict_ref: 'must.short',
  item: 'R2b',
  kind: 'hint',
  runs: 3,
  why: 'test',
};

describe('PR 451: confirmation cost is known before execution', () => {
  it('does not call a runner whose quote exceeds a positive budget', async () => {
    const runner = vi.fn(() => ({ passes: 3, costUsd: 5 }));
    const result = await blame.runConfirm([run], { budgetUsd: 0.01, runner, quote: () => 5 });
    expect(runner).not.toHaveBeenCalled();
    expect(result).toMatchObject({ runs_made: 0, cost_usd: 0, skipped_for_budget: 3 });
  });

  it('checks each quote against the remaining budget before the second call', async () => {
    const runner = vi.fn(() => ({ passes: 3, costUsd: 0.02 }));
    const result = await blame.runConfirm([run, { ...run, kind: 'reference' }], {
      budgetUsd: 0.03,
      runner,
      quote: () => 0.02,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ runs_made: 3, cost_usd: 0.02, skipped_for_budget: 3 });
    expect(result.stored['b1 must.short']).toEqual({ runs: 3, hint_pass: 3 });
  });

  it('admits an exact-fit quote and gives the runner its binding cap', async () => {
    const runner = vi.fn(() => ({ passes: 3, costUsd: 0.01 }));
    const result = await blame.runConfirm([run], { budgetUsd: 0.01, runner, quote: () => 0.01 });
    expect(runner).toHaveBeenCalledWith(run, { maxCostUsd: 0.01 });
    expect(result).toMatchObject({ runs_made: 3, cost_usd: 0.01, skipped_for_budget: 0 });
  });

  it('makes no billed call without a quote', async () => {
    const runner = vi.fn(() => ({ passes: 3, costUsd: 5 }));
    const result = await blame.runConfirm([run], { budgetUsd: 0.01, runner });
    expect(runner).not.toHaveBeenCalled();
    expect(result.cost_usd).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects the invalid quote %s before calling',
    async (quote) => {
      const runner = vi.fn(() => ({ passes: 3, costUsd: 0 }));
      await blame.runConfirm([run], { budgetUsd: 1, runner, quote: () => quote });
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it('flags a runner that violates its binding cap instead of reporting budget compliance', async () => {
    await expect(
      blame.runConfirm([run], {
        budgetUsd: 0.01,
        quote: () => 0.01,
        runner: () => ({ passes: 3, costUsd: 5 }),
      }),
    ).rejects.toThrow(/exceeded its quoted cost cap/);
  });

  it('retains free stand-ins without a quote at zero budget', async () => {
    const runner = vi.fn(() => ({ passes: 3, costUsd: 0 }));
    const result = await blame.runConfirm([run], { budgetUsd: 0, runner, free: true });
    expect(runner).toHaveBeenCalledWith(run, { maxCostUsd: 0 });
    expect(result).toMatchObject({ runs_made: 3, cost_usd: 0, skipped_for_budget: 0 });
  });
});

function findings(): blame.CampaignDiagnosis[] {
  const one = f7(1);
  const diagnosis = blame.diagnoseBlock({
    verdicts: one.verdicts,
    evidenceFor: one.input,
    blame: blame.shippedPolicy('policy/blame'),
    placement: blame.shippedPolicy('policy/placement'),
  }).diagnoses[0];
  if (!diagnosis) throw new Error('fixture must have a diagnosis');
  return ['invoice', 'supplier'].flatMap((home) =>
    [0, 1].map((finding) => ({
      ...diagnosis,
      home: `skill:${home}`,
      block: `${home}-run-1`,
      verdict_ref: `must.${finding}`,
      fix_target: `skill:${home}#SKILL.md:10`,
    })),
  );
}

describe('PR 451: recurrence counts distinct runs per home', () => {
  it('does not promote two verdicts from one run per home', () => {
    const plan = blame.fixPlan(findings(), blame.shippedPolicy('policy/placement'));
    expect(plan.moved).toBe(0);
    expect(plan.fixes.every((fix) => fix.fix_location === 'skill.layout')).toBe(true);
  });

  it('does promote when each home has two distinct run identities', () => {
    const distinct = findings().map((one, index) => ({ ...one, block: `${one.block}-${index}` }));
    const plan = blame.fixPlan(distinct, blame.shippedPolicy('policy/placement'));
    expect(plan.fixes[0]?.fix_location).toBe('agent.skill_reading');
    expect(plan.fixes[0]?.blocks).toBe(4);
  });
});

describe('PR 451: a disabled attribution step stays disabled', () => {
  async function diagnose(attribute: boolean) {
    const one = f7(1);
    const v = verdict('must.short-delivery');
    const input = one.input(v);
    const earlier: blame.StepOutput[] = [];
    const ctx = {
      check: {
        observed: input.block.observed,
        expect: input.expect,
        spec: { metadata: {} },
        block: { when: { user: 'Read the invoice and give a short answer.' } },
      },
      verdicts: [v],
      objects: [],
      earlier,
    } as unknown as Omit<blame.BlockStepContext, 'params'>;
    for (const impl of [
      'builtin:blame/chain',
      'builtin:blame/evidence',
      ...(attribute ? ['builtin:blame/attribute'] : []),
      'builtin:placement/apply',
    ]) {
      const step = blame.BLOCK_STEPS[impl];
      if (!step) throw new Error(impl);
      const out = await step.run({ ...ctx, params: { emit: impl === 'builtin:placement/apply' } });
      earlier.push(...(out ?? []));
    }
    return earlier;
  }

  it('does not attribute at placement emit when attribution did not run', async () => {
    expect(await diagnose(false)).toEqual([]);
  });

  it('still attributes at placement emit when the attribution stage ran', async () => {
    const result = await diagnose(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toMatch(/^policy\/blame:/);
  });
});

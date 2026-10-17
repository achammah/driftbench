import { describe, expect, it } from 'vitest';
import { planV2, renderPlanV2 } from '../../src/plan-v2';
import { makeStore, type VariableSpec } from './helpers';

describe('the traffic weight of a row', () => {
  it('is the sum of the logarithms of the shares of its values', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 60 },
          { id: 'flood', weight: 15 },
          { id: 'slack', weight: 25 },
        ],
      },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store);
    const share = { ebb: 0.6, flood: 0.15, slack: 0.25 } as const;
    for (const row of plan.rows)
      expect(row.logWeight).toBeCloseTo(
        Math.log(share[row.values.tide as keyof typeof share]) + Math.log(0.5),
        12,
      );
  });

  it('reads weights as relative: 0.6, 0.15, 0.25 and 60, 15, 25 give the same plan', () => {
    const make = (scale: number) =>
      makeStore([
        {
          id: 'tide',
          values: [
            { id: 'ebb', weight: 0.6 * scale },
            { id: 'flood', weight: 0.15 * scale },
            { id: 'slack', weight: 0.25 * scale },
          ],
        },
        { id: 'lamp', values: ['steady', 'flashing'] },
      ]);
    expect(renderPlanV2(planV2(make(1)))).toBe(renderPlanV2(planV2(make(100))));
  });

  it('weighs every value of a variable alike when it has no weights', () => {
    const plan = planV2(makeStore([{ id: 'tide', values: ['ebb', 'flood', 'slack', 'neap'] }]));
    for (const row of plan.rows) expect(row.logWeight).toBeCloseTo(Math.log(0.25), 12);
  });

  it('takes the shares among the approved values only', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 1 },
          { id: 'slack', weight: 8, approved: false },
        ],
      },
    ]);
    for (const row of planV2(store).rows) expect(row.logWeight).toBeCloseTo(Math.log(0.5), 12);
  });

  it('makes a row with a value of weight zero the rarest of all', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 0 },
          { id: 'slack', weight: 1 },
        ],
      },
    ]);
    const plan = planV2(store);
    expect(plan.rows.at(-1)).toMatchObject({
      values: { tide: 'flood' },
      logWeight: Number.NEGATIVE_INFINITY,
    });
    expect(JSON.parse(renderPlanV2(plan)).rows.at(-1).logWeight).toBeNull();
  });

  it('orders rows whose linear weight has underflowed to zero, because it adds logarithms', () => {
    // 200 variables; a value of share 0.97, 0.02 or 0.01 in each. The all-0.02 row weighs 1e-340, the all-0.01 row
    // 1e-400: both are 0 as a product of doubles, and different as sums of logarithms.
    const variables: VariableSpec[] = Array.from({ length: 200 }, (_, at) => ({
      id: `v${at}`,
      values: [
        { id: `v${at}_common`, weight: 97 },
        { id: `v${at}_rare`, weight: 2 },
        { id: `v${at}_rarer`, weight: 1 },
      ],
    }));
    const plan = planV2(makeStore(variables));
    const logs = plan.rows.map((row) => row.logWeight);
    expect(plan.rows).toHaveLength(3);
    expect(logs[0]).toBeCloseTo(200 * Math.log(0.97), 9);
    expect(logs[1]).toBeCloseTo(200 * Math.log(0.02), 9);
    expect(logs[2]).toBeCloseTo(200 * Math.log(0.01), 9);
    expect(logs[1]).toBeGreaterThan(logs[2] as number);
    expect(Math.exp(logs[1] as number)).toBe(0);
    expect(Math.exp(logs[2] as number)).toBe(0);
    expect(plan.rows.map((row) => row.values.v0)).toEqual(['v0_common', 'v0_rare', 'v0_rarer']);
  });

  it('weighs a seed row by the values it names and ignores the rest', () => {
    const store = makeStore([
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 1 },
          { id: 'flood', weight: 3 },
        ],
      },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store, { seeds: [{ id: 'half', values: { tide: 'flood' } }] });
    expect(plan.rows[0]?.logWeight).toBeCloseTo(Math.log(0.75), 12);
  });
});

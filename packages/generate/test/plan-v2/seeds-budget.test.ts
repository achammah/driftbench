import { describe, expect, it } from 'vitest';
import { type PlanSeedRow, type PlanV2Row, planV2 } from '../../src/plan-v2';
import { holds, makeStore } from './helpers';

/** A weighted harbour: a rule over tide and vessel, a free lamp. Tide: ebb 0.5, flood 0.3, slack 0.2. */
const harbour = () =>
  makeStore([
    {
      id: 'tide',
      values: [
        { id: 'ebb', weight: 5, when: { vessel: ['ferry'] } },
        { id: 'flood', weight: 3 },
        { id: 'slack', weight: 2 },
      ],
    },
    {
      id: 'vessel',
      values: [
        { id: 'ferry', weight: 6 },
        { id: 'trawler', weight: 3 },
        { id: 'yacht', weight: 1 },
      ],
    },
    { id: 'lamp', values: ['steady', 'flashing'] },
  ]);

const planned = (rows: readonly PlanV2Row[]) => rows.filter((row) => row.source === 'planned');
const seedsOf = (rows: readonly PlanV2Row[]) => rows.filter((row) => row.source === 'seed');
const nonIncreasing = (rows: readonly PlanV2Row[]) =>
  rows.every((row, at) => at === 0 || (rows[at - 1] as PlanV2Row).logWeight >= row.logWeight - 1e-9);

describe('real sessions enter as seed rows', () => {
  const seeds: PlanSeedRow[] = [
    { id: 'monday', values: { tide: 'slack', vessel: 'yacht', lamp: 'flashing' } },
    { id: 'tuesday', values: { tide: 'ebb', vessel: 'ferry' } },
  ];

  it('lists the seeds first, in the order given, with their own values', () => {
    const plan = planV2(harbour(), { seeds });
    expect(plan.rows.slice(0, 2).map((row) => [row.id, row.source, row.values])).toEqual([
      ['seed.monday', 'seed', { tide: 'slack', vessel: 'yacht', lamp: 'flashing' }],
      ['seed.tuesday', 'seed', { tide: 'ebb', vessel: 'ferry' }],
    ]);
    expect(planned(plan.rows).length).toBe(plan.rows.length - 2);
  });

  it('keeps every seed under any budget, even a budget of zero or below the number of seeds', () => {
    for (const budget of [0, 1, 2, 3, 10, 1000]) {
      const plan = planV2(harbour(), { seeds, budget });
      expect(
        seedsOf(plan.rows).map((row) => row.id),
        `budget ${budget}`,
      ).toEqual(['seed.monday', 'seed.tuesday']);
      expect(planned(plan.rows).length, `budget ${budget}`).toBeLessThanOrEqual(Math.max(0, budget - 2));
    }
  });

  it('counts the seeds in the budget: the planned rows fill what is left', () => {
    const full = planV2(harbour(), { seeds });
    const budget = 2 + 4;
    expect(full.generated).toBeGreaterThan(4);
    const plan = planV2(harbour(), { seeds, budget });
    expect(plan.rows).toHaveLength(budget);
    expect(plan.cut).toBe(full.generated - 4);
  });

  it('counts the tuples a seed holds as covered: eight of nine pairs seeded leaves one row to plan', () => {
    const store = harbour();
    const tides = ['ebb', 'flood', 'slack'];
    const vessels = ['ferry', 'trawler', 'yacht'];
    const pairs = tides.flatMap((tide) => vessels.map((vessel) => ({ tide, vessel })));
    // Eight sessions hold eight of the nine pairs and both lamps; the pair (slack, yacht) is the one left.
    const sessions = pairs
      .filter((pair) => !(pair.tide === 'slack' && pair.vessel === 'yacht'))
      .map((pair, at) => ({
        id: `real${at}`,
        values: { ...pair, lamp: at % 2 === 0 ? 'steady' : 'flashing' },
      }));
    const plan = planV2(store, { seeds: sessions });
    expect(plan.generated).toBe(1);
    expect(planned(plan.rows)[0]?.values).toMatchObject({ tide: 'slack', vessel: 'yacht' });
    expect(planV2(store).generated).toBeGreaterThanOrEqual(9);
  });

  it('plans no row when the seeds already cover every target', () => {
    const store = harbour();
    const alone = planV2(store);
    const every = alone.rows.map((row) => ({ id: row.id, values: row.values }));
    const plan = planV2(store, { seeds: every });
    expect(plan.generated).toBe(0);
    expect(plan.rows.every((row) => row.source === 'seed')).toBe(true);
    expect(plan.layers.map((layer) => layer.uncovered)).toEqual([0, 0, 0]);
  });

  it('counts a partial seed only for the tuples all of whose variables it assigns', () => {
    const store = harbour();
    const plan = planV2(store, { seeds: [{ id: 'half', values: { tide: 'ebb' } }] });
    // The seed holds the value ebb but no pair of the rule, so the pair (ebb, ferry) is still planned.
    expect(planned(plan.rows).some((row) => holds(row.values, { tide: 'ebb', vessel: 'ferry' }))).toBe(true);
  });

  it('keeps a seed that names a value the store does not have, and says so', () => {
    const plan = planV2(harbour(), {
      seeds: [{ id: 'odd', values: { tide: 'ebb', vessel: 'ferry', moon: 'full', lamp: 'blue' } }],
    });
    expect(plan.rows[0]).toMatchObject({ id: 'seed.odd', source: 'seed' });
    expect(plan.rows[0]?.values).toEqual({ tide: 'ebb', vessel: 'ferry' });
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ code: 'seed_unknown_value', seed: 'odd', variable: 'moon', value: 'full' }),
    );
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ code: 'seed_unknown_value', seed: 'odd', variable: 'lamp', value: 'blue' }),
    );
  });

  it('keeps every seed when nothing in the store is approved, at every budget, and says why', () => {
    const store = makeStore([{ id: 'channel', approved: false, values: ['mail'] }]);
    for (const budget of [0, 1, undefined]) {
      const plan = planV2(store, { budget, seeds: [{ id: 'original', values: { channel: 'mail' } }] });
      expect(
        plan.rows.map((row) => row.id),
        `budget ${budget}`,
      ).toEqual(['seed.original']);
      expect(plan.rows[0]).toMatchObject({ source: 'seed', values: { channel: 'mail' } });
      expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'no_variables' }));
      expect(plan.warnings).toContainEqual(
        expect.objectContaining({
          code: 'seed_unapproved_value',
          seed: 'original',
          variable: 'channel',
          value: 'mail',
        }),
      );
    }
  });

  it('keeps the entries of a seed that name a value nobody approved, reports each one, and counts only the rest', () => {
    const store = makeStore([
      { id: 'tide', values: ['ebb', 'flood', { id: 'slack', approved: false }] },
      { id: 'lamp', values: ['steady', 'flashing'] },
      { id: 'moon', approved: false, values: ['full', 'new'] },
    ]);
    const plan = planV2(store, {
      seeds: [{ id: 'real', values: { tide: 'slack', lamp: 'steady', moon: 'full', crew: 'night' } }],
    });
    expect(plan.rows[0]).toMatchObject({ id: 'seed.real', source: 'seed' });
    expect(plan.rows[0]?.values).toEqual({ lamp: 'steady', tide: 'slack', moon: 'full' });
    const unapproved = plan.warnings.filter((warning) => warning.code === 'seed_unapproved_value');
    expect(unapproved.map((warning) => `${warning.variable}=${warning.value}`)).toEqual([
      'tide=slack',
      'moon=full',
    ]);
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ code: 'seed_unknown_value', variable: 'crew', value: 'night' }),
    );
    // The seed covers no pair of the plan through the value nobody approved: the planned rows still hold the tide values.
    expect(new Set(planned(plan.rows).map((row) => row.values.tide))).toEqual(new Set(['ebb', 'flood']));
    // An unapproved value has no share, so it adds nothing to the weight: lamp is one of two.
    expect(plan.rows[0]?.logWeight).toBeCloseTo(Math.log(0.5), 12);
  });

  it('plans over a store with approved variables and an unapproved seed value as before', () => {
    const store = harbour();
    const base = planV2(store, { seeds });
    expect(base.warnings.filter((warning) => warning.code === 'seed_unapproved_value')).toEqual([]);
  });

  it('keeps a seed that breaks a constraint, and says so', () => {
    const store = makeStore(
      [
        { id: 'tide', values: ['ebb', 'flood'] },
        { id: 'lamp', values: ['steady', 'flashing'] },
      ],
      [{ forbid: { tide: 'ebb', lamp: 'steady' } }],
    );
    const plan = planV2(store, { seeds: [{ id: 'real', values: { tide: 'ebb', lamp: 'steady' } }] });
    expect(plan.rows[0]).toMatchObject({ id: 'seed.real', source: 'seed' });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'seed_forbidden', seed: 'real' }));
    expect(planned(plan.rows).some((row) => holds(row.values, { tide: 'ebb', lamp: 'steady' }))).toBe(false);
  });

  it('refuses two seeds with one id, an empty id, or a budget that is not a whole number from 0', () => {
    expect(() =>
      planV2(harbour(), {
        seeds: [
          { id: 'a', values: {} },
          { id: 'a', values: {} },
        ],
      }),
    ).toThrow(/seed/);
    expect(() => planV2(harbour(), { seeds: [{ id: '', values: {} }] })).toThrow(/seed/);
    for (const budget of [-1, 1.5, Number.NaN])
      expect(() => planV2(harbour(), { budget })).toThrow(RangeError);
  });
});

describe('a budget cuts the rarest planned rows first', () => {
  it('orders the planned rows from the most common to the rarest', () => {
    const plan = planV2(harbour());
    expect(plan.rows.length).toBeGreaterThan(8);
    expect(nonIncreasing(plan.rows)).toBe(true);
  });

  it('keeps, at every budget, exactly the first rows of the unlimited plan', () => {
    const store = harbour();
    const full = planV2(store);
    for (let budget = 0; budget <= full.rows.length + 1; budget += 1) {
      const cut = planV2(store, { budget });
      expect(
        cut.rows.map((row) => row.id),
        `budget ${budget}`,
      ).toEqual(full.rows.slice(0, budget).map((row) => row.id));
      expect(
        cut.rows.map((row) => row.values),
        `budget ${budget}`,
      ).toEqual(full.rows.slice(0, budget).map((row) => row.values));
      expect(cut.cut, `budget ${budget}`).toBe(Math.max(0, full.rows.length - budget));
    }
  });

  it('cuts only rows no more common than a row it keeps', () => {
    const store = harbour();
    const full = planV2(store);
    const cut = planV2(store, { budget: 5 });
    const kept = new Set(cut.rows.map((row) => row.id));
    const lightest = Math.min(...cut.rows.map((row) => row.logWeight));
    for (const row of full.rows)
      if (!kept.has(row.id)) expect(row.logWeight).toBeLessThanOrEqual(lightest + 1e-9);
  });

  it('reports what the cut costs: covered tuples fall with the budget and add up to the targets', () => {
    const store = harbour();
    const full = planV2(store);
    let before = Number.POSITIVE_INFINITY;
    for (const budget of [full.rows.length, 6, 3, 1, 0]) {
      const plan = planV2(store, { budget });
      const covered = plan.layers.reduce((sum, layer) => sum + layer.covered, 0);
      expect(covered).toBeLessThanOrEqual(before);
      before = covered;
      for (const layer of plan.layers) expect(layer.covered + layer.uncovered).toBe(layer.targets);
    }
    expect(planV2(store, { budget: 0 }).layers.map((layer) => layer.covered)).toEqual([0, 0, 0]);
    expect(full.layers.map((layer) => layer.uncovered)).toEqual([0, 0, 0]);
  });

  it('orders equal weights by a stable tie-break, not by luck', () => {
    const store = makeStore([
      { id: 'tide', values: ['ebb', 'flood', 'slack'] },
      { id: 'lamp', values: ['steady', 'flashing', 'dim'] },
    ]);
    const first = planV2(store, { seed: 3 });
    const again = planV2(store, { seed: 3 });
    expect(again.rows).toEqual(first.rows);
  });
});

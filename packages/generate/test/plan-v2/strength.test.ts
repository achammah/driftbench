import { describe, expect, it } from 'vitest';
import { planV2 } from '../../src/plan-v2';
import { type Cell, makeStore, product, subsets, uncovered, type VariableSpec, validCells } from './helpers';

const rows = (plan: ReturnType<typeof planV2>): Cell[] => plan.rows.map((row) => row.values);
const layer = (plan: ReturnType<typeof planV2>, name: string) => {
  const found = plan.layers.find((entry) => entry.layer === name);
  if (!found) throw new Error(`no layer ${name}`);
  return found;
};

/** Six axes. `mist`'s fog states a rule that names `tide`, `vessel` and `lamp`: four variables of one rule. */
function harbour() {
  const variables: VariableSpec[] = [
    { id: 'tide', values: ['ebb', 'flood', 'slack'] },
    {
      id: 'mist',
      values: [
        'clear',
        'haze',
        {
          id: 'fog',
          polarity: 'must',
          when: { tide: ['ebb'], vessel: ['ferry'] },
          unless: { lamp: ['steady'] },
        },
      ],
    },
    { id: 'vessel', values: ['ferry', 'trawler', 'yacht'] },
    { id: 'lamp', values: ['steady', 'flashing'] },
    { id: 'crew', values: ['crew_a', 'crew_b', 'crew_c', 'crew_d'] },
    { id: 'swell', values: ['swell_a', 'swell_b', 'swell_c', 'swell_d'] },
  ];
  return makeStore(variables);
}

describe('strength 3 on the variables of one rule', () => {
  it('covers every triple of values of every three variables of a rule that names four', () => {
    const store = harbour();
    const plan = planV2(store);
    const cells = validCells(store);
    for (const triple of subsets(['tide', 'mist', 'vessel', 'lamp'], 3)) {
      expect(uncovered(rows(plan), cells, triple), triple.join(' ')).toEqual([]);
    }
    expect(layer(plan, 'own')).toMatchObject({ groups: 4, targets: 27 + 18 + 18 + 18, infeasible: 0 });
  });

  it('uses fewer rows than the 81 triples it covers', () => {
    expect(planV2(harbour()).rows.length).toBeLessThan(81);
  });

  it('covers every pair of values of a rule that names two variables', () => {
    const store = makeStore([
      { id: 'tide', values: [{ id: 'ebb', when: { vessel: ['ferry'] } }, 'flood', 'slack'] },
      { id: 'vessel', values: ['ferry', 'trawler', 'yacht'] },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store);
    expect(uncovered(rows(plan), validCells(store), ['tide', 'vessel'])).toEqual([]);
    expect(layer(plan, 'own')).toMatchObject({ groups: 1, targets: 9 });
  });

  it('covers every value of a rule that names one variable', () => {
    const store = makeStore([
      { id: 'tide', values: ['ebb', 'flood', { id: 'slack', limit: 2 }] },
      { id: 'lamp', values: ['steady', 'flashing'] },
    ]);
    const plan = planV2(store);
    expect(layer(plan, 'own')).toMatchObject({ groups: 1, targets: 3 });
    expect(uncovered(rows(plan), validCells(store), ['tide'])).toEqual([]);
  });

  it('asks nothing beyond single values of variables that no rule names', () => {
    const store = makeStore(
      ['a', 'b', 'c', 'd', 'e'].map((id) => ({
        id,
        values: ['1', '2', '3', '4'].map((n) => `${id}${n}`),
      })),
    );
    const plan = planV2(store);
    expect(plan.rows).toHaveLength(4);
    expect(layer(plan, 'single')).toMatchObject({ groups: 5, targets: 20 });
    expect(layer(plan, 'own')).toMatchObject({ groups: 0, targets: 0 });
    for (const variable of ['a', 'b', 'c', 'd', 'e'])
      expect(new Set(rows(plan).map((row) => row[variable])).size).toBe(4);
  });

  it('covers a value of the variables outside every rule too, in the harbour', () => {
    const store = harbour();
    const plan = planV2(store);
    for (const variable of ['crew', 'swell']) {
      const values = store.variables.find((entry) => entry.id === variable)?.values.map((v) => v.id) ?? [];
      expect(new Set(rows(plan).map((row) => row[variable]))).toEqual(new Set(values));
    }
    expect(layer(plan, 'single')).toMatchObject({ groups: 2, targets: 8 });
  });

  it('covers the details of a rule like its axes', () => {
    const store = makeStore([
      { id: 'tide', values: [{ id: 'ebb', when: { depth: ['shallow'] } }, 'flood'] },
      { id: 'depth', role: 'detail', values: ['shallow', 'edge', 'deep'] },
    ]);
    const plan = planV2(store);
    expect(uncovered(rows(plan), validCells(store), ['tide', 'depth'])).toEqual([]);
  });

  it('plans a full grid in no more rows than it has cells, on random small stores', () => {
    let state = 7;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    for (let round = 0; round < 40; round += 1) {
      const sizes = Array.from({ length: 3 + Math.floor(next() * 3) }, () => 2 + Math.floor(next() * 3));
      const ids = sizes.map((_, at) => `v${at}`);
      const variables: VariableSpec[] = ids.map((id, at) => ({
        id,
        values: Array.from({ length: sizes[at] as number }, (_, n) => `${id}_${n}`),
      }));
      const first = variables[0] as VariableSpec;
      first.values = first.values.map((value, n) =>
        n === 0 && typeof value === 'string'
          ? { id: value, when: { [ids[1] as string]: [`${ids[1]}_0`], [ids[2] as string]: [`${ids[2]}_0`] } }
          : value,
      );
      const store = makeStore(variables);
      const plan = planV2(store, { seed: round });
      const cells = validCells(store);
      expect(uncovered(rows(plan), cells, ids.slice(0, 3)), `round ${round}`).toEqual([]);
      expect(plan.rows.length, `round ${round}`).toBeLessThanOrEqual(
        product(
          variables.map((variable) => ({
            id: variable.id,
            values: variable.values.map((v) => (typeof v === 'string' ? v : v.id)),
          })),
        ).length,
      );
    }
  });
});

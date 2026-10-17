import { describe, expect, it } from 'vitest';
import { planV2 } from '../../src/plan-v2';
import { makeStore, uncovered, validCells } from './helpers';

/**
 * Four rules in pairs: a is named by two rules, b by two others. `a` and `b` are shared axes though no rule
 * names both; `p`, `q`, `r`, `s` are each named by one rule.
 */
const shared = () =>
  makeStore([
    {
      id: 'a',
      values: [{ id: 'a1', when: { p: ['p1'] } }, { id: 'a2', when: { q: ['q1'] } }, 'a3'],
    },
    {
      id: 'b',
      values: [{ id: 'b1', when: { r: ['r1'] } }, { id: 'b2', when: { s: ['s1'] } }, 'b3'],
    },
    { id: 'p', values: ['p1', 'p2'] },
    { id: 'q', values: ['q1', 'q2'] },
    { id: 'r', values: ['r1', 'r2'] },
    { id: 's', values: ['s1', 's2'] },
  ]);

describe('strength 2 on the axes that several rules share', () => {
  it('covers every pair of values of two axes that two rules each share', () => {
    const store = shared();
    const plan = planV2(store);
    expect(
      uncovered(
        plan.rows.map((row) => row.values),
        validCells(store),
        ['a', 'b'],
      ),
    ).toEqual([]);
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 1, targets: 9 });
  });

  it('does not pair an axis that only one rule names with another one', () => {
    const plan = planV2(shared());
    // Own pairs: a with p, a with q, b with r, b with s. Shared pair: a with b. Nothing pairs p with r.
    const own = plan.layers.find((entry) => entry.layer === 'own');
    const sharedLayer = plan.layers.find((entry) => entry.layer === 'shared');
    expect(own?.groups).toBe(4);
    expect(sharedLayer?.groups).toBe(1);
  });

  it('does not count a rule that names one variable: it relates the variable to nothing', () => {
    const store = makeStore([
      { id: 'a', values: [{ id: 'a1', limit: 2 }, { id: 'a2', limit: 3 }, 'a3'] },
      { id: 'b', values: [{ id: 'b1', limit: 2 }, { id: 'b2', limit: 3 }, 'b3'] },
    ]);
    const plan = planV2(store);
    // a and b are each named by two rules, but each of those names one variable: nothing is shared.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 0, targets: 0 });
    expect(plan.rows).toHaveLength(3);
  });

  it('shares only axes: a detail named by two rules is not paired', () => {
    const store = makeStore([
      { id: 'a', values: [{ id: 'a1', when: { p: ['p1'] } }, { id: 'a2', when: { p: ['p2'] } }, 'a3'] },
      { id: 'b', values: [{ id: 'b1', when: { p: ['p1'] } }, { id: 'b2', when: { p: ['p2'] } }, 'b3'] },
      { id: 'p', role: 'detail', values: ['p1', 'p2'] },
    ]);
    const plan = planV2(store);
    // a and b are axes named by two rules each: they are shared, so their 9 pairs are targets.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 1, targets: 9 });
    // p is a detail named by four rules: it is never part of a shared pair.
    const rowsOf = plan.rows.map((row) => row.values);
    expect(uncovered(rowsOf, validCells(store), ['a', 'b'])).toEqual([]);
    // Four rules ask for two own pairs, (a, p) and (b, p), each once however many rules ask for it.
    expect(plan.layers.find((entry) => entry.layer === 'own')).toMatchObject({ groups: 2 });
  });

  it('does not pair a detail that several rules name with an axis that several rules name', () => {
    const store = makeStore([
      { id: 'x', values: [{ id: 'x1', when: { m: ['m1'] } }, { id: 'x2', when: { n: ['n1'] } }, 'x3'] },
      { id: 'm', values: ['m1', 'm2'] },
      { id: 'n', values: ['n1', 'n2'] },
      {
        id: 'p',
        role: 'detail',
        values: [{ id: 'p1', when: { r: ['r1'] } }, { id: 'p2', when: { s: ['s1'] } }, 'p3'],
      },
      { id: 'r', values: ['r1', 'r2'] },
      { id: 's', values: ['s1', 's2'] },
    ]);
    const plan = planV2(store);
    // x is named by two rules and p, a detail, by two others: only one axis is shared, so no pair is asked for.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 0, targets: 0 });
  });

  it('counts a rule once however many of its entries name the axis', () => {
    const store = makeStore([
      {
        id: 'a',
        values: [
          { id: 'a1', when: { p: ['p1'] }, quotes: [{ quote: 'One passage.', ledger: 'dddddddddd' }] },
          { id: 'a2', quotes: [{ quote: 'One passage, again.', ledger: 'dddddddddd' }] },
          'a3',
        ],
      },
      { id: 'b', values: [{ id: 'b1', quotes: [{ quote: 'One passage.', ledger: 'dddddddddd' }] }, 'b2'] },
      { id: 'p', values: ['p1', 'p2'] },
    ]);
    const plan = planV2(store);
    // One rule names a, b and p: a, b and p are each in one rule, so none is shared.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 0, targets: 0 });
    expect(plan.layers.find((entry) => entry.layer === 'own')).toMatchObject({ groups: 1 });
  });
});

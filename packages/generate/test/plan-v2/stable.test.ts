import { describe, expect, it } from 'vitest';
import { planV2, renderPlanV2 } from '../../src/plan-v2';
import { makeStore, uncovered, validCells } from './helpers';

const harbour = () =>
  makeStore(
    [
      {
        id: 'tide',
        values: [
          { id: 'ebb', weight: 5, when: { vessel: ['ferry'], lamp: ['steady'] } },
          { id: 'flood', weight: 3 },
          { id: 'slack', weight: 2 },
        ],
      },
      { id: 'vessel', values: ['ferry', 'trawler', 'yacht'] },
      { id: 'lamp', values: ['steady', 'flashing'] },
      { id: 'crew', role: 'detail', values: ['day', 'night'] },
    ],
    [{ forbid: { vessel: 'yacht', lamp: 'flashing' } }],
  );

describe('the plan is byte-stable', () => {
  it('gives the same text for the same store and seed, run after run', () => {
    const texts = [1, 2, 3].map(() => renderPlanV2(planV2(harbour(), { seed: 7 })));
    expect(new Set(texts).size).toBe(1);
  });

  it('does not change the store it reads', () => {
    const store = harbour();
    const before = structuredClone(store);
    planV2(store, { seed: 2, budget: 5, seeds: [{ id: 's', values: { tide: 'ebb' } }] });
    expect(store).toEqual(before);
  });

  it('plans valid, complete rows for every seed, though the rows may differ', () => {
    const store = harbour();
    const cells = validCells(store);
    const texts = new Set<string>();
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const plan = planV2(store, { seed });
      texts.add(renderPlanV2(plan));
      expect(
        uncovered(
          plan.rows.map((row) => row.values),
          cells,
          ['tide', 'vessel', 'lamp'],
        ),
        `seed ${seed}`,
      ).toEqual([]);
      expect(plan.seed).toBe(seed);
    }
    expect(texts.size).toBeGreaterThan(1);
  });

  it('writes the plan as JSON, the log weight to nine places', () => {
    const text = renderPlanV2(planV2(harbour(), { seed: 1 }));
    const plan = JSON.parse(text);
    expect(Object.keys(plan)).toEqual([
      'agent',
      'version',
      'seed',
      'generated',
      'cut',
      'layers',
      'rules',
      'rows',
      'warnings',
    ]);
    for (const row of plan.rows) expect(String(row.logWeight)).toMatch(/^-\d+(\.\d{1,9})?$|^0$/);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('keeps the rows of one fixed seed: a small harbour planned with seed 1', () => {
    const plan = planV2(
      makeStore([
        {
          id: 'tide',
          values: [
            { id: 'ebb', weight: 2, when: { lamp: ['steady'] } },
            { id: 'flood', weight: 1 },
          ],
        },
        { id: 'lamp', values: ['steady', 'flashing'] },
        { id: 'crew', values: ['day', 'night'] },
      ]),
      { seed: 1 },
    );
    expect(
      plan.rows.map((row) => `${row.id} ${row.values.tide}/${row.values.lamp}/${row.values.crew}`),
    ).toEqual([
      'row.001 ebb/flashing/night',
      'row.002 ebb/steady/day',
      'row.003 flood/steady/day',
      'row.004 flood/flashing/night',
    ]);
    // ln(2/3) + ln(1/2) + ln(1/2) for the ebb rows, ln(1/3) + ln(1/2) + ln(1/2) for the flood rows.
    expect(plan.rows.map((row) => Number(row.logWeight.toFixed(9)))).toEqual([
      -1.791759469, -1.791759469, -2.48490665, -2.48490665,
    ]);
  });
});

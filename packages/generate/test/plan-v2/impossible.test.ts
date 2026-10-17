import { describe, expect, it } from 'vitest';
import { planV2 } from '../../src/plan-v2';
import { type Cell, holds, makeStore, uncovered, type VariableSpec, validCells } from './helpers';

const rowsOf = (plan: ReturnType<typeof planV2>): Cell[] => plan.rows.map((row) => row.values);
const layer = (plan: ReturnType<typeof planV2>, name: string) => {
  const found = plan.layers.find((entry) => entry.layer === name);
  if (!found) throw new Error(`no layer ${name}`);
  return found;
};

/** Three axes; `fog` states a rule over all of them, so their triples are targets. */
const base = (): VariableSpec[] => [
  { id: 'tide', values: [{ id: 'ebb', when: { vessel: ['ferry'], lamp: ['steady'] } }, 'flood', 'slack'] },
  { id: 'vessel', values: ['ferry', 'trawler', 'yacht'] },
  { id: 'lamp', values: ['steady', 'flashing'] },
];

describe('impossible combinations are never generated', () => {
  it('keeps the two values of a forbidden pair out of every row and asks no row for the pair', () => {
    const store = makeStore(base(), [{ forbid: { tide: 'ebb', vessel: 'yacht' } }]);
    const plan = planV2(store);
    expect(rowsOf(plan).filter((row) => holds(row, { tide: 'ebb', vessel: 'yacht' }))).toEqual([]);
    expect(uncovered(rowsOf(plan), validCells(store), ['tide', 'vessel', 'lamp'])).toEqual([]);
    // 18 triples, 2 hold the pair.
    expect(layer(plan, 'own')).toMatchObject({ targets: 16, infeasible: 2, uncovered: 0 });
  });

  it('keeps the three values of a forbidden triple out of every row', () => {
    const store = makeStore(base(), [{ forbid: { tide: 'ebb', vessel: 'ferry', lamp: 'steady' } }]);
    const plan = planV2(store);
    expect(
      rowsOf(plan).filter((row) => holds(row, { tide: 'ebb', vessel: 'ferry', lamp: 'steady' })),
    ).toEqual([]);
    expect(layer(plan, 'own')).toMatchObject({ targets: 17, infeasible: 1, uncovered: 0 });
  });

  it('keeps a forbidden value out of every row and says that no row can hold it', () => {
    const store = makeStore(base(), [{ forbid: { lamp: 'flashing' } }]);
    const plan = planV2(store);
    expect(rowsOf(plan).filter((row) => row.lamp === 'flashing')).toEqual([]);
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ code: 'value_unreachable', variable: 'lamp', value: 'flashing' }),
    );
  });

  it('finds a value that two constraints together make impossible, though none names it alone', () => {
    const store = makeStore(base(), [
      { forbid: { tide: 'slack', lamp: 'steady' } },
      { forbid: { tide: 'slack', lamp: 'flashing' } },
    ]);
    const plan = planV2(store);
    expect(rowsOf(plan).filter((row) => row.tide === 'slack')).toEqual([]);
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ code: 'value_unreachable', variable: 'tide', value: 'slack' }),
    );
  });

  it('ignores a constraint nobody approved, unless asked to count it', () => {
    // An approved constraint leaves `ebb` only the steady lamp. An unapproved one forbids that pair too.
    const store = makeStore(
      [
        { id: 'tide', values: ['ebb', 'flood'] },
        { id: 'lamp', values: ['steady', 'flashing'] },
      ],
      [
        { forbid: { tide: 'ebb', lamp: 'flashing' } },
        { forbid: { tide: 'ebb', lamp: 'steady' }, approved: false },
      ],
    );
    const loose = planV2(store);
    expect(rowsOf(loose).some((row) => holds(row, { tide: 'ebb', lamp: 'steady' }))).toBe(true);
    const strict = planV2(store, { approvedOnly: false });
    expect(rowsOf(strict).some((row) => row.tide === 'ebb')).toBe(false);
    expect(strict.warnings).toContainEqual(
      expect.objectContaining({ code: 'value_unreachable', variable: 'tide', value: 'ebb' }),
    );
  });

  it('plans only the approved values, and a constraint on a value that is out of the plan cannot fire', () => {
    const store = makeStore(
      [
        { id: 'tide', values: ['ebb', { id: 'flood', approved: false }] },
        { id: 'lamp', values: ['steady', 'flashing'] },
      ],
      [{ forbid: { tide: 'flood', lamp: 'steady' } }],
    );
    const plan = planV2(store);
    expect(rowsOf(plan).every((row) => row.tide === 'ebb')).toBe(true);
    expect(new Set(rowsOf(plan).map((row) => row.lamp))).toEqual(new Set(['steady', 'flashing']));
  });

  it('agrees with a brute-force count of the valid cells on random constrained stores', () => {
    let state = 99;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    let checked = 0;
    for (let round = 0; round < 80 && checked < 50; round += 1) {
      const sizes = Array.from({ length: 3 + Math.floor(next() * 2) }, () => 2 + Math.floor(next() * 2));
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
      const constraints = Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
        const width = 1 + Math.floor(next() * 3);
        const chosen = [...ids].sort(() => next() - 0.5).slice(0, width);
        return {
          forbid: Object.fromEntries(
            chosen.map((id) => [id, `${id}_${Math.floor(next() * (sizes[ids.indexOf(id)] as number))}`]),
          ),
        };
      });
      let store: ReturnType<typeof makeStore>;
      try {
        store = makeStore(variables, constraints);
      } catch {
        continue; // the constraints forbid every cell: the loader refuses such a store
      }
      checked += 1;
      const plan = planV2(store, { seed: round });
      const cells = validCells(store);
      // No row is a forbidden cell.
      for (const row of rowsOf(plan)) {
        expect(
          store.constraints.some((constraint) =>
            Object.entries(constraint.forbid).every(([variable, value]) => row[variable] === value),
          ),
          `round ${round} row ${JSON.stringify(row)}`,
        ).toBe(false);
      }
      // Every allowed triple of the rule, and every allowed value, is in a row.
      expect(uncovered(rowsOf(plan), cells, ids.slice(0, 3)), `round ${round}`).toEqual([]);
      for (const id of ids) expect(uncovered(rowsOf(plan), cells, [id]), `round ${round} ${id}`).toEqual([]);
      // A value no valid cell holds is named, and a value some cell holds is not.
      const reachable = new Set(cells.flatMap((cell) => Object.entries(cell).map(([k, v]) => `${k}=${v}`)));
      const named = new Set(
        plan.warnings.flatMap((warning) =>
          warning.code === 'value_unreachable' ? [`${warning.variable}=${warning.value}`] : [],
        ),
      );
      for (const variable of variables)
        for (const value of variable.values) {
          const id = typeof value === 'string' ? value : value.id;
          expect(named.has(`${variable.id}=${id}`), `round ${round} ${variable.id}=${id}`).toBe(
            !reachable.has(`${variable.id}=${id}`),
          );
        }
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });
});

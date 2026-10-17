import { fileURLToPath } from 'node:url';
import { loadVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { planV2, renderPlanV2 } from '../../src/plan-v2';

const example = (name: string) =>
  fileURLToPath(new URL(`../../../../examples/variables/${name}.yaml`, import.meta.url));

/**
 * The three worked stores of examples/variables, planned. The counts are the ones the pull request that added the
 * planner prints: a change to them is a change to the plan of a worked example.
 */
const EXPECTED = {
  acme: {
    rows: 4,
    rules: 16,
    layers: [
      { layer: 'own', groups: 6, targets: 18, infeasible: 4, covered: 18 },
      { layer: 'shared', groups: 0, targets: 0, infeasible: 0, covered: 0 },
      { layer: 'single', groups: 0, targets: 0, infeasible: 0, covered: 0 },
    ],
    unreachable: ['channel=whatsapp'],
  },
  northwind: {
    rows: 6,
    rules: 3,
    layers: [
      { layer: 'own', groups: 3, targets: 9, infeasible: 0, covered: 9 },
      { layer: 'shared', groups: 0, targets: 0, infeasible: 0, covered: 0 },
      { layer: 'single', groups: 2, targets: 12, infeasible: 0, covered: 12 },
    ],
    unreachable: [],
  },
  tidewater: {
    rows: 9,
    rules: 8,
    layers: [
      { layer: 'own', groups: 6, targets: 27, infeasible: 2, covered: 27 },
      { layer: 'shared', groups: 0, targets: 0, infeasible: 0, covered: 0 },
      { layer: 'single', groups: 0, targets: 0, infeasible: 0, covered: 0 },
    ],
    unreachable: [],
  },
} as const;

describe.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])('the %s example store, planned', (name) => {
  const planned = async () => {
    const loaded = await loadVariableStore(example(name));
    if (!loaded.ok) throw new Error(loaded.errors.map((issue) => issue.message).join('\n'));
    return { store: loaded.store, plan: planV2(loaded.store, { seed: 1 }) };
  };

  it('has the counts of the pull request, and covers every target', async () => {
    const { plan } = await planned();
    const want = EXPECTED[name];
    expect(plan.rows).toHaveLength(want.rows);
    expect(plan.rules).toHaveLength(want.rules);
    expect(
      plan.layers.map(({ layer, groups, targets, infeasible, covered }) => ({
        layer,
        groups,
        targets,
        infeasible,
        covered,
      })),
    ).toEqual(want.layers);
    expect(plan.layers.map((layer) => layer.uncovered)).toEqual([0, 0, 0]);
    expect(
      plan.warnings.flatMap((warning) =>
        warning.code === 'value_unreachable' ? [`${warning.variable}=${warning.value}`] : [],
      ),
    ).toEqual(want.unreachable);
  });

  it('never holds a combination the store forbids, and gives every variable a value', async () => {
    const { store, plan } = await planned();
    for (const row of plan.rows) {
      expect(Object.keys(row.values)).toEqual(store.variables.map((variable) => variable.id));
      for (const constraint of store.constraints)
        expect(
          Object.entries(constraint.forbid).every(([variable, value]) => row.values[variable] === value),
        ).toBe(false);
    }
  });

  it('holds every approved value that some valid row can hold, and no value nobody approved', async () => {
    const { store, plan } = await planned();
    const unreachable = new Set(
      plan.warnings.flatMap((warning) =>
        warning.code === 'value_unreachable' ? [`${warning.variable}=${warning.value}`] : [],
      ),
    );
    for (const variable of store.variables)
      for (const value of variable.values) {
        // A value nobody approved is not planned (tidewater keeps one a model proposed).
        if (!(value.approved ?? variable.approved)) {
          expect(plan.rows.some((row) => row.values[variable.id] === value.id)).toBe(false);
          continue;
        }
        const held = plan.rows.some((row) => row.values[variable.id] === value.id);
        expect(held, `${variable.id}=${value.id}`).toBe(!unreachable.has(`${variable.id}=${value.id}`));
      }
  });

  it('is the same text on every run', async () => {
    const first = renderPlanV2((await planned()).plan);
    expect(renderPlanV2((await planned()).plan)).toBe(first);
  });
});

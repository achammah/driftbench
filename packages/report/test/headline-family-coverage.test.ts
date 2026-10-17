import type { RunResult } from '@agent-nexus/driftbench-core';
import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { suiteHeadline } from '../src/headline';
import { run } from './support';

// Simulated suites with known truth, read through the suite headline itself. A suite is one spec of `families`
// families, each a root with BRANCHES chains step > leaf. A family has a pass rate drawn around `theta`, the
// rate at which all its blocks pass. Each suite has `full` runs that record every block and `reruns` that
// record only the leaves (roots and steps replayed, which adds no block). Read with the spec's links, every
// family is one tree and the headline should hold theta in about 95 percent of suites. Read without them, a
// rerun's leaves stop at their steps: the family splits into one tree per branch.

function gamma(rng: () => number, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * (1 - rng()) ** (1 / shape);
  const c = shape - 1 / 3;
  const s = 1 / Math.sqrt(9 * c);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = 1 - rng();
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + s * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + c - c * v + c * Math.log(v)) return c * v;
  }
}

function beta(rng: () => number, a: number, b: number): number {
  const x = gamma(rng, a);
  return x / (x + gamma(rng, b));
}

type Cell = { families: number; theta: number; concentration: number; full: number; reruns: number };

/** Branches per family: root > step-j > leaf-j for j below this. */
const BRANCHES = 3;

function suite(cell: Cell, rng: () => number): { runs: RunResult[]; links: Map<string, string> } {
  const rates = Array.from({ length: cell.families }, () =>
    beta(rng, cell.concentration * cell.theta, cell.concentration * (1 - cell.theta)),
  );
  const branches = Array.from({ length: BRANCHES }, (_, j) => j);
  const links = new Map(
    rates.flatMap((_, f) =>
      branches.flatMap((j) => [
        [`step-${f}-${j}`, `root-${f}`],
        [`leaf-${f}-${j}`, `step-${f}-${j}`],
      ]),
    ),
  ) as Map<string, string>;
  const runs: RunResult[] = [];
  for (let repeat = 0; repeat < cell.full + cell.reruns; repeat += 1) {
    const whole = repeat < cell.full;
    const recorded = rates.flatMap((rate, f) => {
      // Each leaf passes with rate^(1/BRANCHES), independently, so the whole family passes with `rate`.
      const leaves = branches.map((j) => ({
        id: `leaf-${f}-${j}`,
        parent: `step-${f}-${j}`,
        pass: rng() < rate ** (1 / BRANCHES),
      }));
      if (!whole) return leaves;
      return [
        { id: `root-${f}`, pass: true },
        ...branches.map((j) => ({ id: `step-${f}-${j}`, parent: `root-${f}`, pass: true })),
        ...leaves,
      ];
    });
    const shape = run({
      specId: 'shop',
      repeat,
      blocks: recorded.map((block) => (block.pass ? {} : { pass: false })),
    });
    runs.push({
      ...shape,
      blocks: shape.blocks.map((block, index) => {
        const entry = recorded[index] as { id: string; parent?: string };
        return {
          ...block,
          blockId: entry.id,
          specIndex: index,
          ...(entry.parent ? { parent: entry.parent } : {}),
        };
      }),
    });
  }
  return { runs, links };
}

/** Share of suites whose headline held theta: read with the spec's links (family) and without (child). */
function coverage(cell: Cell, reps: number, seed: number): { family: number; child: number } {
  const rng = mulberry32(seed);
  let family = 0;
  let child = 0;
  for (let rep = 0; rep < reps; rep += 1) {
    const { runs, links } = suite(cell, rng);
    const byFamily = suiteHeadline(runs, (entry) => entry.specId, { parentsOf: () => links });
    const byChild = suiteHeadline(runs, (entry) => entry.specId);
    if (byFamily && byFamily.lower <= cell.theta && cell.theta <= byFamily.upper) family += 1;
    if (byChild && byChild.lower <= cell.theta && cell.theta <= byChild.upper) child += 1;
  }
  return { family: family / reps, child: child / reps };
}

const CELLS: Cell[] = [12, 40].flatMap((families) =>
  [0.6, 0.9].flatMap((theta) =>
    [2, 8].map((concentration) => ({ families, theta, concentration, full: 2, reruns: 2 })),
  ),
);

describe('coverage of the suite headline on suites whose reruns record only leaves', () => {
  it('holds the true mean near 95 percent with one tree per root, and not when each branch is a tree', () => {
    const results = CELLS.map((cell, index) => ({ cell, ...coverage(cell, 300, 700 + index) }));
    const meanFamily = results.reduce((sum, r) => sum + r.family, 0) / results.length;
    const meanBranch = results.reduce((sum, r) => sum + r.child, 0) / results.length;
    expect(meanFamily).toBeGreaterThanOrEqual(0.93);
    for (const result of results)
      expect(result.family, JSON.stringify(result.cell)).toBeGreaterThanOrEqual(0.9);
    expect(meanBranch).toBeLessThan(0.6);
  }, 120_000);
});

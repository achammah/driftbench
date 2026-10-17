import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { suiteHeadline } from '../src/headline';
import { run } from './support';

/**
 * Coverage of the headline interval on simulated suites whose specs hold several parent-linked roots. Every spec
 * has a pass rate around the suite's mean, each root a rate around its spec's, and every root is run a few times
 * (a root with one child: both blocks pass, or the root fails). The true mean is the hyper-mean `theta`.
 */
function normal(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}
function gamma(rng: () => number, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * (1 - rng()) ** (1 / shape);
  const c = shape - 1 / 3;
  const s = 1 / Math.sqrt(9 * c);
  for (;;) {
    const x = normal(rng);
    const v = (1 + s * x) ** 3;
    if (v <= 0) continue;
    if (Math.log(1 - rng()) < 0.5 * x * x + c - c * v + c * Math.log(v)) return c * v;
  }
}
function beta(rng: () => number, a: number, b: number): number {
  const x = gamma(rng, a);
  return x / (x + gamma(rng, b));
}

type Cell = { specs: number; roots: number; repeats: number; theta: number; dSpec: number; dRoot: number };
const strong: Cell = { specs: 12, roots: 3, repeats: 3, theta: 0.7, dSpec: 1, dRoot: 20 };
/** No spec effect: the roots are independent draws around the mean. */
const control: Cell = { ...strong, dSpec: 1e6, dRoot: 2 };

function suite(rng: () => number, cell: Cell) {
  const runs = [];
  for (let s = 0; s < cell.specs; s += 1) {
    const specRate = beta(rng, cell.dSpec * cell.theta, cell.dSpec * (1 - cell.theta));
    const rootRates = Array.from({ length: cell.roots }, () =>
      beta(rng, cell.dRoot * specRate, cell.dRoot * (1 - specRate)),
    );
    for (let repeat = 0; repeat < cell.repeats; repeat += 1) {
      const shape = run({
        specId: `spec-${s}`,
        repeat,
        blocks: rootRates.flatMap((rate) => {
          const ok = rng() < rate;
          return [{ pass: ok }, { pass: ok }];
        }),
      });
      runs.push({
        ...shape,
        blocks: shape.blocks.map((block, index) => ({
          ...block,
          specIndex: index,
          blockId: `r${Math.floor(index / 2)}${index % 2 === 0 ? '' : '-child'}`,
          ...(index % 2 === 1 ? { parent: `r${Math.floor(index / 2)}` } : {}),
        })),
      });
    }
  }
  return runs;
}

function coverageOf(cell: Cell, seed: number, reps = 300): number {
  const rng = mulberry32(seed);
  let held = 0;
  for (let rep = 0; rep < reps; rep += 1) {
    const headline = suiteHeadline(suite(rng, cell), (r) => r.specId);
    if (headline && headline.lower <= cell.theta && cell.theta <= headline.upper) held += 1;
  }
  return held / reps;
}

describe('suite headline coverage with several roots per spec', () => {
  it('the roots of one spec move together, so the spec is the tree: the interval covers 90 percent or more', () => {
    const c = coverageOf(strong, 2026);
    expect(c).toBeGreaterThanOrEqual(0.9);
  });

  it('without a spec effect the interval still covers 90 percent or more: pooling the roots costs nothing', () => {
    const c = coverageOf(control, 7);
    expect(c).toBeGreaterThanOrEqual(0.9);
  });
});

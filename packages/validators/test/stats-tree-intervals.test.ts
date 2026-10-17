import { describe, expect, it } from 'vitest';
import * as stats from '../../stats/src/index';
import { itemRng } from '../src/ladders/stats/bank/item';
import { rateItems } from '../src/ladders/stats/bank/rates';
import type { StatsImpl } from '../src/ladders/stats/reference';

const IDS = [
  'simulation.hierarchical.g12x6-rho0.3',
  'simulation.hierarchical.g20x5-rho0.5',
  'simulation.wilson-effective.g12x6-rho0.3',
  'simulation.wilson-effective.g20x5-rho0.5',
];
const SEEDS = [1, 2, 3, 856524023];

async function outcome(id: string, seed: number, s: StatsImpl) {
  const item = rateItems().find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing ${id}`);
  return item.check({ seed, s, root: process.cwd(), rng: itemRng(seed, id) });
}

/** A planted product mutant: the suite's blocks read as independent, so the interval ignores the trees. */
const naive = (counts: readonly { n: number; k: number }[]) => {
  const n = counts.reduce((a, c) => a + c.n, 0);
  const k = counts.reduce((a, c) => a + c.k, 0);
  const w = stats.wilson(k, n);
  return { ...w, treeMean: w.estimate, posteriorMean: w.estimate, trees: counts.length, blocks: n };
};

describe('the clustered interval items of the stats bank', { timeout: 120_000 }, () => {
  it.each(IDS)('%s passes on the product, on four seeds', async (id) => {
    for (const seed of SEEDS) {
      const got = await outcome(id, seed, stats);
      expect(got.pass, `seed ${seed}: ${got.detail}`).toBe(true);
    }
  });

  it.each(IDS.filter((id) => id.includes('hierarchical')))(
    '%s fails on an interval that ignores the trees',
    async (id) => {
      const got = await outcome(id, 1, { ...stats, hierarchicalBetaBinomial: naive } as StatsImpl);
      expect(got.pass).toBe(false);
      expect(got.detail).toMatch(/hold the planted pass rate/);
    },
  );

  it.each(IDS.filter((id) => id.includes('wilson-effective')))(
    '%s fails when the design effect is dropped (n_eff = n)',
    async (id) => {
      const mutant = (counts: readonly { n: number; k: number }[]) => {
        const w = naive(counts);
        return {
          ...w,
          n: w.blocks,
          clusters: counts.length,
          designEffect: 1,
          effectiveN: w.blocks,
          degenerate: false,
        };
      };
      const got = await outcome(id, 1, { ...stats, wilsonEffective: mutant } as unknown as StatsImpl);
      expect(got.pass).toBe(false);
    },
  );

  it('fails on a hierarchical interval shrunk to half its width', async () => {
    const half = (counts: readonly { n: number; k: number }[]) => {
      const real = stats.hierarchicalBetaBinomial(counts);
      const mid = (real.lower + real.upper) / 2;
      const w = (real.upper - real.lower) / 4;
      return { ...real, lower: mid - w, upper: mid + w };
    };
    const got = await outcome('simulation.hierarchical.g20x5-rho0.5', 1, {
      ...stats,
      hierarchicalBetaBinomial: half,
    } as StatsImpl);
    expect(got.pass).toBe(false);
  });

  it('reports a thrown error as a failure naming the function', async () => {
    const got = await outcome('simulation.hierarchical.g12x6-rho0.3', 1, {
      ...stats,
      hierarchicalBetaBinomial: () => {
        throw new RangeError('boom');
      },
    } as StatsImpl);
    expect(got.pass).toBe(false);
    expect(got.detail).toMatch(/hierarchicalBetaBinomial threw boom/);
  });
});

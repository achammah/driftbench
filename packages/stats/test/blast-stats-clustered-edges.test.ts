import { describe, expect, it } from 'vitest';
import { hierarchicalBetaBinomial, simulateCoverage, wilson, wilsonEffective } from '../src/index';

/**
 * Edge cases of the clustered intervals that the suite headline and the scorecard reach: a suite of one tree,
 * a suite where every block fails, one cluster with mixed outcomes, and n_eff pressed to its floor of 1.
 */
describe('hierarchicalBetaBinomial at the edges a suite reaches', () => {
  it('a suite where every block fails: estimate 0, lower bound 0, an upper bound above 0, inside [0, 1]', () => {
    const got = hierarchicalBetaBinomial(Array.from({ length: 6 }, () => ({ n: 4, k: 0 })));
    expect(got.estimate).toBe(0);
    expect(got.treeMean).toBe(0);
    expect(got.lower).toBe(0);
    expect(got.upper).toBeGreaterThan(0);
    expect(got.upper).toBeLessThan(0.6);
    expect(got.trees).toBe(6);
    expect(got.blocks).toBe(24);
  });

  it('a suite where every block passes mirrors the all-fail suite around 1/2', () => {
    const fail = hierarchicalBetaBinomial(Array.from({ length: 6 }, () => ({ n: 4, k: 0 })));
    const pass = hierarchicalBetaBinomial(Array.from({ length: 6 }, () => ({ n: 4, k: 4 })));
    expect(pass.estimate).toBe(1);
    expect(pass.upper).toBe(1);
    expect(pass.lower).toBeCloseTo(1 - fail.upper, 9);
    expect(pass.posteriorMean).toBeCloseTo(1 - fail.posteriorMean, 9);
  });

  it('a suite of one tree of one block gives a finite interval holding the estimate', () => {
    for (const k of [0, 1]) {
      const got = hierarchicalBetaBinomial([{ n: 1, k }]);
      expect(got.estimate).toBe(k);
      expect(got.trees).toBe(1);
      expect(got.blocks).toBe(1);
      expect(Number.isFinite(got.lower) && Number.isFinite(got.upper)).toBe(true);
      expect(got.lower).toBeLessThanOrEqual(k);
      expect(got.upper).toBeGreaterThanOrEqual(k);
      // One block says little: the interval spans most of [0, 1].
      expect(got.upper - got.lower).toBeGreaterThan(0.5);
    }
  });
});

describe('wilsonEffective at the edges a suite reaches', () => {
  it('a suite where every block fails is degenerate: each cluster counts once, lower bound 0', () => {
    const got = wilsonEffective(Array.from({ length: 5 }, () => ({ n: 4, k: 0 })));
    expect(got.degenerate).toBe(true);
    expect(got.estimate).toBe(0);
    expect(got.effectiveN).toBe(5);
    expect(got.designEffect).toBe(4);
    expect(got.lower).toBe(0);
    expect(got.upper).toBeGreaterThan(0);
    // Wider than a Wilson interval on all 20 blocks, which would read them as independent.
    expect(got.upper).toBeGreaterThan(wilson(0, 20).upper);
  });

  it('one cluster with mixed outcomes takes the normal quantile (no degrees of freedom): plain Wilson on its blocks', () => {
    const got = wilsonEffective([{ n: 10, k: 4 }]);
    const plain = wilson(4, 10);
    expect(got.degenerate).toBe(false);
    expect(got.clusters).toBe(1);
    expect(got.effectiveN).toBe(10);
    expect(got.designEffect).toBe(1);
    expect(got.lower).toBeCloseTo(plain.lower, 9);
    expect(got.upper).toBeCloseTo(plain.upper, 9);
  });

  it('n_eff pressed to its floor of 1 by two clusters that disagree completely: design effect = n, interval finite', () => {
    const got = wilsonEffective([
      { n: 1, k: 1 },
      { n: 1, k: 0 },
    ]);
    expect(got.effectiveN).toBeCloseTo(1, 12);
    expect(got.designEffect).toBeCloseTo(2, 12);
    expect(got.lower).toBeGreaterThanOrEqual(0);
    expect(got.upper).toBeLessThanOrEqual(1);
    expect(got.lower).toBeLessThan(0.5);
    expect(got.upper).toBeGreaterThan(0.5);
  });
});

describe('simulateCoverage on a suite of one tree', () => {
  it('runs every method on one tree without throwing and reports a share in [0, 1] per method', () => {
    const r = simulateCoverage({ trees: 1, sizes: 3, theta: 0.5, d: 2 }, { reps: 30, seed: 3 });
    for (const method of [
      'naive wilson',
      'wilson effective z',
      'wilson effective t',
      'hierarchical',
    ] as const) {
      expect(r.coverage[method]).toBeGreaterThanOrEqual(0);
      expect(r.coverage[method]).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.width[method])).toBe(true);
    }
    expect(r.reps).toBe(30);
  });
});

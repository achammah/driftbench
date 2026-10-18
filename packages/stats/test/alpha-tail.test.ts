import { describe, expect, it } from 'vitest';
import { mde, pairedRateDifference, wilsonEffective, zFor } from '../src/index';
import reference from './reference/alpha-tail.json';

describe('alpha below 1e-3 reaches the tail of the normal', () => {
  it.each(reference.z)('zFor($alpha) matches the 80-digit quantile', (c) => {
    const got = zFor(c.alpha);
    expect(Number.isFinite(got)).toBe(true);
    expect(Math.abs(got - c.expected) / c.expected).toBeLessThan(1e-13);
  });

  it('keeps the measured examples: zFor(1e-10) = 6.466951087240516 and zFor(1e-17) = 8.573944076720883', () => {
    expect(Math.abs(zFor(1e-10) - 6.466951087240516) / 6.466951087240516).toBeLessThan(1e-13);
    expect(Math.abs(zFor(1e-17) - 8.573944076720883) / 8.573944076720883).toBeLessThan(1e-13);
  });

  it.each(reference.paired)(
    'pairedRateDifference at alpha $alpha for $bothPass, $regressed, $improved, $bothFail matches the 80-digit Newcombe interval',
    (c) => {
      const got = pairedRateDifference(c, c.alpha);
      expect(got.estimate).toBeCloseTo(c.estimate, 14);
      expect(Math.abs(got.lower - c.lower)).toBeLessThan(1e-12);
      expect(Math.abs(got.upper - c.upper)).toBeLessThan(1e-12);
    },
  );

  it.each(reference.wilsonSingleCluster)(
    'wilsonEffective on one cluster of $n with k = $k at alpha $alpha is the 80-digit Wilson interval',
    (c) => {
      const got = wilsonEffective([{ k: c.k, n: c.n }], { alpha: c.alpha, quantile: 'z' });
      expect(Math.abs(got.lower - c.lower)).toBeLessThan(1e-12);
      expect(Math.abs(got.upper - c.upper)).toBeLessThan(1e-12);
    },
  );

  it.each(reference.mde)('mde at alpha $alpha matches the 60-digit root of the power equation', (c) => {
    const got = mde({ n: c.n, baselineRate: c.baselineRate, alpha: c.alpha, power: c.power })
      .effect as number;
    expect(Math.abs(got - c.expected) / c.expected).toBeLessThan(1e-11);
  });

  it('mde grows as alpha shrinks to 1e-20 and stays finite', () => {
    const effect = (alpha: number): number => {
      const r = mde({ n: 5000, baselineRate: 0.5, alpha, power: 0.8 });
      return r.effect as number;
    };
    const a = effect(1e-10);
    const b = effect(1e-17);
    const c = effect(1e-20);
    expect(Number.isFinite(c)).toBe(true);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

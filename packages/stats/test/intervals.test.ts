import { describe, expect, it } from 'vitest';
import {
  betaQuantile,
  binomialCdf,
  bootstrapCI,
  chiSquareSf,
  clopperPearson,
  designEffect,
  effectiveSampleSize,
  incompleteBeta,
  logGamma,
  normalCdf,
  normalQuantile,
  wilson,
  zeroFailureBound,
} from '../src/index';
import { fixtures, near } from './support';

describe('special functions against scipy', () => {
  const s = fixtures.special;
  it('logGamma matches scipy.special.gammaln', () => {
    for (const c of s.logGamma) near(logGamma(c.x), c.expected, `logGamma(${c.x})`, 1e-9);
  });
  it('incompleteBeta matches scipy.special.betainc', () => {
    for (const c of s.incompleteBeta)
      near(incompleteBeta(c.x, c.a, c.b), c.expected, `I(${c.x}; ${c.a}, ${c.b})`, 1e-10);
  });
  it('betaQuantile matches scipy.special.betaincinv', () => {
    for (const c of s.betaQuantile)
      near(betaQuantile(c.p, c.a, c.b), c.expected, `betaQuantile(${c.p})`, 1e-9);
  });
  it('normalQuantile and normalCdf match scipy.stats.norm', () => {
    for (const c of s.normalQuantile) near(normalQuantile(c.p), c.expected, `ppf(${c.p})`, 1e-9);
    for (const c of s.normalCdf) near(normalCdf(c.z), c.expected, `cdf(${c.z})`, 1e-12);
  });
  it('normalQuantile keeps its digits for p near 1 (scipy.stats.norm.ppf, 1e-11 relative)', () => {
    const cases: [number, number][] = [
      [0.999, 3.090232306167813],
      [0.99999, 4.264890793923841],
      [0.999999, 4.753424308817087],
      [0.99999999, 5.612001243305505],
      [0.9999999975823887, 5.8527460071154005],
      [0.9999999999, 6.361340889697422],
      [0.999999999999, 7.0344869100478356],
    ];
    for (const [p, expected] of cases)
      expect(Math.abs(normalQuantile(p) - expected) / expected, `ppf(${p})`).toBeLessThan(1e-11);
    // The quantile is odd about one half whenever 1 - p is exact (p >= 0.5).
    for (const [p] of cases) expect(normalQuantile(1 - p) + normalQuantile(p)).toBeCloseTo(0, 11);
  });
  it('chiSquareSf and binomialCdf match scipy.stats', () => {
    for (const c of s.chiSquareSf)
      near(chiSquareSf(c.x, c.df), c.expected, `chi2.sf(${c.x}, ${c.df})`, 1e-10);
    for (const c of s.binomialCdf)
      near(binomialCdf(c.k, c.n, c.p), c.expected, `binom.cdf(${c.k}, ${c.n})`, 1e-10);
  });
});

describe('wilson', () => {
  it('matches scipy binomtest(...).proportion_ci(method="wilson")', () => {
    for (const c of fixtures.intervals.wilson) {
      const ci = wilson(c.k, c.n, c.z);
      near(ci.lower, c.lower, `wilson(${c.k}, ${c.n}) lower`);
      near(ci.upper, c.upper, `wilson(${c.k}, ${c.n}) upper`);
      expect(ci.estimate).toBe(c.k / c.n);
    }
  });
  it('defaults to z for 95 percent and refuses k > n or n = 0', () => {
    const a = wilson(3, 10);
    const b = wilson(3, 10, 1.959963984540054);
    expect(a).toEqual(b);
    expect(() => wilson(11, 10)).toThrow(RangeError);
    expect(() => wilson(0, 0)).toThrow(RangeError);
  });
});

describe('clopperPearson', () => {
  it('matches scipy binomtest(...).proportion_ci(method="exact")', () => {
    for (const c of fixtures.intervals.clopperPearson) {
      const ci = clopperPearson(c.k, c.n, c.alpha);
      near(ci.lower, c.lower, `cp(${c.k}, ${c.n}) lower`);
      near(ci.upper, c.upper, `cp(${c.k}, ${c.n}) upper`);
    }
  });
});

describe('zeroFailureBound', () => {
  it('gives 59 clean conversations for a 5 percent bound at 95 percent', () => {
    expect(zeroFailureBound(0.05, 0.05)).toBe(59);
  });
  it('matches ceil(ln(alpha) / ln(1 - p)) and the dossier values 299 and 4603', () => {
    for (const c of fixtures.intervals.zeroFailureBound)
      expect(zeroFailureBound(c.p, c.alpha)).toBe(c.expected);
    expect(zeroFailureBound(0.01, 0.05)).toBe(299);
    expect(zeroFailureBound(0.001, 0.01)).toBe(4603);
  });
  it('is the smallest n with (1 - p)^n <= alpha', () => {
    for (const [p, a] of [
      [0.05, 0.05],
      [0.02, 0.1],
      [0.3, 0.01],
    ] as const) {
      const n = zeroFailureBound(p, a);
      expect((1 - p) ** n).toBeLessThanOrEqual(a);
      expect((1 - p) ** (n - 1)).toBeGreaterThan(a);
    }
  });
});

describe('designEffect', () => {
  it('is 1 + (m - 1) rho', () => {
    for (const c of fixtures.intervals.designEffect)
      near(designEffect(c.m, c.rho), c.expected, `deff(${c.m}, ${c.rho})`);
  });
  it('turns 385 blocks of 8 at rho 0.3 into about 124 independent units (the dossier example)', () => {
    expect(Math.round(effectiveSampleSize(385, 8, 0.3))).toBe(124);
  });
});

describe('bootstrapCI', () => {
  it('replays the Python port of the same seeded generator exactly', () => {
    for (const c of fixtures.bootstrap.replay) {
      const ci = bootstrapCI(c.values, {
        ...(c.clusters ? { clusters: c.clusters } : {}),
        iterations: c.iterations,
        seed: c.seed,
        alpha: c.alpha,
        method: c.method,
      });
      near(ci.estimate, c.estimate, `${c.name} estimate`, 1e-9);
      near(ci.lower, c.lower, `${c.name} lower`, 1e-9);
      near(ci.upper, c.upper, `${c.name} upper`, 1e-9);
    }
  });
  it('lands within 0.01 of a numpy cluster bootstrap with 200000 resamples (a different generator)', () => {
    const c = fixtures.bootstrap.independent;
    const ci = bootstrapCI(c.values, {
      clusters: c.clusters,
      iterations: c.iterations,
      alpha: c.alpha,
      seed: 3,
    });
    near(ci.lower, c.lower, 'independent lower', c.tolerance);
    near(ci.upper, c.upper, 'independent upper', c.tolerance);
  });
  it('is reproducible: the same seed gives the same interval, another seed a different one', () => {
    const c = fixtures.bootstrap.independent;
    const a = bootstrapCI(c.values, { clusters: c.clusters, seed: 9 });
    const b = bootstrapCI(c.values, { clusters: c.clusters, seed: 9 });
    const d = bootstrapCI(c.values, { clusters: c.clusters, seed: 10 });
    expect(a).toEqual(b);
    expect(d.lower === a.lower && d.upper === a.upper).toBe(false);
  });
  it('is wider by cluster than the naive interval that treats blocks as independent', () => {
    const c = fixtures.bootstrap.independent;
    const clustered = bootstrapCI(c.values, { clusters: c.clusters, iterations: 4000 });
    const naive = bootstrapCI(c.values, { iterations: 4000 });
    expect(clustered.upper - clustered.lower).toBeGreaterThan(naive.upper - naive.lower);
    near((naive.upper - naive.lower) / 2, c.naiveHalfWidth, 'naive half width', 0.01);
  });
  it('accepts a custom statistic over the resampled values', () => {
    const ci = bootstrapCI([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
      statistic: (v) => Math.max(...v),
      iterations: 500,
    });
    expect(ci.estimate).toBe(10);
    expect(ci.upper).toBe(10);
    expect(ci.lower).toBeLessThan(10);
  });
  it('refuses a cluster list of the wrong length', () => {
    expect(() => bootstrapCI([1, 2, 3], { clusters: ['a', 'b'] })).toThrow(RangeError);
  });
});

describe('design effect bound', () => {
  it('throws below the bound rho = -1 / (m - 1), where the design effect is zero or less', () => {
    expect(() => designEffect(10, -0.5)).toThrow(RangeError);
    expect(() => designEffect(10, -1 / 9)).toThrow(RangeError);
    expect(() => effectiveSampleSize(100, 10, -0.2)).toThrow(RangeError);
    expect(designEffect(10, -0.1)).toBeCloseTo(0.1, 12);
    expect(designEffect(1, -1)).toBe(1);
  });
});

describe('zeroFailureBound at a tiny p', () => {
  it('keeps the digits of ln(1 - p) for p = 1e-9', () => {
    expect(zeroFailureBound(1e-9)).toBe(2995732273);
    expect(zeroFailureBound(1e-12)).toBe(2995732273553);
    expect(zeroFailureBound(0.05)).toBe(59);
  });
});

describe('bootstrapCI on equal values', () => {
  it('returns that value exactly for estimate and both limits', () => {
    for (const x of [0.1, 0.3, 0.7, 0.9]) {
      const r = bootstrapCI(
        Array.from({ length: 7 }, () => x),
        { iterations: 20, method: 'basic' },
      );
      expect([r.estimate, r.lower, r.upper]).toEqual([x, x, x]);
    }
  });
});

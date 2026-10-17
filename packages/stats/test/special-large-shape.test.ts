import { describe, expect, it } from 'vitest';
import { binomialCdf, chiSquareSf, incompleteBeta } from '../src/index';
import { bd0, seriesStepLimit } from '../src/special';
import reference from './reference/prefactor.json';

const relative = (got: number, expected: number): number => Math.abs(got - expected) / Math.abs(expected);

describe('incompleteBeta at large shape', () => {
  it.each(reference.incompleteBeta)('I($x; $a, $b) matches the 50-digit sum', (c) => {
    expect(relative(incompleteBeta(c.x, c.a, c.b), c.expected)).toBeLessThan(1e-11);
  });

  it('keeps the measured example: I(0.49966458981176026; 1e7, 1e7) = 0.0013498970344633411', () => {
    expect(relative(incompleteBeta(0.49966458981176026, 1e7, 1e7), 0.0013498970344633411)).toBeLessThan(
      1e-11,
    );
  });
});

describe('chiSquareSf at large degrees of freedom', () => {
  it.each(reference.chiSquareSf)('chi2.sf($x, $df) matches the 50-digit sum', (c) => {
    expect(relative(chiSquareSf(c.x, c.df), c.expected)).toBeLessThan(1e-11);
  });
});

describe('binomialCdf at large n', () => {
  it.each(reference.binomialCdf)('P(X <= $k), n = $n, p = $p matches the 50-digit sum', (c) => {
    // 1 - p is rounded once; at n = 1e7 that moves the answer by up to 3e-12.
    expect(relative(binomialCdf(c.k, c.n, c.p), c.expected)).toBeLessThan(5e-11);
  });

  it.each(reference.binomialCdfGiant)('answers n = 1e9 without summing k terms (k = $k)', (c) => {
    expect(relative(binomialCdf(c.k, c.n, c.p), c.expected)).toBeLessThan(5e-11);
  });

  it('is monotone in k across the switch from the sum to the beta form at n = 50', () => {
    for (const n of [50, 51]) {
      let last = 0;
      for (let k = 0; k <= n; k += 1) {
        const v = binomialCdf(k, n, 0.37);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
      expect(last).toBe(1);
    }
    // The two forms agree where they meet.
    expect(
      relative(
        binomialCdf(18, 51, 0.37),
        binomialCdf(18, 50, 0.37) * (1 - 0.37) + binomialCdf(17, 50, 0.37) * 0.37,
      ),
    ).toBeLessThan(1e-13);
  });

  it('keeps the sum for small n exactly: n = 10, p = 0.5, k = 4 is 386 / 1024', () => {
    expect(binomialCdf(4, 10, 0.5)).toBeCloseTo(386 / 1024, 15);
  });
});

describe('binomialCdf across the switch from the sum to the incomplete beta', () => {
  // The sum of n masses carries the logGamma error of each term (1e-11 at n = 5000); the beta form does not.
  const middle = reference.binomialCdf.filter((c) => c.n > 100 && c.n <= 5000);
  it.each(middle)('P(X <= $k), n = $n, p = $p is exact to 1e-12', (c) => {
    expect(relative(binomialCdf(c.k, c.n, c.p), c.expected)).toBeLessThan(1e-12);
  });
});

describe('the deviance term', () => {
  // x log(x / np) + np - x is a difference of numbers near x log x. Inside the 10 percent window (|x - np| < 0.1 (x + np))
  // the series keeps it to about 1e-16 times its value, where the direct form is wrong by 1e-16 x |x - np| / np in
  // absolute terms, and exp(-bd0) turns that into a relative error of the prefactor.
  const inside = reference.bd0.filter((c) => Math.abs(c.x - c.np) < 0.1 * (c.x + c.np));
  const outside = reference.bd0.filter((c) => Math.abs(c.x - c.np) >= 0.1 * (c.x + c.np));
  it.each(inside)('bd0($x, $np) inside the window is exact to 1e-14 of its value plus 1e-12', (c) => {
    expect(Math.abs(bd0(c.x, c.np) - c.expected)).toBeLessThan(1e-14 * c.expected + 1e-12);
  });
  it.each(outside)('bd0($x, $np) outside the window is exact to 1e-14 relative', (c) => {
    expect(Math.abs(bd0(c.x, c.np) - c.expected)).toBeLessThan(1e-14 * c.expected);
  });
});

describe('the step limit of the series and fractions', () => {
  it('grows with the square root of the shape and stops at 5 million', () => {
    for (const a of [10, 1e3, 1e6, 1e8, 1e10]) {
      expect(seriesStepLimit(a)).toBeGreaterThanOrEqual(10000 + 8 * Math.sqrt(a));
    }
    expect(seriesStepLimit(1e300)).toBe(5_000_000);
    expect(seriesStepLimit(1e12)).toBeLessThanOrEqual(5_000_000);
  });

  it('answers NaN at once for a shape the limit cannot reach, as main did, instead of running for years', () => {
    expect(chiSquareSf(1e300, 1e300)).toBeNaN();
    expect(incompleteBeta(0.5, 1e300, 1e300)).toBeNaN();
    expect(binomialCdf(5e299, 1e300, 0.5)).toBeNaN();
  });

  it('keeps a probability between 0 and 1 where the fraction needs millions of terms', () => {
    // n = 1e15: the exact value is 0.5000000126156626; the fraction runs for a few million terms and agrees to 3e-8.
    const got = binomialCdf(5e14, 1e15, 0.5);
    expect(got).toBeGreaterThan(0.5);
    expect(got).toBeLessThan(0.5 + 1e-6);
    expect(Math.abs(got - 0.5000000126156626)).toBeLessThan(5e-8);
  });
});

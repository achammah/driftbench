import { describe, expect, it } from 'vitest';
import { normalQuantile } from '../src/index';
import reference from './reference/normal-tail.json';

describe('normalQuantile in the deep lower tail', () => {
  it.each(reference.cases)('matches the 80-digit quantile at p = $p', (c) => {
    const got = normalQuantile(c.p);
    expect(Number.isNaN(got)).toBe(false);
    expect(Math.abs(got - c.expected) / Math.abs(c.expected)).toBeLessThan(1e-14);
  });

  it('returns a finite quantile for the smallest positive double', () => {
    expect(normalQuantile(5e-324)).toBeCloseTo(-38.467405617144344, 12);
  });

  it('is increasing across the switch to the scaled refinement at 1e-300', () => {
    const ps = [5e-324, 1e-320, 1e-311, 1e-305, 9.9e-301, 1.1e-300, 1e-299, 1e-250, 1e-100, 1e-10];
    const qs = ps.map((p) => normalQuantile(p));
    for (let i = 1; i < qs.length; i += 1) expect(qs[i] as number).toBeGreaterThan(qs[i - 1] as number);
  });
});

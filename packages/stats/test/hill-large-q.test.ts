import { describe, expect, it } from 'vitest';
import { hillNumber } from '../src/index';
import reference from './reference/hill.json';

describe('hillNumber at large q', () => {
  it.each(reference.cases)('matches the exact reference: $name, q = $q', (c) => {
    const got = hillNumber(c.counts, c.q);
    expect(Number.isFinite(got)).toBe(true);
    expect(Math.abs(got - c.expected) / c.expected).toBeLessThan(1e-12);
  });

  it('keeps the measured example: three heavy and three light classes at q = 50 is 2.9216886834088207', () => {
    const got = hillNumber([100, 90, 80, 10, 5, 1], 50);
    expect(Math.abs(got - 2.9216886834088207) / 2.9216886834088207).toBeLessThan(1e-12);
  });

  it('decreases with q and stays between the smallest and the largest class share inverse', () => {
    const counts = [100, 90, 80, 10, 5, 1];
    let last = Number.POSITIVE_INFINITY;
    for (const q of [2, 5, 10, 20, 50, 100, 400, 5000]) {
      const h = hillNumber(counts, q);
      expect(h).toBeLessThanOrEqual(last);
      expect(h).toBeGreaterThanOrEqual(1);
      last = h;
    }
    // The limit is 1 / (largest share).
    expect(hillNumber(counts, 1e6)).toBeCloseTo(286 / 100, 5);
  });
});

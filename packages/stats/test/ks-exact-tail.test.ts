import { describe, expect, it } from 'vitest';
import { ksTest } from '../src/index';
import reference from './reference/ks-tail.json';

describe('ksTest exact p-value in the tail', () => {
  it.each(reference.cases)('matches the exact lattice-path count: m = $m, n = $n, D = $statistic', (c) => {
    const got = ksTest(c.a, c.b, { method: 'exact' });
    expect(got.method).toBe('exact');
    expect(got.statistic).toBeCloseTo(c.statistic, 12);
    expect(Math.abs(got.pValue - c.pValue) / c.pValue).toBeLessThan(1e-11);
  });

  it('separated samples of 20 and 20 give 2 / C(40, 20) exactly', () => {
    const a = Array.from({ length: 20 }, (_, i) => i);
    const b = Array.from({ length: 20 }, (_, i) => 100 + i);
    // C(40, 20) = 137846528820
    const got = ksTest(a, b).pValue;
    expect(Math.abs(got - 2 / 137846528820) / (2 / 137846528820)).toBeLessThan(1e-12);
  });

  it('does not lose a p-value that is far below one part in 1e16 to rounding', () => {
    const a = Array.from({ length: 100 }, (_, i) => i);
    const b = Array.from({ length: 100 }, (_, i) => 1000 + i);
    // 2 / C(200, 100), from exact integers
    const exact = 2.2087606931995028e-59;
    const got = ksTest(a, b).pValue;
    expect(got).toBeGreaterThan(0);
    expect(Math.abs(got - exact) / exact).toBeLessThan(1e-11);
  });
});

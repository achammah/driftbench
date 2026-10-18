import { describe, expect, it } from 'vitest';
import { kappaInterval, type Label } from '../src/agreement';
import { holm } from '../src/multiple';
import { mcnemar, mcnemarMidP, pairedRateDifference } from '../src/paired';
import defects from './fixtures/numerical-defects.json';
import capabilities from './fixtures/planned-capabilities.json';

// Frozen independent rational/scipy references copied from the validator bank. Tests do not
// calculate expected values using the functions under test; provenance is retained in each file.
function close(actual: number, expected: number, rel = 1e-12, abs = 1e-300): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(abs + rel * Math.abs(expected));
}

interface HolmCase {
  pvalues: number[];
  alpha: number;
  expected: { adjusted: number[]; rejected: boolean[]; alpha: number };
}
interface KappaCase {
  a: Label[];
  b: Label[];
  alpha: number;
  expected: { kappa: number; se: number; lower: number; upper: number };
}
interface MidPCase {
  b: number;
  c: number;
  expected: { pValue: number; b: number; c: number; exactP?: number };
}

for (const [name, rows] of Object.entries(capabilities)) {
  if (name.startsWith('holm.')) {
    it(name, () => {
      for (const row of rows as HolmCase[]) {
        const input = Object.freeze([...row.pvalues]);
        const result = holm(input, row.alpha);
        expect(result.adjusted).toHaveLength(row.expected.adjusted.length);
        result.adjusted.forEach((value, i) => {
          close(value, row.expected.adjusted[i] as number);
        });
        expect(result.rejected).toEqual(row.expected.rejected);
        expect(result.alpha).toBe(row.expected.alpha);
      }
    });
  }
  if (name.startsWith('kappaInterval.')) {
    it(name, () => {
      for (const row of rows as KappaCase[]) {
        const result = kappaInterval(Object.freeze(row.a), Object.freeze(row.b), { alpha: row.alpha });
        for (const field of ['kappa', 'se', 'lower', 'upper'] as const) {
          close(result[field], row.expected[field], 1e-9, 1e-12);
        }
      }
    });
  }
  if (name.startsWith('mcnemarMidP.')) {
    it(name, () => {
      for (const row of rows as MidPCase[]) {
        const result = mcnemarMidP(row.b, row.c);
        close(result.pValue, row.expected.pValue);
        expect(result.b).toBe(row.b);
        expect(result.c).toBe(row.c);
        if (row.expected.exactP !== undefined) {
          close(mcnemar(row.b, row.c, { exact: true }).pValue, row.expected.exactP);
          expect(result.pValue).toBeLessThan(row.expected.exactP);
        }
      }
    });
  }
}

it.each(defects['pairedRateDifference.tiny-alpha'])('pairedRateDifference alpha=$alpha', (row) => {
  const result = pairedRateDifference(row.table, row.alpha);
  for (const field of ['estimate', 'lower', 'upper'] as const) {
    close(result[field], row.expected[field], 1e-9, 1e-12);
  }
  expect(result.n).toBe(row.expected.n);
});

describe('new capabilities keep the input contract', () => {
  it('holm validates probabilities and defaults alpha', () => {
    for (const p of [NaN, Infinity, -0.01, 1.01]) expect(() => holm([p])).toThrow(RangeError);
    for (const alpha of [NaN, Infinity, 0, 1]) expect(() => holm([], alpha)).toThrow(RangeError);
    expect(holm([0.03])).toEqual(capabilities['holm.single-and-empty'][0]?.expected);
  });
  it('kappaInterval validates paired observations and alpha', () => {
    expect(() => kappaInterval([], [])).toThrow(RangeError);
    expect(() => kappaInterval([0], [])).toThrow(RangeError);
    for (const alpha of [NaN, Infinity, 0, 1]) {
      expect(() => kappaInterval([0, 1], [0, 1], { alpha })).toThrow(RangeError);
    }
    const row = capabilities['kappaInterval.binary'][0] as KappaCase;
    const result = kappaInterval(row.a, row.b);
    close(result.lower, row.expected.lower, 1e-9, 1e-12);
  });
  it('kappaInterval keeps zero-variance intervals finite at the smallest positive alpha', () => {
    expect(kappaInterval([0, 1], [0, 1], { alpha: Number.MIN_VALUE })).toEqual({
      kappa: 1,
      se: 0,
      lower: 1,
      upper: 1,
    });
    expect(kappaInterval([0, 1], [1, 0], { alpha: Number.MIN_VALUE })).toEqual({
      kappa: -1,
      se: 0,
      lower: -1,
      upper: -1,
    });
  });
  it('kappaInterval preserves zero observed agreement across nine categories', () => {
    const result = kappaInterval([0, 1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8, 0]);
    close(result.kappa, -0.125, 1e-12, 1e-12);
    expect(result.se).toBe(0);
    expect(result.lower).toBe(result.kappa);
    expect(result.upper).toBe(result.kappa);
  });
  it('kappaInterval keeps the same label identity as cohenKappa', () => {
    for (const [a, b] of [
      [
        [NaN, 1],
        [NaN, 1],
      ],
      [
        [-0, 1],
        [0, 1],
      ],
    ]) {
      expect(kappaInterval(a as number[], b as number[])).toEqual({
        kappa: 1,
        se: 0,
        lower: 1,
        upper: 1,
      });
    }
  });
  it('mcnemarMidP validates both nonnegative integer counts', () => {
    for (const count of [NaN, Infinity, -1, 0.5]) {
      expect(() => mcnemarMidP(count, 1)).toThrow(RangeError);
      expect(() => mcnemarMidP(1, count)).toThrow(RangeError);
    }
  });
});

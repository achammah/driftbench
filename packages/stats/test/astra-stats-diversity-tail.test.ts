import { expect, it } from 'vitest';
import { hillNumber } from '../src/coverage';
import { ksTest } from '../src/drift';
import fixtures from './fixtures/numerical-defects.json';

// Independent references: 80-digit decimal Hill sums and exact rational KS lattice paths.
it.each(fixtures['hillNumber.large-q'])('Hill diversity at q=$q for $counts', ({ counts, q, expected }) => {
  const actual = hillNumber(counts, q);
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.abs(expected));
});

it.each([-1e300, -1000, -2, 0.5, 1 - 1e-12, 1 + 1e-12, 1000, 1e300])(
  'uniform diversity remains exactly two to rounding at q=%s',
  (q) => expect(hillNumber([7, 7], q)).toBeCloseTo(2, 12),
);

it.each([...fixtures['ksTest.separated-samples'], ...fixtures['ksTest.tail-lattice']])(
  'retains the exact KS tail for sample sizes $a.length/$b.length',
  ({ a, b, expected }) => {
    const actual = ksTest(a, b, { method: 'exact' });
    expect(actual.statistic).toBeCloseTo(expected.statistic, 14);
    expect(Math.abs(actual.pValue - expected.pValue)).toBeLessThanOrEqual(1e-9 * expected.pValue);
  },
);

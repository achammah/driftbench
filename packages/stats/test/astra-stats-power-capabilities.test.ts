import { describe, expect, it } from 'vitest';
import { wilsonEffective } from '../src/effective';
import { clopperPearson, zFor } from '../src/intervals';
import * as planning from '../src/power';
import defects from './fixtures/numerical-defects.json';
import capabilities from './fixtures/planned-capabilities.json';

type Input = {
  effect: number;
  baselineRate: number;
  power?: number;
  alpha?: number;
  repeats?: number;
  rho?: number;
};
type SampleSize = { n: number; effectiveN: number; designEffect: number };
const sampleSize = (input: Input): SampleSize => {
  const fn = (planning as unknown as { sampleSizeForEffect?: (input: Input) => SampleSize })
    .sampleSizeForEffect;
  expect(fn, 'sampleSizeForEffect is exported from power.ts').toBeTypeOf('function');
  if (!fn) throw new Error('sampleSizeForEffect is missing');
  return fn(input);
};
const close = (actual: number, expected: number, rel = 1e-9): void => {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-300, rel * Math.abs(expected)));
};

// The bank's independent scipy/reference fixtures are copied verbatim, including provenance.
describe('sample size from the two-proportion power equation', () => {
  const groups = Object.entries(capabilities).filter(([name]) => name.startsWith('sampleSizeForEffect.'));
  for (const [name, raw] of groups) {
    it(name, () => {
      for (const row of raw as unknown as (Input & { expected: SampleSize })[]) {
        const actual = sampleSize(row);
        expect(Number.isInteger(actual.n)).toBe(true);
        expect(actual.n).toBeGreaterThanOrEqual(1);
        expect(actual.n).toBe(row.expected.n);
        close(actual.effectiveN, row.expected.effectiveN);
        close(actual.designEffect, row.expected.designEffect);
        const at = planning.mde({ ...row, n: actual.n }).effect;
        expect(at).not.toBeNull();
        expect(at).toBeLessThanOrEqual(row.effect + 1e-12);
        if (actual.n > 1) {
          const below = planning.mde({ ...row, n: actual.n - 1 }).effect;
          expect(below === null || below > row.effect - 1e-12).toBe(true);
        }
      }
    });
  }
});

describe('small significance levels preserve the lower tail', () => {
  it('zFor agrees with scipy at alpha down to 1e-100', () => {
    for (const row of defects['zFor.tiny-alpha']) close(zFor(row.alpha), row.expected, 1e-12);
  });
  it('wilsonEffective returns finite reference bounds', () => {
    for (const row of defects['wilsonEffective.tiny-alpha']) {
      const actual = wilsonEffective(row.clusters, { alpha: row.alpha, quantile: 'z' });
      for (const key of [
        'estimate',
        'lower',
        'upper',
        'n',
        'clusters',
        'designEffect',
        'effectiveN',
      ] as const)
        close(actual[key], row.expected[key]);
      expect(actual.degenerate).toBe(row.expected.degenerate);
    }
  });
  it('clopperPearson uses both beta tails without rounding their probabilities to one', () => {
    for (const row of defects['clopperPearson.tiny-alpha']) {
      const actual = clopperPearson(row.k, row.n, row.alpha);
      for (const key of ['estimate', 'lower', 'upper'] as const) close(actual[key], row.expected[key]);
    }
  });
  it('mde agrees with scipy instead of returning an impossible effect', () => {
    for (const row of defects['mde.tiny-alpha']) {
      const actual = planning.mde(row).effect;
      expect(actual).not.toBeNull();
      if (actual === null) throw new Error('mde incorrectly reports an impossible effect');
      close(actual, row.expected.effect, 1e-6);
    }
  });
});

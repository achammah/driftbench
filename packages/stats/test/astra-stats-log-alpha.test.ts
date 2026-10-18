import { describe, expect, it } from 'vitest';
import { kappaInterval } from '../src/agreement';
import { wilsonEffective } from '../src/effective';
import { zFor } from '../src/intervals';
import { pairedRateDifference } from '../src/paired';
import { mde, sampleSizeForEffect } from '../src/power';
import reference from './fixtures/astra-stats-log-alpha.json';

function close(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-15, Math.abs(expected) * 1e-12));
}

const ratersA = [...Array<number>(5000).fill(0), ...Array<number>(5000).fill(1)];
const ratersB = [
  ...Array<number>(4000).fill(0),
  ...Array<number>(1000).fill(1),
  ...Array<number>(500).fill(0),
  ...Array<number>(4500).fill(1),
];

for (const c of reference.cases) {
  describe(`normal intervals at alpha=${c.alpha}`, () => {
    it('zFor preserves the two-sided tail', () => {
      close(zFor(c.alpha), c.z);
    });
    it('sampleSizeForEffect returns the reference whole number', () => {
      const result = sampleSizeForEffect({ effect: 0.2, baselineRate: 0.73, power: 0.8, alpha: c.alpha });
      expect(result.n).toBe(c.sampleSize);
      expect(Number.isSafeInteger(result.n)).toBe(true);
    });
    it('mde retains a finite detectable effect', () => {
      const result = mde({ n: 18010, baselineRate: 0.73, power: 0.8, alpha: c.alpha });
      expect(result.effect).not.toBeNull();
      close(result.effect as number, c.mde);
    });
    it('wilsonEffective retains finite interior limits', () => {
      const result = wilsonEffective(
        [
          { n: 5, k: 2 },
          { n: 5, k: 4 },
          { n: 5, k: 3 },
        ],
        { alpha: c.alpha, quantile: 'z' },
      );
      close(result.lower, c.wilson.lower);
      close(result.upper, c.wilson.upper);
      expect(result.lower).toBeGreaterThan(0);
      expect(result.upper).toBeLessThan(1);
    });
    it('pairedRateDifference retains its reference limits', () => {
      const result = pairedRateDifference({ bothPass: 40, regressed: 2, improved: 8, bothFail: 50 }, c.alpha);
      close(result.lower, c.paired.lower);
      close(result.upper, c.paired.upper);
    });
    it('kappaInterval retains unclipped reference limits', () => {
      const result = kappaInterval(ratersA, ratersB, { alpha: c.alpha });
      close(result.kappa, c.kappa.kappa);
      close(result.se, c.kappa.se);
      close(result.lower, c.kappa.lower);
      close(result.upper, c.kappa.upper);
      expect(result.lower).toBeGreaterThan(-1);
      expect(result.upper).toBeLessThan(1);
    });
  });
}

/** Planning: the minimum detectable effect of a campaign. */

import { assertFinite, assertProbability } from './basics';
import { designEffect } from './intervals';
import { normalQuantile } from './special';

export interface MdeInput {
  /** Number of specs (independent clusters) per version. */
  readonly n: number;
  /** Repeats per spec. Default 1. */
  readonly repeats?: number;
  /** The pass rate of the baseline. */
  readonly baselineRate: number;
  /** Power to detect the effect. Default 0.8. */
  readonly power?: number;
  /** Two-sided significance level. Default 0.05. */
  readonly alpha?: number;
  /**
   * Intraclass correlation of repeats of one spec. Default 0, which treats repeats as independent
   * and so is optimistic; pass the rho measured by varianceComponents.
   */
  readonly rho?: number;
}

export interface MdeResult {
  /** The smallest drop in pass rate the campaign detects at the given power, or null if none below the baseline rate is. */
  readonly effect: number | null;
  /** Effective independent units per version: n x repeats / design effect. */
  readonly effectiveN: number;
  readonly designEffect: number;
}

/**
 * The minimum detectable effect: the smallest drop delta from the baseline rate p1 to p2 = p1 - delta
 * that a two-sided test of two proportions detects with the given power, with the usual normal
 * approximation (no continuity correction):
 * delta sqrt(N) = z(1 - alpha / 2) sqrt(2 pbar (1 - pbar)) + z(power) sqrt(p1 (1 - p1) + p2 (1 - p2)),
 * pbar = (p1 + p2) / 2, N the effective units per version. Solved for delta by bisection. Treating the
 * two versions as independent samples is conservative for a paired campaign.
 */
export function mde(input: MdeInput): MdeResult {
  const repeats = input.repeats ?? 1;
  const power = input.power ?? 0.8;
  const alpha = input.alpha ?? 0.05;
  const rho = input.rho ?? 0;
  const p1 = input.baselineRate;
  assertFinite('mde', 'n', input.n);
  assertFinite('mde', 'repeats', repeats);
  if (!(rho >= -1 && rho <= 1)) throw new RangeError(`mde: rho must lie in [-1, 1], got ${rho}`);
  if (!(input.n >= 1)) throw new RangeError(`mde: n must be at least 1, got ${input.n}`);
  if (!(repeats >= 1)) throw new RangeError(`mde: repeats must be at least 1, got ${repeats}`);
  assertProbability('mde', 'baselineRate', p1);
  assertProbability('mde', 'power', power, true);
  assertProbability('mde', 'alpha', alpha, true);
  const de = designEffect(repeats, rho);
  const effectiveN = (input.n * repeats) / de;
  const za = -normalQuantile(alpha / 2);
  const zb = normalQuantile(power);
  const gap = (delta: number): number => {
    const p2 = p1 - delta;
    const pbar = (p1 + p2) / 2;
    return (
      za * Math.sqrt(2 * pbar * (1 - pbar)) +
      zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)) -
      delta * Math.sqrt(effectiveN)
    );
  };
  if (p1 === 0 || gap(p1) > 0) return { effect: null, effectiveN, designEffect: de };
  let lo = 0;
  let hi = p1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return { effect: (lo + hi) / 2, effectiveN, designEffect: de };
}

export interface SampleSizeForEffectInput {
  /** The drop in pass rate to detect, greater than zero and no larger than baselineRate. */
  readonly effect: number;
  readonly baselineRate: number;
  /** Desired power. Default 0.8. */
  readonly power?: number;
  /** Two-sided significance level. Default 0.05. */
  readonly alpha?: number;
  /** Repeats per spec. Default 1. */
  readonly repeats?: number;
  /** Intraclass correlation of repeats. Default 0. */
  readonly rho?: number;
}

export interface SampleSizeForEffectResult {
  /** The smallest positive whole number of specs per version. */
  readonly n: number;
  readonly effectiveN: number;
  readonly designEffect: number;
}

/**
 * Invert the two-proportion normal power equation used by mde. Round the required independent units
 * up to whole specs after allowing for repeats and their design effect. Throws when no sample size
 * can be represented as a safe integer.
 */
export function sampleSizeForEffect(input: SampleSizeForEffectInput): SampleSizeForEffectResult {
  const repeats = input.repeats ?? 1;
  const power = input.power ?? 0.8;
  const alpha = input.alpha ?? 0.05;
  const rho = input.rho ?? 0;
  const p1 = input.baselineRate;
  assertProbability('sampleSizeForEffect', 'baselineRate', p1);
  assertProbability('sampleSizeForEffect', 'power', power, true);
  assertProbability('sampleSizeForEffect', 'alpha', alpha, true);
  assertFinite('sampleSizeForEffect', 'effect', input.effect);
  if (!(input.effect > 0 && input.effect <= p1)) {
    throw new RangeError('sampleSizeForEffect: effect must be above zero and no larger than baselineRate');
  }
  assertFinite('sampleSizeForEffect', 'repeats', repeats);
  const de = designEffect(repeats, rho);
  const p2 = p1 - input.effect;
  const pbar = (p1 + p2) / 2;
  const numerator =
    -normalQuantile(alpha / 2) * Math.sqrt(2 * pbar * (1 - pbar)) +
    normalQuantile(power) * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const required = (Math.max(0, numerator) / input.effect) ** 2;
  let n = Math.max(1, Math.ceil((required * de) / repeats));
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('sampleSizeForEffect: required n exceeds the safe integer range');
  }
  const detects = (count: number): boolean => {
    const effect = mde({ ...input, n: count }).effect;
    return effect !== null && effect <= input.effect;
  };
  // The inverse equation can round across an integer boundary. Verify adjacent candidates against
  // mde itself, whose returned effect is the public contract, without widening the comparison.
  if (!detects(n) || (n > 1 && detects(n - 1))) {
    let lo = 0;
    let hi = n;
    while (!detects(hi)) {
      if (hi === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('sampleSizeForEffect: required n exceeds the safe integer range');
      }
      hi = Math.min(Number.MAX_SAFE_INTEGER, 2 * hi);
    }
    // Bisection also handles very small effects, where mde rounding can move several integer counts.
    while (hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (detects(mid)) hi = mid;
      else lo = mid;
    }
    n = hi;
  }
  return { n, effectiveN: (n * repeats) / de, designEffect: de };
}

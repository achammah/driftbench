/** Intervals on rates: Wilson, Clopper-Pearson, the zero-failure count, the design effect and the clustered bootstrap. */

import {
  assertCount,
  assertFinite,
  assertFiniteValues,
  assertProbability,
  mulberry32,
  quantileSorted,
} from './basics';
import { betaQuantile, normalQuantile } from './special';

/** z for a two-sided 95 percent interval. */
export const Z95 = 1.959963984540054;

export interface Interval {
  /** The point estimate. */
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
}

/** The Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z: number = Z95): Interval {
  assertCount('wilson', 'k', k);
  assertCount('wilson', 'n', n);
  if (n === 0) throw new RangeError('wilson: n must be at least 1');
  assertFinite('wilson', 'z', z);
  if (!(z > 0)) throw new RangeError(`wilson: z must be above 0, got ${z}`);
  if (k > n) throw new RangeError(`wilson: k (${k}) exceeds n (${n})`);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { estimate: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

/** The exact (Clopper-Pearson) interval for k successes in n trials at level 1 - alpha. */
export function clopperPearson(k: number, n: number, alpha = 0.05): Interval {
  assertCount('clopperPearson', 'k', k);
  assertCount('clopperPearson', 'n', n);
  assertProbability('clopperPearson', 'alpha', alpha, true);
  if (n === 0) throw new RangeError('clopperPearson: n must be at least 1');
  if (k > n) throw new RangeError(`clopperPearson: k (${k}) exceeds n (${n})`);
  const lower = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  // Beta symmetry preserves a tiny tail probability that 1 - alpha / 2 would round to one.
  const upper = k === n ? 1 : 1 - betaQuantile(alpha / 2, n - k, k + 1);
  return { estimate: k / n, lower, upper };
}

/**
 * The number of independent failure-free units needed to claim a failure rate below p at
 * confidence 1 - alpha: the smallest n with (1 - p)^n <= alpha, that is ceil(ln(alpha) / ln(1 - p)).
 * 59 for p = 0.05 at 95 percent.
 */
export function zeroFailureBound(p: number, alpha = 0.05): number {
  assertProbability('zeroFailureBound', 'p', p, true);
  assertProbability('zeroFailureBound', 'alpha', alpha, true);
  const exact = Math.log(alpha) / Math.log1p(-p);
  // Guard against floating noise when the ratio is an exact integer.
  const rounded = Math.round(exact);
  return Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact);
}

/** The design effect 1 + (m - 1) rho for clusters of size m with intraclass correlation rho. */
export function designEffect(m: number, rho: number): number {
  assertFinite('designEffect', 'm', m);
  if (!(m >= 1)) throw new RangeError(`designEffect: m must be at least 1, got ${m}`);
  if (!(rho >= -1 && rho <= 1)) throw new RangeError(`designEffect: rho must lie in [-1, 1], got ${rho}`);
  const de = 1 + (m - 1) * rho;
  if (!(de > 0)) {
    throw new RangeError(
      `designEffect: rho must be above -1 / (m - 1) = ${-1 / (m - 1)} for clusters of size ${m}, got ${rho}`,
    );
  }
  return de;
}

/** The effective number of independent units: n divided by the design effect. */
export function effectiveSampleSize(n: number, m: number, rho: number): number {
  assertFinite('effectiveSampleSize', 'n', n);
  return n / designEffect(m, rho);
}

/**
 * Kish's effective sample size of weighted units, (sum w)^2 / sum w^2 (Owen, Monte Carlo theory, equation
 * 9.13). Equal weights give n; unequal weights give less. Throws a RangeError on no weights, a weight that is
 * not finite or is negative, or weights that sum to zero.
 */
export function kishEffectiveSize(weights: readonly number[]): number {
  if (weights.length === 0) throw new RangeError('kishEffectiveSize of no weights');
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i] as number;
    if (!Number.isFinite(w) || w < 0) {
      throw new RangeError(`kishEffectiveSize: weights[${i}] must be finite and not negative, got ${w}`);
    }
    sum += w;
    sumSquares += w * w;
  }
  if (!(sum > 0)) throw new RangeError('kishEffectiveSize: the weights must not sum to zero');
  return (sum * sum) / sumSquares;
}

/** The two-sided Student t quantile at 1 - alpha / 2 on `df` degrees of freedom. */
function studentQuantile(alpha: number, df: number): number {
  // P(|T| > t) = I_x(df / 2, 1 / 2) with x = df / (df + t^2), so t = sqrt(df (1 - x) / x) at x = betaQuantile(alpha).
  const x = betaQuantile(alpha, df / 2, 0.5);
  return Math.sqrt((df * (1 - x)) / x);
}

/**
 * The interval for the mean of clustered values: mean -/+ t(1 - alpha / 2, G - 1) SE, with the clustered
 * standard error SE = sqrt(sum over clusters of (sum of (x - mean))^2) / n and G the clusters. Throws a
 * RangeError on no values, mismatched lengths, a value that is not finite, fewer than two clusters or an alpha
 * outside (0, 1). The bounds are not clipped to the range of the values.
 */
export function clusteredMeanInterval(
  values: readonly number[],
  clusters: readonly (string | number)[],
  alpha = 0.05,
): Interval {
  if (values.length === 0) throw new RangeError('clusteredMeanInterval of an empty sample');
  if (values.length !== clusters.length) {
    throw new RangeError(
      `clusteredMeanInterval: values and clusters must have the same length, got ${values.length} and ${clusters.length}`,
    );
  }
  assertProbability('clusteredMeanInterval', 'alpha', alpha, true);
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v))
      throw new RangeError(`clusteredMeanInterval: values[${i}] must be finite, got ${v}`);
    total += v;
  }
  const n = values.length;
  const estimate = total / n;
  const sums = new Map<string | number, number>();
  for (let i = 0; i < n; i += 1) {
    const key = clusters[i] as string | number;
    sums.set(key, (sums.get(key) ?? 0) + ((values[i] as number) - estimate));
  }
  const g = sums.size;
  if (g < 2) throw new RangeError(`clusteredMeanInterval needs at least two clusters, got ${g}`);
  let ss = 0;
  for (const d of sums.values()) ss += d * d;
  const half = studentQuantile(alpha, g - 1) * (Math.sqrt(ss) / n);
  return { estimate, lower: estimate - half, upper: estimate + half };
}

export interface BootstrapOptions {
  /** Cluster key per value, same length as values. Without it every value is its own cluster. */
  readonly clusters?: readonly (string | number)[];
  /** Number of bootstrap resamples. Default 2000. */
  readonly iterations?: number;
  /** 'percentile' (default) or 'basic' (the reflected percentile interval). */
  readonly method?: 'percentile' | 'basic';
  /** Two-sided level: the interval covers 1 - alpha. Default 0.05. */
  readonly alpha?: number;
  /** Seed of the generator. Default 1. The same seed gives the same interval. */
  readonly seed?: number;
  /**
   * Statistic over the resampled values (all values of the drawn clusters, concatenated in draw
   * order). Default: the pooled mean, so a cluster weighs by its size.
   */
  readonly statistic?: (values: readonly number[]) => number;
}

export interface BootstrapInterval extends Interval {
  readonly iterations: number;
  readonly clusters: number;
  readonly method: 'percentile' | 'basic';
  readonly seed: number;
}

/**
 * A bootstrap interval that resamples whole clusters with replacement (one conversation or one task
 * is one cluster), so values inside a cluster are never treated as independent.
 */
export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {
  const iterations = options.iterations ?? 2000;
  const method = options.method ?? 'percentile';
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? 1;
  if (values.length === 0) throw new RangeError('bootstrapCI: values must not be empty');
  assertFiniteValues('bootstrapCI', 'values', values);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError(`bootstrapCI: iterations must be a positive integer, got ${iterations}`);
  }
  assertProbability('bootstrapCI', 'alpha', alpha, true);
  const keys = options.clusters;
  if (keys && keys.length !== values.length) {
    throw new RangeError(`bootstrapCI: clusters has ${keys.length} keys for ${values.length} values`);
  }

  // Group values by cluster, in order of first appearance.
  const groups: number[][] = [];
  if (keys) {
    const index = new Map<string | number, number>();
    values.forEach((v, i) => {
      const key = keys[i] as string | number;
      let g = index.get(key);
      if (g === undefined) {
        g = groups.length;
        index.set(key, g);
        groups.push([]);
      }
      (groups[g] as number[]).push(v);
    });
  } else {
    for (const v of values) groups.push([v]);
  }

  const statistic = options.statistic;
  const sums = groups.map((g) => g.reduce((a, b) => a + b, 0));
  const sizes = groups.map((g) => g.length);
  const pooled = (drawn: readonly number[]): number => {
    let s = 0;
    let c = 0;
    for (const g of drawn) {
      s += sums[g] as number;
      c += sizes[g] as number;
    }
    return s / c;
  };
  // Equal values have that value as mean exactly; a sum divided by a count can round away from it.
  const constant = values.every((v) => v === values[0]);
  const evaluate = (drawn: readonly number[]): number => {
    if (!statistic) return constant ? (values[0] as number) : pooled(drawn);
    const flat: number[] = [];
    for (const g of drawn) for (const v of groups[g] as number[]) flat.push(v);
    return statistic(flat);
  };

  const all = groups.map((_, g) => g);
  const estimate = evaluate(all);
  const rng = mulberry32(seed);
  const g = groups.length;
  const stats: number[] = new Array(iterations);
  const drawn: number[] = new Array(g);
  for (let it = 0; it < iterations; it += 1) {
    for (let j = 0; j < g; j += 1) drawn[j] = Math.floor(rng() * g);
    stats[it] = evaluate(drawn);
  }
  stats.sort((a, b) => a - b);
  const qLow = quantileSorted(stats, alpha / 2);
  const qHigh = quantileSorted(stats, 1 - alpha / 2);
  const [lower, upper] = method === 'basic' ? [2 * estimate - qHigh, 2 * estimate - qLow] : [qLow, qHigh];
  return { estimate, lower, upper, iterations, clusters: g, method, seed };
}

/** z for a two-sided interval at level 1 - alpha. */
export function zFor(alpha: number): number {
  assertProbability('zFor', 'alpha', alpha, true);
  // Work in the lower tail so subtraction from one cannot erase the significance level.
  return -normalQuantile(alpha / 2);
}

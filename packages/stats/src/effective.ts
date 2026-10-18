/** A pass rate over clusters: the design effect from the spread of the cluster rates, and Wilson on the effective blocks. */

import { assertCount, assertProbability } from './basics';
import type { Interval } from './intervals';
import { betaQuantile, normalQuantileFromLogP } from './special';

/** The blocks of one cluster (the repeats of one block, the realisations of one class, the children of one parent). */
export interface ClusterCount {
  readonly n: number;
  readonly k: number;
}

export interface EffectiveWilsonOptions {
  /** Two-sided level: the interval covers 1 - alpha. Default 0.05. */
  readonly alpha?: number;
  /**
   * `t` (default): the Student t quantile on clusters less one, which widens the interval where few clusters
   * stand behind the rate. `z`: the normal quantile, the form simulated in H12 (91.0 percent coverage on its grid).
   */
  readonly quantile?: 't' | 'z';
}

export interface EffectiveWilson extends Interval {
  /** All blocks in all clusters. */
  readonly n: number;
  readonly clusters: number;
  /** The variance of the cluster-robust estimate over the variance of independent blocks, kept within 1 to n. */
  readonly designEffect: number;
  /** n divided by the design effect: the independent blocks the clusters are worth. */
  readonly effectiveN: number;
  /**
   * True when every block passed or every block failed: the spread of the cluster rates is zero, so the design
   * effect cannot be measured. The interval then counts each cluster once.
   */
  readonly degenerate: boolean;
}

/**
 * The pooled pass rate p = sum k / sum n with the Wilson score interval on the effective number of blocks.
 * The variance of p is the cluster-robust ratio estimator g / (g - 1) sum (k_c - p n_c)^2 / n^2 (the CR1 small-
 * cluster factor); the design effect is that variance over p (1 - p) / n; n_eff = n / design effect. When the
 * rate is exactly 0 or 1 the spread is zero and tells nothing, so the clusters themselves are the units
 * (n_eff = g). Throws a RangeError on no clusters, a cluster with no block (it would count in g without holding an observation), a count that is not a whole number or k above n.
 */
export function wilsonEffective(
  clusters: readonly ClusterCount[],
  options: EffectiveWilsonOptions = {},
): EffectiveWilson {
  const alpha = options.alpha ?? 0.05;
  assertProbability('wilsonEffective', 'alpha', alpha, true);
  if (clusters.length === 0) throw new RangeError('wilsonEffective: clusters must not be empty');
  let n = 0;
  let k = 0;
  clusters.forEach((c, i) => {
    assertCount('wilsonEffective', `clusters[${i}].n`, c.n);
    assertCount('wilsonEffective', `clusters[${i}].k`, c.k);
    if (c.n === 0) throw new RangeError(`wilsonEffective: clusters[${i}] has no block`);
    if (c.k > c.n) throw new RangeError(`wilsonEffective: clusters[${i}].k (${c.k}) exceeds n (${c.n})`);
    n += c.n;
    k += c.k;
  });
  const g = clusters.length;
  const p = k / n;
  const degenerate = p === 0 || p === 1;
  let effectiveN: number;
  if (degenerate) {
    effectiveN = g;
  } else if (g < 2) {
    effectiveN = n;
  } else {
    let ss = 0;
    for (const c of clusters) ss += (c.k - p * c.n) ** 2;
    const variance = (g / (g - 1)) * (ss / (n * n));
    effectiveN = variance > 0 ? Math.min(n, Math.max(1, (p * (1 - p)) / variance)) : n;
  }
  const df = g - 1;
  let z: number;
  if (options.quantile === 'z' || df < 1) {
    z = -normalQuantileFromLogP(Math.log(alpha) - Math.LN2);
  } else {
    // P(|T| > t) = I_x(df / 2, 1 / 2) with x = df / (df + t^2), so t = sqrt(df (1 - x) / x) at x = betaQuantile(alpha).
    const x = betaQuantile(alpha, df / 2, 0.5);
    z = Math.sqrt((df * (1 - x)) / x);
  }
  const z2 = z * z;
  const denominator = 1 + z2 / effectiveN;
  const centre = (p + z2 / (2 * effectiveN)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / effectiveN + z2 / (4 * effectiveN * effectiveN))) / denominator;
  return {
    estimate: p,
    lower: Math.max(0, centre - half),
    upper: Math.min(1, centre + half),
    n,
    clusters: g,
    designEffect: n / effectiveN,
    effectiveN,
    degenerate,
  };
}

/**
 * Comparing a baseline and a candidate on the same specs: McNemar's test, Wilcoxon's signed-rank
 * test, the paired difference of two pass rates with its interval, and the parity verdict.
 */

import { assertCount, assertFiniteValues, assertProbability, assertSameLength } from './basics';
import { wilson } from './intervals';
import { binomialCdf, binomialPmf, chiSquareSf, incompleteBeta, normalQuantile, normalSf } from './special';

export interface McNemarResult {
  /** The exact test reports min(b, c); the chi-square test reports the corrected chi-square. */
  readonly statistic: number;
  readonly pValue: number;
  readonly method: 'exact' | 'chi-square';
  readonly b: number;
  readonly c: number;
}

export interface McNemarOptions {
  /** Force the exact binomial test (true) or the chi-square test (false). Default: exact when b + c < 25. */
  readonly exact?: boolean;
}

/**
 * McNemar's test on the discordant counts b and c of a paired 2 x 2 table. Exact (two-sided
 * binomial with p = 0.5) for small counts, the continuity-corrected chi-square with one degree of
 * freedom otherwise.
 */
export function mcnemar(b: number, c: number, options: McNemarOptions = {}): McNemarResult {
  assertCount('mcnemar', 'b', b);
  assertCount('mcnemar', 'c', c);
  const n = b + c;
  const exact = options.exact ?? n < 25;
  if (n === 0) return { statistic: 0, pValue: 1, method: exact ? 'exact' : 'chi-square', b, c };
  if (exact) {
    const k = Math.min(b, c);
    return { statistic: k, pValue: Math.min(1, 2 * binomialCdf(k, n, 0.5)), method: 'exact', b, c };
  }
  const diff = Math.max(0, Math.abs(b - c) - 1);
  const statistic = (diff * diff) / n;
  return { statistic, pValue: chiSquareSf(statistic, 1), method: 'chi-square', b, c };
}

export interface McNemarMidPResult {
  readonly pValue: number;
  readonly b: number;
  readonly c: number;
}

/**
 * Two-sided mid-p McNemar test: 2 P(X < k) + P(X = k), capped at 1, where
 * X ~ Binomial(b + c, 0.5) and k = min(b, c). No discordant pairs give p = 1.
 */
export function mcnemarMidP(b: number, c: number): McNemarMidPResult {
  assertCount('mcnemarMidP', 'b', b);
  assertCount('mcnemarMidP', 'c', c);
  const n = b + c;
  if (n === 0) return { pValue: 1, b, c };
  const k = Math.min(b, c);
  const pValue = Math.min(1, 2 * binomialCdf(k - 1, n, 0.5) + binomialPmf(k, n, 0.5));
  return { pValue, b, c };
}

export type WilcoxonMethod = 'exact' | 'permutation' | 'asymptotic';

export interface WilcoxonResult {
  /** min(R+, R-), the two-sided statistic as scipy reports it. */
  readonly statistic: number;
  readonly pValue: number;
  readonly rPlus: number;
  readonly rMinus: number;
  /** Pairs with a non-zero difference. Zero differences are dropped (Wilcoxon's rule). */
  readonly n: number;
  readonly zeros: number;
  readonly method: WilcoxonMethod;
  /** The normal score, reported only for the asymptotic method. */
  readonly z?: number;
}

export interface WilcoxonOptions {
  /** 'auto' (default) follows scipy.stats.wilcoxon: see the function comment. */
  readonly method?: 'auto' | WilcoxonMethod;
}

/** Average ranks (1-based) of the values, ties sharing the mean of their positions. */
function averageRanks(values: readonly number[]): { ranks: number[]; tieSizes: number[] } {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  const tieSizes: number[] = [];
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (
      j + 1 < order.length &&
      (order[j + 1] as readonly [number, number])[0] === (order[i] as readonly [number, number])[0]
    )
      j += 1;
    const rank = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) ranks[(order[k] as readonly [number, number])[1]] = rank;
    tieSizes.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, tieSizes };
}

/** Null distribution of the sum of positive-signed weights, each sign +/- with probability 1/2. Weights are non-negative integers. */
function signFlipDistribution(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  let dist = new Array<number>(total + 1).fill(0);
  dist[0] = 1;
  let reach = 0;
  for (const w of weights) {
    const next = new Array<number>(total + 1).fill(0);
    for (let s = 0; s <= reach; s += 1) {
      const p = dist[s] as number;
      if (p === 0) continue;
      next[s] = (next[s] as number) + p / 2;
      next[s + w] = (next[s + w] as number) + p / 2;
    }
    reach += w;
    dist = next;
  }
  return dist;
}

function tailProbabilities(dist: readonly number[], t: number): { below: number; above: number } {
  let below = 0;
  let above = 0;
  for (let s = 0; s < dist.length; s += 1) {
    if (s <= t) below += dist[s] as number;
    if (s >= t) above += dist[s] as number;
  }
  return { below, above };
}

/**
 * Wilcoxon's signed-rank test on paired samples x and y (two-sided), zero differences dropped.
 * Method 'auto' follows scipy.stats.wilcoxon 1.18: the asymptotic normal test without continuity
 * correction when there are more than 50 pairs; otherwise the exact null distribution when there
 * are no ties and no zeros; otherwise an exact sign-flip permutation distribution when there are
 * at most 13 pairs; otherwise the asymptotic test with the tie correction.
 */
export function wilcoxonSignedRank(
  x: readonly number[],
  y: readonly number[],
  options: WilcoxonOptions = {},
): WilcoxonResult {
  assertSameLength(x, y, 'wilcoxonSignedRank', ['x', 'y']);
  assertFiniteValues('wilcoxonSignedRank', 'x', x);
  assertFiniteValues('wilcoxonSignedRank', 'y', y);
  const total = x.length;
  if (total === 0) throw new RangeError('wilcoxonSignedRank: x must not be empty');
  const diffs = x.map((v, i) => v - (y[i] as number));
  const nonzero = diffs.filter((d) => d !== 0);
  const zeros = total - nonzero.length;
  const n = nonzero.length;
  if (n === 0) {
    return { statistic: 0, pValue: 1, rPlus: 0, rMinus: 0, n: 0, zeros, method: 'exact' };
  }
  const { ranks, tieSizes } = averageRanks(nonzero.map(Math.abs));
  let rPlus = 0;
  let rMinus = 0;
  nonzero.forEach((d, i) => {
    if (d > 0) rPlus += ranks[i] as number;
    else rMinus += ranks[i] as number;
  });
  const hasTies = tieSizes.some((t) => t > 1);

  let method: WilcoxonMethod;
  const requested = options.method ?? 'auto';
  if (requested !== 'auto') method = requested;
  else if (total > 50) method = 'asymptotic';
  else if (!hasTies && zeros === 0) method = 'exact';
  else if (total <= 13) method = 'permutation';
  else method = 'asymptotic';

  const statistic = Math.min(rPlus, rMinus);
  if (method === 'asymptotic') {
    const mn = (n * (n + 1)) / 4;
    const tieCorrection = tieSizes.reduce((acc, t) => acc + t * t * t - t, 0);
    const se = Math.sqrt((n * (n + 1) * (2 * n + 1) - tieCorrection / 2) / 24);
    const z = (rPlus - mn) / se;
    const pValue = Math.min(1, 2 * normalSf(Math.abs(z)));
    return { statistic, pValue, rPlus, rMinus, n, zeros, method, z: -Math.abs(z) };
  }

  if (method === 'exact') {
    // Ranks 1..n; a non-integral statistic (ties) is rounded outward, as scipy does.
    const dist = signFlipDistribution(Array.from({ length: n }, (_, i) => i + 1));
    const lowTail = tailProbabilities(dist, Math.ceil(rPlus)).below;
    const highTail = tailProbabilities(dist, Math.floor(rPlus)).above;
    return {
      statistic,
      pValue: Math.min(1, 2 * Math.min(lowTail, highTail)),
      rPlus,
      rMinus,
      n,
      zeros,
      method,
    };
  }

  // Permutation: every sign assignment of the observed (average) ranks, doubled to integers.
  const doubled = ranks.map((r) => Math.round(2 * r));
  const dist = signFlipDistribution(doubled);
  const { below, above } = tailProbabilities(dist, Math.round(2 * rPlus));
  return { statistic, pValue: Math.min(1, 2 * Math.min(below, above)), rPlus, rMinus, n, zeros, method };
}

export interface PairedTable {
  /** Pairs where both versions pass. */
  readonly bothPass: number;
  /** Baseline passes, candidate fails. */
  readonly regressed: number;
  /** Baseline fails, candidate passes. */
  readonly improved: number;
  /** Both fail. */
  readonly bothFail: number;
}

export interface PairedDifference {
  /** Baseline pass rate minus candidate pass rate: positive means the candidate regressed. */
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
  readonly n: number;
}

/**
 * The difference between two paired pass rates (baseline minus candidate), with Newcombe's hybrid
 * score interval for paired data (Newcombe 1998, method 10: Wilson limits for each rate combined
 * with Newcombe's corrected phi correlation of the 2 x 2 table). The Wilson limits themselves
 * have no continuity correction. Positive covariance is reduced by n / 2, stopping at zero;
 * negative covariance is unchanged, and a zero marginal count gives phi = 0.
 */
export function pairedRateDifference(table: PairedTable, alpha = 0.05): PairedDifference {
  const { bothPass: a, regressed: b, improved: c, bothFail: d } = table;
  assertCount('pairedRateDifference', 'bothPass', a);
  assertCount('pairedRateDifference', 'regressed', b);
  assertCount('pairedRateDifference', 'improved', c);
  assertCount('pairedRateDifference', 'bothFail', d);
  assertProbability('pairedRateDifference', 'alpha', alpha, true);
  const n = a + b + c + d;
  if (n === 0) throw new RangeError('pairedRateDifference: table has no pairs');
  // The lower tail keeps alpha / 2 even when 1 - alpha / 2 rounds to one.
  const z = -normalQuantile(alpha / 2);
  const p1 = (a + b) / n;
  const p2 = (a + c) / n;
  const w1 = wilson(a + b, n, z);
  const w2 = wilson(a + c, n, z);
  const product = (a + b) * (c + d) * (a + c) * (b + d);
  const covariance = a * d - b * c;
  const corrected = covariance > 0 ? Math.max(0, covariance - n / 2) : covariance;
  const phi = product === 0 ? 0 : corrected / Math.sqrt(product);
  const dl1 = p1 - w1.lower;
  const du1 = w1.upper - p1;
  const dl2 = p2 - w2.lower;
  const du2 = w2.upper - p2;
  const delta = Math.sqrt(Math.max(0, dl1 * dl1 - 2 * phi * dl1 * du2 + du2 * du2));
  const epsilon = Math.sqrt(Math.max(0, du1 * du1 - 2 * phi * du1 * dl2 + dl2 * dl2));
  const estimate = p1 - p2;
  return { estimate, lower: Math.max(-1, estimate - delta), upper: Math.min(1, estimate + epsilon), n };
}

export interface NonInferiorityInput {
  /** All-pass flag per pair (spec) for the baseline. */
  readonly baseline: readonly boolean[];
  /** All-pass flag per pair for the candidate, same order. */
  readonly candidate: readonly boolean[];
  /** The largest drop in pass rate the campaign tolerates, set before it runs (for example 0.05). */
  readonly margin: number;
  /** Name per pair, same order; used to list the regressed pairs. Default: the index. */
  readonly pairs?: readonly string[];
  /** Two-sided level of the interval on the regression effect. Default 0.05. */
  readonly alpha?: number;
  /** A gating flag per pair (for example a safety flag) for each version. */
  readonly gatingFlags?: { readonly baseline: readonly boolean[]; readonly candidate: readonly boolean[] };
}

export interface NonInferiorityResult {
  readonly nonInferior: boolean;
  /** Baseline pass rate minus candidate pass rate, with its interval. */
  readonly effect: PairedDifference;
  readonly margin: number;
  /** Discordant pair counts: regressed = baseline passed and candidate failed; improved = the reverse. */
  readonly discordant: { readonly regressed: number; readonly improved: number };
  readonly regressedPairs: readonly string[];
  /** Pairs where a gating flag fires for the candidate and not for the baseline. */
  readonly newFlags: readonly string[];
  readonly reason: string;
}

/**
 * The parity verdict for one gating criterion: the candidate is non-inferior when the upper bound
 * of the interval on the regression effect (baseline rate minus candidate rate) is below the margin
 * and no gating flag fires where the baseline had none. Zero regressed pairs is not parity by itself.
 */
export function nonInferiority(input: NonInferiorityInput): NonInferiorityResult {
  const { baseline, candidate, margin } = input;
  assertSameLength(baseline, candidate, 'nonInferiority', ['baseline', 'candidate']);
  if (baseline.length === 0) throw new RangeError('nonInferiority: baseline and candidate must not be empty');
  if (!(margin > 0 && margin < 1))
    throw new RangeError(`nonInferiority: margin must lie in (0, 1), got ${margin}`);
  const names = input.pairs ?? baseline.map((_, i) => String(i));
  assertSameLength(baseline, names, 'nonInferiority pairs');
  let bothPass = 0;
  let bothFail = 0;
  const regressedPairs: string[] = [];
  const improvedPairs: string[] = [];
  baseline.forEach((b, i) => {
    const c = candidate[i] as boolean;
    if (b && c) bothPass += 1;
    else if (!b && !c) bothFail += 1;
    else if (b) regressedPairs.push(names[i] as string);
    else improvedPairs.push(names[i] as string);
  });
  const effect = pairedRateDifference(
    { bothPass, regressed: regressedPairs.length, improved: improvedPairs.length, bothFail },
    input.alpha ?? 0.05,
  );
  const newFlags: string[] = [];
  if (input.gatingFlags) {
    const { baseline: fb, candidate: fc } = input.gatingFlags;
    assertSameLength(baseline, fb, 'nonInferiority gatingFlags.baseline');
    assertSameLength(baseline, fc, 'nonInferiority gatingFlags.candidate');
    fc.forEach((fired, i) => {
      if (fired && !fb[i]) newFlags.push(names[i] as string);
    });
  }
  const withinMargin = effect.upper < margin;
  const nonInferior = withinMargin && newFlags.length === 0;
  const reason = !withinMargin
    ? `upper bound ${effect.upper.toFixed(4)} of the regression effect is not below the margin ${margin}`
    : newFlags.length > 0
      ? `a gating flag fires where the baseline had none: ${newFlags.join(', ')}`
      : `upper bound ${effect.upper.toFixed(4)} is below the margin ${margin}`;
  return {
    nonInferior,
    effect,
    margin,
    discordant: { regressed: regressedPairs.length, improved: improvedPairs.length },
    regressedPairs,
    newFlags,
    reason,
  };
}

export interface OneWayAnovaResult {
  /** F = MSB / MSW. Infinity when the groups differ and the within-group variance is zero. */
  readonly statistic: number;
  /** Groups less one. */
  readonly df1: number;
  /** Values less groups. */
  readonly df2: number;
  /** The upper tail of the F distribution at the statistic. */
  readonly pValue: number;
}

/**
 * The one-way ANOVA F test of equal means (scipy.stats.f_oneway): F = MSB / MSW with k - 1 and N - k degrees of
 * freedom. Throws a RangeError on fewer than two groups, an empty group, a value that is not finite, no
 * within-group degrees of freedom (every group a single value), or all values equal (0 / 0).
 */
export function oneWayAnova(groups: readonly (readonly number[])[]): OneWayAnovaResult {
  const k = groups.length;
  if (k < 2) throw new RangeError(`oneWayAnova needs at least two groups, got ${k}`);
  let n = 0;
  let total = 0;
  groups.forEach((group, g) => {
    if (group.length === 0) throw new RangeError(`oneWayAnova: group ${g} is empty`);
    group.forEach((v, i) => {
      if (!Number.isFinite(v))
        throw new RangeError(`oneWayAnova: groups[${g}][${i}] must be finite, got ${v}`);
      total += v;
    });
    n += group.length;
  });
  if (n === k) throw new RangeError('oneWayAnova needs at least one group with two values');
  const grand = total / n;
  let ssb = 0;
  let ssw = 0;
  for (const group of groups) {
    const m = group.reduce((a, b) => a + b, 0) / group.length;
    ssb += group.length * (m - grand) ** 2;
    for (const v of group) ssw += (v - m) ** 2;
  }
  const df1 = k - 1;
  const df2 = n - k;
  if (ssb === 0 && ssw === 0) throw new RangeError('oneWayAnova: all values are equal, so F is undefined');
  if (ssw === 0) return { statistic: Number.POSITIVE_INFINITY, df1, df2, pValue: 0 };
  const statistic = ssb / df1 / (ssw / df2);
  return { statistic, df1, df2, pValue: incompleteBeta(df2 / (df2 + df1 * statistic), df2 / 2, df1 / 2) };
}

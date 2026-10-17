/** Change detection over time (CUSUM, Page-Hinkley) and the two-sample Kolmogorov-Smirnov test. */

import { assertFiniteValues, mean, sampleVariance } from './basics';

/** Rule 1 for an option: a RangeError that begins `<function>: <option>` when a number is not finite or below its bound. */
function assertOption(fn: string, name: string, value: number | undefined, min: number, open: boolean): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || (open ? value <= min : value < min)) {
    throw new RangeError(
      `${fn}: ${name} must be a finite number ${open ? 'above' : 'of at least'} ${min}, got ${value}`,
    );
  }
}

export interface Alarm {
  readonly index: number;
  readonly direction: 'up' | 'down';
}

export interface CusumOptions {
  /** The in-control mean. Default: the mean of the first `warmup` points. */
  readonly target?: number;
  /** The in-control standard deviation. Default: the sample standard deviation of the first `warmup` points. */
  readonly sd?: number;
  /** The allowance, in standard deviations. Default 0.5 (tuned to detect a shift of one sd). */
  readonly k?: number;
  /** The decision threshold, in standard deviations. Default 5. */
  readonly h?: number;
  /** Points used to estimate target and sd when they are not given. Default min(20, series length). */
  readonly warmup?: number;
  /** Reset the sum that fired to 0 after an alarm. Default true. */
  readonly reset?: boolean;
}

export interface CusumResult {
  /** The upper cumulative sum after each point, in sd units. */
  readonly upper: readonly number[];
  /** The lower cumulative sum after each point, in sd units. */
  readonly lower: readonly number[];
  readonly alarms: readonly Alarm[];
  readonly target: number;
  readonly sd: number;
}

/**
 * The tabular CUSUM of Page (1954) on standardized points z = (x - target) / sd:
 * upper = max(0, upper + z - k), lower = max(0, lower - z - k); an alarm when either exceeds h.
 */
export function cusum(series: readonly number[], options: CusumOptions = {}): CusumResult {
  if (series.length === 0) throw new RangeError('cusum: series must not be empty');
  assertFiniteValues('cusum', 'series', series);
  assertOption('cusum', 'target', options.target, Number.NEGATIVE_INFINITY, true);
  assertOption('cusum', 'sd', options.sd, 0, true);
  assertOption('cusum', 'k', options.k, 0, false);
  assertOption('cusum', 'h', options.h, 0, false);
  if (options.warmup !== undefined && (!Number.isInteger(options.warmup) || options.warmup < 1)) {
    throw new RangeError(`cusum: warmup must be a positive integer, got ${options.warmup}`);
  }
  const warmup = options.warmup ?? Math.min(20, series.length);
  const head = series.slice(0, warmup);
  const target = options.target ?? mean(head);
  const sd = options.sd ?? Math.sqrt(sampleVariance(head));
  if (!(sd > 0)) throw new RangeError('cusum: the standard deviation is 0; pass options.sd');
  const k = options.k ?? 0.5;
  const h = options.h ?? 5;
  const reset = options.reset ?? true;
  const upper: number[] = [];
  const lower: number[] = [];
  const alarms: Alarm[] = [];
  let su = 0;
  let sl = 0;
  series.forEach((x, index) => {
    const z = (x - target) / sd;
    su = Math.max(0, su + z - k);
    sl = Math.max(0, sl - z - k);
    upper.push(su);
    lower.push(sl);
    if (su > h) {
      alarms.push({ index, direction: 'up' });
      if (reset) su = 0;
    }
    if (sl > h) {
      alarms.push({ index, direction: 'down' });
      if (reset) sl = 0;
    }
  });
  return { upper, lower, alarms, target, sd };
}

export interface PageHinkleyOptions {
  /** The magnitude of change tolerated. Default 0.005. */
  readonly delta?: number;
  /** The detection threshold lambda. Default 50; set it to the scale of the series. */
  readonly threshold?: number;
  /** No alarm before this many points since the start or the last reset. Default 30. */
  readonly minInstances?: number;
}

export interface PageHinkleyResult {
  /** The statistic for an increase after each point: m_t - min(m). */
  readonly up: readonly number[];
  /** The statistic for a decrease after each point: max(m') - m'_t. */
  readonly down: readonly number[];
  readonly alarms: readonly Alarm[];
}

/**
 * The two-sided Page-Hinkley test. With the running mean xbar_t (including x_t):
 * m_t = m_(t-1) + (x_t - xbar_t - delta), up_t = m_t - min(m); m'_t = m'_(t-1) + (x_t - xbar_t + delta),
 * down_t = max(m') - m'_t. An alarm when either exceeds the threshold after minInstances points; all
 * state resets after an alarm.
 */
export function pageHinkley(series: readonly number[], options: PageHinkleyOptions = {}): PageHinkleyResult {
  if (series.length === 0) throw new RangeError('pageHinkley: series must not be empty');
  assertFiniteValues('pageHinkley', 'series', series);
  assertOption('pageHinkley', 'delta', options.delta, Number.NEGATIVE_INFINITY, true);
  assertOption('pageHinkley', 'threshold', options.threshold, 0, false);
  const delta = options.delta ?? 0.005;
  const threshold = options.threshold ?? 50;
  const minInstances = options.minInstances ?? 30;
  const up: number[] = [];
  const down: number[] = [];
  const alarms: Alarm[] = [];
  let count = 0;
  let runningMean = 0;
  let mUp = 0;
  let minUp = 0;
  let mDown = 0;
  let maxDown = 0;
  series.forEach((x, index) => {
    count += 1;
    runningMean += (x - runningMean) / count;
    mUp += x - runningMean - delta;
    minUp = Math.min(minUp, mUp);
    mDown += x - runningMean + delta;
    maxDown = Math.max(maxDown, mDown);
    const u = mUp - minUp;
    const d = maxDown - mDown;
    up.push(u);
    down.push(d);
    if (count >= minInstances && (u > threshold || d > threshold)) {
      alarms.push({ index, direction: u > threshold ? 'up' : 'down' });
      count = 0;
      runningMean = 0;
      mUp = 0;
      minUp = 0;
      mDown = 0;
      maxDown = 0;
    }
  });
  return { up, down, alarms };
}

export interface KsResult {
  /** The largest gap between the two empirical distribution functions. */
  readonly statistic: number;
  readonly pValue: number;
  readonly method: 'exact' | 'asymptotic';
}

/** Survival function of the Kolmogorov distribution (the limit of sqrt(n) D). */
export function kolmogorovSf(x: number): number {
  if (x <= 0) return 1;
  if (x < 1.18) {
    // P(K <= x) = sqrt(2 pi) / x * sum exp(-(2k - 1)^2 pi^2 / (8 x^2)).
    let s = 0;
    for (let k = 1; k <= 50; k += 1) {
      const term = Math.exp((-((2 * k - 1) ** 2) * Math.PI * Math.PI) / (8 * x * x));
      s += term;
      if (term < 1e-18) break;
    }
    return 1 - (Math.sqrt(2 * Math.PI) / x) * s;
  }
  let s = 0;
  for (let k = 1; k <= 100; k += 1) {
    const term = Math.exp(-2 * k * k * x * x);
    s += (k % 2 === 1 ? 1 : -1) * term;
    if (term < 1e-18) break;
  }
  return Math.min(1, 2 * s);
}

/**
 * The two-sample Kolmogorov-Smirnov test (two-sided). The p-value is exact (the share of lattice
 * paths that leave the band |i/m - j/n| < D, Hodges 1957) when both samples have at most 10000 values,
 * as in scipy.stats.ks_2samp; above that it uses the Kolmogorov limit with sqrt(m n / (m + n)).
 * The exact value assumes no ties across the samples.
 */
export function ksTest(
  a: readonly number[],
  b: readonly number[],
  options: { method?: 'auto' | 'exact' | 'asymptotic' } = {},
): KsResult {
  if (options.method !== undefined && !['auto', 'exact', 'asymptotic'].includes(options.method)) {
    throw new RangeError(`ksTest: method must be auto, exact or asymptotic, got ${options.method}`);
  }
  const m = a.length;
  const n = b.length;
  if (m === 0) throw new RangeError("ksTest: 'a' must not be empty");
  if (n === 0) throw new RangeError("ksTest: 'b' must not be empty");
  assertFiniteValues('ksTest', 'a', a);
  assertFiniteValues('ksTest', 'b', b);
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  // D * m * n is an integer: track the integer gap i * n - j * m along the merged order.
  let i = 0;
  let j = 0;
  let gap = 0;
  while (i < m || j < n) {
    const next = Math.min(
      i < m ? (x[i] as number) : Number.POSITIVE_INFINITY,
      j < n ? (y[j] as number) : Number.POSITIVE_INFINITY,
    );
    while (i < m && x[i] === next) i += 1;
    while (j < n && y[j] === next) j += 1;
    gap = Math.max(gap, Math.abs(i * n - j * m));
  }
  const statistic = gap / (m * n);
  const requested = options.method ?? 'auto';
  const method = requested === 'auto' ? (Math.max(m, n) <= 10000 ? 'exact' : 'asymptotic') : requested;
  if (gap === 0) return { statistic, pValue: 1, method };
  if (method === 'asymptotic') {
    const en = Math.sqrt((m * n) / (m + n));
    return { statistic, pValue: kolmogorovSf(statistic * en), method };
  }
  // Probability that a uniformly random lattice path from (0, 0) to (m, n) leaves the band |i n - j m| < gap.
  // v[jj] holds paths-that-left / C(ii + jj, ii) at row ii; rows roll over ii. The recursion adds positive terms
  // only (a path reaches (ii, jj) from (ii - 1, jj) with weight ii / (ii + jj), from (ii, jj - 1) with weight
  // jj / (ii + jj)), so a p-value far below one keeps its relative precision. Taking 1 minus the share that stays
  // inside loses every digit below 1e-16.
  const inside = (ii: number, jj: number): boolean => Math.abs(ii * n - jj * m) < gap;
  const v = new Float64Array(n + 1);
  v[0] = 0;
  for (let jj = 1; jj <= n; jj += 1) v[jj] = inside(0, jj) ? (v[jj - 1] as number) : 1;
  for (let ii = 1; ii <= m; ii += 1) {
    v[0] = inside(ii, 0) ? (v[0] as number) : 1;
    for (let jj = 1; jj <= n; jj += 1) {
      v[jj] = inside(ii, jj) ? (ii * (v[jj] as number) + jj * (v[jj - 1] as number)) / (ii + jj) : 1;
    }
  }
  const pValue = Math.min(1, Math.max(0, v[n] as number));
  return { statistic, pValue, method };
}

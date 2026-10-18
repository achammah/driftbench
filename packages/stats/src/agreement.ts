/** Agreement between judges and hand labels: Cohen's kappa and Krippendorff's alpha. */

import { assertProbability, assertSameLength } from './basics';
import { normalQuantileFromLogP } from './special';

export type Label = string | number | boolean;

export interface KappaOptions {
  /** 'none' (default) for nominal labels; 'linear' or 'quadratic' for ordered labels. */
  readonly weights?: 'none' | 'linear' | 'quadratic';
  /** The label order for weighted kappa. Default: the labels seen, numbers ascending, else in string order. */
  readonly categories?: readonly Label[];
}

export interface KappaResult {
  readonly kappa: number;
  /** Observed agreement (weighted when weights are set). */
  readonly observed: number;
  /** Agreement expected by chance from the two marginals. */
  readonly expected: number;
  readonly n: number;
}

function defaultOrder(labels: readonly Label[]): Label[] {
  const unique = [...new Set(labels)];
  if (unique.every((l) => typeof l === 'number')) return (unique as number[]).sort((p, q) => p - q);
  return unique.sort((p, q) => String(p).localeCompare(String(q)));
}

/**
 * Cohen's kappa between two raters over the same items: (po - pe) / (1 - pe). With weights it is
 * 1 - sum(w o) / sum(w e), w the disagreement weight |i - j| (linear) or (i - j)^2 (quadratic) over the
 * category order, o and e the observed and chance cell proportions.
 */
export function cohenKappa(
  a: readonly Label[],
  b: readonly Label[],
  options: KappaOptions = {},
): KappaResult {
  assertSameLength(a, b, 'cohenKappa', ["'a'", "'b'"]);
  const n = a.length;
  if (n === 0) throw new RangeError("cohenKappa: 'a' and 'b' must not be empty");
  if (options.weights !== undefined && !['none', 'linear', 'quadratic'].includes(options.weights)) {
    throw new RangeError(`cohenKappa: weights must be none, linear or quadratic, got ${options.weights}`);
  }
  const categories = options.categories ? [...options.categories] : defaultOrder([...a, ...b]);
  const index = new Map<Label, number>(categories.map((c, i) => [c, i]));
  const k = categories.length;
  const table = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  a.forEach((label, i) => {
    const r = index.get(label);
    const c = index.get(b[i] as Label);
    if (r === undefined || c === undefined)
      throw new RangeError(`cohenKappa: label outside the categories at item ${i}`);
    (table[r] as number[])[c] = ((table[r] as number[])[c] as number) + 1;
  });
  const rows = table.map((row) => row.reduce((s, v) => s + v, 0) / n);
  const cols = categories.map((_, c) => table.reduce((s, row) => s + (row[c] as number), 0) / n);
  const weights = options.weights ?? 'none';
  const disagreement = (i: number, j: number): number => {
    if (weights === 'none') return i === j ? 0 : 1;
    const d = Math.abs(i - j);
    return weights === 'linear' ? d : d * d;
  };
  let observedDis = 0;
  let expectedDis = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const w = disagreement(i, j);
      observedDis += (w * ((table[i] as number[])[j] as number)) / n;
      expectedDis += w * (rows[i] as number) * (cols[j] as number);
    }
  }
  if (weights === 'none') {
    const observed = 1 - observedDis;
    const expected = 1 - expectedDis;
    const kappa = expected === 1 ? (observed === 1 ? 1 : 0) : (observed - expected) / (1 - expected);
    return { kappa, observed, expected, n };
  }
  const kappa = expectedDis === 0 ? 1 : 1 - observedDis / expectedDis;
  return { kappa, observed: 1 - observedDis, expected: 1 - expectedDis, n };
}

export interface KappaIntervalOptions {
  /** Two-sided significance level; defaults to 0.05. */
  readonly alpha?: number;
}

export interface KappaIntervalResult {
  readonly kappa: number;
  readonly se: number;
  readonly lower: number;
  readonly upper: number;
}

/**
 * Unweighted Cohen's kappa with a large-sample normal interval.
 * Its standard error is sqrt(po (1 - po) / n) / (1 - pe), and normal limits are clipped to
 * [-1, 1]. Constant identical raters (pe = 1) give a point interval with standard error zero.
 */
export function kappaInterval(
  a: readonly Label[],
  b: readonly Label[],
  options: KappaIntervalOptions = {},
): KappaIntervalResult {
  const alpha = options.alpha ?? 0.05;
  assertProbability('kappaInterval', 'alpha', alpha, true);
  assertSameLength(a, b, 'kappaInterval', ["'a'", "'b'"]);
  if (a.length === 0) throw new RangeError("kappaInterval: 'a' and 'b' must not be empty");
  const { kappa, expected, n } = cohenKappa(a, b);
  if (expected === 1) return { kappa, se: 0, lower: kappa, upper: kappa };
  // Count agreement directly: subtracting summed disagreement from one can round below zero.
  // === plus paired NaNs matches the SameValueZero keys used by cohenKappa's category Map.
  const matches = a.filter((label, i) => label === b[i] || (Number.isNaN(label) && Number.isNaN(b[i])));
  const observed = matches.length / n;
  const se = Math.sqrt((observed * (1 - observed)) / n) / (1 - expected);
  if (se === 0) return { kappa, se, lower: kappa, upper: kappa };
  const z = -normalQuantileFromLogP(Math.log(alpha) - Math.LN2);
  return { kappa, se, lower: Math.max(-1, kappa - z * se), upper: Math.min(1, kappa + z * se) };
}

export type AlphaLevel = 'nominal' | 'ordinal' | 'interval' | 'ratio';

export interface AlphaResult {
  readonly alpha: number;
  /** Observed disagreement. */
  readonly observed: number;
  /** Disagreement expected by chance. */
  readonly expected: number;
  /** Pairable values: values in units coded by at least two raters. */
  readonly pairable: number;
}

/**
 * Krippendorff's alpha over a raters x units matrix; null or undefined marks a missing value.
 * Built from the coincidence matrix: alpha = 1 - (n - 1) sum(o_ck d_ck) / sum(n_c n_k d_ck), with the
 * squared difference function of the chosen level (Krippendorff, Computing Krippendorff's
 * alpha-reliability, 2011). Units with fewer than two values are not pairable and are skipped.
 */
export function krippendorffAlpha(
  matrix: readonly (readonly (Label | null | undefined)[])[],
  options: { level?: AlphaLevel } = {},
): AlphaResult {
  const level = options.level ?? 'nominal';
  if (matrix.length === 0) throw new RangeError('krippendorffAlpha: matrix must not be empty');
  if (!['nominal', 'interval', 'ordinal', 'ratio'].includes(level)) {
    throw new RangeError(
      `krippendorffAlpha: level must be nominal, interval, ordinal or ratio, got ${level}`,
    );
  }
  const units = Math.max(...matrix.map((row) => row.length));
  const valueSet = new Set<Label>();
  const unitValues: Label[][] = [];
  for (let u = 0; u < units; u += 1) {
    const vals: Label[] = [];
    for (const row of matrix) {
      const v = row[u];
      if (v !== null && v !== undefined) vals.push(v);
    }
    if (vals.length >= 2) {
      unitValues.push(vals);
      for (const v of vals) valueSet.add(v);
    }
  }
  if (level !== 'nominal' && [...valueSet].some((v) => typeof v !== 'number')) {
    throw new RangeError(`krippendorffAlpha: level ${level} needs numeric values`);
  }
  const values = defaultOrder([...valueSet]);
  const index = new Map<Label, number>(values.map((v, i) => [v, i]));
  const k = values.length;
  const o = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const vals of unitValues) {
    const m = vals.length;
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        if (i === j) continue;
        const c = index.get(vals[i] as Label) as number;
        const d = index.get(vals[j] as Label) as number;
        (o[c] as number[])[d] = ((o[c] as number[])[d] as number) + 1 / (m - 1);
      }
    }
  }
  const nc = o.map((row) => row.reduce((s, v) => s + v, 0));
  const n = nc.reduce((s, v) => s + v, 0);
  if (n === 0) throw new RangeError('krippendorffAlpha: matrix has no unit with two values');
  const delta = (c: number, d: number): number => {
    if (c === d) return 0;
    if (level === 'nominal') return 1;
    const vc = values[c] as number;
    const vd = values[d] as number;
    if (level === 'interval') return (vc - vd) ** 2;
    if (level === 'ratio') return ((vc - vd) / (vc + vd)) ** 2;
    const lo = Math.min(c, d);
    const hi = Math.max(c, d);
    let s = 0;
    for (let g = lo; g <= hi; g += 1) s += nc[g] as number;
    return (s - ((nc[c] as number) + (nc[d] as number)) / 2) ** 2;
  };
  let observedSum = 0;
  let expectedSum = 0;
  for (let c = 0; c < k; c += 1) {
    for (let d = 0; d < k; d += 1) {
      const w = delta(c, d);
      observedSum += ((o[c] as number[])[d] as number) * w;
      expectedSum += (nc[c] as number) * (nc[d] as number) * w;
    }
  }
  const observed = observedSum / n;
  const expected = expectedSum / (n * (n - 1));
  const alpha = expected === 0 ? 1 : 1 - observed / expected;
  return { alpha, observed, expected, pairable: n };
}

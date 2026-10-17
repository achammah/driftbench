/** What was not seen: Good-Turing, sample coverage and Chao1, and Hill numbers of diversity. */

/** Abundance per class from a list of class labels (the cell of each conversation, for example). */
export function abundances(labels: readonly (string | number)[]): number[] {
  const counts = new Map<string | number, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.values()];
}

interface Frequencies {
  readonly n: number;
  readonly observed: number;
  readonly f1: number;
  readonly f2: number;
}

function frequencies(fn: string, counts: readonly number[]): Frequencies {
  let n = 0;
  let observed = 0;
  let f1 = 0;
  let f2 = 0;
  counts.forEach((c, i) => {
    if (!Number.isInteger(c) || c < 0)
      throw new RangeError(`${fn}: counts[${i}] must be a non-negative integer, got ${c}`);
    n += c;
    if (c > 0) observed += 1;
    if (c === 1) f1 += 1;
    if (c === 2) f2 += 1;
  });
  if (n === 0) throw new RangeError(`${fn}: counts must hold at least one observation`);
  return { n, observed, f1, f2 };
}

export interface GoodTuringResult extends Frequencies {
  /** f1 / n: the chance that the next unit shows a class not seen yet. */
  readonly discoveryProbability: number;
  /** 1 - f1 / n: the Turing estimate of sample coverage. */
  readonly coverage: number;
}

/** Good-Turing: the discovery probability f1 / n and the coverage 1 - f1 / n, from the abundance per class. */
export function goodTuring(counts: readonly number[]): GoodTuringResult {
  const f = frequencies('goodTuring', counts);
  const discoveryProbability = f.f1 / f.n;
  return { ...f, discoveryProbability, coverage: 1 - discoveryProbability };
}

export interface ChaoResult extends Frequencies {
  /** Sample coverage in the Chao and Jost (2012) form. */
  readonly coverage: number;
  /** Chao1 estimate of the total number of classes. */
  readonly chao1: number;
}

/**
 * Sample coverage and Chao1 (Chao, Gotelli and co-authors 2014; Chao and Jost 2012):
 * coverage = 1 - (f1 / n) [(n - 1) f1 / ((n - 1) f1 + 2 f2)], and with f2 = 0 the fallback
 * 1 - (f1 / n) [(n - 1)(f1 - 1) / ((n - 1)(f1 - 1) + 2)].
 * Chao1 = S_obs + ((n - 1) / n) f1^2 / (2 f2), and with f2 = 0 the bias-corrected
 * S_obs + ((n - 1) / n) f1 (f1 - 1) / 2.
 */
export function chaoCoverage(counts: readonly number[]): ChaoResult {
  const f = frequencies('chaoCoverage', counts);
  const { n, observed, f1, f2 } = f;
  let coverage: number;
  if (f1 === 0) coverage = 1;
  else if (f2 > 0) coverage = 1 - (f1 / n) * (((n - 1) * f1) / ((n - 1) * f1 + 2 * f2));
  else coverage = 1 - (f1 / n) * (((n - 1) * (f1 - 1)) / ((n - 1) * (f1 - 1) + 2));
  const chao1 =
    f2 > 0
      ? observed + ((n - 1) / n) * ((f1 * f1) / (2 * f2))
      : observed + ((n - 1) / n) * ((f1 * (f1 - 1)) / 2);
  return { ...f, coverage, chao1 };
}

/** The Hill number of order q (the effective number of classes), plug-in from the abundances. */
export function hillNumber(counts: readonly number[], q: number): number {
  const f = frequencies('hillNumber', counts);
  if (!Number.isFinite(q)) throw new RangeError(`hillNumber: q must be finite, got ${q}`);
  const ps = counts.filter((c) => c > 0).map((c) => c / f.n);
  if (q === 0) return ps.length;
  if (q === 1) return Math.exp(-ps.reduce((s, p) => s + p * Math.log(p), 0));
  // sum p^q = 1 + sum p (p^(q-1) - 1) because the p sum to 1; expm1 and log1p keep the digits when q is near 1.
  const excess = ps.reduce((s, p) => s + p * Math.expm1((q - 1) * Math.log(p)), 0);
  if (excess > -0.5) return Math.exp(Math.log1p(excess) / (1 - q));
  // sum p^q is below one half (large q): 1 + excess cancels to a few digits, or to zero. Sum the positive terms in log space.
  const logs = ps.map((p) => q * Math.log(p));
  const top = logs.reduce((m, l) => Math.max(m, l), Number.NEGATIVE_INFINITY);
  const logSum = top + Math.log(logs.reduce((s, l) => s + Math.exp(l - top), 0));
  return Math.exp(logSum / (1 - q));
}

export interface HillNumbers {
  /** Richness: classes seen. */
  readonly q0: number;
  /** exp(Shannon entropy). */
  readonly q1: number;
  /** Inverse Simpson concentration. */
  readonly q2: number;
}

/** Hill numbers at q = 0, 1 and 2. */
export function hillNumbers(counts: readonly number[]): HillNumbers {
  frequencies('hillNumbers', counts);
  return { q0: hillNumber(counts, 0), q1: hillNumber(counts, 1), q2: hillNumber(counts, 2) };
}

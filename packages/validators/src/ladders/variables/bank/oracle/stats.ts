import type { Rng } from '../util';

/**
 * The statistics the weights items need, written here so the oracle never depends on the component: the Wilson
 * interval, its exact coverage at a design, and the threshold a correct interval clears with overwhelming
 * probability. Nothing in this file is exported to the component.
 */

/** The two-sided 95 percent normal quantile. */
export const Z95 = 1.959963984540054;

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log of the gamma function (Lanczos, g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const y = x - 1;
  let a = LANCZOS[0] as number;
  const t = y + 7.5;
  for (let i = 1; i < 9; i += 1) a += (LANCZOS[i] as number) / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

export const logChoose = (n: number, k: number): number =>
  logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);

/** The binomial probability of k successes in n trials at chance p. */
export function binomialPmf(n: number, k: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}

/** The Wilson score interval for c successes in n trials. */
export function wilson(c: number, n: number, z = Z95): [number, number] {
  const phat = c / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (phat + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function wilsonWidth(c: number, n: number, z = Z95): number {
  const [lo, hi] = wilson(c, n, z);
  return hi - lo;
}

/** The exact probability that the Wilson interval at n trials holds the true chance p. */
export function wilsonCoverage(p: number, n: number, z = Z95): number {
  let total = 0;
  for (let c = 0; c <= n; c += 1) {
    const [lo, hi] = wilson(c, n, z);
    if (lo - 1e-12 <= p && p <= hi + 1e-12) total += binomialPmf(n, c, p);
  }
  return total;
}

/**
 * The fewest of `replicates` intervals that must hold p for a correct 95 percent interval to pass: the Wilson
 * coverage at (p, n) less 0.03 (other correct intervals sit a little under or over it), less 5.5 binomial
 * standard deviations (a correct interval then fails on under one seed in 10 million).
 */
export function coverageThreshold(replicates: number, p: number, n: number): number {
  const kappa = Math.max(0.5, wilsonCoverage(p, n) - 0.03);
  const sd = Math.sqrt(replicates * kappa * (1 - kappa));
  return Math.max(0, Math.floor(replicates * kappa - 5.5 * sd));
}

/** Counts of n draws from the categorical `shares` (summing to 1), as a list of the value index per draw. */
export function drawCategorical(rng: Rng, n: number, shares: readonly number[]): number[] {
  const cut: number[] = [];
  let acc = 0;
  for (const s of shares) {
    acc += s;
    cut.push(acc);
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const u = rng.next();
    let k = 0;
    while (k < cut.length - 1 && u >= (cut[k] as number)) k += 1;
    out[i] = k;
  }
  return out;
}

/** The mix of one target share p and the rest split evenly over `others` values. */
export function targetMix(p: number, others: number): number[] {
  return [p, ...Array.from({ length: others }, () => (1 - p) / others)];
}

/** The exact probability that a relative frequency of n draws lies within z standard errors of the true chance p. */
export function bandInsideProbability(p: number, n: number, z = Z95): number {
  const se = Math.sqrt((p * (1 - p)) / n);
  let total = 0;
  for (let c = 0; c <= n; c += 1) {
    if (Math.abs(c / n - p) <= z * se + 1e-12) total += binomialPmf(n, c, p);
  }
  return total;
}

/** Skewed shares for a mix of `count` values (the largest several times the smallest), summing to 1. */
export function skewShares(rng: Rng, count: number): number[] {
  const raw = Array.from({ length: count }, () => 0.15 + rng.next() ** 2);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / total);
}

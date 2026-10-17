/**
 * Slow but obviously correct references for the interval items (docs/validators.md section 1, rule 7): the
 * Wilson interval, the Student t quantile by bisection on its distribution function, the Wilson interval on the
 * effective runs and the rate over goldens, each from the formulas docs/concepts/statistics.md states. Nothing
 * here imports the statistics package, so the comparison is between two implementations.
 */

/** The two-sided 95 percent normal quantile. */
export const Z95 = 1.959963984540054;

function logGamma(x: number): number {
  // Lanczos approximation, g = 7, n = 9.
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += (c[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The continued fraction of the regularized incomplete beta function (modified Lentz). */
function betaFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaFraction(x, a, b)) / a
    : 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** The 1 - alpha / 2 quantile of Student's t on df degrees of freedom, by bisection on P(|T| > t). */
export function tQuantile(df: number, alpha = 0.05): number {
  const tail = (t: number) => incompleteBeta(df / (df + t * t), df / 2, 0.5);
  let low = 0;
  let high = 1e7;
  for (let i = 0; i < 400; i += 1) {
    const mid = (low + high) / 2;
    if (tail(mid) > alpha) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export type Interval = { estimate: number; lower: number; upper: number };

/** The Wilson score interval of p on n observations with quantile q, bounds kept within 0 and 1. */
export function wilsonOn(p: number, n: number, q: number): Interval {
  const q2 = q * q;
  const denominator = 1 + q2 / n;
  const centre = (p + q2 / (2 * n)) / denominator;
  const half = (q * Math.sqrt((p * (1 - p)) / n + q2 / (4 * n * n))) / denominator;
  return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

export type Count = { n: number; k: number };

export type Effective = Interval & {
  n: number;
  clusters: number;
  effectiveN: number;
  designEffect: number;
  degenerate: boolean;
};

/**
 * `wilsonEffective` as docs/concepts/statistics.md states it: the pooled rate, the cluster-robust variance with
 * the small-cluster factor, n_eff kept within 1 to n, and the Wilson interval on n_eff with the t quantile on the
 * clusters less one (or z). When every block agrees, each cluster counts once.
 */
export function effectiveReference(counts: readonly Count[], quantile: 't' | 'z'): Effective {
  const g = counts.length;
  const n = counts.reduce((sum, c) => sum + c.n, 0);
  const k = counts.reduce((sum, c) => sum + c.k, 0);
  const p = k / n;
  const degenerate = p === 0 || p === 1;
  let effectiveN: number;
  if (degenerate) effectiveN = g;
  else if (g < 2) effectiveN = n;
  else {
    const ss = counts.reduce((sum, c) => sum + (c.k - p * c.n) ** 2, 0);
    const variance = ((g / (g - 1)) * ss) / (n * n);
    effectiveN = variance > 0 ? Math.min(n, Math.max(1, (p * (1 - p)) / variance)) : n;
  }
  const q = quantile === 'z' || g < 2 ? Z95 : tQuantile(g - 1);
  return {
    ...wilsonOn(p, effectiveN, q),
    n,
    clusters: g,
    effectiveN,
    designEffect: n / effectiveN,
    degenerate,
  };
}

/**
 * The rate over goldens of docs/concepts/statistics.md, "A rate over goldens": the plain Wilson interval with one
 * golden or one run per golden; each golden once with the normal quantile when every run agrees; else the Wilson
 * interval on n_eff with the t quantile on goldens less one.
 */
export function goldenRate(counts: readonly Count[]): Interval & { n: number; k: number } {
  const c = counts.length;
  const n = counts.reduce((sum, g) => sum + g.n, 0);
  const k = counts.reduce((sum, g) => sum + g.k, 0);
  const p = k / n;
  if (c < 2 || counts.every((g) => g.n === 1)) return { n, k, ...wilsonOn(p, n, Z95) };
  if (p === 0 || p === 1) return { n, k, ...wilsonOn(p, c, Z95), estimate: p };
  const variance = ((c / (c - 1)) * counts.reduce((sum, g) => sum + (g.k - p * g.n) ** 2, 0)) / n ** 2;
  const effective = variance > 0 ? Math.min(n, Math.max(1, (p * (1 - p)) / variance)) : n;
  return { n, k, ...wilsonOn(p, effective, tQuantile(c - 1)) };
}

/**
 * The runs the suite headline's mean over trees is worth (the headline's documented rule): p the mean of the tree
 * rates, the variance the larger of the between-tree s^2 / G and the sampling noise sum p_g (1 - p_g) / n_g / G^2;
 * no variance, or p at 0 or 1, counts each tree once; n_eff kept within 1 to the runs.
 */
export function treeMeanEffective(counts: readonly Count[]): {
  effective: number;
  designEffect: number;
  degenerate: boolean;
  mean: number;
} {
  const g = counts.length;
  const runs = counts.reduce((sum, c) => sum + c.n, 0);
  const rates = counts.map((c) => c.k / c.n);
  const p = rates.reduce((sum, r) => sum + r, 0) / g;
  const between = rates.reduce((sum, r) => sum + (r - p) ** 2, 0) / (g - 1) / g;
  const within =
    counts.reduce((sum, c, i) => sum + ((rates[i] as number) * (1 - (rates[i] as number))) / c.n, 0) /
    (g * g);
  const variance = Math.max(between, within);
  const degenerate = !(variance > 0) || p === 0 || p === 1;
  const effective = degenerate ? g : Math.min(runs, Math.max(1, (p * (1 - p)) / variance));
  return { effective, designEffect: runs / effective, degenerate, mean: p };
}

/** True when two numbers agree to `tolerance`, both absent, or both NaN. */
export function near(a: number | undefined, b: number | undefined, tolerance = 1e-7): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
}

export function show(interval: Partial<Interval> | undefined): string {
  if (!interval) return 'none';
  const f = (x: number | undefined) => (x === undefined ? '?' : x.toFixed(6));
  return `${f(interval.estimate)} [${f(interval.lower)}, ${f(interval.upper)}]`;
}

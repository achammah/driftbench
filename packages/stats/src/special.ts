/**
 * Special functions the tests and intervals need: log gamma, the regularized incomplete beta and
 * gamma functions, the normal distribution, and the binomial distribution. Pure TypeScript, no
 * dependency. Accuracy is close to double precision over the ranges driftbench uses.
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function, Lanczos approximation (g = 7, n = 9). */
export function logGamma(x: number): number {
  if (x <= 0 && Number.isInteger(x)) return Number.POSITIVE_INFINITY;
  if (x < 0.5) {
    // Reflection formula.
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  }
  const z = x - 1;
  let sum = LANCZOS[0] as number;
  for (let i = 1; i < 9; i += 1) sum += (LANCZOS[i] as number) / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Natural log of the binomial coefficient C(n, k). */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

const EPS = 1e-15;
const TINY = 1e-300;
const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI);

/**
 * The Stirling remainder logGamma(z) - ((z - 1/2) log z - z + log sqrt(2 pi)): about 1 / (12 z), and small where
 * logGamma itself is large. Series from z = 30 (the next term is below 1e-19); below that, from logGamma.
 */
function stirlingRemainder(z: number): number {
  if (z < 30) return logGamma(z) - ((z - 0.5) * Math.log(z) - z + HALF_LOG_2PI);
  const w = 1 / (z * z);
  return (1 / 12 - w * (1 / 360 - w * (1 / 1260 - w * (1 / 1680 - w / 1188)))) / z;
}

/**
 * The deviance term x log(x / np) + np - x (Loader 2000, as in R's bd0), which is small when x is near np. Its
 * series for |x - np| below a tenth of x + np keeps the digits that the direct form loses to cancellation.
 */
export function bd0(x: number, np: number): number {
  if (Math.abs(x - np) >= 0.1 * (x + np)) return x * Math.log(x / np) + np - x;
  let v = (x - np) / (x + np);
  let s = (x - np) * v;
  let ej = 2 * x * v;
  v *= v;
  for (let j = 1; j < 1000; j += 1) {
    ej *= v;
    const next = s + ej / (2 * j + 1);
    if (next === s) return next;
    s = next;
  }
  return s;
}

/**
 * x^a (1 - x)^b / B(a, b) with y = 1 - x, for the incomplete beta function. Written as
 * sqrt(a b / (2 pi (a + b))) exp(d(a + b) - d(a) - d(b) - bd0(a, (a + b) x) - bd0(b, (a + b) y)), d the Stirling
 * remainder, so that no two large logarithms are subtracted. The direct form
 * logGamma(a + b) - logGamma(a) - logGamma(b) + a log x + b log y loses about log10(a + b) digits to cancellation.
 */
function betaFront(x: number, y: number, a: number, b: number): number {
  const n = a + b;
  return (
    Math.sqrt((a * b) / (2 * Math.PI * n)) *
    Math.exp(
      stirlingRemainder(n) - stirlingRemainder(a) - stirlingRemainder(b) - bd0(a, n * x) - bd0(b, n * y),
    )
  );
}

/** x^a exp(-x) / Gamma(a), by the same device: sqrt(a / (2 pi)) exp(-bd0(a, x) - d(a)). */
function gammaFront(a: number, x: number): number {
  return Math.sqrt(a / (2 * Math.PI)) * Math.exp(-bd0(a, x) - stirlingRemainder(a));
}

/** The most terms a series or continued fraction of the incomplete beta or gamma function may run. */
const STEP_CEILING = 5_000_000;

/**
 * Terms allowed to the series and continued fractions of the incomplete gamma and beta functions at shape `scale` (a,
 * or the larger of a and b). Near the peak they fall off over about 8 sqrt(scale) steps, so 10000 steps stop short for
 * a shape above 1e6. The ceiling keeps a shape of 1e300 from running for longer than the machine lives: a function that
 * has not converged by then returns NaN, not the partial sum.
 */
export function seriesStepLimit(scale: number): number {
  return Math.min(STEP_CEILING, 10000 + Math.ceil(20 * Math.sqrt(scale)));
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  const steps = seriesStepLimit(Math.max(a, b));
  let converged = false;
  for (let m = 1; m <= steps; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) {
      converged = true;
      break;
    }
  }
  return converged ? h : Number.NaN;
}

/** Regularized incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return Number.NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = betaFront(x, 1 - x, a, b);
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Quantile of the Beta(a, b) distribution, by bisection on the regularized incomplete beta. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (Number.isNaN(p)) throw new RangeError('betaQuantile: p must not be NaN');
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-15 * hi) break;
  }
  return (lo + hi) / 2;
}

/** Regularized lower incomplete gamma P(a, x), series expansion (x < a + 1). */
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  const steps = seriesStepLimit(a);
  let converged = false;
  for (let n = 1; n <= steps; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) {
      converged = true;
      break;
    }
  }
  return converged ? sum * gammaFront(a, x) : Number.NaN;
}

/** Regularized upper incomplete gamma Q(a, x), continued fraction (x >= a + 1). */
function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  const steps = seriesStepLimit(a);
  let converged = false;
  for (let i = 1; i <= steps; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) {
      converged = true;
      break;
    }
  }
  return converged ? gammaFront(a, x) * h : Number.NaN;
}

/** Regularized upper incomplete gamma Q(a, x). */
export function upperIncompleteGamma(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaContinuedFraction(a, x);
}

/** Complementary error function. */
export function erfc(x: number): number {
  if (x === 0) return 1;
  if (x < 0) return 2 - erfc(-x);
  return upperIncompleteGamma(0.5, x * x);
}

/** Standard normal cumulative distribution function. */
export function normalCdf(z: number): number {
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Standard normal survival function, 1 - cdf, accurate in the upper tail. */
export function normalSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
  2.506628277459239,
];
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
];
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
  2.938163982698783,
];
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

function poly(coefs: readonly number[], x: number): number {
  let r = 0;
  for (const c of coefs) r = r * x + c;
  return r;
}

/** Quantile of the standard normal distribution: Acklam's approximation with one Halley refinement. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    throw new RangeError(`normalQuantile: p must lie in [0, 1], got ${p}`);
  }
  const low = 0.02425;
  let x: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = poly(ACKLAM_C, q) / (poly(ACKLAM_D, q) * q + 1);
  } else if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    x = (poly(ACKLAM_A, r) * q) / (poly(ACKLAM_B, r) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -poly(ACKLAM_C, q) / (poly(ACKLAM_D, q) * q + 1);
  }
  for (let i = 0; i < 2; i += 1) {
    // Above one half, cdf(x) - p is computed as (1 - p) - sf(x): 1 - p is exact there, and the difference of two
    // numbers near 1 would keep only the digits that p has left of the gap to 1.
    const e = p > 0.5 ? 1 - p - normalSf(x) : normalCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

/** Survival function of the chi-square distribution with df degrees of freedom. */
export function chiSquareSf(x: number, df: number): number {
  if (!(df > 0)) throw new RangeError(`chiSquareSf: df must be above 0, got ${df}`);
  if (x === Number.POSITIVE_INFINITY) return 0;
  if (x <= 0) return 1;
  return upperIncompleteGamma(df / 2, x / 2);
}

/** Binomial probability mass P(X = k) for X ~ Binomial(n, p). */
export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** Up to this n the binomial cumulative distribution is summed term by term; above it, the incomplete beta function. */
const BINOMIAL_SUM_LIMIT = 50;

/** Binomial cumulative distribution P(X <= k). */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (n > BINOMIAL_SUM_LIMIT && p > 0 && p < 1) {
    // P(X <= k) = I_{1-p}(n - k, k + 1): O(sqrt(n)) work, and no sum of n pmf terms each carrying a logGamma error.
    const j = Math.floor(k);
    return Math.min(1, incompleteBeta(1 - p, n - j, j + 1));
  }
  let sum = 0;
  for (let i = 0; i <= k; i += 1) sum += binomialPmf(i, n, p);
  return Math.min(1, sum);
}

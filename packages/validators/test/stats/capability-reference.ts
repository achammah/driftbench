/** Independent implementations of the four definitions in docs/concepts/statistics.md.
 * These do not read the bank fixtures or call the product's statistical helpers.
 */

// Integrate the normal density by its power series, then invert by bisection.
// The fixture probabilities are central enough to avoid tail cancellation here.
function normalQuantile(p: number): number {
  const cdf = (x: number): number => {
    let term = x;
    let sum = x;
    for (let k = 1; k < 160; k += 1) {
      term *= (-x * x) / (2 * k);
      const next = term / (2 * k + 1);
      sum += next;
      if (Math.abs(next) < 1e-18) break;
    }
    return 0.5 + sum / Math.sqrt(2 * Math.PI);
  };
  let lo = -5;
  let hi = 5;
  for (let i = 0; i < 64; i += 1) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function holm(pvalues: readonly number[], alpha = 0.05) {
  const order = pvalues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = pvalues.map(() => 0);
  let maximum = 0;
  order.forEach(({ p, i }, rank) => {
    maximum = Math.max(maximum, Math.min(1, (order.length - rank) * p));
    adjusted[i] = maximum;
  });
  return { adjusted, rejected: adjusted.map((p) => p <= alpha), alpha };
}

export function sampleSizeForEffect({
  effect,
  baselineRate,
  power = 0.8,
  alpha = 0.05,
  repeats = 1,
  rho = 0,
}: {
  effect: number;
  baselineRate: number;
  power?: number;
  alpha?: number;
  repeats?: number;
  rho?: number;
}) {
  const other = baselineRate - effect;
  const pooled = (baselineRate + other) / 2;
  const need =
    ((normalQuantile(1 - alpha / 2) * Math.sqrt(2 * pooled * (1 - pooled)) +
      normalQuantile(power) * Math.sqrt(baselineRate * (1 - baselineRate) + other * (1 - other))) /
      effect) **
    2;
  const designEffect = 1 + (repeats - 1) * rho;
  const n = Math.max(1, Math.ceil((need * designEffect) / repeats));
  return { n, effectiveN: (n * repeats) / designEffect, designEffect };
}

type Label = string | number | boolean;
export function kappaInterval(a: readonly Label[], b: readonly Label[], { alpha = 0.05 } = {}) {
  const labels = new Set([...a, ...b]);
  const n = a.length;
  const agreements = a.filter((label, i) => label === b[i]).length;
  let chancePairs = 0;
  for (const label of labels) {
    chancePairs += a.filter((x) => x === label).length * b.filter((x) => x === label).length;
  }
  const po = agreements / n;
  const pe = chancePairs / (n * n);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  const se = pe === 1 ? 0 : Math.sqrt((po * (1 - po)) / (n * (1 - pe) ** 2));
  const radius = normalQuantile(1 - alpha / 2) * se;
  return { kappa, se, lower: Math.max(-1, kappa - radius), upper: Math.min(1, kappa + radius) };
}

export function mcnemarMidP(b: number, c: number) {
  const n = b + c;
  const k = Math.min(b, c);
  let choose = 1n;
  let lower = 0n;
  for (let i = 0; i < k; i += 1) {
    lower += choose;
    choose = (choose * BigInt(n - i)) / BigInt(i + 1);
  }
  const pValue = n === 0 ? 1 : Math.min(1, Number(2n * lower + choose) / 2 ** n);
  return { pValue, b, c };
}

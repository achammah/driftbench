// M1.4 prototype: the envelope report of a block over its class (formulas: deep_1 section (c), Miller 2024).

/** Inverse standard normal CDF (Acklam's rational approximation, error below 1.2e-9). */
export function zOf(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -zOf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export function wilson(passes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = passes / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export const mean = (xs: number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length);
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/** One realisation's K outcomes (1 pass, 0 fail) and its cell (axis tuple key). */
export type Item = { cell: string; outcomes: number[] };

export type Envelope = {
  n: number;
  K: number;
  rate: number;
  /** Clustered by realisation (Miller Eq. 4 with equal cluster sizes reduces to the SE of the realisation means). */
  se: number;
  ci: [number, number];
  /** Wilson interval on realisations as the unit (n_eff = n). */
  wilson: [number, number];
  cells: { cell: string; n: number; passes: number; runs: number; rate: number; wilson: [number, number] }[];
  minP: number;
  lbMin: number;
  worst: { cell: string; pWorst: number }[];
  /** Phrasing share; undefined when K < 2. */
  rho?: number;
  sigma2?: number;
  varX?: number;
  /** Smallest drop this design detects at alpha 0.05 two-sided, power 0.80. */
  mde: number;
};

function betaSample(a: number, b: number, random: () => number): number {
  const g = (k: number) => gammaSample(k, random);
  const x = g(a);
  return x / (x + g(b));
}

/** Marsaglia and Tsang gamma sampler (k >= 1; boosted for k < 1). */
function gammaSample(k: number, random: () => number): number {
  if (k < 1) return gammaSample(k + 1, random) * random() ** (1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = random();
      const u2 = random();
      x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function envelope(items: Item[], random: () => number, alpha = 0.05, minCell = 1): Envelope {
  const n = items.length;
  const K = Math.min(...items.map((i) => i.outcomes.length));
  const means = items.map((i) => mean(i.outcomes));
  const rate = mean(means);
  const se = Math.sqrt(variance(means) / n);
  const byCell = new Map<string, Item[]>();
  for (const item of items) byCell.set(item.cell, [...(byCell.get(item.cell) ?? []), item]);
  const cells = [...byCell.entries()]
    .filter(([, list]) => list.length >= minCell)
    .map(([cell, list]) => {
      const passes = list.reduce((s, i) => s + i.outcomes.reduce((a, b) => a + b, 0), 0);
      const runs = list.reduce((s, i) => s + i.outcomes.length, 0);
      return { cell, n: list.length, passes, runs, rate: passes / runs, wilson: wilson(passes, runs) };
    });
  const C = Math.max(1, cells.length);
  const zC = zOf(1 - alpha / C);
  const minP = Math.min(...cells.map((c) => c.rate));
  // Effective n = realisations, not runs, when the K runs of one string are correlated.
  const lbMin = Math.min(...cells.map((c) => wilson(c.rate * c.n, c.n, zC)[0]));
  const draws = 4000;
  const wins = new Map<string, number>();
  for (let d = 0; d < draws; d++) {
    let low = Number.POSITIVE_INFINITY;
    let at = '';
    for (const c of cells) {
      const theta = betaSample(1 + c.passes, 1 + c.runs - c.passes, random);
      if (theta < low) {
        low = theta;
        at = c.cell;
      }
    }
    wins.set(at, (wins.get(at) ?? 0) + 1);
  }
  const worst = [...wins.entries()].map(([cell, w]) => ({ cell, pWorst: w / draws })).sort((a, b) => b.pWorst - a.pWorst).slice(0, 3);
  let rho: number | undefined;
  let sigma2: number | undefined;
  let varX: number | undefined;
  if (K >= 2) {
    sigma2 = mean(items.map((i) => variance(i.outcomes)));
    varX = Math.max(0, variance(means) - sigma2 / K);
    rho = varX + sigma2 === 0 ? 0 : varX / (varX + sigma2);
  }
  const mde = (zOf(1 - alpha / 2) + zOf(0.8)) * se;
  return { n, K, rate, se, ci: [rate - 1.96 * se, rate + 1.96 * se], wilson: wilson(rate * n, n), cells, minP, lbMin, worst, rho, sigma2, varX, mde };
}

import { mulberry32, quantileSorted, wilson, zFor } from '@agent-nexus/driftbench-stats';

/**
 * What the decisions of a reader say about the shares of a variable's values.
 *
 * A reader is not exact. Without a calibration set the shares are the shares of its decisions, with a Wilson
 * interval that covers sampling only. With a calibration set (conversations whose value a person knows, read
 * by the same reader) the confusion of the reader is estimated and the shares are the maximum-likelihood shares
 * under that confusion (expectation-maximisation). The interval is the 2.5 and 97.5 percent points of the
 * shares that follow from posterior draws of both the decisions and the confusion: the column shares of the
 * decisions and each row of the confusion are drawn from a Dirichlet distribution with a half added to every
 * cell (Jeffreys). A column no conversation showed therefore still has a chance of being drawn, which is what
 * keeps the interval open at a rare share; a redraw from the observed counts alone would leave it closed.
 */

/** Decisions on the conversations read for one variable. `values` follows the order of the variable's values. */
export type Tally = { values: number[]; unsure: number; absent: number };

/**
 * The reader's decisions on conversations whose value is known. One row per true class: the values of the
 * variable in order, then optionally "absent". A row counts the decisions the reader gave on its conversations:
 * one cell per value, then unsure, then absent.
 */
export type ConfusionCounts = number[][];

export type EstimateOptions = {
  /** The level of the interval. Default 0.95. */
  confidence?: number;
  /** Bootstrap draws with a calibration set. Default 400. */
  resamples?: number;
  /** Seed of the bootstrap, so the same input gives the same interval. Default 1. */
  seed?: number;
  /** Replaces the confidence-based z, for a simultaneous interval over several values. */
  z?: number;
};

export type ShareEstimate = {
  /** Shares of the values among the conversations that show a value; they sum to 1. */
  shares: number[];
  lower: number[];
  upper: number[];
  /** True when a calibration set corrected the shares for the reader's errors. */
  corrected: boolean;
};

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Counts per decision column: the values, then unsure, then absent. */
const columns = (tally: Tally): number[] => [...tally.values, tally.unsure, tally.absent];

export function estimateShares(
  tally: Tally,
  confusion?: ConfusionCounts,
  options: EstimateOptions = {},
): ShareEstimate {
  const k = tally.values.length;
  const decided = sum(tally.values);
  if (k < 2) throw new RangeError('estimateShares: a variable needs at least two values');
  if (decided < 1) throw new RangeError('estimateShares: no conversation was decided');
  const z = options.z ?? zFor(1 - (options.confidence ?? 0.95));
  if (confusion === undefined) {
    const intervals = tally.values.map((count) => wilson(count, decided, z));
    return {
      shares: tally.values.map((count) => count / decided),
      lower: intervals.map((interval) => interval.lower),
      upper: intervals.map((interval) => interval.upper),
      corrected: false,
    };
  }
  checkConfusion(confusion, k);
  const alpha = 1 - (options.confidence ?? 0.95);
  const resamples = options.resamples ?? 400;
  const rng = mulberry32(options.seed ?? 1);
  const observed = columns(tally);
  const shares = valueShares(correct(observed, confusion), k);
  const draws: number[][] = Array.from({ length: k }, () => []);
  const decisions = sum(observed);
  for (let b = 0; b < resamples; b++) {
    const q = dirichlet(observed, rng).map((share) => share * decisions);
    const rows = confusion.map((row) => dirichlet(row, rng));
    const drawn = valueShares(correct(q, rows), k);
    if (drawn.every(Number.isFinite)) {
      for (const [i, share] of drawn.entries()) draws[i]?.push(share);
    }
  }
  const bound = (i: number, p: number) => {
    const sorted = [...(draws[i] ?? [])].sort((a, b) => a - b);
    return sorted.length === 0 ? Number.NaN : quantileSorted(sorted, p);
  };
  // A percentile interval from a bootstrap that omits the point estimate would miss it by chance; keep it inside.
  const lower = shares.map((share, i) => Math.min(share, bound(i, alpha / 2)));
  const upper = shares.map((share, i) => Math.max(share, bound(i, 1 - alpha / 2)));
  return { shares, lower, upper, corrected: true };
}

function checkConfusion(confusion: ConfusionCounts, k: number): void {
  if (confusion.length !== k && confusion.length !== k + 1) {
    throw new RangeError(`the calibration needs one row per value (${k}), and optionally one for absent`);
  }
  for (const [i, row] of confusion.entries()) {
    if (row.length !== k + 2) throw new RangeError(`calibration row ${i} needs ${k + 2} cells`);
    if (sum(row) < 1) throw new RangeError(`calibration row ${i} holds no conversation`);
  }
}

/** The shares among the values: the true-class shares without the absent class, renormalised. */
function valueShares(classShares: number[], k: number): number[] {
  const values = classShares.slice(0, k);
  const total = sum(values);
  return values.map((share) => (total > 0 ? share / total : Number.NaN));
}

/**
 * Expectation-maximisation for the share of each true class when only the decisions are seen and the
 * confusion matrix is known. `rows[i][j]` counts decisions j on conversations of true class i.
 */
function correct(observed: readonly number[], rows: readonly number[][]): number[] {
  const classes = rows.length;
  const columnCount = observed.length;
  const confusion = rows.map((row) => {
    const total = sum(row);
    return row.map((cell) => (total > 0 ? cell / total : 0));
  });
  let pi = Array.from({ length: classes }, () => 1 / classes);
  for (let iteration = 0; iteration < 500; iteration++) {
    const next = new Array<number>(classes).fill(0);
    for (let j = 0; j < columnCount; j++) {
      const count = observed[j] ?? 0;
      if (count === 0) continue;
      let norm = 0;
      for (let i = 0; i < classes; i++) norm += (pi[i] ?? 0) * (confusion[i]?.[j] ?? 0);
      if (norm === 0) continue;
      for (let i = 0; i < classes; i++) {
        next[i] = (next[i] ?? 0) + (count * (pi[i] ?? 0) * (confusion[i]?.[j] ?? 0)) / norm;
      }
    }
    const scale = sum(next);
    if (scale === 0) break;
    const updated = next.map((x) => x / scale);
    const change = Math.max(...updated.map((x, i) => Math.abs(x - (pi[i] ?? 0))));
    pi = updated;
    if (change < 1e-10) break;
  }
  return pi;
}

/** A draw from Dirichlet(counts + 1/2): the posterior of a multinomial under the Jeffreys prior. */
function dirichlet(counts: readonly number[], rng: () => number): number[] {
  const g = counts.map((count) => gamma(count + 0.5, rng));
  const total = sum(g);
  return g.map((x) => x / total);
}

/** A draw from Gamma(shape, 1) by Marsaglia and Tsang; a shape below 1 is raised by one and scaled back. */
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * rng() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A standard normal draw by the Box and Muller method. */
function normal(rng: () => number): number {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

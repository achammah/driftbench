import type { FamilyCoverageCell, FamilyCoverageResult } from '@agent-nexus/driftbench-stats';
import { call, type Tol } from './exact';
import { type BankItem, fail, ok } from './item';

/**
 * Two existing public capabilities described in docs/concepts/statistics.md, "Intervals" and "Suites with
 * parents": custom statistics on resampled clusters, and simulated family coverage. The reference code never
 * calls a statistics-package function. Small samples allow direct beta-binomial likelihood products instead
 * of the product's cached log-rising-factorial implementation. The seeded simulation deliberately replays
 * the documented model and the current RNG algorithm; it does not claim a population coverage guarantee.
 */
type Tree = { n: number; k: number };
type Method = keyof FamilyCoverageResult['coverage'];
const METHODS: Method[] = ['naive wilson', 'children as trees', 'families as trees'];

function compare(actual: unknown, expected: unknown, tolerance: Tol, path = 'result'): string[] {
  if (typeof expected === 'number') {
    const allowed = Number.isInteger(expected) ? 0 : tolerance.abs + tolerance.rel * Math.abs(expected);
    return typeof actual === 'number' && Math.abs(actual - expected) <= allowed
      ? []
      : [`${path}: got ${String(actual)}, expected ${expected}`];
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return [`${path}: expected an object`];
    if (Array.isArray(expected) && (!Array.isArray(actual) || actual.length !== expected.length))
      return [`${path}: expected an array of length ${expected.length}`];
    return Object.entries(expected).flatMap(([key, value]) =>
      compare((actual as Record<string, unknown>)[key], value, tolerance, `${path}.${key}`),
    );
  }
  return actual === expected ? [] : [`${path}: got ${String(actual)}, expected ${String(expected)}`];
}

/** Mulberry32's published integer recurrence, independent of the export under test. */
function stream(seed: number): () => number {
  let word = seed >>> 0;
  return () => {
    word = (word + 0x6d2b79f5) >>> 0;
    let x = Math.imul(word ^ (word >>> 15), word | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Marsaglia-Tsang gamma draws, with the same draw order needed for a seeded replay. */
function gamma(next: () => number, shape: number): number {
  if (shape < 1) return gamma(next, shape + 1) * (1 - next()) ** (1 / shape);
  const d = shape - 1 / 3;
  for (;;) {
    const z = Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
    const v = (1 + z / Math.sqrt(9 * d)) ** 3;
    if (v <= 0) continue;
    if (Math.log(1 - next()) < (z * z) / 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

function beta(next: () => number, mean: number, concentration: number): number {
  const a = gamma(next, concentration * mean);
  return a / (a + gamma(next, concentration * (1 - mean)));
}

/** Direct products on the documented posterior grid; no production interval or special functions. */
function posteriorBounds(trees: Tree[]): [number, number] {
  const weights = Array.from({ length: 100 }, (_, i) => {
    const theta = (i + 0.5) / 100;
    let marginal = 0;
    for (let j = 0; j < 40; j += 1) {
      const d = Math.exp(Math.log(0.02) + (j * (Math.log(60) - Math.log(0.02))) / 39);
      let likelihood = d * Math.exp(-d);
      for (const { n, k } of trees) {
        for (let r = 0; r < k; r += 1) likelihood *= (d * theta + r) / (d + r);
        for (let r = 0; r < n - k; r += 1) likelihood *= (d * (1 - theta) + r) / (d + k + r);
      }
      marginal += likelihood;
    }
    return marginal;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  const quantile = (p: number): number => {
    let below = 0;
    for (let i = 0; i < weights.length; i += 1) {
      const share = (weights[i] as number) / total;
      if (below + share >= p) return (i + (p - below) / share) / 100;
      below += share;
    }
    return 1;
  };
  const estimate = trees.reduce((sum, tree) => sum + tree.k / tree.n, 0) / trees.length;
  return [Math.min(estimate, quantile(0.025)), Math.max(estimate, quantile(0.975))];
}

function wilsonBounds(trees: Tree[]): [number, number] {
  const n = trees.reduce((sum, tree) => sum + tree.n, 0);
  const p = trees.reduce((sum, tree) => sum + tree.k, 0) / n;
  const z = 1.959963984540054;
  const denominator = n + z * z;
  const center = (n * p + (z * z) / 2) / denominator;
  const half = (z * Math.sqrt(n * p * (1 - p) + (z * z) / 4)) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function familyReference(cell: FamilyCoverageCell, seed: number, reps: number): FamilyCoverageResult {
  const next = stream(seed);
  const pool = typeof cell.children === 'number' ? [cell.children] : cell.children;
  const coverage = Object.fromEntries(METHODS.map((name) => [name, 0])) as Record<Method, number>;
  const width = { ...coverage };
  for (let rep = 0; rep < reps; rep += 1) {
    const children: Tree[] = [];
    const families: Tree[] = [];
    for (let f = 0; f < cell.families; f += 1) {
      const count = pool[Math.floor(next() * pool.length)] as number;
      const rate = beta(next, cell.theta, cell.dFamily);
      const family = { n: 0, k: 0 };
      for (let child = 0; child < count; child += 1) {
        const chance = beta(next, rate, cell.dChild);
        let successes = 0;
        for (let run = 0; run < cell.runs; run += 1) if (next() < chance) successes += 1;
        children.push({ n: cell.runs, k: successes });
        family.n += cell.runs;
        family.k += successes;
      }
      families.push(family);
    }
    const intervals = [wilsonBounds(children), posteriorBounds(children), posteriorBounds(families)];
    METHODS.forEach((method, i) => {
      const [lower, upper] = intervals[i] as [number, number];
      coverage[method] += Number(lower <= cell.theta && cell.theta <= upper) / reps;
      width[method] += (upper - lower) / reps;
    });
  }
  return { cell, reps, coverage, width };
}

const FAMILY_CASES: { name: string; cell: FamilyCoverageCell }[] = [
  { name: 'fixed-children', cell: { families: 4, children: 2, runs: 3, theta: 0.6, dFamily: 2, dChild: 8 } },
  {
    name: 'unequal-children',
    cell: { families: 3, children: [1, 3], runs: 2, theta: 0.35, dFamily: 0.7, dChild: 1.3 },
  },
];

/** Sum, rather than mean, makes unequal cluster lengths observable in every resample. */
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function bootstrapReference(
  groups: number[][],
  seed: number,
  iterations: number,
  method: 'basic' | 'percentile',
) {
  const next = stream(seed);
  const estimates = Array.from({ length: iterations }, () =>
    sum(
      Array.from(
        { length: groups.length },
        () => groups[Math.floor(next() * groups.length)] as number[],
      ).flat(),
    ),
  ).sort((a, b) => a - b);
  const quantile = (p: number): number => {
    const position = p * (estimates.length - 1);
    const lo = Math.floor(position);
    return (
      (estimates[lo] as number) +
      (position - lo) * ((estimates[Math.ceil(position)] as number) - (estimates[lo] as number))
    );
  };
  const estimate = sum(groups.flat());
  const low = quantile(0.1);
  const high = quantile(0.9);
  return {
    estimate,
    lower: method === 'basic' ? 2 * estimate - high : low,
    upper: method === 'basic' ? 2 * estimate - low : high,
    iterations,
    clusters: groups.length,
    method,
    seed,
  };
}

export function userCapabilityItems(): BankItem[] {
  return [
    ...FAMILY_CASES.map(
      ({ name, cell }): BankItem => ({
        id: `exact.simulateFamilyCoverage.user-${name}`,
        family: 'exact-estimators',
        tier: 4,
        level: 'simulation',
        component: 'packages/stats/src/simulate.ts',
        cause:
          'simulateFamilyCoverage does not replay the nested family model and aggregate all three intervals',
        check: ({ s, seed }) => {
          const reps = 5;
          const expected = familyReference(cell, seed, reps);
          const actual = call(s, 'simulateFamilyCoverage', cell, { seed, reps });
          const errors = compare(actual, expected, { rel: 1e-10, abs: 1e-12 });
          return errors.length ? fail(`simulateFamilyCoverage ${name}: ${errors.join('; ')}`) : ok();
        },
      }),
    ),
    ...(['percentile', 'basic'] as const).flatMap((method) =>
      [true, false].map(
        (single): BankItem => ({
          id: `exact.bootstrapCI.user-${single ? 'one-cluster' : 'resampled-clusters'}-${method}`,
          family: 'exact-estimators',
          tier: 3,
          level: 'analytic',
          component: 'packages/stats/src/intervals.ts',
          cause: single
            ? 'bootstrapCI does not use the custom statistic for its point estimate'
            : 'bootstrapCI does not use the custom statistic on whole resampled clusters',
          check: ({ s, seed }) => {
            const groups = single ? [[1, 2, 4]] : [[1, 2, 4], [8], [3, 16]];
            const iterations = 41;
            const actual = call(s, 'bootstrapCI', groups.flat(), {
              clusters: groups.flatMap((group, index) => group.map(() => index)),
              iterations,
              method,
              alpha: 0.2,
              seed,
              statistic: sum,
            });
            const expected = bootstrapReference(groups, seed, iterations, method);
            const errors = compare(actual, expected, { rel: 1e-12, abs: 1e-12 });
            return errors.length ? fail(`bootstrapCI custom sum, ${method}: ${errors.join('; ')}`) : ok();
          },
        }),
      ),
    ),
  ];
}

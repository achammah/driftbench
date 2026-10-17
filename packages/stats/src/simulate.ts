/** Coverage of the interval methods on simulated suites of trees: the check that an interval keeps its promise. */

import { assertCount, assertFinite, assertProbability, mulberry32 } from './basics';
import { wilsonEffective } from './effective';
import { hierarchicalBetaBinomial } from './hierarchical';
import { wilson } from './intervals';

/**
 * One simulated setting, the clustered model of Bowyer, Aitchison and Ivanova (2025): every tree g has a pass rate
 * theta_g ~ Beta(d theta, d (1 - theta)) and each of its blocks passes with that rate. A small concentration d
 * means strong agreement inside a tree (the intraclass correlation is 1 / (1 + d)); a very large d is the
 * independent control.
 */
export interface CoverageCell {
  /** Trees in the suite. */
  readonly trees: number;
  /** One size for every tree, or a pool the sizes are drawn from with replacement. */
  readonly sizes: number | readonly number[];
  /** The hyper-mean the intervals try to cover. */
  readonly theta: number;
  readonly d: number;
}

export interface CoverageOptions {
  /** Simulated suites. */
  readonly reps: number;
  /** Seed of the generator. Default 1. The same seed gives the same result. */
  readonly seed?: number;
}

export type CoverageMethod = 'naive wilson' | 'wilson effective z' | 'wilson effective t' | 'hierarchical';

export interface CoverageResult {
  readonly cell: CoverageCell;
  readonly reps: number;
  /** Share of suites whose interval held theta, per method. */
  readonly coverage: Record<CoverageMethod, number>;
  /** Mean interval width, per method. */
  readonly width: Record<CoverageMethod, number>;
}

const METHODS: readonly CoverageMethod[] = [
  'naive wilson',
  'wilson effective z',
  'wilson effective t',
  'hierarchical',
];

/** A standard normal draw (Box-Muller). */
function normal(rng: () => number): number {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A Gamma(shape, 1) draw (Marsaglia and Tsang 2000; shapes below 1 through Gamma(shape + 1) U^(1 / shape)). */
function gamma(rng: () => number, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * (1 - rng()) ** (1 / shape);
  const c = shape - 1 / 3;
  const s = 1 / Math.sqrt(9 * c);
  for (;;) {
    const x = normal(rng);
    const v = (1 + s * x) ** 3;
    if (v <= 0) continue;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + c - c * v + c * Math.log(v)) return c * v;
  }
}

function beta(rng: () => number, a: number, b: number): number {
  const x = gamma(rng, a);
  const y = gamma(rng, b);
  return x / (x + y);
}

function binomial(rng: () => number, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (rng() < p) k += 1;
  return k;
}

/**
 * The coverage and width of four 95 percent intervals on simulated suites of one cell: Wilson on all blocks as if
 * independent, Wilson on the effective blocks with the normal and with the Student t quantile, and the
 * hierarchical interval. Coverage near 0.95 is the promise. Deterministic for a seed.
 */
export function simulateCoverage(cell: CoverageCell, options: CoverageOptions): CoverageResult {
  assertCount('simulateCoverage', 'trees', cell.trees);
  assertCount('simulateCoverage', 'reps', options.reps);
  assertProbability('simulateCoverage', 'theta', cell.theta, true);
  assertFinite('simulateCoverage', 'd', cell.d);
  if (!(cell.trees >= 1))
    throw new RangeError(`simulateCoverage: trees must be at least 1, got ${cell.trees}`);
  if (!(options.reps >= 1))
    throw new RangeError(`simulateCoverage: reps must be at least 1, got ${options.reps}`);
  if (!(cell.d > 0)) throw new RangeError(`simulateCoverage: d must be above 0, got ${cell.d}`);
  const pool = typeof cell.sizes === 'number' ? [cell.sizes] : cell.sizes;
  if (pool.length === 0) throw new RangeError('simulateCoverage: sizes must not be empty');
  for (const size of pool) assertCount('simulateCoverage', 'size', size);
  if (pool.some((size) => size < 1)) throw new RangeError('simulateCoverage: every size must be at least 1');
  const rng = mulberry32(options.seed ?? 1);
  const held: Record<CoverageMethod, number> = {
    'naive wilson': 0,
    'wilson effective z': 0,
    'wilson effective t': 0,
    hierarchical: 0,
  };
  const widths = { ...held };
  const tally = (method: CoverageMethod, lower: number, upper: number): void => {
    if (lower <= cell.theta && cell.theta <= upper) held[method] += 1;
    widths[method] += upper - lower;
  };
  for (let rep = 0; rep < options.reps; rep += 1) {
    const trees: { n: number; k: number }[] = [];
    let n = 0;
    let k = 0;
    for (let g = 0; g < cell.trees; g += 1) {
      const size = pool[Math.floor(rng() * pool.length)] as number;
      const rate = beta(rng, cell.d * cell.theta, cell.d * (1 - cell.theta));
      const passed = binomial(rng, size, rate);
      trees.push({ n: size, k: passed });
      n += size;
      k += passed;
    }
    const naive = wilson(k, n);
    tally('naive wilson', naive.lower, naive.upper);
    const z = wilsonEffective(trees, { quantile: 'z' });
    tally('wilson effective z', z.lower, z.upper);
    const t = wilsonEffective(trees, { quantile: 't' });
    tally('wilson effective t', t.lower, t.upper);
    const h = hierarchicalBetaBinomial(trees);
    tally('hierarchical', h.lower, h.upper);
  }
  const coverage = { ...held };
  for (const method of METHODS) {
    coverage[method] = held[method] / options.reps;
    widths[method] /= options.reps;
  }
  return { cell, reps: options.reps, coverage, width: widths };
}

/**
 * One simulated setting of a suite with parents: a family is a root and its descendants. Every family f has a pass
 * rate phi_f ~ Beta(dFamily theta, dFamily (1 - theta)), every child c of f a rate theta_c ~ Beta(dChild phi_f,
 * dChild (1 - phi_f)), and each child is run `runs` times. A small dFamily means the children of one family move
 * together (the intraclass correlation between families is 1 / (1 + dFamily)); a small dChild means the runs of
 * one child do.
 */
export interface FamilyCoverageCell {
  /** Families (roots) in the suite. */
  readonly families: number;
  /** Children per family: one number for every family, or a pool the sizes are drawn from with replacement. */
  readonly children: number | readonly number[];
  /** Runs of each child. */
  readonly runs: number;
  /** The hyper-mean the intervals try to cover. */
  readonly theta: number;
  /** Concentration of the family rates around theta. */
  readonly dFamily: number;
  /** Concentration of the child rates around their family's rate. */
  readonly dChild: number;
}

export type FamilyCoverageMethod = 'naive wilson' | 'children as trees' | 'families as trees';

export interface FamilyCoverageResult {
  readonly cell: FamilyCoverageCell;
  readonly reps: number;
  /** Share of suites whose interval held theta, per reading. */
  readonly coverage: Record<FamilyCoverageMethod, number>;
  /** Mean interval width, per reading. */
  readonly width: Record<FamilyCoverageMethod, number>;
}

const FAMILY_METHODS: readonly FamilyCoverageMethod[] = [
  'naive wilson',
  'children as trees',
  'families as trees',
];

/**
 * The coverage and width of three 95 percent intervals on simulated suites with parents: Wilson on all runs as if
 * independent, the hierarchical interval with every child as a tree (the golden, as the suite headline groups
 * today), and the hierarchical interval with every family as a tree (the runs of a root and all its descendants
 * pooled). Coverage near 0.95 is the promise; the result is what was measured, whether or not it keeps it.
 * Deterministic for a seed.
 */
export function simulateFamilyCoverage(
  cell: FamilyCoverageCell,
  options: CoverageOptions,
): FamilyCoverageResult {
  const name = 'simulateFamilyCoverage';
  assertCount(name, 'families', cell.families);
  assertCount(name, 'runs', cell.runs);
  assertCount(name, 'reps', options.reps);
  assertProbability(name, 'theta', cell.theta, true);
  assertFinite(name, 'dFamily', cell.dFamily);
  assertFinite(name, 'dChild', cell.dChild);
  if (!(cell.families >= 1))
    throw new RangeError(`${name}: families must be at least 1, got ${cell.families}`);
  if (!(cell.runs >= 1)) throw new RangeError(`${name}: runs must be at least 1, got ${cell.runs}`);
  if (!(options.reps >= 1)) throw new RangeError(`${name}: reps must be at least 1, got ${options.reps}`);
  if (!(cell.dFamily > 0)) throw new RangeError(`${name}: dFamily must be above 0, got ${cell.dFamily}`);
  if (!(cell.dChild > 0)) throw new RangeError(`${name}: dChild must be above 0, got ${cell.dChild}`);
  const pool = typeof cell.children === 'number' ? [cell.children] : cell.children;
  if (pool.length === 0) throw new RangeError(`${name}: children must not be empty`);
  for (const size of pool) assertCount(name, 'children', size);
  if (pool.some((size) => size < 1)) throw new RangeError(`${name}: every family needs at least one child`);
  const rng = mulberry32(options.seed ?? 1);
  const held: Record<FamilyCoverageMethod, number> = {
    'naive wilson': 0,
    'children as trees': 0,
    'families as trees': 0,
  };
  const widths = { ...held };
  const tally = (method: FamilyCoverageMethod, lower: number, upper: number): void => {
    if (lower <= cell.theta && cell.theta <= upper) held[method] += 1;
    widths[method] += upper - lower;
  };
  for (let rep = 0; rep < options.reps; rep += 1) {
    const childTrees: { n: number; k: number }[] = [];
    const familyTrees: { n: number; k: number }[] = [];
    for (let f = 0; f < cell.families; f += 1) {
      const size = pool[Math.floor(rng() * pool.length)] as number;
      const familyRate = beta(rng, cell.dFamily * cell.theta, cell.dFamily * (1 - cell.theta));
      const family = { n: 0, k: 0 };
      for (let c = 0; c < size; c += 1) {
        const childRate = beta(rng, cell.dChild * familyRate, cell.dChild * (1 - familyRate));
        const passed = binomial(rng, cell.runs, childRate);
        childTrees.push({ n: cell.runs, k: passed });
        family.n += cell.runs;
        family.k += passed;
      }
      familyTrees.push(family);
    }
    const runs = childTrees.reduce((sum, tree) => sum + tree.n, 0);
    const passes = childTrees.reduce((sum, tree) => sum + tree.k, 0);
    const naive = wilson(passes, runs);
    tally('naive wilson', naive.lower, naive.upper);
    const byChild = hierarchicalBetaBinomial(childTrees);
    tally('children as trees', byChild.lower, byChild.upper);
    const byFamily = hierarchicalBetaBinomial(familyTrees);
    tally('families as trees', byFamily.lower, byFamily.upper);
  }
  const coverage = { ...held };
  for (const method of FAMILY_METHODS) {
    coverage[method] = held[method] / options.reps;
    widths[method] /= options.reps;
  }
  return { cell, reps: options.reps, coverage, width: widths };
}

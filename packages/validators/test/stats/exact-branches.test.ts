import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { branchItems } from '../../src/ladders/stats/bank/exact-branches';
import { runItem } from '../../src/ladders/stats/bank/index';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

/**
 * The branch items of the statistics bank (bank/exact-branches.ts) against planted faults.
 *
 * 1. Every branch item fails under a fault of its own function: the numbers 0.2 percent off, the function
 *    throwing, or, where the item reads a count, a zero or a one that a relative change cannot move, a fault
 *    written for that item.
 * 2. Faults planted in a copy of the package source, one branch each, fail the items of that branch and leave the
 *    items of the neighbouring branches passing: the items are not one check repeated.
 */
const items = branchItems();
const byId = new Map(items.map((item) => [item.id, item]));

type Fn = (...args: unknown[]) => unknown;
const S = real as unknown as Record<string, Fn>;

function nudge(value: unknown): unknown {
  if (typeof value === 'number') return Number.isInteger(value) ? value : value * 1.002;
  if (Array.isArray(value)) return value.map(nudge);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nudge(v)]));
  return value;
}
const scale = (value: unknown): unknown => {
  if (typeof value === 'number') return value * 1.01;
  if (Array.isArray(value)) return value.map(scale);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scale(v)]));
  return value;
};

/** Faults for the items whose numbers a relative change of 0.2 percent cannot move (zeros, ones, counts). */
const OWN_FAULT: Record<string, (original: Fn) => Fn> = {
  'exact.binomialCdf.edges':
    (f) =>
    (...a) =>
      (f(...a) as number) + 0.01,
  'exact.unreliability.constant':
    (f) =>
    (...a) =>
      (f(...a) as number) + 1e-6,
  'exact.sampleVariance.constant':
    (f) =>
    (...a) =>
      (f(...a) as number) + 1e-6,
  'exact.designEffect.no-clustering':
    (f) =>
    (...a) =>
      scale(f(...a)),
  'exact.effectiveSampleSize.no-clustering':
    (f) =>
    (...a) =>
      scale(f(...a)),
  'exact.effectiveSampleSize.full-correlation':
    (f) =>
    (...a) =>
      scale(f(...a)),
  'exact.goodTuring.all-singletons':
    (f) =>
    (...a) => {
      const r = f(...a) as { coverage: number; discoveryProbability: number };
      return { ...r, coverage: r.discoveryProbability, discoveryProbability: r.coverage };
    },
  'exact.goodTuring.no-singletons':
    (f) =>
    (...a) => {
      const r = f(...a) as { coverage: number; discoveryProbability: number };
      return { ...r, coverage: r.discoveryProbability, discoveryProbability: r.coverage };
    },
  'exact.goodTuring.fields':
    (f) =>
    (...a) => {
      const r = f(...a) as { f1: number; f2: number };
      return { ...r, f1: r.f2, f2: r.f1 + 1 };
    },
  'exact.hillNumber.single-class':
    (f) =>
    (...a) =>
      scale(f(...a)),
  'exact.hillNumber.richness-ignores-zeros':
    (f) =>
    (...a) =>
      a[1] === 0 ? (a[0] as number[]).length : f(...a),
  'exact.icc.zero-total':
    (f) =>
    (...a) =>
      (f(...a) as { icc: number }[]).map((x) => ({ ...x, icc: x.icc === 0 ? 1 : x.icc })),
  // naive rounding of the exact shares in place of the integer optimum, floor for the sum and the minimum
  'exact.neymanAllocation.integer-optimum':
    (f) =>
    (...a) => {
      const r = f(...a) as { exact: number[]; allocated: number[] };
      return { ...r, allocated: r.exact.map((x) => Math.round(x)) };
    },
  'exact.neymanAllocation.sums-to-total':
    (f) =>
    (...a) => {
      const r = f(...a) as { exact: number[]; allocated: number[] };
      return { ...r, allocated: r.exact.map((x) => Math.floor(x)) };
    },
  'exact.neymanAllocation.zero-spread':
    (f) =>
    (...a) => {
      const r = f(...a) as { exact: number[] };
      return { ...r, exact: r.exact.map((_, __, all) => all.reduce((s, v) => s + v, 0) / all.length) };
    },
  'exact.neymanAllocation.every-stratum-sampled':
    (f) =>
    (...a) => {
      const r = f(...a) as { exact: number[]; allocated: number[] };
      return { ...r, allocated: r.exact.map((x) => Math.floor(x)) };
    },
  'exact.repeatsForFloor.zero-variance':
    (f) =>
    (...a) => {
      const input = a[0] as { variance?: number };
      return input.variance === 0 ? { repeats: 0, floor: 0 } : f(...a);
    },
  'exact.simulateCoverage.analytic-control':
    (f) =>
    (...a) => {
      const r = f(...a) as { coverage: Record<string, number> };
      return { ...r, coverage: { ...r.coverage, 'naive wilson': r.coverage['naive wilson']! - 0.1 } };
    },
  'exact.hierarchicalBetaBinomial.all-pass':
    (f) =>
    (...a) => {
      const r = f(...a) as { lower: number; upper: number };
      return { ...r, lower: r.lower - 0.02, upper: Math.min(1, r.upper + 0.02) };
    },
  'exact.hierarchicalBetaBinomial.all-fail':
    (f) =>
    (...a) => {
      const r = f(...a) as { lower: number; upper: number };
      return { ...r, lower: Math.max(0, r.lower - 0.02), upper: r.upper + 0.02 };
    },
};

/** Faults for functions whose output a 0.2 percent change cannot move (integers, lists of integers, a generator). */
const FUNCTION_FAULT: Record<string, (original: Fn) => Fn> = {
  zeroFailureBound:
    (f) =>
    (...a) =>
      (f(...a) as number) + 1,
  abundances:
    (f) =>
    (...a) =>
      (f(...a) as number[]).reverse(),
  mulberry32: (f) => (seed) => f((seed as number) + 1),
  reduceRepeats:
    (f) =>
    (...a) => {
      const v = f(...a);
      return v === undefined ? undefined : 1 - (v as number);
    },
};

function plant(id: string, how: 'nudge' | 'throw'): StatsImpl {
  const name = id.split('.')[1] as string;
  const original = S[name] as Fn;
  const bad: Fn =
    how === 'throw'
      ? () => {
          throw new Error('planted');
        }
      : OWN_FAULT[id]
        ? (OWN_FAULT[id] as (f: Fn) => Fn)(original)
        : FUNCTION_FAULT[name]
          ? (FUNCTION_FAULT[name] as (f: Fn) => Fn)(original)
          : (...a) => nudge(original(...a));
  return { ...real, [name]: bad } as unknown as StatsImpl;
}

describe('the branch items of the statistics bank', { timeout: 300_000 }, () => {
  it('number at least 90, each with a cause of its own, and pass on the product on four seeds', async () => {
    expect(items.length).toBeGreaterThanOrEqual(90);
    expect(new Set(items.map((item) => item.cause)).size).toBe(items.length);
    for (const seed of [1, 2, 3, 856524023]) {
      for (const item of items) {
        const got = await runItem(item, seed, ROOT, real);
        expect(got.pass, `${item.id} on seed ${seed}: ${got.detail}`).toBe(true);
      }
    }
  });

  it.each(items.map((item) => item.id))('%s fails under a fault of its own function', async (id) => {
    const item = byId.get(id) as (typeof items)[number];
    const nudged = await runItem(item, 1, ROOT, plant(id, 'nudge'));
    expect(nudged.pass, `${id} passes with the numbers off`).toBe(false);
    const thrown = await runItem(item, 1, ROOT, plant(id, 'throw'));
    expect(thrown.pass, `${id} passes when the function throws`).toBe(false);
  });
});

type Mutant = {
  name: string;
  file: string;
  from: string;
  to: string;
  /** Items (by `fn.aspect`) that must fail with the fault planted. */
  fails: string[];
  /** Items of neighbouring branches that must keep passing. */
  passes?: string[];
};

const MUTANTS: Mutant[] = [
  {
    name: 'quantile takes the nearer order statistic instead of interpolating',
    file: 'basics.ts',
    from: 'return a + (h - lo) * (b - a);',
    to: 'return h - lo < 0.5 ? a : b;',
    fails: ['quantileSorted.interpolation', 'quantileSorted.small-samples'],
    passes: ['quantileSorted.order-statistics'],
  },
  {
    name: 'sampleVariance divides by n',
    file: 'basics.ts',
    from: 'return ss / (n - 1);',
    to: 'return ss / n;',
    fails: ['sampleVariance.integers', 'sampleVariance.two-values', 'sampleVariance.offset'],
    passes: ['sampleVariance.constant'],
  },
  {
    name: 'sampleVariance by the one-pass formula',
    file: 'basics.ts',
    from: 'const m = mean(values);\n  let ss = 0;\n  for (const v of values) ss += (v - m) * (v - m);\n  return ss / (n - 1);',
    to: 'let s1 = 0;\n  let s2 = 0;\n  for (const v of values) {\n    s1 += v;\n    s2 += v * v;\n  }\n  return (s2 - (s1 * s1) / n) / (n - 1);',
    fails: ['sampleVariance.offset', 'sampleVariance.tiny-spread'],
    passes: ['sampleVariance.integers', 'sampleVariance.two-values'],
  },
  {
    name: 'unreliability between the 5th and 95th percentile',
    file: 'reliability.ts',
    from: 'quantileSorted(sorted, 0.9) - quantileSorted(sorted, 0.1)',
    to: 'quantileSorted(sorted, 0.95) - quantileSorted(sorted, 0.05)',
    fails: ['unreliability.p90-p10', 'unreliability.pass-flags'],
    passes: ['unreliability.constant'],
  },
  {
    name: 'designEffect uses m in place of m - 1',
    file: 'intervals.ts',
    from: 'const de = 1 + (m - 1) * rho;',
    to: 'const de = 1 + m * rho;',
    fails: [
      'designEffect.no-clustering',
      'designEffect.full-correlation',
      'designEffect.negative-rho',
      'designEffect.fractional-m',
    ],
  },
  {
    name: 'effectiveSampleSize multiplies by the design effect',
    file: 'intervals.ts',
    from: 'return n / designEffect(m, rho);',
    to: 'return n * designEffect(m, rho);',
    fails: [
      'effectiveSampleSize.full-correlation',
      'effectiveSampleSize.negative-rho',
      'effectiveSampleSize.fractional',
    ],
    passes: ['effectiveSampleSize.no-clustering'],
  },
  {
    name: 'zFor is one-sided',
    file: 'intervals.ts',
    from: 'return normalQuantile(1 - alpha / 2);',
    to: 'return normalQuantile(1 - alpha);',
    fails: ['zFor.levels', 'zFor.far-tail', 'zFor.monotone'],
  },
  {
    name: 'goodTuring coverage is the discovery probability',
    file: 'coverage.ts',
    from: 'coverage: 1 - discoveryProbability',
    to: 'coverage: discoveryProbability',
    fails: [
      'goodTuring.all-singletons',
      'goodTuring.no-singletons',
      'goodTuring.mixed',
      'goodTuring.zero-counts',
    ],
    passes: ['goodTuring.fields'],
  },
  {
    name: 'hillNumber of order 0 counts the classes with a zero count',
    file: 'coverage.ts',
    from: 'if (q === 0) return ps.length;',
    to: 'if (q === 0) return counts.length;',
    fails: ['hillNumber.richness-ignores-zeros'],
    passes: ['hillNumber.uniform', 'hillNumber.simpson'],
  },
  {
    name: 'icc restarts the running sum at each level',
    file: 'variance.ts',
    from: 'cumulative += c.variance;',
    to: 'cumulative = c.variance;',
    fails: ['icc.two-levels', 'icc.three-levels', 'icc.last-level-reaches-share'],
    passes: ['icc.one-level'],
  },
  {
    name: 'neymanAllocation gains by weight in place of weight squared',
    file: 'variance.ts',
    from: 'return (w * w) / (n * (n + 1));',
    to: 'return w / (n * (n + 1));',
    fails: ['neymanAllocation.integer-optimum'],
    passes: ['neymanAllocation.sums-to-total', 'neymanAllocation.zero-spread'],
  },
  {
    name: 'repeatsForFloor never doubles the variance',
    file: 'variance.ts',
    from: 'const factor = (input.difference ?? true) ? 2 : 1;',
    to: 'const factor = 1;',
    fails: ['repeatsForFloor.difference', 'repeatsForFloor.blocks'],
    passes: ['repeatsForFloor.single-version'],
  },
  {
    name: 'repeatsForFloor may return 0 repeats',
    file: 'variance.ts',
    from: 'const repeats = Math.max(1, Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact));',
    to: 'const repeats = Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact);',
    fails: ['repeatsForFloor.zero-variance'],
    passes: ['repeatsForFloor.difference'],
  },
  {
    name: 'repeatsForFloor always rounds the ratio up',
    file: 'variance.ts',
    from: 'const repeats = Math.max(1, Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact));',
    to: 'const repeats = Math.max(1, Math.ceil(exact + 1e-6));',
    fails: ['repeatsForFloor.integer-ratio'],
    passes: ['repeatsForFloor.difference'],
  },
  {
    name: 'varianceComponents keeps negative variances',
    file: 'variance.ts',
    from: 'const truncated = estimates.map((e) => Math.max(0, e));',
    to: 'const truncated = estimates;',
    fails: ['varianceComponents.negative-estimate'],
    passes: ['varianceComponents.mean-and-n'],
  },
  {
    name: 'varianceComponents weights group sizes linearly in the expected mean squares',
    file: 'variance.ts',
    from: 'acc.set(ancestor, (acc.get(ancestor) ?? 0) + nh * nh);',
    to: 'acc.set(ancestor, (acc.get(ancestor) ?? 0) + nh);',
    fails: ['varianceComponents.unbalanced', 'varianceComponents.binary'],
    passes: ['varianceComponents.mean-and-n'],
  },
  {
    name: 'pageHinkley keeps the up statistic after an alarm',
    file: 'drift.ts',
    from: '      mUp = 0;\n      minUp = 0;\n',
    to: '',
    fails: ['pageHinkley.reset-after-alarm'],
    passes: ['pageHinkley.quiet-series', 'pageHinkley.alarm-down'],
  },
  {
    name: 'pageHinkley waits one point more than minInstances',
    file: 'drift.ts',
    from: 'count >= minInstances',
    to: 'count > minInstances',
    fails: ['pageHinkley.min-instances-boundary'],
    passes: ['pageHinkley.quiet-series', 'pageHinkley.alarm-up'],
  },
  {
    name: 'pairedRateDifference skips the covariance correction',
    file: 'paired.ts',
    from: 'const corrected = covariance > 0 ? Math.max(0, covariance - n / 2) : covariance;',
    to: 'const corrected = covariance;',
    fails: ['pairedRateDifference.positive-covariance'],
    passes: ['pairedRateDifference.negative-covariance', 'pairedRateDifference.zero-margin'],
  },
  {
    name: 'pairedRateDifference divides by a zero margin product',
    file: 'paired.ts',
    from: 'const phi = product === 0 ? 0 : corrected / Math.sqrt(product);',
    to: 'const phi = corrected / Math.sqrt(product);',
    fails: ['pairedRateDifference.zero-margin'],
    passes: ['pairedRateDifference.positive-covariance'],
  },
  {
    name: 'nonInferiority ignores the gating flags',
    file: 'paired.ts',
    from: 'const nonInferior = withinMargin && newFlags.length === 0;',
    to: 'const nonInferior = withinMargin;',
    fails: ['nonInferiority.gating-flag'],
    passes: ['nonInferiority.clear-parity'],
  },
  {
    name: 'nonInferiority compares the estimate to the margin',
    file: 'paired.ts',
    from: 'const withinMargin = effect.upper < margin;',
    to: 'const withinMargin = effect.estimate < margin;',
    fails: ['nonInferiority.margin-boundary'],
    passes: ['nonInferiority.clear-parity'],
  },
  {
    name: 'wilsonEffective treats every sample as non-degenerate',
    file: 'effective.ts',
    from: 'const degenerate = p === 0 || p === 1;',
    to: 'const degenerate = false;',
    fails: ['wilsonEffective.all-pass', 'wilsonEffective.all-fail'],
    passes: ['wilsonEffective.levels'],
  },
  {
    name: 'wilsonEffective always uses the normal quantile',
    file: 'effective.ts',
    from: "if (options.quantile === 'z' || df < 1) {",
    to: 'if (true) {',
    fails: ['wilsonEffective.t-widens', 'wilsonEffective.levels'],
    passes: ['wilsonEffective.single-cluster'],
  },
  {
    name: 'wilsonEffective lets the effective blocks exceed n',
    file: 'effective.ts',
    from: 'effectiveN = variance > 0 ? Math.min(n, Math.max(1, (p * (1 - p)) / variance)) : n;',
    to: 'effectiveN = variance > 0 ? Math.max(1, (p * (1 - p)) / variance) : n;',
    fails: ['wilsonEffective.capped-at-n'],
    passes: ['wilsonEffective.levels'],
  },
  {
    name: 'hierarchicalBetaBinomial reads the rising-factorial table for every tree size',
    file: 'hierarchical.ts',
    from: 'const small = n <= TABLE_LIMIT;',
    to: 'const small = true;',
    fails: ['hierarchicalBetaBinomial.large-trees'],
    passes: ['hierarchicalBetaBinomial.two-trees'],
  },
  {
    name: 'hierarchicalBetaBinomial reports the pooled rate as its estimate',
    file: 'hierarchical.ts',
    from: 'const treeMean = rateSum / trees.length;',
    to: 'const treeMean = ordered.reduce((s, e) => s + e.count * e.k, 0) / blocks;',
    fails: ['hierarchicalBetaBinomial.large-trees'],
    passes: ['hierarchicalBetaBinomial.two-trees'],
  },
  {
    name: 'binomialCdf has no point mass at p = 0',
    file: 'special.ts',
    from: '  if (p === 0) return k === 0 ? 1 : 0;\n',
    to: '',
    fails: ['binomialCdf.edges'],
    passes: ['binomialCdf.moderate-n', 'binomialCdf.exact-small'],
  },
  {
    name: 'zeroFailureBound rounds an exact integer ratio up',
    file: 'intervals.ts',
    from: 'return Math.abs(exact - rounded) < 1e-9 ? rounded : Math.ceil(exact);',
    to: 'return Math.ceil(exact);',
    fails: ['zeroFailureBound.exact-integers'],
    passes: ['zeroFailureBound.table', 'zeroFailureBound.tiny-p'],
  },
  {
    name: 'zeroFailureBound takes the log of 1 - p, which loses digits for a tiny p',
    file: 'intervals.ts',
    from: 'const exact = Math.log(alpha) / Math.log1p(-p);',
    to: 'const exact = Math.log(alpha) / Math.log(1 - p);',
    fails: ['zeroFailureBound.tiny-p'],
    passes: ['zeroFailureBound.table', 'zeroFailureBound.large-p'],
  },
  {
    name: 'reduceRepeats mode sends a tie to the value seen last',
    file: 'repeat-reducers.ts',
    from: 'if (count > bestCount) {',
    to: 'if (count >= bestCount) {',
    fails: ['reduceRepeats.mode'],
    passes: ['reduceRepeats.median', 'reduceRepeats.at-least'],
  },
  {
    name: 'reduceRepeats at_least fails when the passes plus the unscored just reach k',
    file: 'repeat-reducers.ts',
    from: 'if (passes + unscored < reducer.k) return 0;',
    to: 'if (passes + unscored <= reducer.k) return 0;',
    fails: ['reduceRepeats.at-least'],
    passes: ['reduceRepeats.mode', 'reduceRepeats.median'],
  },
  {
    name: 'reduceRepeats median passes at exactly one half',
    file: 'repeat-reducers.ts',
    from: 'if (median > 0.5) return 1;',
    to: 'if (median >= 0.5) return 1;',
    fails: ['reduceRepeats.median'],
    passes: ['reduceRepeats.mode', 'reduceRepeats.at-least'],
  },
  {
    name: 'abundances sorts the counts',
    file: 'coverage.ts',
    from: 'return [...counts.values()];',
    to: 'return [...counts.values()].sort((a, b) => a - b);',
    fails: ['abundances.first-seen-order', 'abundances.counts-sum'],
  },
  {
    name: 'mulberry32 takes the absolute value of the seed in place of wrapping it',
    file: 'basics.ts',
    from: 'let state = seed >>> 0;',
    to: 'let state = Math.abs(seed) % 4294967296;',
    fails: ['mulberry32.seed-wrap'],
    passes: ['mulberry32.long-stream'],
  },
  {
    name: 'simulateCoverage draws a binomial block with a lower pass chance',
    file: 'simulate.ts',
    from: 'if (rng() < p) k += 1;',
    to: 'if (rng() < p * 0.9) k += 1;',
    fails: ['simulateCoverage.analytic-control'],
  },
];

async function loadMutant(mutant: Mutant): Promise<{ impl: StatsImpl; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'exact-branches-'));
  cpSync(join(ROOT, 'packages/stats/src'), join(dir, 'src'), { recursive: true });
  const path = join(dir, 'src', mutant.file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(mutant.from, mutant.to);
  if (after === before) throw new Error(`the planted change did not apply to ${mutant.file}: ${mutant.name}`);
  writeFileSync(path, after);
  const impl = (await import(
    /* @vite-ignore */ pathToFileURL(join(dir, 'src', 'index.ts')).href
  )) as StatsImpl;
  return { impl, dir };
}

describe('faults planted in a copy of the package source', { timeout: 300_000 }, () => {
  it.each(MUTANTS.map((m) => [m.name, m] as const))('%s', async (_name, mutant) => {
    const { impl, dir } = await loadMutant(mutant);
    try {
      for (const key of mutant.fails) {
        const item = byId.get(`exact.${key}`);
        expect(item, `no item exact.${key}`).toBeDefined();
        const got = await runItem(item as (typeof items)[number], 1, ROOT, impl);
        expect(got.pass, `exact.${key} passes with: ${mutant.name}`).toBe(false);
      }
      for (const key of mutant.passes ?? []) {
        const item = byId.get(`exact.${key}`);
        expect(item, `no item exact.${key}`).toBeDefined();
        const got = await runItem(item as (typeof items)[number], 1, ROOT, impl);
        expect(got.pass, `exact.${key} fails with: ${mutant.name}: ${got.detail}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

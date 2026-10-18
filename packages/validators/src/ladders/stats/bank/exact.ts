import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StatsImpl } from '../reference';
import { attempt, type BankItem, fail, ok, show, type Tier } from './item';

/**
 * Families `exact-special` (the special functions, at three tolerances) and `exact-estimators` (everything else): exact values of one function against numbers computed independently of the TypeScript, in
 * `packages/validators/fixtures/stats/exact.json` (made by `make_exact.py`, which records where each group of
 * numbers comes from: a closed form in exact rational arithmetic, the Python standard library, scipy or numpy).
 *
 * The tolerance of a group is set by its source, not by the product's accuracy:
 * - a closed form or a rational computation: 1e-12 relative;
 * - a special function or a library quantile: 1e-6 relative (docs/validators.md section 7, level 1);
 * - the hierarchical interval, read on a grid of 100 cells in theta: half a cell, 0.005.
 * Each is far below a 0.2 percent error in the value, which the items must catch (the planted-fault test
 * `test/stats/exact.test.ts` plants one for every function the bank names here).
 */

const FIXTURE = 'packages/validators/fixtures/stats/exact.json';
/** The fixture files of the exact items; a spec names one, `exact.json` by default. */
export const BRANCH_FIXTURE = 'packages/validators/fixtures/stats/exact-branches.json';
// biome-ignore lint/suspicious/noExplicitAny: the fixture is JSON read as data; each group reads the fields it compares
export type Row = Record<string, any>;

const cache = new Map<string, Row>();
function fixture(root: string, file: string = FIXTURE): Row {
  const path = join(root, file);
  let data = cache.get(path);
  if (!data) {
    data = JSON.parse(readFileSync(path, 'utf8')) as Row;
    cache.set(path, data);
  }
  return data;
}

export type Tol = { rel: number; abs: number };
export const EXACT: Tol = { rel: 1e-12, abs: 1e-300 };
export const LIBRARY: Tol = { rel: 1e-6, abs: 1e-300 };
/** Double precision with a margin of about a hundred units in the last place. */
export const ACCURATE: Tol = { rel: 1e-11, abs: 1e-300 };

/** Walks `want` and `got` together; numbers match within the tolerance of their path, everything else exactly. */
function compare(path: string, got: unknown, want: unknown, tol: (path: string) => Tol, out: string[]): void {
  if (typeof want === 'number') {
    if (typeof got !== 'number' || Number.isNaN(got)) {
      out.push(`${path}: got ${show(got)}, want ${want}`);
      return;
    }
    if (!Number.isFinite(want)) {
      if (got !== want) out.push(`${path}: got ${got}, want ${want}`);
      return;
    }
    const t = tol(path);
    if (!(Math.abs(got - want) <= t.abs + t.rel * Math.abs(want)))
      out.push(`${path}: got ${got}, want ${want}`);
    return;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) {
      out.push(`${path}: got ${show(got)}, want ${show(want)}`);
      return;
    }
    want.forEach((w, i) => {
      compare(`${path}[${i}]`, got[i], w, tol, out);
    });
    return;
  }
  if (want !== null && typeof want === 'object') {
    if (got === null || typeof got !== 'object') {
      out.push(`${path}: got ${show(got)}, want an object`);
      return;
    }
    for (const [k, w] of Object.entries(want)) {
      compare(path === '' ? k : `${path}.${k}`, (got as Row)[k], w, tol, out);
    }
    return;
  }
  if (got !== want) out.push(`${path}: got ${show(got)}, want ${show(want)}`);
}

export type Spec = {
  /** The exported function (the item id and the file it points at come from it). */
  fn: string;
  /** The fixture group. */
  group: string;
  /** The fixture file; `exact.json` when absent. */
  file?: string;
  /** What this item holds apart from the function's other items. */
  aspect: string;
  family: string;
  tier: Tier;
  component: string;
  cause: string;
  tol: Tol | ((path: string) => Tol);
  /** The fields of `expected` this item compares; all when absent. */
  fields?: readonly string[];
  /** Cases of the group this item reads. */
  only?: (c: Row) => boolean;
  /** Calls the function on a case; returns what to compare with `c.expected`. */
  call: (s: StatsImpl, c: Row, root: string) => unknown | Promise<unknown>;
  budgetMs?: number;
  /** What to tell an executor when the function does not exist yet: its signature and the page that defines it. */
  missing?: string;
};

export const SRC = 'packages/stats/src';
const HEADLINE = 'packages/report/src/headline.ts';
const ESTIMATE = 'packages/report/src/estimate.ts';

type Mod = Record<string, unknown>;
const loaded = new Map<string, Promise<Mod>>();
/** A module of the product, loaded from the repository root at run time (as the product items load theirs). */
export function load(root: string, path: string): Promise<Mod> {
  const key = join(root, path);
  let mod = loaded.get(key);
  if (!mod) {
    mod = import(key) as Promise<Mod>;
    loaded.set(key, mod);
  }
  return mod;
}

const TARGET = { adapter: 'function', agent: 'demo' };
const FIXED = '2026-10-11T12:00:00.000Z';

/** A completed run of one block of a fictional spec that passes or fails. */
function runOf(specId: string, repeat: number, pass: boolean) {
  return {
    runId: `${specId}-F-${repeat}`,
    specId,
    specHash: 'h1',
    target: TARGET,
    mode: 'F',
    repeat,
    status: 'completed',
    blocks: [
      {
        index: 0,
        givenHash: 'g0',
        observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
        verdicts: [],
        ledgerCheck: { ok: true, contradictions: [] },
        drift: pass ? [] : ['X1_local'],
        pass,
      },
    ],
    succession: {
      ...(pass ? {} : { firstDriftBlock: 0 }),
      driftCount: pass ? 0 : 1,
      driftRate: pass ? 0 : 1,
      longestClean: pass ? 1 : 0,
      minOverBlocks: pass,
    },
    cost: 0,
    latencyMs: 0,
    startedAt: FIXED,
    finishedAt: FIXED,
    cacheHit: false,
  };
}

/** The runs of goldens given as `{ n, k }`: golden i is spec-i, run for n repeats, the first k of them passing. */
function runsOfGoldens(goldens: readonly { n: number; k: number }[]) {
  return goldens.flatMap((g, i) => Array.from({ length: g.n }, (_, r) => runOf(`spec-${i}`, r, r < g.k)));
}
type HeadlineFn = (
  runs: unknown[],
  treeOf: (run: { specId: string; repeat: number }) => string,
) => Row | undefined;
const headlineOf = async (
  root: string,
  goldens: readonly { n: number; k: number }[],
): Promise<Row | undefined> =>
  ((await load(root, HEADLINE)).suiteHeadline as HeadlineFn)(runsOfGoldens(goldens), (run) => run.specId);

/** The fixture is JSON, which has no Infinity: the strings "Infinity" and "-Infinity" stand for the numbers. */
export function revive(value: unknown): unknown {
  if (value === 'Infinity') return Number.POSITIVE_INFINITY;
  if (value === '-Infinity') return Number.NEGATIVE_INFINITY;
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  return value;
}

export function exactItem(spec: Spec): BankItem {
  const tolFor = typeof spec.tol === 'function' ? spec.tol : () => spec.tol as Tol;
  return {
    id: `exact.${spec.fn}.${spec.aspect}`,
    family: spec.family,
    tier: spec.tier,
    level: 'analytic',
    component: spec.component,
    cause: spec.cause,
    ...(spec.budgetMs ? { budgetMs: spec.budgetMs } : {}),
    check: async ({ s, root }) => {
      const file = spec.file ?? FIXTURE;
      const cases = ((fixture(root, file)[spec.group] ?? []) as Row[])
        .map((row) => revive(row) as Row)
        .filter(spec.only ?? (() => true));
      if (cases.length === 0) return fail(`no case of ${spec.group}/${spec.aspect} in ${file}`);
      const misses: string[] = [];
      for (const [i, c] of cases.entries()) {
        const got = await attemptAsync(async () => spec.call(s, c, root));
        if (got.error) {
          if (got.error.message.includes('is not exported'))
            return fail(
              `${spec.fn} does not exist in @agent-nexus/driftbench-stats. ${
                spec.missing ??
                `Add it to ${spec.component} and export it from packages/stats/src/index.ts; docs/concepts/statistics.md describes what it computes.`
              }`,
            );
          misses.push(`case ${i} threw ${got.error.name}: ${got.error.message}`);
          continue;
        }
        const found: string[] = [];
        const want = spec.fields
          ? Object.fromEntries(spec.fields.map((k) => [k, (c.expected as Row)[k]]))
          : c.expected;
        compare('', got.value, want, tolFor, found);
        if (found.length > 0) misses.push(`case ${i} ${show(inputOf(c))}: ${found.slice(0, 2).join('; ')}`);
      }
      return misses.length === 0
        ? ok(`${cases.length} cases match`)
        : fail(
            `${spec.fn} (${spec.aspect}) differs from the independent reference in ${misses.length} of ${cases.length} cases; fix the function so each matches ${file}: ${misses.slice(0, 3).join(' | ')}`,
          );
    },
  };
}

export async function attemptAsync<T>(f: () => Promise<T>): Promise<{ value?: T; error?: Error }> {
  try {
    return { value: await f() };
  } catch (cause) {
    return { error: cause instanceof Error ? cause : new Error(String(cause)) };
  }
}

function inputOf(c: Row): Row {
  const { expected: _expected, ...input } = c;
  return input;
}

// A function is called through the package it exports from, so a planted fault in one function shows.
type Fn = (...args: never[]) => unknown;
export const fn = (s: StatsImpl, name: string): Fn => {
  const f = (s as unknown as Record<string, unknown>)[name];
  if (typeof f !== 'function') throw new TypeError(`${name} is not exported by the statistics package`);
  return f as Fn;
};
export const call = (s: StatsImpl, name: string, ...args: unknown[]): unknown =>
  (fn(s, name) as (...a: unknown[]) => unknown)(...args);

/** The hierarchical interval is read on 100 cells of theta: half a cell, 0.005, for the bounds and the posterior mean. */
const hierarchicalTol = (path: string): Tol => (path === 'estimate' ? EXACT : { rel: 0, abs: 0.005 });

export function exactItems(): BankItem[] {
  const specs: Spec[] = [
    // ---- special functions -------------------------------------------------------------------------------
    {
      fn: 'erfc',
      group: 'erfc',
      aspect: 'upper-half-line',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/special.ts`,
      cause: 'erfc differs from the standard library on x >= 0',
      tol: LIBRARY,
      only: (c) => c.x >= 0,
      call: (s, c) => call(s, 'erfc', c.x),
    },
    {
      fn: 'erfc',
      group: 'erfc',
      aspect: 'reflection',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/special.ts`,
      cause: 'erfc of a negative x is not 2 - erfc(-x)',
      tol: LIBRARY,
      only: (c) => c.x < 0,
      call: (s, c) => call(s, 'erfc', c.x),
    },
    {
      fn: 'normalCdf',
      group: 'normalCdf',
      aspect: 'centre',
      family: 'exact-special',
      tier: 2,
      component: `${SRC}/special.ts`,
      cause: 'normalCdf differs from the reference within 4 standard deviations',
      tol: LIBRARY,
      only: (c) => Math.abs(c.z) <= 4,
      call: (s, c) => call(s, 'normalCdf', c.z),
    },
    {
      fn: 'normalCdf',
      group: 'normalCdf',
      aspect: 'tails',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/special.ts`,
      cause: 'normalCdf loses relative accuracy in the tails',
      tol: LIBRARY,
      only: (c) => Math.abs(c.z) > 4,
      call: (s, c) => call(s, 'normalCdf', c.z),
    },
    {
      fn: 'normalSf',
      group: 'normalSf',
      aspect: 'centre',
      family: 'exact-special',
      tier: 2,
      component: `${SRC}/special.ts`,
      cause: 'normalSf differs from the reference within 4 standard deviations',
      tol: LIBRARY,
      only: (c) => Math.abs(c.z) <= 4,
      call: (s, c) => call(s, 'normalSf', c.z),
    },
    {
      fn: 'normalSf',
      group: 'normalSf',
      aspect: 'tails',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/special.ts`,
      cause: 'normalSf loses relative accuracy in the upper tail',
      tol: LIBRARY,
      only: (c) => Math.abs(c.z) > 4,
      call: (s, c) => call(s, 'normalSf', c.z),
    },
    {
      fn: 'normalQuantile',
      group: 'normalQuantile',
      aspect: 'central',
      family: 'exact-special',
      tier: 2,
      component: `${SRC}/special.ts`,
      cause: 'normalQuantile differs from the reference for p between 0.02 and 0.98',
      tol: LIBRARY,
      only: (c) => c.p >= 0.02 && c.p <= 0.98,
      call: (s, c) => call(s, 'normalQuantile', c.p),
    },
    {
      fn: 'normalQuantile',
      group: 'normalQuantile',
      aspect: 'tails',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/special.ts`,
      cause: 'normalQuantile differs from the reference in the tails',
      tol: LIBRARY,
      only: (c) => c.p < 0.02 || c.p > 0.98,
      call: (s, c) => call(s, 'normalQuantile', c.p),
    },
    {
      fn: 'zFor',
      group: 'zFor',
      aspect: 'two-sided',
      family: 'exact-special',
      tier: 2,
      component: `${SRC}/intervals.ts`,
      cause: 'zFor is not the two-sided normal quantile at 1 - alpha / 2',
      tol: LIBRARY,
      call: (s, c) => call(s, 'zFor', c.alpha),
    },
    {
      fn: 'logGamma',
      group: 'logGamma',
      aspect: 'reals',
      family: 'exact-special',
      tier: 2,
      component: `${SRC}/special.ts`,
      cause: 'logGamma differs from math.lgamma on real arguments',
      tol: { rel: 1e-6, abs: 1e-12 },
      call: (s, c) => call(s, 'logGamma', c.x),
    },
    {
      fn: 'logGamma',
      group: 'logGammaIntegers',
      aspect: 'factorials',
      family: 'exact-special',
      tier: 2,
      component: `${SRC}/special.ts`,
      cause: 'logGamma at an integer is not ln((x - 1)!)',
      tol: { rel: 1e-9, abs: 1e-12 },
      call: (s, c) => call(s, 'logGamma', c.x),
    },
    {
      fn: 'betaQuantile',
      group: 'betaQuantile',
      aspect: 'inverse',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/special.ts`,
      cause: 'betaQuantile differs from scipy.special.betaincinv',
      tol: LIBRARY,
      call: (s, c) => call(s, 'betaQuantile', c.p, c.a, c.b),
    },
    {
      fn: 'chiSquareSf',
      group: 'chiSquareSf',
      aspect: 'tail',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/special.ts`,
      cause: 'chiSquareSf differs from scipy.stats.chi2.sf',
      tol: LIBRARY,
      call: (s, c) => call(s, 'chiSquareSf', c.x, c.df),
    },
    {
      fn: 'kolmogorovSf',
      group: 'kolmogorovSf',
      aspect: 'small-x',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/drift.ts`,
      cause: 'kolmogorovSf differs from scipy.special.kolmogorov below x = 1.18',
      tol: LIBRARY,
      only: (c) => c.x < 1.18,
      call: (s, c) => call(s, 'kolmogorovSf', c.x),
    },
    {
      fn: 'kolmogorovSf',
      group: 'kolmogorovSf',
      aspect: 'large-x',
      family: 'exact-special',
      tier: 3,
      component: `${SRC}/drift.ts`,
      cause: 'kolmogorovSf differs from scipy.special.kolmogorov from x = 1.18',
      tol: LIBRARY,
      only: (c) => c.x >= 1.18,
      call: (s, c) => call(s, 'kolmogorovSf', c.x),
    },

    // ---- accuracy over the whole domain: double precision, 1e-11 relative -------------------------------------
    ...(
      [
        ['erfc', 'accuracy.erfc', (c: Row) => [c.x]],
        ['normalCdf', 'accuracy.normalCdf', (c: Row) => [c.z]],
        ['normalSf', 'accuracy.normalSf', (c: Row) => [c.z]],
        ['logGamma', 'accuracy.logGamma', (c: Row) => [c.x]],
        ['betaQuantile', 'accuracy.betaQuantile', (c: Row) => [c.p, c.a, c.b]],
        ['chiSquareSf', 'accuracy.chiSquareSf', (c: Row) => [c.x, c.df]],
        ['kolmogorovSf', 'accuracy.kolmogorovSf', (c: Row) => [c.x]],
      ] as const
    ).map(
      ([name, group, args]): Spec => ({
        fn: name,
        group,
        aspect: 'double-precision',
        family: 'exact-special',
        tier: 4,
        component: name === 'kolmogorovSf' ? `${SRC}/drift.ts` : `${SRC}/special.ts`,
        cause: `${name} loses digits somewhere on its domain (60 points at 1e-11 relative)`,
        tol: ACCURATE,
        call: (s, c) => call(s, name, ...args(c)),
      }),
    ),
    ...(['lower', 'central', 'upper'] as const).map(
      (part): Spec => ({
        fn: 'normalQuantile',
        group: `accuracy.normalQuantile.${part}`,
        aspect: `double-precision-${part}`,
        family: 'exact-special',
        tier: 4,
        component: `${SRC}/special.ts`,
        cause:
          part === 'upper'
            ? 'normalQuantile loses digits for p above 0.99: it should use the symmetry x(p) = -x(1 - p), exact in double precision'
            : `normalQuantile loses digits for p in the ${part} range (60 points at 1e-11 relative)`,
        tol: ACCURATE,
        call: (s, c) => call(s, 'normalQuantile', c.p),
      }),
    ),

    // ---- basics ------------------------------------------------------------------------------------------
    {
      fn: 'mulberry32',
      group: 'mulberry32',
      aspect: 'stream',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/basics.ts`,
      cause: 'mulberry32 does not draw the published sequence for its seed',
      tol: EXACT,
      call: (s, c) => {
        const next = (fn(s, 'mulberry32') as (seed: number) => () => number)(c.seed);
        return Array.from({ length: (c.expected as number[]).length }, () => next());
      },
    },
    {
      fn: 'quantile',
      group: 'quantile',
      aspect: 'type7',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/basics.ts`,
      cause: 'quantile is not the type 7 (linear) quantile',
      tol: EXACT,
      call: (s, c) => call(s, 'quantile', c.values, c.p),
    },
    {
      fn: 'quantileSorted',
      group: 'quantile',
      aspect: 'type7',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/basics.ts`,
      cause: 'quantileSorted is not the type 7 (linear) quantile of sorted values',
      tol: EXACT,
      call: (s, c) =>
        call(
          s,
          'quantileSorted',
          [...(c.values as number[])].sort((a, b) => a - b),
          c.p,
        ),
    },
    {
      fn: 'unreliability',
      group: 'unreliability',
      aspect: 'p90-minus-p10',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/reliability.ts`,
      cause: 'unreliability is not the 90th minus the 10th percentile',
      tol: EXACT,
      call: (s, c) => call(s, 'unreliability', c.samples),
    },
    {
      fn: 'weightedMean',
      group: 'weightedMean',
      aspect: 'rational',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/basics.ts`,
      cause: 'weightedMean is not sum(w x) / sum(w)',
      tol: EXACT,
      call: (s, c) => call(s, 'weightedMean', c.values, c.weights),
    },
    {
      fn: 'sampleVariance',
      group: 'sampleVariance',
      aspect: 'rational',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/basics.ts`,
      cause: 'sampleVariance is not the n - 1 variance (or loses digits on a large offset)',
      tol: { rel: 1e-9, abs: 1e-300 },
      call: (s, c) => call(s, 'sampleVariance', c.values),
    },
    {
      fn: 'abundances',
      group: 'abundances',
      aspect: 'counts',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/coverage.ts`,
      cause: 'abundances does not count each label once, in first-seen order',
      tol: EXACT,
      call: (s, c) => call(s, 'abundances', c.labels),
    },
    {
      fn: 'reduceRepeats',
      group: 'reduceRepeats',
      aspect: 'verdicts',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/repeat-reducers.ts`,
      cause: 'reduceRepeats does not give the documented verdict of mode, median or at_least',
      tol: EXACT,
      call: (s, c) => {
        const reducer = call(s, 'parseRepeatReducer', c.reducer);
        const v = call(
          s,
          'reduceRepeats',
          (c.values as (number | null)[]).map((x) => (x === null ? undefined : x)),
          reducer,
        );
        return v === undefined ? null : v;
      },
    },

    // ---- intervals ---------------------------------------------------------------------------------------
    {
      fn: 'designEffect',
      group: 'designEffect',
      aspect: 'closed-form',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/intervals.ts`,
      cause: 'designEffect is not 1 + (m - 1) rho',
      tol: EXACT,
      call: (s, c) => call(s, 'designEffect', c.m, c.rho),
    },
    {
      fn: 'effectiveSampleSize',
      group: 'effectiveSampleSize',
      aspect: 'closed-form',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/intervals.ts`,
      cause: 'effectiveSampleSize is not n / (1 + (m - 1) rho)',
      tol: EXACT,
      call: (s, c) => call(s, 'effectiveSampleSize', c.n, c.m, c.rho),
    },
    {
      fn: 'kishEffectiveSize',
      group: 'kishEffectiveSize',
      aspect: 'closed-form',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/intervals.ts`,
      cause: 'kishEffectiveSize is not (sum w)^2 / sum w^2',
      tol: EXACT,
      call: (s, c) => call(s, 'kishEffectiveSize', c.weights),
    },
    {
      fn: 'wilsonEffective',
      group: 'wilsonEffective',
      aspect: 'student-t',
      family: 'exact-estimators',
      tier: 4,
      component: `${SRC}/effective.ts`,
      cause: 'wilsonEffective with the Student t quantile differs from the reference',
      tol: LIBRARY,
      only: (c) => c.quantile === 't',
      call: (s, c) => call(s, 'wilsonEffective', c.clusters, { alpha: c.alpha, quantile: c.quantile }),
    },
    {
      fn: 'wilsonEffective',
      group: 'wilsonEffective',
      aspect: 'normal',
      family: 'exact-estimators',
      tier: 4,
      component: `${SRC}/effective.ts`,
      cause: 'wilsonEffective with the normal quantile differs from the reference',
      tol: LIBRARY,
      only: (c) => c.quantile === 'z',
      call: (s, c) => call(s, 'wilsonEffective', c.clusters, { alpha: c.alpha, quantile: c.quantile }),
    },
    {
      fn: 'hierarchicalBetaBinomial',
      group: 'hierarchicalBetaBinomial',
      aspect: 'treemean',
      family: 'exact-estimators',
      tier: 4,
      component: `${SRC}/hierarchical.ts`,
      cause: 'hierarchicalBetaBinomial does not report the mean of the tree rates as its estimate',
      fields: ['estimate'],
      tol: EXACT,
      call: (s, c) => ({
        estimate: (call(s, 'hierarchicalBetaBinomial', c.trees, { alpha: c.alpha }) as { estimate: number })
          .estimate,
      }),
    },
    {
      fn: 'hierarchicalBetaBinomial',
      group: 'hierarchicalBetaBinomial',
      aspect: 'posterior',
      family: 'exact-estimators',
      tier: 4,
      component: `${SRC}/hierarchical.ts`,
      cause: 'hierarchicalBetaBinomial bounds differ from a fine numerical integration of its model',
      tol: hierarchicalTol,
      budgetMs: 60_000,
      call: (s, c) => call(s, 'hierarchicalBetaBinomial', c.trees, { alpha: c.alpha }),
    },

    {
      fn: 'simulateCoverage',
      group: 'simulateCoverage',
      aspect: 'replay',
      family: 'exact-estimators',
      tier: 4,
      component: `${SRC}/simulate.ts`,
      cause:
        'simulateCoverage does not draw the clustered model it documents (coverage and width differ from a replay)',
      // The naive and the effective-Wilson intervals are replayed bit for bit. The hierarchical interval is read on
      // a finer grid in the reference than in the product, so a suite on the edge of its interval may flip.
      tol: (path) => (path.endsWith('hierarchical') ? { rel: 0, abs: 0.05 } : { rel: 1e-9, abs: 1e-12 }),
      fields: ['coverage', 'width'],
      budgetMs: 60_000,
      call: (s, c) => call(s, 'simulateCoverage', c.cell, { reps: c.reps, seed: c.seed }),
    },
    // ---- the report's suite headline and clustered rate ----------------------------------------------------
    {
      fn: 'suiteHeadline',
      group: 'suiteHeadline',
      aspect: 'rate-and-interval',
      family: 'exact-estimators',
      tier: 4,
      component: HEADLINE,
      cause: 'suiteHeadline is not the mean over goldens with the hierarchical interval of their counts',
      tol: (path) => (path === 'lower' || path === 'upper' ? { rel: 0, abs: 0.005 } : EXACT),
      fields: ['trees', 'runs', 'estimate', 'pooledRate', 'method', 'lower', 'upper'],
      budgetMs: 60_000,
      call: async (_s, c, root) => headlineOf(root, c.goldens),
    },
    {
      fn: 'suiteHeadline',
      group: 'suiteHeadline',
      aspect: 'effective-runs',
      family: 'exact-estimators',
      tier: 4,
      component: HEADLINE,
      cause: 'suiteHeadline n_eff or design effect is not that of the equal-weight mean of the golden rates',
      tol: { rel: 1e-9, abs: 1e-12 },
      fields: ['designEffect', 'effectiveRuns', 'degenerate'],
      call: async (_s, c, root) => headlineOf(root, c.goldens),
    },
    {
      fn: 'suiteHeadline',
      group: 'suiteHeadline',
      aspect: 'detectable-drop',
      family: 'exact-estimators',
      tier: 4,
      component: HEADLINE,
      cause:
        'suiteHeadline detectable drop is not the minimum detectable effect at 80 percent power on n_eff',
      tol: { rel: 1e-6, abs: 1e-12 },
      fields: ['detectableDrop'],
      call: async (_s, c, root) => {
        const h = await headlineOf(root, c.goldens);
        return { detectableDrop: h?.detectableDrop ?? null };
      },
    },
    {
      fn: 'clusterRate',
      group: 'clusterRate',
      aspect: 'rate-over-goldens',
      family: 'exact-estimators',
      tier: 3,
      component: ESTIMATE,
      cause:
        'clusterRate is not Wilson on n_eff (Student t), each golden once when all agree, or undefined for singletons',
      tol: { rel: 1e-6, abs: 1e-12 },
      call: async (_s, c, root) =>
        ((await load(root, ESTIMATE)).clusterRate as (x: unknown) => unknown)(c.counts) ?? null,
    },
    // ---- drift -------------------------------------------------------------------------------------------
    {
      fn: 'cusum',
      group: 'cusum',
      aspect: 'sums',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/drift.ts`,
      cause: 'cusum sums differ from the tabular recursion',
      fields: ['upper', 'lower'],
      tol: EXACT,
      call: (s, c) => {
        const r = call(s, 'cusum', c.series, c.options) as { upper: number[]; lower: number[] };
        return { upper: r.upper, lower: r.lower };
      },
    },
    {
      fn: 'cusum',
      group: 'cusum',
      aspect: 'alarms',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/drift.ts`,
      cause: 'cusum alarms differ from the tabular recursion',
      fields: ['alarms', 'target', 'sd'],
      tol: EXACT,
      call: (s, c) => {
        const r = call(s, 'cusum', c.series, c.options) as { alarms: unknown; target: number; sd: number };
        return { alarms: r.alarms, target: r.target, sd: r.sd };
      },
    },
    {
      fn: 'pageHinkley',
      group: 'pageHinkley',
      aspect: 'statistics',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/drift.ts`,
      cause: 'pageHinkley statistics differ from the recursion',
      fields: ['up', 'down'],
      tol: EXACT,
      call: (s, c) => {
        const r = call(s, 'pageHinkley', c.series, c.options) as { up: number[]; down: number[] };
        return { up: r.up, down: r.down };
      },
    },
    {
      fn: 'pageHinkley',
      group: 'pageHinkley',
      aspect: 'alarms',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/drift.ts`,
      cause: 'pageHinkley alarms (and the reset after one) differ from the recursion',
      fields: ['alarms'],
      tol: EXACT,
      call: (s, c) => ({
        alarms: (call(s, 'pageHinkley', c.series, c.options) as { alarms: unknown }).alarms,
      }),
    },

    // ---- unseen mass and diversity -----------------------------------------------------------------------
    {
      fn: 'goodTuring',
      group: 'goodTuring',
      aspect: 'discovery',
      family: 'exact-estimators',
      tier: 2,
      component: `${SRC}/coverage.ts`,
      cause: 'goodTuring is not f1 / n and 1 - f1 / n',
      tol: EXACT,
      call: (s, c) => call(s, 'goodTuring', c.counts),
    },
    {
      fn: 'hillNumber',
      group: 'hillNumber',
      aspect: 'orders',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/coverage.ts`,
      cause: 'hillNumber differs from (sum p^q)^(1 / (1 - q))',
      tol: { rel: 1e-9, abs: 1e-300 },
      call: (s, c) => call(s, 'hillNumber', c.counts, c.q),
    },
    {
      fn: 'hillNumbers',
      group: 'hillNumbers',
      aspect: 'q0-q1-q2',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/coverage.ts`,
      cause: 'hillNumbers does not return the orders 0, 1 and 2',
      tol: { rel: 1e-9, abs: 1e-300 },
      call: (s, c) => call(s, 'hillNumbers', c.counts),
    },

    // ---- variance ----------------------------------------------------------------------------------------
    {
      fn: 'varianceComponents',
      group: 'varianceComponents',
      aspect: 'balanced-anova',
      family: 'exact-estimators',
      tier: 4,
      component: `${SRC}/variance.ts`,
      cause: 'varianceComponents differs from the balanced nested ANOVA',
      tol: { rel: 1e-9, abs: 1e-12 },
      call: (s, c) => {
        const r = call(s, 'varianceComponents', c.observations) as {
          n: number;
          mean: number;
          total: number;
          components: Row[];
        };
        return {
          n: r.n,
          mean: r.mean,
          total: r.total,
          components: r.components.map((k) => ({
            level: k.level,
            groups: k.groups,
            df: k.df,
            sumSquares: k.sumSquares,
            meanSquare: k.meanSquare,
            estimate: k.estimate,
            variance: k.variance,
            share: k.share,
          })),
        };
      },
    },
    {
      fn: 'icc',
      group: 'icc',
      aspect: 'cumulative',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/variance.ts`,
      cause: 'icc is not the cumulative variance over the total',
      tol: EXACT,
      call: (s, c) =>
        call(s, 'icc', {
          method: 'anova',
          balanced: true,
          n: 100,
          mean: 0,
          total: c.total,
          components: (c.components as Row[]).map((k) => ({
            level: k.level,
            groups: 1,
            df: 1,
            sumSquares: 0,
            meanSquare: 0,
            estimate: k.variance,
            variance: k.variance,
            share: k.share,
            estimable: true,
          })),
        }),
    },
    {
      fn: 'neymanAllocation',
      group: 'neymanAllocation',
      aspect: 'exact-shares',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/variance.ts`,
      cause: 'neymanAllocation exact shares are not total N_h S_h / sum(N_h S_h)',
      tol: EXACT,
      call: (s, c) => ({
        exact: (
          call(s, 'neymanAllocation', { sizes: c.sizes, sds: c.sds, total: c.total }) as { exact: number[] }
        ).exact,
      }),
    },
    {
      fn: 'repeatsForFloor',
      group: 'repeatsForFloor',
      aspect: 'closed-form',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/variance.ts`,
      cause: 'repeatsForFloor is not ceil(f z^2 variance / (blocks floor^2))',
      tol: EXACT,
      call: (s, c) =>
        call(s, 'repeatsForFloor', {
          variance: c.variance,
          floor: c.floor,
          z: c.z,
          blocks: c.blocks,
          difference: c.difference,
        }),
    },

    // ---- paired ------------------------------------------------------------------------------------------
    {
      fn: 'pairedRateDifference',
      group: 'pairedRateDifference',
      aspect: 'newcombe',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/paired.ts`,
      cause: 'pairedRateDifference differs from Newcombe method 10',
      tol: { rel: 1e-9, abs: 1e-12 },
      call: (s, c) => call(s, 'pairedRateDifference', c.table, c.alpha),
    },
    {
      fn: 'nonInferiority',
      group: 'nonInferiority',
      aspect: 'verdict',
      family: 'exact-estimators',
      tier: 3,
      component: `${SRC}/paired.ts`,
      cause: 'nonInferiority verdict or effect differs from the reference',
      tol: { rel: 1e-9, abs: 1e-12 },
      call: (s, c) => {
        const r = call(s, 'nonInferiority', {
          baseline: c.baseline,
          candidate: c.candidate,
          margin: c.margin,
        }) as {
          nonInferior: boolean;
          effect: unknown;
          discordant: { regressed: number; improved: number };
        };
        return {
          nonInferior: r.nonInferior,
          effect: r.effect,
          regressed: r.discordant.regressed,
          improved: r.discordant.improved,
        };
      },
    },
  ];
  return [...specs.map(exactItem), parseSpellingItem(), headlineTreeKeyItem()];
}

/** The three spellings the reducers read, and the refusal of everything else. */
function parseSpellingItem(): BankItem {
  return {
    id: 'exact.parseRepeatReducer.spellings',
    family: 'exact-estimators',
    tier: 2,
    level: 'analytic',
    component: `${SRC}/repeat-reducers.ts`,
    cause: 'parseRepeatReducer does not read mode, median and at_least:<k>, or accepts another spelling',
    check: ({ s }) => {
      const read: [string, unknown][] = [
        ['mode', { kind: 'mode' }],
        ['median', { kind: 'median' }],
        ['at_least:1', { kind: 'at_least', k: 1 }],
        ['at_least:12', { kind: 'at_least', k: 12 }],
      ];
      const misses: string[] = [];
      for (const [spelling, want] of read) {
        const got = attempt(() => call(s, 'parseRepeatReducer', spelling));
        if (got.error) misses.push(`${spelling} threw ${got.error.message}`);
        else if (JSON.stringify(got.value) !== JSON.stringify(want))
          misses.push(`${spelling} gave ${show(got.value)}, want ${show(want)}`);
      }
      for (const spelling of [
        'at_least:0',
        'at_least:-1',
        'at_least:',
        'Mode',
        'mean',
        ' median',
        'at_least:1.5',
        '',
      ]) {
        const got = attempt(() => call(s, 'parseRepeatReducer', spelling));
        if (!got.error)
          misses.push(
            `${show(spelling)} was accepted; only mode, median and at_least:<k> (k >= 1) are spellings`,
          );
      }
      return misses.length === 0 ? ok() : fail(`parseRepeatReducer: ${misses.slice(0, 3).join(' | ')}`);
    },
  };
}

/**
 * The tree of the suite headline is whatever `treeOf` says: grouping by spec gives one tree per golden, one key
 * for all gives a single tree (no interval can be drawn), and a key per run makes every run its own tree. The
 * default of the report (the golden) is only a choice of key.
 */
export function headlineTreeKeyItem(): BankItem {
  return {
    id: 'exact.suiteHeadline.tree-key',
    family: 'exact-estimators',
    tier: 4,
    level: 'analytic',
    component: HEADLINE,
    cause: 'suiteHeadline ignores the tree key it is given (it groups by a fixed key)',
    budgetMs: 60_000,
    check: async ({ root }) => {
      const goldens = [
        { n: 4, k: 4 },
        { n: 4, k: 1 },
        { n: 2, k: 2 },
        { n: 6, k: 3 },
      ];
      const fnHead = (await load(root, HEADLINE)).suiteHeadline as HeadlineFn;
      const runs = runsOfGoldens(goldens);
      const bySpec = fnHead(runs, (r) => r.specId);
      const one = fnHead(runs, () => 'all');
      const perRun = fnHead(runs, (r) => `${r.specId}#${r.repeat}`);
      const misses: string[] = [];
      if (bySpec?.trees !== 4) misses.push(`one key per spec gave ${show(bySpec?.trees)} trees, want 4`);
      if (one?.trees !== 1 || one?.method !== 'none')
        misses.push(
          `one key for all gave ${show(one?.trees)} trees and method ${show(one?.method)}, want 1 and none`,
        );
      if (perRun?.trees !== runs.length)
        misses.push(`one key per run gave ${show(perRun?.trees)} trees, want ${runs.length}`);
      return misses.length === 0 ? ok() : fail(`suiteHeadline: ${misses.join('; ')}`);
    },
  };
}

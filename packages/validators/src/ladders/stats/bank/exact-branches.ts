import type { StatsImpl } from '../reference';
import { BRANCH_FIXTURE, call, EXACT, exactItem, LIBRARY, type Row, type Spec, SRC, type Tol } from './exact';
import type { BankItem, Tier } from './item';

/**
 * Items on single branches of the functions that the audit of the bank (docs/validators.md section 12) found
 * weakest: after the first exact items, a fault of 0.2 percent in each of them was caught by one or two items,
 * and a fault on one branch (a tie rule, an edge of the domain, an option) by none that reached that branch.
 * Each group of cases of `exact-branches.json` (made by `make_exact_branches.py` from documented formulas in
 * exact rational arithmetic, numpy, scipy or the standard library) reaches one branch, and each is its own item
 * with its own cause. Tolerances follow the source of the number, as in exact.ts.
 */

const FILE = BRANCH_FIXTURE;
const BASICS = `${SRC}/basics.ts`;
const INTERVALS = `${SRC}/intervals.ts`;
const COVERAGE = `${SRC}/coverage.ts`;
const VARIANCE = `${SRC}/variance.ts`;
const DRIFT = `${SRC}/drift.ts`;
const PAIRED = `${SRC}/paired.ts`;

const MODEL: Tol = { rel: 1e-9, abs: 1e-12 };
const GRID: (path: string) => Tol = (path) => (path === 'estimate' ? EXACT : { rel: 0, abs: 0.005 });

type Extra = Partial<Pick<Spec, 'fields' | 'budgetMs' | 'only'>>;

function spec(
  fn: string,
  aspect: string,
  component: string,
  tier: Tier,
  cause: string,
  tol: Tol | ((path: string) => Tol),
  run: (s: StatsImpl, c: Row) => unknown,
  extra: Extra = {},
  group = `${fn}.${aspect}`,
): Spec {
  return {
    fn,
    group,
    file: FILE,
    aspect,
    family: 'exact-estimators',
    tier,
    component,
    cause,
    tol,
    call: run,
    ...extra,
  };
}

const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

export function branchItems(): BankItem[] {
  const specs: Spec[] = [
    // ---- siblings of the calls a package could hard-code ------------------------------------------------
    spec(
      'normalSf',
      'sibling-infinite',
      `${SRC}/special.ts`,
      2,
      'normalSf at +-Infinity or beyond 1e300 is not the limit of the distribution',
      EXACT,
      (s, c) => call(s, 'normalSf', c.z),
      {},
      'sibling.normalSf-infinite',
    ),
    spec(
      'normalCdf',
      'sibling-far',
      `${SRC}/special.ts`,
      2,
      'normalCdf far out (1e300, 40, -40) is not the limit or the scipy value',
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'normalCdf', c.z),
      {},
      'sibling.normalCdf-far',
    ),
    spec(
      'erfc',
      'sibling-infinite',
      `${SRC}/special.ts`,
      2,
      'erfc at +-Infinity or beyond 1e300 is not 0 and 2',
      EXACT,
      (s, c) => call(s, 'erfc', c.x),
      {},
      'sibling.erfc-infinite',
    ),
    spec(
      'chiSquareSf',
      'sibling-infinite',
      `${SRC}/special.ts`,
      2,
      'chiSquareSf at Infinity or 1e300 is not 0 for every degrees of freedom',
      EXACT,
      (s, c) => call(s, 'chiSquareSf', c.x, c.df),
      {},
      'sibling.chiSquareSf-infinite',
    ),
    spec(
      'mean',
      'sibling-no-overflow',
      BASICS,
      3,
      'mean overflows on large finite values (it must divide before it adds, or scale)',
      EXACT,
      (s, c) => call(s, 'mean', c.values),
      {},
      'sibling.mean-no-overflow',
    ),
    spec(
      'betaQuantile',
      'sibling-u-shaped',
      `${SRC}/special.ts`,
      3,
      'betaQuantile with a shape below 1 differs from scipy.special.betaincinv',
      { rel: 1e-6, abs: 1e-300 },
      (s, c) => call(s, 'betaQuantile', c.p, c.a, c.b),
      {},
      'sibling.betaQuantile-u-shaped',
    ),
    spec(
      'hillNumber',
      'sibling-near-one',
      COVERAGE,
      3,
      'hillNumber near q = 1 is not continuous with exp(Shannon entropy)',
      { rel: 1e-5, abs: 1e-300 },
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
      {},
      'sibling.hillNumber-near-one',
    ),

    // ---- valid inputs that look odd: a blanket throw on non-finite or empty arguments fails these -------
    spec(
      'normalCdf',
      'valid-odd',
      `${SRC}/special.ts`,
      2,
      'normalCdf of +-Infinity throws instead of returning the limit',
      EXACT,
      (s, c) => call(s, 'normalCdf', c.z),
      {},
      'valid-odd.normalCdf',
    ),
    spec(
      'normalQuantile',
      'valid-odd',
      `${SRC}/special.ts`,
      2,
      'normalQuantile of 0 and 1 throws instead of returning -Infinity and Infinity',
      EXACT,
      (s, c) => call(s, 'normalQuantile', c.p),
      {},
      'valid-odd.normalQuantile',
    ),
    spec(
      'logGamma',
      'valid-odd',
      `${SRC}/special.ts`,
      2,
      'logGamma at a pole throws or returns a finite value instead of Infinity',
      EXACT,
      (s, c) => call(s, 'logGamma', c.x),
      {},
      'valid-odd.logGamma',
    ),
    spec(
      'kolmogorovSf',
      'valid-odd',
      `${SRC}/drift.ts`,
      2,
      'kolmogorovSf at Infinity, 0 or below throws instead of returning the limit',
      EXACT,
      (s, c) => call(s, 'kolmogorovSf', c.x),
      {},
      'valid-odd.kolmogorovSf',
    ),
    spec(
      'benjaminiHochberg',
      'valid-odd',
      `${SRC}/multiple.ts`,
      2,
      'benjaminiHochberg of no p-values throws instead of returning empty lists',
      EXACT,
      (s, c) => call(s, 'benjaminiHochberg', c.pvalues, c.q),
      {},
      'valid-odd.benjaminiHochberg',
    ),
    spec(
      'abundances',
      'valid-odd',
      COVERAGE,
      2,
      'abundances of no labels throws instead of returning no classes',
      EXACT,
      (s, c) => call(s, 'abundances', c.labels),
      {},
      'valid-odd.abundances',
    ),
    spec(
      'betaQuantile',
      'valid-odd',
      `${SRC}/special.ts`,
      2,
      'betaQuantile at p = 0 and p = 1 throws instead of the end of the support',
      EXACT,
      (s, c) => call(s, 'betaQuantile', c.p, c.a, c.b),
      {},
      'valid-odd.betaQuantile',
    ),
    spec(
      'incompleteBeta',
      'valid-odd',
      `${SRC}/special.ts`,
      2,
      'incompleteBeta at x = 0 and x = 1 is not 0 and 1',
      EXACT,
      (s, c) => call(s, 'incompleteBeta', c.x, c.a, c.b),
      {},
      'valid-odd.incompleteBeta',
    ),
    spec(
      'binomialCdf',
      'valid-odd',
      `${SRC}/special.ts`,
      2,
      'binomialCdf below 0 or at and above n throws instead of 0 and 1',
      EXACT,
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
      {},
      'valid-odd.binomialCdf',
    ),
    spec(
      'mde',
      'valid-odd',
      `${SRC}/power.ts`,
      3,
      'mde at a baseline rate of 0 or 1 throws instead of null or the documented effect',
      { rel: 1e-6, abs: 1e-12 },
      (s, c) => ({
        effect: (call(s, 'mde', { n: c.n, baselineRate: c.baselineRate }) as { effect: number | null })
          .effect,
      }),
      {},
      'valid-odd.mde',
    ),
    spec(
      'hillNumber',
      'valid-odd',
      COVERAGE,
      3,
      'hillNumber of a negative order throws instead of (sum p^q)^(1 / (1 - q))',
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
      {},
      'valid-odd.hillNumber',
    ),
    spec(
      'wilson',
      'valid-odd',
      INTERVALS,
      2,
      'wilson at k = 0 or k = n is not the closed form',
      { rel: 1e-9, abs: 1e-12 },
      (s, c) => {
        const w = call(s, 'wilson', c.k, c.n, c.z) as { lower: number; upper: number };
        return [w.lower, w.upper];
      },
      {},
      'valid-odd.wilson',
    ),

    // ---- binomialCdf -------------------------------------------------------------------------------------
    spec(
      'binomialCdf',
      'exact-small',
      `${SRC}/special.ts`,
      2,
      'binomialCdf differs from the exact rational sum on small n with dyadic p',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
    ),
    spec(
      'binomialCdf',
      'edges',
      `${SRC}/special.ts`,
      2,
      'binomialCdf is not 0 below k = 0, 1 from k = n, or the point mass at p = 0 and p = 1',
      EXACT,
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
    ),
    spec(
      'binomialCdf',
      'upper-tail',
      `${SRC}/special.ts`,
      3,
      'binomialCdf differs from the exact rational sum near k = n',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
    ),
    spec(
      'binomialCdf',
      'lower-tail-tiny',
      `${SRC}/special.ts`,
      3,
      'binomialCdf loses relative accuracy in the far lower tail (probabilities near 1e-50)',
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
    ),
    spec(
      'binomialCdf',
      'moderate-n',
      `${SRC}/special.ts`,
      3,
      'binomialCdf differs from scipy.stats.binom.cdf for n from 200 to 2000',
      { rel: 1e-10, abs: 1e-300 },
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
    ),

    // ---- zeroFailureBound --------------------------------------------------------------------------------
    ...(['table', 'exact-integers', 'tiny-p', 'high-confidence', 'large-p'] as const).map((aspect) =>
      spec(
        'zeroFailureBound',
        aspect,
        INTERVALS,
        aspect === 'tiny-p' ? 3 : 2,
        `zeroFailureBound is not ceil(ln alpha / ln(1 - p)) on the case "${aspect}"`,
        { rel: 0, abs: 0 },
        (s, c) => call(s, 'zeroFailureBound', c.p, c.alpha),
      ),
    ),

    // ---- reduceRepeats, one item per reducer ------------------------------------------------------------
    ...(['mode', 'median', 'at-least', 'unscored-left-out'] as const).map((aspect) =>
      spec(
        'reduceRepeats',
        aspect,
        `${SRC}/repeat-reducers.ts`,
        3,
        `reduceRepeats gives a verdict other than the documented rule of the case "${aspect}"`,
        EXACT,
        (s, c) => {
          const reducer = call(s, 'parseRepeatReducer', c.reducer);
          const v = call(
            s,
            'reduceRepeats',
            (c.values as (number | null)[]).map((x) => (x === null ? undefined : x)),
            reducer,
          );
          return v === undefined ? null : v;
        },
      ),
    ),

    // ---- abundances and mulberry32 ----------------------------------------------------------------------
    ...(['first-seen-order', 'number-and-string-differ', 'counts-sum'] as const).map((aspect) =>
      spec('abundances', aspect, COVERAGE, 2, `abundances is wrong on the case "${aspect}"`, EXACT, (s, c) =>
        call(s, 'abundances', c.labels),
      ),
    ),
    spec(
      'mulberry32',
      'seed-wrap',
      BASICS,
      2,
      'mulberry32 does not take the seed modulo 2^32',
      EXACT,
      (s, c) => {
        const next = call(s, 'mulberry32', c.seed) as () => number;
        return Array.from({ length: (c.expected as number[]).length }, () => next());
      },
    ),
    spec(
      'mulberry32',
      'long-stream',
      BASICS,
      2,
      'mulberry32 drifts from the published stream over 2000 draws',
      { rel: 1e-12, abs: 1e-12 },
      (s, c) => {
        const next = call(s, 'mulberry32', c.seed) as () => number;
        const draws = Array.from({ length: c.n as number }, () => next());
        return {
          sum: draws.reduce((a, b) => a + b, 0),
          min: Math.min(...draws),
          max: Math.max(...draws),
          last: draws[draws.length - 1],
          first: draws[0],
        };
      },
    ),

    // ---- zFor --------------------------------------------------------------------------------------------
    spec(
      'zFor',
      'levels',
      INTERVALS,
      2,
      'zFor differs from the two-sided normal quantile at the common levels (0.9 to 1e-4)',
      { rel: 1e-11, abs: 1e-300 },
      (s, c) => call(s, 'zFor', c.alpha),
    ),
    spec(
      'zFor',
      'far-tail',
      INTERVALS,
      3,
      'zFor differs from the two-sided normal quantile at alpha between 1e-5 and 1e-9',
      LIBRARY,
      (s, c) => call(s, 'zFor', c.alpha),
    ),
    spec(
      'zFor',
      'monotone',
      INTERVALS,
      2,
      'zFor does not grow as alpha falls, or does not return one value per level',
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => (c.alphas as number[]).map((a) => call(s, 'zFor', a)),
    ),

    // ---- quantile and quantileSorted ---------------------------------------------------------------------
    ...(['quantile', 'quantileSorted'] as const).flatMap((name) => {
      const run = (s: StatsImpl, c: Row): unknown =>
        call(s, name, name === 'quantile' ? c.values : sorted(c.values), c.p);
      const t = EXACT;
      return [
        spec(
          name,
          'order-statistics',
          BASICS,
          2,
          `${name} at p = i / (n - 1) is not the i-th order statistic`,
          t,
          run,
          {},
          'quantile.order-statistics',
        ),
        spec(
          name,
          'interpolation',
          BASICS,
          2,
          `${name} does not interpolate linearly between order statistics at rational p`,
          t,
          run,
          {},
          'quantile.interpolation',
        ),
        spec(
          name,
          'small-samples',
          BASICS,
          2,
          `${name} of one or two values is not the value or the linear interpolation`,
          t,
          run,
          {},
          'quantile.small-samples',
        ),
        spec(
          name,
          'ties',
          BASICS,
          2,
          `${name} of a sample with repeated values differs from numpy type 7`,
          t,
          run,
          {},
          'quantile.ties',
        ),
        spec(
          name,
          'unsorted',
          BASICS,
          2,
          `${name} of a sample in random order differs from numpy type 7`,
          t,
          run,
          {},
          'quantile.unsorted',
        ),
      ];
    }),

    // ---- unreliability -----------------------------------------------------------------------------------
    spec(
      'unreliability',
      'p90-p10',
      BASICS,
      2,
      'unreliability is not the 90th minus the 10th percentile on a spread sample',
      EXACT,
      (s, c) => call(s, 'unreliability', c.samples),
    ),
    spec(
      'unreliability',
      'constant',
      BASICS,
      2,
      'unreliability of a constant sample is not exactly 0',
      EXACT,
      (s, c) => call(s, 'unreliability', c.samples),
    ),
    spec(
      'unreliability',
      'pass-flags',
      BASICS,
      2,
      'unreliability of 0/1 flags is not the share of fails between the deciles',
      EXACT,
      (s, c) => call(s, 'unreliability', c.samples),
    ),

    // ---- sampleVariance ----------------------------------------------------------------------------------
    spec(
      'sampleVariance',
      'integers',
      BASICS,
      2,
      'sampleVariance of small integers is not the n - 1 variance',
      EXACT,
      (s, c) => call(s, 'sampleVariance', c.values),
    ),
    spec(
      'sampleVariance',
      'two-values',
      BASICS,
      2,
      'sampleVariance of two values is not (a - b)^2 / 2',
      EXACT,
      (s, c) => call(s, 'sampleVariance', c.values),
    ),
    spec(
      'sampleVariance',
      'offset',
      BASICS,
      3,
      'sampleVariance loses digits on values with a large common offset',
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'sampleVariance', c.values),
    ),
    spec(
      'sampleVariance',
      'tiny-spread',
      BASICS,
      3,
      'sampleVariance loses digits on values that differ in the twelfth digit',
      { rel: 1e-6, abs: 1e-300 },
      (s, c) => call(s, 'sampleVariance', c.values),
    ),
    spec(
      'sampleVariance',
      'mixed-scale',
      BASICS,
      3,
      'sampleVariance loses digits on values of both signs and mixed magnitude',
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'sampleVariance', c.values),
    ),
    spec(
      'sampleVariance',
      'constant',
      BASICS,
      2,
      'sampleVariance of a constant sample is not exactly 0',
      { rel: 0, abs: 0 },
      (s, c) => call(s, 'sampleVariance', c.values),
    ),

    // ---- designEffect and effectiveSampleSize ------------------------------------------------------------
    spec(
      'designEffect',
      'no-clustering',
      INTERVALS,
      2,
      'designEffect is not 1 when m = 1 or rho = 0',
      EXACT,
      (s, c) => call(s, 'designEffect', c.m, c.rho),
    ),
    spec(
      'designEffect',
      'full-correlation',
      INTERVALS,
      2,
      'designEffect at rho = 1 is not m',
      EXACT,
      (s, c) => call(s, 'designEffect', c.m, c.rho),
    ),
    spec(
      'designEffect',
      'negative-rho',
      INTERVALS,
      2,
      'designEffect with a negative rho is not 1 + (m - 1) rho',
      EXACT,
      (s, c) => call(s, 'designEffect', c.m, c.rho),
    ),
    spec(
      'designEffect',
      'fractional-m',
      INTERVALS,
      2,
      'designEffect with a non-integer m is not 1 + (m - 1) rho',
      EXACT,
      (s, c) => call(s, 'designEffect', c.m, c.rho),
    ),
    spec(
      'effectiveSampleSize',
      'no-clustering',
      INTERVALS,
      2,
      'effectiveSampleSize is not n when m = 1 or rho = 0',
      EXACT,
      (s, c) => call(s, 'effectiveSampleSize', c.n, c.m, c.rho),
    ),
    spec(
      'effectiveSampleSize',
      'full-correlation',
      INTERVALS,
      2,
      'effectiveSampleSize at rho = 1 is not n / m',
      EXACT,
      (s, c) => call(s, 'effectiveSampleSize', c.n, c.m, c.rho),
    ),
    spec(
      'effectiveSampleSize',
      'negative-rho',
      INTERVALS,
      2,
      'effectiveSampleSize with a negative rho is not above n',
      EXACT,
      (s, c) => call(s, 'effectiveSampleSize', c.n, c.m, c.rho),
    ),
    spec(
      'effectiveSampleSize',
      'fractional',
      INTERVALS,
      2,
      'effectiveSampleSize with a non-integer n or m is not n / (1 + (m - 1) rho)',
      EXACT,
      (s, c) => call(s, 'effectiveSampleSize', c.n, c.m, c.rho),
    ),

    // ---- goodTuring, hillNumber, hillNumbers -------------------------------------------------------------
    spec(
      'goodTuring',
      'all-singletons',
      COVERAGE,
      2,
      'goodTuring of all singletons does not give coverage 0 and discovery 1',
      EXACT,
      (s, c) => call(s, 'goodTuring', c.counts),
    ),
    spec(
      'goodTuring',
      'no-singletons',
      COVERAGE,
      2,
      'goodTuring without singletons does not give coverage 1 and discovery 0',
      EXACT,
      (s, c) => call(s, 'goodTuring', c.counts),
    ),
    spec('goodTuring', 'mixed', COVERAGE, 2, 'goodTuring is not f1 / n on a mixed sample', EXACT, (s, c) =>
      call(s, 'goodTuring', c.counts),
    ),
    spec(
      'goodTuring',
      'zero-counts',
      COVERAGE,
      2,
      'goodTuring counts a class with a count of 0 as observed',
      EXACT,
      (s, c) => call(s, 'goodTuring', c.counts),
    ),
    spec(
      'goodTuring',
      'fields',
      COVERAGE,
      2,
      'goodTuring reports n, observed, f1 or f2 wrongly',
      EXACT,
      (s, c) => call(s, 'goodTuring', c.counts),
      { fields: ['n', 'observed', 'f1', 'f2'] },
    ),
    spec(
      'hillNumber',
      'uniform',
      COVERAGE,
      2,
      'hillNumber of k equally common classes is not k',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
    ),
    spec(
      'hillNumber',
      'single-class',
      COVERAGE,
      2,
      'hillNumber of one class is not 1',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
    ),
    spec(
      'hillNumber',
      'richness-ignores-zeros',
      COVERAGE,
      2,
      'hillNumber of order 0 counts a class with a count of 0',
      EXACT,
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
    ),
    spec(
      'hillNumber',
      'simpson',
      COVERAGE,
      3,
      'hillNumber of order 2 is not 1 / sum p^2',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
    ),
    spec(
      'hillNumber',
      'shannon',
      COVERAGE,
      3,
      'hillNumber of order 1 is not exp(-sum p ln p)',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
    ),
    spec(
      'hillNumber',
      'scale-free',
      COVERAGE,
      3,
      'hillNumber changes when every count is multiplied by a constant',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'hillNumber', c.counts, c.q),
    ),
    spec(
      'hillNumbers',
      'orders',
      COVERAGE,
      3,
      'hillNumbers does not return the orders 0, 1 and 2 of the sample',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'hillNumbers', c.counts),
    ),
    spec(
      'hillNumbers',
      'ordered',
      COVERAGE,
      3,
      'hillNumbers is not ordered q0 >= q1 >= q2 >= 1',
      { rel: 1e-12, abs: 1e-300 },
      (s, c) => call(s, 'hillNumbers', c.counts),
    ),

    // ---- icc ---------------------------------------------------------------------------------------------
    ...(['one-level', 'two-levels', 'three-levels', 'zero-total', 'last-level-reaches-share'] as const).map(
      (aspect) =>
        spec(
          'icc',
          aspect,
          VARIANCE,
          3,
          `icc is wrong on the case "${aspect}" (cumulative variance over the total)`,
          EXACT,
          (s, c) =>
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
        ),
    ),

    // ---- neymanAllocation --------------------------------------------------------------------------------
    spec(
      'neymanAllocation',
      'integer-optimum',
      VARIANCE,
      4,
      'neymanAllocation is not the integer allocation with the least stratified variance',
      { rel: 1e-9, abs: 1e-12 },
      (s, c) => {
        const r = call(s, 'neymanAllocation', { sizes: c.sizes, sds: c.sds, total: c.total }) as {
          allocated: number[];
        };
        const w = (c.sizes as number[]).map((x, i) => x * (c.sds as number[])[i]!);
        let objective = 0;
        r.allocated.forEach((n, i) => {
          if (n > 0) objective += (w[i]! * w[i]!) / n;
          else if (w[i]! > 0) objective = Number.POSITIVE_INFINITY;
        });
        return { objective };
      },
    ),
    spec(
      'neymanAllocation',
      'sums-to-total',
      VARIANCE,
      3,
      'neymanAllocation does not return whole numbers that sum to the total',
      EXACT,
      (s, c) => {
        const r = call(s, 'neymanAllocation', { sizes: c.sizes, sds: c.sds, total: c.total }) as {
          allocated: number[];
        };
        return {
          sum: r.allocated.reduce((a, b) => a + b, 0),
          wholeNumbers: r.allocated.every((n) => Number.isInteger(n) && n >= 0),
        };
      },
    ),
    spec(
      'neymanAllocation',
      'zero-spread',
      VARIANCE,
      3,
      'neymanAllocation with every spread 0 is not proportional to the sizes',
      EXACT,
      (s, c) => ({
        exact: (
          call(s, 'neymanAllocation', { sizes: c.sizes, sds: c.sds, total: c.total }) as { exact: number[] }
        ).exact,
      }),
    ),
    spec(
      'neymanAllocation',
      'every-stratum-sampled',
      VARIANCE,
      3,
      'neymanAllocation leaves a stratum with spread unsampled although the total allows one unit each',
      EXACT,
      (s, c) => {
        const r = call(s, 'neymanAllocation', { sizes: c.sizes, sds: c.sds, total: c.total }) as {
          allocated: number[];
        };
        return { minimum: Math.min(1, ...r.allocated.filter((_, i) => (c.sds as number[])[i]! > 0)) };
      },
    ),

    // ---- pageHinkley -------------------------------------------------------------------------------------
    ...(
      [
        'before-minimum',
        'alarm-up',
        'alarm-down',
        'reset-after-alarm',
        'delta-tolerance',
        'min-instances-boundary',
        'quiet-series',
      ] as const
    ).map((aspect) =>
      spec(
        'pageHinkley',
        aspect,
        DRIFT,
        3,
        `pageHinkley differs from the recursion on the case "${aspect}"`,
        EXACT,
        (s, c) => call(s, 'pageHinkley', c.series, c.options),
      ),
    ),

    // ---- pairedRateDifference ----------------------------------------------------------------------------
    ...(
      [
        'positive-covariance',
        'negative-covariance',
        'zero-margin',
        'extreme-tables',
        'levels',
        'sign',
      ] as const
    ).map((aspect) =>
      spec(
        'pairedRateDifference',
        aspect,
        PAIRED,
        3,
        `pairedRateDifference differs from Newcombe method 10 on the case "${aspect}"`,
        MODEL,
        (s, c) => call(s, 'pairedRateDifference', c.table, c.alpha),
      ),
    ),
    spec(
      'pairedRateDifference',
      'swap-mirrors',
      PAIRED,
      3,
      'pairedRateDifference is not antisymmetric: swapping regressed and improved does not negate and mirror the interval',
      MODEL,
      (s, c) => {
        const r = call(s, 'pairedRateDifference', c.swapped) as {
          estimate: number;
          lower: number;
          upper: number;
        };
        return { estimate: -r.estimate, lower: -r.upper, upper: -r.lower };
      },
    ),

    // ---- nonInferiority ----------------------------------------------------------------------------------
    ...(['clear-parity', 'clear-regression', 'margin-boundary', 'gating-flag', 'named-pairs'] as const).map(
      (aspect) =>
        spec(
          'nonInferiority',
          aspect,
          PAIRED,
          3,
          `nonInferiority gives a wrong verdict, effect or list on the case "${aspect}"`,
          MODEL,
          (s, c) => {
            const r = call(s, 'nonInferiority', {
              baseline: c.baseline,
              candidate: c.candidate,
              margin: c.margin,
              alpha: c.alpha,
              ...(c.gatingFlags ? { gatingFlags: c.gatingFlags } : {}),
              ...(c.pairs ? { pairs: c.pairs } : {}),
            }) as {
              nonInferior: boolean;
              effect: unknown;
              discordant: { regressed: number; improved: number };
              regressedPairs: string[];
              newFlags: string[];
            };
            return {
              nonInferior: r.nonInferior,
              effect: r.effect,
              regressed: r.discordant.regressed,
              improved: r.discordant.improved,
              regressedPairs: r.regressedPairs,
              newFlags: r.newFlags,
            };
          },
        ),
    ),

    // ---- repeatsForFloor ---------------------------------------------------------------------------------
    ...(
      [
        'difference',
        'single-version',
        'blocks',
        'custom-z',
        'flip-rate',
        'zero-variance',
        'integer-ratio',
        'floor-reached',
      ] as const
    ).map((aspect) =>
      spec(
        'repeatsForFloor',
        aspect,
        VARIANCE,
        3,
        `repeatsForFloor differs from ceil(f z^2 variance / (blocks floor^2)) on the case "${aspect}"`,
        EXACT,
        (s, c) =>
          call(s, 'repeatsForFloor', {
            ...(c.variance === undefined ? {} : { variance: c.variance }),
            ...(c.flipRate === undefined ? {} : { flipRate: c.flipRate }),
            floor: c.floor,
            blocks: c.blocks,
            difference: c.difference,
            ...(c.z === undefined ? {} : { z: c.z }),
          }),
      ),
    ),

    // ---- simulateCoverage --------------------------------------------------------------------------------
    spec(
      'simulateCoverage',
      'analytic-control',
      `${SRC}/simulate.ts`,
      4,
      'simulateCoverage does not draw independent blocks when the concentration is huge (the naive Wilson coverage differs from its binomial expectation)',
      () => ({ rel: 0, abs: 0.025 }),
      (s, c) => call(s, 'simulateCoverage', c.cell, { reps: c.reps, seed: c.seed }),
      { budgetMs: 60_000 },
    ),

    // ---- varianceComponents ------------------------------------------------------------------------------
    ...(['unbalanced', 'binary', 'negative-estimate', 'not-estimable'] as const).map((aspect) =>
      spec(
        'varianceComponents',
        aspect,
        VARIANCE,
        4,
        `varianceComponents differs from Henderson's method I on the case "${aspect}"`,
        MODEL,
        (s, c) => {
          const r = call(s, 'varianceComponents', c.observations) as {
            n: number;
            total: number;
            components: Row[];
          };
          return {
            n: r.n,
            total: r.total,
            components: r.components.map((k) => ({
              level: k.level,
              groups: k.groups,
              df: k.df,
              estimate: k.estimate,
              variance: k.variance,
              share: k.share,
              estimable: k.estimable,
            })),
          };
        },
      ),
    ),
    spec(
      'varianceComponents',
      'mean-and-n',
      VARIANCE,
      2,
      'varianceComponents reports a wrong n or grand mean',
      MODEL,
      (s, c) => {
        const r = call(s, 'varianceComponents', c.observations) as { n: number; mean: number };
        return { n: r.n, mean: r.mean };
      },
    ),

    // ---- wilsonEffective ---------------------------------------------------------------------------------
    ...(
      ['all-pass', 'all-fail', 'single-cluster', 'no-spread', 'capped-at-n', 'levels', 't-widens'] as const
    ).map((aspect) =>
      spec(
        'wilsonEffective',
        aspect,
        `${SRC}/effective.ts`,
        4,
        `wilsonEffective differs from Wilson on the effective blocks on the case "${aspect}"`,
        { rel: 1e-8, abs: 1e-12 },
        (s, c) => call(s, 'wilsonEffective', c.clusters, { alpha: c.alpha, quantile: c.quantile }),
      ),
    ),

    // ---- hierarchicalBetaBinomial ------------------------------------------------------------------------
    ...(['large-trees', 'all-pass', 'all-fail', 'two-trees', 'levels', 'single-block-trees'] as const).map(
      (aspect) =>
        spec(
          'hierarchicalBetaBinomial',
          aspect,
          `${SRC}/hierarchical.ts`,
          4,
          `hierarchicalBetaBinomial differs from a fine integration of its model on the case "${aspect}"`,
          GRID,
          (s, c) => {
            const r = call(s, 'hierarchicalBetaBinomial', c.trees, { alpha: c.alpha }) as {
              estimate: number;
              lower: number;
              upper: number;
              posteriorMean: number;
            };
            return { estimate: r.estimate, lower: r.lower, upper: r.upper, posteriorMean: r.posteriorMean };
          },
          { budgetMs: 60_000 },
        ),
    ),
    spec(
      'hierarchicalBetaBinomial',
      'order-and-duplicates',
      `${SRC}/hierarchical.ts`,
      4,
      'hierarchicalBetaBinomial depends on the order of the trees',
      GRID,
      (s, c) => {
        const trees = [...(c.trees as { n: number; k: number }[])].reverse();
        const r = call(s, 'hierarchicalBetaBinomial', trees, { alpha: c.alpha }) as {
          estimate: number;
          lower: number;
          upper: number;
          posteriorMean: number;
        };
        return { estimate: r.estimate, lower: r.lower, upper: r.upper, posteriorMean: r.posteriorMean };
      },
    ),
  ];
  return specs.map(exactItem);
}

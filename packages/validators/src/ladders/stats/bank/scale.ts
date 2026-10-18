import type { Observation } from '@agent-nexus/driftbench-stats';
import { normal } from '../draw';
import type { StatsImpl } from '../reference';
import { attempt, type BankItem, fail, near, ok, show } from './item';

/**
 * Level `scale`: one million rows under a time budget (docs/validators.md section 12.2, rule 4: correct and slow is
 * a failing item), and numerical stability: a shift or a scale of the data that leaves the answer unchanged in
 * exact arithmetic must leave it unchanged to 1e-6 here, and the special functions must hold in their far tails.
 */

const MILLION = 1_000_000;
/** The time a one-million-row call may take: an O(n log n) call takes well under it, an O(n^2) one hours. */
export const SCALE_BUDGET_MS = 5_000;

const scaleItem = (id: string, component: string, check: BankItem['check']): BankItem => ({
  id: `scale.${id}`,
  family: 'scale',
  tier: 4,
  level: 'scale',
  component,
  budgetMs: 300_000,
  check,
});

/**
 * The processor time of a call in milliseconds (user and system, all threads of this process). Wall time on a
 * shared machine grows with the load of other processes; processor time does not, so budgets use it.
 */
export function cpuMs<T>(run: () => T): { got: { value?: T; error?: Error }; ms: number } {
  const start = process.cpuUsage();
  const got = attempt(run);
  const used = process.cpuUsage(start);
  return { got, ms: (used.user + used.system) / 1000 };
}

/** Times a call; fails when it throws, takes more processor time than the budget, or its result fails the check. */
function timed<T>(call: string, run: () => T, check: (value: T) => string | undefined) {
  const { got, ms } = cpuMs(run);
  if (got.error) return fail(`${call} threw ${got.error.name}: ${got.error.message}`);
  const wrong = check(got.value as T);
  if (wrong) return fail(`${call}: ${wrong}`);
  if (ms > SCALE_BUDGET_MS)
    return fail(
      `${call} took ${Math.round(ms)} ms of processor time, over the ${SCALE_BUDGET_MS} ms budget for one million rows; make it O(n log n) or better without per-row string keys or copies.`,
    );
  return ok(`${Math.round(ms)} ms`);
}

/**
 * Acceptance bands of scale.bootstrap-clustered, in units of the cluster standard error se of the data (the sd of
 * the 1000 cluster means over root 1000), all computed here from the values, never from the statistics package.
 * With 200 resamples the 0.95 percentile interval of a correct implementation has a width over 2 z se of mean
 * 0.977 and sd 0.064, and a midpoint at sd 0.130 se from the mean; the mean is t-distributed around 0.5. Simulated
 * law (10,000,000 sets of 200 resample means, packages/validators/test/stats/scale-bootstrap.test.ts checks the
 * bands against the real item): the first five conditions below together fail a correct implementation on
 * 0.00041 of the seeds, where the old demand (0.5 inside [lower, upper + 0.002]) failed it on 0.030. The level
 * check: the 0.5 interval over the 0.95 one (same resamples) has mean 0.351 and sd 0.032; outside `ratio` on
 * 0.0000088 of 5,000,000 simulated seeds. Total at most 0.00042.
 */
export const BOOTSTRAP_SCALE = { width: [0.7, 1.32], centre: 0.6, truth: 1.7, ratio: [0.2, 0.5] } as const;

/**
 * The check of the clustered bootstrap at scale: the estimate is the mean of the values (1e-9), the interval holds
 * that mean, its width over 2 z se lies in the width band, its midpoint lies within `centre` se of the mean, the
 * true mean 0.5 lies within `truth` se of the interval, and the interval at alpha 0.5 is the `ratio` share of it
 * (the level is used), and 300 resamples
 * give another interval than 200 (the number of resamples is used). The two extra calls are not timed.
 */
export function bootstrapScaleVerdict(
  values: readonly number[],
  keys: readonly number[],
  s: Pick<StatsImpl, 'bootstrapCI'>,
  clusters = 1000,
): (r: { estimate: number; lower: number; upper: number }) => string | undefined {
  const sums = new Array<number>(clusters).fill(0);
  values.forEach((value, i) => {
    sums[i % clusters] = (sums[i % clusters] as number) + value;
  });
  const per = values.length / clusters;
  const means = sums.map((sum) => sum / per);
  const mean = means.reduce((a, b) => a + b, 0) / clusters;
  const se = Math.sqrt(means.reduce((a, b) => a + (b - mean) ** 2, 0) / (clusters - 1) / clusters);
  const z = 1.959963984540054;
  const { width, centre, truth, ratio } = BOOTSTRAP_SCALE;
  return (r) => {
    const at = `interval [${r.lower}, ${r.upper}], estimate ${r.estimate}; the values have mean ${mean} and cluster standard error ${se}`;
    if (!near(r.estimate, mean, 1e-9)) return `${at}: the estimate is not the mean of the values`;
    if (!(r.lower < mean && mean < r.upper)) return `${at}: the interval does not hold the mean`;
    const w = (r.upper - r.lower) / (2 * z * se);
    if (!(width[0] <= w && w <= width[1]))
      return `${at}: its width is ${w} times 2 z se, outside ${width[0]} to ${width[1]} (a 0.95 interval)`;
    const c = ((r.upper + r.lower) / 2 - mean) / se;
    if (Math.abs(c) > centre) return `${at}: its midpoint is ${c} se from the mean, beyond ${centre}`;
    if (!(r.lower - truth * se <= 0.5 && 0.5 <= r.upper + truth * se))
      return `${at}: the true mean 0.5 lies more than ${truth} se outside it`;
    const half = s.bootstrapCI(values, { clusters: keys, iterations: 200, alpha: 0.5 });
    const share = (half.upper - half.lower) / (r.upper - r.lower);
    if (!(ratio[0] <= share && share <= ratio[1]))
      return `${at}: the interval at alpha 0.5 is [${half.lower}, ${half.upper}], ${share} of the 0.95 one, outside ${ratio[0]} to ${ratio[1]}: the level is not used`;
    // 300, not 400: at twice the count the two quantiles fall on the same interpolation weights, and a correct
    // implementation then gives the very same bounds on about 1 seed in 200.
    const more = s.bootstrapCI(values, { clusters: keys, iterations: 300 });
    if (more.lower === r.lower && more.upper === r.upper)
      return `${at}: 300 resamples give the same interval as 200: the number of resamples is not used`;
    return undefined;
  };
}

const B = 'packages/stats/src/basics.ts';
export function scaleItems(): BankItem[] {
  const out: BankItem[] = [];
  const arr = (rng: () => number, n = MILLION) => Array.from({ length: n }, () => rng());
  out.push(
    scaleItem('mean', B, ({ s, rng }) => {
      const v = arr(rng);
      const exact = v.reduce((a, b) => a + b, 0) / v.length;
      return timed(
        'mean(1e6 uniform values)',
        () => s.mean(v),
        (m) => (near(m, exact, 1e-9) ? undefined : `got ${m}, expected ${exact}`),
      );
    }),
    scaleItem('sample-variance', B, ({ s, rng }) => {
      const v = arr(rng);
      return timed(
        'sampleVariance(1e6 uniform values)',
        () => s.sampleVariance(v),
        (x) => (near(x, 1 / 12, 0.002) ? undefined : `got ${x}, expected about 1/12`),
      );
    }),
    scaleItem('quantile', B, ({ s, rng }) => {
      const v = arr(rng);
      return timed(
        'quantile(1e6 uniform values, 0.9)',
        () => s.quantile(v, 0.9),
        (x) => (near(x, 0.9, 0.003) ? undefined : `got ${x}, expected about 0.9`),
      );
    }),
    scaleItem('unreliability', 'packages/stats/src/reliability.ts', ({ s, rng }) => {
      const v = arr(rng);
      return timed(
        'unreliability(1e6 uniform values)',
        () => s.unreliability(v),
        (x) => (near(x, 0.8, 0.004) ? undefined : `got ${x}, expected about 0.8`),
      );
    }),
    scaleItem('bootstrap-clustered', 'packages/stats/src/intervals.ts', ({ s, rng }) => {
      const v = arr(rng);
      const keys = v.map((_, i) => i % 1000);
      const verdict = bootstrapScaleVerdict(v, keys, s);
      return timed(
        'bootstrapCI(1e6 values in 1000 clusters, { iterations: 200 })',
        () => s.bootstrapCI(v, { clusters: keys, iterations: 200 }),
        verdict,
      );
    }),
    scaleItem('wilcoxon', 'packages/stats/src/paired.ts', ({ s, rng }) => {
      const x = arr(rng);
      const y = arr(rng);
      return timed(
        'wilcoxonSignedRank(1e6 pairs)',
        () => s.wilcoxonSignedRank(x, y),
        (r) => (r.pValue >= 0 && r.pValue <= 1 ? undefined : `p ${r.pValue}`),
      );
    }),
    scaleItem('ks', 'packages/stats/src/drift.ts', ({ s, rng }) => {
      const a = arr(rng, MILLION / 2);
      const b = arr(rng, MILLION / 2);
      return timed(
        'ksTest(5e5 values, 5e5 values)',
        () => s.ksTest(a, b),
        (r) => (r.statistic < 0.01 ? undefined : `statistic ${r.statistic}`),
      );
    }),
    scaleItem('ks-exact-cap', 'packages/stats/src/drift.ts', ({ s, rng }) => {
      const a = arr(rng, 10_000);
      const b = arr(rng, 10_000);
      return timed(
        'ksTest(1e4 values, 1e4 values) (the largest exact case)',
        () => s.ksTest(a, b),
        (r) => (r.pValue >= 0 && r.pValue <= 1 ? undefined : `p ${r.pValue}`),
      );
    }),
    scaleItem('kappa', 'packages/stats/src/agreement.ts', ({ s, rng }) => {
      const a = Array.from({ length: MILLION }, () => (rng() < 0.5 ? 'x' : 'y'));
      const b = a.map((x) => (rng() < 0.8 ? x : 'x'));
      return timed(
        'cohenKappa(1e6 item pairs)',
        () => s.cohenKappa(a, b),
        (r) => (r.kappa > 0 && r.kappa < 1 ? undefined : `kappa ${r.kappa}`),
      );
    }),
    scaleItem('alpha', 'packages/stats/src/agreement.ts', ({ s, rng }) => {
      const a = Array.from({ length: 200_000 }, () => Math.floor(rng() * 4));
      const b = a.map((x) => (rng() < 0.8 ? x : 0));
      return timed(
        'krippendorffAlpha(2 coders x 2e5 units)',
        () => s.krippendorffAlpha([a, b]),
        (r) => (r.alpha > 0 && r.alpha < 1 ? undefined : `alpha ${r.alpha}`),
      );
    }),
    scaleItem('cusum', 'packages/stats/src/drift.ts', ({ s, rng }) => {
      const v = arr(rng);
      return timed(
        'cusum(1e6 values, { sd: 0.29 })',
        () => s.cusum(v, { sd: 0.29 }),
        (r) => (r.upper.length === MILLION ? undefined : 'wrong length'),
      );
    }),
    scaleItem('page-hinkley', 'packages/stats/src/drift.ts', ({ s, rng }) => {
      const v = arr(rng);
      return timed(
        'pageHinkley(1e6 values)',
        () => s.pageHinkley(v),
        (r) => (r.up.length === MILLION ? undefined : 'wrong length'),
      );
    }),
    scaleItem('benjamini-hochberg', 'packages/stats/src/multiple.ts', ({ s, rng }) => {
      const p = arr(rng);
      return timed(
        'benjaminiHochberg(1e6 p-values)',
        () => s.benjaminiHochberg(p),
        (r) => (r.adjusted.length === MILLION ? undefined : 'wrong length'),
      );
    }),
    scaleItem('chao', 'packages/stats/src/coverage.ts', ({ s, rng }) => {
      const c = Array.from({ length: MILLION }, () => Math.floor(rng() * 4));
      return timed(
        'chaoCoverage(1e6 class counts)',
        () => s.chaoCoverage(c),
        (r) => (r.coverage > 0 && r.coverage <= 1 ? undefined : `coverage ${r.coverage}`),
      );
    }),
    scaleItem('hill', 'packages/stats/src/coverage.ts', ({ s, rng }) => {
      const c = Array.from({ length: MILLION }, () => 1 + Math.floor(rng() * 9));
      return timed(
        'hillNumbers(1e6 class counts)',
        () => s.hillNumbers(c),
        (r) => (r.q0 === MILLION ? undefined : `q0 ${r.q0}`),
      );
    }),
    scaleItem('abundances', 'packages/stats/src/coverage.ts', ({ s, rng }) => {
      const labels = Array.from({ length: MILLION }, () => `cell-${Math.floor(rng() * 5000)}`);
      return timed(
        'abundances(1e6 labels)',
        () => s.abundances(labels),
        (r) => (r.reduce((a, b) => a + b, 0) === MILLION ? undefined : 'counts do not sum to 1e6'),
      );
    }),
    scaleItem('variance-components', 'packages/stats/src/variance.ts', ({ s, rng }) => {
      const obs: Observation[] = Array.from({ length: MILLION }, (_, i) => ({
        value: rng() < 0.5,
        path: [String(i % 50), String(i % 2000), String(i % 3)],
      }));
      return timed(
        'varianceComponents(1e6 observations, 50 cells)',
        () => s.varianceComponents(obs),
        (r) => (Number.isFinite(r.total) ? undefined : `total ${r.total}`),
      );
    }),
    scaleItem('neyman', 'packages/stats/src/variance.ts', ({ s, rng }) => {
      const sizes = Array.from({ length: 100_000 }, () => 1 + Math.floor(rng() * 100));
      const sds = sizes.map(() => rng());
      return timed(
        'neymanAllocation(1e5 strata, total 1e6)',
        () => s.neymanAllocation({ sizes, sds, total: MILLION }),
        (r) =>
          r.allocated.reduce((a, b) => a + b, 0) === MILLION
            ? undefined
            : 'allocation does not sum to the total',
      );
    }),
    scaleItem('non-inferiority', 'packages/stats/src/paired.ts', ({ s, rng }) => {
      const baseline = Array.from({ length: MILLION }, () => rng() < 0.8);
      const candidate = baseline.map((x) => (rng() < 0.99 ? x : !x));
      return timed(
        'nonInferiority(1e6 pairs, margin 0.01)',
        () => s.nonInferiority({ baseline, candidate, margin: 0.01 }),
        (r) => (typeof r.nonInferior === 'boolean' ? undefined : 'no verdict'),
      );
    }),
    scaleItem('good-turing', 'packages/stats/src/coverage.ts', ({ s, rng }) => {
      const c = Array.from({ length: MILLION }, () => Math.floor(rng() * 3));
      return timed(
        'goodTuring(1e6 class counts)',
        () => s.goodTuring(c),
        (r) => (r.coverage >= 0 && r.coverage <= 1 ? undefined : `coverage ${r.coverage}`),
      );
    }),
  );
  return out;
}

const stabItem = (id: string, component: string, check: BankItem['check']): BankItem => ({
  id: `stability.${id}`,
  family: 'numerical-stability',
  tier: 4,
  level: 'scale',
  component,
  check,
});

const rel = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1e-300, Math.abs(b));

export function stabilityItems(): BankItem[] {
  const out: BankItem[] = [];
  const sp = 'packages/stats/src/special.ts';
  const data = (rng: () => number, n = 200) => Array.from({ length: n }, () => normal(rng));
  for (const offset of [1e6, 1e9]) {
    // A value stored at 1e9 keeps about 1.2e-7 of absolute precision, so the tolerance follows the offset.
    const tol = offset >= 1e9 ? 1e-4 : 1e-6;
    out.push(
      stabItem(`variance-shift-${offset}`, B, ({ s, rng }) => {
        const v = data(rng);
        const a = s.sampleVariance(v);
        const b = s.sampleVariance(v.map((x) => x + offset));
        return rel(b, a, tol)
          ? ok()
          : fail(
              `sampleVariance changed from ${a} to ${b} when ${offset} was added to every value; a shift leaves the variance unchanged.`,
            );
      }),
      stabItem(`components-shift-${offset}`, 'packages/stats/src/variance.ts', ({ s, rng }) => {
        const obs: Observation[] = Array.from({ length: 120 }, (_, i) => ({
          value: normal(rng) + (i % 4),
          path: [String(i % 4), String(i % 12), String(i % 2)],
        }));
        const a = s.varianceComponents(obs).components.map((c) => c.estimate);
        const b = s
          .varianceComponents(obs.map((o) => ({ ...o, value: (o.value as number) + offset })))
          .components.map((c) => c.estimate);
        // Four levels (cell, conversation, wording, repeat), every estimate a finite number: an empty or a short list
        // compares nothing, and a shift check that compares nothing must not pass.
        if (a.length !== 4 || b.length !== 4 || ![...a, ...b].every((x) => Number.isFinite(x)))
          return fail(
            `varianceComponents returned ${a.length} estimates before the shift and ${b.length} after (${show(a)}, ${show(b)}); with three named levels and the repeat it returns four finite numbers each time.`,
          );
        const bad = a.findIndex((x, i) => !near(b[i] as number, x, tol * Math.max(1, Math.abs(x))));
        return bad < 0
          ? ok()
          : fail(
              `varianceComponents estimates ${show(a)} became ${show(b)} when ${offset} was added to every value; the sums of squares lose their digits (S^2 / n - ...). Center the values on their mean first.`,
            );
      }),
      stabItem(`cusum-shift-${offset}`, 'packages/stats/src/drift.ts', ({ s, rng }) => {
        const v = data(rng, 60);
        const a = s.cusum(v).upper;
        const b = s.cusum(v.map((x) => x + offset)).upper;
        const bad = a.findIndex((x, i) => !near(b[i] as number, x, tol * Math.max(1, Math.abs(x))));
        return bad < 0
          ? ok()
          : fail(
              `cusum upper sums changed at index ${bad} (${a[bad]} to ${b[bad]}) when ${offset} was added; the standardized series is the same.`,
            );
      }),
      stabItem(`bootstrap-shift-${offset}`, 'packages/stats/src/intervals.ts', ({ s, rng }) => {
        const v = data(rng, 80);
        const a = s.bootstrapCI(v, { seed: 5, iterations: 300 });
        const b = s.bootstrapCI(
          v.map((x) => x + offset),
          { seed: 5, iterations: 300 },
        );
        return near(b.lower - offset, a.lower, tol) && near(b.upper - offset, a.upper, tol)
          ? ok()
          : fail(
              `bootstrapCI bounds [${a.lower}, ${a.upper}] became [${b.lower - offset}, ${b.upper - offset}] after adding and removing ${offset}; summing large values loses the digits of the small ones.`,
            );
      }),
      stabItem(`mean-shift-${offset}`, B, ({ s, rng }) => {
        const v = data(rng, 1000);
        const a = s.mean(v);
        const b = s.mean(v.map((x) => x + offset)) - offset;
        return near(b, a, 1e-9 * offset)
          ? ok()
          : fail(`mean(values + ${offset}) - ${offset} is ${b}, mean(values) is ${a}.`);
      }),
    );
  }
  out.push(
    stabItem('mean-no-overflow', B, ({ s }) => {
      const v = [1e308, 1e308, 1e308];
      const m = attempt(() => s.mean(v));
      return m.value === 1e308
        ? ok()
        : fail(
            `mean([1e308, 1e308, 1e308]) gave ${show(m.value ?? m.error?.message)}; the mean of equal finite values is that value. The running sum overflows: divide before adding, or scale.`,
          );
    }),
    stabItem('variance-offset-many', B, ({ s, rng }) => {
      const v = Array.from({ length: 100_000 }, () => rng());
      const a = s.sampleVariance(v);
      const b = s.sampleVariance(v.map((x) => x + 1e8));
      return rel(b, a, 1e-6)
        ? ok()
        : fail(
            `sampleVariance of 1e5 uniform values gave ${a}, and ${b} after adding 1e8 to each; the variance must not change. Use two passes (or Welford), never sum(x^2) - n mean^2.`,
          );
    }),
    stabItem('log-gamma-large', sp, ({ s }) => {
      const got = s.logGamma(1e6);
      return rel(got, 12815504.569147613, 1e-12)
        ? ok()
        : fail(`logGamma(1e6) gave ${got}; scipy gammaln gives 12815504.569147613.`);
    }),
    stabItem('log-gamma-huge', sp, ({ s }) => {
      const got = s.logGamma(1e15);
      return rel(got, 3.3538776394910668e16, 1e-12)
        ? ok()
        : fail(`logGamma(1e15) gave ${got}; scipy gammaln gives 3.3538776394910668e16.`);
    }),
    stabItem('normal-quantile-far-tail', sp, ({ s }) => {
      const got = s.normalQuantile(1e-300);
      return rel(got, -37.0470962993612, 1e-9)
        ? ok()
        : fail(`normalQuantile(1e-300) gave ${got}; scipy norm.ppf gives -37.0470962993612.`);
    }),
    stabItem('normal-cdf-far-tail', sp, ({ s }) => {
      const got = s.normalCdf(-30);
      return rel(got, 4.906713927147908e-198, 1e-9)
        ? ok()
        : fail(`normalCdf(-30) gave ${got}; scipy norm.cdf gives 4.906713927147908e-198.`);
    }),
    stabItem('normal-sf-tail', sp, ({ s }) => {
      const got = s.normalSf(10);
      return rel(got, 7.619853024160474e-24, 1e-9)
        ? ok()
        : fail(`normalSf(10) gave ${got}; scipy norm.sf gives 7.619853024160474e-24.`);
    }),
    stabItem('chi-square-large-df', sp, ({ s }) => {
      const got = s.chiSquareSf(1000, 900);
      return rel(got, 0.010994608942135843, 1e-8)
        ? ok()
        : fail(`chiSquareSf(1000, 900) gave ${got}; scipy chi2.sf gives 0.010994608942135843.`);
    }),
    stabItem('binomial-cdf-large-n', sp, ({ s }) => {
      const got = s.binomialCdf(500000, 1000000, 0.5);
      return rel(got, 0.5003989421806653, 1e-9)
        ? ok()
        : fail(`binomialCdf(500000, 1000000, 0.5) gave ${got}; scipy binom.cdf gives 0.5003989421806653.`);
    }),
    stabItem('binomial-cdf-rare', sp, ({ s }) => {
      const got = s.binomialCdf(5, 1000000, 1e-5);
      return rel(got, 0.06708501704958428, 1e-9)
        ? ok()
        : fail(`binomialCdf(5, 1e6, 1e-5) gave ${got}; scipy binom.cdf gives 0.06708501704958428.`);
    }),
    stabItem('incomplete-beta-symmetric', sp, ({ s }) => {
      const got = s.incompleteBeta(0.5, 1000, 1000);
      return rel(got, 0.4999999999999984, 1e-9)
        ? ok()
        : fail(
            `incompleteBeta(0.5, 1000, 1000) gave ${got}; by symmetry it is 0.5 (scipy betainc 0.4999999999999984).`,
          );
    }),
    stabItem('incomplete-beta-tiny-x', sp, ({ s }) => {
      const got = s.incompleteBeta(1e-10, 2, 3);
      return rel(got, 5.9999999992e-20, 1e-8)
        ? ok()
        : fail(`incompleteBeta(1e-10, 2, 3) gave ${got}; scipy betainc gives 5.9999999992e-20.`);
    }),
    stabItem('beta-quantile-u-shaped', sp, ({ s }) => {
      const got = s.betaQuantile(1e-6, 0.5, 0.5);
      return rel(got, 2.46740110027031e-12, 1e-6)
        ? ok()
        : fail(`betaQuantile(1e-6, 0.5, 0.5) gave ${got}; scipy beta.ppf gives 2.46740110027031e-12.`);
    }),
    stabItem('kolmogorov-far-tail', 'packages/stats/src/drift.ts', ({ s }) => {
      const got = s.kolmogorovSf(5);
      return rel(got, 3.8574996959278356e-22, 1e-6)
        ? ok()
        : fail(`kolmogorovSf(5) gave ${got}; scipy kstwobign.sf gives 3.8574996959278356e-22.`);
    }),
    stabItem('hill-near-one', 'packages/stats/src/coverage.ts', ({ s }) => {
      const c = [40, 12, 7, 3, 3, 2, 2, 1, 1, 1];
      const q1 = s.hillNumber(c, 1);
      const near1 = s.hillNumber(c, 1 + 1e-12);
      return rel(near1, q1, 1e-6)
        ? ok()
        : fail(
            `hillNumber(counts, 1 + 1e-12) gave ${near1} and hillNumber(counts, 1) gave ${q1}; the Hill number is continuous in q. Use the limit (or log-sum-exp) when |q - 1| is tiny.`,
          );
    }),
    stabItem('pass-k-large', 'packages/stats/src/reliability.ts', ({ s }) => {
      const got = s.passK(999_999, 1_000_000, 500_000);
      return rel(got, 0.5, 1e-9)
        ? ok()
        : fail(`passK(999999, 1000000, 500000) gave ${got}; C(n - 1, k) / C(n, k) = (n - k) / n = 0.5.`);
    }),
  );
  return out;
}

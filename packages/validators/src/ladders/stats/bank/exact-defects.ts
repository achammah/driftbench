import { call, exactItem, type Row, type Spec, SRC, type Tol } from './exact';
import type { BankItem } from './item';

/**
 * Items for the accuracy defects the differential sweep found (validators/stats/NEEDS.md, batch 10). Each group
 * of cases comes from `exact-defects.json`, made by `make_exact_defects.py` from scipy, 80-digit decimals or exact
 * rational arithmetic, at the arguments where the package, at the commit of the sweep, was off by more than 1e-9
 * relative, returned NaN or Infinity, or did not return in time. Items that one change of the package fixes share a
 * cause, so the count of distinct causes is the count of fixes.
 */

const FILE = 'packages/validators/fixtures/stats/exact-defects.json';
const T9: Tol = { rel: 1e-9, abs: 1e-300 };
const T12: Tol = { rel: 1e-12, abs: 1e-300 };
const T6: Tol = { rel: 1e-6, abs: 1e-300 };

const CAUSE = {
  hill: 'hillNumber loses its digits at large q (1 + sum p (p^(q-1) - 1) cancels when the sum of p^q is far below 1)',
  alpha:
    'a quantile taken at 1 - alpha / 2 is Infinity or loses digits for alpha below 1e-15: use -normalQuantile(alpha / 2)',
  normalQuantile: 'normalQuantile overflows exp(x * x / 2) in its refinement for p below 1e-308',
  betaQuantile: 'betaQuantile stops its bisection after 200 halvings, so a quantile below 1e-60 is wrong',
  logPrefactor:
    'the log-gamma prefactor of incompleteBeta, chiSquareSf and binomialCdf loses digits at shapes of 1e4 and more',
  binomialLoop:
    'binomialCdf sums k + 1 terms: it takes time proportional to k and is not accurate for n of 1e6 and more',
  ks: 'ksTest exact computes the p-value as 1 - (probability inside the band), which loses all relative digits in the tail',
} as const;

function d(
  fn: string,
  aspect: string,
  component: string,
  cause: string,
  tol: Tol,
  run: (s: Parameters<Spec['call']>[0], c: Row) => unknown,
  extra: Partial<Pick<Spec, 'fields' | 'budgetMs'>> = {},
  group = `${fn}.${aspect}`,
): Spec {
  return {
    fn,
    group,
    file: FILE,
    aspect,
    family: 'exact-estimators',
    tier: 4,
    component,
    cause,
    tol,
    call: run,
    ...extra,
  };
}

export function defectItems(): BankItem[] {
  const specs: Spec[] = [
    d('hillNumber', 'large-q', `${SRC}/coverage.ts`, CAUSE.hill, T9, (s, c) =>
      call(s, 'hillNumber', c.counts, c.q),
    ),
    d('zFor', 'tiny-alpha', `${SRC}/intervals.ts`, CAUSE.alpha, T12, (s, c) => call(s, 'zFor', c.alpha)),
    d('wilsonEffective', 'tiny-alpha', `${SRC}/effective.ts`, CAUSE.alpha, T9, (s, c) =>
      call(s, 'wilsonEffective', c.clusters, { alpha: c.alpha, quantile: c.quantile }),
    ),
    d('pairedRateDifference', 'tiny-alpha', `${SRC}/paired.ts`, CAUSE.alpha, T9, (s, c) =>
      call(s, 'pairedRateDifference', c.table, c.alpha),
    ),
    d('clopperPearson', 'tiny-alpha', `${SRC}/intervals.ts`, CAUSE.betaQuantile, T9, (s, c) =>
      call(s, 'clopperPearson', c.k, c.n, c.alpha),
    ),
    d('mde', 'tiny-alpha', `${SRC}/power.ts`, CAUSE.alpha, T6, (s, c) => ({
      effect: (
        call(s, 'mde', { n: c.n, baselineRate: c.baselineRate, alpha: c.alpha }) as { effect: number | null }
      ).effect,
    })),
    d('normalQuantile', 'subnormal-p', `${SRC}/special.ts`, CAUSE.normalQuantile, T9, (s, c) =>
      call(s, 'normalQuantile', c.p),
    ),
    d(
      'betaQuantile',
      'far-tail',
      `${SRC}/special.ts`,
      CAUSE.betaQuantile,
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'betaQuantile', c.p, c.a, c.b),
    ),
    d(
      'incompleteBeta',
      'large-shape',
      `${SRC}/special.ts`,
      CAUSE.logPrefactor,
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'incompleteBeta', c.x, c.a, c.b),
    ),
    d(
      'chiSquareSf',
      'large-df',
      `${SRC}/special.ts`,
      CAUSE.logPrefactor,
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'chiSquareSf', c.x, c.df),
    ),
    d(
      'binomialCdf',
      'large-n',
      `${SRC}/special.ts`,
      CAUSE.logPrefactor,
      { rel: 1e-9, abs: 1e-300 },
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
      { budgetMs: 60_000 },
    ),
    d(
      'binomialCdf',
      'huge-n-time',
      `${SRC}/special.ts`,
      CAUSE.binomialLoop,
      { rel: 1e-6, abs: 1e-300 },
      (s, c) => call(s, 'binomialCdf', c.k, c.n, c.p),
      { budgetMs: 8_000 },
      'binomialCdf.huge-n-time',
    ),
    d('ksTest', 'separated-samples', `${SRC}/drift.ts`, CAUSE.ks, { rel: 1e-9, abs: 1e-300 }, (s, c) => {
      const r = call(s, 'ksTest', c.a, c.b, { method: 'exact' }) as { statistic: number; pValue: number };
      return { statistic: r.statistic, pValue: r.pValue };
    }),
    d('ksTest', 'tail-lattice', `${SRC}/drift.ts`, CAUSE.ks, { rel: 1e-9, abs: 1e-300 }, (s, c) => {
      const r = call(s, 'ksTest', c.a, c.b, { method: 'exact' }) as { statistic: number; pValue: number };
      return { statistic: r.statistic, pValue: r.pValue };
    }),
  ];
  return specs.map((spec) => ({ ...exactItem(spec), id: `defect.${spec.fn}.${spec.aspect}` }));
}

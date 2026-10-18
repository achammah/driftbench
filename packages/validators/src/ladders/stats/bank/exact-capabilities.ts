import { call, exactItem, type Row, type Spec, SRC, type Tol } from './exact';
import type { BankItem } from './item';
import { attempt, fail, ok, show } from './item';

/**
 * Items for four statistics that docs/concepts/statistics.md defines under "Planned" and the package does not
 * have yet (validators/stats/NEEDS.md, batch 11). Each group of cases comes from `exact-capabilities.json`, made
 * by `make_exact_capabilities.py` from the page's definitions in exact rational arithmetic or scipy. Until a
 * function exists its items fail with its signature and the page that defines it; the functions of one name share
 * one cause.
 */

const FILE = 'packages/validators/fixtures/stats/exact-capabilities.json';
const DOC = 'docs/concepts/statistics.md, "Planned: four statistics the pages already lean on"';
const EXACT: Tol = { rel: 1e-12, abs: 1e-300 };

const SIGNATURE = {
  holm: 'Add `holm(pvalues: readonly number[], alpha = 0.05): { adjusted: number[]; rejected: boolean[]; alpha: number }` to packages/stats/src/multiple.ts and export it.',
  sampleSizeForEffect:
    'Add `sampleSizeForEffect(input: { effect: number; baselineRate: number; power?: number; alpha?: number; repeats?: number; rho?: number }): { n: number; effectiveN: number; designEffect: number }` to packages/stats/src/power.ts and export it.',
  kappaInterval:
    'Add `kappaInterval(a: readonly Label[], b: readonly Label[], options?: { alpha?: number }): { kappa: number; se: number; lower: number; upper: number }` to packages/stats/src/agreement.ts and export it.',
  mcnemarMidP:
    'Add `mcnemarMidP(b: number, c: number): { pValue: number; b: number; c: number }` to packages/stats/src/paired.ts and export it.',
} as const;
const DEFINED = ` Definition: ${DOC}.`;

function cap(
  fn: keyof typeof SIGNATURE,
  aspect: string,
  component: string,
  cause: string,
  tol: Spec['tol'],
  run: (s: Parameters<Spec['call']>[0], c: Row) => unknown,
  extra: Partial<Pick<Spec, 'fields'>> = {},
): Spec {
  return {
    fn,
    group: `${fn}.${aspect}`,
    file: FILE,
    aspect,
    family: 'exact-estimators',
    tier: 4,
    component,
    cause,
    tol,
    call: run,
    missing: SIGNATURE[fn] + DEFINED,
    ...extra,
  };
}

const HOLM = `${SRC}/multiple.ts`;
const POWER = `${SRC}/power.ts`;
const AGREE = `${SRC}/agreement.ts`;
const PAIRED = `${SRC}/paired.ts`;

/** Every sample-size item requires a positive integer before inspecting any floating fields or calling mde. */
function checkedSampleSize(s: Parameters<Spec['call']>[0], input: Row): { n: number } {
  const result = call(s, 'sampleSizeForEffect', input) as { n: number };
  if (!Number.isInteger(result.n) || result.n < 1)
    throw new Error('sampleSizeForEffect must return a positive integer n');
  return result;
}

export function capabilityItems(): BankItem[] {
  const holm = (s: Parameters<Spec['call']>[0], c: Row) => call(s, 'holm', c.pvalues, c.alpha);
  const specs: Spec[] = [
    ...['textbook', 'order', 'ties', 'monotone', 'cap-at-one', 'alpha', 'single-and-empty'].map((aspect) =>
      cap('holm', aspect, HOLM, 'holm is missing from @agent-nexus/driftbench-stats', EXACT, holm),
    ),
    cap(
      'holm',
      'stricter-than-bh',
      HOLM,
      'holm is missing from @agent-nexus/driftbench-stats',
      EXACT,
      (s, c) => {
        const h = holm(s, c) as { adjusted: number[]; rejected: boolean[]; alpha: number };
        return { adjusted: h.adjusted, rejected: h.rejected, alpha: h.alpha };
      },
      { fields: ['adjusted', 'rejected', 'alpha'] },
    ),
    ...['defaults', 'power', 'alpha', 'repeats', 'rho', 'whole-number', 'small-effect'].map((aspect) =>
      cap(
        'sampleSizeForEffect',
        aspect,
        POWER,
        'sampleSizeForEffect is missing from @agent-nexus/driftbench-stats',
        (path) => (path === 'n' ? { rel: 0, abs: 0 } : { rel: 1e-9, abs: 1e-12 }),
        (s, c) =>
          checkedSampleSize(s, {
            effect: c.effect,
            baselineRate: c.baselineRate,
            power: c.power,
            alpha: c.alpha,
            repeats: c.repeats,
            rho: c.rho,
          }),
      ),
    ),
    ...[
      'binary',
      'multi-class',
      'alpha',
      'perfect',
      'chance-level',
      'constant-raters',
      'clipped',
      'disagreement',
      'labels',
    ].map((aspect) =>
      cap(
        'kappaInterval',
        aspect,
        AGREE,
        'kappaInterval is missing from @agent-nexus/driftbench-stats',
        { rel: 1e-9, abs: 1e-12 },
        (s, c) => call(s, 'kappaInterval', c.a, c.b, { alpha: c.alpha }),
      ),
    ),
    ...['small', 'symmetric', 'no-discordant', 'tied-sides', 'larger', 'large-count'].map((aspect) =>
      cap(
        'mcnemarMidP',
        aspect,
        PAIRED,
        'mcnemarMidP is missing from @agent-nexus/driftbench-stats',
        EXACT,
        (s, c) => call(s, 'mcnemarMidP', c.b, c.c),
      ),
    ),
    cap(
      'mcnemarMidP',
      'less-conservative',
      PAIRED,
      'mcnemarMidP is missing from @agent-nexus/driftbench-stats',
      EXACT,
      (s, c) => {
        const r = call(s, 'mcnemarMidP', c.b, c.c) as { pValue: number; b: number; c: number };
        const exact = (call(s, 'mcnemar', c.b, c.c, { exact: true }) as { pValue: number }).pValue;
        return { pValue: r.pValue, b: r.b, c: r.c, exactP: exact };
      },
      { fields: ['pValue', 'b', 'c', 'exactP'] },
    ),
  ];
  const items = specs.map(exactItem);
  items.push(inverseOfMde());
  return items;
}

/** `sampleSizeForEffect` is the inverse of `mde`: at the n it returns the effect is reached, one spec fewer misses it. */
function inverseOfMde(): BankItem {
  return {
    id: 'exact.sampleSizeForEffect.inverse-of-mde',
    family: 'exact-estimators',
    tier: 4,
    level: 'analytic',
    component: POWER,
    cause: 'sampleSizeForEffect is missing from @agent-nexus/driftbench-stats',
    check: ({ s }) => {
      const cases = [
        { effect: 0.1, baselineRate: 0.8, repeats: 1, rho: 0 },
        { effect: 0.15, baselineRate: 0.7, repeats: 4, rho: 0.4 },
        { effect: 0.08, baselineRate: 0.9, repeats: 6, rho: 0.2 },
        { effect: 0.05, baselineRate: 0.5, repeats: 2, rho: 0.1 },
      ];
      const misses: string[] = [];
      for (const c of cases) {
        const got = attempt(() => checkedSampleSize(s, c));
        if (got.error) {
          return fail(
            got.error.message.includes('is not exported')
              ? `sampleSizeForEffect does not exist in @agent-nexus/driftbench-stats. ${SIGNATURE.sampleSizeForEffect}${DEFINED}`
              : `sampleSizeForEffect(${show(c)}) threw ${got.error.message}`,
          );
        }
        const n = (got.value as { n: number }).n;
        const at = (
          call(s, 'mde', { n, repeats: c.repeats, baselineRate: c.baselineRate, rho: c.rho }) as {
            effect: number | null;
          }
        ).effect;
        const below =
          n > 1
            ? (
                call(s, 'mde', {
                  n: n - 1,
                  repeats: c.repeats,
                  baselineRate: c.baselineRate,
                  rho: c.rho,
                }) as { effect: number | null }
              ).effect
            : Number.POSITIVE_INFINITY;
        if (!(at !== null && at <= c.effect + 1e-12))
          misses.push(`${show(c)}: mde at n = ${n} is ${show(at)}, above the effect ${c.effect}`);
        else if (!(below === null || below > c.effect - 1e-12))
          misses.push(`${show(c)}: n = ${n} is not the smallest, mde at ${n - 1} is ${show(below)}`);
      }
      return misses.length === 0
        ? ok()
        : fail(`sampleSizeForEffect is not the inverse of mde: ${misses.join(' | ')}`);
    },
  };
}

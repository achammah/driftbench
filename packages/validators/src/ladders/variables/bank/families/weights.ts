import type { ConversationInput, StoreDoc, StoreValue, StoreVariable } from '../../interface';
import { OWNER_DATE } from '../constants';
import { build, callInterval, type StemRun } from '../item';
import { refusalsMentioning, sessionRows, valueById, variableOf } from '../oracle/estate';
import {
  bandInsideProbability,
  coverageThreshold,
  drawCategorical,
  skewShares,
  targetMix,
  wilson,
  wilsonCoverage,
  wilsonWidth,
  Z95,
} from '../oracle/stats';
import { must, type Rng, show, subRng } from '../util';
import { type Base, baseStore, draw, evenMix } from './sources';

/** The store variable of a base after a build, and its values by the base's order. */
function after(store: StoreDoc, base: Base, index = 0): { variable: StoreVariable; values: StoreValue[] } {
  const bv = base.vars[index] as Base['vars'][number];
  const variable = variableOf(store, bv.variable.id);
  must(!!variable, () => `variable ${bv.variable.id} is gone from the store built with the sessions`);
  const values = bv.ids.map((id) => valueById(variable as StoreVariable, id));
  for (const [k, v] of values.entries()) {
    must(!!v, () => `value ${bv.ids[k]} of ${bv.variable.id} is gone from the store built with the sessions`);
  }
  return { variable: variable as StoreVariable, values: values as StoreValue[] };
}

function weightOf(value: StoreValue, label: string): number {
  must(
    typeof value.weight === 'number',
    () => `${label} carries the weight ${show(value.weight)}, expected a number`,
  );
  return value.weight as number;
}

/** Sessions with exactly the given counts of each value, in a fixed order. */
function sessionsFromCounts(base: Base, counts: readonly number[], prefix = 'sess'): ConversationInput[] {
  const rows: Array<Record<string, string>> = [];
  const bv = base.vars[0] as Base['vars'][number];
  counts.forEach((c, k) => {
    for (let i = 0; i < c; i += 1) rows.push({ [bv.variable.id]: bv.ids[k] as string });
  });
  return sessionRows(rows, prefix);
}

/** Sessions drawn from a mix over the first variable of the base. */
function drawn(
  rng: Rng,
  base: Base,
  n: number,
  mix: readonly number[],
): { sessions: ConversationInput[]; counts: number[] } {
  const bv = base.vars[0] as Base['vars'][number];
  const picks = drawCategorical(rng, n, mix);
  const counts = new Array<number>(mix.length).fill(0);
  const rows = picks.map((k) => {
    counts[k] = (counts[k] as number) + 1;
    return { [bv.variable.id]: bv.ids[k] as string };
  });
  return { sessions: sessionRows(rows), counts };
}

/** The share of a value among the values of its variable: weights are relative (docs/variables.md "Values"). */
function shareOf(variable: StoreVariable, value: StoreValue, label: string): number {
  let total = 0;
  for (const v of variable.values) total += weightOf(v, `value ${v.id} of ${variable.id}`);
  must(total > 0, () => `the weights of ${variable.id} are all 0`);
  return weightOf(value, label) / total;
}

/** The conversations entry of a value, or fails naming the value. */
function countsOf(value: StoreValue, label: string): { count: number; total: number } {
  const p = (value.provenance ?? []).find((x) => x.kind === 'conversations');
  must(
    !!p && p.kind === 'conversations',
    () => `${label} has no conversations provenance: ${show(value.provenance)}`,
  );
  const c = p as Extract<NonNullable<StoreValue['provenance']>[number], { kind: 'conversations' }>;
  return { count: c.count, total: c.total };
}

const COVERAGE: Record<string, { p: number; n: number; reps: number }> = {
  'half-n100': { p: 0.5, n: 100, reps: 500 },
  'half-n20': { p: 0.5, n: 20, reps: 500 },
  'tenth-n50': { p: 0.1, n: 50, reps: 500 },
  'two-percent-n100': { p: 0.02, n: 100, reps: 600 },
  'two-percent-n1000': { p: 0.02, n: 1000, reps: 400 },
  'half-percent-n500': { p: 0.005, n: 500, reps: 500 },
  'ninety-five-n40': { p: 0.95, n: 40, reps: 500 },
  'near-one-n300': { p: 0.998, n: 300, reps: 500 },
};

export const WEIGHTS_RUNS: Record<string, StemRun> = {
  'weights.relative-frequency': (variant, ctx) => {
    const { rng } = ctx;
    const shapes =
      variant === 'ten-variables'
        ? Array.from({ length: 10 }, () => 3)
        : variant === 'five-values-skewed'
          ? [5]
          : variant === 'thousand-sessions'
            ? [4]
            : [3];
    const base = baseStore(ctx, shapes);
    const mixes = base.vars.map((v) => skewShares(rng, v.ids.length));
    const n =
      variant === 'thousand-sessions'
        ? 1000
        : variant === 'ten-variables'
          ? 60
          : variant === 'five-values-skewed'
            ? 100
            : rng.int(30, 80);
    const { sessions, counts, observed } = draw(rng, base, n, mixes);
    const store = build(ctx, { estate: base.estate, conversations: sessions });
    base.vars.forEach((bv, i) => {
      const { variable, values } = after(store, base, i);
      values.forEach((value, k) => {
        const seen = (counts[i] as number[])[k] as number;
        const of = observed[i] as number;
        const share = shareOf(variable, value, `value ${bv.ids[k]} of ${bv.variable.id}`);
        const tol = 1 / (of + 2) + 1e-9;
        must(
          Math.abs(share - seen / of) <= tol,
          () =>
            `value ${bv.ids[k]} of ${bv.variable.id}: its share of the variable's weight is ${share}, expected about ${seen / of} (seen ${seen} of ${of})`,
        );
      });
    });
  },

  'weights.complete-and-relative': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [4]);
    const bv = base.vars[0] as Base['vars'][number];
    const mix = variant === 'unseen-value' ? [0.5, 0.3, 0.2, 0] : evenMix(4);
    const { sessions } = drawn(rng, base, 40, mix);
    const rows = sessions.map((s) => ({ ...s, values: { ...s.values } }));
    if (variant === 'all-seen') {
      bv.ids.forEach((id, k) => {
        (rows[k] as ConversationInput).values = { [bv.variable.id]: id };
      });
    }
    if (variant === 'new-value') {
      for (let i = 0; i < 6; i += 1)
        (rows[i] as ConversationInput).values = { [bv.variable.id]: 'novelvalue' };
    }
    const store = build(ctx, { estate: base.estate, conversations: rows });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    must(
      variable.values.every((v) => typeof v.weight === 'number'),
      () =>
        `a variable weighs some of its values and not all: ${show(variable.values.map((v) => [v.id, v.weight]))}`,
    );
    let total = 0;
    let shares = 0;
    for (const value of variable.values) {
      total += weightOf(value, `value ${value.id} of ${variable.id}`);
      shares += shareOf(variable, value, `value ${value.id} of ${variable.id}`);
    }
    must(total > 0, () => `every weight of ${variable.id} is 0`);
    must(Math.abs(shares - 1) <= 1e-9, () => `the shares of ${variable.id} add up to ${shares}, expected 1`);
    for (const value of variable.values) {
      const { count, total: of } = countsOf(value, `value ${value.id} of ${variable.id}`);
      const share = shareOf(variable, value, value.id);
      must(
        Math.abs(share - count / of) <= 1 / (of + 2) + 1e-9,
        () =>
          `value ${value.id} of ${variable.id}: share ${share} does not agree with its conversations count ${count} of ${of}`,
      );
    }
  },

  'weights.interval-holds-estimate': (variant, ctx) => {
    // An uninformative [0, 1] contains every estimate. Require a useful interval too,
    // including for the one-session variants where broad uncertainty is legitimate.
    for (const count of [25, 75]) {
      const [lo, hi] = callInterval(ctx, count, 100);
      must(
        lo <= count / 100 && hi >= count / 100 && hi - lo <= 1.5 * wilsonWidth(count, 100),
        () => `weightInterval(${count}, 100) must contain its estimate with a useful width`,
      );
    }
    const cases: Array<[number, number]> =
      variant === 'one-session'
        ? [
            [0, 1],
            [1, 1],
          ]
        : variant === 'all-same'
          ? [
              [20, 20],
              [0, 20],
              [1000, 1000],
            ]
          : [
              [7, 50],
              [25, 50],
              [1, 50],
              [49, 50],
              [333, 1000],
            ];
    for (const [count, total] of cases) {
      const [lo, hi] = callInterval(ctx, count, total);
      const p = count / total;
      must(
        Number.isFinite(lo) &&
          Number.isFinite(hi) &&
          lo >= 0 &&
          hi <= 1 &&
          lo <= p + 1e-12 &&
          p <= hi + 1e-12,
        () => `weightInterval(${count}, ${total}) = [${lo}, ${hi}] does not hold ${p} inside 0 to 1`,
      );
    }
  },

  'weights.interval-coverage': (variant, ctx) => {
    const design = COVERAGE[variant] as { p: number; n: number; reps: number };
    const { p, n, reps } = design;
    const rng = subRng(ctx.rng, 'coverage');
    const mix = targetMix(p, 1);
    let inside = 0;
    for (let r = 0; r < reps; r += 1) {
      const picks = drawCategorical(rng, n, mix);
      const count = picks.filter((k) => k === 0).length;
      const [lo, hi] = callInterval(ctx, count, n);
      must(
        Number.isFinite(lo) &&
          Number.isFinite(hi) &&
          lo >= 0 &&
          hi <= 1 &&
          lo <= count / n + 1e-12 &&
          hi >= count / n - 1e-12 &&
          hi - lo <= 1.5 * wilsonWidth(count, n),
        () => `weightInterval(${count}, ${n}) must contain its estimate with a useful width`,
      );
      if (lo <= p && p <= hi) inside += 1;
    }
    const need = coverageThreshold(reps, p, n);
    must(
      inside >= need,
      () =>
        `the 95 percent interval held the true share ${p} in ${inside} of ${reps} replicates of ${n} sessions; a correct interval holds it in at least ${need} (the Wilson interval holds it with chance ${wilsonCoverage(p, n).toFixed(3)})`,
    );
  },

  'weights.interval-width': (variant, ctx) => {
    const run = (n: number, p: number) => {
      const c = Math.round(p * n);
      const [lo, hi] = callInterval(ctx, c, n);
      return { width: hi - lo, wilson: wilsonWidth(c, n) };
    };
    if (variant === 'tenfold-sessions-shrinks') {
      const a = run(60, 0.3);
      const b = run(600, 0.3);
      const ratio = a.width / b.width;
      must(
        ratio >= 2.2 && ratio <= 4.5,
        () =>
          `ten times the sessions should narrow the interval by a factor between 2.2 and 4.5; got ${a.width} at 60 and ${b.width} at 600 (factor ${ratio.toFixed(2)})`,
      );
      return;
    }
    const [n, p] = variant === 'n100' ? [100, 0.5] : variant === 'n1000' ? [1000, 0.1] : [30, 0.2];
    const { width, wilson: ref } = run(n, p);
    must(
      width >= 0.6 * ref && width <= 1.5 * ref,
      () =>
        `the interval at ${Math.round(p * n)} of ${n} is ${width.toFixed(4)} wide; expected between ${(0.6 * ref).toFixed(4)} and ${(1.5 * ref).toFixed(4)} (the Wilson width is ${ref.toFixed(4)})`,
    );
  },

  'weights.interval-level': (variant, ctx) => {
    const [n, c] = variant === 'n400-half' ? [400, 200] : [2000, 200];
    const [lo, hi] = callInterval(ctx, c, n);
    const [wl, wh] = wilson(c, n, Z95);
    const half = (hi - lo) / 2;
    const ref = (wh - wl) / 2;
    must(
      Math.abs(half - ref) <= 0.15 * ref,
      () =>
        `the half-width at ${c} of ${n} is ${half.toFixed(5)}; a 95 percent interval has ${ref.toFixed(5)} (within 15 percent)`,
    );
  },

  'weights.zero-count': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [variant === 'among-seen' ? 4 : 3]);
    const bv = base.vars[0] as Base['vars'][number];
    const n = variant === 'n1000' ? 1000 : variant === 'n20' ? 20 : 60;
    const m = bv.ids.length;
    const mix = Array.from({ length: m }, (_, k) => (k === m - 1 ? 0 : 1 / (m - 1)));
    const { sessions } = drawn(rng, base, n, mix);
    const store = build(ctx, { estate: base.estate, conversations: sessions });
    const { variable, values } = after(store, base);
    const unseen = values[m - 1] as StoreValue;
    const label = `the unseen value ${unseen.id}`;
    const share = shareOf(variable, unseen, label);
    must(
      share >= 0 && share <= 1 / (n + 2) + 1e-9,
      () => `${label} was seen in 0 of ${n} sessions but has the share ${share}`,
    );
    const { count, total } = countsOf(unseen, label);
    must(
      count === 0 && total === n,
      () => `${label} should carry the counts 0 of ${n}, it carries ${count} of ${total}`,
    );
    const [lo, hi] = callInterval(ctx, count, total);
    must(
      lo >= 0 && lo <= 1e-9 && hi > 0 && hi <= 1,
      () =>
        `weightInterval(0, ${n}) = [${lo}, ${hi}], expected a lower bound of 0 and an upper bound above 0`,
    );
  },

  'weights.all-sessions-one-value': (variant, ctx) => {
    const base = baseStore(ctx, [3]);
    const n = variant === 'n1000' ? 1000 : 10;
    const store = build(ctx, { estate: base.estate, conversations: sessionsFromCounts(base, [n, 0, 0]) });
    const { variable, values } = after(store, base);
    const v = values[0] as StoreValue;
    const label = `the value seen in all ${n} sessions`;
    const share = shareOf(variable, v, label);
    must(
      share >= 1 - 1 / (n + 2) - 1e-9 && share <= 1 + 1e-9,
      () => `${label} has the share ${share}, expected about 1`,
    );
    const { count, total } = countsOf(v, label);
    const [lo, hi] = callInterval(ctx, count, total);
    must(
      hi >= 1 - 1e-12 && lo < 1 && lo >= 0,
      () =>
        `weightInterval(${count}, ${total}) = [${lo}, ${hi}], expected an upper bound of 1 and a lower bound below 1`,
    );
  },

  'weights.no-observation': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, variant === 'unobserved-variable' ? [3, 3] : [3]);
    let store: StoreDoc;
    const bv = base.vars[0] as Base['vars'][number];
    const ownerWeights = [0.4, 0.35, 0.25];
    if (variant === 'no-sessions') {
      store = build(ctx, { estate: base.estate, conversations: [] });
    } else if (variant === 'unobserved-variable') {
      const first = { ...base, vars: [base.vars[0] as Base['vars'][number]] };
      const { sessions } = draw(rng, first, 30, [evenMix(3)]);
      store = build(ctx, { estate: base.estate, conversations: sessions });
    } else {
      store = build(ctx, {
        estate: base.estate,
        owner: {
          weights: bv.ids.map((id, k) => ({
            variable: bv.variable.id,
            value: id,
            weight: ownerWeights[k] as number,
            date: OWNER_DATE,
            words: 'about forty percent',
          })),
        },
      });
    }
    for (const variable of store.variables) {
      for (const value of variable.values) {
        const label = `value ${value.id} of ${variable.id}`;
        if (value.weight !== undefined) {
          must(
            Number.isFinite(value.weight) && value.weight >= 0,
            () => `${label} has the weight ${show(value.weight)}`,
          );
        }
      }
    }
    if (variant === 'unobserved-variable') {
      const other = base.vars[1] as Base['vars'][number];
      const v = variableOf(store, other.variable.id) as StoreVariable;
      const weights = v.values.map((x) => x.weight);
      const some = weights.filter((w) => w !== undefined);
      must(
        some.length === 0 || (some.length === weights.length && new Set(some).size === 1),
        () =>
          `${v.id} was observed in no session; its weights should be absent or all equal, they are ${show(weights)}`,
      );
    }
    if (variant === 'owner-only') {
      const variable = variableOf(store, bv.variable.id) as StoreVariable;
      bv.ids.forEach((id, k) => {
        const v = valueById(variable, id) as StoreValue;
        must(
          v.weight === ownerWeights[k],
          () => `the owner weight ${ownerWeights[k]} of ${id} was stored as ${show(v.weight)}`,
        );
      });
    }
    const [lo, hi] = callInterval(ctx, 0, 1);
    must(
      Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi <= 1 && hi > lo,
      () => `weightInterval(0, 1) = [${lo}, ${hi}], expected a finite interval with width inside 0 to 1`,
    );
  },

  'weights.recovered-mix': (variant, ctx) => {
    const rng = subRng(ctx.rng, 'recovered');
    const shapes = variant === 'twelve-skewed' ? 12 : variant === 'small-n' ? 3 : 4;
    const base = baseStore(ctx, [shapes]);
    const mix =
      variant === 'four-values'
        ? [0.4, 0.3, 0.2, 0.1]
        : variant === 'small-n'
          ? [0.6, 0.3, 0.1]
          : skewShares(rng, 12);
    const n = variant === 'four-values' ? 100 : variant === 'small-n' ? 15 : 200;
    const reps = 300;
    let inside = 0;
    for (let r = 0; r < reps; r += 1) {
      const { sessions } = drawn(rng, base, n, mix);
      const store = build(ctx, { estate: base.estate, conversations: sessions });
      const { variable, values } = after(store, base);
      values.forEach((value, k) => {
        const p = mix[k] as number;
        const w = shareOf(variable, value, `value ${k} (replicate ${r + 1})`);
        if (Math.abs(w - p) <= Z95 * Math.sqrt((p * (1 - p)) / n) + 1e-12) inside += 1;
      });
    }
    const m = mix.length;
    const total = reps * m;
    const expected = mix.reduce((acc, p) => acc + reps * bandInsideProbability(p, n), 0);
    const sd =
      Math.sqrt(m) *
      Math.sqrt(
        mix.reduce(
          (acc, p) => acc + reps * bandInsideProbability(p, n) * (1 - bandInsideProbability(p, n)),
          0,
        ),
      );
    const need = Math.floor(expected - 0.03 * total - 5.5 * sd);
    must(
      inside >= need,
      () =>
        `the recovered weights fell inside the 95 percent band of the planted mix in ${inside} of ${total} cases; an unbiased recovery has about ${Math.round(expected)} and must have at least ${need}`,
    );
  },

  'weights.owner-kept-exactly': (variant, ctx) => {
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const weights =
      variant === 'quarter'
        ? [0.25, 0.5, 0.25]
        : variant === 'third'
          ? [1 / 3, 1 / 3, 1 / 3]
          : variant === 'tiny'
            ? [1e-9, 0.5, 0.5]
            : [60, 15, 25];
    const store = build(ctx, {
      estate: base.estate,
      owner: {
        weights: bv.ids.map((id, k) => ({
          variable: bv.variable.id,
          value: id,
          weight: weights[k] as number,
          date: OWNER_DATE,
          words: 'the owner says so',
        })),
      },
    });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    bv.ids.forEach((id, k) => {
      const v = valueById(variable, id) as StoreValue;
      must(
        v.weight === weights[k],
        () => `the owner weight ${weights[k]} of ${id} was stored as ${show(v.weight)}`,
      );
    });
  },

  'weights.owner-invalid-refused': (variant, ctx) => {
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const bad: unknown =
      variant === 'negative'
        ? -0.1
        : variant === 'null'
          ? null
          : variant === 'nan'
            ? Number.NaN
            : variant === 'infinity'
              ? Number.POSITIVE_INFINITY
              : '0.5';
    const id = bv.ids[1] as string;
    const store = build(ctx, {
      estate: base.estate,
      owner: {
        weights: [
          {
            variable: bv.variable.id,
            value: id,
            weight: bad as number,
            date: OWNER_DATE,
            words: 'a weight that cannot be right',
          },
        ],
      },
    });
    const v = valueById(variableOf(store, bv.variable.id) as StoreVariable, id) as StoreValue;
    must(
      v.weight === undefined,
      () => `the invalid owner weight ${show(bad)} was stored as ${show(v.weight)}`,
    );
    const named = refusalsMentioning(store, id);
    must(
      named.length >= 1 && named.every((r) => typeof r.reason === 'string' && r.reason.trim() !== ''),
      () => `the refusal list ${show(store.refused)} does not name ${id} with a reason`,
    );
  },
};

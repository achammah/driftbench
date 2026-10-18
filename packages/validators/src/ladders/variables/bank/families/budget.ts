import type { Plan, PlanOptions, Row, StoreDoc } from '../../interface';
import { RARE_ROWS_CUT } from '../constants';
import { type ItemContext, planError, planOf, type StemRun } from '../item';
import { groupsOf, indexRow, logWeight, makeSpace, type Space, SpaceOracle, toStore } from '../oracle/space';
import { checkPlan, randomSeeds, randomSpace } from '../oracle/spaces';
import { must, show, stableStringify } from '../util';

/** Spaces with skewed shares whose unbudgeted plan has dozens of rows. */
function skewedSpace(ctx: ItemContext, vars = 9): Space {
  return randomSpace(ctx.rng, { vars, minArity: 2, maxArity: 3, shared: 4, rules: [3, 3], weights: true });
}

const rowKey = (r: Plan['rows'][number]) => stableStringify({ id: r.id, kind: r.kind, values: r.values });

function samePrefix(full: Plan, budgeted: Plan, b: number, label: string): void {
  const want = full.rows.slice(0, Math.min(b, full.rows.length)).map(rowKey);
  const got = budgeted.rows.map(rowKey);
  must(
    got.length === want.length,
    () =>
      `${label}: budget ${b} gives ${got.length} rows, expected ${want.length} (the plan without a budget has ${full.rows.length})`,
  );
  for (let i = 0; i < want.length; i += 1) {
    must(
      got[i] === want[i],
      () =>
        `${label}: with budget ${b}, row ${i} is ${got[i]?.slice(0, 120)}; the plan without a budget has ${want[i]?.slice(0, 120)} there`,
    );
  }
}

/** The log weights of the rows after the seeds, from the shares of the space. */
function freshLogs(space: Space, plan: Plan, seedCount: number): number[] {
  return plan.rows.slice(seedCount).map((r) => logWeight(space, indexRow(space, r.values)));
}

/** Along the plan the log weights must not move against the cut order (most common first when the rarest rows are cut first). */
function ordered(logs: readonly number[], label: string): void {
  for (let i = 1; i < logs.length; i += 1) {
    const prev = logs[i - 1] as number;
    const cur = logs[i] as number;
    const bad = RARE_ROWS_CUT === 'last' ? cur < prev - 1e-9 : cur > prev + 1e-9;
    must(
      !bad,
      () =>
        `${label}: new row ${i} has log weight ${cur.toFixed(4)}, new row ${i - 1} has ${prev.toFixed(4)}; the new rows should run ${RARE_ROWS_CUT === 'last' ? 'rarest first' : 'most common first'}`,
    );
  }
}

const store = (space: Space, provenance?: 'owner' | 'conversations') =>
  toStore(space, provenance ? { weightProvenance: provenance } : {});

export const BUDGET_RUNS: Record<string, StemRun> = {
  'budget.prefix-of-full-plan': (variant, ctx) => {
    const { rng } = ctx;
    const space = skewedSpace(ctx);
    const oracle = new SpaceOracle(space);
    const seeds: Row[] = ['with-seeds', 'seeds-plus-budget-length'].includes(variant)
      ? randomSeeds(space, oracle, rng, 3)
      : [];
    const st = store(space);
    const run = (budget?: number): Plan =>
      planOf(ctx, st, {
        seed: ctx.seed,
        ...(budget !== undefined ? { budget } : {}),
        ...(seeds.length ? { seeds: seeds.map((s) => ({ ...s })) } : {}),
      });
    const full = run();
    const total = full.rows.length;
    must(
      total >= seeds.length + 6,
      () => `the plan without a budget has only ${total} rows; the item needs a larger plan`,
    );
    const label = `${variant} (plan of ${total} rows, ${seeds.length} seeds)`;
    switch (variant) {
      case 'middle':
        samePrefix(full, run(Math.floor(total / 2)), Math.floor(total / 2), label);
        break;
      case 'one-row':
        samePrefix(full, run(1), 1, label);
        break;
      case 'all-but-one':
        samePrefix(full, run(total - 1), total - 1, label);
        break;
      case 'with-seeds': {
        const b = seeds.length + Math.floor((total - seeds.length) / 2);
        samePrefix(full, run(b), b, label);
        break;
      }
      case 'above-total':
        samePrefix(full, run(total + 5), total + 5, label);
        break;
      case 'three-budgets-nested': {
        for (const b of [Math.floor(total / 4), Math.floor(total / 2), Math.floor((3 * total) / 4)])
          samePrefix(full, run(b), b, label);
        break;
      }
      case 'every-budget-nested':
        for (let b = 0; b <= total + 2; b += 1) samePrefix(full, run(b), b, label);
        break;
      case 'every-budget-length':
        for (let b = 0; b <= total + 2; b += 1) {
          const got = run(b).rows.length;
          must(
            got === Math.min(b, total),
            () => `${label}: budget ${b} gives ${got} rows, expected ${Math.min(b, total)}`,
          );
        }
        break;
      case 'seeds-plus-budget-length':
        for (let b = seeds.length; b <= total + 2; b += 1) {
          const plan = run(b);
          must(
            plan.rows.length === Math.min(b, total),
            () => `${label}: budget ${b} gives ${plan.rows.length} rows, expected ${Math.min(b, total)}`,
          );
          must(
            plan.rows.slice(0, seeds.length).every((r) => r.kind === 'seed'),
            () => `${label}: with budget ${b} the seeds do not lead the plan`,
          );
        }
        break;
      default: {
        const empty = planOf(ctx, st, { seed: ctx.seed, budget: 0 });
        must(
          empty.rows.length === 0,
          () => `a budget of 0 with no seeds gives ${empty.rows.length} rows, expected none`,
        );
      }
    }
  },

  'budget.new-rows-common-first': (variant, ctx) => {
    const { rng } = ctx;
    const space =
      variant === 'four-variables'
        ? randomSpace(rng, { vars: 4, minArity: 2, maxArity: 3, rules: [4], weights: true })
        : variant === 'ten-variables'
          ? randomSpace(rng, { vars: 10, minArity: 2, maxArity: 3, shared: 4, rules: [3, 3], weights: true })
          : variant === 'equal-shares-ties'
            ? (() => {
                const s = skewedSpace(ctx);
                for (const v of s.vars) v.weights = v.values.map(() => 1 / v.values.length);
                return s;
              })()
            : skewedSpace(ctx);
    const oracle = new SpaceOracle(space);
    const seeds = variant === 'cut-with-seeds' ? randomSeeds(space, oracle, rng, 3) : [];
    const st = store(space);
    const base: PlanOptions = { seed: ctx.seed, ...(seeds.length ? { seeds } : {}) };
    const full = planOf(ctx, st, base);
    const facts = checkPlan(space, oracle, full, { seeds });
    must(facts.problems.length === 0, () => facts.problems.join('; '));
    const total = full.rows.length;
    ordered(freshLogs(space, full, seeds.length), `${total} rows`);
    if (variant.startsWith('cut-')) {
      const budget =
        variant === 'cut-tight-budget'
          ? Math.max(1, Math.floor(total / 10)) + seeds.length
          : variant === 'cut-half-budget'
            ? Math.floor(total / 2)
            : seeds.length + Math.floor((total - seeds.length) / 3);
      const cut = planOf(ctx, st, { ...base, budget });
      const kept = freshLogs(space, cut, seeds.length);
      const dropped = full.rows.slice(budget).map((r) => logWeight(space, indexRow(space, r.values)));
      must(
        kept.length > 0 && dropped.length > 0,
        () => `budget ${budget} of ${total} rows keeps ${kept.length} and drops ${dropped.length} new rows`,
      );
      if (RARE_ROWS_CUT === 'last') {
        const keptMax = Math.max(...kept);
        const droppedMin = Math.min(...dropped);
        must(
          droppedMin >= keptMax - 1e-9,
          () =>
            `budget ${budget} dropped a new row of log weight ${droppedMin.toFixed(4)} while it kept one of ${keptMax.toFixed(4)}: the rare rows should be cut last`,
        );
      } else {
        const keptMin = Math.min(...kept);
        const droppedMax = Math.max(...dropped);
        must(
          droppedMax <= keptMin + 1e-9,
          () =>
            `budget ${budget} dropped a new row of log weight ${droppedMax.toFixed(4)} while it kept one of ${keptMin.toFixed(4)}: the rare rows should be cut first`,
        );
      }
    }
  },

  'budget.invalid-values': (variant, ctx) => {
    const space = makeSpace([2, 2, 2], { shared: [0, 1, 2] });
    const bad: unknown =
      variant === 'negative' ? -1 : variant === 'nan' ? Number.NaN : variant === 'fraction' ? 1.5 : '10';
    const error = planError(ctx, toStore(space), { seed: ctx.seed, budget: bad as number });
    must(
      !!error,
      () => `plan accepted the budget ${show(bad)}; it should throw a RangeError that names the budget`,
    );
    const e = error as Error;
    must(
      e.name === 'RangeError' || (variant === 'string' && e.name === 'TypeError'),
      () => `plan threw ${e.name}: ${e.message}; expected a RangeError`,
    );
    must(
      e.message.toLowerCase().includes('budget'),
      () => `the error "${e.message}" does not name the budget`,
    );
  },

  'budget.log-space-weights': (variant, ctx) => {
    const n = variant === 'two-hundred-variables' ? 200 : 100;
    const share = variant === 'two-hundred-variables' ? 1e-4 : 1e-6;
    const space = makeSpace(Array(n).fill(2), { shared: Array.from({ length: n }, (_, i) => i) });
    for (const v of space.vars) v.weights = [share, 1 - share];
    const plan = planOf(ctx, toStore(space), { seed: ctx.seed });
    const facts = checkPlan(space, new SpaceOracle(space), plan, { noCoverage: true });
    must(facts.problems.length === 0, () => facts.problems.join('; '));
    ordered(freshLogs(space, plan, 0), `${n} variables with shares ${share}`);
    const distinct = new Set(freshLogs(space, plan, 0).map((x) => x.toFixed(3))).size;
    must(distinct >= 2, 'the generator should give rows of different weights');
  },

  'budget.weights-from-store': (variant, ctx) => {
    const space = skewedSpace(ctx);
    const plan = planOf(ctx, store(space, variant === 'owner-declared' ? 'owner' : 'conversations'), {
      seed: ctx.seed,
    });
    ordered(freshLogs(space, plan, 0), `weights from ${variant}`);
    const logs = freshLogs(space, plan, 0);
    must(
      new Set(logs.map((x) => x.toFixed(6))).size > 1,
      'the generator should give rows of different weights',
    );
  },

  'budget.uniform-without-weights': (variant, ctx) => {
    const { rng } = ctx;
    const space = skewedSpace(ctx);
    if (variant === 'no-weights') {
      for (const v of space.vars) delete v.weights;
    } else {
      space.vars.forEach((v, i) => {
        if (i % 2 === 1) delete v.weights;
      });
    }
    const st = store(space);
    const full = planOf(ctx, st, { seed: ctx.seed });
    const facts = checkPlan(space, new SpaceOracle(space), full);
    must(facts.problems.length === 0, () => facts.problems.join('; '));
    const total = full.rows.length;
    const b = Math.max(1, Math.floor(total / 2));
    samePrefix(full, planOf(ctx, st, { seed: ctx.seed, budget: b }), b, variant);
    if (variant === 'no-weights') {
      const w0 = full.rows[0]?.weight as number;
      must(
        full.rows.every((r) => Math.abs(r.weight - w0) <= 1e-12 * Math.max(1, Math.abs(w0))),
        () =>
          `no variable has weights but the rows report different weights: ${show(full.rows.slice(0, 4).map((r) => r.weight))}`,
      );
    } else {
      ordered(freshLogs(space, full, 0), 'partial weights (a variable without weights counts as uniform)');
    }
    void rng;
  },

  'budget.weight-reported': (variant, ctx) => {
    const { rng } = ctx;
    const space =
      variant === 'short-rows'
        ? randomSpace(rng, { vars: 4, minArity: 3, maxArity: 3, rules: [4], weights: true })
        : randomSpace(rng, { vars: 6, minArity: 2, maxArity: 4, shared: 3, rules: [3], weights: true });
    const plan = planOf(ctx, toStore(space), { seed: ctx.seed });
    const facts = checkPlan(space, new SpaceOracle(space), plan);
    must(facts.problems.length === 0, () => facts.problems.join('; '));
    for (const [i, r] of plan.rows.entries()) {
      const want = Math.exp(logWeight(space, indexRow(space, r.values)));
      must(
        typeof r.weight === 'number' && Math.abs(r.weight - want) <= 1e-9 * want + 1e-300,
        () => `row ${i} reports weight ${show(r.weight)}; the product of its value shares is ${want}`,
      );
    }
    void groupsOf;
  },
};

void (undefined as unknown as StoreDoc);

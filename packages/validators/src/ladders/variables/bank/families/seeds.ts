import type { Row } from '../../interface';
import { planOf, type StemRun } from '../item';
import {
  groupsOf,
  type IndexRow,
  indexRow,
  logWeight,
  makeSpace,
  rowOf,
  type Space,
  type SpaceGroup,
  SpaceOracle,
  toStore,
} from '../oracle/space';
import {
  checkPlan,
  describeSpace,
  planAndCheck,
  randomSeeds,
  randomSpace,
  randomValidRow,
} from '../oracle/spaces';
import { cpuMs, deepEqual, must, type Rng, show, stableStringify } from '../util';

const BOUND = 1.25;

/** The index of the first new row that holds no required tuple the seeds miss, or -1. */
export function idleRow(
  oracle: SpaceOracle,
  groups: readonly SpaceGroup[],
  seeds: readonly IndexRow[],
  fresh: readonly IndexRow[],
): number {
  const required = oracle.required(groups);
  const held = oracle.covered(seeds, groups, required);
  return fresh.findIndex((row) => {
    const mine = oracle.covered([row], groups, required);
    for (const key of mine) if (!held.has(key)) return false;
    return true;
  });
}

/** Seeds drawn value by value from the space's weights (rare values stay rare). */
export function weightedSeeds(space: Space, oracle: SpaceOracle, rng: Rng, count: number): Row[] {
  const out: Row[] = [];
  for (let tries = 0; out.length < count && tries < count * 5; tries += 1) {
    const idx = space.vars.map((v) => {
      const w = v.weights ?? v.values.map(() => 1 / v.values.length);
      let u = rng.next();
      let k = 0;
      while (k < w.length - 1 && u >= (w[k] as number)) {
        u -= w[k] as number;
        k += 1;
      }
      return k;
    });
    if (oracle.rowIsValid(idx)) out.push(rowOf(space, idx));
  }
  return out;
}

/** Random valid rows until the seeds hold the target share of the required tuples. */
function seedsHolding(
  space: Space,
  oracle: SpaceOracle,
  groups: readonly SpaceGroup[],
  rng: Rng,
  target: number,
): Row[] {
  const required = oracle.required(groups);
  const rows: IndexRow[] = [];
  let held = 0;
  for (let tries = 0; held / required.size < target && tries < 4000; tries += 1) {
    rows.push(randomValidRow(space, oracle, rng));
    held = oracle.covered(rows, groups, required).size;
  }
  return rows.map((r) => rowOf(space, r));
}

const dropKeys = (rng: Rng, row: Row, keep: number): Row => {
  const keys = rng.sample(Object.keys(row), Math.max(1, Math.min(keep, Object.keys(row).length)));
  return Object.fromEntries(keys.map((k) => [k, row[k] as string]));
};

function midSpace(rng: Rng): Space {
  return randomSpace(rng, { vars: 7, minArity: 2, maxArity: 3, shared: 3, rules: [3, 3] });
}

export const SEEDS_RUNS: Record<string, StemRun> = {
  'seeds.lead-the-plan': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, {
      vars: 6,
      minArity: 2,
      maxArity: 3,
      shared: 2,
      rules: [3],
      weights: variant === 'weights-would-reorder',
    });
    const oracle = new SpaceOracle(space);
    const count =
      variant === 'one-seed'
        ? 1
        : variant === 'thirty-seeds'
          ? 30
          : variant === 'five-seeds'
            ? 5
            : variant === 'weights-would-reorder'
              ? 6
              : 5;
    let seeds = randomSeeds(space, oracle, rng, count);
    if (variant === 'partial-seeds') seeds = seeds.map((s) => dropKeys(rng, s, 3));
    if (variant === 'weights-would-reorder') {
      seeds = [...seeds].sort(
        (a, b) => logWeight(space, indexRow(space, b)) - logWeight(space, indexRow(space, a)),
      );
    }
    if (variant === 'key-order-differs') {
      seeds = seeds.map((s) => Object.fromEntries(Object.entries(s).reverse()));
    }
    planAndCheck(ctx, space, { seeds, noCoverage: variant !== 'key-order-differs' });
  },

  'seeds.new-rows-for-missing': (variant, ctx) => {
    const { rng } = ctx;
    let space: Space;
    let seeds: Row[];
    if (variant.startsWith('full-seeds')) {
      space =
        variant === 'full-seeds-binary-axes'
          ? makeSpace([2, 2, 2, 2], { shared: [0, 1, 2, 3] })
          : variant === 'full-seeds-rule-triples'
            ? makeSpace([2, 2, 2, 2], { rules: [[0, 1, 2, 3]] })
            : makeSpace([2, 3, 2, 2, 3, 2], { shared: [0, 1], rules: [[2, 3, 4]] });
      seeds = new SpaceOracle(space).validRows().map((r) => rowOf(space, r));
    } else if (variant === 'rare-tuples-only' || variant === 'mostly-covered') {
      space = randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, shared: 3, rules: [3], weights: true });
      const oracle = new SpaceOracle(space);
      seeds =
        variant === 'rare-tuples-only'
          ? weightedSeeds(space, oracle, rng, 150)
          : seedsHolding(space, oracle, groupsOf(space), rng, 0.95);
    } else {
      space = midSpace(rng);
      const oracle = new SpaceOracle(space);
      const target =
        variant === 'random-three-seeds'
          ? 0
          : variant === 'thirty-percent-covered'
            ? 0.3
            : variant === 'half-covered'
              ? 0.5
              : 0.9;
      seeds =
        target === 0
          ? randomSeeds(space, oracle, rng, 3)
          : seedsHolding(space, oracle, groupsOf(space), rng, target);
    }
    const oracle = new SpaceOracle(space);
    const groups = groupsOf(space);
    const facts = planAndCheck(ctx, space, { seeds, boundFactor: BOUND });
    const seedIdx = seeds.map((s) => indexRow(space, s));
    const idle = idleRow(oracle, groups, seedIdx, facts.fresh);
    must(
      idle < 0,
      () =>
        `${describeSpace(space)} with ${seeds.length} seeds: new row ${idle} holds no required tuple that the seeds miss`,
    );
    if (variant.startsWith('full-seeds')) {
      must(
        facts.fresh.length === 0,
        () =>
          `the ${seeds.length} seeds already cover every required tuple but the plan adds ${facts.fresh.length} new rows`,
      );
    } else if (
      ['half-covered', 'mostly-covered', 'thirty-percent-covered', 'ninety-percent-covered'].includes(variant)
    ) {
      const without = planOf(ctx, toStore(space), { seed: ctx.seed });
      const fewer = without.rows.length;
      must(
        facts.fresh.length < fewer,
        () =>
          `with seeds holding most tuples the plan adds ${facts.fresh.length} new rows; without seeds it adds ${fewer}`,
      );
    }
  },

  'seeds.partial-rows-credit': (variant, ctx) => {
    const { rng } = ctx;
    let space: Space;
    let seeds: Row[];
    if (variant === 'assigned-variables-only') {
      space = randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, shared: 4 });
      const oracle = new SpaceOracle(space);
      seeds = randomSeeds(space, oracle, rng, 8).map((s) => dropKeys(rng, s, 3));
    } else {
      space = makeSpace([2, 2, 2, 2, 2], { rules: [[0, 1, 2]] });
      const oracle = new SpaceOracle(space);
      const partial = randomSeeds(space, oracle, rng, 6).map((s) => {
        const keys = rng.sample(['v000', 'v001', 'v002'], 2);
        return { ...Object.fromEntries(keys.map((k) => [k, s[k] as string])), v003: s.v003 as string };
      });
      const full = randomSeeds(space, oracle, rng, 2);
      seeds = [...partial, ...full];
    }
    const oracle = new SpaceOracle(space);
    const groups = groupsOf(space);
    const facts = planAndCheck(ctx, space, { seeds, boundFactor: BOUND });
    const idle = idleRow(
      oracle,
      groups,
      seeds.map((s) => indexRow(space, s)),
      facts.fresh,
    );
    must(idle < 0, () => `new row ${idle} holds no required tuple that the (partial) seeds miss`);
  },

  'seeds.empty-list': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, shared: 2, rules: [3] });
    const store = toStore(space);
    const plain = planOf(ctx, store, { seed: ctx.seed });
    const other = planOf(
      ctx,
      store,
      variant === 'empty-array' ? { seed: ctx.seed, seeds: [] } : { seed: ctx.seed, seeds: undefined },
    );
    must(stableStringify(plain) === stableStringify(other), 'an empty or absent seed list changed the plan');
    const facts = checkPlan(space, new SpaceOracle(space), plain);
    must(facts.problems.length === 0, () => facts.problems.join('; '));
  },

  'seeds.credit-at-every-strength': (variant, ctx) => {
    const { rng } = ctx;
    let space: Space;
    let seeds: Row[];
    if (variant === 'values-missing') {
      space = makeSpace([2, 2, 2, 4], { shared: [0, 1, 2] });
      seeds = new SpaceOracle(space)
        .validRows()
        .filter((r) => (r[3] as number) < 3)
        .map((r) => rowOf(space, r));
    } else if (variant === 'pairs-missing') {
      space = makeSpace([2, 2, 2, 2, 2], { shared: [0, 1, 2, 3] });
      seeds = [rowOf(space, [0, 0, 0, 0, 0]), rowOf(space, [1, 1, 1, 1, 1])];
    } else {
      space = makeSpace([2, 2, 2, 2], { rules: [[0, 1, 2, 3]] });
      // Random rows until every pair of the rule's variables is held: the triples cannot all be held yet.
      const pairs: SpaceGroup = { id: 'pairs', kind: 'rule', vars: [0, 1, 2, 3], strength: 2 };
      const triples: SpaceGroup = { id: 'triples', kind: 'rule', vars: [0, 1, 2, 3], strength: 3 };
      const o = new SpaceOracle(space);
      const needPairs = o.required([pairs]);
      const needTriples = o.required([triples]);
      let rows: IndexRow[] = [];
      for (let attempt = 0; attempt < 200; attempt += 1) {
        rows = [];
        while (o.covered(rows, [pairs], needPairs).size < needPairs.size)
          rows.push(randomValidRow(space, o, rng));
        if (o.covered(rows, [triples], needTriples).size < needTriples.size) break;
      }
      seeds = rows.map((r) => rowOf(space, r));
    }
    const oracle = new SpaceOracle(space);
    const groups = groupsOf(space);
    const facts = planAndCheck(ctx, space, { seeds, boundFactor: BOUND });
    must(facts.fresh.length >= 1, 'the seeds miss some tuples but the plan adds no new row');
    const idle = idleRow(
      oracle,
      groups,
      seeds.map((s) => indexRow(space, s)),
      facts.fresh,
    );
    must(idle < 0, () => `new row ${idle} holds no required tuple that the seeds miss`);
    if (variant === 'values-missing') {
      must(
        facts.fresh.every((r) => r[3] === 3),
        'every new row should hold the one value the seeds never show',
      );
    }
  },

  'seeds.row-ids-unique': (variant, ctx) => {
    const { rng } = ctx;
    const space =
      variant === 'many'
        ? randomSpace(rng, { vars: 30, minArity: 2, maxArity: 2, shared: 30 })
        : randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, shared: 2, rules: [3] });
    const oracle = new SpaceOracle(space);
    const seeds = randomSeeds(space, oracle, rng, variant === 'many' ? 180 : 3);
    const facts = planAndCheck(ctx, space, { seeds, noCoverage: true });
    const ids = facts.plan.rows.map((r) => r.id);
    must(new Set(ids).size === ids.length, 'two plan rows share an id');
    must(
      ids.every((id) => typeof id === 'string' && id !== ''),
      'a plan row has an empty id',
    );
  },

  'seeds.no-duplicate-rows': (variant, ctx) => {
    if (variant === 'new-vs-seed') {
      const space = makeSpace([2, 2], { shared: [0, 1] });
      const seeds = [rowOf(space, [0, 0])];
      const facts = planAndCheck(ctx, space, { seeds });
      const seen = new Set(seeds.map((s) => stableStringify(s)));
      for (const r of facts.plan.rows.slice(1)) {
        must(!seen.has(stableStringify(r.values)), () => `a new row repeats a seed: ${show(r.values)}`);
        seen.add(stableStringify(r.values));
      }
    } else {
      const space = makeSpace([3, 3, 3]);
      const facts = planAndCheck(ctx, space);
      const keys = facts.plan.rows.map((r) => stableStringify(r.values));
      must(
        new Set(keys).size === keys.length,
        () => `two new rows are equal: ${show(facts.plan.rows.map((r) => r.values))}`,
      );
    }
  },

  'seeds.many-seeds': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, { vars: 20, minArity: 2, maxArity: 2, shared: 20 });
    for (const v of space.vars) v.weights = [0.9, 0.1];
    const oracle = new SpaceOracle(space);
    const count = variant === 'five-hundred' ? 500 : 3000;
    const seeds = weightedSeeds(space, oracle, rng, count);
    const store = toStore(space);
    const { value: plan, ms } = cpuMs(() =>
      planOf(ctx, store, { seed: ctx.seed, seeds: seeds.map((s) => ({ ...s })) }),
    );
    const facts = checkPlan(space, oracle, plan, { seeds, boundFactor: BOUND });
    must(
      facts.problems.length === 0,
      () => `${describeSpace(space)} with ${count} seeds: ${facts.problems.join('; ')}`,
    );
    must(
      ms <= 8000,
      () => `planning with ${count} seeds took ${Math.round(ms)} ms of processor time, over 8000 ms`,
    );
  },

  'seeds.pure-copy': (variant, ctx) => {
    const { rng } = ctx;
    const space = randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, shared: 2, rules: [3] });
    const oracle = new SpaceOracle(space);
    const seeds = randomSeeds(space, oracle, rng, 3);
    const given = seeds.map((s) => ({ ...s }));
    const plan = planOf(ctx, toStore(space), { seed: ctx.seed, seeds });
    const facts = checkPlan(space, oracle, plan, { seeds, noCoverage: true });
    must(facts.problems.length === 0, () => facts.problems.join('; '));
    seeds.forEach((s, i) => {
      must(
        plan.rows[i]?.values !== s,
        () => `plan row ${i} is the caller's seed object; a plan row must be a copy`,
      );
    });
    if (variant === 'later-mutation-safe') {
      const first = plan.rows[0]?.values as Row;
      const key = Object.keys(first)[0] as string;
      first[key] = 'changed-by-the-caller';
      must(deepEqual(seeds[0], given[0]), 'writing to a plan row changed the seed object of the caller');
      const copy = JSON.parse(JSON.stringify(plan.rows[1]?.values));
      (seeds[1] as Row)[Object.keys(seeds[1] as Row)[0] as string] = 'changed-by-the-caller';
      must(
        deepEqual(plan.rows[1]?.values, copy),
        'writing to a seed object after planning changed the plan row',
      );
    }
  },
};

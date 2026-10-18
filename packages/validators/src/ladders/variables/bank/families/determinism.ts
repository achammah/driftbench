import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plan, PlanOptions, Row, Sources, StoreDoc } from '../../interface';
import { OWNER_DATE } from '../constants';
import { build, type ItemContext, planOf, type StemRun } from '../item';
import {
  forbidRandom,
  makeSpace,
  rowOf,
  type Space,
  SpaceOracle,
  toStore,
  withWeights,
} from '../oracle/space';
import { checkPlan, randomSeeds, randomSpace } from '../oracle/spaces';
import { clone, deepFreeze, must, plainStringify, show, stableStringify } from '../util';
import { fullSources } from './values';

/** A small busy wait, so that a clock-dependent field would differ between two calls. */
function tick(ms = 3): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // wait
  }
}

function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    ) as T;
  }
  return value;
}

type Case = { space: Space; store: StoreDoc; options: PlanOptions };

function caseOf(ctx: ItemContext, kind: string): Case {
  const { rng } = ctx;
  let space: Space;
  let options: PlanOptions = { seed: ctx.seed };
  switch (kind) {
    case 'tiny':
      space = makeSpace([2, 2]);
      break;
    case 'heavy-constraints':
      space = randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, shared: 3, rules: [3], density: 0.4 });
      break;
    case 'equal-weights-ties':
      space = randomSpace(rng, { vars: 8, minArity: 3, maxArity: 3, shared: 4, rules: [3] });
      for (const v of space.vars) v.weights = v.values.map(() => 1 / v.values.length);
      break;
    case 'two-hundred-binary':
      space = makeSpace(Array(200).fill(2), { shared: Array.from({ length: 200 }, (_, i) => i) });
      break;
    default: {
      space = randomSpace(rng, { vars: 7, minArity: 2, maxArity: 3, shared: 3, rules: [3], weights: true });
      options = { seed: ctx.seed, seeds: randomSeeds(space, new SpaceOracle(space), rng, 3) };
    }
  }
  return { space, store: toStore(space), options };
}

function planFresh(ctx: ItemContext, c: Case, extra: Partial<PlanOptions> = {}): Plan {
  const options = { ...clone(c.options), ...extra };
  const plan = planOf(ctx, clone(c.store), options);
  const facts = checkPlan(c.space, new SpaceOracle(c.space), plan, {
    seeds: options.seeds ?? [],
    noCoverage: options.budget !== undefined,
  });
  must(facts.problems.length === 0, () => facts.problems.join('; '));
  return plan;
}

type Patch = () => () => void;

const patchMathRandom: Patch = () => {
  const saved = Math.random;
  Math.random = () => {
    throw new Error('Math.random was called while planning: draw only from the seed');
  };
  return () => {
    Math.random = saved;
  };
};

function patchClock(at: number): Patch {
  return () => {
    const Real = Date;
    class Frozen extends Real {
      constructor(...args: unknown[]) {
        super(...((args.length ? args : [at]) as [number]));
      }
      static override now(): number {
        return at;
      }
    }
    (globalThis as { Date: DateConstructor }).Date = Frozen as unknown as DateConstructor;
    return () => {
      (globalThis as { Date: DateConstructor }).Date = Real;
    };
  };
}

const patchCrypto: Patch = () => {
  const c = globalThis.crypto as unknown as Record<string, unknown>;
  const saved = { getRandomValues: c.getRandomValues, randomUUID: c.randomUUID };
  const boom = () => {
    throw new Error('crypto random was called while planning: draw only from the seed');
  };
  Object.defineProperty(c, 'getRandomValues', { value: boom, configurable: true, writable: true });
  Object.defineProperty(c, 'randomUUID', { value: boom, configurable: true, writable: true });
  return () => {
    Object.defineProperty(c, 'getRandomValues', {
      value: saved.getRandomValues,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(c, 'randomUUID', { value: saved.randomUUID, configurable: true, writable: true });
  };
};

function withPatches<T>(patches: readonly Patch[], run: () => T): T {
  const undo: Array<() => void> = [];
  try {
    for (const p of patches) undo.push(p());
    return run();
  } finally {
    for (const u of undo.reverse()) u();
  }
}

const CHILD = fileURLToPath(new URL('../plan-child.ts', import.meta.url));

/** Runs plan or buildStore in a new process with the given environment and returns its JSON output. */
function inChild(ctx: ItemContext, input: unknown, env: Record<string, string>): string {
  must(
    ctx.implModule !== undefined,
    'the implementation was not loaded from a module, so a second process cannot load it',
  );
  const dir = mkdtempSync(join(tmpdir(), 'variables-bank-'));
  try {
    const file = join(dir, 'input.json');
    writeFileSync(file, JSON.stringify(input));
    const got = spawnSync(process.execPath, ['--import', 'tsx', CHILD, ctx.implModule as string, file], {
      cwd: ctx.root,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 100_000,
    });
    must(
      got.status === 0,
      () =>
        `the second process exited ${got.status}: ${String(got.stderr).trim().split('\n').slice(-3).join(' / ')}`,
    );
    return String(got.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const planJson = (plan: Plan) => plainStringify(plan);

export const DETERMINISM_RUNS: Record<string, StemRun> = {
  'determinism.same-seed-same-bytes': (variant, ctx) => {
    const c = caseOf(ctx, variant);
    let extra: Partial<PlanOptions> = {};
    if (variant === 'rules-seeds-budget') extra = { budget: Math.floor(planFresh(ctx, c).rows.length / 2) };
    const first = planJson(planFresh(ctx, c, extra));
    tick();
    const second = planJson(planFresh(ctx, c, extra));
    must(
      first === second,
      () =>
        `two plans with the same store, options and seed differ: ${show(first, 120)} then ${show(second, 120)}`,
    );
  },

  'determinism.interleaved-calls': (variant, ctx) => {
    const a = caseOf(ctx, 'rules-seeds-budget');
    const first = planJson(planFresh(ctx, a));
    if (variant === 'other-store-between') {
      const b = caseOf(ctx, 'heavy-constraints');
      planFresh(ctx, b, { seed: ctx.seed + 17 });
    } else {
      planFresh(ctx, a, { budget: 3 });
    }
    const third = planJson(planFresh(ctx, a));
    must(
      first === third,
      () =>
        `a plan changed after another plan was made in between: ${show(first, 120)} then ${show(third, 120)}`,
    );
  },

  'determinism.across-processes': (variant, ctx) => {
    let space: Space;
    let env: Record<string, string> = {};
    if (variant === 'turkish-locale') {
      space = randomSpace(ctx.rng, {
        vars: 6,
        minArity: 3,
        maxArity: 3,
        shared: 3,
        rules: [3],
        weights: true,
      });
      space.vars.forEach((v, i) => {
        v.id = `v${i}`;
        v.values = ['Ice', 'ice', 'Iron', 'iron', 'Info'].slice(0, v.values.length);
      });
      for (const v of space.vars) v.weights = v.values.map(() => 1 / v.values.length);
      env = { LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' };
    } else if (variant === 'accented-ids-sort') {
      space = randomSpace(ctx.rng, { vars: 6, minArity: 3, maxArity: 3, shared: 3, rules: [3] });
      space.vars.forEach((v, i) => {
        v.id = ['Apple', 'apple', 'zebra', 'Oil', 'oil', 'Aker'][i] as string;
        v.values = ['A', 'a', 'z'];
      });
      for (const v of space.vars) v.weights = [0.34, 0.33, 0.33];
      env = { LC_ALL: 'sv_SE.UTF-8', LANG: 'sv_SE.UTF-8' };
    } else {
      space = randomSpace(ctx.rng, {
        vars: 7,
        minArity: 2,
        maxArity: 3,
        shared: 3,
        rules: [3],
        weights: true,
      });
      if (variant === 'other-time-zone') env = { TZ: 'Pacific/Kiritimati' };
    }
    const store = toStore(space);
    if (variant === 'accented-ids-sort') {
      store.variables.forEach((variable, i) => {
        variable.title = ['äpple', 'apple', 'zebra', 'öl', 'oil', 'åker'][i];
        variable.values.forEach((value, j) => {
          value.title = ['ä', 'a', 'z'][j];
        });
      });
    }
    const options: PlanOptions = { seed: ctx.seed };
    const here = planJson(planFresh(ctx, { space, store, options }));
    const there = inChild(ctx, { kind: 'plan', store, options }, env);
    must(
      here === there,
      () =>
        `the plan in a second process (${show(env)}) differs: ${show(here, 100)} then ${show(there, 100)}`,
    );
  },

  'determinism.no-ambient-randomness': (variant, ctx) => {
    const c = caseOf(ctx, 'rules-seeds-budget');
    const normal = planJson(planFresh(ctx, c));
    const patches: Patch[][] =
      variant === 'math-random-throws'
        ? [[patchMathRandom]]
        : variant === 'clock-frozen-differently'
          ? [[patchClock(1_000_000_000_000)], [patchClock(2_000_000_000_000)]]
          : variant === 'crypto-throws'
            ? [[patchCrypto]]
            : [[patchMathRandom, patchClock(1_700_000_000_000), patchCrypto]];
    for (const set of patches) {
      const got = withPatches(set, () => planJson(planFresh(ctx, c)));
      must(
        got === normal,
        () =>
          `the plan changed when the ambient ${variant.replace(/-/g, ' ')}: ${show(normal, 100)} then ${show(got, 100)}`,
      );
    }
  },

  'determinism.key-order': (variant, ctx) => {
    const c = caseOf(ctx, 'rules-seeds-budget');
    const normal = stableStringify(planFresh(ctx, c));
    let other: Plan;
    if (variant === 'store-keys') {
      other = planOf(ctx, reverseKeys(clone(c.store)), clone(c.options));
    } else {
      other = planOf(ctx, clone(c.store), {
        ...c.options,
        seeds: (c.options.seeds ?? []).map((s) => reverseKeys(clone(s))),
      });
    }
    must(
      stableStringify(other) === normal,
      () =>
        `reversing the key order of the ${variant.replace('-', ' ')} changed the plan: ${show(normal, 100)} then ${show(stableStringify(other), 100)}`,
    );
  },

  'determinism.json-round-trip': (variant, ctx) => {
    const c = caseOf(ctx, 'rules-seeds-budget');
    planFresh(ctx, c);
    if (variant === 'store') {
      const store = clone(c.store);
      planOf(ctx, store, clone(c.options));
      const v = store.variables[0];
      must(!!v, 'the generator built no variable');
      (v as NonNullable<typeof v>).values.push({
        id: 'extra',
        provenance: [{ kind: 'owner', words: 'added in place', date: OWNER_DATE }],
      });
      const reused = planJson(planOf(ctx, store, clone(c.options)));
      const fresh = planJson(planOf(ctx, clone(store), clone(c.options)));
      must(
        reused === fresh,
        () =>
          `a store edited in place and planned again gives another plan than a copy of it: the plan keeps a cache keyed by the object (${show(reused, 80)} then ${show(fresh, 80)})`,
      );
    } else {
      const options: PlanOptions = { ...clone(c.options), budget: 6 };
      planOf(ctx, clone(c.store), options);
      options.budget = 11;
      const reused = planJson(planOf(ctx, clone(c.store), options));
      const fresh = planJson(planOf(ctx, clone(c.store), { ...clone(c.options), budget: 11 }));
      must(
        reused === fresh,
        () =>
          `options edited in place and used again give another plan than a copy of them (${show(reused, 80)} then ${show(fresh, 80)})`,
      );
    }
  },

  'determinism.inputs-not-written': (variant, ctx) => {
    const c = caseOf(ctx, 'rules-seeds-budget');
    const normal = planJson(planFresh(ctx, c));
    const store = variant === 'frozen-store' ? deepFreeze(clone(c.store)) : clone(c.store);
    const options = clone(c.options);
    if (variant === 'frozen-seeds') deepFreeze(options.seeds);
    const frozenOptions = variant === 'frozen-options' ? deepFreeze(options) : options;
    const got = planJson(planOf(ctx, store, frozenOptions));
    must(
      got === normal,
      () =>
        `the plan from frozen inputs differs from the plan from plain inputs: ${show(got, 100)} then ${show(normal, 100)}`,
    );
  },

  'determinism.store-bytes': (variant, ctx) => {
    const { sources } = fullSources(ctx);
    const text = (s: Sources) => plainStringify(build(ctx, clone(s)));
    if (variant === 'two-calls') {
      const a = text(sources);
      tick();
      const b = text(sources);
      must(a === b, () => `two builds of the same sources differ: ${show(a, 100)} then ${show(b, 100)}`);
    } else if (variant === 'other-key-order') {
      const a = stableStringify(build(ctx, clone(sources)));
      const b = stableStringify(build(ctx, reverseKeys(clone(sources))));
      must(
        a === b,
        () =>
          `reversing the key order of the sources changed the store: ${show(a, 100)} then ${show(b, 100)}`,
      );
    } else {
      const here = text(sources);
      const there = inChild(ctx, { kind: 'build', sources }, {});
      must(
        here === there,
        () => `the store built in a second process differs: ${show(here, 100)} then ${show(there, 100)}`,
      );
    }
  },
};

void withWeights;
void forbidRandom;
void rowOf;
void (undefined as unknown as Row);

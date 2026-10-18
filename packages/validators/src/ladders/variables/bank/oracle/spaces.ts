import type { Plan, PlanOptions, Row } from '../../interface';
import { type ItemContext, planOf } from '../item';
import { must, type Rng, show } from '../util';
import {
  type Coverage,
  coverageOf,
  forbiddenRows,
  parsePlan,
  rowBound,
  seedCoverage,
  shapeProblems,
} from './planCheck';
import {
  forbidRandom,
  groupsOf,
  type IndexRow,
  indexRow,
  makeSpace,
  rowOf,
  type Space,
  type SpaceGroup,
  SpaceOracle,
  type SpaceVar,
  toStore,
  withWeights,
} from './space';

/** Random spaces and the full check of a plan against one. */

export type SpaceShape = {
  vars: number;
  minArity?: number;
  maxArity?: number;
  /** How many of the first variables are shared axes. */
  shared?: number;
  /** Rules as sizes; variables are drawn from the non-shared ones (or from all when there are none). */
  rules?: readonly number[];
  /** Density of impossible pairs among non-universal values. */
  density?: number;
  weights?: boolean;
  /** Draw the rule variables with overlap allowed (default: disjoint when they fit). */
  overlap?: boolean;
};

export function randomSpace(rng: Rng, shape: SpaceShape): Space {
  const arities = Array.from({ length: shape.vars }, () => rng.int(shape.minArity ?? 2, shape.maxArity ?? 3));
  const shared = Array.from({ length: shape.shared ?? 0 }, (_, i) => i);
  const pool = Array.from({ length: shape.vars }, (_, i) => i).filter((i) => !shared.includes(i));
  const used = new Set<number>();
  const rules: number[][] = [];
  for (const size of shape.rules ?? []) {
    const free = pool.filter((i) => shape.overlap || !used.has(i));
    const from = free.length >= size ? free : pool;
    const picked = rng.sample(from, Math.min(size, from.length));
    for (const p of picked) used.add(p);
    rules.push(picked);
  }
  const space = makeSpace(arities, { shared, rules, universal: true });
  if (shape.density) forbidRandom(space, rng, shape.density);
  if (shape.weights) withWeights(space, rng);
  return space;
}

/** A random valid full row of a space (rejection sampling on a universal space, a draw from the valid rows otherwise). */
export function randomValidRow(space: Space, oracle: SpaceOracle, rng: Rng): number[] {
  if (!space.universal) return rng.pick(oracle.validRows());
  for (let tries = 0; tries < 500; tries += 1) {
    const row = space.vars.map((v) => rng.int(0, v.values.length - 1));
    if (oracle.rowIsValid(row)) return row;
  }
  return space.vars.map(() => 0);
}

/** `count` distinct random valid rows as plan seeds (value maps). */
export function randomSeeds(space: Space, oracle: SpaceOracle, rng: Rng, count: number): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries += 1) {
    const row = randomValidRow(space, oracle, rng);
    const key = row.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rowOf(space, row));
  }
  return out;
}

export type PlanFacts = {
  plan: Plan;
  /** Rows after the seeds, as value indexes. */
  fresh: IndexRow[];
  coverage: Coverage;
  /** Required tuples the seeds alone hold. */
  seedHeld: number;
  problems: string[];
};

export type CheckOptions = {
  seeds?: readonly Row[];
  groups?: readonly SpaceGroup[];
  /** Check the new rows against the greedy bound times this factor (default: no bound check). */
  boundFactor?: number;
  /** Do not require full coverage (the shape and the impossible pairs are still checked). */
  noCoverage?: boolean;
};

/**
 * Checks a plan against a space: its shape, the seeds, the impossible pairs, full coverage of every allowed
 * required tuple, and optionally the row bound. Returns the problems found (at most a few per kind).
 */
export function checkPlan(
  space: Space,
  oracle: SpaceOracle,
  plan: Plan,
  options: CheckOptions = {},
): PlanFacts {
  const seeds = options.seeds ?? [];
  const groups = options.groups ?? groupsOf(space);
  const problems = shapeProblems(space, plan, seeds);
  if (problems.length > 0)
    return { plan, fresh: [], coverage: { required: 0, covered: 0, missing: [] }, seedHeld: 0, problems };
  const parsed = parsePlan(space, plan, seeds.length);
  const seedIdx = seeds.map((s) => indexRow(space, s));
  problems.push(...forbiddenRows(space, oracle, parsed));
  const coverage = coverageOf(space, oracle, groups, seedIdx, parsed.freshIndex);
  const held = seedCoverage(oracle, groups, seedIdx).size;
  if (!options.noCoverage && coverage.missing.length > 0) {
    problems.push(
      `${coverage.required - coverage.covered} of ${coverage.required} required tuples are not covered, for example ${coverage.missing.slice(0, 3).join(' | ')}`,
    );
  }
  if (options.boundFactor !== undefined) {
    const missing = coverage.required - held;
    const bound = rowBound(space, groups, missing, options.boundFactor);
    if (parsed.freshIndex.length > bound) {
      problems.push(
        `the plan adds ${parsed.freshIndex.length} new rows for ${missing} tuples the seeds miss; a covering array needs at most ${bound}`,
      );
    }
  }
  return { plan, fresh: parsed.freshIndex, coverage, seedHeld: held, problems };
}

/** Plans a space and fails the item with the problems found, if any. */
export function planAndCheck(
  ctx: ItemContext,
  space: Space,
  options: Partial<PlanOptions> &
    CheckOptions & { storeOptions?: { weightProvenance?: 'owner' | 'conversations' } } = {},
): PlanFacts {
  const oracle = new SpaceOracle(space);
  const store = toStore(space, options.storeOptions);
  const planOptions: PlanOptions = {
    seed: options.seed ?? ctx.seed,
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(options.seeds ? { seeds: options.seeds.map((s) => ({ ...s })) } : {}),
  };
  const plan = planOf(ctx, store, planOptions);
  const facts = checkPlan(space, oracle, plan, options);
  must(facts.problems.length === 0, () => `${describeSpace(space)}: ${facts.problems.join('; ')}`);
  return facts;
}

export function describeSpace(space: Space): string {
  const arities = space.vars.map((v: SpaceVar) => v.values.length);
  return `plan of ${space.vars.length} variables (arities ${show(arities)}, ${space.rules.length} rules, ${space.vars.filter((v) => v.shared).length} axes, ${space.forbidden.length} impossible pairs)`;
}

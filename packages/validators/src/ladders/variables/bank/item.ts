import type {
  CoverageResult,
  Group,
  Plan,
  PlanOptions,
  Row,
  Sources,
  StoreDoc,
  VariablesImpl,
} from '../interface';
import { formatProblems } from './format';
import type { Level, Tier } from './manifest/types';
import { attempt, Fail, must, type Rng, show } from './util';

/**
 * One item of the variables bank (docs/validators.md section 12.1): one capability the variable store or the
 * planner must have, as code. The item builds its input from a seeded generator, knows the answer by
 * construction (the oracle) and names the one component it points at. A check returns when the item passes and
 * throws a Fail (or any error) with a message an executor can act on when it does not.
 */

export type ItemContext = {
  seed: number;
  /** The implementation under test; a function it does not provide is undefined. */
  impl: Partial<VariablesImpl>;
  /** The module the implementation was loaded from, when it was loaded from one (cross-process items need it). */
  implModule?: string;
  root: string;
  /** The item's own stream of draws. */
  rng: Rng;
  /** The item id. */
  id: string;
};

export type ItemOutcome = { pass: boolean; detail: string };

/** What a stem runs for one variant: it returns (optionally a short note) when the item passes. */
export type StemRun = (variant: string, ctx: ItemContext) => undefined | string | Promise<undefined | string>;

export type BankItem = {
  id: string;
  stem: string;
  family: string;
  tier: Tier;
  level: Level;
  component: string;
  cause: string;
  /** How long the validator lets the item run before it stops it. */
  budgetMs?: number;
  check(ctx: ItemContext): ItemOutcome | Promise<ItemOutcome>;
};

export const ok = (detail = 'ok'): ItemOutcome => ({ pass: true, detail });
export const fail = (detail: string): ItemOutcome => ({ pass: false, detail });

/** The outcome of a stem run: a Fail is a failed item with its message; any other error says what was thrown. */
export async function outcomeOf(run: () => ReturnType<StemRun>): Promise<ItemOutcome> {
  try {
    const note = await run();
    return ok(typeof note === 'string' ? note : 'ok');
  } catch (cause) {
    if (cause instanceof Fail) return fail(cause.message);
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return fail(`the item threw ${error.name}: ${error.message}`);
  }
}

const MISSING =
  'is not provided by the variables implementation (packages/validators/src/ladders/variables/adapter.ts maps the real code to the bank interface and maps nothing yet)';

function provided<K extends keyof VariablesImpl>(ctx: ItemContext, name: K): VariablesImpl[K] {
  const fn = ctx.impl[name];
  must(typeof fn === 'function', `${name} ${MISSING}`);
  return fn as VariablesImpl[K];
}

function isStore(value: unknown): value is StoreDoc {
  const s = value as StoreDoc | undefined;
  return (
    !!s &&
    Array.isArray(s.variables) &&
    Array.isArray(s.impossible) &&
    Array.isArray(s.rules) &&
    Array.isArray(s.refused)
  );
}

/** Calls buildStore; a throw or a result that is not a StoreDoc fails the item. */
export function build(ctx: ItemContext, sources: Sources): StoreDoc {
  const fn = provided(ctx, 'buildStore');
  const got = attempt(() => fn(sources));
  must(!got.error, () => `buildStore threw ${got.error?.name}: ${got.error?.message}`);
  must(
    isStore(got.value),
    () =>
      `buildStore returned ${show(got.value, 120)}, not a store with the arrays variables, impossible, rules and refused`,
  );
  const store = got.value as StoreDoc;
  const problems = formatProblems(store);
  must(
    problems.length === 0,
    () => `buildStore returned invalid shared format fields (docs/variables.md): ${problems.join('; ')}`,
  );
  for (const variable of store.variables) {
    for (const value of variable.values) {
      must(
        Array.isArray(value.provenance) && value.provenance.length > 0,
        () =>
          `buildStore source-reader output: the value ${value.id} of ${variable.id} names no provenance (docs/variables.md R1)`,
      );
    }
  }
  return store;
}

/** Calls buildStore and returns the error it threw, or undefined when it did not throw. */
export function buildError(ctx: ItemContext, sources: Sources): Error | undefined {
  const fn = provided(ctx, 'buildStore');
  return attempt(() => fn(sources)).error;
}

export function planOf(ctx: ItemContext, store: StoreDoc, options: PlanOptions): Plan {
  const fn = provided(ctx, 'plan');
  const got = attempt(() => fn(store, options));
  must(!got.error, () => `plan threw ${got.error?.name}: ${got.error?.message}`);
  const plan = got.value as Plan | undefined;
  must(
    !!plan && Array.isArray(plan.rows),
    () => `plan returned ${show(plan, 120)}, not an object with a rows array`,
  );
  return plan as Plan;
}

export function planError(ctx: ItemContext, store: StoreDoc, options: PlanOptions): Error | undefined {
  const fn = provided(ctx, 'plan');
  const got = attempt(() => fn(store, options));
  return got.error;
}

export function callCoverage(
  ctx: ItemContext,
  store: StoreDoc,
  rows: Row[],
  groups: Group[],
  options?: { uncovered?: number },
): CoverageResult {
  const fn = provided(ctx, 'coverage');
  const got = attempt(() => fn(store, rows, groups, options));
  must(!got.error, () => `coverage threw ${got.error?.name}: ${got.error?.message}`);
  const result = got.value as CoverageResult | undefined;
  must(
    !!result && result.allowed !== undefined && result.covered !== undefined,
    () => `coverage returned ${show(result, 120)}, not an object with allowed and covered`,
  );
  return result as CoverageResult;
}

export function callCoverageError(
  ctx: ItemContext,
  store: StoreDoc,
  rows: Row[],
  groups: Group[],
): Error | undefined {
  const fn = provided(ctx, 'coverage');
  return attempt(() => fn(store, rows, groups)).error;
}

/** Calls plan and returns the plan or the error it threw; a missing function still fails the item. */
export function tryPlan(
  ctx: ItemContext,
  store: StoreDoc,
  options: PlanOptions,
): { plan?: Plan; error?: Error } {
  const fn = provided(ctx, 'plan');
  const got = attempt(() => fn(store, options));
  if (got.error) return { error: got.error };
  const plan = got.value as Plan | undefined;
  must(
    !!plan && Array.isArray(plan.rows),
    () => `plan returned ${show(plan, 120)}, not an object with a rows array`,
  );
  return { plan: plan as Plan };
}

/** Calls weightInterval. */
export function callInterval(ctx: ItemContext, count: number, total: number): [number, number] {
  const fn = provided(ctx, 'weightInterval');
  const got = attempt(() => fn(count, total));
  must(
    !got.error,
    () => `weightInterval(${count}, ${total}) threw ${got.error?.name}: ${got.error?.message}`,
  );
  const iv = got.value as unknown;
  must(
    Array.isArray(iv) && iv.length === 2 && iv.every((x) => typeof x === 'number'),
    () => `weightInterval(${count}, ${total}) returned ${show(iv)}, expected [lower, upper] as numbers`,
  );
  return iv as [number, number];
}

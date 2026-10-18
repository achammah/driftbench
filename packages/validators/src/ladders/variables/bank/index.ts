import { bankMeasure, type Item, type Measure } from '../../../ladder';
import type { VariablesImpl } from '../interface';
import { BOUNDARIES_RUNS } from './families/boundaries';
import { BUDGET_RUNS } from './families/budget';
import { COUNTER_RUNS } from './families/counter';
import { DETERMINISM_RUNS } from './families/determinism';
import { IMPOSSIBLE_RUNS } from './families/impossible';
import { QUOTES_RUNS } from './families/quotes';
import { SCALE_RUNS } from './families/scale';
import { SEEDS_RUNS } from './families/seeds';
import { SOURCES_RUNS } from './families/sources';
import { STRENGTH_RUNS } from './families/strength';
import { VALUES_RUNS } from './families/values';
import { WEIGHTS_RUNS } from './families/weights';
import type { BankItem, ItemContext, ItemOutcome } from './item';
import { outcomeOf } from './item';
import { FAMILY_LEVEL, LEVELS, type Level, STEMS } from './manifest/index';
import { itemRng } from './util';

export type { BankItem, ItemContext, ItemOutcome } from './item';
export { LEVELS, type Level } from './manifest/index';

/** The executable check of every stem, by stem id. */
export const RUNS = {
  ...SOURCES_RUNS,
  ...QUOTES_RUNS,
  ...VALUES_RUNS,
  ...BOUNDARIES_RUNS,
  ...IMPOSSIBLE_RUNS,
  ...WEIGHTS_RUNS,
  ...COUNTER_RUNS,
  ...STRENGTH_RUNS,
  ...SEEDS_RUNS,
  ...BUDGET_RUNS,
  ...DETERMINISM_RUNS,
  ...SCALE_RUNS,
};

/** How long the validator lets an item run before it stops it (wall clock). */
export const DEFAULT_ITEM_BUDGET_MS = 120_000;
const HEAVY_ITEM_BUDGET_MS = 300_000;

/** Every item of the bank, in ladder order (level, then the order of the manifest). */
export function variablesBank(): BankItem[] {
  const items: BankItem[] = [];
  for (const stem of STEMS) {
    const run = RUNS[stem.id];
    const heavy =
      stem.family === 'scale' ||
      stem.id === 'determinism.across-processes' ||
      stem.id === 'weights.interval-coverage';
    for (const [key, tier] of stem.variants) {
      items.push({
        id: `${stem.id}.${key}`,
        stem: stem.id,
        family: stem.family,
        tier,
        level: FAMILY_LEVEL[stem.family],
        component: stem.component,
        cause: stem.variantCauses?.[key] ?? stem.cause,
        ...(heavy ? { budgetMs: HEAVY_ITEM_BUDGET_MS } : {}),
        check: (ctx) =>
          run
            ? outcomeOf(() => run(key, ctx))
            : { pass: false, detail: `the stem ${stem.id} has no executable check` },
      });
    }
  }
  const order = new Map<Level, number>(LEVELS.map((l, i) => [l, i]));
  return items.sort((a, b) => (order.get(a.level) as number) - (order.get(b.level) as number));
}

/** The context an item runs with. */
export function contextFor(
  item: BankItem,
  seed: number,
  root: string,
  impl: Partial<VariablesImpl>,
  implModule?: string,
): ItemContext {
  return {
    seed,
    impl,
    root,
    id: item.id,
    rng: itemRng(seed, item.id),
    ...(implModule ? { implModule } : {}),
  };
}

/** Runs one item on one seed. Anything the item throws is a failing outcome with its message. */
export async function runItem(
  item: BankItem,
  seed: number,
  root: string,
  impl: Partial<VariablesImpl>,
  implModule?: string,
): Promise<ItemOutcome> {
  try {
    return await item.check(contextFor(item, seed, root, impl, implModule));
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return { pass: false, detail: `the item threw ${error.name}: ${error.message}` };
  }
}

/** The outcome of every item on one seed. */
export type BankRun = Map<string, ItemOutcome & { ms?: number }>;

/** Runs the items on one seed in this process (no protection against an endless loop: for tests). */
export async function runInProcess(
  items: readonly BankItem[],
  seed: number,
  root: string,
  impl: Partial<VariablesImpl>,
  implModule?: string,
): Promise<BankRun> {
  const out: BankRun = new Map();
  for (const item of items) {
    const began = performance.now();
    const outcome = await runItem(item, seed, root, impl, implModule);
    out.set(item.id, { ...outcome, ms: Math.round(performance.now() - began) });
  }
  return out;
}

/** The measure of one level from a seed's run: passing over the level's items, the failing ones named. */
export function levelMeasure(items: readonly BankItem[], run: BankRun): Measure {
  return bankMeasure(
    items.map((item) => {
      const outcome = run.get(item.id) ?? { pass: false, detail: 'the item was not run' };
      return {
        id: item.id,
        component: item.component,
        family: item.family,
        tier: item.tier,
        cause: item.cause,
        pass: outcome.pass,
        ...(outcome.pass ? {} : { detail: `[${item.family}, tier ${item.tier}] ${outcome.detail}` }),
      };
    }),
    'packages/validators/src/ladders/variables/adapter.ts',
  );
}

export type { Item };

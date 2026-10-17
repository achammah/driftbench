import type { Tier } from '../../ladder';
import type { BlocksProduct } from './product';

/**
 * The item bank of the blocks validator (docs/validators.md section 13). An item is one capability of the
 * block redesign written as code: an id, a family, a tier from 1 (basic) to 5 (hardest), the level it belongs
 * to, the one component it points at, and a check that builds its input from the seed (a spec, a scripted
 * agent, run records, a change) and compares what the product answers with an oracle known by construction.
 * The check reaches the product only through `BlocksProduct`, so a test can hand it a cheating product.
 */

export type { Tier };

export type ItemContext = {
  seed: number;
  /** The repository root. */
  root: string;
  /** A folder of this run, removed at the end; items that write files write under it. */
  scratch: string;
  product: BlocksProduct;
};

export type ItemResult = { pass: true } | { pass: false; detail: string };

export type BankItem = {
  id: string;
  family: string;
  tier: Tier;
  /** The ladder level whose sub-bank holds the item, from 1. */
  level: number;
  /** The one component a failure points at. */
  component: string;
  /** What the item asks for, in one sentence. */
  title: string;
  /** The one change that would make the item pass; items one change turns green share it word for word. */
  cause: string;
  check(ctx: ItemContext): Promise<ItemResult>;
};

export const PASS: ItemResult = { pass: true };

export function fail(detail: string): ItemResult {
  return { pass: false, detail };
}

/** Passes when every condition holds, else fails naming the first that does not. */
export function expectAll(conditions: ReadonlyArray<readonly [boolean, string]>): ItemResult {
  const first = conditions.find(([holds]) => !holds);
  return first ? fail(first[1]) : PASS;
}

/** The levels of the blocks bank: one per capability of the redesign, in the order the redesign builds them. */
export const BANK_LEVELS = [
  { level: 1, id: 'verdicts', name: 'verdicts: pass, fail, not_run and blocked, and the Given they read' },
  { level: 2, id: 'parents', name: 'parents: blocked propagation, the cause counted once' },
  { level: 3, id: 'rule-objects', name: 'rule files and objects: resolve and override refusals' },
  { level: 4, id: 'value-checks', name: 'value checks: ask the tool what a value means' },
  { level: 5, id: 'diagnostics', name: 'diagnostics: blame and the fix list' },
  { level: 6, id: 'section-links', name: 'section links and localization' },
  { level: 7, id: 'blast-radius', name: 'blast radius: zero misses, bounded over-selection' },
  { level: 8, id: 'personas', name: 'personas: one test played by different simulated users' },
  { level: 9, id: 'intervals', name: 'intervals: coverage of a planted true rate' },
] as const;

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BankEntry, bankMeasure, type Measure } from '../../ladder';
import { blastItems } from './levels/blast';
import { carryBankItems } from './levels/carry';
import { codeItems } from './levels/code';
import { comboItems } from './levels/combos';
import { diagnosticItems } from './levels/diagnostics';
import { forestItems } from './levels/forest';
import { historyItems } from './levels/history';
import { intervalItems } from './levels/intervals';
import { linkItems } from './levels/links';
import { objectItems } from './levels/objects';
import { parentItems } from './levels/parents';
import { personaItems } from './levels/personas';
import { valueItems } from './levels/values';
import { verdictItems } from './levels/verdicts';
import type { BlocksProduct } from './product';
import { BANK_LEVELS, type BankItem, type ItemResult } from './types';

/** Section 12.1: the bank at merge holds at least this many items, no family under the second number. */
export const MIN_BANK = 300;
export const MIN_FAMILY = 20;

/** Every item of the blocks bank, in level order. Generated: no item is written twice. */
export function blocksBank(): BankItem[] {
  const items = [
    ...verdictItems(),
    ...codeItems(),
    ...carryBankItems(),
    ...comboItems(),
    ...forestItems(),
    ...historyItems(),
    ...intervalItems(),
    ...objectItems(),
    ...valueItems(),
    ...diagnosticItems(),
    ...parentItems(),
    ...linkItems(),
    ...blastItems(),
    ...personaItems(),
  ];
  return items.sort((a, b) => a.level - b.level);
}

/** The shape rules of section 12.1, as problems: unique ids, sizes, causes, every tier, every level. */
export function bankProblems(items: readonly BankItem[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push(`the id ${item.id} appears twice`);
    ids.add(item.id);
    if (item.cause.trim() === '') problems.push(`the item ${item.id} names no cause`);
  }
  if (items.length < MIN_BANK) problems.push(`the bank holds ${items.length} items, under ${MIN_BANK}`);
  const families = new Map<string, number>();
  for (const item of items) families.set(item.family, (families.get(item.family) ?? 0) + 1);
  for (const [family, count] of families)
    if (count < MIN_FAMILY) problems.push(`the family ${family} holds ${count} items, under ${MIN_FAMILY}`);
  for (const item of items)
    if (!Number.isInteger(item.tier) || item.tier < 1 || item.tier > 5)
      problems.push(`the item ${item.id} has tier ${item.tier}; a tier is 1 to 5`);
  for (const tier of [1, 2, 3, 4, 5])
    if (!items.some((item) => item.tier === tier)) problems.push(`no item of tier ${tier}`);
  for (const level of BANK_LEVELS)
    if (!items.some((item) => item.level === level.level)) problems.push(`level ${level.id} holds no item`);
  return problems;
}

/**
 * The seed an item sees: the visible seeds as they are, the hidden seed (about 10 to the 9) folded into 1000 to
 * 9999, still one value per commit, so an item that sizes its input from the seed stays bounded.
 */
export function itemSeed(seed: number): number {
  return seed > 1000 ? 1000 + (seed % 9000) : seed;
}

/** Runs one item: a throw is a failure that names the error. */
export async function runItem(
  item: BankItem,
  seed: number,
  root: string,
  scratch: string,
  product: BlocksProduct,
): Promise<ItemResult> {
  try {
    return await item.check({ seed: itemSeed(seed), root, scratch, product });
  } catch (cause) {
    return {
      pass: false,
      detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 600),
    };
  }
}

/**
 * A level's measure: every item of the level run on this seed. A failing item's detail says what the item asks
 * for and what it found: "asks: <capability>. found: <what came back>".
 */
export async function levelMeasure(
  items: readonly BankItem[],
  seed: number,
  root: string,
  product: BlocksProduct,
): Promise<Measure> {
  const scratch = mkdtempSync(join(tmpdir(), 'driftbench-blocks-bank-'));
  const hold = setInterval(() => undefined, 60_000);
  try {
    const entries: BankEntry[] = [];
    for (const item of items) {
      const result = await runItem(item, seed, root, scratch, product);
      entries.push({
        id: item.id,
        component: item.component,
        family: item.family,
        tier: item.tier,
        cause: item.cause,
        pass: result.pass,
        ...(result.pass
          ? {}
          : { detail: `asks: ${item.title}. found: ${result.detail}. Fix: ${item.cause}` }),
      });
    }
    return bankMeasure(entries, 'blocks');
  } finally {
    clearInterval(hold);
    rmSync(scratch, { recursive: true, force: true });
  }
}

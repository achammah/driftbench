import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BankEntry, bankMeasure, type Measure } from '../../ladder';
import { breakerItems } from '../blocks-breaker/index';
import { growthChecksItems } from '../blocks-growth/checks/index';
import { growthRunItems } from '../blocks-growth/run/index';
import { CONTRACTS } from './contracts';
import { releaseAgents } from './kinds';
import { adversarialItems } from './levels/adversarial';
import { blastItems } from './levels/blast';
import { boundaryItems } from './levels/boundaries';
import { carryBankItems } from './levels/carry';
import { codeItems } from './levels/code';
import { comboItems } from './levels/combos';
import { crossItems } from './levels/cross';
import { diagnosticItems } from './levels/diagnostics';
import { EVIDENCE_CONTRACTS, evidenceItems } from './levels/evidence';
import { forestItems } from './levels/forest';
import { historyItems } from './levels/history';
import { hostileItems } from './levels/hostile';
import { intervalItems } from './levels/intervals';
import { linkItems } from './levels/links';
import { objectItems } from './levels/objects';
import { parentItems } from './levels/parents';
import { personaItems } from './levels/personas';
import { scaleItems } from './levels/scale';
import { twinItems } from './levels/twins';
import { valueItems } from './levels/values';
import { verdictItems } from './levels/verdicts';
import type { BlocksProduct } from './product';
import { retag } from './retag';
import { BANK_LEVELS, type BankItem, type ItemResult, thrownText } from './types';

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
    ...boundaryItems(),
    ...adversarialItems(),
    ...scaleItems(),
    ...twinItems(),
    ...hostileItems(),
    ...crossItems(),
    ...historyItems(),
    ...intervalItems(),
    ...objectItems(),
    ...valueItems(),
    ...diagnosticItems(),
    ...evidenceItems(),
    ...parentItems(),
    ...linkItems(),
    ...blastItems(),
    ...personaItems(),
    ...breakerItems(),
    ...growthChecksItems(),
    ...growthRunItems(),
  ];
  return items
    .map((item) => {
      const contract = CONTRACTS[item.cause] ?? EVIDENCE_CONTRACTS[item.cause];
      return { ...item, cause: retag(item.cause), ...(contract ? { contract } : {}) };
    })
    .map((item) =>
      CATCH.test(item.id) && !HARDNESS.test(item.id) ? { ...item, role: 'catch' as const } : item,
    )
    .sort((a, b) => a.level - b.level);
}

/**
 * The catch items (owner ruling, 2026-10-17): they pass where their capability is built and guard against a
 * planted bug (boundaries), a cheat channel (twins), a shortcut (the F6 adversarial items) or a slow product (the
 * F5 scale items). They count for no hardness. The scale items that fail on a real defect of main stay hardness.
 */
const CATCH = /^(boundaries\/|twins\/|adv\.|scale\/)/;
const HARDNESS = /^(scale\/(run-F|run-T|pii-scan)\/100x|adv\.radius\.change-no-block-declares)$/;

/** The shape rules of section 12.1, as problems: unique ids, sizes, causes, every tier, every level. */
export function bankProblems(items: readonly BankItem[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push(`the id ${item.id} appears twice`);
    ids.add(item.id);
    if (item.cause.trim() === '') problems.push(`the item ${item.id} names no cause`);
    if (!item.contract) problems.push(`the item ${item.id} cites no contract: add its cause to contracts.ts`);
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
  // Each item works in a fresh folder of its own, so no item sees another's specs, stores or files.
  const own = mkdtempSync(join(tmpdir(), 'dbi-'));
  void scratch;
  try {
    return await item.check({ seed: itemSeed(seed), root, scratch: own, product });
  } catch (cause) {
    return { pass: false, detail: `the item threw: ${thrownText(cause)}` };
  } finally {
    releaseAgents();
    rmSync(own, { recursive: true, force: true });
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
        ...(item.role ? { role: item.role } : {}),
        ...(item.contract ? { contract: item.contract } : {}),
        pass: result.pass,
        ...(result.pass
          ? {}
          : {
              detail: `asks: ${item.title}. found: ${result.detail}. Contract: ${item.contract ?? 'none'}. Fix: ${item.cause}`,
            }),
      });
    }
    return bankMeasure(entries, 'blocks');
  } finally {
    clearInterval(hold);
    rmSync(scratch, { recursive: true, force: true });
  }
}

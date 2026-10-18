import { BANK_MIN_FAMILY, BANK_MIN_SIZE } from '../../../hardness';
import type { Ladder } from '../../../ladder';
import { resolveSut } from '../sut/adapter';
import type { PointerSut } from '../sut/port';
import { adversarialRuns } from './families/adversarial';
import { cuttingRuns } from './families/cutting';
import { groupingRuns } from './families/grouping';
import { idsRuns } from './families/ids';
import { labelsRuns } from './families/labels';
import { linksRuns } from './families/links';
import { privacyRuns } from './families/privacy';
import { radiusRuns } from './families/radius';
import { reanchoringRuns } from './families/reanchoring';
import { replayRuns } from './families/replay';
import { scaleRuns } from './families/scale';
import { bankLadder } from './ladder';
import { FAMILIES } from './specs/index';
import { fail, levelOf, type PointerItem, type Run } from './types';

const RUNNERS: Record<string, Record<string, Run>> = {
  adversarial: adversarialRuns,
  cutting: cuttingRuns,
  grouping: groupingRuns,
  ids: idsRuns,
  labels: labelsRuns,
  links: linksRuns,
  privacy: privacyRuns,
  radius: radiusRuns,
  replay: replayRuns,
  scale: scaleRuns,
  're-anchoring': reanchoringRuns,
};

/** The items of the bank: every spec row zipped with its runner. A row with no runner fails with a message that says so. */
export function pointerBank(): PointerItem[] {
  const items: PointerItem[] = [];
  for (const family of FAMILIES) {
    const runners = RUNNERS[family.id] ?? {};
    for (const spec of family.specs) {
      const run: Run =
        runners[spec.key] ?? (async () => fail(`the item ${family.id}.${spec.key} has no runner yet`));
      items.push({
        id: `${family.id}.${spec.key}`,
        family: family.id,
        tier: spec.tier,
        level: levelOf(family.level),
        component: spec.component ?? family.component,
        title: spec.title,
        cause: spec.cause,
        ...(spec.causeKind !== undefined ? { causeKind: spec.causeKind } : {}),
        gen: spec.gen,
        oracle: spec.oracle,
        needs: spec.needs ?? family.needs,
        seedFree: spec.seedFree === true,
        run,
      });
    }
  }
  return items;
}

/** The spec rows that have no runner, as `<family>.<key>`; the tests require none. */
export function missingRunners(): string[] {
  const missing: string[] = [];
  for (const family of FAMILIES) {
    for (const spec of family.specs) {
      if (!RUNNERS[family.id]?.[spec.key]) missing.push(`${family.id}.${spec.key}`);
    }
  }
  const known = new Set(FAMILIES.flatMap((f) => f.specs.map((s) => `${f.id}.${s.key}`)));
  for (const [familyId, runners] of Object.entries(RUNNERS)) {
    for (const key of Object.keys(runners)) {
      if (!known.has(`${familyId}.${key}`)) missing.push(`${familyId}.${key} (runner without a row)`);
    }
  }
  return missing;
}

/** The pointer validator under the hardness contract: the bank as a ladder of nine levels. */
export function pointerBankLadder(resolve: () => Promise<PointerSut> = resolveSut): Ladder {
  return bankLadder(pointerBank(), resolve);
}

/** The bank's shape against section 12.1: at least 300 items, no family under 20, every tier, unique ids. */
export function bankShape(items: readonly PointerItem[]): string[] {
  const problems: string[] = [];
  if (items.length < BANK_MIN_SIZE)
    problems.push(`the bank holds ${items.length} items, under ${BANK_MIN_SIZE}`);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push(`the id ${item.id} is used twice`);
    ids.add(item.id);
  }
  const families = new Map<string, number>();
  for (const item of items) families.set(item.family, (families.get(item.family) ?? 0) + 1);
  for (const [family, count] of families) {
    if (count < BANK_MIN_FAMILY)
      problems.push(`the family ${family} holds ${count} items, under ${BANK_MIN_FAMILY}`);
  }
  for (const tier of [1, 2, 3, 4, 5]) {
    if (!items.some((item) => item.tier === tier)) problems.push(`no item of tier ${tier}`);
  }
  return problems;
}

/** Items per family and tier, as the journal's bankByFamilyTier records them. */
export function bankByFamilyTier(items: readonly PointerItem[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const item of items) {
    const tiers = out[item.family] ?? {};
    tiers[String(item.tier)] = (tiers[String(item.tier)] ?? 0) + 1;
    out[item.family] = tiers;
  }
  return out;
}

/** Declared atomic cause tags among failing items; composite checks add no independently fixable claim. */
export function distinctCauses(items: readonly PointerItem[], failing: Iterable<string>): string[] {
  const ids = new Set(failing);
  return [
    ...new Set(
      items.filter((item) => ids.has(item.id) && item.causeKind !== 'composite').map((item) => item.cause),
    ),
  ].sort();
}

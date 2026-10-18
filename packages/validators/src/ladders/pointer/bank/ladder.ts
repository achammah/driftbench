import { type BankEntry, bankMeasure, defineLadder, type Ladder } from '../../../ladder';
import type { PointerSut } from '../sut/port';
import { runItem } from './run';
import { LEVELS, type PointerItem } from './types';

/** The ladder version of the bank (docs/validators.md section 12.5). */
export const POINTER_LADDER_VERSION = 1;

/**
 * The ladder of a bank: one level per entry of LEVELS, each the sub-bank of its items with threshold 1. Each level
 * returns its whole bank (`bankMeasure`), so `--items` lists every item with its family and tier, and the value
 * is the share of the level's items that pass on the seed. The run stops at the first failing level.
 */
export function bankLadder(items: readonly PointerItem[], resolve: () => Promise<PointerSut>): Ladder {
  return defineLadder({
    component: 'pointer',
    version: POINTER_LADDER_VERSION,
    levels: LEVELS.map((level, index) => {
      const own = items.filter((item) => item.level === index + 1);
      return {
        id: level.id,
        name: level.name,
        metric: `items passing / items of the level (${own.length}): ${level.what}`,
        threshold: 1,
        compute: async ({ seed }) => {
          const sut = await resolve();
          const entries: BankEntry[] = [];
          for (const item of own) {
            const outcome = await runItem(item, seed, sut);
            entries.push({
              id: item.id,
              component: item.component,
              family: item.family,
              tier: item.tier,
              cause: item.cause,
              ...(item.causeKind !== undefined ? { causeKind: item.causeKind } : {}),
              pass: outcome.pass,
              detail: `[${item.family}, tier ${item.tier}] ${item.title}: ${outcome.detail}. Fix: ${item.cause}`,
            });
          }
          return bankMeasure(entries, 'pointer');
        },
      };
    }),
  });
}

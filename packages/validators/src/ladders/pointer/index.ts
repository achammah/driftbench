import { type BankEntry, bankMeasure, defineLadder, type Ladder } from '../../ladder';
import type { PointerAdapter } from './bank';
import { pointerBank, runItem } from './bank';

/** Deliberately not globally registered: wiring a real adapter is separate, non-blind work. */
export function pointerLadder(adapter: PointerAdapter): Ladder {
  const items = pointerBank();
  return defineLadder({
    component: 'pointer',
    version: 1,
    levels: [1, 2, 3, 4, 5].map((level) => ({
      id: `pointer-${level}`,
      name:
        [
          'structural truth',
          'identity and context',
          'labels and composition',
          'replay and privacy',
          'hostility and scale',
        ][level - 1] ?? 'pointer',
      metric: 'items passing / items in level',
      threshold: 1,
      compute: async ({ seed }) => {
        const entries: BankEntry[] = [];
        for (const item of items.filter((candidate) => candidate.level === level)) {
          const result = await runItem(item, seed, adapter);
          entries.push({
            id: item.id,
            family: item.family,
            tier: item.tier,
            cause: item.cause,
            component: item.component,
            pass: result.pass,
            detail: `${item.title}: ${result.detail}. Fix: ${item.cause}`,
          });
        }
        return bankMeasure(entries, 'pointer');
      },
    })),
  });
}

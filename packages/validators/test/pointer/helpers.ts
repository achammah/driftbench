import { fileURLToPath } from 'node:url';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { PointerItem } from '../../src/ladders/pointer/bank/types';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';

export const REFERENCE_MODULE = fileURLToPath(new URL('./reference/index.ts', import.meta.url));

/** Every committed fixture uses the public wire format supported by both bindings. */
export const readerOnly = (_item: PointerItem): boolean => false;

/** The scale items too heavy for a unit test run; the light ones stay. */
const LIGHT_SCALE = new Set(['scale.cut-1x', 'scale.long-paragraph', 'scale.wide-table', 'scale.cut-10x']);
export const heavy = (item: PointerItem): boolean => item.family === 'scale' && !LIGHT_SCALE.has(item.id);

export type Tally = { pass: number; total: number; failed: Array<{ id: string; detail: string }> };

/** Runs the items against a reader, with the reference module named for the child processes. */
export async function tally(sut: PointerSut, pick: (item: PointerItem) => boolean, seed = 1): Promise<Tally> {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
  clearSeedFreeCache();
  try {
    const out: Tally = { pass: 0, total: 0, failed: [] };
    for (const item of pointerBank().filter(pick)) {
      out.total += 1;
      const result = await runItem(item, seed, sut);
      if (result.pass) out.pass += 1;
      else out.failed.push({ id: item.id, detail: result.detail.slice(0, 200) });
    }
    return out;
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}

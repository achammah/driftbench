import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import failedEmpty from './failed-empty';

it('credits zero items to a constant failed scan, including in children', async () => {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./failed-empty.ts', import.meta.url));
  clearSeedFreeCache();
  try {
    const passed: string[] = [];
    for (const item of pointerBank()) {
      if ((await runItem(item, 1, failedEmpty)).pass) passed.push(item.id);
    }
    expect(passed).toEqual([]);
  } finally {
    clearSeedFreeCache();
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}, 900_000);

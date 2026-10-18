import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import empty from './empty';

it('credits zero items to an empty reader, including in child processes', async () => {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./empty.ts', import.meta.url));
  clearSeedFreeCache();
  try {
    const passed: string[] = [];
    for (const item of pointerBank()) {
      if ((await runItem(item, 1, empty)).pass) passed.push(item.id);
    }
    // Even genuinely empty inputs need a companion positive control before earning credit.
    expect(passed).toEqual([]);
  } finally {
    clearSeedFreeCache();
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}, 900_000);

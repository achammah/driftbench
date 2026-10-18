import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import constant from './constant';

it('the constant cheat returns a nonempty answer and ignores different inputs', async () => {
  const sut: PointerSut = constant;
  const a = { path: 'first.md', text: 'First input.' };
  const b = { path: 'second.md', text: 'Second input. Another sentence.' };
  const cut = await sut.cut(a);
  expect(cut.units.length).toBeGreaterThan(0);
  expect(await sut.cut(b)).toEqual(cut);
  const scan = await sut.scan({ files: [a] });
  expect(scan.ok).toBe(true);
  expect(scan.ledger?.entries.length).toBeGreaterThan(0);
  expect(scan.atoms.length).toBeGreaterThan(0);
  expect(await sut.scan({ files: [b] })).toEqual(scan);
});

it('credits zero items to a constant nonempty reader, including in child processes', async () => {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./constant.ts', import.meta.url));
  clearSeedFreeCache();
  try {
    const passed: string[] = [];
    for (const item of pointerBank()) {
      if ((await runItem(item, 1, constant)).pass) passed.push(item.id);
    }
    expect(passed).toEqual([]);
  } finally {
    clearSeedFreeCache();
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}, 900_000);

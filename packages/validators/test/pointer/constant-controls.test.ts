import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import constant from './constant';
import { referenceSut } from './reference';

const ids = [
  'cutting.html-nested-depth',
  'grouping.atom-flags',
  'labels.anchoring-independent-of-labeler',
  'labels.set-hash-ignores-yaml-formatting',
  'adversarial.deep-nested-quotes',
];
const reference = referenceSut();
const child = (module: string) => fileURLToPath(new URL(module, import.meta.url));

for (const id of ids) {
  it(`${id}: requires source-specific output before crediting the property`, async () => {
    const item = pointerBank().find((entry) => entry.id === id);
    if (!item) throw new Error(`missing item ${id}`);
    const before = process.env.DRIFTBENCH_POINTER_SUT;
    try {
      clearSeedFreeCache();
      process.env.DRIFTBENCH_POINTER_SUT = child('./reference/index.ts');
      expect(await runItem(item, 1, reference)).toMatchObject({ pass: true });
      clearSeedFreeCache();
      process.env.DRIFTBENCH_POINTER_SUT = child('./constant.ts');
      const outcome = await runItem(item, 1, constant);
      expect(outcome).toMatchObject({ pass: false });
      expect(outcome.detail).toContain('positive witness');
    } finally {
      clearSeedFreeCache();
      if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
      else process.env.DRIFTBENCH_POINTER_SUT = before;
    }
  }, 60_000);
}

it('deep quotes reject a constant child even when the parent positive control succeeds', async () => {
  const item = pointerBank().find((entry) => entry.id === 'adversarial.deep-nested-quotes');
  if (!item) throw new Error('missing deep quote item');
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  try {
    clearSeedFreeCache();
    process.env.DRIFTBENCH_POINTER_SUT = child('./constant.ts');
    const outcome = await runItem(item, 1, reference);
    expect(outcome).toMatchObject({ pass: false });
    expect(outcome.detail).toContain('positive witness');
  } finally {
    clearSeedFreeCache();
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}, 60_000);

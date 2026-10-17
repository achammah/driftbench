import { describe, expect, it, vi } from 'vitest';
import { scaleItems } from '../../src/ladders/system/bank/scale';
import type { ItemResult } from '../../src/ladders/system/bank/types';

/**
 * The growth items of the subjects whose size is not a history (lint-blocks among them): their verdict reads
 * the best CPU time of many interleaved runs at ten and a hundred times the size. The lint of a spec is made
 * slower here on purpose, by spending CPU time in it, so the test says what the measure sees.
 */

/** The extra CPU time the next lint calls spend, by the number of blocks of the spec. */
const plant = vi.hoisted(() => ({
  extra: (_blocks: number, _call: number): number => 0,
  calls: 0,
}));

vi.mock('@agent-nexus/driftbench-core', async (original) => {
  const actual = await original<typeof import('@agent-nexus/driftbench-core')>();
  return {
    ...actual,
    lintSpec: (spec: Parameters<typeof actual.lintSpec>[0]) => {
      plant.calls += 1;
      const extra = plant.extra(spec.blocks.length, plant.calls);
      const used = () => {
        const now = process.cpuUsage();
        return (now.user + now.system) / 1000;
      };
      const end = used() + extra;
      let spent = 0;
      while (used() < end) for (let index = 0; index < 1000; index += 1) spent += Math.sqrt(index);
      return spent < 0 ? [] : actual.lintSpec(spec);
    },
  };
});

const lint = (suffix: string) => {
  const item = scaleItems().find((entry) => entry.id === `scale/lint-blocks/${suffix}`);
  if (!item) throw new Error(`no item scale/lint-blocks/${suffix}`);
  return item;
};
const context = (seed: number) => ({ seed, root: '.', scratch: '.' });

/** The four lint-blocks items in bank order, as the ladder runs them. */
async function runLintItems(seed: number): Promise<Record<string, ItemResult>> {
  plant.calls = 0;
  const out: Record<string, ItemResult> = {};
  for (const suffix of ['x1', 'x10', 'x100', 'growth']) out[suffix] = await lint(suffix).check(context(seed));
  return out;
}

describe('the growth items of the subjects that are not a history', () => {
  it('pass a linear lint whose first two runs at a hundred times the size are slowed by the machine', async () => {
    // Two slow runs at 6000 blocks, as a loaded machine gives: one sample per size sees 26 times and more.
    let slowed = 0;
    plant.extra = (blocks) => {
      if (blocks < 6000 || slowed >= 2) return 0;
      slowed += 1;
      return 60;
    };
    const results = await runLintItems(2);
    expect(slowed).toBe(2);
    expect(Object.values(results).map((result) => result.pass)).toEqual([true, true, true, true]);
  }, 120_000);

  it('fail a quadratic lint, however many rounds are timed', async () => {
    // 2 ms more at 600 blocks and 200 ms more at 6000: the extra cost is a hundred times for ten times the size.
    plant.extra = (blocks) => 2 * (blocks / 600) ** 2;
    const results = await runLintItems(3);
    const growth = results.growth as ItemResult;
    expect(growth.pass).toBe(false);
    expect(growth.pass ? '' : growth.detail).toMatch(/times/);
  }, 600_000);
});

describe('the bank items', () => {
  it('give every growth item that is not a history the best-of-rounds measure, with the same bound', () => {
    const others = scaleItems().filter(
      (entry) =>
        entry.id.endsWith('/growth') &&
        entry.id !== 'scale/flow-blocks/growth' &&
        entry.id !== 'scale/flow-blocks-teacher-forced/growth',
    );
    expect(others).toHaveLength(17);
    for (const item of others) {
      expect(item.title).toMatch(/best CPU time of 6 to 18 interleaved rounds grows at most 25 times$/);
      expect(item.tier).toBe(5);
      expect(item.level).toBe(11);
    }
  });
});

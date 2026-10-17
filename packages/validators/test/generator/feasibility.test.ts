import { type LoadedSpec, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, generatedCells, runAll } from '../../src/ladders/generator/measure';

const hidden = hiddenSpec(2);
const item = bankItems().find((entry) => entry.id === 'diff.feasible.graph');
if (!item) throw new Error('no graph feasibility item');

function generated(cell: Record<string, string>, own: Record<string, string> = {}): Generation {
  const spec = Spec.parse({
    id: 'cell-probe',
    kind: 'conversation',
    blocks: [{ id: 'block', when: { user: 'Hello.' }, expect: { stage: hidden.next[hidden.start] } }],
    metadata: {
      generated: { seeder: 'graph', cell, blocks: [{ block: 'block', cell: own }] },
    },
  });
  const loaded: LoadedSpec = { ok: true, path: 'specs/graph/cell-probe.yaml', spec, hash: '', warnings: [] };
  return {
    hidden,
    generatorSeed: 1,
    first: new Map(),
    second: new Map(),
    loaded: [loaded],
    complete: [loaded],
  };
}

function dataFor(value: Generation, follower?: () => never): SeedData {
  const data = new SeedData(
    1,
    { cheaters: [], faults: () => [], k: 1, ...(follower ? { follower } : {}) },
    async () => {
      throw new Error('feasibility must not measure scale');
    },
  );
  vi.spyOn(data, 'generated').mockResolvedValue(value);
  return data;
}

describe('differential feasibility', () => {
  it.each(['graph', 'twise', 'boundary', 'deviation', 'metamorphic'])(
    'reads %s cells without running a follower, cheater or fault',
    async (seeder) => {
      const follower = vi.fn((): never => {
        throw new Error('feasibility must not run agents');
      });
      const value = generated({ channel: 'web', user_type: 'staff' });
      const metadata = value.complete[0]?.spec.metadata?.generated as { seeder: string };
      metadata.seeder = seeder;
      const data = dataFor(value, follower);
      const runs = vi.spyOn(data, 'runs').mockRejectedValue(new Error('feasibility must not run agents'));
      const own = bankItems().find((entry) => entry.id === `diff.feasible.${seeder}`);
      if (!own) throw new Error(`no ${seeder} feasibility item`);
      const result = await own.check(data);
      expect(result).toEqual({ pass: true, detail: '0 blocks sit in a cell a hidden constraint forbids: ' });
      expect(follower).not.toHaveBeenCalled();
      expect(runs).not.toHaveBeenCalled();
    },
  );

  const forbiddenCells: Array<{ cell: Record<string, string>; own: Record<string, string> }> = [
    { cell: { behaviour: 'B-001', channel: 'messaging' }, own: {} },
    { cell: { stage: hidden.start }, own: { deviation: 'D4_loose_confirmation' } },
    { cell: { deviation: 'D9_out_of_scope' }, own: { stage: hidden.final } },
  ];
  it.each(forbiddenCells)(
    'keeps the forbidden-cell verdict and block key for $cell and $own',
    async ({ cell, own }) => {
      const value = generated(cell, own);
      const runs = await runAll(value, { cheaters: [], faults: () => [], k: 1 });
      const reason = hidden.constraints.find((constraint) =>
        Object.entries(constraint.forbid).every(([axis, entry]) => runs.blocks[0]?.cell[axis] === entry),
      )?.reason;
      expect(reason).toBeDefined();
      expect(await item.check(dataFor(value))).toEqual({
        pass: false,
        detail: `1 blocks sit in a cell a hidden constraint forbids: cell-probe#block (${reason})`,
      });
    },
  );

  it('lets the block cell override the spec cell, including an allowed override', async () => {
    const value = generated({ channel: 'messaging', behaviour: 'B-001' }, { channel: 'web' });
    expect((await item.check(dataFor(value))).pass).toBe(true);
  });

  it('retains all blocks, key fallbacks, cell precedence and blockCell normalization', async () => {
    const value = generated({ channel: 'web', stage: 'inherited' });
    const loaded = value.complete[0];
    if (!loaded) throw new Error('no probe spec');
    loaded.spec.blocks = [{ when: { user: 'Hello.' } }, { id: '', when: { user: 'Hello again.' } }];
    const metadata = loaded.spec.metadata?.generated as { blocks: unknown[] };
    metadata.blocks = [{ block: '', cell: { stage: 'own', number: 42, spec: 'ignore', flag: true } }];
    const handWritten = structuredClone(loaded);
    handWritten.spec.id = 'hand-written';
    delete handWritten.spec.metadata;
    value.complete.push(handWritten);
    const expected = [
      { key: 'cell-probe#0', seeder: 'graph', cell: { channel: 'web', stage: 'inherited' } },
      { key: 'cell-probe#', seeder: 'graph', cell: { channel: 'web', stage: 'own', number: '42' } },
      { key: 'hand-written#0', seeder: 'hand-written', cell: {} },
      { key: 'hand-written#', seeder: 'hand-written', cell: {} },
    ];
    expect(generatedCells(value)).toEqual(expected);
    const runs = await runAll(value, { cheaters: [], faults: () => [], k: 1 });
    expect(runs.blocks.map(({ key, seeder, cell }) => ({ key, seeder, cell }))).toEqual(expected);
  });

  it('still rejects a forbidden cell on a block with no Then', async () => {
    const value = generated({ behaviour: 'B-001', channel: 'messaging' });
    const block = value.complete[0]?.spec.blocks[0];
    if (!block) throw new Error('no probe block');
    delete block.expect;
    expect(await item.check(dataFor(value))).toEqual({
      pass: false,
      detail:
        '1 blocks sit in a cell a hidden constraint forbids: cell-probe#block (B-001 applies only on web)',
    });
  });
});

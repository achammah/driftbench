import { describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';

type Meta = Record<string, unknown> & { atoms?: string[]; cell?: Record<string, string>; testType?: string };

async function verdict(run: pipeline.EstateRun) {
  const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run);
  try {
    return (await genAsksFamily().evaluate(1)).get('gen.asks.rows-give-specs');
  } finally {
    mock.mockRestore();
  }
}

/**
 * The run where the spec of one row (`row`) stands for it as an equivalent representative: the spec is filed under
 * another row, lists `row` in `equivalence.planRows`, and `edit` changes what it says about itself.
 */
async function represented(edit: (meta: Meta) => void = () => undefined) {
  const run = await pipeline.estateRun(1);
  const specs = structuredClone(run.specs);
  const hasSituation = (id: string) =>
    Object.keys(run.plan.plan.rows.find((r) => r.id === id)?.cell ?? {}).some((k) => !k.startsWith('atoms.'));
  const target = specs.find((spec) => spec.record.complete && hasSituation(spec.record.row));
  if (!target?.loaded) throw new Error('no complete spec of a row with a situation');
  const row = run.plan.plan.rows.find((r) => r.id === target.record.row);
  const other = run.plan.plan.rows.find((r) => r.id !== row?.id && r.status === 'approved');
  if (!row || !other) throw new Error('no rows');
  target.record.row = other.id;
  const meta = (target.loaded.spec.metadata as { estate: Meta }).estate;
  meta.equivalence = { count: 2, planRows: [row.id] };
  edit(meta);
  return { run: { ...run, specs }, row };
}

describe('gen.asks.rows-give-specs', { timeout: 300_000 }, () => {
  it('holds on the generated estate', async () => {
    expect(await verdict(await pipeline.estateRun(1))).toEqual({ pass: true, detail: 'holds' });
  });

  it('is red when a row loses its spec and nothing stands for it', async () => {
    const { run } = await represented((meta) => {
      meta.equivalence = { count: 1, planRows: [] };
    });
    expect((await verdict(run))?.pass).toBe(false);
  });

  it('accepts a row that a representative lists and really covers', async () => {
    const { run } = await represented();
    expect(await verdict(run)).toEqual({ pass: true, detail: 'holds' });
  });

  it('rejects a representative that lists the row but leaves out one of its atoms', async () => {
    const { run, row } = await represented((meta) => {
      meta.atoms = (meta.atoms ?? []).filter((id) => id !== row0(meta));
    });
    expect(row.atomIds.length).toBeGreaterThan(0);
    expect((await verdict(run))?.pass).toBe(false);
  });

  it('rejects a representative of another test type, and one that holds other situation values', async () => {
    const wrongType = await represented((meta) => {
      meta.testType = 'forged_type';
    });
    expect((await verdict(wrongType.run))?.pass).toBe(false);
    const wrongCell = await represented((meta) => {
      const cell = { ...(meta.cell ?? {}) };
      const key = Object.keys(cell).find((k) => !k.startsWith('atoms.'));
      if (key) cell[key] = 'a-value-nobody-planned';
      meta.cell = cell;
    });
    expect((await verdict(wrongCell.run))?.pass).toBe(false);
  });
});

function row0(meta: Meta): string | undefined {
  return (meta.atoms ?? [])[0];
}

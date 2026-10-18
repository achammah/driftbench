import { describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';

type Loaded = {
  tags?: string[];
  blocks: Array<{ when?: { user?: string } }>;
  metadata?: { estate?: Record<string, unknown> };
};

const UNAPPROVED = 'Kindly sort out the pending supplier matters.';

/** The run of a seed with the first complete spec of a test type, asked with a bank phrase, changed by `edit`. */
async function changed(
  seed: number,
  testType: string,
  edit: (spec: Loaded) => void,
): Promise<pipeline.EstateRun> {
  const run = await pipeline.estateRun(seed);
  const specs = structuredClone(run.specs);
  const target = specs.find(
    (spec) =>
      spec.record.complete &&
      spec.record.testType === testType &&
      (spec.loaded?.spec.metadata?.estate as { ask?: string } | undefined)?.ask === 'bank',
  );
  if (!target?.loaded) throw new Error(`no complete ${testType} spec asked with a bank phrase`);
  edit(target.loaded.spec as unknown as Loaded);
  return { ...run, specs };
}

async function verdict(seed: number, run: pipeline.EstateRun) {
  const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run);
  try {
    return (await genAsksFamily().evaluate(seed)).get('gen.asks.asks-approved');
  } finally {
    mock.mockRestore();
  }
}

/** A generator that swaps an approved ask for an unapproved one and covers it up with metadata. */
const forge = (extra: Record<string, unknown>) => (spec: Loaded) => {
  if (spec.blocks[0]?.when) spec.blocks[0].when.user = UNAPPROVED;
  spec.tags = [...(spec.tags ?? []), 'ask:code'];
  if (spec.metadata?.estate)
    Object.assign(spec.metadata.estate, { ask: 'code', askFrom: 'a description', ...extra });
};

describe('gen.asks.asks-approved', { timeout: 300_000 }, () => {
  it('holds on the generated estate: approved phrases, and code-written asks that say so', async () => {
    for (const seed of [1, 4, 5])
      expect(await verdict(seed, await pipeline.estateRun(seed))).toEqual({ pass: true, detail: 'holds' });
  });

  it('fails an invented ask that does not say it was written by code', async () => {
    const run = await changed(1, 'route_positive', (spec) => {
      if (spec.blocks[0]?.when) spec.blocks[0].when.user = UNAPPROVED;
    });
    expect(await verdict(1, run)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('1 complete specs ask an unapproved phrase'),
    });
  });

  it('fails a code-written ask that names no source of its words', async () => {
    const run = await changed(1, 'route_positive', (spec) => {
      if (spec.blocks[0]?.when) spec.blocks[0].when.user = UNAPPROVED;
      spec.tags = [...(spec.tags ?? []), 'ask:code'];
      if (spec.metadata?.estate) spec.metadata.estate.ask = 'code';
    });
    expect((await verdict(1, run))?.pass).toBe(false);
  });

  it('fails a forged code-written ask whatever the generated spec says about its own situation', async () => {
    for (const seed of [1, 4, 5]) {
      const keeps = await changed(seed, 'route_positive', forge({}));
      expect((await verdict(seed, keeps))?.pass, `true situation, seed ${seed}`).toBe(false);
      const erased = await changed(seed, 'route_positive', forge({ situation: null }));
      expect((await verdict(seed, erased))?.pass, `erased situation, seed ${seed}`).toBe(false);
      const forged = await changed(seed, 'route_positive', forge({ situation: 'no-such-situation' }));
      expect((await verdict(seed, forged))?.pass, `forged situation, seed ${seed}`).toBe(false);
    }
  });

  /** A complete spec whose ask the generator wrote from the atoms because the bank is short: a true disclosure. */
  async function donorOf(seed: number) {
    const run = await pipeline.estateRun(seed);
    const donor = run.specs.find(
      (spec) =>
        spec.record.complete &&
        (spec.loaded?.spec.metadata?.estate as { ask?: string } | undefined)?.ask === 'code',
    );
    if (!donor) throw new Error('no complete spec with a code-written ask');
    return { run, row: donor.record.row };
  }

  it('fails a forged code-written ask that claims the plan row of a true disclosure', async () => {
    for (const seed of [1, 2]) {
      const { run, row } = await donorOf(seed);
      expect(await verdict(seed, run), `control, seed ${seed}`).toEqual({ pass: true, detail: 'holds' });
      const specs = structuredClone(run.specs);
      const target = specs.find(
        (spec) =>
          spec.record.complete &&
          spec.record.testType === 'route_positive' &&
          (spec.loaded?.spec.metadata?.estate as { ask?: string } | undefined)?.ask === 'bank',
      );
      if (!target?.loaded) throw new Error('no route_positive spec asked with a bank phrase');
      forge({})(target.loaded.spec as unknown as Loaded);
      // The generator reports another row than the one the spec says it is.
      target.record.row = row;
      expect((await verdict(seed, { ...run, specs }))?.pass, `row of a donor, seed ${seed}`).toBe(false);
    }
  });

  it('fails an extra cloned spec that carries an invented ask and the row of a true disclosure', async () => {
    for (const seed of [1, 2]) {
      const { run, row } = await donorOf(seed);
      const specs = structuredClone(run.specs);
      const source = specs.find(
        (spec) =>
          spec.record.complete &&
          spec.record.testType === 'route_positive' &&
          (spec.loaded?.spec.metadata?.estate as { ask?: string } | undefined)?.ask === 'bank',
      );
      if (!source?.loaded) throw new Error('no route_positive spec asked with a bank phrase');
      const clone = structuredClone(source);
      clone.record = { ...clone.record, id: `${clone.record.id}.clone`, row };
      forge({})(clone.loaded?.spec as unknown as Loaded);
      expect((await verdict(seed, { ...run, specs: [...specs, clone] }))?.pass, `clone, seed ${seed}`).toBe(
        false,
      );
    }
  });

  it('accepts a disclosed code-written ask for a live guard test only where the bank holds no approved forced phrase', async () => {
    const run = await pipeline.estateRun(1);
    const guarded = run.specs.filter(
      (spec) =>
        spec.record.complete && spec.record.testType === 'guard_positive' && spec.record.mode === 'live',
    );
    expect(guarded.length).toBeGreaterThan(0);
    // Control: the bank holds no forced situation, so the generator's own instructed asks pass.
    expect(await verdict(1, run)).toEqual({ pass: true, detail: 'holds' });
    // Planted: the bank holds an approved forced phrase for the guard of the row. The code-written ask must fail.
    const row = run.plan.plan.rows.find((r) => r.id === guarded[0]?.record.row);
    if (!row) throw new Error('no plan row');
    const withPhrase = {
      ...run,
      bank: {
        ...run.bank,
        situations: [
          ...run.bank.situations,
          {
            id: 'forced-planted',
            title: 'planted',
            use: 'forced' as const,
            atoms: row.atomIds,
            touches: { created: [], changed: [], deleted: [] },
            phrases: [{ text: 'Please push the branch with force.', lang: 'en', approved: true }],
          },
        ],
      },
    };
    expect((await verdict(1, withPhrase))?.pass).toBe(false);
    // Control: the same situation with no approved phrase leaves the bank short, and the code ask passes again.
    const unapproved = {
      ...withPhrase,
      bank: {
        ...withPhrase.bank,
        situations: withPhrase.bank.situations.map((s) =>
          s.id === 'forced-planted'
            ? { ...s, phrases: s.phrases.map((p) => ({ ...p, approved: false })) }
            : s,
        ),
      },
    };
    expect(await verdict(1, unapproved)).toEqual({ pass: true, detail: 'holds' });
  });
});

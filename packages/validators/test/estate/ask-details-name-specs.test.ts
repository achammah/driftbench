import { afterEach, describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';

vi.mock('../../src/ladders/estate/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/pipeline')>();
  return { ...actual, estateRun: vi.fn(actual.estateRun) };
});

type Spec = pipeline.EstateRun['specs'][number];
const UNAPPROVED = 'Zzq an unapproved phrase for the diagnostics test.';

/** Runs gen.asks on seed 1; `fault` changes the generated specs. */
async function run(fault?: (specs: Spec[]) => Spec[]) {
  const actual = await vi.importActual<typeof pipeline>('../../src/ladders/estate/pipeline');
  vi.mocked(pipeline.estateRun).mockImplementation(async (seed, profile) => {
    const base = await actual.estateRun(seed, profile);
    return fault ? { ...base, specs: fault([...base.specs]) } : base;
  });
  return genAsksFamily().evaluate(1);
}

/** The count a detail opens with, and how many specs it lists (` ("` opens each listed ask). */
const shape = (detail: string) => ({
  count: Number(/^(\d+) /.exec(detail)?.[1] ?? 0),
  listed: [...detail.matchAll(/ \("/g)].length,
});

describe('gen.asks failure details name the failing specs and their asks', { timeout: 300_000 }, () => {
  afterEach(() => vi.mocked(pipeline.estateRun).mockReset());

  it('asks-approved names each spec that asks an unapproved phrase, with the phrase', async () => {
    const before = (await run()).get('gen.asks.asks-approved');
    const changed: string[] = [];
    const out = await run((specs) =>
      specs.map((spec) => {
        const block = spec.loaded?.spec.blocks[0];
        if (changed.length >= 2 || !spec.record.complete || !spec.loaded || !block?.when) return spec;
        // Only a spec the unfaulted suite does not already list, so the count rises by exactly two.
        if (before?.detail.includes(spec.record.id)) return spec;
        changed.push(spec.record.id);
        const blocks = [
          { ...block, when: { ...block.when, user: UNAPPROVED } },
          ...spec.loaded.spec.blocks.slice(1),
        ];
        return { ...spec, loaded: { ...spec.loaded, spec: { ...spec.loaded.spec, blocks } } };
      }),
    );
    expect(changed).toHaveLength(2);
    const result = out.get('gen.asks.asks-approved');
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain('complete specs ask an unapproved phrase');
    for (const id of changed) expect(result?.detail).toContain(id);
    expect(result?.detail).toContain(UNAPPROVED);
    // The two changed specs add two to whatever count the unfaulted suite already has.
    expect(shape(result?.detail ?? '').count).toBe(shape(before?.detail ?? '').count + 2);
  });

  it('lists as many specs as the count it states (up to the listing cap) and keeps the verdict', async () => {
    const result = (await run()).get('gen.asks.asks-approved');
    const { count, listed } = shape(result?.detail ?? '');
    expect(result?.pass).toBe(count === 0);
    expect(listed).toBe(Math.min(count, 50));
  });
});

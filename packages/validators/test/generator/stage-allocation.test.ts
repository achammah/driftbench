import { contentHash, type LoadedSpec, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, generateFrom, runAll } from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing stage allocation fixture');
  return value;
}
function loaded(input: unknown): LoadedSpec {
  const parsed = validateSpec(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return {
    ok: true,
    warnings: [],
    path: 'specs/graph/enquiry.yaml',
    spec: parsed.spec,
    hash: contentHash(parsed.spec),
  };
}
function fixture(): Generation {
  const hidden = hiddenSpec(1);
  // Hand-written placement specimen, independent of bank strings and generated block labels.
  const spec = loaded({
    id: 'parcel-enquiry',
    kind: 'conversation',
    title: 'Check the parcel route',
    blocks: hidden.stages.slice(1).map((stage, index) => ({
      id: `checkpoint-${index}`,
      when: { user: `Continue to checkpoint ${index}.` },
      expect: { stage: stage.id },
    })),
    perturbations: [
      {
        id: 'depot-hours',
        class: 'D1_off_topic',
        inject_at: 0,
        user: 'Is the depot open on Sunday?',
        expect: { stage: hidden.start },
        recovery: { within_blocks: 0, stage_after: hidden.start },
      },
    ],
  });
  return { hidden, generatorSeed: 1, first: new Map(), second: new Map(), complete: [spec], loaded: [spec] };
}
async function check(generated: Generation, suffix = 'present') {
  return required(bankItems().find((item) => item.id === `allocation.stage.${suffix}`)).check({
    generated: async () => generated,
  } as SeedData);
}

describe('stage allocation shares the documented block and perturbation placement contract', () => {
  it('also counts declared deviation events under the same per-event contract', async () => {
    const generated = fixture();
    const spec = required(generated.complete[0]).spec;
    const first = required(spec.perturbations?.[0]);
    spec.perturbations = generated.hidden.deviations.map((cls) => ({
      ...structuredClone(first),
      id: cls,
      class: cls,
    }));
    for (const suffix of ['present', 'ratio', 'evenness', 'hill1']) {
      const item = required(bankItems().find((item) => item.id === `allocation.deviation.${suffix}`));
      expect(await item.check({ generated: async () => generated } as SeedData)).toMatchObject({
        pass: true,
      });
    }
  });
  it('counts the initial declared recovery alongside reached block stages', async () => {
    const generated = fixture();
    for (const name of ['present', 'ratio', 'evenness', 'hill1'])
      expect(await check(generated, name)).toMatchObject({ pass: true });
  });

  it('rejects a missing opening event, including forged placement metadata', async () => {
    const generated = fixture();
    const spec = required(generated.complete[0]).spec;
    delete spec.perturbations;
    spec.metadata = {
      generated: { cell: { stage: generated.hidden.start }, blocks: [{ stage: generated.hidden.start }] },
    };
    expect(await check(generated)).toMatchObject({ pass: false });
  });

  it('places a later perturbation on its actual arrival stage, not its claimed recovery destination', async () => {
    const generated = fixture();
    required(required(generated.complete[0]).spec.perturbations?.[0]).inject_at = 1;
    expect(await check(generated)).toMatchObject({ pass: false });
  });

  it('rejects a missing reached stage and keeps the skew thresholds unchanged', async () => {
    const generated = fixture();
    const spec = required(generated.complete[0]).spec;
    spec.blocks.pop();
    expect(await check(generated)).toMatchObject({ pass: false });
    const skewed = fixture();
    const other = required(skewed.complete[0]).spec;
    const initial = required(other.perturbations?.[0]);
    other.perturbations = Array.from({ length: 100 }, () => structuredClone(initial));
    expect(await check(skewed)).toMatchObject({ pass: true });
    for (const name of ['ratio', 'evenness', 'hill1'])
      expect(await check(skewed, name)).toMatchObject({ pass: false });
  });
});

describe('fresh seeds keep opening coverage and cheater resistance separate', () => {
  for (const seed of [1009, 2027, 4093, 8191]) {
    it(`seed ${seed}: counts real declarations, rejects lost opening coverage and still catches an echo-passable stay`, async () => {
      const hidden = hiddenSpec(seed);
      const generated = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
      expect(await check(generated)).toMatchObject({ pass: true });
      const mutant = { ...generated, complete: structuredClone(generated.complete) };
      let removed = 0;
      for (const { spec } of mutant.complete) {
        const before = spec.perturbations?.length ?? 0;
        spec.perturbations = spec.perturbations?.filter((entry) => entry.inject_at !== 0);
        removed += before - (spec.perturbations?.length ?? 0);
      }
      expect(removed).toBeGreaterThan(0);
      expect(await check(mutant)).toMatchObject({ pass: false });

      const phrase = required(
        hidden.phrases.find(
          (entry) => entry.intent.kind === 'deviation' && entry.intent.class === 'D1_off_topic',
        ),
      );
      const weak = loaded({
        id: 'unearned-opening-stay',
        kind: 'conversation',
        stages: hidden.stages.map((stage) => stage.id),
        lang: 'EN',
        metadata: { generated: { seeder: 'graph' } },
        blocks: [
          {
            id: 'stay',
            when: { injection: { class: 'D1_off_topic', user: phrase.text } },
            expect: { stage: hidden.start, stage_reported: true, must: ['keep to your request'], lang: 'EN' },
          },
        ],
      });
      const probe: Generation = { ...generated, complete: [weak], loaded: [weak] };
      const runs = await runAll(probe, { faults: () => [], cheaters: ['echo'], k: 1 });
      expect(runs.errors).toEqual([]);
      expect(required(runs.blocks[0]).reference).toEqual(['pass']);
      expect(required(runs.blocks[0]).cheaters.echo?.outcome).toBe('pass');
      const item = required(bankItems().find((item) => item.id === 'cheater.echo.graph'));
      expect(await item.check({ runs: async () => runs } as SeedData)).toMatchObject({ pass: false });
    }, 300_000);
  }
});

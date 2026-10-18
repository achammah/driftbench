import { contentHash, type LoadedSpec, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bankItems, mapObligationSnapshot, removable, SeedData } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, type GeneratorParts, generateFrom } from '../../src/ladders/generator/measure';
import { matchesPhrase, phraseStimulus } from '../../src/ladders/generator/phrase-stimulus';
import { renderMap } from '../../src/ladders/generator/render';

const parts: GeneratorParts = {
  faults: (hidden) =>
    faultFamily(
      hidden,
      FAULT_CLASSES.filter((cls) => cls.id === 'X3.stay'),
    ).filter((fault) => fault.where === 'any' && fault.rate === 1),
  cheaters: ['constant', 'echo'],
  k: 1,
  baseline: () => [],
};
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing phrase obligation fixture');
  return value;
}
let generation: Promise<Generation> | undefined;
async function fixture() {
  generation ??= (() => {
    const hidden = hiddenSpec(1);
    return generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
  })();
  return structuredClone(await generation);
}
async function dataFor(generated: Generation) {
  const data = new SeedData(generated.hidden.seed, parts, async () => ({}) as never);
  await data.memoized('generated', async () => generated);
  return data;
}
async function phraseVerdict(data: SeedData) {
  return required(bankItems().find((item) => item.id === 'phrases.data-out')).check(data);
}
async function candidate(data: SeedData, key = 'gen-phrase-002#b3-value') {
  return required((await data.runs()).blocks.find((block) => block.key === key));
}

describe('minimality preserves the same map obligations as the coverage items', () => {
  it('seed 1 keeps gen-phrase-002#b3-value, the only approved request for its output phrase', async () => {
    const generated = await fixture();
    const data = await dataFor(generated);
    expect(await phraseVerdict(data)).toMatchObject({ pass: true });
    const block = await candidate(data);
    expect(block.reference).toEqual(['pass']);
    const reduced = structuredClone(generated);
    required(reduced.complete.find(({ spec }) => spec.id === block.spec)).spec.blocks.splice(block.index, 1);
    const after = await phraseVerdict(await dataFor(reduced));
    expect(after.pass, after.detail).toBe(false);
    expect(after.detail).toContain('11 of 12');
    expect(await removable(data, block)).toBe(false);
  }, 300_000);

  it('a true duplicate remains removable when another spec preserves every obligation', async () => {
    const generated = await fixture();
    const copy = structuredClone(
      required(generated.complete.find(({ spec }) => spec.id === 'gen-phrase-002')),
    );
    copy.spec.id = 'approved-phrase-duplicate';
    generated.complete.push(copy);
    generated.loaded.push(copy);
    const data = await dataFor(generated);
    expect(await phraseVerdict(data)).toMatchObject({ pass: true });
    expect(await removable(data, await candidate(data))).toBe(true);
  }, 300_000);

  it('preserves an individual phrase even when a different approved phrase is already missing', async () => {
    const generated = await fixture();
    const target = required(generated.complete.find(({ spec }) => spec.id === 'gen-phrase-002'));
    const targetBlock = required(target.spec.blocks[2]);
    const targetPhrase = required(
      generated.hidden.phrases.find((phrase) => matchesPhrase(phraseStimulus(targetBlock), phrase)),
    );
    const other = required(
      generated.hidden.phrases.find(
        (phrase) =>
          phrase.intent.kind === 'data' &&
          generated.hidden.data.some(
            (value) => value.id === (phrase.intent as { value: string }).value && value.direction === 'out',
          ) &&
          phrase.text !== targetPhrase.text,
      ),
    );
    for (const { spec } of generated.complete)
      spec.blocks = spec.blocks.filter((block) => !matchesPhrase(phraseStimulus(block), other));
    const data = await dataFor(generated);
    expect(await phraseVerdict(data)).toMatchObject({ pass: false });
    const before = await mapObligationSnapshot(data);
    expect([...before].some((key) => key.includes(targetPhrase.text))).toBe(true);
    const block = await candidate(data);
    expect(block.reference).toEqual(['pass']);
    expect(await removable(data, block)).toBe(false);
  }, 300_000);
});

function parcelFixture(): Generation {
  const hidden: HiddenSpec = {
    ...hiddenSpec(1237),
    stages: [{ id: 'dock', title: 'Parcel dock', question: 'Which parcel is on the dock?' }],
    start: 'dock',
    goal: 'dock',
    confirm: 'dock',
    final: 'dock',
    next: {},
    transitions: [
      { id: 'inspect', from: 'dock', to: 'dock', title: 'Inspect the parcel', rule: 'Stay at the dock.' },
    ],
    tools: [],
    data: [],
    uses: [],
    constraints: [],
    recoveries: [],
    behaviours: [],
    personas: [],
    flows: [{ id: 'parcel', title: 'Inspect a parcel', behaviours: [], deviations: [] }],
    paths: [{ id: 'parcel-dock', flow: 'parcel', stages: ['dock'], when: {}, quote: 'Inspect the parcel.' }],
    phrases: ['Inspect the copper parcel.', 'Inspect the silver parcel.'].map((text) => ({
      dimension: 'stage_transition',
      value: 'inspect',
      text,
      lang: 'en',
      intent: { kind: 'transition' as const, edge: 'inspect' },
    })),
  };
  const parsed = validateSpec({
    id: 'parcel-check',
    kind: 'conversation',
    stages: ['dock'],
    blocks: [
      {
        id: 'copper',
        when: { user: 'Inspect the copper parcel.' },
        expect: { stage: 'dock', stage_reported: true },
      },
      {
        id: 'aside',
        when: { user: 'The parcel is on a shelf.' },
        expect: { stage: 'dock', stage_reported: true },
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const entry: LoadedSpec = {
    ok: true,
    warnings: [],
    path: 'specs/graph/parcel-check.yaml',
    spec: parsed.spec,
    hash: contentHash(parsed.spec),
  };
  return {
    hidden,
    generatorSeed: hidden.seed,
    first: new Map(),
    second: new Map(),
    complete: [entry],
    loaded: [entry],
  };
}

describe('non-bank and fresh phrase obligations', () => {
  it('keeps a hand-written parcel phrase while another approved parcel phrase is already absent', async () => {
    const generated = parcelFixture();
    const data = await dataFor(generated);
    const transitions = required(bankItems().find((item) => item.id === 'phrases.transitions'));
    expect(await transitions.check(data)).toMatchObject({ pass: false });
    const block = await candidate(data, 'parcel-check#copper');
    expect(block.reference).toEqual(['pass']);
    expect(await removable(data, block)).toBe(false);
    const copy = structuredClone(required(generated.complete[0]));
    copy.spec.id = 'parcel-copy';
    generated.complete.push(copy);
    generated.loaded.push(copy);
    const duplicate = await dataFor(generated);
    expect(await transitions.check(duplicate)).toMatchObject({ pass: false });
    expect(await removable(duplicate, await candidate(duplicate, 'parcel-check#copper'))).toBe(true);
  }, 300_000);

  for (const seed of [1009, 2027, 4093, 8191]) {
    it(`fresh seed ${seed} keeps an approved output request and removes a true duplicate`, async () => {
      const hidden = hiddenSpec(seed);
      const generated = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
      const wanted = hidden.phrases.filter(
        (phrase) =>
          phrase.intent.kind === 'data' &&
          hidden.data.some(
            (value) => value.id === (phrase.intent as { value: string }).value && value.direction === 'out',
          ),
      );
      const source = required(
        generated.complete.find(
          ({ spec }) =>
            spec.blocks.length > 1 &&
            wanted.some((phrase) => matchesPhrase(phraseStimulus(required(spec.blocks.at(-1))), phrase)),
        ),
      );
      const index = source.spec.blocks.length - 1;
      const phrase = required(
        wanted.find((phrase) => matchesPhrase(phraseStimulus(required(source.spec.blocks[index])), phrase)),
      );
      expect(source.spec.blocks.filter((block) => matchesPhrase(phraseStimulus(block), phrase))).toHaveLength(
        1,
      );
      const key = `${source.spec.id}#${source.spec.blocks[index]?.id ?? index}`;
      const isolated = { ...generated, complete: [source], loaded: [source] };
      const data = await dataFor(isolated);
      const block = await candidate(data, key);
      expect(block.reference).toEqual(['pass']);
      expect(await removable(data, block)).toBe(false);
      const copy = structuredClone(source);
      copy.spec.id = 'output-request-copy';
      const duplicated = await dataFor({ ...generated, complete: [source, copy], loaded: [source, copy] });
      expect(await removable(duplicated, await candidate(duplicated, key))).toBe(true);
    }, 300_000);
  }
});

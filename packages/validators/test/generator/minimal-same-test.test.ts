import { describe, expect, it } from 'vitest';
import { SeedData, sameTestKey } from '../../src/ladders/generator/bank';
import { type BlockRun, givenOf, runAll } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

describe('two blocks are the same test when Given, stage, cell and Then are equal', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  const cover = required(generated.complete.find(({ spec }) => spec.id === 'gen-cover-004'));
  const copy = (id: string, change: (spec: typeof cover.spec) => void) => {
    const spec = structuredClone(cover.spec);
    spec.id = id;
    change(spec);
    return { ...cover, spec };
  };
  const relabelled = copy('relabelled', (spec) => {
    spec.channel = spec.channel === 'web' ? 'messaging' : 'web';
    spec.tags = spec.tags?.map((tag) => (tag.startsWith('persona:') ? 'persona:another' : tag));
  });
  const otherWorld = copy('other-world', (spec) => {
    const answer = spec.given?.world?.tools?.lookup_record;
    if (!answer) throw new Error('the fixture has no lookup answer');
    spec.given = {
      ...spec.given,
      world: { tools: { lookup_record: { result: { ...(answer.result as object), status: 'changed' } } } },
    };
  });
  const mini = { ...generated, complete: [cover, relabelled, otherWorld] };
  const runs = await runAll(mini, { faults: () => [], cheaters: [], k: 1 });
  const last = (id: string): BlockRun =>
    required(runs.blocks.filter((block) => block.spec === id && block.fields.length > 0).at(-1));

  it('is the same for a copy on another channel and for another persona', () => {
    expect(last('relabelled').given).toBe(last(cover.spec.id).given);
    expect(sameTestKey(last('relabelled'))).toBe(sameTestKey(last(cover.spec.id)));
  });

  it('is another test when a tool answers another value in the world the block runs in', () => {
    expect(last('other-world').given).not.toBe(last(cover.spec.id).given);
    expect(sameTestKey(last('other-world'))).not.toBe(sameTestKey(last(cover.spec.id)));
  });

  it('does not read the user wording', () => {
    const block = last(cover.spec.id);
    expect(sameTestKey({ ...block, when: 'another way of saying it' })).toBe(sameTestKey(block));
  });

  it('is another test when the stage it is said from, or its cell, differs', () => {
    const block = last(cover.spec.id);
    expect(givenOf(cover.spec, 1)).not.toBe(givenOf(cover.spec, 2));
    const other = structuredClone(cover.spec);
    const blocks = (
      other.metadata?.generated as { blocks?: Array<{ cell?: Record<string, string> }> } | undefined
    )?.blocks;
    const entry = blocks?.[other.blocks.length - 1];
    if (!entry?.cell) throw new Error('the block records no cell');
    entry.cell = { ...entry.cell, behaviour: 'another-value' };
    expect(givenOf(other, other.blocks.length - 1)).not.toBe(block.given);
  });
}, 600_000);

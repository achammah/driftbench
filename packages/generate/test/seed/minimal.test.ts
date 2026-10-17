import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { PathRelation } from '../../src/extract/proposal';
import { Allocation } from '../../src/seed/allocation';
import { renderDraft, type SpecDraft } from '../../src/seed/assemble';
import { TerminalSubsumption } from '../../src/seed/minimal';
import { type SeedContext, scenarioDraft } from '../../src/seed/seed-drafts';
import { fixture, lingering, split, twoChannels, twoPersonas, twoRoutes } from './desk';

const run = { seed: 1031, mapPath: '../desk.yaml' };

function walk(
  prepared: ReturnType<typeof fixture>,
  id: string,
  path: PathRelation,
  seeder: SpecDraft['seeder'] = 'twise',
  cell: Array<[number, number]> = [],
) {
  const context: SeedContext = { seed: 1031, t: 2, max: 100 };
  const built = scenarioDraft(prepared, context, id, seeder, id, cell, { preferred: [path], others: [] });
  if (!('draft' in built)) throw new Error(`${id} did not build`);
  if (cell.length > 0) built.draft.perturbations = undefined;
  return built.draft;
}

// The same walk with its first message worded another way: not a twin of any other walk, same end.
const reworded = (draft: ReturnType<typeof walk>) => {
  const first = draft.blocks[0];
  if (first?.stimulus.kind !== 'phrase') throw new Error('the first block says no phrase');
  first.stimulus = {
    ...first.stimulus,
    phrase: { ...first.stimulus.phrase, text: 'Hello, I have a parcel.' },
  };
  return draft;
};

// The same walk with its last message worded another way: it ends on a block no other walk ends on.
const endsElsewhere = (draft: ReturnType<typeof walk>) => {
  const last = draft.blocks.at(-1);
  if (last?.stimulus.kind !== 'phrase') throw new Error('the last block says no phrase');
  last.stimulus = { ...last.stimulus, phrase: { ...last.stimulus.phrase, text: 'Pack it now, thank you.' } };
  return draft;
};

describe('terminal subsumption', () => {
  it('drops the repeated end of a walk another written walk already says, and keeps the first walk whole', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = walk(prepared, 'second', path);
    const length = first.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks.length).toBeLessThan(length);
    expect(second.blocks.length).toBeGreaterThan(0);
    // The blocks that stay are the walk's own first moves.
    expect(second.blocks.map((block) => block.id)).toEqual(
      first.blocks.slice(0, second.blocks.length).map((block) => block.id),
    );
  });

  it('keeps a walk whose end is said by no written walk', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const only = walk(prepared, 'only', path);
    const length = only.blocks.length;
    minimal.reduce(only);
    expect(only.blocks).toHaveLength(length);
  });

  it('never reduces a walk that reaches an end state', () => {
    const prepared = fixture();
    const base = prepared.relations.paths[0];
    if (!base) throw new Error('missing parcel path');
    const path = { ...base, end_state: { source: 'tool:ship', mode: 'exact' as const, expect: {} } };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = walk(prepared, 'second', path);
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(first.blocks.length);
  });

  it('counts the tuples of every seeder: a walk another seeder covers is cut like any other', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'twise');
    const second = walk(prepared, 'second', path, 'boundary');
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks.length).toBeLessThan(length);
  });

  it("keeps a block that injects a class, which is that class's test and the deviation of its row", () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const context: SeedContext = { seed: 1031, t: 2, max: 100 };
    const probe = (id: string) => {
      const built = scenarioDraft(
        prepared,
        context,
        id,
        'twise',
        id,
        [],
        { preferred: [path], others: [] },
        { probe: { classId: 'D5_language_switch', stage: 'address' } },
      );
      if (!('draft' in built)) throw new Error(`${id} did not build`);
      return built.draft;
    };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = probe('first');
    const second = probe('second');
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    // The repeated blocks after the probe go; the block that injects the class never does.
    expect(second.blocks.length).toBeLessThan(length);
    expect(second.blocks.some((block) => block.injection)).toBe(true);
  });

  it('keeps the end of a walk that says another turn than any written block', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = walk(prepared, 'second', path);
    const last = second.blocks.at(-1);
    if (last?.stimulus.kind !== 'phrase') throw new Error('the last block says no phrase');
    last.stimulus = {
      ...last.stimulus,
      phrase: { ...last.stimulus.phrase, text: 'Pack it now, thank you.' },
    };
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(length);
  });

  it('keeps the end of a walk that places a tuple no written walk places', () => {
    const prepared = split();
    const send = prepared.relations.paths.find((path) => path.flow === 'send');
    const track = prepared.relations.paths.find((path) => path.flow === 'track');
    if (!send || !track) throw new Error('missing paths');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const long = walk(prepared, 'long', send);
    const short = walk(prepared, 'short', track);
    const length = short.blocks.length;
    minimal.reduce(long);
    minimal.reduce(short);
    // Its moves repeat the long walk's, but the tracking flow at the last stage is placed by this walk only.
    expect(short.blocks).toHaveLength(length);
  });
});

describe('terminal subsumption keeps walks apart', () => {
  it('never cuts a metamorphic variant, so a family differs only in its phrasing', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'metamorphic');
    const second = walk(prepared, 'second', path, 'metamorphic');
    const length = first.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
  });
});

describe('terminal subsumption and the perturbations a block carries', () => {
  const perturbedAt = (
    prepared: ReturnType<typeof fixture>,
    path: PathRelation,
    id: string,
    stage: string,
    classId = 'D5_language_switch',
  ) => {
    const context: SeedContext = { seed: 1031, t: 2, max: 100 };
    const built = scenarioDraft(
      prepared,
      context,
      id,
      'twise',
      id,
      [],
      { preferred: [path], others: [] },
      { perturb: { classId, stage } },
    );
    if (!('draft' in built)) throw new Error(`${id} did not build`);
    return built.draft;
  };

  it('keeps the block a declared perturbation names, even when another walk declares the same class there', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = perturbedAt(prepared, path, 'first', 'packing');
    const second = perturbedAt(prepared, path, 'second', 'packing');
    const length = first.blocks.length;
    expect(second.perturbations?.[0]?.inject_at).toBe(length - 1);
    minimal.reduce(first);
    minimal.reduce(second);
    // A perturbed run checks the recovery with the blocks around it: the walk is not cut below its declaration.
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
    for (const entry of second.perturbations ?? [])
      expect(entry.inject_at).toBeLessThan(second.blocks.length);
  });

  it('reads a block as the same test whatever perturbations its walk declares before it', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const plain = walk(prepared, 'plain', path);
    plain.perturbations = undefined;
    // The same walk declares a class at its second stage, well before its end: the end is the same test.
    const declared = perturbedAt(prepared, path, 'declared', 'address');
    const length = declared.blocks.length;
    expect(declared.perturbations?.[0]?.inject_at).toBeLessThan(length - 1);
    minimal.reduce(plain);
    minimal.reduce(declared);
    expect(plain.blocks).toHaveLength(length);
    expect(declared.blocks.length).toBeLessThan(length);
    for (const entry of declared.perturbations ?? [])
      expect(entry.inject_at).toBeLessThan(declared.blocks.length);
  });

  it('keeps the block when no other written walk places the class it declares', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const plain = walk(prepared, 'plain', path);
    plain.perturbations = undefined;
    const declared = perturbedAt(prepared, path, 'declared', 'packing');
    const length = declared.blocks.length;
    minimal.reduce(plain);
    minimal.reduce(declared);
    expect(declared.blocks).toHaveLength(length);
    expect(declared.perturbations).toHaveLength(1);
  });
});

describe('terminal subsumption and the context a walk is written in', () => {
  const channelPick = (prepared: ReturnType<typeof twoChannels>, value: string): [number, number] => {
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.kind === 'channel');
    const at = prepared.space.dimensions[dimension]?.index.get(value);
    if (at === undefined) throw new Error(`no channel ${value}`);
    return [dimension, at];
  };

  it('cuts the end of a walk another channel writes, once the path keeps a pair of whole walks per channel', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'twise', [channelPick(prepared, 'counter')]);
    const second = walk(prepared, 'second', path, 'twise', [channelPick(prepared, 'phone')]);
    const third = walk(prepared, 'third', path, 'twise', [channelPick(prepared, 'phone')]);
    const length = first.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    minimal.reduce(third);
    // The Then must hold across channels: the pair first/second stays whole. A third walk adds nothing.
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
    expect(third.blocks.length).toBeLessThan(length);
  });

  it('reads a block as the same test on any channel: the end a walk on the counter says is a repeat on the phone', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    // Only the counter walk says this end. The phone tuples are held by a phone walk that ends on another block,
    // so the phone walk below is a repeat of the counter walk's end and of nothing written on the phone.
    const written = walk(prepared, 'written', path, 'twise', [channelPick(prepared, 'counter')]);
    const holder = endsElsewhere(walk(prepared, 'holder', path, 'twise', [channelPick(prepared, 'phone')]));
    const again = reworded(walk(prepared, 'again', path, 'twise', [channelPick(prepared, 'phone')]));
    const length = again.blocks.length;
    for (const draft of [written, holder, again]) minimal.reduce(draft);
    expect(again.blocks.length).toBeLessThan(length);
  });

  it('keeps one pair of whole twins per path even when other walks already hold their tuples', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    // A reworded phone walk holds the phone tuples; then a counter walk and its phone twin arrive.
    const holder = reworded(walk(prepared, 'holder', path, 'twise', [channelPick(prepared, 'phone')]));
    const counter = walk(prepared, 'counter', path, 'twise', [channelPick(prepared, 'counter')]);
    const twin = walk(prepared, 'twin', path, 'twise', [channelPick(prepared, 'phone')]);
    const length = twin.blocks.length;
    for (const draft of [holder, counter, twin]) minimal.reduce(draft);
    expect(counter.blocks).toHaveLength(length);
    expect(twin.blocks).toHaveLength(length);
  });
});

describe('terminal subsumption and the persona a walk is written for', () => {
  const personaPick = (prepared: ReturnType<typeof twoPersonas>, value: string): [number, number] => {
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.kind === 'persona');
    const at = prepared.space.dimensions[dimension]?.index.get(value);
    if (at === undefined) throw new Error(`no persona ${value}`);
    return [dimension, at];
  };

  it('cuts the end of a third walk once the path keeps a pair of whole walks per persona', () => {
    const prepared = twoPersonas();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'twise', [personaPick(prepared, 'novice')]);
    const second = walk(prepared, 'second', path, 'twise', [personaPick(prepared, 'expert')]);
    const third = walk(prepared, 'third', path, 'twise', [personaPick(prepared, 'expert')]);
    const length = first.blocks.length;
    for (const draft of [first, second, third]) minimal.reduce(draft);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
    expect(third.blocks.length).toBeLessThan(length);
  });

  it('keeps one pair of whole twins per path even when other walks already hold their tuples', () => {
    const prepared = twoPersonas();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    // A reworded expert walk holds the expert tuples; then a novice walk and its expert twin arrive.
    const holder = reworded(walk(prepared, 'holder', path, 'twise', [personaPick(prepared, 'expert')]));
    const novice = walk(prepared, 'novice', path, 'twise', [personaPick(prepared, 'novice')]);
    const twin = walk(prepared, 'twin', path, 'twise', [personaPick(prepared, 'expert')]);
    const length = twin.blocks.length;
    for (const draft of [holder, novice, twin]) minimal.reduce(draft);
    expect(novice.blocks).toHaveLength(length);
    expect(twin.blocks).toHaveLength(length);
  });

  it('reads a block as the same test for any persona: the end a novice walk says is a repeat for an expert', () => {
    const prepared = twoPersonas();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = walk(prepared, 'written', path, 'twise', [personaPick(prepared, 'novice')]);
    const holder = endsElsewhere(walk(prepared, 'holder', path, 'twise', [personaPick(prepared, 'expert')]));
    const again = reworded(walk(prepared, 'again', path, 'twise', [personaPick(prepared, 'expert')]));
    const length = again.blocks.length;
    for (const draft of [written, holder, again]) minimal.reduce(draft);
    expect(again.blocks.length).toBeLessThan(length);
  });
});

describe('the checks a cut has to pass before it is made', () => {
  const clean = (draft: ReturnType<typeof walk>) => {
    draft.perturbations = undefined;
    return draft;
  };

  it('keeps the move pairs: a walk whose last move follows a move no written walk makes keeps its end', () => {
    const prepared = twoRoutes();
    const [long, short] = prepared.relations.paths;
    if (!long || !short) throw new Error('missing parcel paths');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    // The short route says the same last move from the same stage as the long one, but after another move.
    // Every tuple of its end is held by the long walk: only the pair of consecutive moves is new.
    const first = clean(walk(prepared, 'first', long));
    const second = clean(walk(prepared, 'second', short));
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(length);
  });

  it('cuts that same end once a written walk makes the pair', () => {
    const prepared = twoRoutes();
    const [long, short] = prepared.relations.paths;
    if (!long || !short) throw new Error('missing parcel paths');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = clean(walk(prepared, 'first', long));
    const second = clean(walk(prepared, 'second', short));
    const third = clean(walk(prepared, 'third', short));
    const length = third.blocks.length;
    for (const draft of [first, second, third]) minimal.reduce(draft);
    expect(third.blocks.length).toBeLessThan(length);
  });

  it('keeps the allocation: a cut that leaves the rarest stage further under its floor is not made', () => {
    const prepared = lingering();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const allocation = new Allocation(prepared);
    const minimal = new TerminalSubsumption(prepared, run, 2, allocation);
    // The route stays on one stage for five moves and reaches the last stage once. Two walks of it say the last
    // move twice; cutting the second walk's end would leave the last stage placed once against ten times for the
    // stage it lingers on, further from the floor than before.
    const first = clean(walk(prepared, 'first', path));
    const second = clean(walk(prepared, 'second', path));
    const length = second.blocks.length;
    for (const draft of [first, second]) {
      minimal.reduce(draft);
      allocation.observeDraft(draft);
    }
    expect(second.blocks).toHaveLength(length);
  });

  it('cuts that end when no allocation is kept', () => {
    const prepared = lingering();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = clean(walk(prepared, 'first', path));
    const second = clean(walk(prepared, 'second', path));
    const length = second.blocks.length;
    for (const draft of [first, second]) minimal.reduce(draft);
    expect(second.blocks.length).toBeLessThan(length);
  });

  it('never leaves a walk ending on a tool failure: the retry that follows it is part of the test', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const answer = (found: boolean) => ({ world: { tools: { lookup: { result: { found } } } } });
    const failing = { world: { tools: { lookup: { error: 'service unavailable' } } } };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    // Both walks end on a block that sees the same answer; the second has a failure on the block before it.
    const first = clean(walk(prepared, 'first', path));
    const second = clean(walk(prepared, 'second', path));
    const last = first.blocks.length - 1;
    for (const draft of [first, second]) {
      const block = draft.blocks[last];
      if (block) block.given = answer(true);
    }
    const before = second.blocks[last - 1];
    if (!before) throw new Error('missing block');
    before.given = failing;
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(length);
  });

  describe('what a block is, beyond the Then', () => {
    const specOf = (prepared: ReturnType<typeof fixture>, id: string) => {
      const path = prepared.relations.paths[0];
      if (!path) throw new Error('missing parcel path');
      const parsed = validateSpec(renderDraft(prepared, clean(walk(prepared, id, path)), run).spec);
      if (!parsed.ok) throw new Error('the walk is not a valid spec');
      return parsed.spec;
    };
    const keyOf = (prepared: ReturnType<typeof fixture>, spec: ReturnType<typeof specOf>, index: number) =>
      (
        new TerminalSubsumption(prepared, run, 2) as unknown as {
          key(spec: unknown, index: number): string;
        }
      ).key(spec, index);

    it('is another block when it is said from another stage', () => {
      const prepared = fixture();
      const spec = specOf(prepared, 'a');
      const other = structuredClone(spec);
      const before = other.blocks[1];
      if (!before?.expect) throw new Error('missing expect');
      before.expect = { ...before.expect, stage: 'welcome' };
      expect(keyOf(prepared, other, 2)).not.toBe(keyOf(prepared, spec, 2));
    });

    it('is another block in another language', () => {
      const prepared = fixture();
      const spec = specOf(prepared, 'a');
      const other = { ...structuredClone(spec), lang: 'NL' };
      expect(keyOf(prepared, other, 1)).not.toBe(keyOf(prepared, spec, 1));
    });

    it('is another block under other rules', () => {
      const prepared = fixture();
      const spec = specOf(prepared, 'a');
      const other = {
        ...structuredClone(spec),
        rules: { ...spec.rules, forbidden_tools: ['export_everything'] },
      };
      expect(keyOf(prepared, other, 1)).not.toBe(keyOf(prepared, spec, 1));
    });

    it('is another block when an earlier block changed the world the tools answer in', () => {
      const prepared = fixture();
      const spec = specOf(prepared, 'a');
      const other = structuredClone(spec);
      const first = other.blocks[0];
      if (!first) throw new Error('missing block');
      first.given = { world: { tools: { lookup: { result: { found: false } } } } };
      expect(keyOf(prepared, other, 2)).not.toBe(keyOf(prepared, spec, 2));
    });
  });
});

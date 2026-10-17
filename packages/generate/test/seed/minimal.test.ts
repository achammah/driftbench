import { describe, expect, it } from 'vitest';
import type { PathRelation } from '../../src/extract/proposal';
import type { SpecDraft } from '../../src/seed/assemble';
import { TerminalSubsumption } from '../../src/seed/minimal';
import { type SeedContext, scenarioDraft } from '../../src/seed/seed-drafts';
import { fixture, split } from './desk';

const run = { seed: 1031, mapPath: '../desk.yaml' };

function walk(
  prepared: ReturnType<typeof fixture>,
  id: string,
  path: PathRelation,
  seeder: SpecDraft['seeder'] = 'twise',
) {
  const context: SeedContext = { seed: 1031, t: 2, max: 100 };
  const built = scenarioDraft(prepared, context, id, seeder, id, [], { preferred: [path], others: [] });
  if (!('draft' in built)) throw new Error(`${id} did not build`);
  return built.draft;
}

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
    expect(second.blocks).toHaveLength(length);
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

  it('undoes a cut that would leave the walk ending on a block another walk already ends on', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const context: SeedContext = { seed: 1031, t: 2, max: 100 };
    const perturbed = (id: string) => {
      const built = scenarioDraft(
        prepared,
        context,
        id,
        'twise',
        id,
        [],
        { preferred: [path], others: [] },
        { perturb: { classId: 'D5_language_switch', stage: 'address' } },
      );
      if (!('draft' in built)) throw new Error(`${id} did not build`);
      return built.draft;
    };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = perturbed('first');
    const second = perturbed('second');
    const length = first.blocks.length;
    // Both walks declare the same perturbation at the same place: the cut stops at that block, which both walks
    // would then end on. The second walk keeps its tail instead.
    expect(second.perturbations?.[0]?.inject_at).toBe(first.perturbations?.[0]?.inject_at);
    minimal.reduce(first);
    minimal.reduce(second);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
  });
});

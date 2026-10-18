import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate } from '../../src/index';
import { FIXTURE, NOW } from '../support';

/**
 * The Northwind fixture, read through its committed cassettes. `cassette.jsonl` holds the answers of the
 * default stack, a system 1 labeler and a system 2 labeler, one request per window each, and
 * `cassette-jev-unit.jsonl` the system 1 labeler asked one unit at a time. No network and no key: a miss
 * here means the fixture, the prompt, the set, the cutter or a labeler changed and the cassette must be
 * re-recorded in one reviewed commit.
 */
async function replay(
  specs: readonly string[] = pointer.DEFAULT_LABELER_SPECS,
  options: { cassette?: string; threshold?: number; passAt?: number; failAt?: number } = {},
) {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const parsed = specs.map((text) => {
    const spec = pointer.parseLabelerSpec(text);
    if (!spec.ok) throw new Error(spec.message);
    return spec.spec;
  });
  const built = await pointer.buildLabelling(parsed, {
    env: {},
    record: false,
    cwd: FIXTURE,
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    ...(options.passAt === undefined ? {} : { passAt: options.passAt }),
    ...(options.failAt === undefined ? {} : { failAt: options.failAt }),
  });
  if (!built.ok) throw new Error(built.message);
  const cassette = pointer.Cassette.parse(
    await readFile(join(FIXTURE, options.cassette ?? 'cassette.jsonl'), 'utf8'),
  );
  const result = await scanEstate({
    root: FIXTURE,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: { sets: sets.sets, labelling: built.labelling, cassette, mode: 'replay' },
  });
  return { result, cassette };
}

describe('the fixture through its committed cassettes', () => {
  it('replays the default stack with no call and no miss, and leaves no unit unlabeled', async () => {
    const { result, cassette } = await replay();
    expect(result.pointer?.calls).toBe(0);
    expect(result.pointer?.failed).toEqual([]);
    expect(result.pointer?.refusals).toEqual([]);
    expect(result.pointer?.atomRefusals).toEqual([]);
    expect(result.pointer?.unlabeled).toBe(0);
    // Every answer of the cassette is read: one request per window and labeler.
    expect(cassette.entries.size).toBe(result.pointer?.windows);
    expect(result.pointer?.decided).toBe(result.pointer?.plan.units);
    expect(result.pointer?.decidedBy.system1).toBeGreaterThan(0);
    expect(result.pointer?.decidedBy.system2).toBeGreaterThan(0);
  });

  it('builds only atoms whose quote is a slice of the file at its lines', async () => {
    const { result } = await replay();
    const pointed = result.map.atoms.filter((atom) => atom.fields?.extraction === 'pointer');
    expect(pointed.length).toBeGreaterThan(30);
    for (const atom of pointed) {
      const text = await readFile(join(FIXTURE, atom.provenance.file), 'utf8');
      expect(text, atom.id).toContain(atom.provenance.quote);
      const lines = text.split('\n').slice(atom.provenance.startLine - 1, atom.provenance.endLine);
      expect(lines.join('\n'), atom.id).toContain(atom.provenance.quote);
      expect(atom.approved).toBe(false);
    }
  });

  it('is the same ledger bytes on a second replay', async () => {
    const first = await replay();
    const second = await replay();
    expect(pointer.renderLedger(second.result.pointer?.ledger as pointer.Ledger)).toBe(
      pointer.renderLedger(first.result.pointer?.ledger as pointer.Ledger),
    );
  });

  it('holds no unit text in the cassettes: only file names, hashes and the answers', async () => {
    const { result } = await replay();
    const entries = result.pointer?.ledger.entries ?? [];
    expect(entries.length).toBeGreaterThan(100);
    for (const name of ['cassette.jsonl', 'cassette-jev-unit.jsonl']) {
      const raw = await readFile(join(FIXTURE, name), 'utf8');
      for (const entry of entries.filter((candidate) => candidate.quote.length >= 20)) {
        expect(raw, `${name} ${entry.id}`).not.toContain(entry.quote.slice(0, 20));
      }
    }
  });

  it('records the tokens the services reported, for both classes', async () => {
    const raw = await readFile(join(FIXTURE, 'cassette.jsonl'), 'utf8');
    const entries = pointer.Cassette.parse(raw).entries;
    const byLabeler = new Map<string, number>();
    for (const entry of entries.values()) {
      byLabeler.set(
        entry.readable.labeler as string,
        (byLabeler.get(entry.readable.labeler as string) ?? 0) + entry.answer.usage.input,
      );
    }
    expect([...byLabeler.keys()].sort()).toEqual(['anthropic', 'jev']);
    for (const total of byLabeler.values()) expect(total).toBeGreaterThan(0);
  });

  it('replays each class alone from the same cassette', async () => {
    const one = await replay(['system1:jev']);
    const two = await replay(['system2:anthropic']);
    for (const run of [one, two]) {
      expect(run.result.pointer?.calls).toBe(0);
      expect(run.result.pointer?.unlabeled).toBe(0);
    }
    expect(one.result.pointer?.decidedBy).toEqual({ system1: one.result.pointer?.decided, system2: 0 });
    expect(two.result.pointer?.decidedBy).toEqual({ system1: 0, system2: two.result.pointer?.decided });
  });

  it('changes the atoms with the threshold and the bounds, from the same cassette, with no call', async () => {
    const loose = await replay(['system1:jev'], { threshold: 0.3 });
    const strict = await replay(['system1:jev'], { threshold: 0.9 });
    expect(strict.result.pointer?.atoms).toBeLessThan(loose.result.pointer?.atoms ?? 0);
    // A pass-at of 1 and a fail-at of 0 leave nothing sure: system 2 alone decides, as when it runs alone.
    const handed = await replay(pointer.DEFAULT_LABELER_SPECS, { passAt: 1, failAt: 0 });
    const alone = await replay(['system2:anthropic']);
    expect(handed.result.pointer?.decidedBy.system1).toBe(0);
    expect(handed.result.pointer?.labelled.map((item) => [item.id, item.label])).toEqual(
      alone.result.pointer?.labelled.map((item) => [item.id, item.label]),
    );
  });

  it('replays the system 1 labeler asked one unit at a time: a request per unit', async () => {
    const run = await replay(['system1:jev-unit'], { cassette: 'cassette-jev-unit.jsonl', threshold: 0.7 });
    expect(run.result.pointer?.calls).toBe(0);
    expect(run.result.pointer?.unlabeled).toBe(0);
    expect(run.cassette.entries.size).toBe(run.result.pointer?.plan.units);
  });
});

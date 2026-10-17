import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate } from '../../src/index';
import { FIXTURE, NOW } from '../support';

/**
 * The Northwind fixture, read through the committed cassette (recorded once with claude-haiku-5-5). No
 * network and no key: a miss here means the fixture, the prompt, the set or the cutter changed and the
 * cassette must be re-recorded in one reviewed commit.
 */
type Arm = 'haiku' | 'jev' | 'jev-unit';
const CASSETTE: Record<Arm, string> = {
  haiku: 'cassette.jsonl',
  jev: 'cassette-jev.jsonl',
  'jev-unit': 'cassette-jev-unit.jsonl',
};

async function replay(arm: Arm = 'haiku', threshold?: number) {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const cassette = pointer.Cassette.parse(await readFile(join(FIXTURE, CASSETTE[arm]), 'utf8'));
  const labeler =
    arm === 'haiku'
      ? pointer.createHaikuLabeler()
      : pointer.createJevLabeler({
          env: {},
          replayOnly: true,
          state: arm === 'jev-unit' ? 'unit' : 'window',
          ...(threshold !== undefined ? { threshold } : {}),
        });
  const result = await scanEstate({
    root: FIXTURE,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: { sets: sets.sets, labeler, cassette, mode: 'replay' },
  });
  return { result, cassette };
}

describe('the fixture through its committed cassette', () => {
  it('replays with no call and no miss, and leaves no unit unlabeled', async () => {
    const { result, cassette } = await replay();
    expect(result.pointer?.calls).toBe(0);
    expect(result.pointer?.failed).toEqual([]);
    expect(result.pointer?.refusals).toEqual([]);
    expect(result.pointer?.atomRefusals).toEqual([]);
    expect(result.pointer?.unlabeled).toBe(0);
    expect(cassette.entries.size).toBe(result.pointer?.windows);
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

  it('holds no unit text in the cassette: only file names, hashes and the answers', async () => {
    const raw = await readFile(join(FIXTURE, 'cassette.jsonl'), 'utf8');
    const { result } = await replay();
    const entries = result.pointer?.ledger.entries ?? [];
    expect(entries.length).toBeGreaterThan(100);
    for (const entry of entries.filter((candidate) => candidate.quote.length >= 20)) {
      expect(raw, entry.id).not.toContain(entry.quote.slice(0, 20));
    }
  });

  it.each(['jev', 'jev-unit'] as const)(
    'replays the %s cassette with no call, and a threshold changes the atoms without a call',
    async (arm) => {
      const loose = await replay(arm, 0.3);
      const strict = await replay(arm, 0.9);
      for (const run of [loose, strict]) {
        expect(run.result.pointer?.calls).toBe(0);
        expect(run.result.pointer?.failed).toEqual([]);
        expect(run.result.pointer?.unlabeled).toBe(0);
      }
      expect(strict.result.pointer?.atoms).toBeLessThan(loose.result.pointer?.atoms ?? 0);
    },
  );

  it('asks one request per window for jev and one per unit for jev-unit', async () => {
    const window = await replay('jev');
    const unit = await replay('jev-unit');
    expect(window.cassette.entries.size).toBe(window.result.pointer?.windows);
    expect(unit.cassette.entries.size).toBe(154);
  });
});

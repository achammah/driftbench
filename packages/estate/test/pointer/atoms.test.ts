import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  loadEstateMap,
  parseEstateMapText,
  pointer,
  renderEstateMap,
  scanEstate,
} from '../../src/index';
import { AtomBuilder } from '../../src/scan';
import { estate, NOW } from '../support';
import { plantedDense } from './support';

// An invented harbour office: nothing here names a real estate.
const FILES = {
  'CLAUDE.md': [
    '# Harbour office',
    '',
    'Read `.claude/skills/moorings/SKILL.md` when a boat arrives.',
    '',
    '- Hang the lamp before dusk',
    "- Reply in the skipper's language",
    '- Never leave the gate open',
    '',
  ].join('\n'),
  '.claude/skills/moorings/SKILL.md': [
    '---',
    'name: moorings',
    'description: Tie up a boat at the right quay.',
    '---',
    '',
    '# Moorings',
    '',
    'Check the tide table. Then tie the bow line first.',
    '',
  ].join('\n'),
};

const SETS = `labels:
  - set: duty
    description: What the harbour notes ask of a reader.
    labels:
      - name: order
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: ban
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: pair
        description: A unit that sets one act before another.
        target: required
        atom: { kind: gate }
      - name: wording
        description: A unit that sets how the reader replies.
        atom: { kind: register }
      - name: weather
        description: A unit that only describes the sea.
        atom: { kind: tool }
      - name: remark
        description: A unit that states how things are.
`;

function setsOf(text = SETS) {
  const parsed = pointer.parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

/** A labeler that says what a table says, window by window; a unit it does not name is none. */
function table(rows: Record<string, pointer.Labelled[]>): pointer.Labeler {
  return plantedDense(
    (window) => rows[window.path] ?? [{ units: `1-${window.units.length}`, label: 'none' }],
  );
}

async function scan(rows: Record<string, pointer.Labelled[]>, over: Partial<pointer.PointerInput> = {}) {
  const root = await estate(FILES);
  const cassette = new pointer.Cassette();
  const result = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: setsOf(),
      labelling: pointer.singleLabelling(table(rows)),
      cassette,
      mode: 'record',
      ...over,
    },
  });
  return { root, result, cassette };
}

describe('atoms from labels', () => {
  it('builds each atom from the file itself, with the kind and polarity of its label', async () => {
    // Units of CLAUDE.md: 1 heading, 2 sentence, 3-5 items (lamp, language, gate).
    const { result, root } = await scan({
      'CLAUDE.md': [
        { units: '3', label: 'order' },
        { units: '4', label: 'wording' },
        { units: '5', label: 'ban' },
        { units: '1-2', label: 'remark' },
      ],
    });
    const mine = result.map.atoms.filter((atom) => atom.fields?.extraction === 'pointer');
    expect(mine.map((atom) => [atom.kind, atom.fields?.polarity, atom.provenance.quote])).toEqual([
      ['instruction', 'obligation', 'Hang the lamp before dusk'],
      ['register', undefined, "Reply in the skipper's language"],
      ['instruction', 'prohibition', 'Never leave the gate open'],
    ]);
    const text = (await import('node:fs/promises')).readFile;
    const file = await text(`${root}/CLAUDE.md`, 'utf8');
    for (const atom of mine) {
      expect(file).toContain(atom.provenance.quote);
      expect(atom.producedBy).toBe('model');
      expect(atom.approved).toBe(false);
      expect(atom.evidence).toEqual([
        {
          type: 'custom',
          name: 'prose_pointer',
          options: { reviewRequired: true, unit: atom.fields?.unit, set: 'duty', label: expect.any(String) },
        },
      ]);
      expect(atom.fields).toMatchObject({ labelSet: 'duty', labeler: 'planted' });
    }
    expect(result.map.producedBy).toMatchObject({ family: 'planted', model: 'planted-1' });
  });

  it('writes the lines of the unit, not of the file', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'order' }] });
    const atom = result.map.atoms.find((candidate) => candidate.fields?.extraction === 'pointer');
    expect(atom?.provenance).toMatchObject({ file: 'CLAUDE.md', startLine: 5, endLine: 5 });
  });

  it('puts a gate over both units, in file order', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'pair', target: 5 }] });
    const atom = result.map.atoms.find(
      (candidate) => candidate.kind === 'gate' && candidate.fields?.extraction === 'pointer',
    );
    expect(atom?.provenance.quote).toBe(
      "Hang the lamp before dusk\n- Reply in the skipper's language\n- Never leave the gate open",
    );
    expect(atom?.provenance.startLine).toBe(5);
    expect(atom?.provenance.endLine).toBe(7);
  });

  it('refuses a label that maps to a kind a pointer cannot build, and lists it', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'weather' }] });
    expect(result.pointer?.atomRefusals).toEqual([
      expect.stringContaining('the label weather maps to the atom kind tool, which a pointer cannot build'),
    ]);
    expect(result.map.atoms.some((atom) => atom.fields?.extraction === 'pointer')).toBe(false);
  });

  it('skips a unit code already read as an atom of that kind, and lists the repeat', () => {
    const text = FILES['CLAUDE.md'];
    const builder = new AtomBuilder(
      new Map([['CLAUDE.md', { path: 'CLAUDE.md', kind: 'standing' as const, text }]]),
    );
    const quote = 'Hang the lamp before dusk';
    builder.add({
      kind: 'instruction',
      title: 'Lamp',
      at: { file: 'CLAUDE.md', startLine: 5, endLine: 5, quote },
      evidence: [{ type: 'text', must: ['lamp'], mustNot: [] }],
    });
    const unit = pointer.cut(text).units.find((candidate) => candidate.text === quote);
    if (!unit) throw new Error('the unit is missing');
    const set = setsOf()[0] as pointer.LabelSet;
    const made = pointer.pointerAtoms(
      [{ path: 'CLAUDE.md', index: 0, unit, id: 'abcdefghij', set, label: 'order', source: 'cassette:x' }],
      new Map([['CLAUDE.md', text]]),
      builder,
      'planted',
    );
    expect(made.accepted).toEqual([]);
    expect(made.duplicates).toHaveLength(1);
  });

  it('gives a label with no atom mapping a ledger entry and no atom', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '1-5', label: 'remark' }] });
    expect(result.map.atoms.some((atom) => atom.fields?.extraction === 'pointer')).toBe(false);
    const labelled = result.pointer?.ledger.entries.filter((entry) => entry.labels.duty?.label === 'remark');
    expect(labelled?.length).toBe(5);
  });

  it('keeps a map the loader accepts, and waits for a person to approve', async () => {
    const { result } = await scan({ 'CLAUDE.md': [{ units: '3', label: 'order' }] });
    const parsed = parseEstateMapText(renderEstateMap(result.map));
    expect(parsed.ok).toBe(true);
    expect(
      result.map.atoms
        .filter((atom) => atom.fields?.extraction === 'pointer')
        .every((atom) => !atom.approved),
    ).toBe(true);
    expect(loadEstateMap).toBeDefined();
  });

  it('reads no prose with the model port when the pointer reader runs', async () => {
    const { result } = await scan({});
    expect(result.chunks).toEqual([]);
    expect(result.pointer?.windows).toBeGreaterThan(0);
  });
});

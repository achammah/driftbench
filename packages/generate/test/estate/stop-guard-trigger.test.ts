import { describe, expect, it } from 'vitest';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';

const guard = {
  id: 'guard.clinic.note-length',
  kind: 'guard',
  title: 'Stop guard note-length.sh',
  approved: true,
  fields: {
    name: 'note-length.sh',
    event: 'Stop',
    command: 'sh .claude/note-length.sh',
    ruleText: 'Judges the length of each note.',
  },
  evidence: [{ type: 'guard' as const, name: 'note-length.sh', verdict: 'warn' as const }],
};

function generate(use: 'trigger' | 'forced' | 'none', fallback = true) {
  const input: EstateGenerateInput = {
    map: { runtime: 'claude-code', hash: 'clinic', atoms: [guard] },
    plan: {
      mapHash: 'clinic',
      rows: [
        {
          id: 'pos',
          atomIds: [guard.id],
          cell: {},
          testType: 'guard_positive',
          mode: 'live',
          status: 'approved',
        },
      ],
    },
    bank: {
      version: 1,
      estate: 'clinic',
      mapHash: 'clinic',
      deviations: [],
      workspaces: [],
      situations:
        use === 'none'
          ? []
          : [
              {
                id: 'long-note',
                title: 'A request whose answer is a long note',
                use,
                atoms: [guard.id],
                phrases: [
                  { text: 'Summarise every ward round of the week in one note.', lang: 'en', approved: true },
                ],
                touches: { created: [], changed: [], deleted: [] },
              },
            ],
    },
  };
  const result = generateEstateSuite(input, {
    seed: 1,
    fallback,
    paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' },
  });
  const file = result.files.find((entry) => entry.path.endsWith('.yaml'));
  return { record: result.specs[0], text: file?.text ?? '' };
}

describe('a live guard_positive row of a guard on the end of a turn', () => {
  it('takes the approved phrase the bank gives the guard when no request can be written from the atoms', () => {
    const { record, text } = generate('trigger');
    expect(record?.complete).toBe(true);
    expect(text).toContain('Summarise every ward round of the week in one note.');
  });

  it('prefers a forced situation to the trigger one', () => {
    const { record, text } = generate('forced');
    expect(record?.complete).toBe(true);
    expect(text).toContain('Summarise every ward round of the week in one note.');
  });

  it('stays incomplete under needs-askable-act when the bank has no phrase for the guard', () => {
    const { record, text } = generate('none');
    expect(record?.complete).toBe(false);
    expect(text).toContain('needs-askable-act');
  });
});

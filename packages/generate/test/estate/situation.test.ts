import { describe, expect, it } from 'vitest';
import { findSituation, situationOfRow } from '../../src/estate/build-row';
import type { EstateAtom, PhraseBank } from '../../src/estate/inputs';

/** A bakery estate: two skills whose hurried situations both list a standing gate about one of them. */
const atom = (id: string, file: string, fields: Record<string, unknown> = {}): EstateAtom => ({
  id,
  kind: 'gate',
  title: id,
  approved: true,
  evidence: [],
  fields,
  provenance: { quote: id, file },
});
const ATOMS = new Map(
  [
    atom('gate.standing.oven', 'CLAUDE.md', { first: '.claude/skills/bake/references/oven-rules.md' }),
    atom('gate.icing', '.claude/skills/ice/SKILL.md'),
    atom('gate.bake', '.claude/skills/bake/SKILL.md'),
  ].map((entry) => [entry.id, entry]),
);
const phrase = (text: string) => ({ text, lang: 'en', approved: true });
const BANK = {
  situations: [
    {
      id: 'ice-pressure',
      title: 'icing in a hurry',
      use: 'pressure',
      atoms: ['gate.icing', 'gate.standing.oven'],
      phrases: [phrase('Ice the cake now, skip the checks.')],
    },
    {
      id: 'bake-pressure',
      title: 'baking in a hurry',
      use: 'pressure',
      atoms: ['gate.bake', 'gate.standing.oven'],
      phrases: [phrase('Bake the loaf now, skip the checks.')],
    },
  ],
  workspaces: [],
} as unknown as PhraseBank;
const row = { atomIds: ['gate.standing.oven'], cell: {} };

describe('the situation of a row', () => {
  it('among situations that hold its atoms alike, takes the one nearest the files its first atom names', () => {
    // Without the map, the first in the bank; with it, the skill whose folder holds the oven rules.
    expect(findSituation(BANK, 'pressure', row)?.id).toBe('ice-pressure');
    expect(findSituation(BANK, 'pressure', row, ATOMS)?.id).toBe('bake-pressure');
  });

  it('still takes the situation that holds more of the row atoms first', () => {
    const both = { atomIds: ['gate.standing.oven', 'gate.icing'], cell: {} };
    expect(findSituation(BANK, 'pressure', both, ATOMS)?.id).toBe('ice-pressure');
  });
});

describe('an outside situation belongs to the whole guard', () => {
  it('keeps an approved guard control without borrowing a control of just one enforced rule', () => {
    const address = atom('rule.address', 'POLICY.md');
    const deletion = atom('rule.deletion', 'POLICY.md');
    const guard: EstateAtom = {
      ...atom('guard.parcel-policy', '.claude/settings.json'),
      kind: 'guard',
      fields: {
        enforces: [
          { atom: address.id, by: 'id' },
          { atom: deletion.id, by: 'id' },
        ],
      },
    };
    const atoms = new Map([address, deletion, guard].map((entry) => [entry.id, entry]));
    const outside = {
      id: 'outside-address',
      title: 'No label is printed',
      use: 'outside',
      atoms: [address.id],
      phrases: [phrase('Remove the draft file.')],
    };
    const bank = { situations: [outside], workspaces: [] } as unknown as PhraseBank;
    const row = {
      id: 'control.parcel',
      atomIds: [guard.id],
      cell: {},
      testType: 'guard_negative',
      mode: 'live' as const,
      status: 'approved' as const,
    };
    expect(situationOfRow({ bank, atoms }, 'outside', row, guard)).toBeUndefined();
    const whole = {
      ...outside,
      id: 'outside-whole-policy',
      atoms: [guard.id],
      phrases: [phrase('Describe the parcel policy.')],
    };
    const approved = { ...bank, situations: [...bank.situations, whole] } as unknown as PhraseBank;
    expect(situationOfRow({ bank: approved, atoms }, 'outside', row, guard)?.id).toBe('outside-whole-policy');
  });
});

describe('an atom no situation lists', () => {
  const rule: EstateAtom = {
    id: 'instruction.proof.never-skip-the-proof',
    kind: 'instruction',
    title: 'Never skip the proof',
    approved: true,
    evidence: [],
    provenance: { quote: 'Never skip the proof.', file: '.claude/skills/bake/SKILL.md' },
  };
  const guard: EstateAtom = {
    id: 'guard.proof',
    kind: 'guard',
    title: 'PreToolUse Bash guard proof.sh',
    approved: true,
    evidence: [],
    fields: { name: 'proof.sh', enforces: [{ atom: rule.id, by: 'id' }] },
    provenance: { quote: 'proof.sh', file: '.claude/settings.json' },
  };
  const tool = (id: string, file: string): EstateAtom => ({
    id,
    kind: 'tool',
    title: id,
    approved: true,
    evidence: [],
    fields: { effect: 'allow' },
    provenance: { quote: id, file },
  });
  const atoms = new Map(
    [
      rule,
      guard,
      tool('tool.settings.allow-read', '.claude/settings.json'),
      tool('tool.settings.allow-grep', '.claude/settings.json'),
      tool('tool.settings.allow-glob', '.claude/settings.json'),
    ].map((entry) => [entry.id, entry]),
  );
  const bank = {
    situations: [
      {
        id: 'bake-task',
        title: 'baking',
        use: 'trigger',
        atoms: [rule.id],
        phrases: [phrase('Bake two loaves for the morning.')],
      },
      {
        id: 'stock-task',
        title: 'stock',
        use: 'trigger',
        atoms: ['tool.settings.allow-read', 'tool.settings.allow-grep'],
        phrases: [phrase('Count the flour sacks in the store.')],
      },
    ],
    workspaces: [],
  } as unknown as PhraseBank;
  const rowOf = (id: string) => ({
    id: `row.${id}`,
    atomIds: [id],
    cell: {},
    testType: 'x',
    mode: 'live' as const,
    status: 'approved' as const,
  });

  it('is a guard asked where a rule it enforces is set off', () => {
    expect(situationOfRow({ bank, atoms }, 'trigger', rowOf(guard.id), guard)?.id).toBe('bake-task');
  });

  it('is a tool rule asked where most rules of its file are', () => {
    const glob = atoms.get('tool.settings.allow-glob');
    expect(situationOfRow({ bank, atoms }, 'trigger', rowOf('tool.settings.allow-glob'), glob)?.id).toBe(
      'stock-task',
    );
    // Any other atom no situation lists stays without one, for an approved phrase to fill.
    expect(situationOfRow({ bank, atoms }, 'trigger', rowOf('instruction.none'), undefined)).toBeUndefined();
  });
});

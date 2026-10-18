import { describe, expect, it } from 'vitest';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';
import { recoveryAction } from '../../src/estate/recovery';

const atomOf = (quote: string, recovery: Record<string, unknown> = {}) => ({
  id: 'hazard.garden.recovery',
  kind: 'hazard',
  title: 'Recover the garden session',
  approved: true,
  fields: { hazard: 'compaction', recovery },
  provenance: { quote, file: 'GARDEN.md' },
  evidence: [{ type: 'custom' as const, name: 'hazard_recovery', options: { hazard: 'compaction' } }],
});

function generate(quote: string, judge: boolean) {
  const atom = atomOf(quote, { reread: ['GARDEN.md'], unpathed: ['the open seed ledger'] });
  const input: EstateGenerateInput = {
    map: { runtime: 'claude-code', hash: 'garden', atoms: [atom] },
    plan: {
      mapHash: 'garden',
      rows: [
        {
          id: 'recover',
          atomIds: [atom.id],
          cell: {},
          testType: 'hazard_recovery',
          mode: 'live',
          status: 'approved',
        },
      ],
    },
    bank: {
      version: 1,
      estate: 'garden',
      mapHash: 'garden',
      deviations: [],
      workspaces: [],
      situations: [
        {
          id: 'recover',
          title: 'Continue the garden review',
          use: 'trigger',
          atoms: [atom.id],
          phrases: [{ text: 'Continue reviewing the garden plan.', lang: 'en', approved: true }],
          touches: { created: [], changed: [], deleted: [] },
        },
      ],
    },
  };
  const result = generateEstateSuite(input, {
    seed: 1,
    judge,
    paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' },
  });
  const file = result.files.find((entry) => entry.path.endsWith('.yaml'));
  return { result, text: file?.text ?? '' };
}

const RULE = 'After a compaction, re-read this file and the open seed ledger before you continue.';

describe('a re-read the rule orders that names no file path', () => {
  it('reads the file and the unpathed part apart', () => {
    const action = recoveryAction(
      atomOf(RULE, { reread: ['GARDEN.md'], unpathed: ['the open seed ledger'] }),
    );
    expect(action.reread).toEqual(['GARDEN.md']);
    expect(action.unpathed).toEqual(['the open seed ledger']);
  });

  it('finds no unpathed part in a rule whose every object is a path or this file', () => {
    expect(
      recoveryAction(
        atomOf('After a compaction, re-read this file before continuing.', { reread: ['GARDEN.md'] }),
      ).unpathed,
    ).toEqual([]);
    expect(
      recoveryAction(
        atomOf('After a compaction, re-read `notes/plan.md` and `notes/seeds.md` before you go on.', {
          reread: ['notes/plan.md', 'notes/seeds.md'],
        }),
      ).unpathed,
    ).toEqual([]);
  });

  it('never passes on the file alone: without a judge the row waits, with the reason', () => {
    const { result } = generate(RULE, false);
    const record = result.specs[0];
    expect(record?.complete).toBe(false);
    const needs = result.report.incomplete.flatMap((entry) => entry.reasons);
    expect(needs.map((need) => need.marker)).toContain('needs-registered-check');
    expect(needs.map((need) => need.detail).join(' ')).toContain('the open seed ledger');
    expect(needs.map((need) => need.detail).join(' ')).toContain('names no file path');
  });

  it('with a judge, an advisory criterion marks the part unchecked by code, and the file is still checked', () => {
    const { result, text } = generate(RULE, true);
    expect(result.specs[0]?.complete).toBe(true);
    expect(text).toContain('reread:');
    expect(text).toContain('GARDEN.md');
    expect(text).toContain('Did the agent re-read "the open seed ledger"?');
    expect(text).toContain('Unchecked by code');
    expect(text).not.toContain('gating: true');
  });
});

it('does not read the moment of a re-read as a thing to read', () => {
  const action = recoveryAction(
    atomOf('Read `notes/garden.md` at the start of every session.', { reread: ['notes/garden.md'] }),
  );
  expect(action.reread).toEqual(['notes/garden.md']);
  expect(action.unpathed).toEqual([]);
});

import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import { MARKERS, stageModel, type ThenContext, thenOf } from '../../src/estate/then';

/** A reference that obliges a Read of `path`, in the input forms the estate reader writes. */
const reference = (path: string, input: Record<string, unknown>): EstateAtom => ({
  id: `reference.archive.${path.replace(/\W+/g, '-')}`,
  kind: 'reference',
  title: `Open ${path} before exporting.`,
  approved: true,
  evidence: [{ type: 'tool_called', label: 'Read', input }],
  fields: { path, exists: false },
});
const ctx = (files: string[], checks: string[]): ThenContext => ({
  stages: stageModel([]),
  skills: new Set(),
  files: new Set(files),
  customChecks: new Set(checks),
});

const FORMS: Array<[string, string, Record<string, unknown>]> = [
  ['contains', 'rules/archive-policy.txt', { file_path: { contains: 'rules/archive-policy.txt' } }],
  ['equals', 'docs/tides/chart.md', { file_path: { equals: 'docs/tides/chart.md' } }],
  ['a plain string', 'notes/berths.md', { file_path: 'notes/berths.md' }],
  ['the path key', 'ledger/2026.csv', { path: { contains: 'ledger/2026.csv' } }],
  ['a leading ./', './rules/dock.md', { file_path: { contains: './rules/dock.md' } }],
];

describe('a missing file, whatever form the asserted path takes', () => {
  const missing = (input: Record<string, unknown>, files = ['CLAUDE.md', 'notes.md', 'docs/guide.md']) =>
    thenOf([reference('refs/notes.md', input)], 'positive', ctx(files, ['some_call']));

  it.each([
    ['exact', { file_path: { exact: 'refs/notes.md' } }],
    ['one_of', { file_path: { one_of: ['refs/notes.md', 'refs/other.md'] } }],
    ['regex', { file_path: { regex: 'refs/notes\\.md$' } }],
    ['a bare string in path', { path: 'refs/notes.md' }],
    ['notebook_path', { notebook_path: { contains: 'refs/notes.md' } }],
  ])('waits on needs-existing-file: %s', (_form, input) => {
    const then = missing(input);
    expect(then.gaps.map((gap) => gap.marker)).toEqual([MARKERS.existingFile]);
    expect(then.someCalls).toEqual([]);
    expect(then.references).toEqual([]);
  });

  it('a path alternative the estate holds keeps the successful-read expectation', () => {
    const then = missing({ file_path: { one_of: ['refs/notes.md', 'docs/guide.md'] } });
    expect(then.gaps).toEqual([]);
  });

  it('a longer path is not held by a file that is its tail: refs/notes.md is not held by notes.md, and a bare name is held by the file of that name in a folder', () => {
    expect(missing({ file_path: { contains: 'refs/notes.md' } }).gaps.map((gap) => gap.marker)).toEqual([
      MARKERS.existingFile,
    ]);
    expect(missing({ file_path: { exact: 'refs/notes.md' } }, ['notes.md']).gaps).not.toEqual([]);
    const named = thenOf(
      [reference('guide.md', { file_path: { contains: 'guide.md' } })],
      'positive',
      ctx(['docs/guide.md'], ['some_call']),
    );
    expect(named.gaps).toEqual([]);
    // An exact path is the whole path, whatever the files end with.
    const exact = thenOf(
      [reference('guide.md', { file_path: { exact: 'guide.md' } })],
      'positive',
      ctx(['docs/guide.md'], ['some_call']),
    );
    expect(exact.gaps.map((gap) => gap.marker)).toEqual([MARKERS.existingFile]);
    // A leading ./ or / and a doubled slash do not change the path.
    const same = thenOf(
      [reference('notes.md', { file_path: { exact: './/notes.md' } })],
      'positive',
      ctx(['notes.md'], ['some_call']),
    );
    expect(same.gaps).toEqual([]);
  });

  it('reads the path from the folder of the file the atom was read in when it is written relative to it', () => {
    const atom: EstateAtom = {
      ...reference('references/rules.md', { file_path: { exact: 'references/rules.md' } }),
      provenance: { quote: 'x', file: '.claude/skills/pack/SKILL.md' },
    };
    const held = thenOf([atom], 'positive', ctx(['.claude/skills/pack/references/rules.md'], ['some_call']));
    expect(held.gaps).toEqual([]);
    const lost = thenOf([atom], 'positive', ctx(['.claude/skills/other/references/rules.md'], ['some_call']));
    expect(lost.gaps.map((gap) => gap.marker)).toEqual([MARKERS.existingFile]);
  });
});

describe('an estate obligation to open a file the estate does not hold', () => {
  it.each(FORMS)(
    'waits on needs-existing-file, whatever checks the runner registers: %s',
    (_form, path, input) => {
      for (const checks of [[], ['some_call'], ['some_call', 'ordered', 'absence']]) {
        const then = thenOf(
          [reference(path, input)],
          'positive',
          ctx(['CLAUDE.md', 'other/readme.md'], checks),
        );
        expect(
          then.gaps.map((gap) => gap.marker),
          checks.join(),
        ).toEqual([MARKERS.existingFile]);
        expect(then.references).toEqual([]);
        expect(then.someCalls).toEqual([]);
      }
    },
  );

  it('keeps the successful-read expectation for a file the estate holds, however the path is written', () => {
    const files = ['rules/archive-policy.txt', 'docs/tides/chart.md', 'notes/berths.md'];
    for (const [path, input] of [
      ['rules/archive-policy.txt', { file_path: { contains: 'rules/archive-policy.txt' } }],
      ['docs/tides/chart.md', { file_path: { contains: 'tides/chart.md' } }],
    ] as const) {
      const then = thenOf([reference(path, input)], 'positive', ctx(files, ['some_call']));
      expect(then.gaps).toEqual([]);
      expect(then.someCalls).toEqual([]);
      expect(then.references).toHaveLength(1);
    }
  });

  it('is not a gap in a negative control, where the Read is forbidden', () => {
    const then = thenOf(
      [reference('rules/old.md', { file_path: { contains: 'rules/old.md' } })],
      'negative',
      ctx(['CLAUDE.md'], ['some_call']),
    );
    expect(then.gaps.map((gap) => gap.marker)).not.toContain(MARKERS.existingFile);
  });
});

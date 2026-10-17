import { describe, expect, it } from 'vitest';
import { classifyDocument, normativeRanges } from '../../src/scan/document-roles';

describe('document authority boundaries', () => {
  it.each([
    ['.claude/archive-policy.md', '# Archive policy\n\nRead `live.md` before editing a page.\n'],
    ['.claude/history.md', '# History API\n\n2025-01-01: Read `live.md` before editing a page.\n'],
    [
      '.claude/templates-integration.md',
      '# Generating pages\n\nRead `<slug>/guide.md`.\nRead `{{folder}}/rules.md`.\n',
    ],
    [
      '.claude/guide.md',
      '# Editing\n\nRead `live.md`.\n\n## 2025-01-01\nA historical entry.\n\n## 2025-01-02\nAnother entry.\n',
    ],
  ])('does not suppress the live procedure %s', (path, text) => {
    expect(classifyDocument({ path, text }).role).toBe('normative');
    expect(normativeRanges({ path, text, kind: 'other' }, 1, text.split('\n').length)).not.toEqual([]);
  });

  it('keeps the real clause after a semicolon following an illustrative quotation', () => {
    const text = 'Example: "process restart"; after a compaction, reload the saved state.\n';
    expect(classifyDocument({ path: 'CLAUDE.md', text }).sections).toBeUndefined();
  });

  it('bounds historical and example sections by heading depth', () => {
    const text =
      '# Rules\nRead `first.md`.\n## Examples\nRead `example.md`.\n### More examples\nRead `another.md`.\n## Live rules\nRead `last.md`.\n';
    const info = classifyDocument({ path: 'CLAUDE.md', text });
    expect(info.sections).toEqual([{ startLine: 3, endLine: 6, role: 'example' }]);
    expect(normativeRanges({ path: 'CLAUDE.md', text, kind: 'standing' }, 1, 8)).toEqual([
      { startLine: 1, endLine: 2 },
      { startLine: 7, endLine: 8 },
    ]);
  });
});

it('bounds a standalone e.g. paragraph without swallowing the next live paragraph', () => {
  const text =
    '# Rules\n\ne.g.\n\n> Read `fictional.md` before editing a page.\n> After a compaction, reload the example.\n\nRead `live.md` before editing a page.\n';
  expect(classifyDocument({ path: 'CLAUDE.md', text }).sections).toEqual([
    { startLine: 3, endLine: 6, role: 'example' },
  ]);
});

it('ends a fenced example at its closing fence, including blank lines inside', () => {
  const text =
    '# Rules\nFor example:\n\n```md\nRead `fictional.md`.\n\nAfter a compaction, reload.\n```\nRead `live.md` before editing a page.\n';
  expect(classifyDocument({ path: 'CLAUDE.md', text }).sections).toEqual([
    { startLine: 2, endLine: 8, role: 'example' },
  ]);
});

it('does not let an embedded append-only log erase the operational section', () => {
  const text =
    '# Rules\n\nRead `live.md` before editing a page.\n\n## History\nAppend-only log.\n\n- 2024-01-01: Read `old.md`.\n- 2024-01-02: Read `older.md`.\n';
  const info = classifyDocument({ path: 'CLAUDE.md', text });
  expect(info.role).toBe('normative');
  expect(info.sections).toEqual([{ startLine: 5, endLine: 10, role: 'history' }]);
});

it('recognizes date-bearing entry headings even when a date follows an entry label', () => {
  const text =
    '# Engineering notebook\n\n## Session [2025-1-2]\nAfter a compaction, read `old.md`.\n\n## Session [2025-1-3]\nRead `older.md`.\n';
  expect(classifyDocument({ path: '.claude/notebook.md', text }).role).toBe('history');
});

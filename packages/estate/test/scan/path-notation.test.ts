import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { namedPaths } from '../../src/scan/code';
import { estate, NOW } from '../support';

describe('reference path notation', () => {
  it.each([
    ['bare', 'references/guide.md'],
    ['bold', '**references/guide.md**'],
    ['import', '@references/guide.md'],
    ['line', '`references/guide.md:12`'],
    ['angle', '<references/guide.md>'],
    ['wiki', '[[references/guide]]'],
    ['backslash', '`references\\guide.md`'],
  ])('resolves %s notation and keeps its original provenance', async (_kind, notation) => {
    const quote = `Read ${notation} before reconciling the record.`;
    expect(namedPaths(quote)).toEqual(['references/guide.md']);
    const root = await estate({
      '.claude/skills/reconcile/SKILL.md': `---\nname: reconcile\n---\n${quote}\n`,
      '.claude/skills/reconcile/references/guide.md': '# Guide\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference')).toMatchObject([
      {
        fields: { path: '.claude/skills/reconcile/references/guide.md', exists: true },
        provenance: { quote },
      },
    ]);
  });

  it('normalizes the project anchor but leaves unknown variables and remote URLs alone', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell variable is the input
    expect(namedPaths('Read `${CLAUDE_PROJECT_DIR}/.claude/docs/guide.md`.')).toEqual([
      '.claude/docs/guide.md',
    ]);
    expect(namedPaths('Read `$CLAUDE_PROJECT_DIR/.claude/docs/guide.md`.')).toEqual([
      '.claude/docs/guide.md',
    ]);
    expect(namedPaths('Read `$UNKNOWN/guide.md` or https://example.test/guide.md.')).toEqual([]);
  });

  it('does not turn link titles or shell examples into bare references', () => {
    expect(namedPaths('[the guide](references/guide.md "missing.md")')).toEqual(['references/guide.md']);
    expect(namedPaths('Example: `cat references/guide.md | head -1`')).toEqual([]);
    expect(namedPaths('Read references/*.md and references/.')).toEqual([]);
    expect(namedPaths('Superseded by guide.md. Nothing names this file any more.')).toEqual([]);
  });

  it('handles long unmarked prose without rescanning every prefix', () => {
    expect(namedPaths(`${'ordinary words '.repeat(20000)} Read references/guide.md.`)).toEqual([
      'references/guide.md',
    ]);
  });

  it('does not turn prohibited wiki or backslash reads into positive references', async () => {
    const root = await estate({
      'CLAUDE.md': 'Never read [[references/guide]].\nDo not read `references\\other.md`.\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference')).toEqual([]);
  });
});

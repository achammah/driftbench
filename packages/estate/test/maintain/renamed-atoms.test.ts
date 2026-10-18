import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  diffEstateMaps,
  type EstateTest,
  estateImpact,
  renderEstateDiff,
  scanEstate,
} from '../../src/index';
import { estate, NOW } from '../support';
import { atom, estateMap } from './support';

const helper = (name: string, tools: string) =>
  [
    '---',
    `name: ${name}`,
    `description: Checks ${name} records.`,
    `tools: ${tools}`,
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n');

async function mapOf(files: Record<string, string>) {
  const root = await estate({ 'CLAUDE.md': '# Rules\n', ...files });
  return (await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW })).map;
}

const test = (id: string, atoms: string[]): EstateTest => ({
  id,
  path: `/t/${id}.yaml`,
  file: `${id}.yaml`,
  atoms,
});

describe('an atom that changes its id is renamed, not removed', () => {
  it('keeps the tests of a tool two helpers declare when the first declarer leaves', async () => {
    const both = await mapOf({
      '.claude/agents/aaa-checker.md': helper('aaa-checker', 'Glob, Read'),
      '.claude/agents/zzz-planner.md': helper('zzz-planner', 'Glob, Grep'),
    });
    const one = await mapOf({ '.claude/agents/zzz-planner.md': helper('zzz-planner', 'Glob, Grep') });
    const glob = both.atoms.find((entry) => entry.kind === 'tool' && entry.fields?.tool === 'Glob');
    const read = both.atoms.find((entry) => entry.kind === 'tool' && entry.fields?.tool === 'Read');
    expect(glob?.provenance.file).toBe('.claude/agents/aaa-checker.md');

    const diff = diffEstateMaps(both, one);
    expect(
      diff.atoms.renamed?.map((entry) => [entry.kind, entry.from.startsWith('tool.aaa-checker')]),
    ).toEqual([['tool', true]]);
    expect(diff.atoms.removed.map((entry) => entry.id)).not.toContain(glob?.id);
    expect(diff.atoms.added).toEqual([]);
    expect(renderEstateDiff(diff)).toContain('Renamed, the same atom under another id:');

    const report = estateImpact(diff, [test('t-glob', [glob?.id ?? '']), test('t-read', [read?.id ?? ''])]);
    expect(report.retire.map((entry) => entry.test)).toEqual(['t-read']);
    expect(report.regenerate).toEqual([
      { test: 't-glob', file: 't-glob.yaml', atoms: [{ atom: glob?.id, why: 'renamed' }] },
    ]);
    expect(report.new).toEqual([]);
  });

  it('pairs only atoms that state the same words', () => {
    const before = estateMap([atom('a.one', 'Keep the ledger.', { line: 3 })]);
    const after = estateMap([atom('a.two', 'Keep the ledger closed.', { line: 3 })]);
    const diff = diffEstateMaps(before, after);
    expect(diff.atoms.renamed).toBeUndefined();
    expect(diff.atoms.removed.map((entry) => entry.id)).toEqual(['a.one']);
    expect(diff.atoms.added.map((entry) => entry.id)).toEqual(['a.two']);
    expect(diff.summary.renamed).toBeUndefined();
  });

  it('pairs a repeated atom one for one', () => {
    const rule = (id: string, line: number) => ({
      ...atom(id, 'Answer in English.', { line }),
      title: 'Answer',
    });
    const diff = diffEstateMaps(
      estateMap([rule('a.x', 3), rule('a.y', 5)]),
      estateMap([rule('a.z', 3), rule('a.w', 4), rule('a.v', 9)]),
    );
    expect(diff.atoms.renamed?.map((entry) => [entry.from, entry.to])).toEqual([
      ['a.x', 'a.v'],
      ['a.y', 'a.w'],
    ]);
    expect(diff.atoms.added.map((entry) => entry.id)).toEqual(['a.z']);
  });
});

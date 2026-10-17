import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const declarations = {
  '.claude/skills/dock-schedule/SKILL.md': '---\nname: dock-schedule\ndescription: Plan dock slots.\n---\n',
  '.claude/skills/tide-report/SKILL.md': '---\nname: tide-report\ndescription: Report tide times.\n---\n',
};

const table = (header: string, rows: Array<[string, string]>) =>
  [`| ${header} |`, '|---|---|', ...rows.map(([left, right]) => `| ${left} | ${right} |`)].join('\n');

const routesOf = async (text: string) => {
  const root = await estate({ ...declarations, 'CLAUDE.md': `# Marina office assistant\n\n${text}\n` });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms
    .filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')
    .map((atom) => [atom.fields?.ask, atom.fields?.target]);
};

/** The same two people or roles, written in every letter case. None of them is a request. */
const owners: Array<[string, [string, string], [string, string]]> = [
  ['Title Case roles', ['Harbour Master', 'Night Watch'], ['Harbour Master', 'Night Watch']],
  ['sentence case roles', ['Harbour master', 'Night watch'], ['Harbour master', 'Night watch']],
  ['lowercase roles', ['harbour master', 'night watch'], ['harbour master', 'night watch']],
  ['Title Case names', ['Ana Maria', 'Bo Lindqvist'], ['Ana Maria', 'Bo Lindqvist']],
  ['lowercase names', ['ana maria', 'bo lindqvist'], ['ana maria', 'bo lindqvist']],
].map(([label, a, b]) => [label as string, a as [string, string], b as [string, string]]);

describe('an owner column is not a trigger column, whatever its letter case', () => {
  it.each(owners)('%s give no route', async (_label, [first, second]) => {
    const text = table('Owner | Skill they maintain', [
      [first, '`dock-schedule`'],
      [second, '`tide-report`'],
    ]);
    expect(await routesOf(text)).toEqual([]);
  });

  it.each(owners)('%s give no route under unrelated header labels', async (_label, [first, second]) => {
    const text = table('λ | Ω', [
      [first, '`dock-schedule`'],
      [second, '`tide-report`'],
    ]);
    expect(await routesOf(text)).toEqual([]);
  });

  it.each(owners)('%s give no route with the target column first', async (_label, [first, second]) => {
    const text = table('Skill they maintain | Owner', [
      ['`dock-schedule`', first],
      ['`tide-report`', second],
    ]);
    expect(await routesOf(text)).toEqual([]);
  });

  // The tagger reads a capitalised first word as a verb ("Harbour" in "Harbour Master"). Both rows below
  // carry that misreading, so the table gives no route only if the grammar is read from lowercased text.
  it.each([
    ['Title Case', ['Harbour Master', 'Dock Master']],
    ['sentence case', ['Harbour master', 'Dock master']],
  ] as const)('reads %s roles from lowercased text', async (_label, [first, second]) => {
    const text = table('Owner | Skill they maintain', [
      [first, '`dock-schedule`'],
      [second, '`tide-report`'],
    ]);
    expect(await routesOf(text)).toEqual([]);
  });

  // A name of three words is longer than a two-word label: only the run of person names keeps it a label.
  it.each([
    ['Title Case', ['Anna Maria Lopez', 'Maria Elena Ortiz']],
    ['lowercase', ['anna maria lopez', 'maria elena ortiz']],
  ] as const)('gives no route for %s names of three words', async (_label, [first, second]) => {
    const text = table('Owner | Skill they maintain', [
      [first, '`dock-schedule`'],
      [second, '`tide-report`'],
    ]);
    expect(await routesOf(text)).toEqual([]);
  });

  it('still reads a table whose first column holds real triggers', async () => {
    const text = table('Ask | Skill', [
      ['schedule a dock slot', '`dock-schedule`'],
      ['report the tide times', '`tide-report`'],
    ]);
    expect(await routesOf(text)).toEqual([
      ['schedule a dock slot', 'dock-schedule'],
      ['report the tide times', 'tide-report'],
    ]);
  });
});

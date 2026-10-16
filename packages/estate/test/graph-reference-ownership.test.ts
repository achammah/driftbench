import { describe, expect, it } from 'vitest';
import { buildPlan, ClaudeCodeReader, citationsByFile, filesReached, scanEstate } from '../src/index';
import { estate, NOW } from './support';

const definition = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Review fictional parcels.\n---\n${body}\n`;

async function referenceEdges(files: Record<string, string>) {
  const root = await estate(files);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  return {
    atoms: map.atoms,
    references: map.atoms.filter((atom) => atom.kind === 'reference'),
    edges: map.edges
      .filter((edge) => edge.kind === 'reference')
      .map((edge) => ({
        owner: byId.get(edge.from)?.fields?.name,
        from: byId.get(edge.to)?.provenance.file,
        target: byId.get(edge.to)?.fields?.path,
      })),
  };
}

const folder = '.claude/skills/parcels';
const skill = `${folder}/SKILL.md`;
const notes = `${folder}/references/notes.md`;
const more = `${folder}/references/more.md`;

describe('a unit stores an edge for each citation in a file it owns, and no more', () => {
  it('attaches the reference of its own file and the one of a bundled file it reads', async () => {
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [notes]: '# Notes\nRead `more.md`.\n',
      [more]: '# More\n',
    });
    expect(result.references).toHaveLength(2);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { owner: 'parcels', from: skill, target: notes },
        { owner: 'parcels', from: notes, target: more },
      ]),
    );
    expect(result.edges).toHaveLength(2);
  });

  it('does not store what a file outside its folder cites', async () => {
    const helper = '.claude/agents/reviewer.md';
    const result = await referenceEdges({
      [helper]: definition('reviewer', 'Read `review-notes.md`.'),
      'review-notes.md': '# Notes\nRead `review-details.md`.\n',
      'review-details.md': '# Details\n',
    });
    expect(result.references).toHaveLength(2);
    expect(result.edges).toEqual([{ owner: 'reviewer', from: helper, target: 'review-notes.md' }]);
    const citations = citationsByFile(result.atoms);
    expect(filesReached(helper, citations)).toEqual(['review-details.md', 'review-notes.md']);
  });

  it('stores one edge for each citation of a unit however many files the cited file cites', async () => {
    const other = '.claude/skills/labels/SKILL.md';
    const guide = '.claude/shared/guide.md';
    const listed = Array.from({ length: 30 }, (_, n) => `Read \`.claude/shared/entry-${n}.md\`.`).join('\n');
    const result = await referenceEdges({
      [skill]: definition('parcels', `Read \`${guide}\`.`),
      [other]: definition('labels', `Read \`${guide}\`.`),
      [guide]: `# Guide\n${listed}\n`,
      ...Object.fromEntries(
        Array.from({ length: 30 }, (_, n) => [`.claude/shared/entry-${n}.md`, `# Entry ${n}\n`]),
      ),
    });
    expect(result.references).toHaveLength(32);
    expect(result.edges).toEqual([
      { owner: 'labels', from: other, target: guide },
      { owner: 'parcels', from: skill, target: guide },
    ]);
  });

  it('derives what each unit reaches by following the citations, through a shared file', async () => {
    const other = '.claude/skills/labels/SKILL.md';
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `.claude/shared/guide.md`.'),
      [other]: definition('labels', 'Read `.claude/shared/guide.md`.'),
      '.claude/shared/guide.md': '# Guide\nRead `.claude/shared/deep.md`.\n',
      '.claude/shared/deep.md': '# Deep\nRead `.claude/shared/deeper.md`.\n',
      '.claude/shared/deeper.md': '# Deeper\n',
    });
    const citations = citationsByFile(result.atoms);
    for (const start of [skill, other])
      expect(filesReached(start, citations)).toEqual([
        '.claude/shared/deep.md',
        '.claude/shared/deeper.md',
        '.claude/shared/guide.md',
      ]);
  });

  it('keeps the citation of a file two units read as one edge for each unit', async () => {
    const other = '.claude/skills/labels/SKILL.md';
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [other]: definition('labels', `Read \`${notes}\`.`),
      [notes]: '# Notes\nRead `more.md`.\n',
      [more]: '# More\n',
    });
    expect(result.references).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
    expect(result.edges).toContainEqual({ owner: 'labels', from: other, target: notes });
    expect(result.edges).toContainEqual({ owner: 'parcels', from: notes, target: more });
    expect(result.edges).not.toContainEqual({ owner: 'labels', from: notes, target: more });
  });

  it('terminates a reference cycle without duplicate edges', async () => {
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [notes]: '# Notes\nRead `more.md`.\n',
      [more]: '# More\nRead `notes.md`.\n',
    });
    expect(result.references).toHaveLength(3);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { owner: 'parcels', from: notes, target: more },
        { owner: 'parcels', from: more, target: notes },
      ]),
    );
    expect(result.edges).toHaveLength(3);
    const citations = citationsByFile(result.atoms);
    expect(filesReached(skill, citations)).toEqual([more, notes].sort());
  });

  it('does not assign ownership to an unread sibling just because it shares a skill folder', async () => {
    const sibling = `${folder}/references/unused.md`;
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [notes]: '# Notes\n',
      [sibling]: '# Unused\nRead `more.md`.\n',
      [more]: '# More\n',
    });
    expect(result.references).toHaveLength(2);
    expect(result.edges).toEqual([{ owner: 'parcels', from: skill, target: notes }]);
  });
});

describe('a unit that cites its own file ends the walk', () => {
  const skillFile = '.claude/skills/self/SKILL.md';
  it('a skill that reads its own definition file', async () => {
    const result = await referenceEdges({ [skillFile]: definition('self', 'Read `SKILL.md` again.') });
    expect(result.references).toHaveLength(1);
    expect(filesReached(skillFile, citationsByFile(result.atoms))).toEqual([]);
  });
  it('a helper that reads its own definition file', async () => {
    const helper = '.claude/agents/mirror.md';
    const result = await referenceEdges({
      [helper]: definition('mirror', 'Read `.claude/agents/mirror.md`.'),
    });
    expect(filesReached(helper, citationsByFile(result.atoms))).toEqual([]);
  });
  it('a skill and a bundled file that read each other', async () => {
    const other = '.claude/skills/self/references/back.md';
    const result = await referenceEdges({
      [skillFile]: definition('self', 'Read `references/back.md`.'),
      [other]: '# Back\nRead `../SKILL.md`.\n',
    });
    expect(result.edges.length).toBeLessThanOrEqual(2);
    expect(filesReached(skillFile, citationsByFile(result.atoms))).toEqual([other]);
  });
  it('the plan of each of these estates finishes', async () => {
    const helper = '.claude/agents/mirror.md';
    const other = '.claude/skills/self/references/back.md';
    const estates: Array<Record<string, string>> = [
      { [skillFile]: definition('self', 'Read `SKILL.md` again.') },
      { [helper]: definition('mirror', 'Read `.claude/agents/mirror.md`.') },
      {
        [skillFile]: definition('self', 'Read `references/back.md`.'),
        [other]: '# Back\nRead `../SKILL.md`.\n',
      },
    ];
    for (const files of estates) {
      const root = await estate(files);
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      const approved = { ...map, atoms: map.atoms.map((atom) => ({ ...atom, approved: true })) };
      expect(buildPlan(approved).plan.rows.length).toBeGreaterThan(0);
    }
  });
});

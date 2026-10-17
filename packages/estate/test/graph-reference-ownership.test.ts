import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../src/index';
import { estate, NOW } from './support';

const definition = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Review fictional parcels.\n---\n${body}\n`;

async function referenceEdges(files: Record<string, string>) {
  const root = await estate(files);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  return {
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

describe('reference ownership follows explicit reference chains', () => {
  it('attaches both the direct and nested reference to the skill', async () => {
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

  it('propagates helper ownership through a reference outside its definition folder', async () => {
    const helper = '.claude/agents/reviewer.md';
    const result = await referenceEdges({
      [helper]: definition('reviewer', 'Read `review-notes.md`.'),
      'review-notes.md': '# Notes\nRead `review-details.md`.\n',
      'review-details.md': '# Details\n',
    });
    expect(result.references).toHaveLength(2);
    expect(result.edges).toContainEqual({
      owner: 'reviewer',
      from: 'review-notes.md',
      target: 'review-details.md',
    });
    expect(result.edges).toHaveLength(2);
  });

  it('retains every explicit owner of a shared reference', async () => {
    const other = '.claude/skills/labels/SKILL.md';
    const result = await referenceEdges({
      [skill]: definition('parcels', 'Read `references/notes.md`.'),
      [other]: definition('labels', `Read \`${notes}\`.`),
      [notes]: '# Notes\nRead `more.md`.\n',
      [more]: '# More\n',
    });
    expect(result.references).toHaveLength(3);
    expect(result.edges.filter((edge) => edge.from === notes)).toEqual(
      expect.arrayContaining([
        { owner: 'parcels', from: notes, target: more },
        { owner: 'labels', from: notes, target: more },
      ]),
    );
    expect(result.edges).toHaveLength(4);
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

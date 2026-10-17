import { expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

it('keeps both declarations and reports the files sharing a skill name', async () => {
  const raw = await new ClaudeCodeReader().read(
    await estate({
      '.claude/skills/first/SKILL.md': '---\nname: audit\n---\nFirst procedure.\n',
      '.claude/skills/second/SKILL.md': '---\nname: audit\n---\nSecond procedure.\n',
    }),
  );
  expect(raw.skills.map((skill) => skill.name)).toEqual(['audit', 'audit']);
  expect(
    raw.notes.some((note) => note.message.includes('audit') && note.message.includes('first/SKILL.md')),
  ).toBe(true);
});

it('reports each later collision against the first declaration', async () => {
  const raw = await new ClaudeCodeReader().read(
    await estate({
      '.claude/skills/a/SKILL.md': '---\nname: archive\n---\nFirst.\n',
      '.claude/skills/b/SKILL.md': '---\nname: archive\n---\nSecond.\n',
      '.claude/skills/c/SKILL.md': '---\nname: archive\n---\nThird.\n',
      '.claude/skills/d/SKILL.md': '---\nname: dispatch\n---\nDifferent.\n',
    }),
  );
  expect(raw.skills).toHaveLength(4);
  const collisions = raw.notes.filter((note) => note.message.includes('duplicate skill name'));
  expect(collisions.map((note) => note.file)).toEqual([
    '.claude/skills/b/SKILL.md',
    '.claude/skills/c/SKILL.md',
  ]);
  expect(collisions.every((note) => note.message.includes('a/SKILL.md'))).toBe(true);
});

it('does not retain a name index across reads using the same reader', async () => {
  const reader = new ClaudeCodeReader();
  await reader.read(
    await estate({
      '.claude/skills/first/SKILL.md': '---\nname: audit\n---\nFirst.\n',
    }),
  );
  const raw = await reader.read(
    await estate({
      '.claude/skills/second/SKILL.md': '---\nname: audit\n---\nSecond.\n',
    }),
  );
  expect(raw.skills).toHaveLength(1);
  expect(raw.notes.filter((note) => note.message.includes('duplicate skill name'))).toEqual([]);
});

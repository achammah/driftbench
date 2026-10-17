import { mkdir, realpath, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

it.each(['guide.md', 'documents/guide.md'])(
  'never reads an external symlink that a standing file names: %s',
  async (path) => {
    const outside = await estate({ 'secret.md': 'FICTIONAL EXTERNAL CONTENT\n' });
    const root = await estate({ 'CLAUDE.md': `# Parcels\nRead \`${path}\` first.\n` });
    await mkdir(dirname(join(root, path)), { recursive: true });
    await symlink(join(outside, 'secret.md'), join(root, path));
    const reader = new ClaudeCodeReader();
    const raw = await reader.read(root);
    expect(raw.files.map((file) => file.path)).not.toContain(path);
    expect(raw.notes).toContainEqual({ file: path, message: expect.stringContaining('external') });
    expect(await reader.listFiles(root)).not.toContain(path);
    if (/guide\.md$/.test(path)) {
      const { map } = await scanEstate({ root, reader, now: NOW });
      const reference = map.atoms.find((atom) => atom.kind === 'reference');
      expect(reference?.fields?.external).toBe(true);
      expect(reference?.fields?.exists).toBe(false);
    }
  },
);

it('still follows a skills folder that the layout links to a shared library outside the estate', async () => {
  const outside = await estate({
    'parcels/SKILL.md':
      '---\nname: fictional-parcels\ndescription: Weighs parcels.\n---\nWeigh each parcel.\n',
  });
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  await mkdir(join(root, '.claude'), { recursive: true });
  await symlink(outside, join(root, '.claude', 'skills'));
  const reader = new ClaudeCodeReader();
  const raw = await reader.read(root);
  expect(raw.files.map((file) => file.path)).toContain('.claude/skills/parcels/SKILL.md');
  expect(raw.followedLinks).toEqual(['.claude/skills']);
  expect(JSON.stringify(raw.followedLinks)).not.toContain(await realpath(outside));
  const { map } = await scanEstate({ root, reader, now: NOW });
  expect(map.followedLinks).toEqual(raw.followedLinks);
});

it('records no followed link for a link that stays inside the estate', async () => {
  const root = await estate({
    'CLAUDE.md': '# Parcels\n',
    'library/parcels/SKILL.md':
      '---\nname: fictional-parcels\ndescription: Weighs parcels.\n---\nWeigh each parcel.\n',
  });
  await mkdir(join(root, '.claude'), { recursive: true });
  await symlink(join(root, 'library'), join(root, '.claude', 'skills'));
  const raw = await new ClaudeCodeReader().read(root);
  expect(raw.files.map((file) => file.path)).toContain('.claude/skills/parcels/SKILL.md');
  expect(raw.followedLinks).toEqual([]);
});

it('does not walk a root link outside .claude that no standing file names, and its CLAUDE.md never reaches prose', async () => {
  const outside = await estate({ 'CLAUDE.md': 'SENTINEL_NESTED_OTHERPROJECT instructions\n' });
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  await symlink(outside, join(root, 'ext'));
  const reader = new ClaudeCodeReader();
  const raw = await reader.read(root);
  expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md']);
  expect(raw.prose.map((chunk) => chunk.file)).not.toContain('ext/CLAUDE.md');
  expect(JSON.stringify(raw)).not.toContain('SENTINEL_NESTED_OTHERPROJECT');
  expect(raw.followedLinks).toEqual([]);
  expect(await reader.listFiles(root)).toEqual(['CLAUDE.md']);
});

it('lists only the links it read, never one it merely saw, and no host path', async () => {
  const outside = await estate({
    'secret.md': 'FICTIONAL\n',
    'parcels/SKILL.md': '---\nname: p\ndescription: d\n---\nWeigh.\n',
  });
  const root = await estate({ 'CLAUDE.md': '# Parcels\nRead `guide.md` first.\n' });
  await symlink(join(outside, 'secret.md'), join(root, 'guide.md'));
  await mkdir(join(root, '.claude'), { recursive: true });
  await symlink(join(outside, 'parcels'), join(root, '.claude', 'skills'));
  await symlink(join(outside, 'nowhere'), join(root, '.claude', 'dangling'));
  const raw = await new ClaudeCodeReader().read(root);
  expect(raw.followedLinks).toEqual(['.claude/skills']);
});

import { access, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, copyEstate, type EstateMap, scanEstate } from '../../src/index';
import { insideCopy } from '../../src/mutants/mutate';
import { estate, NOW } from '../support';

it('refuses traversal even when its immediate parent does not exist', async () => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  await expect(insideCopy(root, '../missing/parcel.txt')).rejects.toThrow(/outside/i);
});

it('refuses a dangling symlink whose target is outside', async () => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  const outside = await estate({});
  await symlink(join(outside, 'missing.txt'), join(root, 'parcel.txt'));
  await expect(insideCopy(root, 'parcel.txt')).rejects.toThrow(/outside/i);
});

it.each(['claude-code', 'unknown-runtime'])(
  'preflights every %s copy path from map provenance',
  async (runtime) => {
    const root = await estate({
      'CLAUDE.md': '# Parcels\nRead `guide.md` first.\n',
      'guide.md': 'Parcel notes.\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const to = await estate({});
    const hostile: EstateMap = {
      ...map,
      runtime,
      atoms: map.atoms.map((atom) => ({
        ...atom,
        provenance: { ...atom.provenance, file: '../escaped-parcel.txt' },
      })),
    };
    await expect(copyEstate(root, to, hostile)).rejects.toThrow(/outside/i);
    await expect(access(join(to, 'CLAUDE.md'))).rejects.toThrow();
  },
);

it('refuses a symlink in the destination before copying earlier files', async () => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n', '.claude/parcel.txt': 'new' });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const to = await estate({});
  const external = await estate({ 'parcel.txt': 'original' });
  await symlink(external, join(to, '.claude'));
  await expect(copyEstate(root, to, map)).rejects.toThrow(/outside/i);
  expect(await readFile(join(external, 'parcel.txt'), 'utf8')).toBe('original');
  await expect(access(join(to, 'CLAUDE.md'))).rejects.toThrow();
});

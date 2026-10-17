import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeReader, copyEstate, loadEstateMap, mutateEstate } from '../../src/index';
import { estate } from '../support';

const CASES = fileURLToPath(new URL('../../../../examples/estates/reader-cases/', import.meta.url));

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function fresh(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  folders.push(dir);
  return dir;
}

describe('the files of an estate a copy needs', () => {
  it('lists the standing files, .mcp.json and .claude, ignored folders left out, large files and links kept', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.mcp.json': '{}\n',
      'README.md': '# Not the estate\n',
      '.claude/settings.json': '{}\n',
      '.claude/node_modules/x/index.js': 'x\n',
      '.claude/hooks/tests/test_a.py': 'pass\n',
      '.claude/hooks/run.log': 'x\n',
      '.claude/skills/a/SKILL.md': '---\nname: a\n---\n\nDo a.\n',
      'shared/guide.md': '# Guide\n',
    });
    await writeFile(join(root, '.claude/big.md'), 'x'.repeat(1024 * 1024 + 1));
    await symlink('../shared/guide.md', join(root, '.claude/guide.md'));
    expect(await new ClaudeCodeReader().listFiles(root)).toEqual([
      '.claude/big.md',
      '.claude/guide.md',
      '.claude/settings.json',
      '.claude/skills/a/SKILL.md',
      '.mcp.json',
      'CLAUDE.md',
    ]);
  });
});

describe('the estate configuration travels with a copy', () => {
  it('copies driftbench.estate.yaml from the root or from .claude, and nothing else beside the estate files', async () => {
    for (const place of ['driftbench.estate.yaml', '.claude/driftbench.estate.yaml']) {
      const root = await estate({
        'CLAUDE.md': '# Rules\n',
        '.claude/settings.json': '{}\n',
        [place]: 'helpers: {}\n',
        'notes.md': '# Not the estate\n',
      });
      const loaded = { runtime: 'claude-code', atoms: [], edges: [] } as unknown as Parameters<
        typeof copyEstate
      >[2];
      const to = await fresh('driftbench-copy-');
      const copied = await copyEstate(root, to, loaded);
      expect(copied).toContain(place);
      expect(copied).not.toContain('notes.md');
      expect(await readFile(join(to, place), 'utf8')).toBe('helpers: {}\n');
    }
  });
});

describe('the estate copy of a mutant', () => {
  it('copies only the listed files, as real files with their modes, and never shares one with the source', async () => {
    const loaded = await loadEstateMap(join(CASES, 'approved.yaml'));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const to = await fresh('driftbench-copy-');
    const copied = await copyEstate(CASES, to, loaded.map);
    expect(copied).toEqual(
      [...(await new ClaudeCodeReader().listFiles(CASES)), 'driftbench.estate.yaml'].sort(),
    );
    for (const skipped of [
      '.claude/node_modules',
      '.claude/hooks/tests',
      '.claude/guards/tests',
      '.claude/guards/__pycache__',
      '.claude/guards/decisions.log',
      '.claude/archive',
      '.claude/skills/synced',
      '.claude/skills/.trash',
    ]) {
      expect(await stat(join(to, skipped)).catch(() => undefined), skipped).toBeUndefined();
    }
    // The linked scripts folder and reference arrive as real files.
    const linked = join(to, '.claude/skills/parcel-claims/scripts/track.sh');
    expect((await lstat(linked)).isSymbolicLink()).toBe(false);
    expect((await stat(join(to, '.claude/guards/block-force-push.sh'))).mode & 0o111).not.toBe(0);
    // A write in the copy leaves the source as it was: no file of the copy is the source's own.
    const source = join(CASES, '.claude/skills/parcel-claims/SKILL.md');
    const before = await readFile(source, 'utf8');
    await writeFile(join(to, '.claude/skills/parcel-claims/SKILL.md'), 'changed\n');
    expect(await readFile(source, 'utf8')).toBe(before);
    expect((await stat(source)).nlink).toBe(1);
  });

  it('mutates the listed copy as before', async () => {
    const loaded = await loadEstateMap(join(CASES, 'approved.yaml'));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const to = await fresh('driftbench-copy-mutant-');
    await copyEstate(CASES, to, loaded.map);
    const result = await mutateEstate(
      { root: to, map: loaded.map },
      { delete: 'instruction.parcel-claims.never-promise-a-refund-date' },
    );
    expect(result.after).not.toContain('refund date');
    expect(await readFile(join(CASES, '.claude/skills/parcel-claims/SKILL.md'), 'utf8')).toContain(
      'Never promise the user a refund date',
    );
  });
});

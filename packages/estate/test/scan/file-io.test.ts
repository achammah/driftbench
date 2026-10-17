import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeReader } from '../../src/scan/claude-code';
import { estate } from '../support';

const io = vi.hoisted(() => ({ active: 0, peak: 0, stats: [] as string[], realpaths: [] as string[] }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      io.peak = Math.max(io.peak, ++io.active);
      try {
        // Delay completion so this test detects independent reads waiting on each other.
        await setImmediate();
        return await fs.readFile(...args);
      } finally {
        io.active--;
      }
    },
    stat: (...args: Parameters<typeof fs.stat>) => {
      io.stats.push(String(args[0]));
      return fs.stat(...args);
    },
    realpath: (...args: Parameters<typeof fs.realpath>) => {
      io.realpaths.push(String(args[0]));
      return fs.realpath(...args);
    },
  };
});

beforeEach(() => {
  io.active = 0;
  io.peak = 0;
  io.stats = [];
  io.realpaths = [];
});

describe('filesystem scheduling keeps the reader deterministic', () => {
  it('overlaps independent file reads within a bounded number of open files', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 73 }, (_, index) => [`.claude/assets/note-${index}.txt`, `Note ${index}\n`]),
    );
    const root = await estate({ 'CLAUDE.md': '# Notes\n', ...files });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md', ...Object.keys(files).sort()]);
    for (const file of raw.files) {
      expect(file.text).toBe(file.path === 'CLAUDE.md' ? '# Notes\n' : files[file.path]);
    }
    expect(io.peak).toBeGreaterThan(1);
    expect(io.peak).toBeLessThanOrEqual(32);
  });

  it('reuses a linked file target stat for the size check', async () => {
    const root = await estate({ 'shared/note.txt': 'Delivery notes\n' });
    await mkdir(join(root, '.claude/assets'), { recursive: true });
    const path = join(root, '.claude/assets/copy.txt');
    await symlink('../../shared/note.txt', path);
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => [file.path, file.text])).toEqual([
      ['.claude/assets/copy.txt', 'Delivery notes\n'],
    ]);
    expect(io.stats.filter((entry) => entry === path)).toHaveLength(1);
  });

  it('carries canonical directory identity through ordinary child folders', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/memory/a/b/c/d/e/notes.md': '# Notes\n',
      'project/a/b/c/d/CLAUDE.md': '# Local rules\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => file.path)).toEqual([
      'CLAUDE.md',
      '.claude/memory/a/b/c/d/e/notes.md',
      'project/a/b/c/d/CLAUDE.md',
    ]);
    expect(io.realpaths.length).toBeLessThanOrEqual(2);
  });

  it('keeps sibling link aliases while stopping each alias cycle', async () => {
    const root = await estate({
      'source/notes.txt': 'Routing notes\n',
    });
    await mkdir(join(root, '.claude/assets'), { recursive: true });
    await symlink('.', join(root, 'source/loop'));
    await symlink('../../source', join(root, '.claude/assets/first'));
    await symlink('../../source', join(root, '.claude/assets/second'));
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => file.path)).toEqual([
      '.claude/assets/first/notes.txt',
      '.claude/assets/second/notes.txt',
    ]);
    expect(raw.notes.map((note) => note.file)).toEqual([
      '.claude/assets/first/loop',
      '.claude/assets/second/loop',
      'source/loop',
    ]);
  });

  it('reads changed content on a later scan with the same reader', async () => {
    const root = await estate({ 'CLAUDE.md': '# Earlier\n' });
    const reader = new ClaudeCodeReader();
    expect((await reader.read(root)).files[0]?.text).toBe('# Earlier\n');
    await writeFile(join(root, 'CLAUDE.md'), '# Revised\n');
    expect((await reader.read(root)).files[0]?.text).toBe('# Revised\n');
  });
});

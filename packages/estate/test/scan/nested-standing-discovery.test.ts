import { rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

describe('nested standing instructions', () => {
  it('discovers standing files without loading arbitrary nearby source files', async () => {
    const root = await estate({
      'CLAUDE.md': '# Main\n',
      'src/billing/CLAUDE.md': 'Always quote cents as integers.\n',
      'src/billing/CLAUDE.local.md': 'Keep local replies concise.\n',
      'src/billing/random.md': 'An unrelated document.\n',
      'src/billing/code.ts': 'export const unrelated = true;\n',
    });
    try {
      const reader = new ClaudeCodeReader();
      const raw = await reader.read(root);
      expect(raw.files.map((file) => file.path)).toEqual([
        'CLAUDE.md',
        'src/billing/CLAUDE.local.md',
        'src/billing/CLAUDE.md',
      ]);
      expect(raw.prose.map((chunk) => chunk.file)).toContain('src/billing/CLAUDE.md');
      expect(await reader.listFiles(root)).toContain('src/billing/CLAUDE.local.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prunes ignored trees, enforces size limits and stops directory symlink cycles', async () => {
    const root = await estate({
      'src/unit/CLAUDE.md': '# Unit\n',
      'node_modules/vendor/CLAUDE.md': '# Ignored dependency\n',
      'private/CLAUDE.md': '# Ignored custom folder\n',
      'huge/CLAUDE.md': 'x'.repeat(1024 * 1024 + 1),
      'driftbench.estate.yaml': 'ignore: [private/]\n',
    });
    await symlink('.', join(root, 'src/unit/back'));
    try {
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.files.map((file) => file.path)).toEqual(['src/unit/CLAUDE.md']);
      expect(raw.notes).toContainEqual({ file: 'huge/CLAUDE.md', message: 'skipped: larger than 1 MB' });
      expect(
        raw.notes.some((note) => note.file === 'src/unit/back' && note.message.includes('link back')),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

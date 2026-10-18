import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('standing imports', () => {
  it('treats standalone standing imports as standing files and follows finite chains exactly once', async () => {
    const root = await estate({
      'CLAUDE.md': '@.claude/docs/base.md\n',
      '.claude/docs/base.md': '@detail.txt\nAlways identify the record.\n',
      '.claude/docs/detail.txt': '@base.md\nNever change an approved record.\n',
    });
    try {
      const raw = await new ClaudeCodeReader().read(root);
      expect(
        raw.files
          .filter((file) => file.kind === 'standing')
          .map((file) => file.path)
          .sort(),
      ).toEqual(['.claude/docs/base.md', '.claude/docs/detail.txt', 'CLAUDE.md']);
      expect(raw.prose.filter((chunk) => chunk.file === '.claude/docs/base.md')).toHaveLength(1);
      expect(raw.prose.filter((chunk) => chunk.file === '.claude/docs/detail.txt')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('gives an import no reference atom: the runtime loads it, the agent reads nothing', async () => {
    const root = await estate({
      'CLAUDE.md': '@.claude/docs/base.md\nRead `.claude/docs/extra.md` when a refund is disputed.\n',
      '.claude/docs/base.md': 'Always identify the record.\n',
      '.claude/docs/extra.md': 'Never refund twice.\n',
    });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      const references = map.atoms
        .filter((atom) => atom.kind === 'reference')
        .map((atom) => atom.fields?.path);
      expect(references).toEqual(['.claude/docs/extra.md']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

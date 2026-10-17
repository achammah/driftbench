import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

describe('helper definitions in team subfolders', () => {
  it('reads nested helper contracts while honoring ignored folders', async () => {
    const definition =
      '---\nname: checker\ndescription: Check fictional records.\ntools: Read\n---\nNever edit a record.\n';
    const root = await estate({
      '.claude/agents/team/checker.md': definition,
      '.claude/agents/node_modules/unused.md': definition.replace('checker', 'unused'),
    });
    try {
      const raw = await new ClaudeCodeReader().read(root);
      expect(
        raw.subagents.map(({ name, file, tools }) => [name, file, tools.map((tool) => tool.value)]),
      ).toEqual([['checker', '.claude/agents/team/checker.md', ['Read']]]);
      expect(raw.prose.find((chunk) => chunk.file === '.claude/agents/team/checker.md')?.text).toContain(
        'Never edit a record.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

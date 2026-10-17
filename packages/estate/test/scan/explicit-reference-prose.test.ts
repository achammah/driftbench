import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

const definition = '---\nname: review\ndescription: Review fictional records.\n---\n';
describe('explicitly loaded document prose', () => {
  it('includes named text references and existing documents outside skill folders, leaving unrelated text unopened', async () => {
    const root = await estate({
      'CLAUDE.md': 'Read `.claude/docs/policy.md` for policy questions.\n',
      '.claude/docs/policy.md': 'Never infer a fictional approval.\n',
      '.claude/docs/unrelated.md': 'This file is not named.\n',
      '.claude/skills/review/SKILL.md': `${definition}Read \`references/policy.txt\`.\n`,
      '.claude/skills/review/references/policy.txt': 'Always show the record identifier.\n',
      '.claude/skills/review/references/unrelated.txt': 'This file is not named either.\n',
    });
    try {
      const raw = await new ClaudeCodeReader().read(root);
      const prose = raw.prose.map((chunk) => chunk.file);
      expect(prose).toContain('.claude/docs/policy.md');
      expect(prose).toContain('.claude/skills/review/references/policy.txt');
      expect(prose).not.toContain('.claude/docs/unrelated.md');
      expect(prose).not.toContain('.claude/skills/review/references/unrelated.txt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('follows explicit root-relative documents and lists them for copying', async () => {
    const root = await estate({
      'CLAUDE.md': 'Read `policy/guide.md`.\n',
      'policy/guide.md': 'Read `detail.txt`.\n',
      'policy/detail.txt': 'Always include the fictional record code.\n',
      'policy/unused.txt': 'Unrelated.\n',
    });
    try {
      const reader = new ClaudeCodeReader();
      const raw = await reader.read(root);
      expect(raw.prose.map((chunk) => chunk.file)).toEqual([
        'CLAUDE.md',
        'policy/guide.md',
        'policy/detail.txt',
      ]);
      expect(await reader.listFiles(root)).toContain('policy/detail.txt');
      expect(raw.files.some((file) => file.path === 'policy/unused.txt')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not follow ignored, forbidden, commented, fenced, or oversized references', async () => {
    const root = await estate({
      'CLAUDE.md': [
        '@private/policy.md',
        'Do not read `forbidden/guide.md`.',
        '<!-- @commented/guide.md -->',
        '```markdown',
        '@example/guide.md',
        '```',
        'Read `large/guide.md`.',
      ].join('\n'),
      'private/policy.md': '# Private\n',
      'forbidden/guide.md': '# Forbidden\n',
      'commented/guide.md': '# Comment\n',
      'example/guide.md': '# Example\n',
      'large/guide.md': 'x'.repeat(1024 * 1024 + 1),
      'driftbench.estate.yaml': 'ignore: [private/]\n',
    });
    try {
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.prose.map((chunk) => chunk.file)).toEqual(['CLAUDE.md']);
      expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not send a named file that code reads as structure again as prose', async () => {
    const root = await estate({
      'CLAUDE.md':
        'The check registry is `.claude/guards/check-registry.md`; paths follow `.claude/path-aliases.md`.\n',
      '.claude/guards/check-registry.md':
        '| Id | Guard | Enforces |\n|---|---|---|\n| G1 | check.sh | R1 |\n',
      '.claude/path-aliases.md': '| Alias | Path |\n|---|---|\n| REF | .claude/docs |\n',
    });
    try {
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.prose.map((chunk) => chunk.file)).toEqual(['CLAUDE.md']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

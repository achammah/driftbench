import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

it('resolves a shared dispatcher and retains each target rule and registry verdict', async () => {
  const files: Record<string, string> = {
    'CLAUDE.md': '# Editorial workspace\n',
    '.claude/hooks/relay.py': 'import sys, runpy\nrunpy.run_path(sys.argv[1], run_name="__main__")\n',
  };
  const hooks = [];
  const checks = [];
  for (let index = 0; index < 36; index++) {
    const id = `COPY-${index}`;
    const script = `.claude/hooks/editor-${index}.py`;
    files[script] = [
      '#!/usr/bin/env python3',
      '"""Require a source citation before replacing an editorial assertion."""',
      'import sys',
      `CHECK_ID = "${id}"`,
      'reason = "Read the cited source before replacing the assertion."',
      'if len(sys.argv) > 1:',
      '    print(reason, file=sys.stderr)',
      '    sys.exit(2)',
      '',
    ].join('\n');
    hooks.push({
      type: 'command',
      command: `python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/relay.py ${script}`,
    });
    checks.push({
      id,
      command: `python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/relay.py ${script}`,
      description: `Require a citation for editorial section ${index}.`,
      verdict: index % 2 ? 'warn' : 'deny',
      state: index % 2 ? 'observe' : 'enforce',
    });
  }
  files['.claude/settings.json'] = JSON.stringify(
    { hooks: { PreToolUse: [{ matcher: 'Edit', hooks }] } },
    null,
    2,
  );
  files['.claude/check-registry.json'] = JSON.stringify({ checks }, null, 2);
  const root = await estate(files);
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const guards = map.atoms.filter((atom) => atom.kind === 'guard');
    const covered = guards.filter(
      (atom) => typeof atom.fields?.ruleText === 'string' && atom.fields.ruleText.length > 0,
    ).length;
    console.log(JSON.stringify({ guards: { total: guards.length, covered } }));
    expect(guards).toHaveLength(36);
    expect(covered).toBe(36);
    for (const guard of guards) {
      const index = Number(/editor-(\d+)\.py$/.exec(String(guard.fields?.script))?.[1]);
      expect(Number.isNaN(index)).toBe(false);
      expect(guard.fields?.dispatcher).toBe('.claude/hooks/relay.py');
      expect(guard.fields?.ruleText).toContain('Require a source citation');
      expect(guard.fields?.ruleText).toContain('Read the cited source');
      expect(guard.fields?.ruleText).toContain(`Require a citation for editorial section ${index}.`);
      expect(guard.fields?.state).toBe(index % 2 ? 'observe' : 'enforce');
      expect(guard.evidence).toContainEqual({
        type: 'guard',
        name: `editor-${index}.py`,
        verdict: index % 2 ? 'warn' : 'deny',
      });
      const sources = guard.fields?.ruleSources as Array<{
        file: string;
        quote: string;
        startLine: number;
        endLine: number;
      }>;
      expect(sources.some((source) => source.file === guard.fields?.script)).toBe(true);
      for (const source of sources) {
        expect(
          files[source.file]
            ?.split('\n')
            .slice(source.startLine - 1, source.endLine)
            .join('\n')
            .trim(),
        ).toBe(source.quote.trim());
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('reads markdown descriptions and catalogue watches without fabricating enforcement from prose', async () => {
  const root = await estate({
    'CLAUDE.md': '# Workspace\n',
    '.claude/settings.json': JSON.stringify(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'sh .claude/hooks/review.sh' }] }] } },
      null,
      2,
    ),
    '.claude/hooks/review.sh':
      '#!/bin/sh\n# FINAL-CHECK checks the citations before a reply.\necho "Verify citations before replying." >&2\nexit 2\n',
    '.claude/review-registry.md':
      '| Id | Hook | Description | Verdict | State |\n|---|---|---|---|---|\n| FINAL-CHECK | review.sh | Require citations for factual claims. | deny | enforce |\n',
    '.claude/check-catalogue.json': JSON.stringify(
      {
        checks: [
          {
            id: 'EDITORIAL',
            event: 'Stop',
            kind: 'check',
            watches: 'Every factual claim has a citation.',
            work: 'Inspect the reply.',
            status: 'observe',
            verdict: 'warn',
          },
        ],
      },
      null,
      2,
    ),
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const guards = map.atoms.filter((atom) => atom.kind === 'guard');
    const shell = guards.find((atom) => atom.fields?.name === 'review.sh');
    expect(shell?.fields?.ruleText).toContain('Require citations for factual claims.');
    expect(shell?.fields?.ruleText).toContain('Verify citations before replying.');
    expect(shell?.evidence[0]).toMatchObject({ verdict: 'deny' });
    const catalogue = guards.find((atom) => atom.fields?.name === 'EDITORIAL');
    expect(catalogue?.fields?.ruleText).toContain('Every factual claim has a citation.');
    expect(catalogue?.evidence[0]).toMatchObject({ verdict: 'warn' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['.json', '.yaml', '.md'])(
  'recognizes check mappings by structure in an unnamed %s file',
  async (extension) => {
    const description = 'Require an editorial citation before closing the review.';
    const records: Record<string, string> = {
      '.json': JSON.stringify({ checks: { 'CITE-READY': { description, verdict: 'deny' } } }, null, 2),
      '.yaml': `checks:\n  CITE-READY:\n    description: ${description}\n    verdict: deny\n`,
      '.md': `| Id | Description | Verdict |\n|---|---|---|\n| CITE-READY | ${description} | deny |\n`,
    };
    const root = await estate({
      'CLAUDE.md': '# Editorial workspace\n',
      '.claude/hooks/review.py': '"""CITE-READY requires citations before closing."""\n',
      '.claude/settings.json': JSON.stringify(
        { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python3 .claude/hooks/review.py' }] }] } },
        null,
        2,
      ),
      [`.claude/checks/overview${extension}`]: records[extension] ?? '',
    });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      const guard = map.atoms.find((atom) => atom.kind === 'guard');
      expect(guard?.fields?.ruleText).toContain(description);
      expect(guard?.evidence[0]).toMatchObject({ verdict: 'deny' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it('uses documented dispatch roles and keeps source messages separate from implementation data', async () => {
  const root = await estate({
    'CLAUDE.md': '# Workspace\n',
    '.claude/settings.json': JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'python3 .claude/hooks/runner.py --entry .claude/hooks/citation.js',
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
    '.claude/hooks/runner.py': 'import opaque_runtime\nopaque_runtime.start()\n',
    '.claude/hooks/usage.md':
      'Usage: .claude/hooks/runner.py --entry FILE\nThe --entry argument names the script.\n',
    '.claude/hooks/citation.js':
      '/** Require citations before closing an editorial review. */\nconst reason = "Read each source before marking the review complete.";\nconst unused = "This text is implementation data, never printed.";\nconsole.warn(reason);\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const guard = map.atoms.find((atom) => atom.kind === 'guard');
    expect(guard?.fields?.script).toBe('.claude/hooks/citation.js');
    expect(guard?.fields?.ruleText).toContain('Require citations');
    expect(guard?.fields?.ruleText).toContain('Read each source');
    expect(guard?.fields?.ruleText).not.toContain('implementation data');
    expect(guard?.evidence[0]).not.toHaveProperty('verdict');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('does not mistake ordinary task status tables for check registries', async () => {
  const root = await estate({
    'CLAUDE.md': '# Workspace\n',
    '.claude/planning/status.json': JSON.stringify(
      { entries: { 'DRAFT-READY': { description: 'Prepare the editorial index.', status: 'done' } } },
      null,
      2,
    ),
    '.claude/planning/status.md':
      '| Id | Description | Status |\n|---|---|---|\n| DRAFT-READY | Prepare the editorial index. | done |\n',
  });
  try {
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const SETTINGS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py' }],
      },
    ],
  },
});
const RULES = '# Rules\n\n- **R1.** Never delete a file under the archive folder.\n';

describe('forms the reader reads (executor pilot)', () => {
  it('reads a catalogue of checks: entries under hooks, the guard as a hook path, the rules under rules', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': 'import sys\nsys.exit(0)\n',
      '.claude/hooks/catalogue.json': JSON.stringify(
        { hooks: [{ id: 'C1', hook: '.claude/hooks/shell.py', rules: ['R1'] }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry.map((row) => [row.id, row.guard, row.enforces])).toEqual([
      ['C1', 'shell.py', [{ id: 'R1' }]],
    ]);
  });
});

describe('named paths (executor pilot)', () => {
  it('names the file of a path with an anchor, a query or a link title, and no web address', async () => {
    const { namedPaths } = await import('../../src/scan/code');
    expect(namedPaths('See [the guide](references/guide.md#limits "Guide").')).toEqual([
      'references/guide.md',
    ]);
    expect(namedPaths('Open `references/guide.md?raw`.')).toEqual(['references/guide.md']);
    expect(namedPaths('The guide is at `https://example.com/guide.md`.')).toEqual([]);
  });
});

describe('hazard words (executor pilot)', () => {
  it('reads compaction from the noun and the participle, not from the adjective compact', async () => {
    const { HAZARDS } = await import('../../src/scan/code');
    const compaction = HAZARDS.find((hazard) => hazard.id === 'compaction');
    expect(compaction?.pattern.test('Recover after a compaction of the context.')).toBe(true);
    expect(compaction?.pattern.test('Once the context is compacted, re-read the notes.')).toBe(true);
    expect(compaction?.pattern.test('Keep the report in a compact table.')).toBe(false);
  });
});

/** A port that answers every chunk with no prose atom: the tests below read code atoms only. */
const silent = {
  family: 'test',
  model: 'by hand',
  async complete(request: { user: string }) {
    const chunk = /CHUNK: (\S+)/.exec(request.user)?.[1] ?? '';
    return JSON.stringify({ chunk, atoms: [] });
  },
};

/** The atoms of one skill whose body is the given lines. */
async function skillAtoms(body: string[], extra: Record<string, string> = {}) {
  const root = await estate({
    'CLAUDE.md': '# Rules\n',
    '.claude/skills/tally/SKILL.md': [
      '---',
      'name: tally',
      'description: Tally tickets.',
      '---',
      '',
      ...body,
      '',
    ].join('\n'),
    ...extra,
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port: silent, now: NOW });
  return map.atoms;
}

describe('gates (executor pilot)', () => {
  it('drops the markup around the act and the file of a gate', async () => {
    const atoms = await skillAtoms(['**Before editing a ticket**: read `references/rules.md`.'], {
      '.claude/skills/tally/references/rules.md': '# Rules\n',
    });
    const gate = atoms.find((atom) => atom.kind === 'gate');
    expect(gate?.fields?.trigger).toBe('editing a ticket');
    expect(gate?.fields?.first).toBe('references/rules.md');
  });
});

describe('code fences (executor pilot)', () => {
  it('reads no gate, reference or hazard from a fenced example', async () => {
    const atoms = await skillAtoms([
      'Always tally twice.',
      '',
      '```text',
      'Before editing a file: read `references/example.md`.',
      'log: restart of the worker after a compaction',
      '```',
    ]);
    expect(atoms.filter((atom) => ['gate', 'reference', 'hazard'].includes(atom.kind))).toEqual([]);
  });
});

describe('registry columns (executor pilot)', () => {
  it('reads the rules of a guard from a Gates, Covers, Enforced rules or Rule ids column, and from bold headers', async () => {
    for (const header of ['Gates', 'Covers', 'Enforced rules', 'Rule ids', '**Enforces**']) {
      const root = await estate({
        'CLAUDE.md': RULES,
        '.claude/settings.json': SETTINGS,
        '.claude/hooks/shell.py': 'import sys\nsys.exit(0)\n',
        '.claude/hooks/CHECK-REGISTRY.md': `| **Guard** | ${header} |\n|---|---|\n| shell.py | R1 |\n`,
      });
      const raw = await new ClaudeCodeReader().read(root);
      expect(
        raw.registry.map((row) => [row.guard, row.enforces]),
        header,
      ).toEqual([['shell.py', [{ id: 'R1' }]]]);
    }
  });
});

describe('dispatchers (executor pilot)', () => {
  it('finds the script a dispatcher runs from a bare target name', async () => {
    const { scriptOf } = await import('../../src/scan/claude-code');
    const paths = new Set(['.claude/hooks/lib/run.py', '.claude/hooks/block-push.py']);
    expect(
      scriptOf(
        'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py block-push',
        paths,
        new Map([['.claude/hooks/lib/run.py', 'import sys, runpy\nrunpy.run_path(sys.argv[1])\n']]),
      ),
    ).toEqual({
      script: '.claude/hooks/block-push.py',
      anchored: true,
      dispatcher: '.claude/hooks/lib/run.py',
    });
  });
});

describe('YAML data files (executor pilot)', () => {
  it('reads a YAML registry and a YAML step list', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': 'import sys\nsys.exit(0)\n',
      '.claude/hooks/registry.yaml': 'checks:\n  - id: G1\n    guard: shell.py\n    enforces: [R1]\n',
      '.claude/steps.yaml': 'steps:\n  - id: plan\n    next: [do]\n  - id: do\n    next: []\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry.map((row) => [row.id, row.guard, row.enforces])).toEqual([
      ['G1', 'shell.py', [{ id: 'R1' }]],
    ]);
    expect(raw.steps.map((step) => [step.id, step.at.startLine, step.next])).toEqual([
      ['plan', 2, ['do']],
      ['do', 4, []],
    ]);
  });
});

describe('command wrappers (executor pilot)', () => {
  it('finds the script behind exec, timeout with its limit and uv run', async () => {
    const { scriptOf } = await import('../../src/scan/claude-code');
    for (const command of [
      'exec python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py',
      'timeout 5 python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py',
      'uv run "$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py',
    ]) {
      expect(scriptOf(command), command).toEqual({ script: '.claude/hooks/shell.py', anchored: true });
    }
  });
});

describe('gate events (executor pilot)', () => {
  it('reads a gate only before an act of the agent, not before a meal, a time, a feeling or a past event', async () => {
    const atoms = await skillAtoms(
      [
        'Before editing a ticket: read `references/rules.md`.',
        'Before every ticket edit, read `references/rules.md` again.',
        'Before lunch: read nothing heavy, then rest.',
        'Read `references/rules.md` before 9 in the morning if you can.',
        'Do not panic until you have read the summary twice.',
        'We read `references/rules.md` before the audit last year, and it was fine.',
      ],
      { '.claude/skills/tally/references/rules.md': '# Rules\n' },
    );
    expect(atoms.filter((atom) => atom.kind === 'gate').map((atom) => atom.fields?.trigger)).toEqual([
      'editing a ticket',
      'every ticket edit',
    ]);
  });
});

describe('empty files (executor iteration 11)', () => {
  it('survives an empty skill definition and an empty standing file: noted, no atom', async () => {
    const root = await estate({
      'CLAUDE.md': '',
      '.claude/skills/menu-plan/SKILL.md': '',
      '.claude/skills/menu-plan/references/guide.md': '# Guide\n\nAbout menus.\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.notes.map((note) => note.file)).toEqual(
      expect.arrayContaining(['CLAUDE.md', '.claude/skills/menu-plan/SKILL.md']),
    );
    const scan = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const files = scan.map.atoms.map((atom) => atom.provenance.file);
    expect(files).not.toContain('CLAUDE.md');
    expect(files).not.toContain('.claude/skills/menu-plan/SKILL.md');
  });
});

describe('byte order mark (executor iteration 12)', () => {
  it('reads settings that start with a byte order mark', async () => {
    const root = await estate({
      '.claude/settings.json': '﻿{\n  "model": "sonnet"\n}\n',
    });
    const scan = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const setting = scan.map.atoms.find((atom) => atom.kind === 'setting');
    expect(setting?.provenance.startLine).toBe(2);
  });
});

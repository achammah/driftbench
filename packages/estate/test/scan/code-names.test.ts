import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const settings = JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 .claude/hooks/gate.py' }] }],
  },
});

async function lint(files: Record<string, string>) {
  const root = await estate(files);
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return { map, raw, result: lintEstate(map, raw) };
}

describe('files that code and registries name', () => {
  it('counts a file a script names as named and reachable, and leaves an unnamed neighbour a finding', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py':
        'import json\nREQUEST = "judges/check.request.json"\nSTATE = ".claude/hooks/state/seen.json"\n',
      '.claude/hooks/judges/check.request.json': '{"ask": "x"}\n',
      '.claude/hooks/judges/other.request.json': '{"ask": "y"}\n',
    });
    const subjects = result.findings
      .filter((finding) => finding.code === 'ORPHAN' || finding.code === 'UNREACHABLE')
      .map((finding) => `${finding.code} ${finding.subject}`);
    expect(subjects).toEqual(['ORPHAN .claude/hooks/judges/other.request.json']);
  });

  it('does not let a stray script that nothing names legitimise the files it mentions', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py': 'print("ok")\n',
      '.claude/hooks/old-tool.py': 'LOG = "stale-notes.json"\n',
      '.claude/hooks/stale-notes.json': '{}\n',
    });
    expect(
      result.findings
        .filter((finding) => finding.code === 'ORPHAN')
        .map((finding) => finding.subject)
        .sort(),
    ).toEqual(['.claude/hooks/old-tool.py', '.claude/hooks/stale-notes.json']);
  });

  it('does not report a runtime product named by code as a missing file, and still reports an unnamed one', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\nRead `.claude/guide.md`.\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py':
        'MARKER = ".claude/hooks/state/compacted.json"\nopen(MARKER, "w").write("1")\n',
      '.claude/guide.md':
        '# Guide\nAfter a restart, read `.claude/hooks/state/compacted.json`.\nRead `.claude/hooks/state/never-made.md`.\n',
    });
    const missing = result.findings.filter((finding) => finding.code === 'MISSING_REFERENCE');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('never-made.md');
  });

  it('does not let a bare file name in code hide an ambiguous or unrelated missing reference', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\nRead `README.md` first.\nRead `.claude/missing-guide.md`.\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py': 'NAMES = ["README.md", "missing-guide.md"]\n',
      '.claude/a/README.md': '# A\n',
      '.claude/b/README.md': '# B\n',
    });
    expect(result.counts.AMBIGUOUS_REFERENCE).toBe(1);
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });

  it('keeps a file nothing names an orphan when only prose in a navigation document mentions its folder', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py': 'print("ok")\n',
      '.claude/hooks/state/stray.json': '{}\n',
    });
    expect(
      result.findings.filter((finding) => finding.code === 'ORPHAN').map((finding) => finding.subject),
    ).toEqual(['.claude/hooks/state/stray.json']);
  });
});

describe('only a script that writes a path makes it a runtime product', () => {
  const guide = (path: string) => ({
    'CLAUDE.md': '# Rules\nRead `.claude/guide.md`.\n',
    '.claude/settings.json': settings,
    '.claude/guide.md': `# Guide\nRead \`${path}\` before editing.\n`,
  });

  it('keeps a missing file a finding when a script only reads it', async () => {
    for (const script of [
      'text = open(".claude/setup.md").read()\n',
      'text = open(".claude/setup.md", "r").read()\n',
      'SETUP = ".claude/setup.md"\nprint(open(SETUP).read())\n',
      'const text = fs.readFileSync(".claude/setup.md", "utf8");\n',
    ]) {
      const { result } = await lint({ ...guide('.claude/setup.md'), '.claude/hooks/gate.py': script });
      expect(result.counts.MISSING_REFERENCE).toBe(1);
    }
    const shell = await lint({
      ...guide('.claude/setup.md'),
      '.claude/hooks/gate.sh': '#!/bin/sh\ncat ".claude/setup.md"\n',
    });
    expect(shell.result.counts.MISSING_REFERENCE).toBe(1);
  });

  it('treats a path a script writes or creates, directly or through a constant, as made at run time', async () => {
    for (const [name, script] of [
      ['gate.py', 'open(".claude/made.md", "w").write("x")\n'],
      ['gate.py', 'import pathlib\nSTATE = ".claude/made.md"\npathlib.Path(STATE).write_text("x")\n'],
      ['gate.py', 'import os\nos.makedirs(".claude/made.md")\n'],
      ['gate.js', 'fs.writeFileSync(".claude/made.md", "x");\n'],
      ['gate.sh', '#!/bin/sh\necho 1 > ".claude/made.md"\n'],
      ['gate.sh', '#!/bin/sh\nF=.claude/made.md\ntouch "$F"\n'],
    ] as const) {
      const { result } = await lint({ ...guide('.claude/made.md'), [`.claude/hooks/${name}`]: script });
      expect(result.counts.MISSING_REFERENCE).toBe(0);
    }
  });

  it('does not count a registry or settings literal as written', async () => {
    const { result } = await lint({
      ...guide('.claude/made.md'),
      '.claude/hooks/CATALOGUE.json': JSON.stringify({ checks: [{ id: 'C1', marker: '.claude/made.md' }] }),
    });
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });
});

describe('counter-examples and fill-in values are not live references', () => {
  it('blanks a wrong example up to its right counterpart and keeps the live part of the line', async () => {
    const { map, result } = await lint({
      'CLAUDE.md':
        '# Rules\n✗ read `old/gone.md` → ✓ read `.claude/live.md`.\nWRONG: read `old/gone-two.md`.\n- Right: read `.claude/live.md`.\n',
      '.claude/live.md': '# Live\n',
    });
    expect(result.counts.MISSING_REFERENCE).toBe(0);
    expect(map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path)).toEqual([
      '.claude/live.md',
      '.claude/live.md',
    ]);
  });

  it('keeps live rules whose sentence uses wrong, bad, incorrect or a multiplication sign', async () => {
    const { map, result } = await lint({
      'CLAUDE.md': [
        '# Rules',
        'If the quantity is wrong: read `.claude/a1.md` before you edit the order.',
        'When a review is bad: read `.claude/a2.md` before you reply.',
        'If the total is incorrect: read `.claude/a3.md` before you send the invoice.',
        'Scale every recipe by 2 × 3, then read `.claude/a4.md` before you print it.',
        'If the count is wrong: read `.claude/a5.md` before you edit the list.',
        '',
      ].join('\n'),
      '.claude/a1.md': '#\n',
      '.claude/a2.md': '#\n',
      '.claude/a3.md': '#\n',
      '.claude/a4.md': '#\n',
      '.claude/a5.md': '#\n',
    });
    const read = map.atoms
      .filter((atom) => atom.kind === 'gate')
      .map((atom) => String(atom.fields?.path ?? atom.title));
    expect(read.join(' ')).toMatch(/a1/);
    expect(read.join(' ')).toMatch(/a2/);
    expect(read.join(' ')).toMatch(/a3/);
    expect(read.join(' ')).toMatch(/a4/);
    expect(read.join(' ')).toMatch(/a5/);
    expect(result.counts.ORPHAN).toBe(0);
  });

  it('still blanks a counter-example that opens a line, a list item or a table cell', async () => {
    const { map } = await lint({
      'CLAUDE.md': [
        '# Rules',
        'Wrong: read `.claude/never1.md` before you edit. Right: read `.claude/live.md` before you edit.',
        '- ✗ read `.claude/never2.md` first → ✓ read `.claude/live.md` first.',
        '> × read `.claude/never3.md` before you edit',
        '| ✗ read `.claude/never4.md` | ✓ read `.claude/live.md` |',
        '',
      ].join('\n'),
      '.claude/live.md': '#\n',
    });
    const paths = map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path);
    expect(paths.filter((path) => String(path).includes('never'))).toEqual([]);
    expect(paths.filter((path) => path === '.claude/live.md').length).toBeGreaterThanOrEqual(3);
  });

  it('treats a block after a standalone wrong marker as an example', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n\n✗\n\n> Read `old/gone.md` first.\n\nRead `real-missing/guide.md` first.\n',
    });
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });

  it('does not report a bracketed, doubled-letter or format-specifier path as missing', async () => {
    const { result } = await lint({
      'CLAUDE.md':
        '# Rules\nRead `logs/[session]/out.md`.\nRead `notes/YYYY-MM-DD.md`.\nRead `runs/XXX/report.md`.\nRead `notes/%s.md`.\nRead `real-missing/guide.md`.\n',
    });
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });
});

describe('reach by dispatch', () => {
  it('reaches a helper dispatched from a live skill', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\nRead `.claude/skills/editor/SKILL.md`.\n',
      '.claude/skills/editor/SKILL.md':
        '---\nname: editor\ndescription: Edit pages.\n---\n# Editing\nDispatch the `reviewer` agent after each edit.\n',
      '.claude/agents/reviewer.md':
        '---\nname: reviewer\ndescription: Reviews pages.\n---\n# Reviewer\nCheck the page.\n',
    });
    expect(result.findings.filter((finding) => finding.code === 'UNREACHABLE')).toEqual([]);
  });
});

describe('a sentence is not a path', () => {
  it('reads a long quoted sentence ending in a quote mark as no reference and does not crash the scan', async () => {
    const sentence = `Items that say ${'do exactly what they will do '.repeat(14)}instead of 'Footnote 3.'`;
    const { result } = await lint({
      'CLAUDE.md': `# Rules\nRead "${sentence}" before editing.\nRead \`real-missing/guide.md\`.\n`,
    });
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });

  it('quotes a hazard line as written when a counter-example on the same line is masked', async () => {
    const { map } = await lint({
      'CLAUDE.md':
        '# Rules\n✗ ignore the repeated guard nudges and read `old/gone.md` → ✓ after a compaction, stop and recover from repeated guard nudges.\n',
    });
    const hazard = map.atoms.find((atom) => atom.kind === 'hazard');
    expect(hazard?.provenance.quote).toContain('✗ ignore the repeated guard nudges');
  });
});

import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

export const subcommands = [
  ['.claude/hooks/lib/audit.py', 'status'],
  ['.claude/lib/tool.py', 'check'],
  ['.claude/hooks/dry-run.py', 'staged'],
  ['.claude/hooks/test-runner.py', 'unit'],
  ['.claude/hooks/rerun.sh', 'pending'],
  ['.claude/hooks/dispatch.py', 'inspect'],
  ['.claude/libs/command.py', 'verify'],
  ['.claude/hooks/run.py', 'PreToolUse'],
  ['.claude/hooks/build-runner.js', 'compile'],
  ['.claude/hooks/ship-dispatch.ts', 'preview'],
  ['.claude/hooks/check.py', 'strict'],
  ['.claude/hooks/main.py', 'help'],
];

describe('script dispatch requires source or usage evidence', () => {
  it.each([
    'import sys, subprocess\nsubprocess.run([sys.executable, "fixed.py", sys.argv[1]])\n',
    'import sys, runpy\npaths = {"check": "fixed.py"}\nrunpy.run_path(paths[sys.argv[1]])\n',
    'import sys, runpy\ntarget = sys.argv[1]\ntarget = "fixed.py"\nrunpy.run_path(target)\n',
    '# runpy.run_path(sys.argv[1])\nprint("a usage example")\n',
    '#!/bin/sh\nexec echo "$1"\n',
    'print("runpy.run_path(sys.argv[1])")\n',
  ])('does not infer a file from modes, maps, overwritten values or examples: %s', async (source) => {
    const script = '.claude/hooks/run.py';
    const root = await estate({
      [script]: source,
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `python3 ${script} check` }] }] },
      }),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.guards[0]?.script).toBe(script);
  });
  it.each([
    ['import sys, runpy\nrunpy.run_path(sys.argv[1])\n', 'worker.py'],
    ['import sys, subprocess\np = sys.argv[1]\nsubprocess.run([sys.executable, p])\n', 'worker'],
    ['#!/bin/sh\npython3 "$1"\n', 'worker.py'],
    ['"""Executes the script named by its first argument."""\n', 'worker'],
    ['"""Runs the script named by --file."""\n', '--file worker'],
  ])('retains existing dispatched targets: %s', async (source, argument) => {
    const script = '.claude/hooks/entry.py';
    const target = '.claude/hooks/worker.py';
    const root = await estate({
      [script]: source,
      [target]: 'print("worker")\n',
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `python3 ${script} ${argument}` }] }] },
      }),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.guards[0]?.script).toBe(target);
    expect(raw.guards[0]?.dispatcher).toBe(script);
  });
  it('reads an explicit usage paragraph beside the script', async () => {
    const script = '.claude/hooks/entry.py';
    const root = await estate({
      [script]: '# Implementation delegates to an imported helper.\n',
      '.claude/README.md':
        'Usage: python3 .claude/hooks/entry.py <script>\nExecutes the script file supplied as the first argument.\n',
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `python3 ${script} absent-worker` }] }] },
      }),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.guards[0]?.script).toBe('absent-worker');
  });
  it('resolves only the source-proven file argument, never later data files', async () => {
    const script = '.claude/hooks/entry.py';
    const root = await estate({
      [script]: 'import sys, runpy\nrunpy.run_path(sys.argv[1])\n',
      '.claude/hooks/worker.py': 'print("work")\n',
      '.claude/hooks/data.py': '# data\n',
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `python3 ${script} worker.py data.py` }] }] },
      }),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.guards[0]?.script).toBe('.claude/hooks/worker.py');
  });
  it.each(subcommands)('%s %s is a subcommand', async (script, arg) => {
    const root = await estate({
      [script]: script.endsWith('.sh')
        ? '#!/bin/sh\ncase "$1" in pending) echo queued;; esac\n'
        : /\.[jt]s$/.test(script)
          ? 'const mode = process.argv[2];\nconsole.log(mode);\n'
          : 'import sys\nmode = sys.argv[1]\nprint(mode)\n',
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `python3 ${script} ${arg}` }] }] },
      }),
    });
    const { raw, map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.guards[0]?.script).toBe(script);
    expect(lintEstate(map, raw).findings.filter((finding) => finding.code === 'MISSING_SCRIPT')).toEqual([]);
  });

  it.each([
    'import sys, runpy\nrunpy.run_path(sys.argv[1])\n',
    'import sys, subprocess\ntarget = sys.argv[1]\nsubprocess.run([sys.executable, target])\n',
    '#!/bin/sh\nexec python3 "$1"\n',
    'import { execFileSync } from "node:child_process";\nexecFileSync(process.argv[2]);\n',
    '# Usage: python main.py <script>\n# Executes the script file supplied as the first argument.\n',
  ])('finds missing file targets independently of filename: %s', async (source) => {
    const script = '.claude/hooks/main.py';
    const root = await estate({
      [script]: source,
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `python3 ${script} absent-worker` }] }] },
      }),
    });
    const { raw, map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.guards[0]?.script).toBe('absent-worker');
    expect(raw.guards[0]?.dispatcher).toBe(script);
    expect(lintEstate(map, raw).findings.some((finding) => finding.code === 'MISSING_SCRIPT')).toBe(true);
  });
});

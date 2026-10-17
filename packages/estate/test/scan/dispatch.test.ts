import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate, scriptOf } from '../../src/index';
import { estate, NOW } from '../support';
import { CASES } from './cases';

const SOURCE = 'import sys, runpy\nrunpy.run_path(sys.argv[1])\n';
const SOURCES = new Map([
  ['lib/dispatch.py', SOURCE],
  ['.claude/hooks/lib/run.py', SOURCE],
  ['hooks/hookrun.sh', '#!/bin/sh\nexec python3 "$1"\n'],
]);

const PATHS = new Set([
  '.claude/hooks/lib/run.py',
  '.claude/hooks/pretool.py',
  '.claude/hooks/lib/pretool.py',
  'lib/dispatch.py',
  'lib/guard.py',
  '.claude/hooks/stop.sh',
]);

describe('guard commands behind a prefix or a dispatcher', () => {
  it('passes over assignments, a shell test and env, and runs the interpreter path', () => {
    expect(scriptOf('ENV=1 python3 lib/guard.py --strict')).toEqual({
      script: 'lib/guard.py',
      anchored: false,
    });
    expect(scriptOf('[ "$QUIET" = "$PPID" ] || "$CLAUDE_PROJECT_DIR"/.claude/hooks/stop.sh')).toEqual({
      script: '.claude/hooks/stop.sh',
      anchored: true,
    });
    expect(scriptOf('env -i A=1 B=2 bash ./x.sh')).toEqual({ script: 'x.sh', anchored: false });
    expect(scriptOf('test -f a && echo done')).toEqual({ anchored: false });
    expect(scriptOf('echo done; true')).toEqual({ anchored: false });
  });

  it('takes the last path argument that exists, from the root or the folders of the dispatcher', () => {
    expect(scriptOf('ENV=1 python3 lib/dispatch.py guard.py', PATHS, SOURCES)).toEqual({
      script: 'lib/guard.py',
      anchored: false,
      dispatcher: 'lib/dispatch.py',
    });
    // The target sits next to the dispatcher's folder, one level up; the nearer file wins when both exist.
    expect(
      scriptOf(
        '[ "$Q" = "$PPID" ] || python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py pretool.py --fast',
        PATHS,
        SOURCES,
      ),
    ).toEqual({
      script: '.claude/hooks/lib/pretool.py',
      anchored: true,
      dispatcher: '.claude/hooks/lib/run.py',
    });
    expect(
      scriptOf('python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py stop.sh', PATHS, SOURCES),
    ).toEqual({
      script: '.claude/hooks/stop.sh',
      anchored: true,
      dispatcher: '.claude/hooks/lib/run.py',
    });
    // A target that exists nowhere is still the guard's script: the lint reports it missing.
    expect(scriptOf('python3 lib/dispatch.py gone.py', PATHS, SOURCES)).toEqual({
      script: 'gone.py',
      anchored: false,
      dispatcher: 'lib/dispatch.py',
    });
  });

  it('names the missing target of a dispatcher, and reads no target into a plain script argument', () => {
    const paths = new Set([...PATHS, 'tools/check.py', 'hooks/hookrun.sh']);
    expect(
      scriptOf('python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py no-such-hook', paths, SOURCES),
    ).toEqual({
      script: 'no-such-hook',
      anchored: true,
      dispatcher: '.claude/hooks/lib/run.py',
    });
    expect(scriptOf('sh hooks/hookrun.sh lint_on_save --fast', paths, SOURCES)).toEqual({
      script: 'lint_on_save',
      anchored: false,
      dispatcher: 'hooks/hookrun.sh',
    });
    // A hook event name or a flag is an argument, not a target.
    expect(scriptOf('python3 .claude/hooks/lib/run.py PreToolUse', paths)).toEqual({
      script: '.claude/hooks/lib/run.py',
      anchored: false,
    });
    expect(scriptOf('python3 .claude/hooks/lib/run.py --verbose', paths)).toEqual({
      script: '.claude/hooks/lib/run.py',
      anchored: false,
    });
    // A script that is no dispatcher keeps its plain argument.
    expect(scriptOf('python3 tools/check.py strict', paths)).toEqual({
      script: 'tools/check.py',
      anchored: false,
    });
  });

  it('lints a dispatched target that does not exist as a missing script', async () => {
    const root = await estate({
      'CLAUDE.md': '# Shop\n',
      '.claude/hooks/lib/run.py': SOURCE,
      '.claude/settings.json': JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py tidy-up',
                },
              ],
            },
          ],
        },
      }),
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const findings = lintEstate(map, raw).findings.filter((finding) => finding.code !== 'UNENFORCED');
    expect(findings.map((finding) => finding.code)).toEqual(['MISSING_SCRIPT']);
    expect(findings[0]?.message).toContain('names tidy-up');
  });

  it('reads the dispatched guard of a settings file, and its registry row by the target name', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command:
                    '[ "$QUIET" = 1 ] || MODE=x python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py reply.py',
                },
              ],
            },
          ],
        },
      }),
      '.claude/hooks/lib/run.py': SOURCE,
      '.claude/hooks/reply.py': 'import sys\n',
      '.claude/hooks/CHECK-REGISTRY.md': '| Id | Guard | Rules |\n|---|---|---|\n| H1 | reply.py | R1 |\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.guards.map((guard) => [guard.script, guard.dispatcher, guard.anchored])).toEqual([
      ['.claude/hooks/reply.py', '.claude/hooks/lib/run.py', true],
    ]);
    expect(raw.files.find((file) => file.path === '.claude/hooks/reply.py')?.kind).toBe('guard_script');
    expect(raw.registry.map((row) => row.guard)).toEqual(['reply.py']);
  });

  it('resolves the reader-cases guard that runs through the dispatcher', async () => {
    const raw = await new ClaudeCodeReader().read(CASES);
    const dispatched = raw.guards.filter((guard) => guard.dispatcher);
    expect(dispatched.map((guard) => [guard.event, guard.script, guard.dispatcher, guard.anchored])).toEqual([
      ['Stop', '.claude/guards/claim-window.py', '.claude/guards/lib/dispatch.py', true],
    ]);
    const check = raw.guards.find((guard) => guard.check?.id === 'C1');
    expect(check?.script).toBe('.claude/guards/claim-window.py');
  });

  it('counts the dispatcher as named and reached, so it is neither an orphan nor unreachable', async () => {
    const { map, analysis } = await scanEstate({ root: CASES, reader: new ClaudeCodeReader(), now: NOW });
    const guard = map.atoms.find((atom) => atom.fields?.dispatcher !== undefined);
    expect(guard?.fields).toMatchObject({
      name: 'claim-window.py',
      script: '.claude/guards/claim-window.py',
      dispatcher: '.claude/guards/lib/dispatch.py',
      anchored: true,
      registry: 'W3',
      state: 'enforce',
    });
    expect(analysis.orphans).not.toContain('.claude/guards/lib/dispatch.py');
    expect(analysis.unreachableFiles).not.toContain('.claude/guards/lib/dispatch.py');
    expect(analysis.namedFiles.has('.claude/guards/lib/dispatch.py')).toBe(true);
  });
});

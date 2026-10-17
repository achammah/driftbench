import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scriptOf } from '../../src/index';
import { estate } from '../support';

describe('shell context of guard commands', () => {
  const paths = new Set(['.claude/hooks/check.py']);
  it('carries an explicit project directory into the following command', () => {
    expect(scriptOf('cd "$CLAUDE_PROJECT_DIR" && python3 .claude/hooks/check.py', paths)).toEqual({
      script: '.claude/hooks/check.py',
      anchored: true,
    });
  });
  it('resolves a script relative to the selected project subfolder', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell expands the project variable.
    expect(scriptOf('cd "${CLAUDE_PROJECT_DIR}/.claude" && python3 hooks/check.py', paths)).toEqual({
      script: '.claude/hooks/check.py',
      anchored: true,
    });
  });
  it.each(['bash', '/bin/sh', 'zsh'])('unwraps a %s command string', (shell) => {
    expect(scriptOf(`${shell} -c 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/check.py'`, paths)).toEqual({
      script: '.claude/hooks/check.py',
      anchored: true,
    });
  });
  it('does not assume a failed change of directory succeeded', () => {
    expect(scriptOf('cd "$CLAUDE_PROJECT_DIR" || python3 .claude/hooks/check.py', paths)).toEqual({
      script: '.claude/hooks/check.py',
      anchored: false,
    });
  });
  it('does not interpret an echo argument as a shell command', () => {
    expect(scriptOf('echo "python3 .claude/hooks/check.py"', paths)).toEqual({ anchored: false });
  });

  it('continues after a shell wrapper whose payload runs no script', () => {
    expect(
      scriptOf('bash -c "echo ready" && python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/check.py', paths),
    ).toEqual({
      script: '.claude/hooks/check.py',
      anchored: true,
    });
  });

  it('prefers the known working directory when a relative path also exists at the root', () => {
    const collisions = new Set(['hooks/check.py', '.claude/hooks/check.py']);
    expect(scriptOf('cd "$CLAUDE_PROJECT_DIR"/.claude && python3 hooks/check.py', collisions)).toEqual({
      script: '.claude/hooks/check.py',
      anchored: true,
    });
  });

  it('keeps explicit project-root paths rooted after changing directory', () => {
    const collisions = new Set(['.claude/hooks/check.py', '.claude/.claude/hooks/check.py']);
    expect(
      scriptOf(
        'cd "$CLAUDE_PROJECT_DIR"/.claude && python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/check.py',
        collisions,
      ),
    ).toEqual({
      script: '.claude/hooks/check.py',
      anchored: true,
    });
  });

  it('preserves catalogue root-first lookup independently of shell working directories', async () => {
    const raw = await new ClaudeCodeReader().read(
      await estate({
        '.claude/hooks/check.py': 'print("root")\n',
        '.claude/catalogues/.claude/hooks/check.py': 'print("nested")\n',
        '.claude/catalogues/CATALOGUE.json': JSON.stringify([
          { id: 'C1', kind: 'check', event: 'Stop', work: '.claude/hooks/check.py' },
        ]),
      }),
    );
    expect(raw.guards.find((guard) => guard.check?.id === 'C1')?.script).toBe('.claude/hooks/check.py');
  });
});

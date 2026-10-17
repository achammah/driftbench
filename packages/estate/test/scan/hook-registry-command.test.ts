import { expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

it.each([
  [{ id: 'G1', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/check.py --strict', rules: ['R2'] }],
  { G1: { command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/check.py --strict', rules: ['R2'] } },
])('resolves a registry command to the guard it executes', async (checks) => {
  const raw = await new ClaudeCodeReader().read(
    await estate({
      '.claude/hooks/check.py': 'print("ok")\n',
      '.claude/check-registry.json': JSON.stringify({ checks }, null, 2),
    }),
  );
  expect(raw.registry).toHaveLength(1);
  expect(raw.registry[0]).toMatchObject({ id: 'G1', guard: 'check.py', enforces: [{ id: 'R2' }] });
});

it('preserves an explicit guard field even when command has the identical value', async () => {
  const name = 'check.py --strict';
  const raw = await new ClaudeCodeReader().read(
    await estate({
      '.claude/check-registry.json': JSON.stringify({
        checks: [{ id: 'G2', guard: name, command: name, rules: ['R3'] }],
      }),
    }),
  );
  expect(raw.registry[0]?.guard).toBe(name);
});

it('resolves command rows in separate registry files in one estate read', async () => {
  const raw = await new ClaudeCodeReader().read(
    await estate({
      '.claude/hooks/first.py': 'print("first")\n',
      '.claude/hooks/second.py': 'print("second")\n',
      '.claude/first-registry.json': JSON.stringify([
        { id: 'G3', command: 'python3 .claude/hooks/first.py' },
      ]),
      '.claude/second-registry.json': JSON.stringify([
        { id: 'G4', command: 'python3 .claude/hooks/second.py' },
      ]),
    }),
  );
  expect(raw.registry.map((row) => row.guard)).toEqual(['first.py', 'second.py']);
});

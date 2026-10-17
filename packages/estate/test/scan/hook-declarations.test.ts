import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, guardName } from '../../src/index';
import { estate } from '../support';

describe('hook declaration shapes', () => {
  it.each([
    { Stop: { type: 'command', command: 'check.sh' } },
    { Stop: [{ hooks: { type: 'command', command: 'check.sh' } }] },
  ])('notes malformed groups without inventing guards', async (hooks) => {
    const raw = await new ClaudeCodeReader().read(
      await estate({
        '.claude/settings.json': JSON.stringify({ hooks }),
      }),
    );
    expect(raw.guards).toEqual([]);
    expect(raw.notes.some((note) => note.file === '.claude/settings.json')).toBe(true);
  });

  it('retains prompt hooks without interpreting prompt words as shell commands', async () => {
    const prompt = 'Check the reply using check.py.';
    const raw = await new ClaudeCodeReader().read(
      await estate({
        '.claude/settings.json': JSON.stringify(
          {
            hooks: {
              Stop: [{ hooks: [{ type: 'prompt', prompt, timeout: 12 }] }],
            },
          },
          null,
          2,
        ),
      }),
    );
    expect(raw.guards).toHaveLength(1);
    expect(raw.guards[0]).toMatchObject({ command: prompt, event: 'Stop', timeout: 12 });
    expect(raw.guards[0]?.script).toBeUndefined();
    expect(raw.guards[0] && guardName(raw.guards[0])).toBe('check-the-reply-using-check-py');
  });
});

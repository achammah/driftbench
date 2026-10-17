import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

describe('ordered step successors', () => {
  it.each([
    ['implicit order', ['start', 'check', 'finish']],
    [
      'string next',
      [
        { id: 'start', next: 'check' },
        { id: 'check', next: 'finish' },
        { id: 'finish', next: '' },
      ],
    ],
    [
      // Listed as start, finish, check: the listed order would give start -> finish, so only a reader
      // that honours `then` gives start -> check -> finish.
      'then alias, in an order that differs from the listed one',
      JSON.parse(
        '[{"id":"start","then":["check"]},{"id":"finish","then":[]},{"id":"check","then":"finish"}]',
      ),
    ],
  ])('reads %s', async (_name, steps) => {
    const root = await estate({ '.claude/steps.json': JSON.stringify({ steps }, null, 2) });
    const raw = await new ClaudeCodeReader().read(root);
    expect(Object.fromEntries(raw.steps.map(({ id, next }) => [id, next]))).toEqual({
      start: ['check'],
      check: ['finish'],
      finish: [],
    });
  });

  it('preserves explicit terminal steps and does not infer across a declared graph', async () => {
    const root = await estate({
      '.claude/steps.json': JSON.stringify({ steps: [{ id: 'stop', next: [] }, { id: 'other' }] }, null, 2),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.steps.map((step) => step.next)).toEqual([[], []]);
  });

  it('skips anytime stages when inferring the ordered path', async () => {
    const root = await estate({
      '.claude/steps.json': JSON.stringify(
        { steps: [{ id: 'start' }, { id: 'note', anytime: true }, { id: 'finish' }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.steps.map((step) => step.next)).toEqual([['finish'], [], []]);
  });
});

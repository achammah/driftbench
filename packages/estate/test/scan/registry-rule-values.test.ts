import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

describe('registry rule value normalization', () => {
  it.each([
    ['scalar', 'R3, R5', [{ id: 'R3' }, { id: 'R5' }]],
    [
      'objects',
      [{ id: 'R3' }, { quote: 'Read the current record first.' }],
      [{ id: 'R3' }, { quote: 'Read the current record first.' }],
    ],
    [
      'array',
      ['R3', 'Read the current record first.'],
      [{ id: 'R3' }, { quote: 'Read the current record first.' }],
    ],
    ['empty', null, []],
    ['invalid', [{ unrelated: 'R3' }, 7, false], []],
  ])('reads %s rules with their declared meaning', async (_name, rules, expected) => {
    const root = await estate({
      '.claude/check-registry.json': JSON.stringify(
        { checks: [{ id: 'G1', guard: 'check.py', rules }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry[0]?.enforces).toEqual(expected);
  });
});

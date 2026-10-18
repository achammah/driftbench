import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';
import type { EstateAtom } from '../../src/estate/inputs';
import { actRecord } from '../../src/estate/record';

const gate = (after?: string): EstateAtom => ({
  id: 'gate.fictional.commit',
  kind: 'gate',
  title: 'Inspect repository state before saving the revision',
  approved: true,
  fields: after === undefined ? {} : { order: { before: 'git status', after } },
  evidence: [
    { type: 'ordered', before: 'Bash', after: 'Bash' },
    { type: 'tool_called', label: 'Bash', input: { command: { contains: 'git status' } } },
  ],
});

describe('an ordered tool gate carries the concrete successor input', () => {
  it('records the command to perform, not merely the Bash label', () => {
    expect(actRecord(gate('git commit'))).toEqual({ kind: 'call', name: 'Bash', target: 'git commit' });
    expect(codeAsk('trigger', [gate('git commit')], []).text).toBe('Please run `git commit`.');
  });
  it.each([undefined, '', '   '])('refuses an unresolved successor input: %s', (after) => {
    expect(codeAsk('trigger', [gate(after)], []).text).toBeUndefined();
  });
  it('does not let a declared sentence bypass the missing successor input', () => {
    const atom = gate();
    atom.fields = { ask: { text: 'run a command', act: { kind: 'call', name: 'Bash' } } };
    expect(codeAsk('trigger', [atom], []).text).toBeUndefined();
  });
  it.each(['Read', 'Edit', 'Write', 'Agent'])('refuses a %s successor with no concrete target', (tool) => {
    const atom = gate();
    atom.evidence = [{ type: 'ordered', before: 'Read', after: tool }];
    expect(codeAsk('trigger', [atom], []).text).toBeUndefined();
  });
  it.each(['Read', 'Edit', 'Write', 'Agent'])(
    'does not guess the input key of %s from an untyped target',
    (tool) => {
      const atom = gate('fictional-target');
      atom.evidence = [{ type: 'ordered', before: 'Read', after: tool }];
      expect(codeAsk('trigger', [atom], []).text).toBeUndefined();
    },
  );
});

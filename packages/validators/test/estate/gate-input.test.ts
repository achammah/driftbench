import type { Observed } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { checkTrace, shows } from '../../src/ladders/estate/bank/task-check';

const gate = (after?: string): Atom =>
  ({
    id: 'gate.fictional.commit',
    kind: 'gate',
    title: 'Inspect repository state before saving the revision',
    approved: true,
    fields: after === undefined ? {} : { order: { before: 'git status', after } },
    evidence: [
      { type: 'ordered', before: 'Bash', after: 'Bash' },
      { type: 'tool_called', label: 'Bash', input: { command: { contains: 'git status' } } },
    ],
    provenance: {
      file: 'CLAUDE.md',
      startLine: 1,
      endLine: 1,
      quote: 'Inspect repository state before saving the revision',
      hash: 'fictional-gate',
    },
  }) as Atom;
const observed = (input: Record<string, unknown>): Observed =>
  ({
    text: '',
    segments: [],
    toolCalls: [{ label: 'Bash', input }],
    cost: { total: 0 },
    latencyMs: 0,
  }) as unknown as Observed;

describe('the ordered gate witness is its concrete successor call', () => {
  it('derives the successor command independently from the map', () => {
    const atom = gate('git commit');
    expect(actOfAtom(atom, [atom])).toEqual({ kind: 'call', name: 'Bash', target: 'git commit' });
  });
  it.each([{}, { command: 'git status' }, { command: 'echo git commit' }, { note: 'git commit' }])(
    'rejects a planted Bash call with unrelated input %j',
    (input) => {
      const atom = gate('git commit');
      expect(shows(actOfAtom(atom, [atom]), observed(input), atom.evidence)).toBe(false);
    },
  );
  it('accepts the exact successor command', () => {
    const atom = gate('git commit');
    expect(shows(actOfAtom(atom, [atom]), observed({ command: 'git commit' }), atom.evidence)).toBe(true);
  });
  it('fails closed when the map only names the Bash tool', () => {
    const atom = gate();
    expect(shows(actOfAtom(atom, [atom]), observed({}), atom.evidence)).toBe(false);
  });
  it('does not turn an unresolved call into a passing control', () => {
    const atom = gate();
    const trace = observed({});
    trace.toolCalls = [];
    expect(
      checkTrace(
        { act: actOfAtom(atom, [atom]), control: true, spans: [], unit: atom.id, evidence: atom.evidence },
        trace,
      ),
    ).toBeDefined();
  });
});

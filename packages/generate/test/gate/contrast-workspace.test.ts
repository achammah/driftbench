import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import type { Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { gate, generated, makeSpec } from './support';

// A hand-written greenhouse desk: two moves reach the same stage and expect the same. One conversation
// runs in a workspace (its world supplies a file), the other has none. The reference answers alike.
type Diff = NonNullable<Observed['workspaceDiff']>;

function deskAdapter(diffFor: (said: string) => Diff | undefined) {
  return functionAdapter({
    create: () => ({}),
    respond: (messages) => {
      const said = String(messages.at(-1)?.content ?? '');
      const text = 'Which tray is it about?';
      const diff = diffFor(said);
      return {
        text,
        segments: [{ type: 'text' as const, text }],
        toolCalls: [],
        runtime: { stages: [{ name: 'tray' }] },
        cost: { usd: 0 },
        latencyMs: 0,
        ...(diff ? { workspaceDiff: diff } : {}),
      };
    },
    deterministic: true,
  });
}

const siblings = () =>
  [
    { id: 'desk-hello', move: 'greeting-to-tray', user: 'Hello, I need help with a seed tray.' },
    { id: 'desk-back', move: 'summary-to-tray', user: 'Wait, I picked the wrong tray.' },
  ].map(({ id, move, user }) =>
    makeSpec({
      id,
      stages: ['greeting', 'tray', 'summary'],
      blocks: [
        {
          id: 'b1',
          when: { user },
          expect: { stage: 'tray', tools: [{ label: 'tray.water', count: 0 }], must: ['Which tray'] },
        },
      ],
      metadata: generated('cover', [{ block: 'b1', cell: { move, stage: 'tray' } }]),
    }),
  );

async function contrastOf(diffFor: (said: string) => Diff | undefined) {
  const result = await gate(siblings(), {
    references: new Map([['function:shop', deskAdapter(diffFor)]]),
    faults: [],
  });
  expect(result.blocks.map((record) => record.reference[0])).toEqual(['pass', 'pass']);
  return result.blocks.map((record) => record.stages.contrast);
}

describe('stage 4, contrast, when one sibling runs in a workspace', () => {
  it('treats a workspace diff that lists no file as no workspace change', async () => {
    const empty: Diff = { created: [], changed: [], deleted: [] };
    const verdicts = await contrastOf((said) => (said.startsWith('Wait') ? empty : undefined));
    for (const verdict of verdicts) expect(verdict).toMatchObject({ status: 'pass' });
  });

  it('still rejects copied Thens when one sibling writes a file', async () => {
    const wrote: Diff = { created: ['notes/tray-4.txt'], changed: [], deleted: [] };
    const verdicts = await contrastOf((said) => (said.startsWith('Wait') ? wrote : undefined));
    for (const verdict of verdicts)
      expect(verdict).toMatchObject({ status: 'reject', reason: 'then-ignores-edit' });
  });
});

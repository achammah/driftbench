import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import type { RunResult, Spec } from '../../src/index';
import { prepareRejudge, rejudgeRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, specOf } from '../runner/support';

/**
 * Blast-radius audit (PR 428): a re-judge never judges a block not run or blocked, even when the block selects
 * the changed criterion. Fictional data only.
 */
const criteria = [
  { name: 'price', rubric: 'A price is present.', gating: true },
  { name: 'tone', rubric: 'Polite.' },
];
const forced = specOf({
  id: 'acme-quote-forced-criteria',
  metadata: { depends: { stages: ['offer'] } },
  criteria,
  blocks: [
    { when: { user: 'Quote Acme.' }, expect: { criteria: ['price', 'tone'] } },
    {
      when: { user: 'Check the lookup.' },
      given: { world: { tools: { lookup: { result: { ok: true } } } } },
      expect: { criteria: ['price'] },
    },
    { when: { user: 'Thanks.' }, expect: { criteria: ['price'] } },
  ],
});
const changed = {
  ...forced,
  criteria: criteria.map((c) => (c.name === 'price' ? { ...c, rubric: 'The price must be 12.' } : c)),
} as Spec;
const target = { adapter: 'echo', variant: 'v1' };
const options = {
  baselineProvenance: {
    version: 2 as const,
    adapters: [
      {
        ...adapterProvenance(echoAdapter(), target.adapter),
        targetHash: provenanceHash(target),
        agentVersionHash: provenanceHash('v1'),
      },
    ],
  },
  fromCampaign: 'acme-base',
  agentVersion: 'v1',
  criteria: ['price'],
  now: new Date('2026-10-13T01:00:00Z'),
};

async function rejudged(edit: (run: RunResult) => RunResult) {
  // The echo adapter has no toolStubs: blocks 1 and 2 are not run.
  const run = await runSpec(forced, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-13T00:00:00Z'),
  });
  const source = edit(run);
  const judged: number[] = [];
  const result = await rejudgeRun(
    prepareRejudge(forced, changed, source, options),
    {
      name: 'judge',
      applies: () => true,
      evaluate: (ctx) => {
        judged.push(ctx.blockIndex);
        return [
          { id: 'judge.price', kind: 'judge', name: 'price', gating: true, outcome: 'pass', evidence: 'ok' },
        ];
      },
    },
    () => 0,
  );
  return { source, result, judged };
}

describe('blast radius: re-judge leaves unscored blocks that select the changed criterion', () => {
  it('not_run blocks selecting price are not judged and stay not_run, never a pass', async () => {
    const { result, judged } = await rejudged((run) => run);
    expect(judged).toEqual([0]);
    expect(result.blocks.map((b) => b.status)).toEqual([undefined, 'not_run', 'not_run']);
    expect(result.blocks.map((b) => b.pass)).toEqual([true, false, false]);
    expect(result.blocks[1]?.rejudged).toBeUndefined();
  });

  it('a blocked block selecting price is not judged and stays blocked', async () => {
    const { result, judged } = await rejudged((run) => ({
      ...run,
      blocks: run.blocks.map((b) => {
        if (b.index !== 2) return b;
        const { notRun: _notRun, ...rest } = b;
        return { ...rest, status: 'blocked' as const, blocked: { by: 'block 1', root: 'block 1' } };
      }),
    }));
    expect(judged).toEqual([0]);
    expect(result.blocks[2]?.status).toBe('blocked');
    expect(result.blocks[2]?.blocked).toEqual({ by: 'block 1', root: 'block 1' });
    expect(result.blocks[2]?.pass).toBe(false);
  });
});

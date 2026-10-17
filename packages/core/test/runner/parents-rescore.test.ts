// A parent-linked run takes each child's history, previous stage and Given from its ancestors (PR 562). A
// re-score that rebuilds them from the block order would hand a child the blocks of unrelated trees, so a
// parent-linked run is never re-scored: the cell runs fresh, and a kept block of a parent-linked run keeps
// the verdicts it was measured with.
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import type { Check } from '../../src/contracts/check';
import { rescoreCarriedRun } from '../../src/runner/carried-scoring';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, minimalChecks, specOf } from './support';

// Fictional data only. Two trees: root-a with child-a, and root-b with child-b.
const linked = specOf({
  id: 'parents-rescore',
  blocks: [
    { id: 'root-a', when: { user: 'open a' }, expect: { must: ['ok'] } },
    { id: 'child-a', parent: 'root-a', when: { user: 'more a' }, expect: { must: ['ok'] } },
    { id: 'root-b', when: { user: 'open b' }, expect: { must: ['ok'] } },
    { id: 'child-b', parent: 'root-b', when: { user: 'more b' }, expect: { must: ['ok'] } },
  ],
});
const target = { adapter: 'echo', variant: 'v1' };
const common = {
  driver: createScriptedDriver(),
  checks: minimalChecks.filter((check) => check.name !== 'stage'),
  repeat: 0,
  recordProvenance: true,
  now: () => new Date('2026-10-13T00:00:00Z'),
  mode: 'T' as const,
};

it('refuses to re-score a parent-linked run, so the cell runs fresh', async () => {
  const source = await runSpec(linked, { ...common, target, adapter: echoAdapter() });
  expect(source.blocks).toHaveLength(4);
  let evaluated = 0;
  const probe: Check = {
    name: 'probe',
    applies: () => true,
    evaluate: () => {
      evaluated += 1;
      return [];
    },
  };
  await expect(rescoreCarriedRun(linked, source, { checks: [probe] })).rejects.toThrow(
    /cannot re-score carried run: a parent-linked run takes each child's history from its ancestors/,
  );
  expect(evaluated).toBe(0);
});

it('refuses to reuse blocks of a parent-linked spec, so no kept block of one is ever re-scored', async () => {
  const source = await runSpec(linked, { ...common, target, adapter: echoAdapter() });
  await expect(
    runSpec(linked, {
      ...common,
      target: { ...target, variant: 'v2' },
      adapter: echoAdapter(),
      blocks: new Set([1]),
      blockReuse: {
        source,
        fromCampaign: 'base',
        baselineProvenance: {
          version: 2,
          adapters: [
            {
              ...adapterProvenance(echoAdapter()),
              targetHash: provenanceHash(target),
              agentVersionHash: provenanceHash('v1'),
            },
          ],
        },
        manifest: { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'child-a' }] },
      },
    }),
  ).rejects.toThrow(/parent-linked blocks require a full tree replay/);
});

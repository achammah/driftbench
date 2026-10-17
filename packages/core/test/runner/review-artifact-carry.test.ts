import { artifacts, initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import type { ArtifactReader } from '../../src/contracts/artifacts';
import { adapterProvenance, provenanceHash, runSpec } from '../../src/index';
import { rescoreCarriedRun } from '../../src/runner/carried-scoring';
import { echoAdapter, specOf } from './support';

initializeShippedObjects();
const spec = specOf({
  id: 'review-artifact-carry',
  metadata: { depends: {} },
  blocks: [
    { user: 'one', expect: { stage: 'one', artifacts: [{ path: 'result.csv' }] } },
    { user: 'two', expect: { stage: 'two' } },
    { user: 'three', expect: { stage: 'three', artifacts: [{ path: 'result.csv' }] } },
  ],
});
const makeAdapter = () =>
  Object.assign(echoAdapter(), {
    readArtifact: async () => new TextEncoder().encode('a,b\n1,2\n'),
  });
const reader: ArtifactReader = {
  kind: 'csv',
  open: async (_bytes, path) => ({
    kind: 'csv',
    path,
    text: () => '',
    check: (check) => ({ check, ok: true, evidence: 'ok' }),
  }),
};
const common = {
  driver: createScriptedDriver(),
  checks: [artifacts],
  artifacts: { get: () => reader, forPath: () => reader },
  repeat: 0,
  recordProvenance: true,
  now: () => new Date('2026-10-15T00:00:00Z'),
  mode: 'T' as const,
};
const target = { adapter: 'echo', variant: 'v1' };

it('reruns artifact blocks when carried artifact bytes cannot be re-read', async () => {
  const source = await runSpec(spec, { ...common, target, adapter: makeAdapter() });
  expect(source.blocks.every((block) => block.pass)).toBe(true);
  const adapter = makeAdapter();
  const result = await runSpec(spec, {
    ...common,
    target: { ...target, variant: 'v2' },
    adapter,
    blocks: new Set([1]),
    blockReuse: {
      source,
      fromCampaign: 'base',
      baselineProvenance: {
        version: 2,
        adapters: [
          {
            ...adapterProvenance(makeAdapter()),
            targetHash: provenanceHash(target),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
      manifest: { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'two' }] },
    },
  });
  expect(adapter.opened).toHaveLength(3);
  expect(result.blocks.every((block) => block.pass)).toBe(true);
  expect(result.blocks.map((block) => block.carried)).toEqual([undefined, undefined, undefined]);
  expect(result.blocks[0]?.verdicts).toContainEqual(
    expect.objectContaining({
      name: 'artifacts',
      outcome: 'pass',
    }),
  );
  expect(result.blocks[2]?.verdicts).toContainEqual(
    expect.objectContaining({
      name: 'artifacts',
      outcome: 'pass',
    }),
  );
});

it('refuses whole-cell artifact rescoring before any check even without recorded provenance', async () => {
  const adapter = makeAdapter();
  const source = await runSpec(spec, { ...common, target, adapter, recordProvenance: false });
  expect(source.blocks.every((block) => block.pass)).toBe(true);
  expect(source.provenance).toBeUndefined();
  expect(source.blocks.every((block) => block.provenance === undefined)).toBe(true);
  let evaluated = 0;
  await expect(
    rescoreCarriedRun(spec, source, {
      checks: [
        {
          ...artifacts,
          evaluate: (ctx) => {
            evaluated++;
            return artifacts.evaluate(ctx);
          },
        },
      ],
      artifacts: common.artifacts,
    }),
  ).rejects.toThrow(/artifact.*run the cell fresh/i);
  expect(evaluated).toBe(0);
  expect(adapter.opened).toHaveLength(3);
});

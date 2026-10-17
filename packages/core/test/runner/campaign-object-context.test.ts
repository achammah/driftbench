import { defaultChecks, initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import {
  contentHash,
  type ObjectContext,
  ObjectRegistry,
  ObjectStore,
  objectContextOfSpec,
  objectRegistry,
  planCampaign,
  runCampaign,
  Spec,
} from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it, vi } from 'vitest';
import { echoAdapter } from './support';

function objects(disableMust?: boolean): ObjectContext {
  const registry = new ObjectRegistry();
  registry.restore(objectRegistry.snapshot());
  const store = new ObjectStore(registry);
  if (disableMust !== undefined)
    store.add(
      {
        kind: 'check-set',
        id: 'project-rules',
        extends: 'default',
        items: [{ id: 'must', enabled: !disableMust }],
      },
      'project',
      { path: 'project/check-set/project-rules.yaml' },
    );
  return { store, uses: [], problems: [] };
}

async function fixture() {
  initializeShippedObjects();
  // Stored specs retain their structure but may have no loader-bound object context.
  const spec = Spec.parse({
    id: 'unbound-project',
    kind: 'conversation',
    uses: { check_set: 'project-rules' },
    blocks: [{ when: { user: 'hi' }, expect: { must: ['never-said'] } }],
  });
  expect(objectContextOfSpec(spec)).toBeUndefined();
  const target = { adapter: 'echo' };
  const hash = contentHash(spec);
  const { cells } = planCampaign([{ spec, hash }], [target], ['F'], 2);
  const store = openMemoryStore();
  await store.putCampaign({
    campaignId: 'contexts',
    specs: [{ id: spec.id, hash }],
    targets: [target],
    modes: ['F'],
    repeats: { T: 0, F: 2, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: '2026-10-15T00:00:00.000Z',
  });
  const adapter = echoAdapter();
  const adapterFor = vi.fn(() => adapter);
  const listRuns = vi.spyOn(store, 'listRuns');
  const options = {
    campaignId: 'contexts',
    cells,
    specFor: () => spec,
    adapterFor,
    driver: () => createScriptedDriver(),
    checks: defaultChecks(),
    store,
  };
  return { options, store, adapter, adapterFor, listRuns };
}

describe('campaign explicit object contexts', () => {
  it('resolves once per cell and reuses each supplied context to score an unbound project spec', async () => {
    const { options, store, adapterFor, listRuns } = await fixture();
    const contexts = [objects(true), objects(false)];
    const objectsFor = vi.fn(
      (cell: (typeof options.cells)[number]) => contexts[cell.repeat] as ObjectContext,
    );
    try {
      const outcomes = await runCampaign({ ...options, objectsFor });
      expect(objectsFor.mock.calls.map(([cell]) => cell.cellId)).toEqual(
        options.cells.map((cell) => cell.cellId),
      );
      expect(listRuns).toHaveBeenCalledTimes(1);
      expect(adapterFor).toHaveBeenCalledTimes(2);
      expect(outcomes.map((outcome) => outcome.run?.status)).toEqual(['completed', 'completed']);
      expect(outcomes.map((outcome) => outcome.run?.blocks[0]?.pass)).toEqual([true, false]);
      expect(outcomes[0]?.run?.blocks[0]?.verdicts.some((verdict) => verdict.name === 'must')).toBe(false);
      expect(
        outcomes[1]?.run?.blocks[0]?.verdicts.find((verdict) => verdict.name === 'must')?.by,
      ).toMatchObject({ object: expect.stringMatching(/^check-set:project-rules@/), layer: 'project' });
    } finally {
      await store.close();
    }
  });

  it('validates every cell context before looking up stored runs or accessing an adapter', async () => {
    const { options, store, adapter, adapterFor, listRuns } = await fixture();
    const contexts = [objects(true), objects()];
    const objectsFor = vi.fn(
      (cell: (typeof options.cells)[number]) => contexts[cell.repeat] as ObjectContext,
    );
    try {
      await expect(runCampaign({ ...options, objectsFor })).rejects.toThrow(
        /OBJECT_UNKNOWN:.*check-set:project-rules/,
      );
      expect(objectsFor).toHaveBeenCalledTimes(2);
      expect(listRuns).not.toHaveBeenCalled();
      expect(adapterFor).not.toHaveBeenCalled();
      expect(adapter.opened).toEqual([]);
    } finally {
      await store.close();
    }
  });
});

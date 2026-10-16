import type { RunResult } from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { describe, expect, it } from 'vitest';
import { attributionOf } from '../src/attribution';
import { loadCampaign } from '../src/data';
import { storeAcmeCampaign } from './support';

describe('the record path the scorecard reads first', () => {
  it('stores a run whose failing block carries its diagnoses, and scores it from the record', async () => {
    const store = openMemoryStore();
    await storeAcmeCampaign(store, {
      campaignId: 'c-blast',
      modes: ['F'],
      repeats: 1,
      fault: 'x3-skips-recap',
    });
    const loaded = await loadCampaign(store, 'c-blast');
    const failing = loaded.runs.find((one) => one.blocks.some((b) => !b.pass));
    if (!failing) throw new Error('the x3 fault campaign has no failing run');
    const diagnosed = {
      ...failing,
      blocks: failing.blocks.map((b) =>
        b.pass
          ? b
          : {
              ...b,
              diagnoses: b.verdicts
                .filter((v) => v.gating && v.outcome === 'fail')
                .map((v) => ({
                  diagnostic: 'diagnostic:audit@12345678',
                  summary: 'Audit setup diagnosis',
                  by: {
                    object: 'diagnostic:audit@12345678',
                    item: 'setup',
                    impl: 'plugin:audit-setup',
                    layer: 'project',
                  },
                  verdictRef: v.id,
                  disposition: 'setup',
                })),
            },
      ),
    } as RunResult;
    await store.putRun('c-blast', diagnosed);
    const again = await loadCampaign(store, 'c-blast');
    await store.close();
    const stored = again.runs.find((run) => run.runId === diagnosed.runId);
    expect(stored?.blocks.flatMap((block) => block.diagnoses ?? [])).toEqual(
      diagnosed.blocks.flatMap((block) => block.diagnoses ?? []),
    );
    const summary = attributionOf(again);
    expect(summary?.blocks.setup).toBeGreaterThan(0);
  }, 120_000);
});

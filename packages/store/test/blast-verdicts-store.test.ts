import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { blockStatus, countRuns, RunResult as RunRecord, type RunResult } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryStore, openStore, readCampaignBundle, SCHEMA_VERSION } from '../src/index';
import { block, campaign, run, storeError, tempDir } from './fixtures';

/**
 * Blast-radius audit (PR 428): store schema 3 holds the block verdicts not_run and blocked. A schema 2
 * database opens and upgrades with its records unchanged, old and new runs read back in one campaign, and
 * a bundle carries the new fields both ways.
 */
const ID = 'acme-2026-10-11';
const NOT_RUN = {
  kind: 'unsupported' as const,
  layer: '5 world',
  check: 'capability',
  expected: 'the adapter applies forced tool results (lookup) (toolStubs)',
  got: 'function declares toolStubs false: the agent would never see it',
};

/** A run written before status existed: no status, no notRun, no blocked on any block. */
const old = run({ repeat: 0, blocks: [block(0), block(1, { pass: false })] });
/** A run of the same cell family holding the new verdicts. */
const fresh = run({
  repeat: 1,
  blocks: [
    block(0),
    block(1, { pass: false, status: 'not_run', notRun: NOT_RUN, verdicts: [] }),
    block(2, {
      pass: false,
      status: 'blocked',
      blocked: { by: 'block 1', root: 'block 1', reason: 'not run' },
    }),
  ],
});

let dir: string;
beforeEach(async () => {
  dir = await tempDir();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('blast radius: store schema 3 and the new block verdicts', () => {
  it('the schema is 3, and both records validate against the run schema', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(RunRecord.safeParse(old).success).toBe(true);
    expect(RunRecord.safeParse(fresh).success).toBe(true);
  });

  it('a schema 2 database upgrades on open; old and new runs read back in one campaign', async () => {
    const path = join(dir, 'store.db');
    const first = openStore(path);
    await first.putCampaign(campaign());
    await first.putRun(ID, old);
    await first.close();
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 2');
    raw.close();

    const store = openStore(path);
    try {
      const check = new DatabaseSync(path);
      expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
      check.close();
      expect(await store.getRun(old.runId, ID)).toStrictEqual(old);
      await store.putRun(ID, fresh);
      expect(await store.getRun(fresh.runId, ID)).toStrictEqual(fresh);
      const runs = (await store.listRuns({ campaignId: ID })) as RunResult[];
      expect(runs.map((each) => each.runId).sort()).toEqual([old.runId, fresh.runId].sort());
      // The old record reads from its pass field, the new one from its status.
      const byId = new Map(runs.map((each) => [each.runId, each]));
      expect(byId.get(old.runId)?.blocks.map(blockStatus)).toEqual(['pass', 'fail']);
      expect(byId.get(fresh.runId)?.blocks.map(blockStatus)).toEqual(['pass', 'not_run', 'blocked']);
      expect(countRuns(runs)).toEqual({ pass: 0, fail: 1, not_run: 1, blocked: 0 });
    } finally {
      await store.close();
    }
  });

  it('a schema 4 database is refused, so an older reader never drops a newer field', async () => {
    const path = join(dir, 'newer.db');
    await openStore(path).close();
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 4');
    raw.close();
    const error = await storeError(() => openStore(path));
    expect(error.code).toBe('SCHEMA_VERSION');
    expect(error.message).toContain('reads 3 and older');
  });

  it('a bundle writes schema 3, carries the new fields, and a schema 2 bundle still reads', async () => {
    const store = openMemoryStore();
    try {
      await store.putCampaign(campaign());
      await store.putRun(ID, old);
      await store.putRun(ID, fresh);
      const folder = await store.exportCampaign(ID, dir);
      const manifestPath = join(folder, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(manifest.schemaVersion).toBe(3);
      const bundle = await readCampaignBundle(folder);
      expect(bundle.runs.find((each) => each.runId === fresh.runId)).toStrictEqual(fresh);
      const other = openMemoryStore();
      try {
        await other.importCampaign(folder);
        expect(await other.getRun(fresh.runId, ID)).toStrictEqual(fresh);
      } finally {
        await other.close();
      }
      await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 2 }));
      expect((await readCampaignBundle(folder)).runs).toHaveLength(2);
    } finally {
      await store.close();
    }
  });
});

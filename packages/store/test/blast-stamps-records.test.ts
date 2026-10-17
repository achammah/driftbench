// Blast radius of unit F2 on the store: run records written before `by`, `resolved`, `diagnoses` and
// `skippedForBudget` and records that hold them share one campaign, and both read back unchanged from the
// database and from an exported bundle.
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { RunResult } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cellId, openMemoryStore, type SqliteStore } from '../src/index';
import { campaign, storeError, tempDir } from './fixtures';

const OLD = new URL('../../core/test/fixtures/framework/old-records.json', import.meta.url);
const ID = 'blast-stamps-mixed';

function oldRecords(): RunResult[] {
  return (JSON.parse(readFileSync(OLD, 'utf8')) as { records: RunResult[] }).records;
}

/** An old record as a newer runner writes it: every verdict stamped, every block resolved, diagnoses on block 0. */
function stamped(old: RunResult): RunResult {
  const fresh = structuredClone(old);
  fresh.repeat = old.repeat + 1;
  fresh.runId = cellId(fresh);
  fresh.blocks = fresh.blocks.map((block, index) => ({
    ...block,
    verdicts: block.verdicts.map((verdict) => ({
      ...verdict,
      by: {
        object: 'check-set:default@0123abcd',
        item: verdict.name,
        impl: `builtin:check/${verdict.name}`,
        layer: 'shipped' as const,
      },
    })),
    resolved: {
      objects: [{ key: 'check_set', kind: 'check-set', id: 'default', hash: 'feedc0de', setAt: 'shipped' }],
      hash: 'a1b2c3d4',
    },
    ...(index === 0
      ? {
          diagnoses: [
            {
              diagnostic: 'diagnostic:probe@89abcdef',
              step: 'count',
              summary: 'two verdicts read',
              score: 0.5,
              by: {
                object: 'diagnostic:probe@89abcdef',
                item: 'count',
                impl: 'builtin:probe',
                layer: 'shipped',
              },
            },
          ],
          skippedForBudget: 2,
        }
      : {}),
  }));
  return fresh;
}

let store: SqliteStore;
let dir: string;

beforeEach(async () => {
  store = openMemoryStore();
  dir = await tempDir();
  await store.putCampaign(campaign(ID));
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('blast stamps: old and new run records in one campaign', () => {
  it('read back unchanged from the database, the new fields kept and the old records without them', async () => {
    const old = oldRecords();
    const fresh = old.map(stamped);
    for (const run of [...old, ...fresh]) await store.putRun(ID, run);
    const read = await store.listRuns({ campaignId: ID });
    expect(read.length).toBe(old.length * 2);
    const byId = new Map(read.map((run) => [run.runId, run]));
    for (const run of [...old, ...fresh]) expect(byId.get(run.runId)).toStrictEqual(run);
    for (const run of old) {
      for (const block of byId.get(run.runId)?.blocks ?? []) {
        expect(block.resolved).toBeUndefined();
        expect(block.diagnoses).toBeUndefined();
        expect(block.verdicts.every((verdict) => verdict.by === undefined)).toBe(true);
      }
    }
    const one = byId.get(fresh[0]?.runId ?? '');
    expect(one?.blocks[0]?.diagnoses?.[0]?.by.item).toBe('count');
    expect(one?.blocks[0]?.skippedForBudget).toBe(2);
    expect(one?.blocks[1]?.resolved?.hash).toBe('a1b2c3d4');
    expect(one?.blocks[1]?.verdicts[0]?.by?.object).toBe('check-set:default@0123abcd');
  });

  it('survive an export and an import into another store', async () => {
    const old = oldRecords();
    const fresh = old.map(stamped);
    for (const run of [...old, ...fresh]) await store.putRun(ID, run);
    const folder = await store.exportCampaign(ID, dir);
    const other = openMemoryStore();
    try {
      const bundle = await other.importCampaign(folder);
      expect(bundle.runs.length).toBe(old.length * 2);
      const read = new Map((await other.listRuns({ campaignId: ID })).map((run) => [run.runId, run]));
      for (const run of [...old, ...fresh]) expect(read.get(run.runId)).toStrictEqual(run);
    } finally {
      await other.close();
    }
  });

  it('refuse a record whose by lacks its object or names an unknown layer', async () => {
    const [first] = oldRecords();
    if (!first) throw new Error('no old record');
    const fresh = stamped(first);
    const verdict = fresh.blocks[0]?.verdicts[0];
    if (!verdict?.by) throw new Error('no stamped verdict');
    const { object: _object, ...noObject } = verdict.by;
    const bad = structuredClone(fresh);
    (bad.blocks[0]?.verdicts[0] as { by: unknown }).by = noObject;
    expect((await storeError(() => store.putRun(ID, bad))).code).toBe('INVALID_RECORD');
    const layer = structuredClone(fresh);
    const badLayer = layer.blocks[0]?.verdicts[0];
    if (!badLayer?.by) throw new Error('no stamped verdict');
    (badLayer.by as { layer: string }).layer = 'nowhere';
    expect((await storeError(() => store.putRun(ID, layer))).code).toBe('INVALID_RECORD');
    expect(await store.listRuns({ campaignId: ID })).toEqual([]);
  });
});

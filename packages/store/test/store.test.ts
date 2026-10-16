import { fileURLToPath } from 'node:url';
import { canonicalJson, type LoadedSpec, loadSpecs, parseSpecText } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cellId, openMemoryStore, type SqliteStore } from '../src/index';
import { block, campaign, perturbedRun, run, SUPPORT, storeError } from './fixtures';

const ACME_SPECS = fileURLToPath(new URL('../../../examples/acme/specs', import.meta.url));

let store: SqliteStore;

beforeEach(() => {
  store = openMemoryStore();
});

afterEach(async () => {
  await store.close();
});

async function acmeSpecs(): Promise<LoadedSpec[]> {
  const results = await loadSpecs([ACME_SPECS]);
  return results.map((result) => {
    if (!result.ok) throw new Error(`${result.path} does not load`);
    return result;
  });
}

describe('specs', () => {
  it('round trip every Acme spec, path, hash and lint warnings included', async () => {
    const specs = await acmeSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(7);
    for (const spec of specs) await store.putSpec(spec);
    for (const spec of specs) {
      expect(canonicalJson(await store.getSpec(spec.spec.id, spec.hash))).toBe(canonicalJson(spec));
    }
  });

  it('return undefined for an unknown id or hash', async () => {
    const [spec] = await acmeSpecs();
    if (spec === undefined) throw new Error('no Acme spec');
    await store.putSpec(spec);
    expect(await store.getSpec(spec.spec.id, 'ffffffffffff')).toBeUndefined();
    expect(await store.getSpec('acme-unknown', spec.hash)).toBeUndefined();
  });

  it('keep one row per id and hash, the last path winning', async () => {
    const [spec] = await acmeSpecs();
    if (spec === undefined) throw new Error('no Acme spec');
    await store.putSpec(spec);
    await store.putSpec({ ...spec, path: 'moved/spec.yaml' });
    expect((await store.getSpec(spec.spec.id, spec.hash))?.path).toBe('moved/spec.yaml');
  });

  it('refuse a spec whose hash does not match its content', async () => {
    const [spec] = await acmeSpecs();
    if (spec === undefined) throw new Error('no Acme spec');
    const error = await storeError(() => store.putSpec({ ...spec, hash: '000000000000' }));
    expect(error.code).toBe('INVALID_RECORD');
    expect(error.message).toContain(`content hashes to ${spec.hash}`);
    expect(await store.getSpec(spec.spec.id, '000000000000')).toBeUndefined();
  });

  it('store the normalised spec, authoring shorthand resolved', async () => {
    const yaml = [
      'id: acme-greeting',
      'ledger_seed: { customer: new }',
      'blocks:',
      '  - user: Hello',
      '    expect: { must: [Acme Telecom] }',
    ].join('\n');
    const loaded = parseSpecText(yaml, 'yaml', 'specs/acme-greeting.yaml');
    if (!loaded.ok) throw new Error('the inline spec does not load');
    await store.putSpec(loaded);
    const stored = await store.getSpec('acme-greeting', loaded.hash);
    expect(canonicalJson(stored)).toBe(canonicalJson(loaded));
    expect(stored?.spec.given?.ledger).toEqual({ customer: 'new' });
    expect(stored?.spec.blocks[0]?.when).toEqual({ user: 'Hello' });
  });
});

describe('campaigns', () => {
  it('round trip', async () => {
    await store.putCampaign(campaign());
    expect(await store.getCampaign('acme-2026-10-11')).toStrictEqual(campaign());
    expect(await store.getCampaign('acme-unknown')).toBeUndefined();
  });

  it('accept the same campaign again, whatever its key order', async () => {
    await store.putCampaign(campaign());
    const reordered = Object.fromEntries(Object.entries(campaign()).reverse()) as ReturnType<typeof campaign>;
    await expect(store.putCampaign(reordered)).resolves.toBeUndefined();
  });

  it('refuse other content under a stored campaign id: campaigns are immutable', async () => {
    await store.putCampaign(campaign());
    const error = await storeError(() => store.putCampaign(campaign('acme-2026-10-11', { budgetUsd: 9 })));
    expect(error.code).toBe('CAMPAIGN_CONFLICT');
    expect((await store.getCampaign('acme-2026-10-11'))?.budgetUsd).toBe(2.5);
  });

  it('refuse an invalid campaign', async () => {
    const error = await storeError(() => store.putCampaign(campaign('acme-c2', { modes: [] })));
    expect(error.code).toBe('INVALID_RECORD');
    expect(error.message).toContain('modes');
    expect(await store.getCampaign('acme-c2')).toBeUndefined();
  });

  it('list none from an empty store', async () => {
    expect(await store.listCampaigns()).toEqual([]);
  });

  it('list newest first by createdAt, then by id, whatever the order they were put in', async () => {
    const day1 = campaign('acme-day-1', { createdAt: '2026-10-10T09:00:00.000Z' });
    const day2b = campaign('acme-day-2-b', { createdAt: '2026-10-11T17:10:55.000Z' });
    const day2a = campaign('acme-day-2-a', { createdAt: '2026-10-11T17:10:55.000Z' });
    const day3 = campaign('acme-day-3', { createdAt: '2026-10-12T08:00:00.000Z' });
    for (const each of [day2b, day1, day3, day2a]) await store.putCampaign(each);
    const listed = await store.listCampaigns();
    expect(listed.map((each) => each.campaignId)).toEqual([
      'acme-day-3',
      'acme-day-2-a',
      'acme-day-2-b',
      'acme-day-1',
    ]);
    expect(listed[0]).toStrictEqual(day3);
  });

  it('list times as dates, not as text, and put a time that is not a date after the dates', async () => {
    // As text "...55Z" sorts after "...55.649Z"; as a date it is 649 milliseconds earlier.
    await store.putCampaign(campaign('acme-whole-second', { createdAt: '2026-10-11T17:10:55Z' }));
    await store.putCampaign(campaign('acme-later', { createdAt: '2026-10-11T17:10:55.649Z' }));
    // Date.parse reads neither, so they come after the dates, the larger text first.
    await store.putCampaign(campaign('acme-undated-1', { createdAt: 'first run' }));
    await store.putCampaign(campaign('acme-undated-2', { createdAt: 'second run' }));
    expect((await store.listCampaigns()).map((each) => each.campaignId)).toEqual([
      'acme-later',
      'acme-whole-second',
      'acme-undated-2',
      'acme-undated-1',
    ]);
  });
});

describe('runs', () => {
  beforeEach(async () => {
    await store.putCampaign(campaign());
  });

  it('round trip a run with every optional field and per-segment cost and latency', async () => {
    const plain = run();
    const perturbed = perturbedRun();
    await store.putRun('acme-2026-10-11', plain);
    await store.putRun('acme-2026-10-11', perturbed);
    expect(await store.getRun(plain.runId)).toStrictEqual(plain);
    const back = await store.getRun(perturbed.runId);
    expect(back).toStrictEqual(perturbed);
    expect(back?.blocks[0]?.observed.segments[2]).toMatchObject({ cost: { usd: 0.0011 }, latencyMs: 940 });
  });

  it('return undefined for an unknown run', async () => {
    expect(await store.getRun('0000000000000000')).toBeUndefined();
    expect(await store.getRun(run().runId, 'acme-2026-10-11')).toBeUndefined();
  });

  it('replace a run put again under the same campaign and id: the resume path', async () => {
    const first = run({ status: 'stopped', blocks: [block(0), block(1), block(2)] });
    await store.putRun('acme-2026-10-11', first);
    const second = run({ status: 'completed', blocks: [block(0)], cost: 0.0015 });
    expect(second.runId).toBe(first.runId);
    await store.putRun('acme-2026-10-11', second);

    expect(await store.getRun(first.runId)).toStrictEqual(second);
    const all = await store.listRuns();
    expect(all).toHaveLength(1);
    expect(all[0]?.blocks).toHaveLength(1);
  });

  it('keep the same cell under two campaigns apart, and ask which one getRun means', async () => {
    await store.putCampaign(campaign('acme-2026-10-12', { createdAt: '2026-10-12T09:00:00.000Z' }));
    const day1 = run({ status: 'failed', error: 'agent 503' });
    const day2 = run({ startedAt: '2026-10-12T10:00:00.000Z', finishedAt: '2026-10-12T10:00:02.000Z' });
    expect(day1.runId).toBe(day2.runId);
    await store.putRun('acme-2026-10-11', day1);
    await store.putRun('acme-2026-10-12', day2);

    expect(await store.getRun(day1.runId, 'acme-2026-10-11')).toStrictEqual(day1);
    expect(await store.getRun(day1.runId, 'acme-2026-10-12')).toStrictEqual(day2);
    const error = await storeError(() => store.getRun(day1.runId));
    expect(error.code).toBe('RUN_AMBIGUOUS');
    expect(error.message).toContain('acme-2026-10-11, acme-2026-10-12');
    expect(await store.listRuns({ campaignId: 'acme-2026-10-11' })).toStrictEqual([day1]);
  });

  it('list runs oldest first, filtered by campaign, spec, mode and status', async () => {
    await store.putCampaign(campaign('acme-2026-10-12', { createdAt: '2026-10-12T09:00:00.000Z' }));
    const a = run({ startedAt: '2026-10-11T10:02:00.000Z', finishedAt: '2026-10-11T10:02:05.000Z' });
    const b = run({ repeat: 1, status: 'failed', startedAt: '2026-10-11T10:01:00.000Z' });
    const c = perturbedRun({ specId: 'acme-plan-upgrade', specHash: 'def456def456' });
    const d = run({ target: SUPPORT, mode: 'T', startedAt: '2026-10-12T10:00:00.000Z' });
    await store.putRun('acme-2026-10-11', a);
    await store.putRun('acme-2026-10-11', b);
    await store.putRun('acme-2026-10-11', c);
    await store.putRun('acme-2026-10-12', d);

    const ids = async (filter?: Parameters<SqliteStore['listRuns']>[0]) =>
      (await store.listRuns(filter)).map((each) => each.runId);
    expect(await ids()).toEqual([b.runId, a.runId, c.runId, d.runId]);
    expect(await ids({ campaignId: 'acme-2026-10-11' })).toEqual([b.runId, a.runId, c.runId]);
    expect(await ids({ specId: 'acme-plan-upgrade' })).toEqual([c.runId]);
    expect(await ids({ mode: 'T' })).toEqual([d.runId]);
    expect(await ids({ status: 'failed' })).toEqual([b.runId]);
    expect(await ids({ campaignId: 'acme-2026-10-11', mode: 'F', status: 'completed' })).toEqual([a.runId]);
    expect(await ids({ campaignId: 'acme-2026-10-13' })).toEqual([]);
  });

  it('take the cell id as the run id the runner computes', async () => {
    const stored = run();
    expect(stored.runId).toBe(
      cellId({ specHash: 'abc123abc123', target: stored.target, mode: 'F', repeat: 0 }),
    );
    expect(cellId(stored)).toBe(stored.runId);
  });

  it('refuse a run of a campaign the store does not hold, and store nothing', async () => {
    const error = await storeError(() => store.putRun('acme-unknown', run()));
    expect(error.code).toBe('CAMPAIGN_MISSING');
    expect(await store.listRuns()).toEqual([]);
  });

  it('refuse an invalid run and blocks out of order', async () => {
    const invalid = { ...run(), mode: 'X' } as unknown as ReturnType<typeof run>;
    expect((await storeError(() => store.putRun('acme-2026-10-11', invalid))).code).toBe('INVALID_RECORD');
    const unordered = run({ blocks: [block(1), block(0)] });
    const error = await storeError(() => store.putRun('acme-2026-10-11', unordered));
    expect(error.code).toBe('INVALID_RECORD');
    expect(error.message).toContain('block indexes must rise strictly');
    const repeated = run({ blocks: [block(0), block(0)] });
    expect((await storeError(() => store.putRun('acme-2026-10-11', repeated))).code).toBe('INVALID_RECORD');
    expect(await store.listRuns()).toEqual([]);
  });

  it('refuse a run JSON cannot hold, and keep the version already stored', async () => {
    const stored = run();
    await store.putRun('acme-2026-10-11', stored);
    const looped: Record<string, unknown> = {};
    looped.self = looped;
    const bad = run({ blocks: [block(0, { observed: { ...block(0).observed, raw: looped } })] });
    const error = await storeError(() => store.putRun('acme-2026-10-11', bad));
    expect(error.code).toBe('INVALID_RECORD');
    expect(error.message).toContain('cannot be written as JSON');
    expect(await store.getRun(stored.runId)).toStrictEqual(stored);
  });
});

describe('a closed store', () => {
  it('refuses every call and closes twice without error', async () => {
    const closing = openMemoryStore();
    await closing.close();
    await expect(closing.close()).resolves.toBeUndefined();
    expect((await storeError(() => closing.listRuns())).code).toBe('CLOSED');
    expect((await storeError(() => closing.listCampaigns())).code).toBe('CLOSED');
    expect((await storeError(() => closing.cacheGet('k'))).code).toBe('CLOSED');
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Campaign, parseSpecText, type RunResult } from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { afterAll, describe, expect, it } from 'vitest';
import { rankCommand } from '../src/commands/compare-rank';
import type { Io } from '../src/index';

/**
 * Blast-radius audit (PR 428): `compare --rank` scores each shared run as a win, a loss or a tie. A run not
 * run or blocked measured nothing, so it is no shared run: never a loss to a campaign that passed it.
 * Fictional data only.
 */
const SPEC = ['id: g', 'blocks:', '  - user: Hello', '  - user: Again'].join('\n');

function runOf(campaign: string, hash: string, last: 'pass' | 'not_run' | 'blocked'): RunResult {
  const block = (index: number, kind: 'pass' | 'not_run' | 'blocked') => ({
    index,
    givenHash: `g${index}`,
    observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts: [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: kind === 'pass',
    ...(kind === 'not_run'
      ? {
          status: 'not_run' as const,
          notRun: {
            kind: 'unsupported' as const,
            layer: '5 world',
            check: 'capability',
            expected: 'e',
            got: 'g',
          },
        }
      : {}),
    ...(kind === 'blocked'
      ? { status: 'blocked' as const, blocked: { by: 'block 0', root: 'block 0' } }
      : {}),
  });
  return {
    runId: `${campaign}-g`,
    specId: 'g',
    specHash: hash,
    target: { adapter: 'function', agent: campaign },
    mode: 'F',
    repeat: 0,
    status: 'completed',
    blocks: [block(0, 'pass'), block(1, last)],
    succession: { driftCount: 0, driftRate: 0, longestClean: 1, minOverBlocks: last === 'pass' },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:00.000Z',
    cacheHit: false,
  };
}

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function rank() {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-rank-'));
  made.push(dir);
  // The command checks that a store file exists; the store it reads is the one handed to it.
  await writeFile(join(dir, 'store.db'), '');
  const store = openMemoryStore();
  const loaded = parseSpecText(SPEC, 'yaml', 'g.yaml');
  if (!loaded.ok) throw new Error('the inline spec does not load');
  await store.putSpec(loaded);
  for (const [id, last] of [
    ['v1', 'pass'],
    ['v2', 'not_run'],
    ['v3', 'blocked'],
  ] as const) {
    const target = { adapter: 'function', agent: id };
    const campaign: Campaign = {
      campaignId: id,
      specs: [{ id: 'g', hash: loaded.hash, target }],
      targets: [target],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-15T00:00:00.000Z',
    };
    await store.putCampaign(campaign);
    await store.putRun(id, runOf(id, loaded.hash, last));
  }
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: dir,
  };
  const code = await rankCommand({ rank: ['v1', 'v2', 'v3'], store: 'store.db', json: true }, io, {
    openStore: async () => store,
  });
  return { code, out, err };
}

describe('blast radius: compare --rank over runs not run or blocked', () => {
  it('a run not run or blocked is no shared run: v1 wins nothing over v2 or v3', async () => {
    const { err, out } = await rank();
    expect(err).toBe('');
    const doc = JSON.parse(out) as { shared: number[][]; wins: number[][] };
    expect(doc.shared[0]?.[1]).toBe(0);
    expect(doc.shared[0]?.[2]).toBe(0);
    expect(doc.wins[0]?.[1]).toBe(0);
  });
});

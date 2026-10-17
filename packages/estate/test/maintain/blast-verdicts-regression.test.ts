import type { Campaign, RunResult, Store } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { compareReplays, latestReplay, runPassed } from '../../src/index';

/**
 * Blast-radius audit (PR 428): the estate regression report reads each replay run as pass or fail. A replay
 * run whose blocks were not run measured nothing, so it must never read as a pass that turned into a fail.
 */
function replayRun(spec: string, last: 'pass' | 'not_run'): RunResult {
  const block = (index: number, kind: 'pass' | 'not_run') => ({
    index,
    givenHash: `g${index}`,
    observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts: [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: kind === 'pass',
    ...(kind === 'not_run'
      ? {
          status: 'not_run' as const,
          notRun: {
            kind: 'unsupported' as const,
            layer: '1 history',
            check: 'capability',
            expected: 'e',
            got: 'g',
          },
        }
      : {}),
  });
  return {
    runId: `${spec}-a`,
    specId: spec,
    specHash: 'h',
    target: { adapter: 'claude-code', agent: 'a' },
    mode: 'F',
    repeat: 0,
    status: 'completed',
    blocks: [block(0, 'pass'), block(1, last)],
    succession: { driftCount: 0, driftRate: 0, longestClean: 1, minOverBlocks: false },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:00.000Z',
    cacheHit: false,
  } as RunResult;
}

describe('blast radius: the estate replay regression and blocks not run', () => {
  it('a not_run replay run never reads as a pass', () => {
    expect(runPassed(replayRun('s1', 'not_run'))).toBe(false);
    expect(runPassed(replayRun('s1', 'pass'))).toBe(true);
  });

  it('a spec that passed before and is not run now is no pass_to_fail regression', async () => {
    const store = {
      listCampaigns: async () => [{ campaignId: 'replay-b' }] as Campaign[],
      listRuns: async () => [replayRun('s1', 'not_run')],
    } as unknown as Store;
    const latest = await latestReplay(store);
    const { counts } = compareReplays([{ spec: 's1', session: 'a', pass: true }], latest?.outcomes ?? []);
    expect(counts.pass_to_fail).toBe(0);
  });
});

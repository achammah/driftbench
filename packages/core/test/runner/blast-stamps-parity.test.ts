// Blast radius of unit F2 on the runner: with the shipped check set, a run record differs from the one main
// wrote (old-records.json, made by make-old-records.ts with a fixed clock) only by the stamps. Verdicts, their
// order, pass, drift, cache keys and hashes are byte for byte main's once `by` and `resolved` are taken out.
import { readFileSync } from 'node:fs';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { type RunResult, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { loadAcmeConversations, realAcmeAdapter } from './support';

const OLD = new URL('../fixtures/framework/old-records.json', import.meta.url);
const fixed = () => new Date('2026-10-15T00:00:00.000Z');

/** A record with the F2 stamps taken out: what main wrote for the same run. */
function unstamped(run: RunResult): RunResult {
  return {
    ...run,
    blocks: run.blocks.map(({ resolved: _resolved, ...block }) => ({
      ...block,
      verdicts: block.verdicts.map(({ by: _by, ...verdict }) => verdict),
    })),
  };
}

/** The record without its measured latencies, which a wall clock writes. */
function withoutLatency(run: RunResult): unknown {
  const { latencyMs: _run, ...rest } = run;
  return {
    ...rest,
    blocks: rest.blocks.map((block) => {
      const { latencyMs: _block, ...observed } = block.observed;
      return { ...block, observed };
    }),
  };
}

describe('blast stamps: default parity with main over every Acme conversation', () => {
  it('writes main records plus by and resolved, in modes T and F', async () => {
    const old = (JSON.parse(readFileSync(OLD, 'utf8')) as { records: RunResult[] }).records;
    const fresh: RunResult[] = [];
    for (const { spec } of await loadAcmeConversations()) {
      for (const mode of ['T', 'F'] as const) {
        fresh.push(
          await runSpec(spec, {
            adapter: realAcmeAdapter(),
            driver: createScriptedDriver(),
            checks: defaultChecks(),
            mode,
            repeat: 0,
            now: fixed,
          }),
        );
      }
    }
    expect(fresh.length).toBe(old.length);
    let verdicts = 0;
    for (const [index, run] of fresh.entries()) {
      const before = old[index] as RunResult;
      // Only the measured latencies may differ; everything else, the observations included, is main's.
      expect(withoutLatency(JSON.parse(JSON.stringify(unstamped(run))))).toStrictEqual(
        withoutLatency(before),
      );
      for (const block of run.blocks) {
        expect(block.resolved?.objects.map((entry) => entry.id)).toEqual(['default', 'default']);
        for (const verdict of block.verdicts) {
          verdicts += 1;
          expect(verdict.by?.layer).toBe('shipped');
        }
      }
    }
    expect(verdicts).toBe(978);
  });
});

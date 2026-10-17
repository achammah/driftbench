import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import type { BlockResult, RunResult, Spec } from '../../src/index';

import {
  capabilityGap,
  compoundingIndex,
  countBlocks,
  countRuns,
  injectingDriver,
  outcomeOf,
  type PlannedCell,
  runOutcome,
  runSpec,
  succession,
  unscoredText,
} from '../../src/runner';
import { acmeAdapter, acmeSpec, loadAcmeConversations } from './support';

/**
 * Blast-radius audit of the not_run and blocked verdicts (PR 428), core side: the cell outcome, the verdict
 * counts, the succession and compounding rates, the capability check on an adapter that declares no
 * capability, and the recovery of a perturbation that was never sent. The rate fixture is 1 pass, 1 not_run,
 * 1 blocked, so each rate reads 100% of the scored.
 */

const NOT_RUN = {
  kind: 'unsupported' as const,
  layer: '5 world',
  check: 'capability',
  expected: 'e',
  got: 'g',
};
const BLOCKED = { by: 'block 0', root: 'block 0' };

function block(index: number, kind: 'pass' | 'fail' | 'not_run' | 'blocked'): BlockResult {
  return {
    index,
    givenHash: `g${index}`,
    observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts:
      kind === 'fail'
        ? [{ id: 'must.0', kind: 'machine', name: 'must', gating: true, outcome: 'fail', evidence: 'x' }]
        : [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: kind === 'fail' ? ['X1_local'] : [],
    pass: kind === 'pass',
    ...(kind === 'not_run' ? { status: 'not_run' as const, notRun: NOT_RUN } : {}),
    ...(kind === 'blocked' ? { status: 'blocked' as const, blocked: BLOCKED } : {}),
  };
}

function runOf(
  kinds: Array<'pass' | 'fail' | 'not_run' | 'blocked'>,
  repeat = 0,
  extra: Partial<RunResult> = {},
): RunResult {
  const blocks = kinds.map((kind, index) => block(index, kind));
  return {
    runId: `r${repeat}`,
    specId: 'g',
    specHash: 'h',
    target: { adapter: 'function', agent: 'demo' },
    mode: 'F',
    repeat,
    status: 'completed',
    blocks,
    succession: succession(blocks),
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:00.000Z',
    cacheHit: false,
    ...extra,
  };
}

const cell = (run: RunResult): PlannedCell => ({
  cellId: run.runId,
  specId: run.specId,
  specHash: run.specHash,
  target: run.target,
  mode: run.mode,
  repeat: run.repeat,
  blocks: run.blocks.length,
});

describe('blast radius: the cell outcome of a run with a block not run or blocked', () => {
  it('blocked is its own state, with the ancestor in failing, never a fail', () => {
    const run = runOf(['pass', 'blocked']);
    const outcome = outcomeOf(cell(run), run);
    expect(outcome.state).toBe('blocked');
    expect(outcome.failing).toEqual(['block 1 blocked by block 0']);
  });

  it('not_run is its own state; a measured failure beside it stays a fail', () => {
    const notRun = runOf(['pass', 'not_run']);
    expect(outcomeOf(cell(notRun), notRun).state).toBe('not_run');
    const failed = runOf(['fail', 'not_run']);
    const outcome = outcomeOf(cell(failed), failed);
    expect(outcome.state).toBe('fail');
    expect(outcome.failing).toEqual(['block 0 must.0', 'block 1 not_run capability']);
  });

  it('a run not completed stays its own status, whatever its blocks', () => {
    const run = runOf(['pass', 'not_run'], 0, { status: 'stopped' });
    expect(outcomeOf(cell(run), run).state).toBe('stopped');
  });

  it('the end verdict is left out of the cell state, so a not_run run keeps the not_run state', () => {
    const run = runOf(['pass', 'not_run'], 0, { endVerdict: 'failure' });
    expect(runOutcome(run)).toBe('fail');
    expect(outcomeOf(cell(run), run).state).toBe('not_run');
  });
});

describe('blast radius: counts and rates over 1 pass, 1 not_run, 1 blocked', () => {
  const runs = [runOf(['pass', 'pass'], 0), runOf(['pass', 'not_run'], 1), runOf(['pass', 'blocked'], 2)];

  it('countRuns and countBlocks put each in its own column', () => {
    expect(countRuns(runs)).toEqual({ pass: 1, fail: 0, not_run: 1, blocked: 1 });
    expect(countBlocks(runOf(['pass', 'not_run', 'blocked']).blocks)).toEqual({
      pass: 1,
      fail: 0,
      not_run: 1,
      blocked: 1,
    });
    expect(unscoredText({ not_run: 1, blocked: 1 })).toBe('1 not run, 1 blocked');
    expect(unscoredText({ not_run: 0, blocked: 0 })).toBe('');
  });

  it('succession: no drift, drift rate 0 of the scored, and the clean stretch ends at the unscored block', () => {
    const s = succession(runOf(['pass', 'not_run', 'blocked']).blocks);
    expect(s).toEqual({ driftCount: 0, driftRate: 0, longestClean: 1, minOverBlocks: false });
    const drifting = succession(runOf(['fail', 'not_run', 'blocked']).blocks);
    expect(drifting.driftRate).toBe(1);
    expect(drifting.firstDriftBlock).toBe(0);
  });

  it('compounding: a block not run or blocked adds no measurement to its block rate', () => {
    const t = (kinds: Array<'pass' | 'fail' | 'not_run' | 'blocked'>, repeat: number) => ({
      ...runOf(kinds, repeat),
      runId: `t${repeat}`,
      mode: 'T' as const,
    });
    const index = compoundingIndex([
      t(['pass', 'pass'], 0),
      t(['pass', 'not_run'], 1),
      t(['pass', 'blocked'], 2),
      runOf(['pass', 'pass'], 3),
    ]);
    const [line] = index.specs;
    expect(line?.blocks).toEqual([
      { block: 0, passT: 1, passF: 1, runsT: 3, runsF: 1 },
      { block: 1, passT: 1, passF: 1, runsT: 1, runsF: 1 },
    ]);
  });
});

describe('blast radius: the capability check on an adapter that declares nothing', () => {
  it('a missing capability reads as false: a prefix and a forced tool result are each not_run', () => {
    const none = {} as never;
    expect(capabilityGap('bare', none, { prefix: 'authored', world: {} })).toMatchObject({
      kind: 'unsupported',
      check: 'capability',
      layer: '1 history',
      got: 'bare declares seedPrefix false: the agent would never see it',
    });
    expect(
      capabilityGap('bare', none, { world: { tools: { lookup: { result: { ok: true } } } } }),
    ).toMatchObject({ layer: '5 world', got: 'bare declares toolStubs false: the agent would never see it' });
    expect(capabilityGap('bare', none, { world: {} })).toBeUndefined();
  });

  it('a whole run on such an adapter: every block not_run, the agent never called', async () => {
    const loaded = await loadAcmeConversations();
    const spec = acmeSpec(loaded, 'acme-tool-failure');
    const adapter = acmeAdapter({ capabilities: { seedPrefix: undefined, toolStubs: undefined } as never });
    const run = await runSpec(spec, {
      adapter,
      driver: createScriptedDriver(),
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
    });
    expect(run.blocks.every((entry) => entry.status === 'not_run')).toBe(true);
    expect(adapter.calls.send).toBe(0);
  });
});

describe('blast radius: the recovery of a perturbation never sent', () => {
  it('a P run whose injected block is not run measures no recovery', async () => {
    const loaded = await loadAcmeConversations();
    const original = acmeSpec(loaded, 'acme-tool-failure');
    // The base Given forces no tool result; only the perturbation does, so only the injected block needs toolStubs.
    const { given: _given, ...rest } = original;
    const spec = {
      ...rest,
      blocks: original.blocks.map((entry) => {
        const { given: _blockGiven, ...kept } = entry;
        return kept;
      }),
    } as Spec;
    const run = await runSpec(spec, {
      adapter: acmeAdapter({ capabilities: { toolStubs: false } }),
      driver: injectingDriver(createScriptedDriver(), 'sales-queue-down'),
      checks: defaultChecks(),
      mode: 'P',
      repeat: 0,
      perturbationId: 'sales-queue-down',
    });
    const injected = run.blocks.find((entry) => entry.injected);
    expect(injected?.status).toBe('not_run');
    expect(run.recovery).toBeUndefined();
  });
});

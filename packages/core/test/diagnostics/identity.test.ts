import {
  type BlockResult,
  type CampaignDiagnosis,
  type Diagnosis,
  initializeShippedObjects,
  ObjectStore,
  objectRegistry,
  type RunResult,
  registerDiagnosticStep,
  runCampaignDiagnostics,
  runRunDiagnostics,
} from '@agent-nexus/driftbench-core';
import { beforeEach, expect, it } from 'vitest';
import { z } from 'zod';

const seen: Array<readonly CampaignDiagnosis[]> = [];
initializeShippedObjects();
registerDiagnosticStep('plugin:diagnosis-identity-probe', {
  params: z.strictObject({}),
  cost: 'static',
  run: (ctx) => {
    if (ctx.diagnoses === undefined) throw new Error('missing diagnosis identities');
    seen.push(ctx.diagnoses);
    return { summary: 'identities inspected' };
  },
});
beforeEach(() => {
  seen.length = 0;
});

function diagnostic(scope: 'run' | 'campaign') {
  const store = new ObjectStore(objectRegistry);
  store.add(
    {
      kind: 'diagnostic',
      id: `identity-${scope}`,
      scope,
      steps: [{ id: 'inspect', title: 'Inspect identities', impl: 'plugin:diagnosis-identity-probe' }],
    },
    'project',
    { path: `${scope}.yaml` },
  );
  return store.resolve('diagnostic', `identity-${scope}`);
}
function diagnosis(summary: string, verdictRef?: string): Diagnosis {
  return {
    diagnostic: 'diagnostic:original@12345678',
    step: 'explain',
    summary,
    ...(verdictRef === undefined ? {} : { verdictRef }),
    disposition: 'agent',
    confidence: 'confirmed',
    score: 0.25,
    evidence: { source: summary, nested: { retained: true } },
    by: { object: 'policy/blame:house@12345678', item: 'rule', impl: 'plugin:rule', layer: 'project' },
  };
}
function block(index: number, diagnoses: Diagnosis[] = []): BlockResult {
  return {
    index,
    givenHash: `given-${index}`,
    observed: { text: 'ok', segments: [], toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts: [
      {
        id: 'tools.same.input.value',
        kind: 'machine',
        name: 'tools',
        outcome: 'fail',
        gating: true,
        evidence: 'failed',
      },
    ],
    ...(diagnoses.length ? { diagnoses } : {}),
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: false,
  };
}
function run(runId: string, blocks: BlockResult[], diagnoses: Diagnosis[] = []): RunResult {
  return {
    runId,
    specId: 'same-spec',
    specHash: 'same-spec-hash',
    target: { adapter: 'fixture' },
    mode: 'T',
    repeat: 0,
    status: 'completed',
    blocks,
    ...(diagnoses.length ? { diagnoses } : {}),
    succession: { driftCount: 0, driftRate: 0, longestClean: 0, minOverBlocks: false },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-15T00:00:00Z',
    finishedAt: '2026-10-15T00:00:01Z',
    cacheHit: false,
  };
}
function fixture() {
  const ref = 'tools.same.input.value';
  const aFirst = diagnosis('a first', ref);
  const aGeneral = diagnosis('a no verdict');
  const aLater = diagnosis('a later', ref);
  const aRun = diagnosis('a run');
  const bFirst = diagnosis('b first', ref);
  const bLater = diagnosis('b later', ref);
  const bGeneral = diagnosis('b no verdict');
  const bRun = diagnosis('b run', ref);
  const runs = [
    run('run-a', [block(7, [aFirst, aGeneral]), block(11), block(23, [aLater])], [aRun]),
    run('run-b', [block(3, [bFirst]), block(14), block(19, [bLater, bGeneral])], [bRun]),
  ];
  const expected: CampaignDiagnosis[][] = [
    [
      { runId: 'run-a', blockIndex: 7, verdictRef: ref, diagnosis: aFirst },
      { runId: 'run-a', blockIndex: 7, verdictRef: undefined, diagnosis: aGeneral },
      { runId: 'run-a', blockIndex: 23, verdictRef: ref, diagnosis: aLater },
      { runId: 'run-a', blockIndex: undefined, verdictRef: undefined, diagnosis: aRun },
    ],
    [
      { runId: 'run-b', blockIndex: 3, verdictRef: ref, diagnosis: bFirst },
      { runId: 'run-b', blockIndex: 19, verdictRef: ref, diagnosis: bLater },
      { runId: 'run-b', blockIndex: 19, verdictRef: undefined, diagnosis: bGeneral },
      { runId: 'run-b', blockIndex: undefined, verdictRef: ref, diagnosis: bRun },
    ],
  ];
  return { runs, expected };
}
function assertEveryIdentity(
  actual: readonly CampaignDiagnosis[] | undefined,
  expected: CampaignDiagnosis[],
) {
  expect(actual).toEqual(expected);
  for (const [index, entry] of (actual ?? []).entries()) {
    expect(Object.keys(entry).sort()).toEqual(['blockIndex', 'diagnosis', 'runId', 'verdictRef']);
    expect(entry.diagnosis).toBe(expected[index]?.diagnosis);
  }
}

it('gives campaign steps every diagnosis with its run, original block index, and optional verdict identity', async () => {
  const { runs, expected } = fixture();
  const before = structuredClone(runs);
  await runCampaignDiagnostics([diagnostic('campaign')], runs);
  expect(seen).toHaveLength(1);
  assertEveryIdentity(seen[0], expected.flat());
  expect(runs).toEqual(before);
});

it.each([0, 1])('gives run steps only diagnoses belonging to run %s', async (index) => {
  const { runs, expected } = fixture();
  const before = structuredClone(runs);
  const selected = runs[index];
  const identities = expected[index];
  if (!selected || !identities) throw new Error('missing fixture run');
  await runRunDiagnostics([diagnostic('run')], selected);
  expect(seen).toHaveLength(1);
  assertEveryIdentity(seen[0], identities);
  expect(runs).toEqual(before);
});

it('passes an empty identity array for empty runs and blocks without diagnoses', async () => {
  const empty = run('empty', []);
  const undiagnosed = run('undiagnosed', [block(12)]);
  await runCampaignDiagnostics([diagnostic('campaign')], [empty, undiagnosed]);
  await runRunDiagnostics([diagnostic('run')], empty);
  expect(seen).toEqual([[], []]);
});

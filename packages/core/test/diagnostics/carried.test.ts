import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { type CheckSet, machineVerdict } from '../../src/contracts/check';
import { registerDiagnosticStep } from '../../src/diagnostics/run';
import type { ObjectContext } from '../../src/objects/layers';
import { ObjectStore, objectRegistry } from '../../src/objects/resolve';
import { rescoreCarriedRun } from '../../src/runner/carried-scoring';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import type { Diagnosis, RunResult } from '../../src/schema/run';
import type { Spec } from '../../src/schema/spec';

initializeShippedObjects();
registerDiagnosticStep('plugin:carry-explain', {
  params: z.strictObject({ tag: z.string() }),
  cost: 'static',
  run: ({ params, scope, verdicts, objects }) => ({
    summary: `${params.tag}:${scope}:${verdicts.filter((v) => v.outcome === 'fail').length}`,
    evidence: { checkSet: objects.find((entry) => entry.key === 'check_set')?.object.ref },
  }),
});
registerDiagnosticStep('plugin:carry-budget', {
  params: z.strictObject({ tag: z.string() }),
  cost: 'run',
  // This deterministic step exercises budget accounting without calling an agent or a service.
  run: ({ params }) => ({ summary: `${params.tag}:budget` }),
});

function objects(tag: string, enabled = true): ObjectContext {
  const store = new ObjectStore(objectRegistry.clone());
  store.add(
    { kind: 'check-set', id: 'carry-house', extends: 'default', items: [{ id: 'must', enabled }] },
    'project',
    { path: 'house.yaml' },
  );
  for (const scope of ['block', 'run']) {
    store.add(
      {
        kind: 'diagnostic',
        id: `carry-${scope}`,
        scope,
        when: { any_verdict: { name: 'must', outcome: 'fail' } },
        steps: [
          { id: 'explain', title: 'Explain', impl: 'plugin:carry-explain', params: { tag } },
          { id: 'budget', title: 'Budget', impl: 'plugin:carry-budget', params: { tag } },
        ],
      },
      'project',
      { path: `${scope}.yaml` },
    );
  }
  return { store, uses: [], problems: [] };
}

const spec: Spec = {
  id: 'carry-diagnostics',
  kind: 'conversation',
  metadata: { depends: {} },
  uses: { check_set: 'carry-house', diagnostics: ['carry-block', 'carry-run'] },
  blocks: ['one', 'two', 'three'].map((stage) => ({
    when: { user: stage },
    expect: { stage, must: ['good'] },
  })),
};
const checks: CheckSet = [
  {
    name: 'must',
    applies: () => true,
    evaluate: () => [machineVerdict('must', '0', 'fail', 'bad observation')],
  },
];
const target = { adapter: 'function', variant: 'v1' };
const common = {
  driver: createScriptedDriver(),
  checks,
  mode: 'T' as const,
  repeat: 0,
  target,
  recordProvenance: true,
};
function adapter() {
  let calls = 0;
  return {
    calls: () => calls,
    adapter: functionAdapter({
      respond: () => {
        calls++;
        return { text: 'bad', segments: [], toolCalls: [], cost: {}, latencyMs: 0 };
      },
    }),
  };
}
const stale: Diagnosis = {
  diagnostic: 'diagnostic:old@00000000',
  step: 'old',
  summary: 'stale',
  by: { object: 'diagnostic:old@00000000', item: 'old', impl: 'plugin:carry-explain', layer: 'project' },
};
function withStale(source: RunResult): RunResult {
  return {
    ...source,
    diagnoses: [stale],
    skippedForBudget: 99,
    blocks: source.blocks.map((block) => ({
      ...block,
      diagnoses: [stale],
      skippedForBudget: 99,
    })),
  };
}
function expectCurrent(run: RunResult, current: ObjectContext, budget: boolean) {
  const blockDiagnostic = current.store.resolve('diagnostic', 'carry-block').ref;
  const runDiagnostic = current.store.resolve('diagnostic', 'carry-run').ref;
  const checkSet = current.store.resolve('check-set', 'carry-house').ref;
  for (const block of run.blocks) {
    expect(block.pass).toBe(false);
    expect(block.verdicts.find((verdict) => verdict.name === 'must')).toMatchObject({
      id: 'must.0',
      outcome: 'fail',
    });
    expect(block.diagnoses?.map((entry) => entry.summary)).toEqual(
      budget ? ['new:block:1', 'new:budget'] : ['new:block:1'],
    );
    expect(block.diagnoses?.[0]).toMatchObject({
      diagnostic: blockDiagnostic,
      by: { object: blockDiagnostic },
      evidence: { checkSet },
    });
    expect(block.skippedForBudget).toBe(budget ? undefined : 1);
  }
  expect(run.skippedForBudget).toBe(budget ? undefined : 1);
  expect(run.diagnoses).toEqual([
    expect.objectContaining({
      summary: 'new:run:3',
      diagnostic: runDiagnostic,
      by: expect.objectContaining({ object: runDiagnostic }),
      evidence: { checkSet },
    }),
    ...(budget ? [expect.objectContaining({ summary: 'new:budget' })] : []),
  ]);
}

it('runs block and run diagnostics on fresh verdicts under the resolved objects', async () => {
  const current = objects('new');
  const fixture = adapter();
  const run = await runSpec(spec, { ...common, adapter: fixture.adapter, objects: current });
  expect(fixture.calls()).toBe(3);
  expectCurrent(run, current, false);
});

it('refreshes partial T carries and preserves the requested diagnostic budget on every block', async () => {
  const fixture = adapter();
  const source = withStale(
    await runSpec(spec, {
      ...common,
      adapter: fixture.adapter,
      objects: objects('old', false),
    }),
  );
  const current = objects('new');
  const run = await runSpec(spec, {
    ...common,
    adapter: fixture.adapter,
    target: { ...target, variant: 'v2' },
    objects: current,
    diagnosticBudget: { runs: 1 },
    blocks: new Set([1]),
    blockReuse: {
      source,
      fromCampaign: 'base',
      baselineProvenance: {
        version: 2,
        adapters: [
          {
            ...adapterProvenance(fixture.adapter),
            targetHash: provenanceHash(target),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
      manifest: { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'two' }] },
    },
  });
  expect(fixture.calls()).toBe(4);
  expect(run.blocks.map((block) => Boolean(block.carried))).toEqual([true, false, true]);
  expectCurrent(run, current, true);
});

it.each(['T', 'F'] as const)(
  'refreshes whole-cell %s diagnoses from new verdicts without another adapter call',
  async (mode) => {
    const fixture = adapter();
    const source = withStale(
      await runSpec(spec, {
        ...common,
        mode,
        adapter: fixture.adapter,
        objects: objects('old', false),
      }),
    );
    const current = objects('new');
    const rescored = await rescoreCarriedRun(spec, source, { checks, objects: current });
    expect(fixture.calls()).toBe(3);
    expect(rescored.blocks.map((block) => block.observed)).toEqual(
      source.blocks.map((block) => block.observed),
    );
    expectCurrent(rescored, current, false);
  },
);

it('removes obsolete diagnoses and skip counts when new verdicts no longer trigger diagnostics', async () => {
  const fixture = adapter();
  const source = withStale(
    await runSpec(spec, {
      ...common,
      adapter: fixture.adapter,
      objects: objects('old'),
    }),
  );
  const rescored = await rescoreCarriedRun(spec, source, { checks, objects: objects('new', false) });
  expect(rescored.diagnoses).toBeUndefined();
  expect(rescored.skippedForBudget).toBeUndefined();
  for (const block of rescored.blocks) {
    expect(block.pass).toBe(true);
    expect(block.diagnoses).toBeUndefined();
    expect(block.skippedForBudget).toBeUndefined();
  }
});

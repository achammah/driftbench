import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { z } from 'zod';
import type { Check } from '../../src/contracts/check';
import { registerDiagnosticStep } from '../../src/diagnostics/run';
import type { ObjectContext } from '../../src/objects/layers';
import { ObjectStore, objectRegistry } from '../../src/objects/resolve';
import { prepareRejudge, rejudgeRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { RunResult } from '../../src/schema/run';
import { validateSpec } from '../../src/spec/load';
import { echoAdapter } from '../runner/support';

initializeShippedObjects();
let costlyCalls = 0;
let diagnosedRunId: string | undefined;
for (const cost of ['static', 'model'] as const) {
  registerDiagnosticStep(`plugin:rejudge-refresh-${cost}`, {
    params: z.strictObject({ tag: z.string() }),
    cost,
    run: ({ scope, verdicts, params, run, diagnoses }) => {
      if (scope === 'run') {
        diagnosedRunId = run?.runId;
        expect(diagnoses?.every((entry) => entry.runId === run?.runId)).toBe(true);
      }
      if (cost === 'model') costlyCalls++;
      return { summary: `${params.tag}:${scope}:${verdicts.map((v) => v.outcome).join(',')}:${cost}` };
    },
  });
}
function objects(tag: string, failOnly = true, costly = false): ObjectContext {
  const store = new ObjectStore(objectRegistry.clone());
  for (const scope of ['block', 'run'] as const) {
    store.add(
      {
        kind: 'diagnostic',
        id: `refresh-${scope}`,
        scope,
        when: failOnly ? { any_verdict: { outcome: 'fail' } } : { always: true },
        steps: [
          { id: 'read', title: 'Read verdicts', impl: 'plugin:rejudge-refresh-static', params: { tag } },
          ...(costly
            ? [{ id: 'confirm', title: 'Confirm', impl: 'plugin:rejudge-refresh-model', params: { tag } }]
            : []),
        ],
      },
      'project',
      { path: `${scope}.yaml` },
    );
  }
  return { store, uses: [], problems: [] };
}
const target = { adapter: 'echo', variant: 'v1' };
const judge = (outcome: 'pass' | 'fail'): Check => ({
  name: 'judge',
  applies: (ctx) => (ctx.expect.criteria?.length ?? 0) > 0,
  evaluate: () => [
    { id: 'judge.price', kind: 'judge', name: 'price', gating: true, outcome, evidence: outcome },
  ],
});
async function baseline(outcome: 'pass' | 'fail', context: ObjectContext, budget = 0) {
  const parsed = validateSpec(
    {
      id: 'rejudge-diagnostics',
      uses: { diagnostics: ['refresh-block', 'refresh-run'] },
      criteria: [{ name: 'price', rubric: 'A price is present.', gating: true }],
      blocks: [{ when: { user: 'Quote.' }, expect: { criteria: ['price'] } }, { when: { user: 'Thanks.' } }],
    },
    'fixture.yaml',
    { objects: context },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const adapter = echoAdapter();
  const source = await runSpec(parsed.spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: [judge(outcome)],
    mode: 'F',
    repeat: 0,
    target,
    recordProvenance: true,
    diagnosticBudget: { runs: budget },
    now: () => new Date('2026-10-13T00:00:00Z'),
  });
  // JSON removes the loader's context, so explicit current objects must reach diagnostics.
  const spec = JSON.parse(JSON.stringify(parsed.spec));
  spec.criteria[0].rubric = 'The price is 12.';
  const prepared = prepareRejudge(parsed.spec, spec, source, {
    baselineProvenance: {
      version: 2,
      adapters: [
        {
          ...adapterProvenance(adapter, target.adapter),
          targetHash: provenanceHash(target),
          agentVersionHash: provenanceHash('v1'),
        },
      ],
    },
    fromCampaign: 'baseline',
    agentVersion: 'v1',
    criteria: ['price'],
    now: new Date('2026-10-13T01:00:00Z'),
  });
  return { source, prepared, adapter, opens: adapter.opened.length };
}

it('drops obsolete failure diagnoses at block and run scope after fail becomes pass', async () => {
  const context = objects('old');
  const { source, prepared, adapter, opens } = await baseline('fail', context);
  expect(source.blocks[0]?.diagnoses?.[0]?.summary).toBe('old:block:fail:static');
  expect(source.diagnoses?.[0]?.summary).toBe('old:run:fail:static');
  const result = await rejudgeRun(prepared, judge('pass'), () => 0, context);
  expect(result.blocks[0]?.pass).toBe(true);
  expect(result.blocks[0]).not.toHaveProperty('diagnoses');
  expect(result).not.toHaveProperty('diagnoses');
  expect(adapter.opened).toHaveLength(opens);
  expect(source.blocks[0]?.diagnoses).toHaveLength(1);
});

it('creates diagnoses from new failing verdicts at block and run scope', async () => {
  const { source, prepared } = await baseline('pass', objects('old'));
  expect(source.blocks[0]).not.toHaveProperty('diagnoses');
  expect(source).not.toHaveProperty('diagnoses');
  const context = objects('current');
  const result = await rejudgeRun(prepared, judge('fail'), () => 0, context);
  expect(result.blocks[0]?.diagnoses?.[0]).toMatchObject({
    summary: 'current:block:fail:static',
    by: { object: context.store.resolve('diagnostic', 'refresh-block').ref, layer: 'project' },
  });
  expect(result.diagnoses?.[0]?.summary).toBe('current:run:fail:static');
  expect(diagnosedRunId).toBe(result.runId);
});

it('refreshes diagnostics on carried blocks and clears old budget counts when nothing is skipped', async () => {
  const { prepared } = await baseline('pass', objects('old', false, true));
  expect(prepared.source.blocks[1]?.skippedForBudget).toBe(1);
  const result = await rejudgeRun(prepared, judge('pass'), () => 0, objects('current', false));
  expect(result.blocks[1]?.carried).toBeDefined();
  expect(result.blocks[1]?.diagnoses?.[0]?.summary).toBe('current:block::static');
  expect(result.blocks.every((block) => !('skippedForBudget' in block))).toBe(true);
  expect(result).not.toHaveProperty('skippedForBudget');
  expect(result.diagnoses?.[0]?.summary).toBe('current:run:pass:static');
});

it('with zero budget drops old costly diagnoses, runs static steps, and records each scope skip count', async () => {
  const context = objects('old', false, true);
  const { source, prepared } = await baseline('pass', context, 1);
  expect(source.blocks.every((block) => block.diagnoses?.length === 2)).toBe(true);
  expect(source.diagnoses).toHaveLength(2);
  const callsBefore = costlyCalls;
  const result = await rejudgeRun(prepared, judge('fail'), () => 0, objects('current', false, true), {
    runs: 0,
  });
  expect(costlyCalls).toBe(callsBefore);
  expect(result.blocks.map((block) => block.diagnoses?.map((d) => d.summary))).toEqual([
    ['current:block:fail:static'],
    ['current:block::static'],
  ]);
  expect(result.blocks.map((block) => block.skippedForBudget)).toEqual([1, 1]);
  expect(result.diagnoses?.map((d) => d.summary)).toEqual(['current:run:fail:static']);
  expect(result).toHaveProperty('skippedForBudget', 1);
  expect(RunResult.parse(JSON.parse(JSON.stringify(result)))).toHaveProperty('skippedForBudget', 1);
});

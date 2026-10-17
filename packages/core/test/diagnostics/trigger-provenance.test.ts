import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import {
  type By,
  Diagnosis,
  type DiagnosticStepContext,
  ObjectStore,
  objectRegistry,
  type RunResult,
  registerDiagnosticStep,
  runCampaignDiagnostics,
  runDiagnostics,
  runRunDiagnostics,
  runSpec,
  triggers,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { context, observed } from '../../../checks/test/support/context';
import { echoAdapter, specOf } from '../runner/support';

initializeShippedObjects();
const attribution: By = {
  object: 'policy/blame:local@12345678',
  item: 'R2',
  impl: 'builtin:blame/attribute',
  layer: 'project',
};
registerDiagnosticStep('plugin:trigger-attribute', {
  params: z.strictObject({}),
  cost: 'static',
  run: () => ({ summary: 'attributed', disposition: 'agent', confidence: 'static', by: attribution }),
});
registerDiagnosticStep('plugin:trigger-note', {
  params: z.strictObject({}),
  cost: 'static',
  run: () => ({ summary: 'note' }),
});
const earlierArrays: Array<DiagnosticStepContext['earlier']> = [];
registerDiagnosticStep('plugin:trigger-state', {
  params: z.strictObject({}),
  cost: 'static',
  run: ({ earlier }) => {
    earlierArrays.push(earlier);
    return { summary: `own ${earlier.length}` };
  },
});

function diagnostic(id: string, fields: Record<string, unknown> = {}, impl = 'plugin:trigger-note') {
  const store = new ObjectStore(objectRegistry.clone());
  store.add(
    {
      kind: 'diagnostic',
      id,
      ...fields,
      steps: [
        { id: 'first', title: 'First', impl },
        ...(impl === 'plugin:trigger-state' ? [{ id: 'second', title: 'Second', impl }] : []),
      ],
    },
    'project',
    { path: `${id}.yaml` },
  );
  return store.resolve('diagnostic', id);
}
const check = () =>
  context(
    specOf({ id: 'trigger', kind: 'conversation', blocks: [{ when: { user: 'hi' } }] }),
    0,
    observed('ok'),
  );
const verdict = (gating: boolean): Verdict => ({
  id: 'tools.input.x',
  name: 'tools',
  kind: 'machine',
  outcome: 'fail',
  evidence: 'failed',
  gating,
});
const prior: Diagnosis = {
  diagnostic: 'diagnostic:source@12345678',
  step: 'attribute',
  disposition: 'agent',
  confidence: 'static',
  summary: 'source',
  by: attribution,
};
async function emptyRun(): Promise<RunResult> {
  return runSpec(check().spec, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
  });
}

describe('diagnostic provenance and triggers', () => {
  it('keeps the deciding policy by and records the execution stamp as optional via', async () => {
    const source = diagnostic('source', {}, 'plugin:trigger-attribute');
    const note = diagnostic('note');
    const { diagnoses } = await runDiagnostics([source, note], { check: check(), verdicts: [], objects: [] });
    expect(diagnoses[0]).toMatchObject({
      by: attribution,
      via: { object: source.ref, item: 'first', impl: 'plugin:trigger-attribute', layer: 'project' },
    });
    expect(Diagnosis.parse(JSON.parse(JSON.stringify(diagnoses[0])))).toEqual(diagnoses[0]);
    expect(diagnoses[1]?.by.object).toBe(note.ref);
    expect(diagnoses[1]).not.toHaveProperty('via');
    expect(Diagnosis.parse(prior)).toEqual(prior);
  });
  it.each([true, false])('filters any_verdict by gating=%s', async (gating) => {
    const object = diagnostic(`gating-${gating}`, {
      when: { any_verdict: { name: 'tools', outcome: 'fail', id_contains: '.input.', gating } },
    });
    expect(triggers(object, [verdict(gating)])).toBe(true);
    expect(triggers(object, [verdict(!gating)])).toBe(false);
  });
  it('fires on earlier diagnostics while keeping each diagnostic own earlier array stable', async () => {
    const source = diagnostic('source', {}, 'plugin:trigger-attribute');
    const next = diagnostic(
      'next',
      {
        when: {
          any_diagnosis: {
            diagnostic: ['source'],
            step: ['first'],
            disposition: ['agent', 'shared'],
            confidence: ['static', 'undecided'],
          },
        },
      },
      'plugin:trigger-state',
    );
    earlierArrays.length = 0;
    const forward = await runDiagnostics([source, next], { check: check(), verdicts: [], objects: [] });
    expect(forward.diagnoses.map((entry) => entry.summary)).toEqual(['attributed', 'own 0', 'own 1']);
    expect(earlierArrays[0]).toBe(earlierArrays[1]);
    expect(earlierArrays[0]?.map((entry) => entry.diagnostic)).toEqual([next.ref, next.ref]);
    const reversed = await runDiagnostics([next, source], { check: check(), verdicts: [], objects: [] });
    expect(reversed.diagnoses.map((entry) => entry.summary)).toEqual(['attributed']);
  });
  it.each(['source', 'diagnostic:source', prior.diagnostic])(
    'matches exact diagnostic identity %s with every filter applied',
    (identity) => {
      const fields = { diagnostic: identity, step: 'attribute', disposition: 'agent', confidence: 'static' };
      const object = diagnostic('matching', { when: { any_diagnosis: fields } });
      expect(triggers(object, [], [prior])).toBe(true);
      for (const changed of [
        { diagnostic: 'diagnostic:other@12345678' },
        { step: 'different' },
        { disposition: 'setup' as const },
        { confidence: 'confirmed' as const },
      ]) {
        expect(triggers(object, [], [{ ...prior, ...changed }])).toBe(false);
      }
      expect(triggers(object, [], [{ ...prior, diagnostic: 'diagnostic:source-extra@12345678' }])).toBe(
        false,
      );
    },
  );
  it('run scope sees block diagnoses and earlier run diagnostics', async () => {
    const run = await emptyRun();
    const block = run.blocks[0];
    if (!block) throw new Error('fixture run has no block');
    block.diagnoses = [prior];
    const first = diagnostic('run-first', {
      scope: 'run',
      when: { any_diagnosis: { diagnostic: 'source' } },
    });
    const next = diagnostic('run-next', {
      scope: 'run',
      when: { any_diagnosis: { diagnostic: 'run-first' } },
    });
    expect((await runRunDiagnostics([first, next], run)).diagnoses.map((entry) => entry.diagnostic)).toEqual([
      first.ref,
      next.ref,
    ]);
  });
  it('campaign scope sees block and run diagnoses plus earlier campaign diagnostics', async () => {
    const run = await emptyRun();
    const block = run.blocks[0];
    if (!block) throw new Error('fixture run has no block');
    block.diagnoses = [prior];
    run.diagnoses = [{ ...prior, diagnostic: 'diagnostic:run-source@abcdef12' }];
    const objects = ['source', 'run-source', 'campaign-source'].map((source, index) =>
      diagnostic(index === 0 ? 'campaign-source' : `campaign-${index}`, {
        scope: 'campaign',
        when: { any_diagnosis: { diagnostic: source } },
      }),
    );
    expect((await runCampaignDiagnostics(objects, [run])).diagnoses.map((entry) => entry.diagnostic)).toEqual(
      objects.map((object) => object.ref),
    );
    expect((await runCampaignDiagnostics(objects, [])).diagnoses).toEqual([]);
  });
  it('rejects invalid filters and numeric costs while accepting declared cost classes', () => {
    for (const when of [
      { any_verdict: { gating: 'yes' } },
      { any_diagnosis: { confidence: 'certain' } },
      { any_diagnosis: { disposition: 'nobody' } },
    ]) {
      expect(() => diagnostic('invalid', { when })).toThrow();
    }
    for (const cost of ['none', 'conditional', 'always'])
      expect(diagnostic('cost', { cost: { model_calls: cost, agent_runs: cost } }).fields.cost).toEqual({
        model_calls: cost,
        agent_runs: cost,
      });
    for (const key of ['model_calls', 'agent_runs'])
      expect(() => diagnostic('zero', { cost: { [key]: 0 } })).toThrow();
  });
});

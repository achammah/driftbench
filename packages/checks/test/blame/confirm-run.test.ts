import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import {
  type Campaign,
  clearObjectContexts,
  type Diagnosis,
  loadSpecFile,
  ObjectStore,
  objectContextFor,
  objectRegistry,
  planCampaign,
  runCampaign,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { type ConfirmServices, useBlameServices } from '../../src/blame/services';
import { defaultChecks } from '../../src/defaults';
import { initializeShippedObjects } from '../../src/initialize';

initializeShippedObjects();

/**
 * The confirm_* rules end to end. A campaign runs a spec whose value the agent built from the user's digits (R2b,
 * static). `liability-confirm` then plans the cheapest runs that could change that diagnosis, a scripted fake
 * runner plays the hint and reference runs, and the block is diagnosed again with what they stored. A run is
 * made only while the budget lasts: the diagnostic budget counts the `run` step and the project object's
 * `budget_usd` bounds the spend.
 */

const root = mkdtempSync(join(tmpdir(), 'driftbench-confirm-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const files: Record<string, string> = {
  'driftbench.yaml': 'plugins: []\n',
  // A rule that lives in a skill reference the agent never read.
  'estate/map.json': JSON.stringify({
    atoms: [
      {
        id: 'ref.rates.rule',
        kind: 'reference',
        title: 'Quote at the standard rate',
        provenance: { file: '.claude/skills/rates/reference/standard.md', startLine: 3 },
        fields: {},
      },
    ],
    edges: [],
  }),
  'specs/skill-rule.yaml': [
    'id: skill-rule',
    'uses: { diagnostics: [code-agent-liability] }',
    'metadata:',
    `  estate: { map: ${join(root, 'estate/map.json')}, atoms: [ref.rates.rule] }`,
    'blocks:',
    '  - user: Write me a quote at the standard rate.',
    '    expect:',
    '      skills: [{ name: rates }]',
    '      must: ["standard rate"]',
    '',
  ].join('\n'),
  'specs/built.yaml': [
    'id: built-from-given',
    'uses: { diagnostics: [code-agent-liability] }',
    'blocks:',
    '  - user: Port my number, 202 555 0150.',
    '    expect:',
    '      tools:',
    '        - { label: port.start, input: { number: "+12025550150" } }',
    '',
  ].join('\n'),
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const agent = functionAdapter({
  respond: () => ({
    runtime: { skills: [{ name: 'rates' }] },
    segments: [{ type: 'text', text: 'Porting.' }],
    text: 'Porting.',
    toolCalls: [{ label: 'port.start', input: { number: '+1 (202) 555-0150' }, output: { ok: true } }],
    cost: {},
    latencyMs: 0,
  }),
});

/** The confirm diagnostic with a project budget: `budget_usd` on its run step. */
function confirmDiagnostic(budgetUsd: number) {
  const store = new ObjectStore(objectRegistry.clone());
  store.add(
    {
      kind: 'diagnostic',
      id: `confirm-${budgetUsd}`,
      extends: 'liability-confirm',
      steps: [{ id: 'run', params: { runs: 3, budget_usd: budgetUsd, reference_target: null } }],
    },
    'project',
    { path: 'confirm.yaml' },
  );
  return store.resolve('diagnostic', `confirm-${budgetUsd}`);
}

async function campaign(diagnosticBudget: { runs?: number }, budgetUsd: number, file = 'specs/built.yaml') {
  clearObjectContexts();
  const path = join(root, file);
  const loaded = await loadSpecFile(path);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const plan = planCampaign([loaded], [{ adapter: 'function', agent: 'x' }], ['F'], 1);
  const store = openMemoryStore();
  await store.putCampaign({
    campaignId: 'c-confirm',
    specs: [{ id: loaded.spec.id, hash: loaded.hash }],
    targets: [{ adapter: 'function', agent: 'x' }],
    modes: ['F'],
    repeats: { T: 0, F: 1, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: '2026-10-17T00:00:00.000Z',
  } satisfies Campaign);
  const heard: Diagnosis[] = [];
  await runCampaign({
    campaignId: 'c-confirm',
    cells: plan.cells,
    specFor: () => loaded.spec as Spec,
    adapterFor: () => agent,
    driver: () => createScriptedDriver(),
    checks: defaultChecks(),
    store,
    diagnostics: [confirmDiagnostic(budgetUsd)],
    diagnosticBudget,
    objects: objectContextFor(path),
    onDiagnoses: (written) => {
      heard.push(...written);
    },
  } as Parameters<typeof runCampaign>[0]);
  await store.close();
  return heard;
}

type Run = Parameters<ConfirmServices['runner']>[0];
const scripted = (passes: { hint: number; reference: number }, calls: Run[] = []) => ({
  runner: (run: Run) => {
    calls.push(run);
    return { passes: run.kind === 'hint' ? passes.hint : passes.reference, costUsd: 0.1 };
  },
  quote: () => 0.1,
});

describe('liability-confirm', () => {
  let restore = () => {};
  afterEach(() => restore());
  const rejudged = (heard: Diagnosis[]) => heard.filter((one) => one.step === 'rejudge');

  it('without a confirm service nothing runs and the diagnosis stays static', async () => {
    const heard = await campaign({ runs: 1 }, 1);
    expect(rejudged(heard)[0]).toMatchObject({ confidence: 'static', flags: ['static'] });
  });

  it('confirm_missing_rule: the hint passes, a reference without it does not, at budget 1', async () => {
    const calls: Run[] = [];
    restore = useBlameServices({ confirm: scripted({ hint: 3, reference: 0 }, calls) });
    const heard = await campaign({ runs: 1 }, 1);
    expect(calls.map((one) => one.kind).sort()).toEqual(['hint', 'reference']);
    const [after] = rejudged(heard);
    expect(after?.rule).toContain('#confirm_missing_rule');
    expect(after).toMatchObject({ disposition: 'setup', confidence: 'confirmed' });
    expect(after?.flags).toContain('changed_from:R2b:agent');
  });

  it('confirm_model: the hint does not help and a reference agent passes', async () => {
    restore = useBlameServices({ confirm: scripted({ hint: 0, reference: 3 }) });
    const [after] = rejudged(await campaign({ runs: 1 }, 1));
    expect(after?.rule).toContain('#confirm_model');
    expect(after).toMatchObject({
      disposition: 'agent',
      fixLocation: 'agent.model',
      confidence: 'confirmed',
    });
  });

  it('test_reference_fails: nobody passes, the test is excluded', async () => {
    restore = useBlameServices({ confirm: scripted({ hint: 0, reference: 0 }) });
    const [after] = rejudged(await campaign({ runs: 1 }, 1));
    expect(after?.rule).toContain('#test_reference_fails');
    expect(after).toMatchObject({ disposition: 'excluded', confidence: 'confirmed' });
  });

  it('the diagnostic budget is the cap: at runs 0 the run step is skipped and the diagnosis stays static', async () => {
    const calls: Run[] = [];
    restore = useBlameServices({ confirm: scripted({ hint: 3, reference: 0 }, calls) });
    const heard = await campaign({ runs: 0 }, 1);
    expect(calls).toEqual([]);
    expect(rejudged(heard)[0]).toMatchObject({ confidence: 'static' });
  });

  it('the project budget_usd is the cap: a quote above it makes no run', async () => {
    const calls: Run[] = [];
    restore = useBlameServices({ confirm: scripted({ hint: 3, reference: 0 }, calls) });
    const heard = await campaign({ runs: 1 }, 0.05);
    expect(calls).toEqual([]);
    expect(rejudged(heard)[0]).toMatchObject({ confidence: 'static' });
  });

  it('confirm_forced_load_fails: the skill was forced into context and the block still fails', async () => {
    const calls: Run[] = [];
    restore = useBlameServices({
      confirm: {
        runner: (run) => {
          calls.push(run);
          return { passes: run.kind === 'forced_load' ? 0 : 3, costUsd: 0.1 };
        },
        quote: () => 0.1,
      },
    });
    const heard = await campaign({ runs: 1 }, 1, 'specs/skill-rule.yaml');
    expect(calls.map((one) => one.kind)).toEqual(expect.arrayContaining(['forced_load', 'hint']));
    const [after] = rejudged(heard);
    expect(after?.rule).toContain('#confirm_forced_load_fails');
    expect(after).toMatchObject({ disposition: 'setup', fault: ['skill'], confidence: 'confirmed' });
  });
});

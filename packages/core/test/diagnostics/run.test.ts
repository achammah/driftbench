// Unit F5: diagnostics run after the checks, fire on their trigger, write diagnoses and never change `pass`.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  clearObjectContexts,
  type Diagnosis,
  loadSpecFile,
  type ObjectContext,
  ObjectStore,
  objectContextFor,
  objectRegistry,
  planCampaign,
  type RunResult,
  registerDiagnosticStep,
  runCampaign,
  runCampaignDiagnostics,
  runRunDiagnostics,
  runSpec,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { acmeAdapter, loadAcmeConversations, putCampaign } from '../runner/support';

const driver = createScriptedDriver();

registerDiagnosticStep('plugin:test-explain', {
  params: z.strictObject({ prefix: z.string().optional() }),
  cost: 'static',
  run: ({ verdicts, params }) =>
    verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map((verdict) => ({
        verdictRef: verdict.id,
        summary: `${params.prefix ?? 'explains'} ${verdict.id}`,
      })),
});
registerDiagnosticStep('plugin:test-note', {
  params: z.strictObject({}),
  cost: 'static',
  run: () => ({ summary: 'noted' }),
});
registerDiagnosticStep('plugin:test-rerun', {
  params: z.strictObject({}),
  cost: 'run',
  run: () => ({ summary: 'ran the agent again' }),
});
registerDiagnosticStep('plugin:test-throws', {
  params: z.strictObject({}),
  cost: 'static',
  run: () => {
    throw new Error('step broke');
  },
});

function tempProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-diagnostics-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const OBJECTS: Record<string, string> = {
  'driftbench.yaml': 'plugins: []\n',
  'driftbench/diagnostic/explain-fails.yaml': [
    'kind: diagnostic',
    'id: explain-fails',
    'scope: block',
    'when: { any_verdict: { outcome: fail } }',
    'reads: [check-set]',
    'steps:',
    '  - { id: explain, title: Name each failing gating verdict, impl: "plugin:test-explain" }',
    '',
  ].join('\n'),
  'driftbench/diagnostic/note-on-fail.yaml':
    'kind: diagnostic\nid: note-on-fail\nwhen: { any_verdict: { name: must, outcome: fail } }\nsteps:\n  - { id: note, title: Note, impl: "plugin:test-note" }\n',
  'driftbench/diagnostic/note-always.yaml':
    'kind: diagnostic\nid: note-always\nwhen: { always: true }\nsteps:\n  - { id: note, title: Note, impl: "plugin:test-note" }\n',
  'driftbench/diagnostic/rerun.yaml': [
    'kind: diagnostic',
    'id: rerun',
    'when: { always: true }',
    'steps:',
    '  - { id: look, title: Read the record, impl: "plugin:test-explain", params: { prefix: looked } }',
    '  - { id: rerun, title: Run the agent again, impl: "plugin:test-rerun" }',
    '  - { id: broken, title: A step that throws, impl: "plugin:test-throws" }',
    '',
  ].join('\n'),
};

/** Block 0 passes (the agent says "plan"), block 1 fails (it never says the phrase). */
function spec(diagnostics: string): string {
  return [
    'id: diagnosed',
    `uses: { diagnostics: ${diagnostics} }`,
    'blocks:',
    '  - user: Hi, I am already an Acme customer and I want more data.',
    "    expect: { must: ['plan'] }",
    '  - user: And what about roaming?',
    "    expect: { must: ['a phrase the agent never says'] }",
    '',
  ].join('\n');
}

async function run(root: string, file: string, budget?: number): Promise<RunResult> {
  clearObjectContexts();
  const path = join(root, file);
  const loaded = await loadSpecFile(path);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return runSpec(loaded.spec, {
    adapter: acmeAdapter(),
    driver,
    checks: defaultChecks(),
    mode: 'T',
    repeat: 0,
    objects: objectContextFor(path),
    ...(budget === undefined ? {} : { diagnosticBudget: { runs: budget } }),
  });
}

describe('a diagnostic', () => {
  const root = tempProject({
    ...OBJECTS,
    'specs/with.yaml': spec('[explain-fails]'),
    'specs/noted.yaml': spec('[note-on-fail, note-always]'),
    'specs/without.yaml': spec('[]'),
    'specs/rerun.yaml': spec('[rerun]'),
  });

  it('fires on its trigger and not otherwise', async () => {
    const result = await run(root, 'specs/with.yaml');
    expect(result.blocks[0]?.pass).toBe(true);
    expect(result.blocks[0]?.diagnoses).toBeUndefined();
    expect(result.blocks[1]?.pass).toBe(false);
    expect(result.blocks[1]?.diagnoses).toEqual([
      {
        diagnostic: expect.stringMatching(/^diagnostic:explain-fails@[0-9a-f]{8}$/),
        step: 'explain',
        verdictRef: 'must.0',
        summary: 'explains must.0',
        by: {
          object: expect.stringMatching(/^diagnostic:explain-fails@/),
          item: 'explain',
          impl: 'plugin:test-explain',
          layer: 'project',
        },
      },
    ]);
    expect(result.blocks[1]?.resolved?.objects.map((entry) => [entry.key, entry.id])).toEqual([
      ['value_check', 'default'],
      ['check_set', 'default'],
      ['diagnostics', 'explain-fails'],
    ]);
  });

  it('fires a trigger on the verdict it names only: a step that always writes stays silent elsewhere', async () => {
    const result = await run(root, 'specs/noted.yaml');
    expect(
      result.blocks.map((block) => block.diagnoses?.map((diagnosis) => diagnosis.diagnostic.split('@')[0])),
    ).toEqual([['diagnostic:note-always'], ['diagnostic:note-on-fail', 'diagnostic:note-always']]);
  });

  it('writes a diagnosis and leaves every verdict and pass byte for byte as without it', async () => {
    const withIt = await run(root, 'specs/noted.yaml');
    const without = await run(root, 'specs/without.yaml');
    const scored = (result: RunResult) =>
      JSON.stringify(
        result.blocks.map((block) => ({ verdicts: block.verdicts, pass: block.pass, drift: block.drift })),
      );
    expect(withIt.blocks.some((block) => block.diagnoses?.length)).toBe(true);
    expect(without.blocks.some((block) => block.diagnoses)).toBe(false);
    expect(scored(withIt)).toBe(scored(without));
    expect(withIt.succession).toEqual(without.succession);
  });

  it('skips a run step at budget 0 and counts it; runs it within the budget; a throwing step says so', async () => {
    const free = await run(root, 'specs/rerun.yaml');
    for (const block of free.blocks) {
      expect(block.skippedForBudget).toBe(1);
      expect(block.diagnoses?.map((diagnosis) => diagnosis.step)).toEqual(
        block.pass ? ['broken'] : ['look', 'broken'],
      );
      expect(block.diagnoses?.at(-1)?.summary).toBe('the step threw Error: step broke');
    }
    const paid = await run(root, 'specs/rerun.yaml', 1);
    for (const block of paid.blocks) {
      expect(block.skippedForBudget).toBeUndefined();
      expect(block.diagnoses?.map((diagnosis) => diagnosis.step)).toContain('rerun');
    }
  });
});

describe('a diagnostic is refused at load', () => {
  it('when a step names an implementation nobody registered, or one that is not a diagnostic step', async () => {
    const root = tempProject({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/diagnostic/absent.yaml':
        'kind: diagnostic\nid: absent\nsteps:\n  - { id: s, title: S, impl: "plugin:never-registered" }\n',
      'driftbench/diagnostic/borrowed.yaml':
        'kind: diagnostic\nid: borrowed\nsteps:\n  - { id: s, title: S, impl: "builtin:check/tools" }\n',
      'driftbench/diagnostic/reads.yaml':
        'kind: diagnostic\nid: reads\nreads: [policy/nothing]\nsteps:\n  - { id: s, title: S, impl: "plugin:test-explain" }\n',
      'specs/absent.yaml': spec('[absent]'),
      'specs/borrowed.yaml': spec('[borrowed]'),
      'specs/reads.yaml': spec('[reads]'),
    });
    const errors = async (file: string) => {
      clearObjectContexts();
      const loaded = await loadSpecFile(join(root, file));
      return loaded.ok ? [] : loaded.errors.map((issue) => [issue.code, issue.message]);
    };
    expect(await errors('specs/absent.yaml')).toEqual([
      [
        'OBJECT_IMPL_UNKNOWN',
        expect.stringContaining('names plugin:never-registered, which no builtin or plugin provides'),
      ],
    ]);
    expect(await errors('specs/borrowed.yaml')).toEqual([
      [
        'OBJECT_IMPL_UNKNOWN',
        expect.stringContaining('names builtin:check/tools, which is no diagnostic implementation'),
      ],
    ]);
    expect(await errors('specs/reads.yaml')).toEqual([
      ['OBJECT_INVALID', expect.stringContaining('reads names unknown kinds policy/nothing')],
    ]);
  });

  it('refuses a step registered twice', () => {
    expect(() =>
      registerDiagnosticStep('plugin:test-explain', {
        params: z.strictObject({}),
        cost: 'static',
        run: () => undefined,
      }),
    ).toThrow('the diagnostic step plugin:test-explain is already registered');
  });
});

describe('shipped diagnostics', () => {
  it('run by default when marked default: true, and diagnostics: [] runs none', async () => {
    const registry = objectRegistry.clone();
    registry.registerShipped(
      {
        kind: 'diagnostic',
        id: 'always-explain',
        default: true,
        steps: [{ id: 'explain', title: 'Explain', impl: 'plugin:test-explain' }],
      },
      'test',
    );
    const context: ObjectContext = { store: new ObjectStore(registry), uses: [], problems: [] };
    const base = {
      id: 'shipped-diagnostic',
      kind: 'conversation',
      blocks: [
        { when: { user: 'And what about roaming?' }, expect: { must: ['a phrase the agent never says'] } },
      ],
    } as Spec;
    const ran = await runSpec(base, {
      adapter: acmeAdapter(),
      driver,
      checks: defaultChecks(),
      mode: 'T',
      repeat: 0,
      objects: context,
    });
    expect(ran.blocks[0]?.diagnoses?.map((diagnosis) => [diagnosis.step, diagnosis.by.layer])).toEqual([
      ['explain', 'shipped'],
    ]);
    const none = await runSpec(
      { ...base, uses: { diagnostics: [] } },
      { adapter: acmeAdapter(), driver, checks: defaultChecks(), mode: 'T', repeat: 0, objects: context },
    );
    expect(none.blocks[0]?.diagnoses).toBeUndefined();
  });
});

registerDiagnosticStep('plugin:test-count', {
  params: z.strictObject({}),
  cost: 'static',
  run: ({ scope, run, runs, verdicts }) => ({
    summary: `${scope}: ${runs?.length ?? (run ? 1 : 0)} runs, ${verdicts.length} verdicts`,
    score: verdicts.length,
  }),
});

describe('run and campaign scope', () => {
  const objects = (scope: string) => ({
    kind: 'diagnostic',
    id: `count-${scope}`,
    scope,
    when: { always: true },
    cost: { model_calls: 'none', agent_runs: 'none' },
    steps: [{ id: 'count', title: 'Count', impl: 'plugin:test-count' }],
  });

  it('declares scope, when, reads, output and cost, and refuses an unknown scope or cost', () => {
    const registry = objectRegistry.clone();
    registry.registerShipped(
      { ...objects('run'), reads: ['check-set'], output: { fields: ['score'] } },
      'test',
    );
    expect(new ObjectStore(registry).resolve('diagnostic', 'count-run').fields).toMatchObject({
      scope: 'run',
      cost: { model_calls: 'none', agent_runs: 'none' },
      output: { fields: ['score'] },
    });
    expect(() =>
      new ObjectStore(objectRegistry.clone()).add(objects('suite'), 'project', { path: 'x.yaml' }),
    ).toThrow(/scope/);
    expect(() =>
      new ObjectStore(objectRegistry.clone()).add({ ...objects('run'), cost: { dollars: 1 } }, 'project', {
        path: 'y.yaml',
      }),
    ).toThrow(/dollars/);
  });

  it('runs a run-scope diagnostic once over the whole run, never on a block', async () => {
    const registry = objectRegistry.clone();
    registry.registerShipped(objects('run'), 'test');
    const context: ObjectContext = { store: new ObjectStore(registry), uses: [], problems: [] };
    const spec = {
      id: 'run-scope',
      kind: 'conversation',
      uses: { diagnostics: ['count-run'] },
      blocks: [{ when: { user: 'Hi' }, expect: { must: ['plan'] } }, { when: { user: 'And roaming?' } }],
    } as Spec;
    const run = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: defaultChecks(),
      mode: 'T',
      repeat: 0,
      objects: context,
    });
    const verdicts = run.blocks.flatMap((block) => block.verdicts).length;
    expect(run.diagnoses).toEqual([
      expect.objectContaining({
        step: 'count',
        summary: `run: 1 runs, ${verdicts} verdicts`,
        score: verdicts,
      }),
    ]);
    expect(run.blocks.every((block) => block.diagnoses === undefined)).toBe(true);
  });

  it('runs a campaign-scope diagnostic once over every run of a campaign, after the last cell', async () => {
    const registry = objectRegistry.clone();
    registry.registerShipped(objects('campaign'), 'test');
    const diagnostic = new ObjectStore(registry).resolve('diagnostic', 'count-campaign');
    const conversations = await loadAcmeConversations();
    const plan = planCampaign(conversations.slice(0, 2), [{ adapter: 'function', agent: 'acme' }], ['T'], 1);
    const store = openMemoryStore();
    await putCampaign(store, 'c-diagnosed', conversations.slice(0, 2));
    const heard: Diagnosis[] = [];
    const outcomes = await runCampaign({
      campaignId: 'c-diagnosed',
      cells: plan.cells,
      specFor: (cell) => conversations.find((entry) => entry.spec.id === cell.specId)?.spec as Spec,
      adapterFor: () => acmeAdapter(),
      driver: () => createScriptedDriver(),
      checks: defaultChecks(),
      store,
      diagnostics: [diagnostic],
      onDiagnoses: (written) => {
        heard.push(...written);
      },
    });
    const verdicts = outcomes.flatMap(
      (outcome) => outcome.run?.blocks.flatMap((block) => block.verdicts) ?? [],
    ).length;
    expect(heard).toEqual([
      expect.objectContaining({ summary: `campaign: 2 runs, ${verdicts} verdicts`, score: verdicts }),
    ]);
    // A diagnostic of another scope never runs at this one.
    const { diagnoses } = await runCampaignDiagnostics(
      [new ObjectStore(registry).resolve('diagnostic', 'count-campaign')],
      [],
    );
    expect(diagnoses).toHaveLength(1);
    expect((await runRunDiagnostics([diagnostic], outcomes[0]?.run as RunResult)).diagnoses).toEqual([]);
    await store.close();
  });
});

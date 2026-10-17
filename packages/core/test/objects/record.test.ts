// Unit F2: every verdict names the object, item, impl and layer that produced it; every block records the
// objects it resolved to; records written before these fields still parse.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CHECK_SET,
  defaultChecks,
  initializeShippedObjects,
  SHIPPED_CHECKS,
} from '@agent-nexus/driftbench-checks';
import {
  BlockResult,
  clearObjectContexts,
  Diagnosis,
  loadSpecFile,
  objectContextFor,
  RunResult,
  runSpec,
  type Spec,
  scoringPlan,
  shippedObjectContext,
  Verdict,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { beforeEach, describe, expect, it } from 'vitest';
import { acmeAdapter, loadAcmeConversations } from '../runner/support';

const HERE = dirname(fileURLToPath(import.meta.url));
const driver = createScriptedDriver();
beforeEach(() => initializeShippedObjects());

function tempProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-record-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const SPEC = [
  'id: stamped',
  'uses: { check_set: acme }',
  'blocks:',
  '  - user: Hi, I am already an Acme customer and I want more data.',
  "    expect: { must: ['plan'], tools: [{ label: catalog.search }] }",
  '',
].join('\n');

describe('old records', () => {
  it('parse unchanged: run records main wrote, before by, resolved and diagnoses', () => {
    const { records } = JSON.parse(
      readFileSync(join(HERE, '..', 'fixtures', 'framework', 'old-records.json'), 'utf8'),
    ) as { records: unknown[] };
    expect(records.length).toBe(12);
    let verdicts = 0;
    for (const raw of records) {
      const parsed = RunResult.parse(raw);
      expect(parsed).toEqual(raw);
      for (const block of parsed.blocks) {
        expect(block.resolved).toBeUndefined();
        expect(block.diagnoses).toBeUndefined();
        for (const verdict of block.verdicts) {
          expect(verdict.by).toBeUndefined();
          verdicts += 1;
        }
      }
    }
    expect(verdicts).toBe(978);
  });

  it('refuses a by without its object, impl or layer', () => {
    const base = {
      id: 'must.0',
      kind: 'machine',
      name: 'must',
      gating: true,
      outcome: 'pass',
      evidence: 'ok',
    };
    expect(
      Verdict.safeParse({ ...base, by: { item: 'must', impl: 'builtin:check/must', layer: 'shipped' } })
        .success,
    ).toBe(false);
    expect(
      Verdict.safeParse({ ...base, by: { object: 'check-set:default@1', impl: 'x', layer: 'nowhere' } })
        .success,
    ).toBe(false);
    expect(
      Verdict.safeParse({ ...base, by: { object: 'check-set:default@1', impl: 'x', layer: 'shipped' } })
        .success,
    ).toBe(true);
    expect(BlockResult.shape.resolved.safeParse({ objects: [], hash: '' }).success).toBe(false);
  });
});

describe('a diagnosis', () => {
  const base = {
    diagnostic: 'diagnostic:code-agent-liability@12345678',
    summary: 'the skill states the format; the agent did not read it',
    by: {
      object: 'diagnostic:code-agent-liability@12345678',
      item: 'attribute',
      impl: 'builtin:blame/attribute',
      layer: 'shipped',
    },
  };

  it('holds the blame fields, each optional and without a default', () => {
    const full = {
      ...base,
      inherits: 'tools.order',
      disposition: 'agent',
      fixTarget: 'skill.content',
      fixAction: 'state the format in the skill',
      fixForms: ['skill.content', 'tool.contract'],
      placement: 'policy/placement:default@abcdef12#P3',
      confidence: 'static',
      removeCopies: ['skills/a/SKILL.md', 'skills/b/SKILL.md'],
    };
    expect(Diagnosis.parse(full)).toEqual(full);
    expect(Diagnosis.parse(base)).toEqual(base);
  });

  it('refuses an unknown disposition or confidence, and an unknown key', () => {
    expect(Diagnosis.safeParse({ ...base, disposition: 'nobody' }).success).toBe(false);
    expect(Diagnosis.safeParse({ ...base, confidence: 'sure' }).success).toBe(false);
    expect(Diagnosis.safeParse({ ...base, fix_target: 'x' }).success).toBe(false);
  });
});

describe('the shipped check set', () => {
  it('lists every check defaultChecks applies, in its order, then the runner verdicts', () => {
    const all = defaultChecks({
      judges: { check: () => ({ name: 'judge', applies: () => false, evaluate: () => [] }) },
      toolPolicy: [{ tool: 'x', decision: 'deny' }] as never,
    }).map((check) => check.name);
    expect([...SHIPPED_CHECKS]).toEqual(all);
    expect(DEFAULT_CHECK_SET.items.map((item) => item.id)).toEqual([...all, 'flow', 'ledger']);
    const resolved = shippedObjectContext().store.resolve('check-set', 'default');
    expect(resolved.layer).toBe('shipped');
    expect(resolved.items.every((item) => item.enabled)).toBe(true);
  });
});

describe('every verdict carries by', () => {
  it('on every block of every Acme conversation, in modes T and F', async () => {
    let verdicts = 0;
    const kinds = new Set<string>();
    for (const { spec } of await loadAcmeConversations()) {
      for (const mode of ['T', 'F'] as const) {
        const run = await runSpec(spec, {
          adapter: acmeAdapter(),
          driver,
          checks: defaultChecks(),
          mode,
          repeat: 0,
        });
        expect(run.status).toBe('completed');
        for (const block of run.blocks) {
          expect(
            block.resolved?.objects.map((entry) => [entry.key, entry.kind, entry.id, entry.setAt]),
          ).toEqual([
            ['value_check', 'policy/value-check', 'default', 'shipped'],
            ['check_set', 'check-set', 'default', 'shipped'],
          ]);
          for (const verdict of block.verdicts) {
            verdicts += 1;
            expect(verdict.by, verdict.id).toMatchObject({
              object: expect.stringMatching(/^check-set:default@[0-9a-f]{8}$/),
              layer: 'shipped',
            });
            kinds.add(verdict.by?.item ?? '');
            // The item that stamps a check's verdict is the check itself; the runner's own are flow and ledger.
            if (verdict.by?.impl.startsWith('builtin:check/'))
              expect(verdict.by.impl).toBe(`builtin:check/${verdict.by.item}`);
          }
        }
      }
    }
    expect(verdicts).toBe(978);
    // Twelve families: eleven checks and the runner's ledger verdicts.
    expect([...kinds].sort()).toEqual([
      'budget',
      'cards',
      'end_state',
      'forbidden',
      'guards',
      'lang',
      'ledger',
      'must',
      'must_not',
      'pii',
      'stage',
      'tools',
    ]);
  });

  it('stamps a check the caller adds and no item names from (caller), at the cli layer', async () => {
    const spec = (await loadAcmeConversations())[0]?.spec as Spec;
    const extra = {
      name: 'house_rule',
      applies: () => true,
      evaluate: () => [
        {
          id: 'house_rule.ok',
          kind: 'machine' as const,
          name: 'house_rule',
          gating: false,
          outcome: 'pass' as const,
          evidence: 'ok',
        },
      ],
    };
    const run = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: [...defaultChecks(), extra],
      mode: 'T',
      repeat: 0,
    });
    const stamped = run.blocks
      .flatMap((block) => block.verdicts)
      .filter((verdict) => verdict.name === 'house_rule');
    expect(stamped.length).toBe(run.blocks.length);
    for (const verdict of stamped) {
      expect(verdict.by).toMatchObject({
        object: expect.stringMatching(/^check-set:\(caller\)@/),
        item: 'house_rule',
        impl: 'caller:house_rule',
        layer: 'cli',
      });
    }
  });
});

describe('the check set chooses the checks', () => {
  it('drops the verdicts of a disabled item and stamps the item that changed at its layer', async () => {
    const root = tempProject({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/check-set/acme.yaml':
        'kind: check-set\nid: acme\nextends: default\nitems:\n  - { id: must, enabled: false }\n  - { id: ledger, enabled: false }\n',
      'specs/stamped.yaml': SPEC,
    });
    const path = join(root, 'specs/stamped.yaml');
    const loaded = await loadSpecFile(path);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const run = await runSpec(loaded.spec, {
      adapter: acmeAdapter(),
      driver,
      checks: defaultChecks(),
      mode: 'T',
      repeat: 0,
      objects: objectContextFor(path),
    });
    const verdicts = run.blocks.flatMap((block) => block.verdicts);
    expect(verdicts.some((verdict) => verdict.name === 'must')).toBe(false);
    expect(verdicts.some((verdict) => verdict.name === 'ledger')).toBe(false);
    expect(verdicts.find((verdict) => verdict.name === 'tools')?.by).toMatchObject({
      object: expect.stringMatching(/^check-set:acme@/),
      item: 'tools',
      layer: 'shipped',
    });
    expect(run.blocks[0]?.resolved?.objects).toEqual([
      {
        key: 'value_check',
        kind: 'policy/value-check',
        id: 'default',
        hash: expect.any(String),
        setAt: 'shipped',
      },
      { key: 'check_set', kind: 'check-set', id: 'acme', hash: expect.any(String), setAt: 'spec' },
    ]);
  });

  it('stamps the runner flow and ledger verdicts from their items, and drops them when disabled', () => {
    const root = tempProject({
      'quiet.yaml':
        'kind: check-set\nid: quiet\nextends: default\nitems:\n  - { id: flow, enabled: false }\n',
    });
    const store = shippedObjectContext().store;
    store.addFile(join(root, 'quiet.yaml'), 'project');
    const shipped = scoringPlan(defaultChecks(), store.resolve('check-set', 'default'));
    expect(shipped.runner.flow).toMatchObject({
      item: 'flow',
      impl: 'builtin:runner/flow',
      layer: 'shipped',
    });
    expect(shipped.runner.ledger).toMatchObject({
      item: 'ledger',
      impl: 'builtin:runner/ledger',
      layer: 'shipped',
    });
    const quiet = scoringPlan(defaultChecks(), store.resolve('check-set', 'quiet'));
    expect(quiet.runner.flow).toBeUndefined();
    expect(quiet.runner.ledger?.object).toMatch(/^check-set:quiet@/);
    expect(quiet.steps.map((step) => step.check.name)).toEqual(shipped.steps.map((step) => step.check.name));
  });

  it('fails before any call reaches the adapter when a reference cannot resolve', async () => {
    const adapter = acmeAdapter();
    const spec = {
      id: 'x',
      kind: 'conversation',
      uses: { check_set: 'nobody' },
      blocks: [{ when: { user: 'hi' } }],
    } as Spec;
    await expect(
      runSpec(spec, { adapter, driver, checks: defaultChecks(), mode: 'T', repeat: 0 }),
    ).rejects.toThrow(/OBJECT_UNKNOWN: spec x: uses\.check_set: unknown object check-set:nobody/);
    expect(adapter.calls.open + adapter.calls.send).toBe(0);
  });
});

describe('resolved', () => {
  it('keeps its hash across two runs with the same files; a changed project file changes it and no spec hash', async () => {
    const root = tempProject({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/check-set/acme.yaml':
        'kind: check-set\nid: acme\nextends: default\nitems:\n  - { id: bleu, enabled: false }\n',
      'specs/stamped.yaml': SPEC,
    });
    const path = join(root, 'specs/stamped.yaml');
    const runOnce = async () => {
      clearObjectContexts();
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
      const run = await runSpec(loaded.spec, {
        adapter: acmeAdapter(),
        driver,
        checks: defaultChecks(),
        mode: 'T',
        repeat: 0,
        objects: objectContextFor(path),
      });
      return {
        specHash: run.specHash,
        resolved: run.blocks[0]?.resolved?.hash,
        cacheKey: run.blocks[0]?.cacheKey,
      };
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(second).toEqual(first);
    writeFileSync(
      join(root, 'driftbench/check-set/acme.yaml'),
      'kind: check-set\nid: acme\nextends: default\nitems:\n  - { id: rouge_l, enabled: false }\n',
    );
    const changed = await runOnce();
    expect(changed.resolved).not.toBe(first.resolved);
    expect(changed.specHash).toBe(first.specHash);
    expect(changed.cacheKey).toBe(first.cacheKey);
  });
});

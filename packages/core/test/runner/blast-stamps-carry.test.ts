// Blast radius of unit F2 on block reuse: a block carried into a run keeps the verdicts and the `resolved`
// record of the run it came from. When a project object the spec uses changes between the two runs, the spec
// hash and the cache keys stay (scoring-only), so the carry is allowed; the rerun blocks are scored under the
// new objects and the carried ones under the old, inside one run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createToolsCheck, initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterEach, expect, it } from 'vitest';
import { acmeReplayer } from '../../../checks/test/support/acme-replayer';
import { clearObjectContexts, objectContextFor } from '../../src/objects/layers';
import { rescoreCarriedRun } from '../../src/runner/carried-scoring';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { loadSpecFile } from '../../src/spec/load';
import { echoAdapter, minimalChecks } from './support';

// Explicit initialization registers the check-set that the project object extends.
initializeShippedObjects();
const made: string[] = [];
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SPEC = [
  'id: blast-carry',
  'metadata: { depends: {} }',
  'uses: { check_set: house }',
  'blocks:',
  "  - { when: { user: one }, expect: { stage: one, must: ['ok'] } }",
  "  - { when: { user: two }, expect: { stage: two, must: ['ok'] } }",
  "  - { when: { user: three }, expect: { stage: three, must: ['ok'] } }",
  '',
].join('\n');
const HOUSE = (disabled: string) =>
  `kind: check-set\nid: house\nextends: default\nitems:\n  - { id: ${disabled}, enabled: false }\n`;

function project(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-blast-carry-'));
  made.push(root);
  const files: Record<string, string> = {
    'driftbench.yaml': 'plugins: []\n',
    'driftbench/check-set/house.yaml': HOUSE('bleu'),
    'specs/carry.yaml': SPEC,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, path: join(root, 'specs/carry.yaml') };
}

const target = { adapter: 'echo', variant: 'v1' };
const common = {
  driver: createScriptedDriver(),
  checks: minimalChecks.filter((check) => check.name !== 'stage'),
  repeat: 0,
  recordProvenance: true,
  now: () => new Date('2026-10-13T00:00:00Z'),
  mode: 'T' as const,
};

it('scores every block of one run under the objects that run resolved, carried blocks included', async () => {
  const { root, path } = project();
  clearObjectContexts();
  const before = await loadSpecFile(path);
  if (!before.ok) throw new Error(JSON.stringify(before.errors));
  const source = await runSpec(before.spec, {
    ...common,
    target,
    adapter: echoAdapter(),
    objects: objectContextFor(path),
  });
  expect(source.blocks.every((block) => block.verdicts.some((verdict) => verdict.name === 'must'))).toBe(
    true,
  );

  // The project object now disables must: a scoring-only change, so the spec hash stays and the carry holds.
  writeFileSync(join(root, 'driftbench/check-set/house.yaml'), HOUSE('must'));
  clearObjectContexts();
  const after = await loadSpecFile(path);
  if (!after.ok) throw new Error(JSON.stringify(after.errors));
  const run = await runSpec(after.spec, {
    ...common,
    target: { ...target, variant: 'v2' },
    adapter: echoAdapter(),
    objects: objectContextFor(path),
    blocks: new Set([1]),
    blockReuse: {
      source,
      fromCampaign: 'base',
      baselineProvenance: {
        version: 2,
        adapters: [
          {
            ...adapterProvenance(echoAdapter()),
            targetHash: provenanceHash(target),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
      manifest: { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'two' }] },
    },
  });
  expect(run.specHash).toBe(source.specHash);
  expect(run.blocks[2]?.carried).toBeDefined();
  // What one run reports was scored by one set of objects: a carried block scored under other objects is
  // re-scored, or the carry is refused.
  const hashes = new Set(run.blocks.map((block) => block.resolved?.hash));
  expect(hashes.size).toBe(1);
  expect(run.blocks.some((block) => block.verdicts.some((verdict) => verdict.name === 'must'))).toBe(false);
});

it.each(['T', 'F'] as const)('re-scores a whole %s carry without using the adapter again', async (mode) => {
  const { root, path } = project();
  const before = await loadSpecFile(path);
  if (!before.ok) throw new Error(JSON.stringify(before.errors));
  const adapter = echoAdapter();
  const source = await runSpec(before.spec, { ...common, mode, target, adapter });
  const opens = adapter.opened.length;
  writeFileSync(join(root, 'driftbench/check-set/house.yaml'), HOUSE('must'));
  const after = await loadSpecFile(path);
  if (!after.ok) throw new Error(JSON.stringify(after.errors));
  const rescored = await rescoreCarriedRun(after.spec, source, { checks: common.checks });
  expect(adapter.opened.length).toBe(opens);
  expect(rescored.blocks.some((block) => block.verdicts.some((verdict) => verdict.name === 'must'))).toBe(
    false,
  );
  expect(new Set(rescored.blocks.map((block) => block.resolved?.hash)).size).toBe(1);
  expect(rescored.blocks.map((block) => block.observed)).toEqual(
    source.blocks.map((block) => block.observed),
  );
  expect(rescored.blocks.map((block) => block.provenance)).toEqual(
    source.blocks.map((block) => block.provenance),
  );
  expect(rescored.cost).toBe(0);
});

it('keeps per-block overrides while freezing all object plans before scoring starts', async () => {
  const { root, path } = project();
  writeFileSync(
    path,
    SPEC.replace(
      "  - { when: { user: two }, expect: { stage: two, must: ['ok'] } }",
      "  - { uses: { check_set: default }, when: { user: two }, expect: { stage: two, must: ['ok'] } }",
    ),
  );
  const before = await loadSpecFile(path);
  if (!before.ok) throw new Error(JSON.stringify(before.errors));
  const source = await runSpec(before.spec, { ...common, target, adapter: echoAdapter() });
  writeFileSync(join(root, 'driftbench/check-set/house.yaml'), HOUSE('must'));
  const after = await loadSpecFile(path);
  if (!after.ok) throw new Error(JSON.stringify(after.errors));
  const mutatingCheck = {
    name: 'file-mutation',
    applies: () => true,
    evaluate: () => {
      writeFileSync(join(root, 'driftbench/check-set/house.yaml'), HOUSE('bleu'));
      return [];
    },
  };
  const rescored = await rescoreCarriedRun(after.spec, source, { checks: [...common.checks, mutatingCheck] });
  expect(rescored.blocks.map((block) => block.verdicts.some((verdict) => verdict.name === 'must'))).toEqual([
    false,
    true,
    false,
  ]);
  expect(rescored.blocks[0]?.resolved?.hash).toBe(rescored.blocks[2]?.resolved?.hash);
  expect(rescored.blocks[1]?.resolved?.hash).not.toBe(rescored.blocks[0]?.resolved?.hash);
});

it('refuses an unreconstructible later block before any check evaluates', async () => {
  const { path } = project();
  const spec = await loadSpecFile(path);
  if (!spec.ok) throw new Error(JSON.stringify(spec.errors));
  const source = await runSpec(spec.spec, { ...common, target, adapter: echoAdapter() });
  const last = source.blocks.at(-1);
  if (!last) throw new Error('source missing');
  last.givenHash = 'not-the-measured-input';
  let evaluated = 0;
  await expect(
    rescoreCarriedRun(spec.spec, source, {
      checks: [
        {
          name: 'probe',
          applies: () => true,
          evaluate: () => {
            evaluated++;
            return [];
          },
        },
      ],
    }),
  ).rejects.toThrow(/block 2 inputs differ/);
  expect(evaluated).toBe(0);
});

it.each(['run', 'carry'] as const)(
  'passes explicit object overrides into the tools check during %s',
  async (action) => {
    const { root, path } = project();
    const policyFolder = join(root, 'driftbench/policy/value-check');
    mkdirSync(policyFolder, { recursive: true });
    writeFileSync(
      join(policyFolder, 'strict.yaml'),
      'kind: policy/value-check\nid: strict\nextends: default\nitems:\n  - { id: rung1_outcome, enabled: false }\n',
    );
    writeFileSync(
      path,
      'id: carry-value-policy\nblocks:\n  - user: Do you cover this address?\n    expect:\n      tools:\n        - label: coverage.check\n          input: { address: "88 Summit Avenue, Acmeville" }\n',
    );
    const loaded = await loadSpecFile(path);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const checks = [createToolsCheck({ services: { replayer: acmeReplayer() } })];
    const adapter = {
      ...echoAdapter(),
      send: async () => ({
        segments: [],
        text: 'Checking.',
        cost: { usd: 0 },
        latencyMs: 0,
        toolCalls: [
          { id: 'coverage', label: 'coverage.check', input: { address: '88 summit avenue, acmeville' } },
        ],
      }),
    };
    const baseline = await runSpec(loaded.spec, { ...common, target, adapter, checks });
    const field = (run: typeof baseline) =>
      run.blocks[0]?.verdicts.find((entry) => entry.id === 'tools.coverage.check.input.address');
    expect(field(baseline)?.outcome).toBe('pass');
    const objects = {
      ...objectContextFor(path),
      cli: { use: new Map([['policy/value-check', 'strict']]), set: [] },
    };
    const result =
      action === 'run'
        ? await runSpec(loaded.spec, { ...common, target, adapter, checks, objects })
        : await rescoreCarriedRun(loaded.spec, baseline, { checks, objects });
    expect(field(result)?.outcome).toBe('fail');
    expect(field(result)?.evidence).toContain('exact_fallback');
    // An explicit run override must not mutate the context carried by the caller's loaded spec.
    const original = await runSpec(loaded.spec, { ...common, target, adapter, checks });
    expect(field(original)?.outcome).toBe('pass');
  },
);

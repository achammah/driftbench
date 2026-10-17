// Blast radius of units F2 and F6 on stored-run re-scoring: a re-judge stamps the verdicts it writes; a re-score
// writes a block that names only the objects it was re-scored with: no diagnosis computed from the verdicts it
// replaced, and no verdict of an item its check set disables, judge verdicts included.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterEach, describe, expect, it } from 'vitest';
import type { Check } from '../../src/contracts/check';
import { clearObjectContexts, objectContextFor } from '../../src/objects/layers';
import { prepareRejudge, prepareRescore, rejudgeRun, rescoreRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, mustCheck, specOf } from '../runner/support';

// Registers check-set:default, which every block resolves to when no layer names another.
initializeShippedObjects();

const spec = specOf({
  id: 'acme-quote',
  metadata: { depends: { stages: ['offer'] } },
  criteria: [{ name: 'price', rubric: 'A price is present.', gating: true }],
  blocks: [
    { when: { user: 'Quote Acme.' }, expect: { criteria: ['price'], must: ['ok'] } },
    { when: { user: 'Thanks.' }, expect: { must: ['ok'] } },
  ],
});
const changed = () => ({
  ...spec,
  criteria: spec.criteria?.map((c) => ({ ...c, rubric: 'The price must be 12.' })),
});
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const target = { adapter: 'echo', variant: 'v1' };

const judge = (outcome: 'pass' | 'fail'): Check => ({
  name: 'judge',
  applies: (ctx) => (ctx.expect.criteria ?? []).length > 0,
  evaluate: () => [
    { id: 'judge.price', kind: 'judge', name: 'price', gating: true, outcome, evidence: `judged ${outcome}` },
  ],
});

const stored = () =>
  runSpec(spec, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [mustCheck, judge('pass')],
    mode: 'F',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-13T00:00:00Z'),
  });
const options = {
  baselineProvenance: {
    version: 2 as const,
    adapters: [
      {
        ...adapterProvenance(echoAdapter(), target.adapter),
        targetHash: provenanceHash(target),
        agentVersionHash: provenanceHash('v1'),
      },
    ],
  },
  fromCampaign: 'acme-base',
  agentVersion: 'v1',
  now: new Date('2026-10-13T01:00:00Z'),
};

/** A project whose uses.yaml sets a check set extending the default with `disabled` off. */
function context(disabled: string) {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-blast-rescore-'));
  roots.push(root);
  const files: Record<string, string> = {
    'driftbench.yaml': 'plugins: []\n',
    'driftbench/check-set/house.yaml': `kind: check-set\nid: house\nextends: default\nitems:\n  - { id: ${disabled}, enabled: false }\n`,
    'driftbench/uses.yaml': 'check_set: house\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  clearObjectContexts();
  return objectContextFor(join(root, 'specs/acme-quote.yaml'));
}

describe('blast stamps: re-judge and re-score write verdicts their objects produced', () => {
  it('a re-judge stamps the verdict it writes with the judge item of the block check set', async () => {
    const run = await stored();
    expect(run.blocks[0]?.verdicts.find((v) => v.kind === 'judge')?.by).toMatchObject({ item: 'judge' });
    const prepared = prepareRejudge(spec, changed(), run, { ...options, criteria: ['price'] });
    const result = await rejudgeRun(prepared, judge('fail'), () => 0);
    const judged = result.blocks[0]?.verdicts.find((v) => v.kind === 'judge');
    expect(judged?.outcome).toBe('fail');
    expect(judged?.by).toMatchObject({
      object: expect.stringMatching(/^check-set:default@[0-9a-f]{8}$/),
      item: 'judge',
      impl: 'builtin:check/judge',
      layer: 'shipped',
    });
    for (const verdict of result.blocks.flatMap((block) => block.verdicts)) expect(verdict.by).toBeDefined();
  });

  it('a re-score leaves no diagnosis of the verdicts it replaced', async () => {
    const run = await stored();
    const first = run.blocks[0];
    if (!first) throw new Error('no block');
    first.diagnoses = [
      {
        diagnostic: 'diagnostic:explain@0123abcd',
        step: 'explain',
        verdictRef: first.verdicts.find((v) => v.name === 'must')?.id ?? 'must',
        summary: 'explains the must verdict',
        by: {
          object: 'diagnostic:explain@0123abcd',
          item: 'explain',
          impl: 'builtin:explain',
          layer: 'shipped',
        },
      },
    ];
    first.skippedForBudget = 1;
    Object.assign(run, { diagnoses: first.diagnoses, skippedForBudget: 1 });
    const prepared = prepareRescore(spec, spec, run, options);
    const result = await rescoreRun(prepared, [mustCheck], context('must'));
    const block = result.blocks[0];
    expect(block?.verdicts.some((v) => v.name === 'must')).toBe(false);
    for (const diagnosis of block?.diagnoses ?? [])
      expect(block?.verdicts.some((v) => v.id === diagnosis.verdictRef)).toBe(true);
    expect(block?.diagnoses).toBeUndefined();
    expect(block?.skippedForBudget).toBeUndefined();
    expect(result).not.toHaveProperty('diagnoses');
    expect(result).not.toHaveProperty('skippedForBudget');
  });

  it('a re-score under a check set that disables judge keeps no judge verdict', async () => {
    const run = await stored();
    const prepared = prepareRescore(spec, spec, run, options);
    const result = await rescoreRun(prepared, [mustCheck], context('judge'));
    const block = result.blocks[0];
    expect(block?.resolved?.objects.find((entry) => entry.key === 'check_set')?.id).toBe('house');
    expect(block?.verdicts.some((v) => v.kind === 'judge')).toBe(false);
  });

  it('a re-score stamps every machine and runner verdict with the new check set', async () => {
    const run = await stored();
    const prepared = prepareRescore(spec, spec, run, options);
    const result = await rescoreRun(prepared, [mustCheck], context('bleu'));
    for (const verdict of result.blocks.flatMap((block) => block.verdicts).filter((v) => v.kind !== 'judge'))
      expect(verdict.by?.object).toMatch(/^check-set:house@/);
    expect(result.cost).toBe(0);
  });
});

// Blast radius of PR 443 on the re-judge path: `uses` names scoring-only objects, so a stored run must be
// re-judged under a spec whose `uses` changed (on the spec or on a block), never refused as an incompatible
// observation (observationCompatibilityHash, consumed by prepareRejudge).
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { bindObjectContext, objectContextOfSpec } from '../../src/objects/context';
import { checkSpecObjects } from '../../src/objects/index';
import { type ObjectContext, resolveBlockObjects } from '../../src/objects/layers';
import { ObjectStore, objectRegistry } from '../../src/objects/resolve';
import { prepareRejudge, rejudgeRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import type { Spec } from '../../src/schema/spec';
import { echoAdapter, specOf } from '../runner/support';

// Fictional data only.
const original = specOf({
  id: 'blast-uses-rejudge',
  criteria: [{ name: 'price', rubric: 'A price is present.', gating: true }],
  blocks: [
    { id: 'q', when: { user: 'Quote the plan.' }, expect: { criteria: ['price'] } },
    { id: 't', when: { user: 'Thanks.' }, expect: { must: ['ok'] } },
  ],
});
const target = { adapter: 'echo', variant: 'v1' };
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
  fromCampaign: 'blast-base',
  agentVersion: 'v1',
  criteria: ['price'],
  now: new Date('2026-10-13T01:00:00Z'),
};
const stored = () =>
  runSpec(original, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-13T00:00:00Z'),
  });

/** Real project objects for the scoring-only references this fixture changes. */
function projectObjects(): ObjectContext {
  const store = new ObjectStore(objectRegistry.clone());
  const definitions = [
    { kind: 'policy/value-check', id: 'strict', extends: 'default', items: [] },
    { kind: 'policy/blame', id: 'acme', items: [] },
    { kind: 'judge-council', id: 'council-3', items: [] },
    { kind: 'diagnostic', id: 'value-mismatch-fixture', scope: 'block', steps: [] },
  ];
  for (const object of definitions) {
    store.add(object, 'project', { path: `fixture/${object.kind}/${object.id}.yaml` });
  }
  return { store, uses: [], problems: [] };
}

const withUses = (): Spec =>
  bindObjectContext(
    {
      ...original,
      uses: { blame: 'acme', judges: 'council-3' },
      blocks: original.blocks.map((block, index) =>
        index === 0
          ? { ...block, uses: { value_check: 'strict', diagnostics: ['value-mismatch-fixture'] } }
          : block,
      ),
    },
    projectObjects(),
  );

describe('blast 443: campaign rejudge accepts a spec whose uses alone changed', () => {
  it('prepares and runs the re-judge with the stored observations, and stamps the new spec hash', async () => {
    const run = await stored();
    const next = withUses();
    const objects = objectContextOfSpec(next);
    if (!objects) throw new Error('the fixture lost its object context');
    expect(checkSpecObjects(next, objects)).toEqual([]);
    expect(resolveBlockObjects(next, 0, objects).map(({ key, object }) => [key, object.id])).toEqual(
      expect.arrayContaining([
        ['value_check', 'strict'],
        ['blame', 'acme'],
        ['judges', 'council-3'],
        ['diagnostics', 'value-mismatch-fixture'],
      ]),
    );
    const prepared = prepareRejudge(original, next, run, options);
    expect(prepared.contexts).toHaveLength(2);
    const result = await rejudgeRun(
      prepared,
      {
        name: 'judge',
        applies: () => true,
        evaluate: () => [
          { id: 'judge.price', kind: 'judge', name: 'price', gating: true, outcome: 'pass', evidence: 'ok' },
        ],
      },
      () => 0,
    );
    expect(result.blocks.map((block) => block.observed)).toEqual(run.blocks.map((block) => block.observed));
    expect(result.rejudged?.oldSpecHash).toBe(run.specHash);
    expect(result.rejudged?.newSpecHash).not.toBe(run.specHash);
  });

  it('still refuses when an agent-facing field changes beside uses', async () => {
    const run = await stored();
    const next = withUses();
    const moved: Spec = {
      ...next,
      blocks: next.blocks.map((block, index) =>
        index === 1 ? { ...block, when: { user: 'Thank you.' } } : block,
      ),
    };
    expect(() => prepareRejudge(original, moved, run, options)).toThrow();
  });
});

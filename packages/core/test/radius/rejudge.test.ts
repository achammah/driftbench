import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { observationCompatibilityHash, prepareRejudge, rejudgeRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceDigest, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { Spec } from '../../src/schema/spec';
import { echoAdapter, specOf } from '../runner/support';

const original = specOf({
  id: 'acme-quote',
  metadata: { depends: { stages: ['offer'] } },
  criteria: [
    { name: 'price', rubric: 'A price is present.', gating: true },
    { name: 'tone', rubric: 'Polite.' },
  ],
  blocks: [
    { when: { user: 'Quote Acme.' }, expect: { criteria: ['price', 'tone'] } },
    { when: { user: 'Thanks.' }, expect: { must: ['ok'] } },
  ],
});
const changed = () => ({
  ...original,
  criteria: original.criteria?.map((c) =>
    c.name === 'price' ? { ...c, rubric: 'The price must be 12.' } : c,
  ),
});
const target = { adapter: 'echo', variant: 'v1' };
const stamp = { executionHash: 'runtime-context' };
it('excludes only declared judge fields; new schema fields enter the hash by default', () => {
  expect(observationCompatibilityHash(original, stamp)).toBe(observationCompatibilityHash(changed(), stamp));
  const future = Spec.extend({ futureAgentInput: z.string() });
  expect(
    observationCompatibilityHash(future.parse({ ...original, futureAgentInput: 'new' }), stamp),
  ).not.toBe(observationCompatibilityHash(original, stamp));
  for (const next of [
    { ...original, given: { vars: { system: 'new' } } },
    { ...original, blocks: [...original.blocks].reverse() },
    { ...original, blocks: original.blocks.map((b) => ({ ...b, expect: { ...b.expect, must: ['new'] } })) },
  ])
    expect(observationCompatibilityHash(next, stamp)).not.toBe(observationCompatibilityHash(original, stamp));
  expect(observationCompatibilityHash(original, { executionHash: 'changed-seed-or-adapter' })).not.toBe(
    observationCompatibilityHash(original, stamp),
  );
});
const base = () =>
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
  criteria: ['price'],
  now: new Date('2026-10-13T01:00:00Z'),
};
it('rejudges only affected criteria without an agent and catches a planted rubric regression', async () => {
  const run = await base();
  const prepared = prepareRejudge(original, changed(), run, options);
  const previouslyJudged = run.blocks[1];
  if (!previouslyJudged) throw new Error('missing second block');
  previouslyJudged.rejudged = { ...prepared.stamp, criteria: ['tone'] };
  const calls: string[][] = [];
  let spend = 0;
  const result = await rejudgeRun(
    prepared,
    {
      name: 'judge',
      applies: () => true,
      evaluate: (ctx) => {
        calls.push(ctx.expect.criteria ?? []);
        spend += 0.03;
        expect(ctx.block.when).toEqual({ user: 'Quote Acme.' });
        return [
          {
            id: 'judge.price',
            kind: 'judge',
            name: 'price',
            gating: true,
            outcome: 'fail',
            evidence: '12 is absent',
          },
        ];
      },
    },
    () => spend,
  );
  expect(calls).toEqual([['price']]);
  expect(result.blocks[0]?.pass).toBe(false);
  expect(result.blocks[0]?.rejudged?.criteria).toEqual(['price']);
  expect(result.blocks[1]?.carried).toBeDefined();
  expect(result.blocks[1]?.rejudged).toBeUndefined();
  expect(result.cost).toBe(0.03);
  expect(result.rejudged).toMatchObject({
    oldSpecHash: run.specHash,
    newSpecHash: result.specHash,
    criteria: ['price'],
  });
  expect(result.blocks.map((b) => b.observed)).toEqual(run.blocks.map((b) => b.observed));
});
it('refuses legacy, changed agent, changed deterministic checks, unknown inputs, stale and exhausted carries', async () => {
  const run = await base();
  if (!run.provenance) throw new Error('missing stamp');
  for (const [source, spec, opts] of [
    [{ ...run, provenance: undefined }, changed(), options],
    [{ ...run, provenanceDigest: undefined }, changed(), options],
    [run, changed(), { ...options, baselineProvenance: undefined }],
    [run, changed(), { ...options, agentVersion: 'v2' }],
    [run, { ...changed(), blocks: [{ ...original.blocks[0], expect: { must: ['regression'] } }] }, options],
    [run, changed(), { ...options, maxAgeDays: 0 }],
    [run, changed(), { ...options, maxCarry: 0 }],
    [
      {
        ...run,
        provenance: { ...run.provenance, driver: { idHash: provenanceHash('custom'), seedsHash: null } },
      },
      changed(),
      options,
    ],
  ] as const)
    expect(() => prepareRejudge(original, spec as Spec, source, opts)).toThrow(/rerun|legacy/i);
});

it('refuses tampered Given, ledger, stimulus, artifact references and undeclared criterion edits', async () => {
  const run = await base();
  const first = run.blocks[0];
  if (!first?.provenance) throw new Error('missing stamp');
  const stamp = first.provenance;
  for (const block of [
    { ...first, givenHash: 'wrong' },
    { ...first, provenance: { ...stamp, ledgerHash: 'wrong' } },
    { ...first, provenance: { ...stamp, stimulusHash: provenanceHash({ user: 'wrong' }) } },
    {
      ...first,
      provenance: { ...stamp, artifacts: [{ pathHash: provenanceHash('price.txt'), sha256: null }] },
    },
  ])
    expect(() =>
      prepareRejudge(original, changed(), { ...run, blocks: [block, ...run.blocks.slice(1)] }, options),
    ).toThrow(/rerun/);
  expect(() =>
    prepareRejudge(
      original,
      {
        ...changed(),
        criteria: changed().criteria?.map((c) => ({ ...c, rubric: 'changed every criterion' })),
      },
      run,
      options,
    ),
  ).toThrow('Changed criterion tone is not selected');
  expect(() => prepareRejudge(original, changed(), { ...run, finishedAt: 'unknown' }, options)).toThrow(
    'timestamp',
  );
});

it('reconstructs teacher-forced canonical Givens and retains carry age over repeated re-judges', async () => {
  const run = await runSpec(original, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [],
    mode: 'T',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => options.now,
  });
  const prepared = prepareRejudge(original, changed(), run, options);
  const result = await rejudgeRun(
    prepared,
    {
      name: 'judge',
      applies: () => true,
      evaluate: () => [
        {
          id: 'judge.price',
          kind: 'judge',
          name: 'price',
          gating: true,
          outcome: 'pass',
          evidence: 'matches',
        },
      ],
    },
    () => 0,
  );
  expect(result.carried?.age.campaigns).toBe(1);
  expect(() => prepareRejudge(changed(), changed(), result, { ...options, maxCarry: 1 })).toThrow(
    'limit is 1',
  );
});

it.each([false, true])('rejudge copies obey the destination text policy (%s)', async (record) => {
  const source = await base();
  for (const block of source.blocks) block.realized = { hash: provenanceHash('private'), text: 'private' };
  source.provenanceDigest = provenanceDigest(source);
  const prepared = prepareRejudge(original, changed(), source, options);
  const judge = {
    name: 'judge',
    applies: () => true,
    evaluate: () => [
      {
        id: 'price',
        name: 'price',
        kind: 'judge' as const,
        outcome: 'pass' as const,
        gating: true,
        evidence: 'ok',
      },
    ],
  };
  const result = await rejudgeRun(prepared, judge, () => 0, undefined, undefined, record);
  for (const block of result.blocks)
    expect(block.realized).toEqual({
      hash: provenanceHash('private'),
      ...(record ? { text: 'private' } : {}),
    });
  expect(result.provenanceDigest).toBe(provenanceDigest(result));
  if (!record)
    expect(result.realizedTextStripped).toEqual({
      fromRun: source.runId,
      fromCampaign: options.fromCampaign,
    });
  expect(source.blocks.every((block) => block.realized?.text === 'private')).toBe(true);
  const stripped = await rejudgeRun(prepared, judge, () => 0);
  const copiedAgain = await rejudgeRun(
    { ...prepared, source: stripped },
    judge,
    () => 0,
    undefined,
    undefined,
    true,
  );
  expect(copiedAgain.blocks.every((block) => block.realized?.text === undefined)).toBe(true);
});

it('re-judges the scored block of a run whose later blocks were not run, and leaves those as they were', async () => {
  const forced = specOf({
    ...original,
    id: 'acme-quote-forced',
    blocks: [
      original.blocks[0],
      {
        when: { user: 'Check the lookup.' },
        given: { world: { tools: { lookup: { result: { ok: true } } } } },
        expect: { must: ['ok'], ledger_add: { checked: true } },
      },
      { when: { user: 'Thanks.' }, expect: { must: ['ok'] } },
    ],
  });
  const forcedChanged = {
    ...forced,
    criteria: forced.criteria?.map((c) =>
      c.name === 'price' ? { ...c, rubric: 'The price must be 12.' } : c,
    ),
  };
  // The echo adapter has no toolStubs: blocks 1 and 2 are not run.
  const run = await runSpec(forced, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-13T00:00:00Z'),
  });
  expect(run.blocks.map((b) => b.status)).toEqual([undefined, 'not_run', 'not_run']);
  const prepared = prepareRejudge(forced, forcedChanged as Spec, run, options);
  const judged: number[] = [];
  const result = await rejudgeRun(
    prepared,
    {
      name: 'judge',
      applies: () => true,
      evaluate: (ctx) => {
        judged.push(ctx.blockIndex);
        return [
          { id: 'judge.price', kind: 'judge', name: 'price', gating: true, outcome: 'pass', evidence: 'ok' },
        ];
      },
    },
    () => 0,
  );
  expect(judged).toEqual([0]);
  expect(result.blocks.map((b) => b.status)).toEqual([undefined, 'not_run', 'not_run']);
  expect(result.blocks[0]?.rejudged?.criteria).toEqual(['price']);
  expect(result.blocks[1]?.pass).toBe(false);
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createToolsCheck,
  initializeShippedObjects,
  type ValuePolicy,
  type ValueServices,
} from '@agent-nexus/driftbench-checks';
import {
  loadSpecFile,
  objectContextOfSpec,
  runSpec,
  stamp,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterEach, describe, expect, it } from 'vitest';
import { observed } from '../../../checks/test/support/context';
import { echoAdapter } from '../runner/support';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const policy = {
  kind: 'policy/value-check',
  id: 'local',
  extends: null,
  items: [
    {
      id: 'early',
      title: 'Resolved by tool',
      impl: 'builtin:value-check/outcome',
      when: { tool_replayable: true },
    },
    {
      id: 'copied',
      title: 'Copied value',
      impl: 'builtin:value-check/judge',
      when: { tool_replayable: false, source: 'user' },
      params: { design: 'side_by_side', repeats: 1, orders: 'one' },
    },
    {
      id: 'late',
      title: 'Other value',
      impl: 'builtin:value-check/judge',
      when: { tool_replayable: false, source: 'unknown' },
      params: { design: 'side_by_side', repeats: 1, orders: 'one' },
    },
  ],
};
const services: ValueServices = {
  replayer: {
    declaration: () => ({ resolved: ['value'], inputs: ['profile.a'], distractors: true }),
    call: (_tool, input) => ({
      ok: true,
      output: { value: String((input.profile as Record<string, unknown>).a).toLowerCase() },
    }),
  },
  judge: {
    model: 'fixture',
    calibration: { falseAcceptance: 0, source: 'test fixture' },
    complete: async ({ parts }) => {
      if (String(parts.c).startsWith('open')) throw new Error('fixture has no decision');
      return { same: !String(parts.c).startsWith('wrong'), why: 'fixture decision' };
    },
  },
};

async function scored(
  gold: Record<string, unknown>,
  value: Record<string, unknown>,
  options: { fallback?: boolean; configured?: ValuePolicy; uses?: boolean } = {},
) {
  initializeShippedObjects();
  const root = await mkdtemp(join(tmpdir(), 'value-rung-stamps-'));
  roots.push(root);
  await writeFile(join(root, 'driftbench.yaml'), '{}\n');
  await mkdir(join(root, 'driftbench/policy/value-check'), { recursive: true });
  await writeFile(
    join(root, 'driftbench/policy/value-check/local.yaml'),
    JSON.stringify(options.fallback ? { ...policy, items: [] } : policy),
  );
  const path = join(root, 'spec.yaml');
  await writeFile(
    path,
    JSON.stringify({
      id: 'rung-stamps',
      ...(options.uses === false ? {} : { uses: { value_check: 'local' } }),
      blocks: [
        {
          user: 'Copy COPIED faithfully.',
          expect: { tools: [{ label: 'lookup', input: { profile: { subset: gold } } }] },
        },
      ],
    }),
  );
  const loaded = await loadSpecFile(path);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const objects = objectContextOfSpec(loaded.spec);
  if (!objects) throw new Error('loaded spec has no object context');
  const resolved = objects.store.resolve('policy/value-check', 'local');
  const adapter = echoAdapter();
  adapter.send = async () => observed('ok', [{ label: 'lookup', input: { profile: value } }]);
  const run = await runSpec(loaded.spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: [createToolsCheck({ policy: options.configured, services })],
    mode: 'F',
    repeat: 0,
  });
  expect(run.status).toBe('completed');
  const block = run.blocks[0];
  if (!block) throw new Error('run has no block');
  const verdicts = block.verdicts.filter((entry) => entry.name === 'tools');
  expect(verdicts.map((entry) => entry.id)).toEqual([
    'tools.lookup.count',
    'tools.lookup.input.profile',
    ...(options.fallback ? ['tools.lookup.input.profile.no_decider'] : []),
  ]);
  return { verdict: verdicts[1] as Verdict, ref: resolved.ref, verdicts };
}

function provenance(result: Awaited<ReturnType<typeof scored>>, item: string, impl: string) {
  expect(result.verdict.by).toEqual({
    object: result.ref,
    item,
    impl: `builtin:value-check/${impl}`,
    layer: 'project',
  });
}

describe('value policy provenance survives runSpec stamping', () => {
  it('stamps a single deciding rung from the resolved project policy', async () => {
    const result = await scored({ a: 'ALPHA' }, { a: 'alpha' });
    expect(result.verdict.outcome).toBe('pass');
    expect(result.verdict.valueCheck).toEqual([
      { call: 1, path: 'profile.a', rung: 'early', outcome: 'pass' },
    ]);
    provenance(result, 'early', 'outcome');
  });
  it('stamps the latest passing rung in policy order, not decision order', async () => {
    const result = await scored({ b: 'BETA', a: 'ALPHA' }, { b: 'beta', a: 'alpha' });
    expect(result.verdict.outcome).toBe('pass');
    expect(result.verdict.valueCheck?.map((entry) => entry.rung)).toEqual(['late', 'early']);
    provenance(result, 'late', 'judge');
  });
  it('stamps the first failing value even after a looser passing value', async () => {
    const result = await scored(
      { b: 'BETA', a: 'ALPHA', c: 'GAMMA' },
      { b: 'beta', a: 'wrong alpha', c: 'wrong gamma' },
    );
    expect(result.verdict.outcome).toBe('fail');
    expect(result.verdict.valueCheck?.map(({ rung, outcome }) => [rung, outcome])).toEqual([
      ['late', 'pass'],
      ['early', 'fail'],
      ['late', 'fail'],
    ]);
    provenance(result, 'early', 'outcome');
  });
  it('stamps the first inconclusive value when no value fails', async () => {
    const result = await scored(
      { c: 'COPIED', b: 'BETA', a: 'ALPHA' },
      { c: 'open copied', b: 'open beta', a: 'alpha' },
    );
    expect(result.verdict.outcome).toBe('inconclusive');
    expect(result.verdict.valueCheck?.map(({ rung, outcome }) => [rung, outcome])).toEqual([
      ['copied', 'inconclusive'],
      ['late', 'inconclusive'],
      ['early', 'pass'],
    ]);
    provenance(result, 'copied', 'judge');
  });
  it('stamps exact_fallback without adding a verdict', async () => {
    const result = await scored({ a: 'ALPHA' }, { a: 'alpha' }, { fallback: true });
    expect(result.verdict.outcome).toBe('fail');
    expect(result.verdict.valueCheck).toEqual([
      { call: 1, path: 'profile.a', rung: 'exact_fallback', outcome: 'fail' },
    ]);
    provenance(result, 'exact_fallback', 'exact');
  });
  it('retains ordinary check-set stamping when no value rung ran', async () => {
    const result = await scored({ a: 'ALPHA' }, { a: 'ALPHA' });
    expect(result.verdict.valueCheck).toBeUndefined();
    expect(result.verdict.by?.object).toMatch(/^check-set:default@/);
    expect(result.verdict.by?.item).toBe('tools');
  });
  it('attributes an explicitly configured policy to the caller, never the shipped default', async () => {
    const configured: ValuePolicy = { ref: 'policy/value-check:configured@12345678', items: policy.items };
    const result = await scored({ a: 'ALPHA' }, { a: 'alpha' }, { configured, uses: false });
    expect(result.verdict.by).toEqual({
      object: configured.ref,
      item: 'early',
      impl: 'builtin:value-check/outcome',
      layer: 'cli',
    });
  });
  it('restamping preserves policy decisions but replaces an ordinary check stamp', async () => {
    const result = await scored({ a: 'ALPHA' }, { a: 'alpha' });
    const execution = {
      object: 'check-set:new@12345678',
      item: 'tools',
      impl: 'builtin:check/tools',
      layer: 'cli' as const,
    };
    expect(stamp([result.verdict], execution)[0]?.by).toEqual(result.verdict.by);
    expect(stamp([{ ...result.verdict, valueCheck: undefined }], execution)[0]?.by).toEqual(execution);
    expect(stamp([{ ...result.verdict, name: 'other-check' }], execution)[0]?.by).toEqual(execution);
  });
  it('hashes configured policy content when it has no resolved reference', async () => {
    const result = await scored(
      { a: 'ALPHA' },
      { a: 'alpha' },
      { configured: { items: policy.items }, uses: false },
    );
    expect(result.verdict.by).toMatchObject({
      object: expect.stringMatching(/^policy\/value-check:\(caller\)@[a-f0-9]{8}$/),
      item: 'early',
      layer: 'cli',
    });
  });
});

import {
  type CheckContext,
  diagnosticStep,
  type Expect,
  machineVerdict,
  ObjectStore,
  objectRegistry,
  type StepOutput,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { afterEach, expect, it } from 'vitest';
import { context, observed } from './support/context';

const initial = objectRegistry.snapshot();
afterEach(() => objectRegistry.restore(initial));
const STEP = 'builtin:diagnostic/argument-accuracy';

function check(expected: Expect): CheckContext {
  return context(
    { id: 'argument-selection', kind: 'conversation', blocks: [{ when: { user: 'go' }, expect: expected }] },
    0,
    observed(''),
  );
}
async function accuracy(verdicts: Verdict[], ctx: CheckContext): Promise<StepOutput | undefined> {
  const { initializeShippedObjects } = await import('../src/index');
  initializeShippedObjects();
  const step = diagnosticStep(STEP);
  if (!step) throw new Error('missing argument-accuracy implementation');
  const output = await step.run({
    scope: 'block',
    check: ctx,
    verdicts,
    objects: [],
    params: {},
    earlier: [],
  });
  if (Array.isArray(output)) throw new Error('expected one diagnosis');
  return output;
}
const input = (id: string, outcome: 'pass' | 'fail', gating = true) =>
  machineVerdict('tools', id, outcome, 'measured argument', { gating });
const lint = (id: string) =>
  machineVerdict('tools', id, 'fail', 'test lint: no declared decider', { gating: false });

it('importing checks registers no diagnostic implementation or shipped definition', async () => {
  const before = objectRegistry.snapshot();
  await import('../src/index');
  const after = objectRegistry.snapshot();
  expect([...after.impls.keys()]).toEqual([...before.impls.keys()]);
  expect([...after.shipped.keys()]).toEqual([...before.shipped.keys()]);
});

it('explicit initialization remains idempotent after registry restore while the step map survives', async () => {
  const { initializeShippedObjects } = await import('../src/index');
  for (let round = 0; round < 2; round++) {
    initializeShippedObjects();
    initializeShippedObjects();
    expect(objectRegistry.impl(STEP)?.kinds).toEqual(['diagnostic']);
    const resolved = new ObjectStore(objectRegistry).resolve('diagnostic', 'argument-accuracy');
    expect(resolved.items.map((item) => item.impl)).toEqual([STEP]);
    expect(diagnosticStep(STEP)).toBeDefined();
    objectRegistry.restore(initial);
    expect(objectRegistry.impl(STEP)).toBeUndefined();
    expect(diagnosticStep(STEP)).toBeDefined();
  }
});

it('excludes actual value-ladder lint verdicts from the argument denominator', async () => {
  const { createToolsCheck, initializeShippedObjects } = await import('../src/index');
  initializeShippedObjects();
  const ctx = check({ tools: [{ label: 'lookup', input: { good: 'same', bad: 'expected' } }] });
  const verdicts = await createToolsCheck().evaluate({
    ...ctx,
    observed: observed('', [{ label: 'lookup', input: { good: 'same', bad: 'different' } }]),
  });
  expect(verdicts.some((verdict) => verdict.evidence.startsWith('test lint:'))).toBe(true);
  expect(await accuracy(verdicts, ctx)).toMatchObject({
    score: 0.5,
    evidence: { matched: 1, expected: 2, missed: ['lookup input.bad'] },
  });
});

it.each(['no_decider', 'unstated_format'])(
  'counts real fields named %s and excludes a lint with the same verdict ID',
  async (suffix) => {
    const ctx = check({
      tools: [{ label: 'lookup', input: { value: 'good', [`value.${suffix}`]: 'good', [suffix]: 'good' } }],
    });
    const verdicts = [
      input('lookup.input.value', 'fail'),
      lint(`lookup.input.value.${suffix}`),
      input(`lookup.input.value.${suffix}`, 'pass'),
      input(`lookup.input.${suffix}`, 'pass'),
    ];
    expect(await accuracy(verdicts, ctx)).toMatchObject({
      score: 2 / 3,
      evidence: { matched: 2, expected: 3, missed: ['lookup input.value'] },
    });
  },
);

it('matches exact expected fields with duplicate labels and embedded input delimiters, excluding zero counts', async () => {
  const ctx = check({
    tools: [
      { label: 'lookup', count: 0, input: { ignored: 'x' } },
      { label: 'lookup', input: { no_decider: 'x' } },
      { label: 'lookup', input: { unstated_format: 'x' } },
      { label: 'route.input.inner', input: { address: 'x' } },
      { label: 'forbidden', count: 0, input: { ignored: 'x' } },
    ],
  });
  const verdicts = [
    input('lookup.input.no_decider', 'pass'),
    input('lookup#2.input.unstated_format', 'fail'),
    input('route.input.inner.input.address', 'fail'),
    input('forbidden.input.ignored', 'fail'),
    input('lookup.input.ignored', 'fail'),
    input('lookup.input.undeclared', 'fail'),
  ];
  expect(await accuracy(verdicts, ctx)).toMatchObject({
    score: 1 / 3,
    evidence: {
      matched: 1,
      expected: 3,
      missed: ['lookup input.unstated_format', 'route.input.inner input.address'],
    },
  });
});

it('counts real nongating input verdicts, including their failures', async () => {
  const ctx = check({ tools: [{ label: 'lookup', input: { good: 'x', bad: 'x' } }] });
  expect(
    await accuracy(
      [input('lookup.input.good', 'pass', false), input('lookup.input.bad', 'fail', false)],
      ctx,
    ),
  ).toMatchObject({ score: 0.5, evidence: { matched: 1, expected: 2 } });
});

it('keeps the legacy check:{} fallback while excluding lint evidence', async () => {
  const legacy = {} as CheckContext;
  expect(
    await accuracy(
      [
        input('lookup.input.good', 'pass'),
        input('lookup.input.bad', 'fail'),
        lint('lookup.input.bad.no_decider'),
      ],
      legacy,
    ),
  ).toMatchObject({ score: 0.5, evidence: { matched: 1, expected: 2 } });
});

it('does not treat undeclared inputs as expected when a check has an empty tools list', async () => {
  expect(await accuracy([input('lookup.input.stray', 'fail')], check({ tools: [] }))).toBeUndefined();
});

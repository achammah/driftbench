import { execution, someCall } from '@agent-nexus/driftbench-checks';
import type { CheckContext, Observed, Spec, Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type Component, completionComponents, patternSample } from '../../src/ladders/estate/completion';

/** A hand-written spec: a fictional skill ran its script, once, and exited cleanly. */
function specOf(
  expectExecution: Record<string, unknown> | undefined,
  someCalls?: Array<Record<string, unknown>>,
): Spec {
  return {
    id: 'oracle-execution',
    version: '1',
    kind: 'task',
    target: { adapter: 'claude-code' },
    blocks: [
      {
        id: 'ask',
        when: { user: 'Close ticket 58 for the repaired machine.' },
        expect: expectExecution === undefined ? {} : { execution: expectExecution },
      },
    ],
    ...(someCalls ? { rules: { custom: { some_call: { calls: someCalls } } } } : {}),
  } as unknown as Spec;
}

const PARTS = {
  label: 'Bash',
  input: { command: { contains: 'list-parts.py' } },
  count: { min: 1 },
  block: 0,
};

function observed(commands: number, exit = 0): Observed {
  return {
    segments: [],
    text: 'done',
    toolCalls: Array.from({ length: commands }, (_, index) => ({
      id: `call-${index}`,
      label: 'Bash',
      input: { command: `python3 scripts/list-parts.py --ticket ${index}` },
    })),
    cost: { usd: 0 },
    latencyMs: 0,
    executions: Array.from({ length: commands }, (_, index) => ({
      command: `python3 scripts/list-parts.py --ticket ${index}`,
      exitCode: exit,
    })),
  } as unknown as Observed;
}

async function verdictsOf(spec: Spec, component: Component, o: Observed): Promise<Verdict[]> {
  const block = spec.blocks[component.block];
  const context = {
    spec,
    mode: 'F',
    blockIndex: component.block,
    block,
    expect: block?.expect ?? {},
    given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'x' },
    observed: o,
    history: [],
    ledger: {},
  } as unknown as CheckContext;
  if (component.channel === 'expect') return execution.evaluate(context) as Verdict[];
  const options = spec.rules?.custom?.[component.check];
  // The runner registers a custom check under `custom.`; the check itself names its verdicts without it.
  return ((await someCall(context, options)) as Verdict[]).map((v) => ({ ...v, id: `custom.${v.id}` }));
}

/** The control passes on the reference output and the change makes the targeted verdicts fail. */
async function prove(spec: Spec, base: () => Observed): Promise<string[]> {
  const bad: string[] = [];
  const components = completionComponents(spec).components;
  if (components.length === 0) bad.push('no component derived');
  for (const component of components) {
    const control = base();
    component.prepare?.(control);
    const before = (await verdictsOf(spec, component, control)).filter((v) =>
      component.controlVerdicts.includes(v.id),
    );
    if (before.length !== component.controlVerdicts.length || before.some((v) => v.outcome !== 'pass'))
      bad.push(`control ${component.id}`);
    const changed = base();
    component.prepare?.(changed);
    component.change(changed);
    const after = (await verdictsOf(spec, component, changed)).filter((v) =>
      component.verdicts.includes(v.id),
    );
    const outcome = component.violationOutcome;
    const hit =
      outcome === 'absent'
        ? after.length === 0
        : after.length === component.verdicts.length &&
          after.every((v) =>
            outcome ? v.outcome === outcome : v.outcome === 'fail' || v.outcome === 'inconclusive',
          );
    if (!hit) bad.push(`violation ${component.id}`);
  }
  return bad;
}

describe('the completion oracle derives components for expect.execution', () => {
  it('has no gap for ran_code, exit_code and max_commands', () => {
    const inventory = completionComponents(specOf({ ran_code: true, exit_code: 0, max_commands: 2 }));
    expect(inventory.gaps).toEqual([]);
    const ids = inventory.components.map((c) => c.id);
    for (const key of ['ran_code', 'exit_code', 'max_commands'])
      expect(
        ids.some((id) => id.startsWith(`0.expect.execution.${key}`)),
        key,
      ).toBe(true);
  });

  it.each([
    [{ ran_code: true }, () => observed(1)],
    [{ ran_code: false }, () => observed(0)],
    [{ exit_code: 0 }, () => observed(2)],
    [{ exit_code: 3 }, () => observed(2, 3)],
    [{ max_commands: 2 }, () => observed(2)],
    [{ ran_code: true, exit_code: 0, max_commands: 2 }, () => observed(2)],
  ])('kills each violation of %j and holds on the reference output', async (expectation, base) => {
    expect(await prove(specOf(expectation), base)).toEqual([]);
  });

  it('keeps an unknown execution option a named gap, never a silent pass', () => {
    const inventory = completionComponents(specOf({ ran_code: true, signal: 'SIGKILL' }));
    expect(inventory.gaps).toEqual(['0.expect.execution.unsupported-option:signal']);
  });
});

describe('the completion oracle derives components for custom.some_call', () => {
  it('has no gap for a call entry with label, input, count and block', () => {
    expect(completionComponents(specOf(undefined, [PARTS])).gaps).toEqual([]);
  });

  it.each([
    [[PARTS]],
    [[{ ...PARTS, count: 0 }]],
    [[{ ...PARTS, count: { min: 2 } }]],
    [[{ ...PARTS, count: { max: 1 } }]],
    [[{ ...PARTS, input: { command: { exact: 'python3 scripts/list-parts.py --ticket 0' } } }]],
    [[{ ...PARTS, input: { command: { regex: 'list-parts\\.py --ticket [0-9]+' } } }]],
    [[{ ...PARTS, count: 0, input: { command: { regex: 'list-parts\\.py --ticket [0-9]{1}' } } }]],
    [[{ ...PARTS, input: { command: { one_of: ['python3 scripts/list-parts.py --ticket 0', 'other.sh'] } } }]],
    [[{ ...PARTS, input: { command: { nonempty: true } } }]],
    [[{ ...PARTS, count: { min: 2, max: 3 } }]],
  ])('kills each violation of the entries %j and holds on the reference output', async (calls) => {
    const spec = specOf(undefined, calls);
    const wanted = calls[0]?.count;
    const n = wanted === 0 ? 0 : typeof wanted === 'object' && 'min' in (wanted as object) ? 2 : 1;
    expect(await prove(spec, () => observed(n))).toEqual([]);
  });

  it('leaves an entry of another block alone, and derives several entries', () => {
    const inventory = completionComponents(
      specOf(undefined, [
        PARTS,
        { label: 'Read', input: { file_path: { contains: 'notes' } } },
        { ...PARTS, block: 7 },
      ]),
    );
    expect(inventory.gaps).toEqual([]);
    const ids = new Set(inventory.components.flatMap((c) => c.verdicts));
    expect([...ids].sort()).toEqual(['custom.some_call.0', 'custom.some_call.1']);
  });

  it('keeps an assertion with no witness, and an entry with no label, named gaps', () => {
    expect(
      completionComponents(
        specOf(undefined, [{ label: 'Bash', input: { command: { regex: '(a|b)+' } } }]),
      ).gaps,
    ).toContain('0.custom.some_call.0.input.command.assertion-witness');
    expect(completionComponents(specOf(undefined, [{ input: { command: 'x' } }])).gaps).toContain(
      '0.custom.some_call.0.label',
    );
  });

  it.each([
    ['one_of', { one_of: ['python3 scripts/list-parts.py --ticket 0', 'other.sh'] }],
    ['nonempty', { nonempty: true }],
    ['exact', { exact: 'python3 scripts/list-parts.py --ticket 0' }],
    ['contains', { contains: 'list-parts.py' }],
    ['regex', { regex: 'list-parts\\.py --ticket [0-9]+' }],
  ])('derives the %s assertion without a gap', (_form, assertion) => {
    expect(
      completionComponents(specOf(undefined, [{ ...PARTS, input: { command: assertion } }])).gaps,
    ).toEqual([]);
  });

  it('adds the empty string as a selector of a nonempty assertion, and no foreign value (it satisfies the assertion)', () => {
    const ids = completionComponents(
      specOf(undefined, [{ ...PARTS, input: { command: { nonempty: true } } }]),
    ).components.map((c) => c.id);
    expect(ids).toContain('0.custom.some_call.0.selector.input.command.empty');
    expect(ids).not.toContain('0.custom.some_call.0.selector.input.command.foreign');
  });

  it('keeps an unknown option of the some_call check itself a named gap', () => {
    const spec = specOf(undefined, [PARTS]) as unknown as {
      rules: { custom: { some_call: Record<string, unknown> } };
    };
    spec.rules.custom.some_call.speed = 'fast';
    expect(completionComponents(spec as unknown as Spec).gaps).toContain(
      '0.custom.some_call.unsupported-option:speed',
    );
  });

  it('keeps an unknown entry option a named gap', () => {
    const inventory = completionComponents(specOf(undefined, [{ ...PARTS, retry: true }]));
    expect(inventory.gaps).toEqual(['0.custom.some_call.0.unsupported-clause:retry']);
  });
});

describe('a sample for a simple pattern', () => {
  it.each([
    ['track\\.sh [A-Z]{3} ', 'track.sh AAA '],
    ['^list-parts\\.py$', 'list-parts.py'],
    ['run [0-9]+', 'run 0'],
    ['a\\d*b', 'ab'],
  ])('builds an accepted string for %s', (pattern, sample) => {
    expect(patternSample(pattern)).toBe(sample);
  });

  it.each(['(one|two)', 'one|two', '(?=ahead)x', '[^a]', '\\p{L}'])('has none for %s', (pattern) => {
    expect(patternSample(pattern)).toBeUndefined();
  });
});

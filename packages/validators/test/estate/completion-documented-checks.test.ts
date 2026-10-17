import { type Observed, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { context, observed } from '../../../checks/test/support/context';
import { completionComponents, componentSpec } from '../../src/ladders/estate/completion';
import { replayChecks } from '../../src/ladders/estate/pipeline';

/**
 * The completion oracle derives, from a spec's own checks, the clauses a product must not relax. The documented
 * checks of docs/estate.md (expect.execution, rules.custom.some_call) must be derived, not rejected; an unknown check
 * is still a named gap.
 */
function spec(expectBlock: Record<string, unknown>, custom: Record<string, unknown> = {}): Spec {
  const loaded = parseSpecText(
    JSON.stringify({
      id: 'estate-completion-documented',
      version: '1',
      kind: 'task',
      target: { adapter: 'claude-code' },
      blocks: [{ id: 'ask', when: { user: 'Where is parcel PK-4411?' }, expect: expectBlock }],
      rules: { custom },
    }),
    'json',
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

async function verdictsOf(
  source: Spec,
  component: ReturnType<typeof completionComponents>['components'][number],
  violate: boolean,
) {
  const seen: Observed = observed('done');
  component.prepare?.(seen);
  if (violate) component.change(seen);
  const checks = replayChecks();
  const narrowed = componentSpec(source, component);
  const out = [];
  for (const check of checks) {
    const ctx = context(narrowed, component.block, seen);
    if (!check.applies(ctx)) continue;
    out.push(...(await check.evaluate(ctx)));
  }
  return out;
}

async function holds(source: Spec) {
  const inventory = completionComponents(source);
  expect(inventory.gaps).toEqual([]);
  expect(inventory.components.length).toBeGreaterThan(0);
  for (const component of inventory.components) {
    const control = (await verdictsOf(source, component, false)).filter((v) =>
      component.controlVerdicts.includes(v.id),
    );
    expect(control.length, `control ${component.id}`).toBe(component.controlVerdicts.length);
    expect(
      control.every((v) => v.outcome === 'pass'),
      `control passes ${component.id}`,
    ).toBe(true);
    const targeted = (await verdictsOf(source, component, true)).filter((v) =>
      component.verdicts.includes(v.id),
    );
    const outcome = component.violationOutcome;
    expect(targeted.length, `violation ${component.id}`).toBe(
      outcome === 'absent' ? 0 : component.verdicts.length,
    );
    if (outcome !== 'absent')
      expect(
        targeted.every((v) =>
          outcome ? v.outcome === outcome : v.outcome === 'fail' || v.outcome === 'inconclusive',
        ),
        `violation fails ${component.id}`,
      ).toBe(true);
  }
  return inventory;
}

describe('the completion oracle derives the documented execution and some_call checks', () => {
  it('derives expect.execution: every clause passes its control and fails its violation', async () => {
    for (const execution of [
      { ran_code: true },
      { ran_code: false },
      { exit_code: 2 },
      { max_commands: 3 },
      { ran_code: true, exit_code: 0, max_commands: 2 },
    ])
      await holds(spec({ execution }));
  });

  it('derives rules.custom.some_call for contains, exact, regex and one_of inputs and every count form', async () => {
    const call = (input: Record<string, unknown>, count?: unknown) => ({
      calls: [{ label: 'Bash', input, ...(count === undefined ? {} : { count }), block: 0 }],
    });
    for (const some_call of [
      call({ command: { contains: 'lookup.sh' } }),
      call({ command: { exact: 'sh lookup.sh QIX PK-4411' } }),
      call({ command: { regex: 'lookup\\.sh [A-Z]{3} ' } }, { min: 1 }),
      call({ command: { one_of: ['a.sh', 'b.sh'] } }, { min: 2, max: 3 }),
      call({ command: { contains: 'rm ' } }, { max: 0 }),
      call({}, 1),
    ])
      await holds(spec({}, { some_call }));
  });

  it('derives several entries and leaves an entry of another block alone', async () => {
    const some_call = {
      calls: [
        { label: 'Bash', input: { command: { contains: 'a.sh' } }, block: 0 },
        { label: 'Read', input: { file_path: { contains: 'notes' } } },
        { label: 'Bash', input: { command: { contains: 'b.sh' } }, block: 7 },
      ],
    };
    const inventory = await holds(spec({}, { some_call }));
    const ids = new Set(inventory.components.flatMap((c) => c.verdicts));
    expect([...ids].sort()).toEqual(['custom.some_call.0', 'custom.some_call.1']);
  });

  it('fails closed: an unknown check, an unknown option and an assertion it cannot witness stay named gaps', () => {
    expect(completionComponents(spec({}, { unknown_fixture_check: { clause: true } })).gaps).toContain(
      '0.custom.unknown_fixture_check.unsupported-check-structure',
    );
    expect(completionComponents(spec({}, { some_call: { calls: [], speed: 'fast' } })).gaps).toContain(
      '0.custom.some_call.unsupported-option:speed',
    );
    expect(
      completionComponents(
        spec({}, { some_call: { calls: [{ label: 'Bash', input: { command: { regex: '(a|b)+' } } }] } }),
      ).gaps,
    ).toContain('0.custom.some_call.0.input.command.assertion-witness');
    expect(
      completionComponents(spec({}, { some_call: { calls: [{ input: { command: 'x' } }] } })).gaps,
    ).toContain('0.custom.some_call.0.label');
  });

  it('catches a check that ignores what it asserts: a relaxed some_call passes the control and the violation', async () => {
    const source = spec(
      {},
      { some_call: { calls: [{ label: 'Bash', input: { command: { contains: 'x.sh' } }, block: 0 }] } },
    );
    const [component] = completionComponents(source).components.filter((c) => c.id.endsWith('count.min'));
    const seen = observed('done');
    component?.prepare?.(seen);
    component?.change(seen);
    // After the violation no matching call is left: a check that counts any Bash call would still pass.
    expect(seen.toolCalls.filter((c) => c.label === 'Bash')).toHaveLength(0);
  });
});

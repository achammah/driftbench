import { BUILTIN_KINDS, ObjectRegistry, ObjectStore, type Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { blame } from '../src';

/**
 * Blast radius of PR 451 on the step semantics: a diagnostic runner skips a disabled step, and the block steps
 * read which stages ran. With the chain step disabled every failing verdict is a root (`chain: false`, new in
 * diagnoseBlock); with it enabled a verdict on the tool order inherits the root whose tool was never called.
 */

/** A registry whose diagnostic kind declares the fields the diagnostic files hold, as the F5 runner will. */
function registry(): ObjectRegistry {
  const out = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) {
    out.registerKind(
      kind.kind === 'diagnostic'
        ? {
            ...kind,
            fields: {
              scope: z.enum(['block', 'campaign']).optional(),
              when: z.record(z.string(), z.unknown()).optional(),
              reads: z.array(z.string()).optional(),
              output: z.record(z.string(), z.unknown()).optional(),
              cost: z.record(z.string(), z.unknown()).optional(),
            },
          }
        : kind,
    );
  }
  return blame.registerBlameObjects(out);
}

function verdict(id: string): Verdict {
  return { id, kind: 'machine', name: 'tools', gating: true, outcome: 'fail', evidence: id };
}

const VERDICTS = [verdict('tools.coverage.check.count'), verdict('tools.order')];

const CONTEXT = {
  check: {
    observed: { segments: [], text: 'Your order is placed.', toolCalls: [], cost: {}, latencyMs: 0 },
    expect: { tools: [{ label: 'coverage.check' }, { label: 'order.create' }] },
    spec: { metadata: {} },
    block: { when: { user: 'Order the 500 Mbps plan for 88 Summit Avenue, Acmeville.' } },
  },
  verdicts: VERDICTS,
  objects: [],
  history: [],
} as unknown as Omit<blame.BlockStepContext, 'params' | 'earlier'>;

/** Runs the enabled items of code-agent-liability in order, as the runner does, skipping the ones named. */
async function liability(
  skip: readonly string[],
  emit: Readonly<Record<string, boolean>> = {},
): Promise<blame.StepOutput[]> {
  const object = new ObjectStore(registry()).resolve('diagnostic', 'code-agent-liability');
  const earlier: blame.StepOutput[] = [];
  for (const item of object.items) {
    if (skip.includes(item.id)) continue;
    const step = blame.BLOCK_STEPS[item.impl];
    if (!step) throw new Error(`no step ${item.impl}`);
    const params = item.id in emit ? { ...item.params, emit: emit[item.id] } : item.params;
    for (const one of (await step.run({ ...CONTEXT, params, earlier })) ?? []) earlier.push(one);
  }
  return earlier;
}

describe('code-agent-liability with a step disabled', () => {
  it('with every step, the tool-order verdict inherits the root whose tool was never called', async () => {
    const out = await liability([]);
    expect(out.map((one) => [one.verdictRef, one.inherits])).toEqual([
      ['tools.coverage.check.count', undefined],
      ['tools.order', 'tools.coverage.check.count'],
    ]);
    expect(out[1]?.disposition).toBe(out[0]?.disposition);
  });

  it('with the chain step disabled, every failing verdict is a root of its own', async () => {
    const out = await liability(['chain']);
    expect(out.map((one) => one.verdictRef)).toEqual(['tools.coverage.check.count', 'tools.order']);
    expect(out.every((one) => one.inherits === undefined)).toBe(true);
  });

  it('with place disabled and attribute emitting (the help topic recipe), the same roots are still written', async () => {
    const placed = await liability([]);
    const unplaced = await liability(['place'], { attribute: true });
    expect(unplaced.map((one) => one.verdictRef)).toEqual(placed.map((one) => one.verdictRef));
    expect(unplaced.every((one) => /#fixed$/.test(one.placement ?? ''))).toBe(true);
  });

  it('with place disabled and nothing else emitting, writes no diagnosis', async () => {
    expect(await liability(['place'])).toEqual([]);
  });
});

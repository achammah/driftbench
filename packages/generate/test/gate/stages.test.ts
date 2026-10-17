import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import {
  blockOutcome,
  expectedValues,
  GATE_DEFAULTS,
  leakageStage,
  observedStage,
  originGrams,
  runOnce,
  thenFields,
} from '../../src/gate';
import { sameReferenceOutcome } from '../../src/gate/gate';
import {
  gate,
  generated,
  makeSpec,
  orderBlock,
  shopAdapter,
  shopChecks,
  shopFault,
  shopFaults,
} from './support';

const STAGES = ['start', 'ordered'];
const wording = GATE_DEFAULTS.wording;

/** The verdict of one stage on the first block of one spec, through the whole gate. */
async function verdictOf(
  spec: Parameters<typeof makeSpec>[0],
  stage: Parameters<typeof pick>[1],
  extra = {},
) {
  const result = await gate([makeSpec(spec)], extra);
  return pick(result.blocks[0], stage);
}

function pick(
  record: Awaited<ReturnType<typeof gate>>['blocks'][number] | undefined,
  stage: 'observed' | 'leakage' | 'shortcut' | 'contrast' | 'red_first' | 'stability' | 'difficulty',
) {
  if (!record) throw new Error('no block');
  return record.stages[stage];
}

describe('stage 1, observed state', () => {
  it('rejects a block that holds only judged criteria', () => {
    const spec = makeSpec({
      id: 'judged',
      criteria: [{ name: 'polite', rubric: 'Is the reply polite?' }],
      blocks: [{ when: { user: 'hello' }, expect: { criteria: ['polite'] } }],
    });
    expect(observedStage(spec, 0, wording)).toMatchObject({ status: 'reject', reason: 'no-machine-then' });
  });

  it('rejects a Then that reads only the words on a cell that is not about wording', () => {
    const spec = makeSpec({ id: 'words', blocks: [{ when: { user: 'hello' }, expect: { must: ['Hi'] } }] });
    expect(thenFields(spec, 0)).toEqual(['text']);
    expect(observedStage(spec, 0, wording)).toMatchObject({ status: 'reject', reason: 'words-only' });
  });

  it('keeps a words-only Then on a cell about wording', () => {
    const spec = makeSpec({
      id: 'language',
      blocks: [
        {
          id: 'b1',
          when: { injection: { class: 'D5_language_switch', user: 'Kunt u dat in het Nederlands zeggen?' } },
          expect: { lang: 'EN' },
        },
      ],
    });
    expect(observedStage(spec, 0, wording)).toMatchObject({ status: 'pass' });
  });

  it('keeps a Then that reads a tool, a stage or the end state', () => {
    const spec = makeSpec({ id: 'tool', stages: STAGES, blocks: [orderBlock()] });
    expect(thenFields(spec, 0)).toEqual(['tools', 'stage']);
    expect(observedStage(spec, 0, wording).status).toBe('pass');
    const ended = makeSpec({
      id: 'ended',
      blocks: [{ when: { user: 'hello' }, expect: { must: ['Hi'] } }],
      end_state: 'none',
    });
    expect(thenFields(ended, 0)).toEqual(['end_state', 'text']);
    expect(observedStage(ended, 0, wording).status).toBe('pass');
  });
});

describe('stage 2, leakage', () => {
  const options = { ngram: 13, overlap: 0.5 };

  it('exempts a tool input the user supplies in the When, and rejects an end-state value there', () => {
    const supplied = makeSpec({
      id: 'when-supplied',
      blocks: [
        {
          when: { user: 'Order sku-7 for me.' },
          expect: { tools: [{ label: 'order.create', input: { sku: 'sku-7' } }] },
        },
      ],
    });
    const verdict = leakageStage(supplied, 0, options, undefined);
    expect(verdict.status).toBe('pass');
    expect(verdict.detail).toContain('value "sku-7" supplied by the user in the When, exempt');
    const ended = makeSpec({
      id: 'when-leak',
      blocks: [{ when: { user: 'Confirm order ord-42.' }, expect: { must: ['x'] } }],
      end_state: { source: 'tool:order.create', expect: { order_id: 'ord-42' } },
    });
    expect(leakageStage(ended, 0, options, undefined)).toMatchObject({
      status: 'reject',
      reason: 'expected-value-in-when',
      detail: 'the When already holds the expected end-state value "ord-42"',
    });
  });

  it('still rejects a tool input value the Given holds', () => {
    const spec = makeSpec({
      id: 'given-input',
      given: { world: { fixtures: { note: 'the sku is sku-7' } } },
      blocks: [
        {
          when: { user: 'Order the red one.' },
          expect: { tools: [{ label: 'order.create', input: { sku: 'sku-7' } }] },
        },
      ],
    });
    expect(leakageStage(spec, 0, options, undefined)).toMatchObject({
      status: 'reject',
      reason: 'expected-value-in-given',
    });
  });

  it('ignores enum words of four letters or fewer, and counts a longer word and a number', () => {
    const spec = (value: string | number) =>
      makeSpec({
        id: 'enum',
        given: { world: { fixtures: { note: 'type new, home, mobile, 42' } } },
        blocks: [
          { when: { user: 'Go.' }, expect: { tools: [{ label: 'order.create', input: { type: value } }] } },
        ],
      });
    expect(expectedValues(spec('new'), 0)).toEqual([]);
    expect(expectedValues(spec('home'), 0)).toEqual([]);
    expect(leakageStage(spec('home'), 0, options, undefined).status).toBe('pass');
    expect(leakageStage(spec('mobile'), 0, options, undefined)).toMatchObject({
      reason: 'expected-value-in-given',
    });
    expect(leakageStage(spec(42), 0, options, undefined)).toMatchObject({
      reason: 'expected-value-in-given',
    });
  });

  it('rejects an expected end-state value already in the Given', () => {
    const spec = makeSpec({
      id: 'given-leak',
      given: { world: { fixtures: { note: 'the answer is ord-42' } } },
      blocks: [{ when: { user: 'Please order the red one.' }, expect: { must: ['x'] } }],
      end_state: { source: 'tool:order.create', expect: { order_id: 'ord-42' } },
    });
    expect(leakageStage(spec, 0, options, undefined)).toMatchObject({
      status: 'reject',
      reason: 'expected-value-in-given',
    });
  });

  it('keeps a block whose expected values appear nowhere, and a value only inside a longer token', () => {
    const spec = makeSpec({ id: 'clean', stages: STAGES, blocks: [orderBlock()] });
    expect(leakageStage(spec, 0, options, undefined).status).toBe('pass');
    const longer = makeSpec({
      id: 'longer',
      blocks: [
        {
          when: { user: 'I want sku-77 please.' },
          expect: { tools: [{ label: 'order.create', input: { sku: 'sku-7' } }] },
        },
      ],
    });
    expect(leakageStage(longer, 0, options, undefined).status).toBe('pass');
  });

  it('rejects a block whose 13-grams sit in the origin specs above the threshold, and keeps one below', () => {
    const sentence = 'I would like to order the red one today because my old one broke last week';
    const origin = makeSpec({ id: 'origin', blocks: [{ when: { user: sentence } }] });
    const grams = originGrams([origin], 13);
    const copy = makeSpec({ id: 'copy', blocks: [{ when: { user: sentence }, expect: { must: ['x'] } }] });
    expect(leakageStage(copy, 0, options, grams)).toMatchObject({
      status: 'reject',
      reason: 'ngram-overlap',
    });
    const fresh = makeSpec({
      id: 'fresh',
      blocks: [
        {
          when: {
            user: 'Could you place an order for the blue model, since the shop near my house is closed',
          },
        },
      ],
    });
    expect(leakageStage(fresh, 0, options, grams).status).toBe('pass');
  });

  it('rejects a generator of the judge family, case blind, and keeps another family', () => {
    const spec = makeSpec({
      id: 'family',
      blocks: [{ when: { user: 'hello' } }],
      metadata: { generated: { by: 'test', seeder: 'twise', family: 'Acme-LM' } },
    });
    expect(leakageStage(spec, 0, { ...options, judgeFamily: 'acme-lm' }, undefined)).toMatchObject({
      status: 'reject',
      reason: 'same-family-as-judge',
    });
    expect(leakageStage(spec, 0, { ...options, judgeFamily: 'other-lm' }, undefined).status).toBe('pass');
  });
});

describe('stage 3, shortcut', () => {
  it('rejects a block the constant agent passes: a tool that must not be called', async () => {
    const verdict = await verdictOf(
      {
        id: 'never',
        blocks: [{ when: { user: 'hello' }, expect: { tools: [{ label: 'order.create', count: 0 }] } }],
      },
      'shortcut',
    );
    expect(verdict).toMatchObject({ status: 'reject', reason: 'passed-by-constant' });
  });

  it('rejects a block the first-tool stub passes: one call of the first tool, nothing else', async () => {
    const verdict = await verdictOf(
      {
        id: 'any-call',
        blocks: [
          {
            when: { user: 'Please order the red one.' },
            expect: { tools: [{ label: 'order.create', count: 1 }] },
          },
        ],
      },
      'shortcut',
    );
    expect(verdict).toMatchObject({ status: 'reject', reason: 'passed-by-first-tool' });
  });

  it('rejects a block the echo agent passes: the keyword and the stage the agent starts at', async () => {
    const verdict = await verdictOf(
      {
        id: 'echo',
        stages: STAGES,
        blocks: [{ when: { user: 'hello' }, expect: { stage: 'start', must: ['order'] } }],
      },
      'shortcut',
    );
    expect(verdict).toMatchObject({ status: 'reject', reason: 'passed-by-echo' });
  });

  it('keeps a block none of the three passes', async () => {
    const verdict = await verdictOf({ id: 'real', stages: STAGES, blocks: [orderBlock()] }, 'shortcut');
    expect(verdict.status).toBe('pass');
  });
});

describe('stage 4, contrast', () => {
  const probe = (id: string, deviation: string, user: string, stage: string) =>
    makeSpec({
      id,
      stages: STAGES,
      blocks: [
        { id: 'b1', when: { injection: { class: deviation as 'D1_off_topic', user } }, expect: { stage } },
      ],
      metadata: generated('deviation', [{ block: 'b1', cell: { deviation, stage: 'start' } }]),
    });

  it('accepts one-slot siblings with equal correct reference outcomes', async () => {
    const result = await gate([
      probe('p1', 'D1_off_topic', 'What is the weather like?', 'start'),
      probe('p2', 'D9_out_of_scope', 'My bill is wrong.', 'start'),
    ]);
    for (const record of result.blocks) {
      expect(record.stages.contrast).toMatchObject({ status: 'pass' });
    }
  });

  it('accepts below-minimum and above-maximum requests that both correctly refuse', async () => {
    const reference = functionAdapter({
      create: () => ({}),
      respond: (messages) => {
        const quantity = Number(messages.at(-1)?.content);
        const text = quantity < 2 || quantity > 8 ? `Quantity ${quantity} refused.` : 'Quantity accepted.';
        return {
          text,
          segments: [{ type: 'text' as const, text }],
          toolCalls: [],
          runtime: { stages: [{ name: 'start' }] },
          cost: { usd: 0 },
          latencyMs: 0,
        };
      },
      deterministic: true,
    });
    const siblings = [1, 9].map((quantity) =>
      makeSpec({
        id: `quantity-${quantity}`,
        stages: STAGES,
        blocks: [
          {
            id: 'b1',
            when: { user: String(quantity) },
            expect: { stage: 'start', must: ['refused'], tools: [{ label: 'order.create', count: 0 }] },
          },
        ],
        metadata: generated('boundary', [{ block: 'b1', cell: { quantity: String(quantity) } }]),
      }),
    );
    const result = await gate(siblings, { references: new Map([['function:shop', reference]]), faults: [] });
    expect(result.blocks.map((record) => record.reference[0])).toEqual(['pass', 'pass']);
    for (const record of result.blocks) expect(record.stages.contrast.status).toBe('pass');
  });

  it('rejects copied expectations when the edit changes the reference output', async () => {
    const siblings = ['red', 'blue'].map((colour) =>
      makeSpec({
        id: `order-${colour}`,
        stages: STAGES,
        blocks: [{ ...orderBlock('b1'), when: { user: `Please order the ${colour} one.` } }],
        metadata: generated('boundary', [{ block: 'b1', cell: { colour } }]),
      }),
    );
    const result = await gate(siblings);
    for (const record of result.blocks)
      expect(record.stages.contrast).toMatchObject({ status: 'reject', reason: 'then-ignores-edit' });
  });

  it('rejects an under-specified copied Then even when both reference runs pass', async () => {
    const siblings = ['red', 'blue'].map((colour) =>
      makeSpec({
        id: `loose-${colour}`,
        stages: STAGES,
        blocks: [
          {
            id: 'b1',
            when: { user: `Please order the ${colour} one.` },
            expect: { stage: 'ordered', tools: [{ label: 'order.create', count: 1 }] },
          },
        ],
        metadata: generated('boundary', [{ block: 'b1', cell: { colour } }]),
      }),
    );
    const result = await gate(siblings);
    expect(result.blocks.map((record) => record.reference[0])).toEqual(['pass', 'pass']);
    for (const record of result.blocks)
      expect(record.stages.contrast).toMatchObject({ status: 'reject', reason: 'then-ignores-edit' });
  });

  it('accepts equal Thens on the end state when every reference run recorded the same end state', async () => {
    const specs = [
      probe('p1', 'D1_off_topic', 'What is the weather like?', 'start'),
      probe('p2', 'D9_out_of_scope', 'My bill is wrong.', 'start'),
    ].map((spec) => makeSpec({ ...spec, end_state: 'none' }));
    const result = await gate(specs);
    for (const record of result.blocks) {
      expect(record.fields).toContain('end_state');
      expect(record.stages.contrast.status).toBe('pass');
    }
  });

  it('does not infer final-store equivalence from equal captured replies', async () => {
    // The reply and the calls are the same for both messages; the store the reference leaves is not.
    type Session = { notes: { tool: string; input: unknown }[] };
    const reference = functionAdapter<Session>({
      create: () => ({ notes: [] }),
      respond: (messages, _world, _vars, session) => {
        session.notes.push({ tool: 'note', input: { said: messages.at(-1)?.content } });
        const text = 'Noted.';
        return {
          text,
          segments: [{ type: 'text' as const, text }],
          toolCalls: [],
          runtime: { stages: [{ name: 'start' }] },
          cost: { usd: 0 },
          latencyMs: 0,
        };
      },
      payloads: (session) => session.notes,
      deterministic: true,
    });
    const specs = [
      probe('p1', 'D1_off_topic', 'What is the weather like?', 'start'),
      probe('p2', 'D9_out_of_scope', 'My bill is wrong.', 'start'),
    ].map((spec) =>
      makeSpec({ ...spec, end_state: { source: 'tool:note', expect: { said: { nonempty: true } } } }),
    );
    const result = await gate(specs, { references: new Map([['function:shop', reference]]), faults: [] });
    expect(result.blocks.map((record) => record.reference[0])).toEqual(['pass', 'pass']);
    for (const record of result.blocks)
      expect(record.stages.contrast).toMatchObject({ status: 'reject', reason: 'then-ignores-edit' });
  });

  it('keeps the conservative answer when a run recorded no end-state value', async () => {
    const specs = [
      probe('p1', 'D1_off_topic', 'What is the weather like?', 'start'),
      probe('p2', 'D9_out_of_scope', 'My bill is wrong.', 'start'),
    ].map((spec) => makeSpec({ ...spec, end_state: 'none' }));
    const result = await gate(specs);
    const record = result.blocks[0];
    if (!record) throw new Error('no block');
    const recorded = await Promise.all(
      specs.map((spec) =>
        runOnce(spec, shopAdapter(), 1, { checks: shopChecks(), driver: createScriptedDriver }),
      ),
    );
    const outcomes = recorded.map((run) => ({ run, index: 0 }));
    expect(sameReferenceOutcome(outcomes, record.fields)).toBe(true);
    // The same runs as stored before the value was recorded: the match and the diff only.
    const older = outcomes.map(({ run, index }) => {
      const { endStateValue: _value, ...kept } = run;
      return { run: kept, index };
    });
    expect(sameReferenceOutcome(older, record.fields)).toBe(false);
  });

  it('keeps one-slot siblings whose Then changes with the edit', async () => {
    const result = await gate([
      probe('p1', 'D1_off_topic', 'What is the weather like?', 'start'),
      probe('p2', 'D9_out_of_scope', 'My bill is wrong.', 'ordered'),
    ]);
    for (const record of result.blocks) expect(record.stages.contrast.status).toBe('pass');
  });

  const twin = (id: string, user: string, expectStage: string, variant: number) =>
    makeSpec({
      id,
      stages: STAGES,
      blocks: [
        {
          id: 'b1',
          when: { user },
          expect: { stage: expectStage, tools: [{ label: 'order.create', count: 1 }] },
        },
      ],
      metadata: generated('metamorphic', [{ block: 'b1', cell: { flow: 'order' } }], {
        metamorphic: { family: 'fam-1', variant, of: 2, relation: 'same observed outcome' },
      }),
    });

  it('rejects twins that expect different things', async () => {
    const result = await gate([
      twin('t1', 'Please order the red one.', 'ordered', 1),
      twin('t2', 'Could you order the red one?', 'start', 2),
    ]);
    expect(result.blocks[0]?.stages.contrast).toMatchObject({ status: 'reject', reason: 'twins-disagree' });
  });

  it('rejects twins whose Thens differ even when both pass on the reference', async () => {
    const loose = makeSpec({
      ...twin('t2', 'Kindly order the red one.', 'ordered', 2),
      blocks: [
        {
          id: 'b1',
          when: { user: 'Kindly order the red one.' },
          expect: { stage: 'ordered', tools: [{ label: 'order.create', count: { min: 1 } }] },
        },
      ],
    });
    const result = await gate([twin('t1', 'Please order the red one.', 'ordered', 1), loose]);
    expect(result.blocks.map((record) => record.reference[0])).toEqual(['pass', 'pass']);
    expect(result.blocks[0]?.stages.contrast).toMatchObject({
      status: 'reject',
      reason: 'twins-disagree',
      detail: 'its twin t2#b1 expects something else',
    });
  });

  it('rejects twins that expect the same and come out differently on the reference', async () => {
    const result = await gate([
      twin('t1', 'Please order the red one.', 'ordered', 1),
      twin('t2', 'Could you get me the red one?', 'ordered', 2),
    ]);
    expect(result.blocks[0]?.stages.contrast).toMatchObject({ status: 'reject', reason: 'twins-disagree' });
    expect(result.blocks[0]?.stages.contrast.detail).toContain('on the reference');
  });

  it('keeps twins that agree', async () => {
    const result = await gate([
      twin('t1', 'Please order the red one.', 'ordered', 1),
      twin('t2', 'Kindly order the red one.', 'ordered', 2),
    ]);
    for (const record of result.blocks) expect(record.stages.contrast.status).toBe('pass');
  });
});

describe('stage 5, red first', () => {
  it('keeps a block green on the reference and red on a fault it targets', async () => {
    const result = await gate([makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] })]);
    const record = result.blocks[0];
    expect(record?.stages.red_first).toMatchObject({ status: 'pass' });
    expect(record?.stages.red_first.detail).toContain('wrong-sku');
    expect(record?.status).toBe('accepted');
  });

  it('rejects a block the reference does not pass', async () => {
    const spec = makeSpec({
      id: 'wrong',
      stages: STAGES,
      blocks: [
        {
          ...orderBlock(),
          expect: { stage: 'ordered', tools: [{ label: 'order.create', input: { sku: 'sku-9' } }] },
        },
      ],
    });
    const result = await gate([spec]);
    expect(result.blocks[0]?.stages.red_first).toMatchObject({
      status: 'reject',
      reason: 'not-green-on-reference',
    });
  });

  it('rejects a block no gating verdict of its Then decided on the reference', async () => {
    const spec = makeSpec({
      id: 'unjudged',
      blocks: [
        {
          id: 'b1',
          when: { injection: { class: 'D5_language_switch', user: 'xyz' } },
          expect: { lang: 'EN' },
        },
      ],
    });
    const result = await gate([spec]);
    expect(result.blocks[0]?.reference[0]).toBe('unjudged');
    expect(result.blocks[0]?.stages.red_first).toMatchObject({
      status: 'reject',
      reason: 'not-green-on-reference',
      detail: 'no gating machine verdict decided it on the reference',
    });
  });

  it('rejects a block a negative control turns red', async () => {
    const result = await gate([makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] })], {
      faults: [
        ...shopFaults().filter((fault) => fault.def.kind !== 'control'),
        shopFault('bad-control', 'control', 'control', [], { sku: () => 'sku-0' }),
      ],
    });
    expect(result.blocks[0]?.stages.red_first).toMatchObject({ status: 'reject', reason: 'red-on-control' });
  });

  it('rejects a block no non-equivalent fault targets', async () => {
    const result = await gate([makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] })], {
      faults: [shopFault('noop', 'drift', 'X5_tool', ['tools'], {})],
    });
    expect(result.blocks[0]?.stages.red_first).toMatchObject({
      status: 'reject',
      reason: 'targets-no-fault',
    });
    expect(result.faults[0]).toMatchObject({ id: 'noop', equivalent: true, changedOn: 0 });
  });

  it('rejects a block green on every fault it targets', async () => {
    const result = await gate([makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] })], {
      faults: [shopFault('louder', 'drift', 'X4_format', ['tools'], { reply: (text) => `${text}!` })],
    });
    expect(result.blocks[0]?.stages.red_first).toMatchObject({ status: 'reject', reason: 'kills-no-fault' });
  });

  it('counts a fault as targeted through its deviation class too', async () => {
    const spec = makeSpec({
      id: 'deviation',
      stages: STAGES,
      blocks: [
        {
          id: 'b1',
          when: { injection: { class: 'D4_loose_confirmation', user: 'ok, order the red one' } },
          expect: { stage: 'ordered', tools: [{ label: 'order.create', count: 1, input: { sku: 'sku-7' } }] },
        },
      ],
    });
    const result = await gate([spec], {
      faults: [shopFault('loose', 'deviation', 'D4_loose_confirmation', [], { sku: () => 'sku-0' })],
    });
    expect(result.blocks[0]?.stages.red_first).toMatchObject({ status: 'pass' });
  });
});

describe('stages 6 and 7, stability and difficulty', () => {
  it('sends a block whose outcome flips between repeats to review', async () => {
    let call = 0;
    const flaky = shopAdapter({ stage: (_call, stage) => (call++ % 2 === 0 ? stage : 'start') });
    const result = await gate([makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] })], {
      references: new Map([['function:shop', flaky]]),
      options: { k: 4 },
    });
    const record = result.blocks[0];
    expect(record?.stages.stability).toMatchObject({ status: 'reject', reason: 'flips' });
    expect(record?.reference).toHaveLength(4);
  });

  it('records pass^k from the k repeats on a stable block', async () => {
    const result = await gate([makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] })], {
      options: { k: 5 },
    });
    expect(result.blocks[0]?.stages.stability).toMatchObject({
      status: 'pass',
      detail: '5 of 5 repeats pass',
    });
    expect(result.blocks[0]?.passK).toBe(1);
  });

  it('marks a block every agent passes as saturated, and leaves a discriminating one unmarked', async () => {
    const result = await gate([
      makeSpec({
        id: 'never',
        rules: { forbidden_tools: ['refund.issue'] },
        blocks: [{ when: { user: 'hello' } }],
      }),
      makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] }),
    ]);
    expect(result.blocks[0]?.stages.difficulty).toMatchObject({ status: 'mark', reason: 'saturated' });
    expect(result.blocks[0]?.passProbability).toBe(1);
    expect(result.blocks[1]?.stages.difficulty.status).toBe('pass');
    expect(result.blocks[1]?.passProbability).toBeGreaterThan(0);
    expect(result.blocks[1]?.passProbability).toBeLessThan(1);
  });
});

describe('stages 8 and 9, label audit and freshness', () => {
  const many = () =>
    ['a', 'b', 'c', 'd', 'e'].map((id) =>
      makeSpec({ id: `order-${id}`, stages: STAGES, blocks: [orderBlock()] }),
    );

  it('samples the configured number of accepted blocks per family, the same for the same seed', async () => {
    const first = await gate(many(), { options: { auditPerFamily: 2, seed: 7 } });
    const sampled = first.blocks.filter((record) => record.stages.label_audit.status === 'mark');
    expect(sampled).toHaveLength(2);
    const again = await gate(many(), { options: { auditPerFamily: 2, seed: 7 } });
    expect(
      again.blocks
        .filter((record) => record.stages.label_audit.status === 'mark')
        .map((record) => record.key),
    ).toEqual(sampled.map((record) => record.key));
  });

  it('seals whole specs in the holdout by the share, and stamps the date and the map hash', async () => {
    const all = await gate(many(), { options: { holdoutShare: 1 } });
    expect(all.blocks.every((record) => record.split === 'holdout')).toBe(true);
    const none = await gate(many(), { options: { holdoutShare: 0 } });
    expect(none.blocks.every((record) => record.split === 'dev')).toBe(true);
    expect(none.blocks[0]).toMatchObject({ created: '2026-10-11' });
    const mapped = await gate(
      [
        makeSpec({
          id: 'mapped',
          stages: STAGES,
          blocks: [orderBlock('b1')],
          metadata: generated('twise', [{ block: 'b1', cell: { flow: 'order' } }]),
        }),
      ],
      { options: { holdoutShare: 0 } },
    );
    expect(mapped.blocks[0]).toMatchObject({ mapHash: 'map-hash-1', split: 'dev' });
  });
});

describe('the funnel and the outcome', () => {
  it('counts each block once, at the first stage that rejects it', async () => {
    const result = await gate([
      makeSpec({
        id: 'judged',
        criteria: [{ name: 'polite', rubric: 'Polite?' }],
        blocks: [{ when: { user: 'hello' }, expect: { criteria: ['polite'] } }],
      }),
      makeSpec({
        id: 'never',
        blocks: [{ when: { user: 'hello' }, expect: { tools: [{ label: 'order.create', count: 0 }] } }],
      }),
      makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] }),
    ]);
    const rows = Object.fromEntries(result.funnel.map((row) => [row.stage, row]));
    expect(rows.observed).toMatchObject({ entered: 3, rejected: 1, passed: 2 });
    expect(rows.shortcut).toMatchObject({ entered: 2, rejected: 1, passed: 1 });
    expect(rows.freshness).toMatchObject({ entered: 1, rejected: 0, passed: 1 });
    for (const row of result.funnel) expect(row.passed).toBe(row.entered - row.rejected);
  });

  it('reads only the Then: a block that only hygiene checks decided is unjudged', () => {
    const run = {
      blocks: [
        {
          index: 0,
          verdicts: [
            {
              id: 'pii.email',
              kind: 'machine',
              name: 'pii',
              gating: true,
              outcome: 'pass',
              evidence: 'none',
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof blockOutcome>[0];
    expect(blockOutcome(run, 0)).toBe('unjudged');
  });

  it('scores each fault class over the gated suite, and keeps the control out of the score', async () => {
    const result = await gate([makeSpec({ id: 'order', stages: STAGES, blocks: [orderBlock()] })]);
    const classes = Object.fromEntries(result.classes.map((entry) => [entry.class, entry]));
    expect(classes.X1_local).toMatchObject({ scored: 1, killed: 1 });
    expect(classes.X5_tool).toMatchObject({ scored: 1, killed: 1 });
    expect(classes.X3_flow).toMatchObject({ faults: 1, scored: 0 });
    expect(classes.control).toMatchObject({ scored: 0 });
    const control = result.faults.find((fault) => fault.id === 'control');
    expect(control?.suite).toMatchObject({ targeting: 1, red: 0 });
  });
});

import { canonicalJson, type LoadedSpec, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { SeedData } from '../../src/ladders/generator/bank';
import { researchItems } from '../../src/ladders/generator/bank2';
import { type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import type { Generation } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing structural obligation fixture');
  return value;
}
const key = (...parts: unknown[]) => `research:${canonicalJson(parts)}`;

function specimen(id: string, blocks: Spec['blocks'], cell: Record<string, string> = {}): LoadedSpec {
  const spec = Spec.parse({
    id,
    title: 'Path new-request-full of parcel: inspect before dispatch',
    kind: 'conversation',
    channel: 'web',
    tags: ['persona:sender'],
    metadata: { generated: { cell } },
    blocks,
  });
  return { ok: true, path: `complete/${id}.yaml`, spec, hash: '', warnings: [] };
}
function fixture(complete: LoadedSpec[]): Generation {
  const hidden: HiddenSpec = {
    ...hiddenSpec(1237),
    start: 'opening',
    stages: ['opening', 'check', 'done'].map((id) => ({ id, title: id, question: `${id}?` })),
    paths: [
      {
        id: 'new-request-full',
        flow: 'parcel',
        stages: ['opening', 'check', 'done'],
        when: {},
        quote: 'Inspect before dispatch.',
      },
    ],
    flows: [{ id: 'parcel', title: 'Parcel', behaviours: [], deviations: ['D1_off_topic'] }],
    transitions: [
      { id: 'inspect', from: 'opening', to: 'check', title: 'Inspect', rule: 'Inspect the parcel.' },
      { id: 'dispatch', from: 'check', to: 'done', title: 'Dispatch', rule: 'Dispatch the parcel.' },
    ],
    deviations: ['D1_off_topic'],
    constraints: [],
    behaviours: [],
    tools: [],
    data: [],
    uses: [],
    recoveries: [
      { class: 'D1_off_topic', flows: ['parcel'], stageAfter: 'pending', quote: 'Return to the parcel.' },
    ],
    phrases: [
      {
        dimension: 'deviation',
        value: 'D1_off_topic',
        text: 'Tell me about the weather.',
        lang: 'en',
        intent: { kind: 'deviation', class: 'D1_off_topic' },
      },
    ],
    channels: ['web'],
    personas: [{ id: 'sender', title: 'Sender' }],
  };
  return { hidden, generatorSeed: 1237, first: new Map(), second: new Map(), loaded: complete, complete };
}
/** Collect from the ordinary item predicates, including positives in an otherwise failing item. */
async function snapshot(generated: Generation, ids: string[], record = true) {
  const data = new SeedData(generated.hidden.seed, {}, async () => {
    throw new Error('no scale measurement');
  });
  vi.spyOn(data, 'generated').mockResolvedValue(generated);
  const obligations = new Set<string>();
  data.obligation = (id, holds) => {
    if (record && holds) obligations.add(id);
    return holds;
  };
  const verdicts = new Map<string, boolean>();
  for (const id of ids)
    verdicts.set(id, (await required(researchItems().find((item) => item.id === id)).check(data)).pass);
  return { obligations, verdicts };
}

const move = (stage: string): Spec['blocks'][number] => ({
  when: { user: `Parcel checkpoint ${stage}.` },
  expect: { stage },
});

describe('minimality retains structural obligations from the coverage predicates', () => {
  it('recording preserves every research-item verdict', async () => {
    const generated = fixture([specimen('walk', [move('check'), move('done')])]);
    const ids = researchItems().map((item) => item.id);
    expect((await snapshot(generated, ids)).verdicts).toEqual(
      (await snapshot(generated, ids, false)).verdicts,
    );
  });
  it('retains the sole ordered edge-pair witness', async () => {
    const generated = fixture([specimen('walk', [move('check'), move('done')])]);
    const before = await snapshot(generated, ['sequence.through.check']);
    expect(before.obligations.has(key('sequence', 'edge-pair', 'opening>check>done'))).toBe(true);
    generated.complete[0]?.spec.blocks.splice(0, 1);
    const after = await snapshot(generated, ['sequence.through.check']);
    expect(after.obligations.has(key('sequence', 'edge-pair', 'opening>check>done'))).toBe(false);
    expect(before.verdicts.get('sequence.through.check')).toBe(true);
    expect(after.verdicts.get('sequence.through.check')).toBe(false);
  });

  it('retains the sole class arrival-stage and continuation witnesses', async () => {
    const generated = fixture([
      specimen('recovery', [
        move('check'),
        {
          when: { injection: { class: 'D1_off_topic', user: 'Tell me about the weather.' } },
          expect: { stage: 'check' },
        },
        move('done'),
      ]),
    ]);
    const ids = ['sequence.stages.D1_off_topic', 'sequence.after.D1_off_topic'];
    const before = await snapshot(generated, ids);
    expect(before.obligations.has(key('sequence', 'D1_off_topic', 'stage', 'check'))).toBe(true);
    expect(before.obligations.has(key('sequence', 'D1_off_topic', 'continued'))).toBe(true);
    const noArrival = structuredClone(generated);
    required(noArrival.complete[0]).spec.blocks.splice(0, 1);
    expect(
      (await snapshot(noArrival, ids)).obligations.has(key('sequence', 'D1_off_topic', 'stage', 'check')),
    ).toBe(false);
    required(generated.complete[0]).spec.blocks.pop();
    expect(
      (await snapshot(generated, ids)).obligations.has(key('sequence', 'D1_off_topic', 'continued')),
    ).toBe(false);
  });

  it('retains satisfied path values even when a sibling value is already missing', async () => {
    const generated = fixture([specimen('value', [move('check')], { parcel: 'red' })]);
    required(generated.hidden.paths[0]).when = { parcel: ['red', 'blue'] };
    const ids = ['paths.new-request-full.values', 'paths.all-walked'];
    const before = await snapshot(generated, ids);
    expect(before.verdicts.get('paths.new-request-full.values')).toBe(false);
    expect(before.obligations.has(key('path', 'new-request-full', 'value', 'parcel', 'red'))).toBe(true);
    generated.complete = [];
    const after = await snapshot(generated, ids);
    expect(after.obligations.has(key('path', 'new-request-full', 'value', 'parcel', 'red'))).toBe(false);
    expect(after.obligations.has(key('path', 'new-request-full', 'walked'))).toBe(false);
  });

  it('retains the sole input-contrast witness', async () => {
    const dimension = 'inspect.in.quantity';
    const call = (quantity: number): Spec['blocks'][number] => ({
      when: { user: `Inspect ${quantity} parcels.` },
      expect: { tools: [{ label: 'inspect', count: 1, input: { quantity } }] },
    });
    const generated = fixture([
      specimen('low', [move('check'), call(1)], { [dimension]: `${dimension}.at-minimum` }),
      specimen('high', [move('check'), call(2)], { [dimension]: `${dimension}.above-minimum` }),
    ]);
    generated.hidden.tools = [
      {
        name: 'inspect',
        role: 'read',
        sideEffect: false,
        slot: 'inspect_kind',
        title: 'Inspect parcels',
        stage: 'check',
        input: [
          { name: 'kind', type: 'enum', members: ['a', 'b', 'c'] },
          { name: 'quantity', type: 'integer', minimum: 1, maximum: 9 },
        ],
        output: [],
      },
    ];
    // The measured block is the one whose approved data request asks for the partition's value.
    const requested = [
      ['at-minimum', 1],
      ['above-minimum', 2],
    ] as const;
    generated.hidden.data = requested.map(([partition, value]) => ({
      dimension,
      id: `${dimension}.${partition}`,
      tool: 'inspect',
      direction: 'in' as const,
      field: 'quantity',
      partition,
      title: `quantity ${partition}`,
      value,
      invalid: false,
      quote: 'minimum: 1',
    }));
    generated.hidden.phrases = [
      ...generated.hidden.phrases,
      ...requested.map(([partition, value]) => ({
        dimension,
        value: `${dimension}.${partition}`,
        text: `Inspect ${value} parcels.`,
        lang: 'en',
        intent: { kind: 'data' as const, value: `${dimension}.${partition}` },
      })),
    ];
    const ids = ['contrast.read.integer.at-minimum-above-minimum'];
    expect(
      (await snapshot(generated, ids)).obligations.has(
        key('contrast', 'read', 'integer', 'at-minimum', 'above-minimum'),
      ),
    ).toBe(true);
    required(generated.complete[0]).spec.blocks.pop();
    expect(
      (await snapshot(generated, ids)).obligations.has(
        key('contrast', 'read', 'integer', 'at-minimum', 'above-minimum'),
      ),
    ).toBe(false);
  });

  it('a duplicate witness can disappear without losing any structural obligation', async () => {
    const first = specimen('first', [move('check'), move('done')]);
    const second = structuredClone(first);
    second.spec.id = 'second';
    const generated = fixture([first, second]);
    const ids = [
      'sequence.through.check',
      'paths.all-walked',
      'paths.new-request-full.channels',
      'allocation.stage.present',
    ];
    const before = await snapshot(generated, ids);
    generated.complete = [second];
    expect((await snapshot(generated, ids)).obligations).toEqual(before.obligations);
  });
});

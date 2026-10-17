import { describe, expect, it } from 'vitest';
import { type Exercise, ensureBehavioursExercisable } from '../../src/ladders/generator/behaviour-exercise';
import { type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';

type World = Pick<HiddenSpec, 'behaviours' | 'flows' | 'uses'>;

const use = (flow: string, tool: string): HiddenSpec['uses'][number] => ({
  flow,
  tool,
  from: 'a',
  to: 'b',
  input: {},
  quote: tool,
});

/** A hand-written depot: three routes, two tools, two classes. None of its names is in the bank. */
function depot(): World {
  return {
    behaviours: ['crate', 'label', 'weigh', 'greet'].map((id) => ({ id, title: `Behaviour ${id}` })),
    flows: [
      { id: 'inbound', title: 'Inbound', behaviours: ['weigh', 'greet'], deviations: ['D1_off_topic'] },
      { id: 'outbound', title: 'Outbound', behaviours: ['crate'], deviations: ['D4_loose_confirmation'] },
      { id: 'returns', title: 'Returns', behaviours: ['label'], deviations: [] },
    ],
    uses: [use('inbound', 'scale'), use('outbound', 'stamp'), use('outbound', 'scale')],
  };
}
const owners = (world: World, id: string) =>
  world.flows.filter((flow) => flow.behaviours.includes(id)).map((flow) => flow.id);

describe('a behaviour has an owner that can exercise it', () => {
  it('adds one owner that calls the tool, and keeps every drawn owner', () => {
    const world = depot();
    ensureBehavioursExercisable(world, new Map<string, Exercise>([['label', { tool: 'stamp' }]]));
    expect(owners(world, 'label')).toEqual(['outbound', 'returns']);
    expect(world.flows.map((flow) => flow.behaviours)).toEqual([
      ['weigh', 'greet'],
      ['crate', 'label'],
      ['label'],
    ]);
  });

  it('adds one owner that recovers the class', () => {
    const world = depot();
    ensureBehavioursExercisable(
      world,
      new Map<string, Exercise>([['weigh', { deviation: 'D4_loose_confirmation' }]]),
    );
    expect(owners(world, 'weigh')).toEqual(['inbound', 'outbound']);
  });

  it('needs the tool and the class together in one flow', () => {
    const world = depot();
    world.flows[2]?.deviations.push('D1_off_topic');
    world.uses.push(use('returns', 'stamp'));
    const need = { tool: 'scale', deviation: 'D1_off_topic' } as const;
    ensureBehavioursExercisable(world, new Map<string, Exercise>([['crate', need]]));
    // inbound calls scale and recovers D1; returns recovers D1 but never calls scale; outbound calls scale only.
    expect(owners(world, 'crate')).toEqual(['inbound', 'outbound']);
  });

  it('adds nothing where an owner already can, and is idempotent', () => {
    const world = depot();
    const needs = new Map<string, Exercise>([
      ['weigh', { tool: 'scale' }],
      ['crate', { deviation: 'D4_loose_confirmation' }],
      ['greet', {}],
    ]);
    const before = structuredClone(world.flows);
    ensureBehavioursExercisable(world, needs);
    expect(world.flows).toEqual(before);
    ensureBehavioursExercisable(world, needs);
    expect(world.flows).toEqual(before);
  });

  it('changes nothing where no flow can, and never throws', () => {
    const world = depot();
    const before = structuredClone(world.flows);
    ensureBehavioursExercisable(
      world,
      new Map<string, Exercise>([
        ['label', { tool: 'unused' }],
        ['weigh', { deviation: 'D9_out_of_scope' }],
      ]),
    );
    expect(world.flows).toEqual(before);
  });

  it('adds the first able flow in the specification order', () => {
    const world = depot();
    world.flows[2]?.deviations.push('D4_loose_confirmation');
    ensureBehavioursExercisable(
      world,
      new Map<string, Exercise>([['greet', { deviation: 'D4_loose_confirmation' }]]),
    );
    expect(owners(world, 'greet')).toEqual(['inbound', 'outbound']);
  });
});

/** The independent oracle: the requirement of each bank behaviour, read from its title and the hidden facts. */
function need(title: string): Exercise {
  const tool = /with (lookup_record|submit_request|list_options)/.exec(title)?.[1];
  if (tool) return { tool };
  if (title.startsWith('Answer an off-topic')) return { deviation: 'D1_off_topic' };
  if (title.startsWith('Treat a loose yes')) return { deviation: 'D4_loose_confirmation' };
  if (title.startsWith('Report a failed tool')) return { deviation: 'D8_tool_failure' };
  if (title.startsWith('Treat an instruction')) return { deviation: 'D6_instruction_in_data' };
  return {};
}

describe('drawn hidden specifications give every behaviour an owner that can exercise it', () => {
  const seeds = [...Array.from({ length: 20 }, (_, index) => index + 1), 1009, 2027, 4093, 8191];
  it('holds on the public and the fresh seeds, wherever any flow can', () => {
    const unreachable: string[] = [];
    for (const seed of seeds) {
      const hidden = hiddenSpec(seed);
      for (const behaviour of hidden.behaviours) {
        const wanted = need(behaviour.title);
        const can = (flow: HiddenSpec['flows'][number]) =>
          (wanted.tool === undefined ||
            hidden.uses.some((entry) => entry.flow === flow.id && entry.tool === wanted.tool)) &&
          (wanted.deviation === undefined || flow.deviations.includes(wanted.deviation));
        if (!hidden.flows.some(can)) continue;
        if (!hidden.flows.some((flow) => flow.behaviours.includes(behaviour.id) && can(flow)))
          unreachable.push(`${seed} ${behaviour.id}`);
      }
    }
    expect(unreachable).toEqual([]);
  });
});

describe('a behaviour that names a tool is drawn only where some flow can call the tool', () => {
  // Seeds whose five-stage map leaves list_options without a stage: the base draw owes an impossible item.
  const stageless = [6, 17, 18, 19, 2027];
  const fresh = [1009, 4093, 8191, 12289, 24593];
  const seeds = [...stageless, ...fresh, ...Array.from({ length: 20 }, (_, index) => index + 1)];

  it('names no tool that no flow calls, on the seeds that owed an impossible item and on others', () => {
    const bad: string[] = [];
    for (const seed of seeds) {
      const hidden = hiddenSpec(seed);
      for (const behaviour of hidden.behaviours) {
        if (!behaviour.tool) continue;
        if (!hidden.uses.some((entry) => entry.tool === behaviour.tool)) bad.push(`${seed} ${behaviour.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps the number of behaviours the seed draws', () => {
    for (const seed of stageless) {
      const hidden = hiddenSpec(seed);
      expect(hidden.behaviours.length).toBeGreaterThanOrEqual(4);
      expect(hidden.behaviours.length).toBeLessThanOrEqual(6);
    }
  });

  it('leaves a seed whose map stages every tool exactly as drawn', () => {
    // Seed 1 has seven stages: every tool has a stage, so nothing is filtered and the fixture is unchanged.
    const hidden = hiddenSpec(1);
    expect(hidden.tools.every((tool) => tool.stage !== undefined)).toBe(true);
  });
});

import { type LoadedSpec, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { type BankItem, bankItems, SeedData } from '../../src/ladders/generator/bank';
import { type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import type { Generation } from '../../src/ladders/generator/measure';
import { impossiblePairs, jointlyPossible, jointWitness } from '../../src/ladders/generator/possible';
import { hiddenProposal, hiddenSpaceMap } from '../../src/ladders/generator/render';
import { forkDesk, parcelDesk, readDesk } from './fixtures/joint-worlds';

type Cell = Record<string, string>;
type Probe = { behaviour: string; deviation: string; stage: string };

const TRIPLE = 'cover.triple.behaviour.deviation.stage';

/** A fresh copy of a fixture world with an edit applied before its first query (the oracle memoises per spec). */
function edited(make: () => HiddenSpec, edit: (world: HiddenSpec) => void): HiddenSpec {
  const world = make();
  edit(world);
  return world;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

function item(id: string): BankItem {
  return required(bankItems().find((entry) => entry.id === id));
}

/** One complete spec that places the probe: reach the stage, then probe the class there. */
function probeSpec(hidden: HiddenSpec, index: number, probe: Probe, seeder = 'cover'): LoadedSpec {
  const reach = { id: 'reach', when: { user: 'Hello.' }, expect: { stage: probe.stage } };
  const clean = probe.deviation === 'none';
  const deviation = {
    id: 'probe',
    when: { injection: { class: probe.deviation, user: 'Something else.' } },
    expect: { stage: probe.stage },
  };
  const blocks = clean ? [reach] : probe.stage === hidden.start ? [deviation] : [reach, deviation];
  const spec = Spec.parse({
    id: `probe-${index}`,
    kind: 'conversation',
    covers: [probe.behaviour],
    channel: hidden.channels[0],
    tags: [`persona:${required(hidden.personas[0]).id}`],
    blocks,
    metadata: {
      generated: { seeder, cell: { behaviour: probe.behaviour, channel: required(hidden.channels[0]) } },
    },
  });
  return { ok: true, path: `complete/probe-${index}.yaml`, spec, hash: '', warnings: [] };
}

function suite(hidden: HiddenSpec, probes: Probe[], seeder = 'cover'): Generation {
  const complete = probes.map((probe, index) => probeSpec(hidden, index, probe, seeder));
  return { hidden, generatorSeed: 1, first: new Map(), second: new Map(), loaded: complete, complete };
}

function dataFor(value: Generation): SeedData {
  const data = new SeedData(1, { cheaters: [], faults: () => [], k: 1 }, async () => {
    throw new Error('feasibility must not measure scale');
  });
  vi.spyOn(data, 'generated').mockResolvedValue(value);
  vi.spyOn(data, 'runs').mockRejectedValue(new Error('feasibility must not run agents'));
  return data;
}

/** Every behaviour x deviation x stage triple of a hidden spec that its map allows, with its joint verdict. */
function triplesOf(hidden: HiddenSpec): Array<Probe & { possible: boolean }> {
  const map = hiddenSpaceMap(hidden);
  const values = (id: string) =>
    required(map.dimensions.find((entry) => entry.id === id)).values.map((v) => v.id);
  const out: Array<Probe & { possible: boolean }> = [];
  for (const behaviour of values('behaviour'))
    for (const deviation of values('deviation'))
      for (const stage of values('stage')) {
        const cell = { behaviour, deviation, stage };
        const barred = map.constraints.some((constraint) =>
          Object.entries(constraint.forbid).every(([axis, value]) => (cell as Cell)[axis] === value),
        );
        if (!barred) out.push({ ...cell, possible: jointlyPossible(hidden, cell) });
      }
  return out;
}

const text = (probe: Probe) =>
  `behaviour=${probe.behaviour}+deviation=${probe.deviation}+stage=${probe.stage}`;

/** The feasible triples of the parcel desk, listed by hand from its three paths. */
const PARCEL_FEASIBLE: Probe[] = [
  { behaviour: 'B-1', deviation: 'none', stage: 'sorting' },
  { behaviour: 'B-1', deviation: 'none', stage: 'acceptance' },
  { behaviour: 'B-1', deviation: 'none', stage: 'end' },
  { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'open' },
  { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'acceptance' },
  { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'end' },
  { behaviour: 'B-2', deviation: 'none', stage: 'sorting' },
  { behaviour: 'B-2', deviation: 'none', stage: 'end' },
  { behaviour: 'B-2', deviation: 'D9_out_of_scope', stage: 'open' },
  { behaviour: 'B-2', deviation: 'D9_out_of_scope', stage: 'sorting' },
  { behaviour: 'B-2', deviation: 'D9_out_of_scope', stage: 'end' },
];
/** B-1 reaches D9 only through posting, which never visits sorting: each pair has a position, the three none. */
const PARCEL_GAP: Probe = { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'sorting' };

describe('the joint witness on the parcel desk', () => {
  const desk = parcelDesk();

  it('finds a position for every pair of the gap triple and none for the triple', () => {
    expect(jointlyPossible(desk, { behaviour: 'B-1', deviation: 'D9_out_of_scope' })).toBe(true);
    expect(jointlyPossible(desk, { deviation: 'D9_out_of_scope', stage: 'sorting' })).toBe(true);
    expect(jointlyPossible(desk, { behaviour: 'B-1', stage: 'sorting' })).toBe(true);
    expect(jointlyPossible(desk, PARCEL_GAP)).toBe(false);
  });

  it('lets the pairwise filter pass the gap triple, so only a joint check can drop it', () => {
    const forbids = impossiblePairs(desk).map((entry) => entry.forbid);
    expect(forbids).toHaveLength(2);
    expect(forbids).toEqual(
      expect.arrayContaining([
        { behaviour: 'B-2', stage: 'acceptance' },
        { deviation: 'none', stage: 'open' },
      ]),
    );
  });

  it('names the one event that carries a feasible triple, with the flow it completes to', () => {
    const found = jointWitness(desk, { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'acceptance' });
    expect(found?.event.path.id).toBe('post-path');
    expect(found?.event.index).toBe(1);
    expect(found?.context.flow).toBe('posting');
    expect(jointWitness(desk, PARCEL_GAP)).toBeUndefined();
  });

  it('accepts exactly the hand-listed feasible triples among the triples the map allows', () => {
    const verdicts = triplesOf(desk);
    expect(
      verdicts
        .filter((entry) => entry.possible)
        .map(text)
        .sort(),
    ).toEqual(PARCEL_FEASIBLE.map(text).sort());
    expect(verdicts.filter((entry) => !entry.possible).map(text)).toEqual([text(PARCEL_GAP)]);
  });

  it('holds a named flow to the flow of the witnessing path', () => {
    const cell = { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'acceptance' };
    expect(jointlyPossible(desk, { ...cell, flow: 'posting' })).toBe(true);
    expect(jointlyPossible(desk, { ...cell, flow: 'tracing' })).toBe(false);
    expect(jointlyPossible(desk, { ...cell, flow: 'status' })).toBe(false);
  });

  it('keeps every written constraint on the completed context, not only on the named values', () => {
    const cell = { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'acceptance' };
    const phoneBarred = {
      forbid: { deviation: 'D9_out_of_scope', channel: 'phone' },
      reason: 'r',
      source: 'prompt' as const,
      quote: 'q',
    };
    const senderBarred = {
      forbid: { user_type: 'sender', channel: 'web' },
      reason: 'r',
      source: 'prompt' as const,
      quote: 'q',
    };
    const one = edited(parcelDesk, (world) => {
      world.constraints = [phoneBarred];
    });
    expect(jointlyPossible(one, { ...cell, channel: 'phone' })).toBe(false);
    expect(jointlyPossible(one, { ...cell, channel: 'web' })).toBe(true);
    // The cell leaves the channel open: web completes it.
    expect(jointlyPossible(one, cell)).toBe(true);
    // Once the only persona is barred from web as well, no channel completes the cell.
    const both = edited(parcelDesk, (world) => {
      world.constraints = [phoneBarred, senderBarred];
    });
    expect(jointlyPossible(both, cell)).toBe(false);
    expect(jointlyPossible(both, { ...cell, user_type: 'sender' })).toBe(false);
  });

  it('keeps the channels the inventory lists for a behaviour', () => {
    const cell = { behaviour: 'B-1', deviation: 'D9_out_of_scope', stage: 'acceptance' };
    const open = parcelDesk();
    expect(jointlyPossible(open, { ...cell, channel: 'phone' })).toBe(true);
    const webOnly = edited(parcelDesk, (world) => {
      required(world.behaviours[0]).channels = ['web'];
    });
    expect(jointlyPossible(webOnly, { ...cell, channel: 'phone' })).toBe(false);
    expect(jointlyPossible(webOnly, { ...cell, channel: 'web' })).toBe(true);
  });

  it('keeps the first-turn and terminal rules of a class the flow recovers', () => {
    // A class a first message cannot carry is never said at the start; a recovery that moves on cannot hold
    // a turn after the last stage, and one that stays can.
    const withD3 = (stageAfter: string) =>
      edited(parcelDesk, (world) => {
        world.deviations.push('D3_contradiction');
        required(world.flows[0]).deviations.push('D3_contradiction');
        world.phrases.push({
          dimension: 'deviation',
          value: 'D3_contradiction',
          text: 'That is not what I said.',
          lang: 'en',
          intent: { kind: 'deviation', class: 'D3_contradiction' },
        });
        world.recoveries.push({ class: 'D3_contradiction', flows: ['posting'], stageAfter, quote: 'q' });
      });
    const moves = withD3('acceptance');
    expect(jointlyPossible(moves, { deviation: 'D3_contradiction', stage: 'open' })).toBe(false);
    expect(jointlyPossible(moves, { deviation: 'D3_contradiction', stage: 'acceptance' })).toBe(true);
    expect(jointlyPossible(moves, { deviation: 'D3_contradiction', stage: 'end' })).toBe(false);
    const stays = withD3('pending');
    expect(jointlyPossible(stays, { deviation: 'D3_contradiction', stage: 'end' })).toBe(true);
  });

  it('holds the values a path reads to the cell, and lets a free dimension take any of them', () => {
    const world = forkDesk();
    const base = { deviation: 'D8_tool_failure', stage: 'a' };
    expect(jointlyPossible(world, { ...base, branch: 'branch.one' })).toBe(true);
    expect(jointlyPossible(world, { ...base, branch: 'branch.two' })).toBe(false);
    expect(jointlyPossible(world, { ...base, branch: 'branch.other' })).toBe(false);
    expect(jointlyPossible(world, base)).toBe(true);
  });
});

describe('the tool failure events of the read desk', () => {
  const stay = (stage: string, behaviour?: string): Cell => ({
    deviation: 'D8_tool_failure',
    stage,
    ...(behaviour ? { behaviour } : {}),
  });

  it('says a failing read on a staying turn at every stage after the start, the last one included', () => {
    const desk = readDesk();
    expect(jointlyPossible(desk, stay('sorting', 'B-1'))).toBe(true);
    expect(jointlyPossible(desk, stay('end', 'B-1'))).toBe(true);
    expect(jointlyPossible(desk, stay('end', 'B-3'))).toBe(true);
    expect(jointWitness(desk, stay('end'))?.event.asked).toBe('B-1');
  });

  it('never says it at the start: a recovery with no stage list names the stages after the path start', () => {
    const desk = readDesk();
    // The move out of the start calls lookup_parcel and the flow recovers it, yet the start is not after it.
    expect(jointlyPossible(desk, stay('open'))).toBe(false);
    expect(jointlyPossible(desk, stay('open', 'B-1'))).toBe(false);
  });

  it('asks a read the flow recovers, no other', () => {
    const wrongTool = readDesk();
    required(wrongTool.recoveries[0]).tool = 'lookup_elsewhere';
    expect(jointlyPossible(wrongTool, stay('end'))).toBe(false);
    expect(jointlyPossible(wrongTool, stay('sorting'))).toBe(false);

    const anyTool = readDesk();
    delete required(anyTool.recoveries[0]).tool;
    expect(jointlyPossible(anyTool, stay('end'))).toBe(true);
  });

  it('never asks a side-effecting tool, a behaviour whose text omits its tool, an unowned one or an unasked one', () => {
    const sideEffect = readDesk();
    required(sideEffect.tools[0]).sideEffect = true;
    expect(jointlyPossible(sideEffect, stay('end'))).toBe(false);

    const unnamed = readDesk();
    required(unnamed.behaviours[0]).title = 'Look the parcel up before stating where it is';
    expect(jointlyPossible(unnamed, stay('end'))).toBe(false);

    const unowned = readDesk();
    required(unowned.flows[0]).behaviours = ['B-2', 'B-3'];
    expect(jointlyPossible(unowned, stay('end'))).toBe(false);

    const unasked = readDesk();
    unasked.phrases = unasked.phrases.filter((phrase) => phrase.value !== 'B-1');
    expect(jointlyPossible(unasked, stay('end'))).toBe(false);
  });

  it('holds both the covered and the asked behaviour to the written constraints', () => {
    const webOnly = edited(readDesk, (world) => {
      required(world.behaviours[0]).channels = ['web'];
    });
    expect(jointlyPossible(webOnly, { ...stay('end', 'B-3'), channel: 'phone' })).toBe(false);
    expect(jointlyPossible(webOnly, { ...stay('end', 'B-3'), channel: 'web' })).toBe(true);
    const barred = edited(readDesk, (world) => {
      world.constraints = [
        { forbid: { behaviour: 'B-3', channel: 'web' }, reason: 'r', source: 'prompt', quote: 'q' },
      ];
    });
    expect(jointlyPossible(barred, { ...stay('end', 'B-3'), channel: 'web' })).toBe(false);
  });

  it('follows the rendered map: the map states a staying read call exactly where the oracle says one', () => {
    const calls = (world: HiddenSpec) =>
      (hiddenProposal(world).relations ?? []).flatMap((relation) =>
        relation.kind === 'uses_tool' && relation.subject.dimension === 'behaviour'
          ? [`${relation.subject.value}@${relation.stage}`]
          : [],
      );
    const desk = readDesk();
    expect(calls(desk)).toEqual(['B-1@open', 'B-1@sorting', 'B-1@end']);
    required(desk.tools[0]).sideEffect = true;
    expect(calls(desk)).toEqual([]);
    expect(jointlyPossible(desk, stay('end'))).toBe(false);
  });

  it('holds an output value to the valid partitions the rendered path states after the tool stage', () => {
    const desk = readDesk();
    const found = 'lookup_parcel.out.found';
    expect(jointlyPossible(desk, { stage: 'sorting', [found]: `${found}.true` })).toBe(true);
    expect(jointlyPossible(desk, { stage: 'end', [found]: `${found}.false` })).toBe(true);
    expect(jointlyPossible(desk, { stage: 'sorting', [found]: `${found}.garbled` })).toBe(false);
    expect(jointlyPossible(desk, { stage: 'sorting', [found]: `${found}.unlisted` })).toBe(false);
  });

  it('says a failure on a move only when the move is the edge the tool is called on', () => {
    const fork = forkDesk();
    // Both paths leave a, and the flow calls check_route on a to b only: the branch that goes to c has none.
    expect(jointlyPossible(fork, { deviation: 'D8_tool_failure', stage: 'a', branch: 'branch.one' })).toBe(
      true,
    );
    expect(jointlyPossible(fork, { deviation: 'D8_tool_failure', stage: 'a', branch: 'branch.two' })).toBe(
      false,
    );
    expect(jointlyPossible(fork, { deviation: 'D8_tool_failure', stage: 'b' })).toBe(false);
  });
});

describe('the coverage items on a hand-written world', () => {
  const desk = parcelDesk();
  const triple = item(TRIPLE);

  it('passes a suite that holds every jointly feasible triple, though one allowed triple has no position', async () => {
    const result = await triple.check(dataFor(suite(desk, PARCEL_FEASIBLE)));
    expect(result.pass, result.detail).toBe(true);
    expect(result.detail).toBe(
      '0 of 11 allowed cells of behaviour x deviation x stage are covered by no complete spec: ',
    );
  });

  it('fails a suite that leaves a jointly feasible triple uncovered, naming it', async () => {
    for (const dropped of PARCEL_FEASIBLE) {
      const probes = PARCEL_FEASIBLE.filter((probe) => probe !== dropped);
      const result = await triple.check(dataFor(suite(desk, probes)));
      // A probe reaches its stage first, so another probe of the behaviour at that stage can still place a
      // clean arrival there; every deviation cell has its own probe and nothing else places it.
      const reached = probes.some(
        (probe) =>
          probe.behaviour === dropped.behaviour &&
          probe.stage === dropped.stage &&
          probe.deviation !== 'none',
      );
      const masked = dropped.deviation === 'none' && reached;
      expect(result.pass, text(dropped)).toBe(masked);
      if (!masked) expect(result.detail).toContain(text(dropped));
    }
  });

  it('fails a suite that emits the triple no position carries, though the cell counts as covered', async () => {
    const result = await triple.check(dataFor(suite(desk, [...PARCEL_FEASIBLE, PARCEL_GAP])));
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('no one position of the hidden map carries');
    expect(result.detail).toContain('behaviour=B-1 deviation=D9_out_of_scope stage=sorting');
  });

  it('judges the terminal staying read of the read desk: required, and failed when never placed', async () => {
    const world = readDesk();
    const feasible = triplesOf(world)
      .filter((entry) => entry.possible)
      .map(({ behaviour, deviation, stage }) => ({ behaviour, deviation, stage }));
    expect(feasible).toHaveLength(12);
    expect(
      feasible.filter((probe) => probe.deviation === 'D8_tool_failure' && probe.stage === 'end'),
    ).toHaveLength(3);
    expect((await triple.check(dataFor(suite(world, feasible)))).pass).toBe(true);
    const without = feasible.filter(
      (probe) =>
        !(probe.behaviour === 'B-3' && probe.deviation === 'D8_tool_failure' && probe.stage === 'end'),
    );
    const result = await triple.check(dataFor(suite(world, without)));
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('behaviour=B-3+deviation=D8_tool_failure+stage=end');
  });

  it('leaves a pair judged by the map itself: the pair item still asks for every allowed pair', async () => {
    const pairs = item('cover.pair.deviation.stage');
    const result = await pairs.check(dataFor(suite(desk, PARCEL_FEASIBLE)));
    expect(result.pass, result.detail).toBe(true);
    const missing = await pairs.check(
      dataFor(
        suite(
          desk,
          PARCEL_FEASIBLE.filter((probe) => probe.stage !== 'acceptance' || probe.deviation === 'none'),
        ),
      ),
    );
    expect(missing.pass).toBe(false);
    expect(missing.detail).toContain('deviation=D9_out_of_scope+stage=acceptance');
  });
});

describe('the emitted-cell items on a hand-written world', () => {
  const desk = parcelDesk();
  const seeders = ['graph', 'twise', 'boundary', 'deviation', 'metamorphic'];

  it.each(seeders)(
    'fails %s blocks that sit where no single position carries their whole cell',
    async (seeder) => {
      const own = item(`diff.feasible.${seeder}`);
      const fine = await own.check(dataFor(suite(desk, PARCEL_FEASIBLE, seeder)));
      expect(fine.pass, fine.detail).toBe(true);
      expect(fine.detail).toBe('0 blocks sit in a cell a hidden constraint forbids: ');
      const result = await own.check(dataFor(suite(desk, [...PARCEL_FEASIBLE, PARCEL_GAP], seeder)));
      expect(result.pass).toBe(false);
      expect(result.detail).toContain('0 blocks sit in a cell a hidden constraint forbids: ');
      expect(result.detail).toContain(
        '1 blocks sit where no one position of the hidden map carries their whole cell',
      );
      expect(result.detail).toContain('behaviour=B-1');
      expect(result.detail).toContain('stage=sorting');
    },
  );

  it('leaves the blocks of other seeders alone', async () => {
    const probes = [...PARCEL_FEASIBLE, PARCEL_GAP];
    const graph = item('diff.feasible.graph');
    expect((await graph.check(dataFor(suite(desk, probes, 'twise')))).pass).toBe(true);
  });

  it('reports a cell a written constraint forbids by its constraint alone', async () => {
    const world = parcelDesk();
    world.constraints = [
      {
        forbid: { behaviour: 'B-1', channel: 'web' },
        reason: 'B-1 never on web',
        source: 'inventory',
        quote: 'q',
      },
    ];
    const result = await item('diff.feasible.graph').check(
      dataFor(suite(world, [PARCEL_FEASIBLE[0] as Probe], 'graph')),
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      '1 blocks sit in a cell a hidden constraint forbids: probe-0#reach (B-1 never on web)',
    );
  });
});

describe('the joint witness on hidden maps no item was written against', () => {
  // Seeds no generator or item was written against.
  const fresh = Array.from({ length: 12 }, (_, index) => 1001 + index);

  it('agrees with the pairwise map: a forbidden pair has no position, with any third value', () => {
    for (const seed of fresh) {
      const hidden = hiddenSpec(seed);
      const map = hiddenSpaceMap(hidden);
      const values = (id: string) =>
        required(map.dimensions.find((entry) => entry.id === id)).values.map((v) => v.id);
      for (const constraint of impossiblePairs(hidden)) {
        expect(
          jointlyPossible(hidden, constraint.forbid),
          `${seed} ${JSON.stringify(constraint.forbid)}`,
        ).toBe(false);
        for (const channel of values('channel'))
          expect(jointlyPossible(hidden, { ...constraint.forbid, channel })).toBe(false);
      }
    }
  });

  it('never accepts a triple one of whose pairs is impossible, and never rejects a pair it lists as possible', () => {
    let gaps = 0;
    for (const seed of fresh) {
      const hidden = hiddenSpec(seed);
      for (const probe of triplesOf(hidden)) {
        const pairs: Cell[] = [
          { behaviour: probe.behaviour, deviation: probe.deviation },
          { behaviour: probe.behaviour, stage: probe.stage },
          { deviation: probe.deviation, stage: probe.stage },
        ];
        if (probe.possible) for (const pair of pairs) expect(jointlyPossible(hidden, pair)).toBe(true);
        else if (pairs.every((pair) => jointlyPossible(hidden, pair))) gaps += 1;
      }
    }
    // The gap this work closes is real on drawn maps: triples whose pairs each have a position and whose three do not.
    expect(gaps).toBeGreaterThan(5);
  });
});

describe('a suite built from the joint oracle on drawn maps', () => {
  const triple = item(TRIPLE);
  const fresh = [1001, 1002, 1003];

  it.each(fresh)(
    'seed %s: passes with every feasible triple, fails with one missing or one gap emitted',
    async (seed) => {
      const hidden = hiddenSpec(seed);
      const all = triplesOf(hidden);
      const feasible = all
        .filter((entry) => entry.possible)
        .map(({ behaviour, deviation, stage }) => ({ behaviour, deviation, stage }));
      const gaps = all.filter((entry) => !entry.possible);
      const pass = await triple.check(dataFor(suite(hidden, feasible)));
      expect(pass.pass, pass.detail).toBe(true);
      const probed = feasible.filter((probe) => probe.deviation !== 'none');
      const dropped = required(probed[Math.floor(probed.length / 2)]);
      const missing = await triple.check(
        dataFor(
          suite(
            hidden,
            feasible.filter((probe) => probe !== dropped),
          ),
        ),
      );
      expect(missing.pass).toBe(false);
      expect(missing.detail).toContain(text(dropped));
      expect(gaps.length).toBeGreaterThan(0);
      for (const gap of gaps) {
        const emitted = await triple.check(dataFor(suite(hidden, [...feasible, gap])));
        expect(emitted.pass, text(gap)).toBe(false);
        expect(emitted.detail).toContain('no one position of the hidden map carries');
      }
    },
  );
});

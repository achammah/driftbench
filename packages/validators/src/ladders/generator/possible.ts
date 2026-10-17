import type { DeviationClass } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { HiddenBehaviour, HiddenPath, HiddenSpec, HiddenTool } from './hidden';

/**
 * The cells of the hidden space a conversation can reach, by the hidden specification's own structure,
 * written apart from the generator so it can judge it. A cell is allowed only when it is possible (the
 * owner's rule for the coverage target: no test for a situation the agent's own map rules out).
 *
 * An event is something said at one position of one path: the move that reaches the stage (any position
 * after the first), or a deviation class said there. A class is said at a position when the flow recovers
 * from it, a phrase of it exists, the first turn carries only a class a first message can carry, a turn
 * after the last stage only a class whose recovery stays, and a tool failure only on a turn that calls a
 * tool the flow recovers from. A tool failure is said on a flow's move, when the move is the edge a flow
 * tool is called on, or on a turn that asks a behaviour whose own text names a read tool the flow recovers
 * from: that call stays on its stage, at any position after the first, the last included. A recovery
 * names stages after the path start (docs/reference/map.md, `at` absent), so no class is said at the start
 * unless a first message can carry it.
 *
 * A cell is possible when ONE event matches every value of it at once: the stage and the class of the
 * event, the path's flow, a behaviour the flow lists (and the one the event asks), the values the path's
 * branch holds, and a completion of the other axes that breaks no constraint. Pairs of values that each
 * have an event of their own are not enough: three values need the same event.
 */

/** Classes a first message can carry: they need no earlier turn. */
const FIRST_TURN: ReadonlySet<DeviationClass> = new Set([
  'D1_off_topic',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D9_out_of_scope',
]);

type Cell = Record<string, string>;

/**
 * The read tool a behaviour runs when asked, without moving: the rendered map states it for a behaviour
 * whose own text names a tool that has no side effect. Any other behaviour stays unlinked.
 */
export function behaviourReadTool(spec: HiddenSpec, behaviour: HiddenBehaviour): HiddenTool | undefined {
  const tool = spec.tools.find((entry) => entry.name === behaviour.tool);
  return tool && !tool.sideEffect && behaviour.title.includes(tool.name) ? tool : undefined;
}

/**
 * The values a path holds for, as the rendered map states them: the branch of the specification, and the
 * valid partitions of every tool output of a stage the path reaches after its start.
 */
export function renderedWhen(spec: HiddenSpec, path: HiddenPath): Record<string, string[]> {
  return {
    ...path.when,
    ...Object.fromEntries(
      spec.tools
        .filter((tool) => tool.stage !== undefined && path.stages.slice(1).includes(tool.stage))
        .flatMap((tool) =>
          tool.output.map((property) => {
            const dimension = `${tool.name}.out.${property.name}`;
            return [
              dimension,
              spec.data
                .filter((value) => value.dimension === dimension && !value.invalid)
                .map((value) => value.id),
            ] as const;
          }),
        ),
    ),
  };
}

/** One thing said at one position of a path. `asked` is the behaviour a tool-failure turn asks, if any. */
export type JointEvent = {
  path: HiddenPath;
  index: number;
  stage: string;
  deviation: string;
  asked?: string;
};

function said(spec: HiddenSpec, path: HiddenPath, index: number, cls: DeviationClass): boolean {
  const stage = path.stages[index] as string;
  const last = index === path.stages.length - 1;
  const recoveries = spec.recoveries.filter(
    (entry) => entry.class === cls && entry.flows.includes(path.flow),
  );
  if (recoveries.length === 0) return false;
  if (cls === 'D8_tool_failure') {
    if (last || index === 0) return false;
    const next = path.stages[index + 1];
    return spec.uses.some(
      (use) =>
        use.flow === path.flow &&
        use.from === stage &&
        use.to === next &&
        recoveries.some((entry) => entry.tool === undefined || entry.tool === use.tool),
    );
  }
  if (!spec.phrases.some((phrase) => phrase.intent.kind === 'deviation' && phrase.intent.class === cls))
    return false;
  if (index === 0 && !FIRST_TURN.has(cls)) return false;
  if (last && !recoveries.some((entry) => entry.stageAfter === 'pending' || entry.stageAfter === stage))
    return false;
  return true;
}

/** The behaviours a turn on this path can ask for a failing read: they stay on the stage. */
function askedReads(spec: HiddenSpec, path: HiddenPath): string[] {
  const recoveries = spec.recoveries.filter(
    (entry) => entry.class === 'D8_tool_failure' && entry.flows.includes(path.flow),
  );
  const owned = spec.flows.find((flow) => flow.id === path.flow)?.behaviours ?? [];
  return spec.behaviours
    .filter((behaviour) => owned.includes(behaviour.id))
    .filter((behaviour) => {
      const tool = behaviourReadTool(spec, behaviour);
      if (!tool) return false;
      const asked = spec.phrases.some(
        (phrase) => phrase.intent.kind === 'behaviour' && phrase.intent.behaviour === behaviour.id,
      );
      return asked && recoveries.some((entry) => entry.tool === undefined || entry.tool === tool.name);
    })
    .map((behaviour) => behaviour.id);
}

const eventMemo = new WeakMap<HiddenSpec, JointEvent[]>();

/** Every event of the hidden map, in path order. */
export function jointEvents(spec: HiddenSpec): JointEvent[] {
  const known = eventMemo.get(spec);
  if (known) return known;
  const events = spec.paths.flatMap((path) => {
    const reads = askedReads(spec, path);
    return path.stages.flatMap((stage, index) => [
      ...(index >= 1 ? [{ path, index, stage, deviation: NONE as string }] : []),
      ...spec.deviations
        .filter((cls) => said(spec, path, index, cls))
        .map((deviation) => ({ path, index, stage, deviation: deviation as string })),
      ...(index >= 1 && spec.deviations.includes('D8_tool_failure')
        ? reads.map((asked) => ({ path, index, stage, deviation: 'D8_tool_failure', asked }))
        : []),
    ]);
  });
  eventMemo.set(spec, events);
  return events;
}

/** True when a written constraint forbids every value of the context. */
function forbidden(spec: HiddenSpec, context: Cell): boolean {
  return spec.constraints.some((constraint) =>
    Object.entries(constraint.forbid).every(([dimension, value]) => context[dimension] === value),
  );
}

export type JointWitness = { event: JointEvent; context: Cell };

function witnessOf(spec: HiddenSpec, event: JointEvent, cell: Cell): JointWitness | undefined {
  const { path } = event;
  if (cell.stage !== undefined && cell.stage !== event.stage) return undefined;
  if (cell.deviation !== undefined && cell.deviation !== event.deviation) return undefined;
  if (cell.flow !== undefined && cell.flow !== path.flow) return undefined;
  const owned = spec.flows.find((flow) => flow.id === path.flow)?.behaviours ?? [];
  if (cell.behaviour !== undefined && !owned.includes(cell.behaviour)) return undefined;
  const branch = renderedWhen(spec, path);
  for (const [dimension, values] of Object.entries(branch)) {
    const held = cell[dimension];
    if (held !== undefined && !values.includes(held)) return undefined;
  }
  const behaviours = [
    ...new Set([cell.behaviour, event.asked].filter((id): id is string => id !== undefined)),
  ];
  const known: Cell = { ...cell, flow: path.flow, stage: event.stage, deviation: event.deviation };
  // The inventory restricts the channels of a behaviour: a context that holds the channel holds them all.
  const contexts = (picked: Cell): Cell[] =>
    behaviours.length === 0 ? [picked] : behaviours.map((id) => ({ ...picked, behaviour: id }));
  const channelsOk = (picked: Cell): boolean =>
    behaviours.every((id) => {
      const channels = spec.behaviours.find((behaviour) => behaviour.id === id)?.channels;
      return channels === undefined || picked.channel === undefined || channels.includes(picked.channel);
    });
  // The dimensions a constraint names and the cell leaves open take a value that breaks none: the branch's
  // own values, the channels and the personas. Others cannot change a verdict, so they stay open.
  const named = new Set(spec.constraints.flatMap((constraint) => Object.keys(constraint.forbid)));
  const candidates: Array<[string, string[]]> = [
    ...Object.entries(branch),
    ['channel', spec.channels],
    ['user_type', spec.personas.map((persona) => persona.id)],
  ];
  const open = candidates.filter(([dimension]) => known[dimension] === undefined && named.has(dimension));
  const choose = (at: number, picked: Cell): Cell | undefined => {
    if (at === open.length)
      return channelsOk(picked) && contexts(picked).every((context) => !forbidden(spec, context))
        ? picked
        : undefined;
    const [dimension, values] = open[at] as [string, string[]];
    for (const value of values) {
      const found = choose(at + 1, { ...picked, [dimension]: value });
      if (found) return found;
    }
    return undefined;
  };
  const context = choose(0, known);
  return context ? { event, context } : undefined;
}

const witnessMemo = new WeakMap<HiddenSpec, Map<string, JointWitness | null>>();

/**
 * The one event that carries every value of the cell at once, with the context it completes to, or
 * undefined when none does. A value the map does not know, or one no event can say, has no witness.
 */
export function jointWitness(spec: HiddenSpec, cell: Cell): JointWitness | undefined {
  let memo = witnessMemo.get(spec);
  if (!memo) {
    memo = new Map();
    witnessMemo.set(spec, memo);
  }
  const key = JSON.stringify(Object.entries(cell).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const known = memo.get(key);
  if (known !== undefined) return known ?? undefined;
  let found: JointWitness | undefined;
  if (!forbidden(spec, cell))
    for (const event of jointEvents(spec)) {
      found = witnessOf(spec, event, cell);
      if (found) break;
    }
  memo.set(key, found ?? null);
  return found;
}

/** True when some event of the hidden map carries every value of the cell at once. */
export function jointlyPossible(spec: HiddenSpec, cell: Cell): boolean {
  return jointWitness(spec, cell) !== undefined;
}

/** Pairs of the hidden axes no event can reach, as constraints. */
export function impossiblePairs(spec: HiddenSpec): Array<{ forbid: Cell; reason: string }> {
  const allowed = (cell: Cell) =>
    !spec.constraints.some((constraint) =>
      Object.entries(constraint.forbid).every(([dimension, value]) => cell[dimension] === value),
    );
  const axes: Array<[string, string[]]> = [
    ['behaviour', spec.behaviours.map((behaviour) => behaviour.id)],
    ['deviation', [NONE, ...spec.deviations]],
    ['channel', spec.channels],
    ['stage', spec.stages.map((stage) => stage.id)],
    ['user_type', spec.personas.map((persona) => persona.id)],
  ];
  const out: Array<{ forbid: Cell; reason: string }> = [];
  axes.forEach(([first, firstValues], index) => {
    for (const [second, secondValues] of axes.slice(index + 1)) {
      const structural = [first, second].some((axis) => axis === 'stage' || axis === 'deviation');
      if (!structural) continue;
      for (const x of firstValues)
        for (const y of secondValues) {
          const cell: Cell = { [first]: x, [second]: y };
          if (!allowed(cell)) continue;
          if (cell.stage === undefined && cell.deviation === NONE) continue;
          if (!jointlyPossible(spec, cell))
            out.push({
              forbid: cell,
              reason: `no path of the hidden map can reach ${first}=${x} with ${second}=${y}`,
            });
        }
    }
  });
  return out;
}

/**
 * A recorded cell read as one position of the hidden map. Only a cell that names a stage or a deviation
 * is a position: the rest holds no structure for an event to carry. A cell that names a stage and no
 * deviation carries none.
 */
export function positionOf(cell: Cell, dimensions?: readonly string[]): Cell | undefined {
  const kept = dimensions ?? Object.keys(cell);
  if (!kept.some((dimension) => dimension === 'stage' || dimension === 'deviation')) return undefined;
  const out: Cell = {};
  for (const dimension of dimensions ? kept : [...kept, 'deviation']) {
    const value = cell[dimension] ?? (dimension === 'deviation' ? NONE : undefined);
    if (value === undefined) return undefined;
    out[dimension] = value;
  }
  return out;
}

/** The words of a cell: `a=1 b=2`. */
export function cellText(cell: Cell): string {
  return Object.entries(cell)
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(' ');
}

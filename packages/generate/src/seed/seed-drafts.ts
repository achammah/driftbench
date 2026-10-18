/** What the seeders share: the seed context, scenario and carrier drafts, the context axes and the world of a cell. */

import type { PerturbationSpec } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { PathRelation, ProposalPhrase } from '../extract/proposal';
import {
  type BlockDraft,
  choosePhrase,
  deviationCriterion,
  draftCriterion,
  type Pick,
  pickOf,
  type SpecDraft,
} from './assemble';
import {
  DETOURS,
  MAX_CALLS_AFTER_FAILURE,
  OPENING_CLASSES,
  TOOL_FAILURE,
  TOOL_FAILURE_ERROR,
} from './deviation';
import type { Edge, StageGraph } from './graph';
import { dimensionId, type PreparedMap, phraseKey, valueId } from './map';
import { pick, type Rng, rngFor, shuffle, streamSeed } from './random';
import { buildScenario, type ProbeRequest, type ScenarioRequest } from './scenario';
import { worldFor } from './world';

export { worldFor } from './world';

export type SeedContext = {
  seed: number;
  t: number;
  max: number;
  /** Generation-local path indices, shared by seeders of the same immutable map snapshot. */
  pathValues?: ReadonlyMap<PathRelation, ReadonlyMap<string, readonly number[]>>;
  dimensionIndex?: ReadonlyMap<string, number>;
  /** Consume each completed draft immediately instead of retaining the seeder output. */
  emit?: (draft: SpecDraft) => void;
  /** Replayable disk rows: their final count keeps the existing "row X of N" titles exact. */
  rows?: { length: number; push(row: number[]): void; [Symbol.iterator](): Iterator<number[]> };
  /**
   * Specs placed so far on each value of the context axes (a channel, a persona), by dimension then value.
   * A walk whose context is free takes the allowed value placed on least, so the suite spreads over them.
   */
  usage?: Map<number, Map<number, number>>;
};

/** The most edges in one graph path: a path is one spec, and a reader follows it block by block. */
export const MAX_PATH_LENGTH = 12;

export const pad = (n: number) => String(n).padStart(3, '0');

// Scenarios on the map's paths ----------------------------------------------------------------------------

/** True when the map holds approved paths: the seeders then build scenarios. */
export function hasPaths(prepared: PreparedMap): boolean {
  return prepared.relations.paths.length > 0;
}

/** The flows a behaviour belongs to, by the inventory, by id. A flow value is its own flow. */
export function flowsOfBehaviour(prepared: PreparedMap, behaviour: string): string[] {
  const flows = (prepared.inventory?.flows ?? [])
    .filter((flow) => flow.id === behaviour || (flow.behaviours ?? []).includes(behaviour as never))
    .map((flow) => flow.id);
  const own = prepared.relations.paths.some((path) => path.flow === behaviour);
  return own && !flows.includes(behaviour) ? [behaviour, ...flows] : flows;
}

export type PathTry = { draft: SpecDraft; path: PathRelation } | { reasons: string[] };

/**
 * Tries the candidate paths in a seeded order, the preferred ones first, and returns the first scenario
 * that builds, as a draft; else every reason a path gave.
 */
export function scenarioDraft(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  seeder: SpecDraft['seeder'],
  prefix: string,
  fixed: readonly Pick[],
  candidates: { preferred: PathRelation[]; others: PathRelation[] },
  options: {
    probe?: ProbeRequest;
    /** Reject ineligible paths after seeded ordering, preserving draws on an already eligible choice. */
    pathAllowed?: (path: PathRelation) => boolean;
    force?: ProposalPhrase;
    rngLabel?: string;
    turn?: ScenarioRequest['turn'];
    aside?: ScenarioRequest['aside'];
    before?: ScenarioRequest['before'];
    perturbEvery?: boolean;
    perturb?: ScenarioRequest['perturb'];
  } = {},
): PathTry {
  const rng = rngFor(context.seed, options.rngLabel ?? id);
  const order = [...shuffle(rng, candidates.preferred), ...shuffle(rng, candidates.others)];
  const reasons: string[] = [];
  for (const path of order) {
    if (options.pathAllowed && !options.pathAllowed(path)) continue;
    const built = buildScenario(prepared, rng, {
      path,
      fixed,
      pathValues: context.pathValues?.get(path),
      dimensionIndex: context.dimensionIndex,
      ...(options.probe ? { probe: options.probe } : {}),
      ...(options.force ? { force: options.force } : {}),
      ...(options.turn ? { turn: options.turn } : {}),
      ...(options.aside ? { aside: options.aside } : {}),
      ...(options.before ? { before: options.before } : {}),
      ...(options.perturbEvery ? { perturbEvery: true } : {}),
      ...(options.perturb ? { perturb: options.perturb } : {}),
    });
    if (!built.ok) {
      reasons.push(built.reason);
      continue;
    }
    // The context is drawn with every stage the walk reaches: a value the walk's stages rule out (a coverage
    // result on a flow that checks no coverage) is never drawn.
    const reached: Pick[] =
      prepared.stage === undefined
        ? []
        : built.blocks.flatMap((block): Pick[] => {
            const at =
              block.stage === undefined
                ? undefined
                : prepared.space.dimensions[prepared.stage as number]?.index.get(block.stage);
            return at === undefined ? [] : [[prepared.stage as number, at]];
          });
    // A metamorphic family keeps its draws: its variants must differ in the one value the family varies.
    context.usage ??= new Map();
    const usage = seeder === 'metamorphic' ? undefined : context.usage;
    const cell = [...built.cell, ...contextAxes(prepared, built.cell, rng, reached, usage)];
    if (usage) {
      for (const [dimension, value] of cell) {
        if (!CONTEXT_KINDS.has(prepared.space.dimensions[dimension]?.kind ?? '')) continue;
        if (!prepared.axes.has(dimension)) continue;
        const placed = usage.get(dimension) ?? new Map<number, number>();
        placed.set(value, (placed.get(value) ?? 0) + 1);
        usage.set(dimension, placed);
      }
    }
    const behaviours = cell.filter(
      ([dimension]) =>
        prepared.space.dimensions[dimension]?.kind === 'behaviour' && dimension !== prepared.transition,
    );
    const criteria = behaviours.map((entry) => draftCriterion(prepared, entry));
    // Only reply-bound outputs need an injected answer. Other output partitions can describe
    // a real fixture's business state without being synthetic JSON Schema partitions.
    const world = worldFor(prepared, built.replyData, { useBindings: true });
    if (world.unsupported.length > 0) {
      reasons.push(...world.unsupported);
      continue;
    }
    const blocks = built.blocks;
    const first = blocks[0];
    if (first && criteria.length > 0) first.criteria = criteria.map((criterion) => criterion.name);
    if (options.probe) {
      const probeCriterion = deviationCriterion(options.probe.classId);
      criteria.push(probeCriterion);
      const injected = blocks.find((block) => block.injection === options.probe?.classId);
      if (injected) injected.criteria = [...(injected.criteria ?? []), probeCriterion.name];
    }
    return {
      path,
      draft: {
        id,
        seeder,
        title: `${prefix}: ${built.title}`,
        stream: streamSeed(context.seed, options.rngLabel ?? id),
        cell,
        blocks,
        criteria,
        path: path.id,
        ...(world.world ? { world: world.world } : {}),
        ...(built.rules ? { rules: built.rules } : {}),
        ...(built.endState ? { end_state: built.endState } : {}),
        ...(built.perturbations ? { perturbations: built.perturbations } : {}),
      },
    };
  }
  return { reasons: reasons.length > 0 ? reasons : ['no approved path fits'] };
}

/** Splits paths into those that list a behaviour and the rest. */
export function preferring(paths: PathRelation[], behaviour: string | undefined) {
  const preferred = paths.filter(
    (path) => behaviour !== undefined && (path.behaviours ?? []).includes(behaviour),
  );
  return { preferred, others: paths.filter((path) => !preferred.includes(path)) };
}

/** The probe a cell's deviation asks for, or undefined for none. */
export function probeOf(prepared: PreparedMap, cell: readonly Pick[]): ProbeRequest | undefined {
  const deviation = cell.find(([dimension]) => dimension === prepared.deviation);
  if (!deviation) return undefined;
  const classId = valueId(prepared, deviation[0], deviation[1]);
  return classId === NONE ? undefined : { classId };
}

/** An incomplete draft: the old carrier, its blocks with judged criteria only, and why no path fits. */
export function withReasons(draft: SpecDraft, reasons: string[]): SpecDraft {
  return { ...draft, reasons: [...new Set(reasons)].slice(0, 6) };
}

/** One block per edge: the phrase of the transition (or of the stage it reaches), the stage it reaches. */
export function edgeBlock(prepared: PreparedMap, rng: Rng, edge: Edge, id: string): BlockDraft {
  const candidates: Pick[] = [];
  if (prepared.transition !== undefined) candidates.push([prepared.transition, edge.value]);
  const stage =
    prepared.stage === undefined ? undefined : prepared.space.dimensions[prepared.stage]?.index.get(edge.to);
  if (prepared.stage !== undefined && stage !== undefined) candidates.push([prepared.stage, stage]);
  return {
    id,
    stimulus: choosePhrase(prepared, rng, candidates),
    stage: edge.to,
    carries: candidates.slice(0, 1),
  };
}

/** The shortest route from the start to a stage over edges that all have an approved phrase. */
export function phrasedRoute(prepared: PreparedMap, graph: StageGraph, target: string): Edge[] | undefined {
  if (graph.start === undefined) return undefined;
  const phrased = graph.edges.filter(
    (edge) =>
      (prepared.phrasesOf.get(phraseKey(dimensionId(prepared, prepared.transition ?? -1), edge.id)) ?? [])
        .length > 0,
  );
  const back = new Map<string, Edge>();
  const seen = new Set([graph.start]);
  const queue = [graph.start];
  for (let stage = queue.shift(); stage !== undefined; stage = queue.shift()) {
    if (stage === target) {
      const route: Edge[] = [];
      for (let at = stage; at !== graph.start; ) {
        const edge = back.get(at);
        if (!edge) break;
        route.unshift(edge);
        at = edge.from;
      }
      return route;
    }
    for (const edge of phrased.filter((candidate) => candidate.from === stage)) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      back.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  return undefined;
}

/** Axis kinds that set the context of a conversation: who talks, on which channel, with which data. */
const CONTEXT_KINDS: ReadonlySet<string> = new Set(['persona', 'channel', 'data']);

/**
 * The context axes of a spec whose seeder fixes only some values (a graph path, a probe, a boundary value):
 * a seeded allowed completion of the fixed values, with no deviation, kept only when every stage and
 * transition the spec reaches stays allowed with it. Behaviour axes are left out: a context draw is not a
 * claim that the spec covers a behaviour.
 */
export function contextAxes(
  prepared: PreparedMap,
  fixed: readonly Pick[],
  rng: Rng,
  reached: readonly Pick[] = [],
  usage?: ReadonlyMap<number, ReadonlyMap<number, number>>,
): Pick[] {
  // One value per dimension is fixed; a second value of the same dimension (a spec covering two flows)
  // must stay allowed with the draw, like a stage the spec reaches.
  const base: Pick[] = [];
  const also: Pick[] = [...reached];
  for (const entry of fixed) {
    if (base.some(([at]) => at === entry[0])) also.push(entry);
    else base.push(entry);
  }
  const none =
    prepared.deviation === undefined
      ? undefined
      : prepared.space.dimensions[prepared.deviation]?.index.get(NONE);
  if (
    prepared.deviation !== undefined &&
    none !== undefined &&
    !base.some(([at]) => at === prepared.deviation)
  ) {
    base.push([prepared.deviation, none]);
  }
  // A conversation holds no task setting: every task axis stays at its `none`, as the spec places it.
  for (const index of prepared.axes) {
    const dimension = prepared.space.dimensions[index];
    const empty = dimension?.index.get(NONE);
    if (dimension?.kind === 'task' && empty !== undefined && !base.some(([at]) => at === index))
      base.push([index, empty]);
  }
  const otherBases = also.map((entry) => base.filter(([at]) => at !== entry[0]));
  const axes = [...prepared.axes]
    .sort((a, b) => a - b)
    .filter((index) => CONTEXT_KINDS.has(prepared.space.dimensions[index]?.kind ?? ''))
    .filter((index) => !base.some(([at]) => at === index));
  const fits = (candidate: readonly Pick[]) => {
    if (!prepared.feasibility.allowed([...base, ...candidate])) return false;
    for (let index = 0; index < also.length; index += 1) {
      const entry = also[index] as Pick;
      if (!prepared.feasibility.allowed([...(otherBases[index] as Pick[]), ...candidate, entry]))
        return false;
    }
    return true;
  };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const full = prepared.feasibility.complete(base, rng);
    if (!full) return [];
    const picks: Pick[] = axes.map((index) => [index, full[index] ?? 0]);
    if (!fits(picks)) continue;
    if (usage) {
      // The draw stands unless another allowed value of the axis has been placed on less: then that one.
      for (let at = 0; at < picks.length; at += 1) {
        const original = picks[at] as Pick;
        const [index, drawn] = original;
        const placed = usage.get(index);
        let best = drawn;
        const values = prepared.space.dimensions[index]?.values ?? [];
        for (let value = 0; value < values.length; value += 1) {
          if (values[value]?.id === NONE || (placed?.get(value) ?? 0) >= (placed?.get(best) ?? 0)) continue;
          picks[at] = [index, value];
          if (fits(picks)) best = value;
          picks[at] = original;
        }
        picks[at] = [index, best];
      }
    }
    return picks;
  }
  return [];
}

/** The details of a cell: a seeded allowed completion, the stage graph's dimensions left out. */
function withDetails(prepared: PreparedMap, cell: readonly Pick[], rng: Rng): Pick[] {
  const full = prepared.feasibility.complete(cell, rng);
  if (!full) return [...cell];
  const fixed = new Set(cell.map(([dimension]) => dimension));
  const details: Pick[] = full.flatMap((value, dimension): Pick[] =>
    fixed.has(dimension) || dimension === prepared.stage || dimension === prepared.transition
      ? []
      : [[dimension, value]],
  );
  return [...cell, ...details];
}

/**
 * A conversation over one cell: the given values, completed with a seeded allowed choice of every other
 * value but the stage graph's (the details inside the cell), the tool answers its data values state, an
 * opening turn from the approved phrases of its values, and its deviation, when it has one, as the next
 * block. The Then is what the map supports for such a cell: the deviation's expectation, and the cell's
 * behaviour values as judged criteria drafted from their approved titles.
 */
export function carrierDraft(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  seeder: SpecDraft['seeder'],
  title: string,
  cell: Pick[],
  fixed?: { stimulus: BlockDraft['stimulus'] },
): SpecDraft {
  const rng = rngFor(context.seed, id);
  cell = withDetails(prepared, cell, rng);
  const deviation = cell.find(([dimension]) => dimension === prepared.deviation);
  const openers = cell.filter(([dimension]) => dimension !== prepared.deviation);
  const stimulus = fixed?.stimulus ?? choosePhrase(prepared, rng, openers);
  const carried = stimulus.kind === 'phrase' ? pickOf(prepared, stimulus.phrase) : undefined;
  const behaviours = cell.filter(([dimension]) => prepared.space.dimensions[dimension]?.kind === 'behaviour');
  const criteria = behaviours.map((entry) => draftCriterion(prepared, entry));
  const blocks: BlockDraft[] = [
    {
      id: 'b1-open',
      stimulus,
      carries: carried ? [carried] : [],
      ...(criteria.length > 0 ? { criteria: criteria.map((criterion) => criterion.name) } : {}),
    },
  ];
  const { world } = worldFor(prepared, cell);
  const draft: SpecDraft = {
    id,
    seeder,
    title,
    stream: streamSeed(context.seed, id),
    cell,
    blocks,
    ...(world ? { world } : {}),
    criteria,
  };
  if (deviation && valueId(prepared, deviation[0], deviation[1]) !== NONE) {
    addDeviation(prepared, rng, draft, deviation, undefined);
  }
  return draft;
}

/**
 * Adds the deviation of a cell after the blocks already drafted: an injection block with the class's
 * approved phrase, or for a tool failure without one, a perturbation that makes a tool fail.
 */
export function addDeviation(
  prepared: PreparedMap,
  rng: Rng,
  draft: SpecDraft,
  deviation: Pick,
  anchor: string | undefined,
): void {
  const classId = valueId(prepared, deviation[0], deviation[1]);
  const criterion = deviationCriterion(classId);
  draft.criteria.push(criterion);
  const phrases = prepared.phrasesOf.get(phraseKey(dimensionId(prepared, deviation[0]), classId)) ?? [];
  if (classId === TOOL_FAILURE && phrases.length === 0) {
    const tool = failingTool(prepared, rng, draft.cell);
    if (tool === undefined) return;
    const perturbation: PerturbationSpec = {
      id: `p1-${classId}`,
      class: TOOL_FAILURE,
      inject_at: Math.max(0, draft.blocks.length - 1),
      world: { tools: { [tool]: { error: TOOL_FAILURE_ERROR } } },
      expect: {
        tools: [{ label: tool, count: { max: MAX_CALLS_AFTER_FAILURE } }],
        criteria: [criterion.name],
      },
      recovery: { within_blocks: 1 },
    };
    draft.perturbations = [...(draft.perturbations ?? []), perturbation];
    return;
  }
  const block: BlockDraft = {
    id: `b${draft.blocks.length + 1}-${classId}`,
    stimulus: choosePhrase(prepared, rng, [deviation]),
    injection: classId,
    carries: [deviation],
    criteria: [criterion.name],
  };
  if (anchor !== undefined && DETOURS.has(classId)) block.stage = anchor;
  if (classId === 'D5_language_switch') {
    // The reply stays in the language the map fixes for every reply; without that rule, in the language the
    // conversation declared. Never the language of the switched message.
    const declared = draft.blocks.find((candidate) => candidate.stimulus.kind === 'phrase');
    const lang = declared?.stimulus.kind === 'phrase' ? declared.stimulus.phrase.lang : undefined;
    const bank = prepared.relations.replyLanguage ?? lang ?? mostFrequentLang(prepared);
    if (bank) block.lang = bank.toUpperCase();
  }
  if (classId === 'D7_silence_or_burst') draft.rules = { ...(draft.rules ?? {}), one_message_per_turn: true };
  draft.blocks.push(block);
}

function mostFrequentLang(prepared: PreparedMap): string | undefined {
  const counts = new Map<string, number>();
  for (const phrase of prepared.phrases) counts.set(phrase.lang, (counts.get(phrase.lang) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The tool a generated failure hits. A map can name it as data (a dimension whose values are tool names,
 * such as Acme's failing_tool): a value of the cell that names a tool wins; else one of those values the
 * constraints allow with the cell, by the stream, joins the cell; else a tool with an output schema.
 */
function failingTool(prepared: PreparedMap, rng: Rng, cell: Pick[]): string | undefined {
  const names = prepared.tools.map((tool) => tool.name);
  const named = cell
    .map(([dimension, value]) => valueId(prepared, dimension, value))
    .find((id) => names.includes(id));
  if (named) return named;
  const candidates: Pick[] = [];
  prepared.space.dimensions.forEach((dimension, index) => {
    if (dimension.kind !== 'data' || cell.some(([at]) => at === index)) return;
    dimension.values.forEach((value, position) => {
      if (names.includes(value.id) && prepared.feasibility.allowed([...cell, [index, position]])) {
        candidates.push([index, position]);
      }
    });
  });
  const chosen = pick(rng, candidates);
  if (chosen) {
    cell.push(chosen);
    return valueId(prepared, chosen[0], chosen[1]);
  }
  return pick(
    rng,
    prepared.tools.filter((tool) => tool.output).map((tool) => tool.name),
  );
}

/**
 * One scenario aimed at one allowed cell of the axis map (a pair or a triple of values) that no complete spec
 * covers. Every value of the cell is fixed in the scenario's cell except the stage and the deviation: a
 * deviation is a probe, at the cell's stage when the cell names one; a stage alone is reached by a path that
 * passes it. The start stage is placed only by an event said there, so a stage-only cell on a start stage
 * takes a probe of a class a first message can carry. Every behaviour must belong to the path's flow;
 * a path annotation only ranks those eligible paths. Returns the draft, or every reason no path fits.
 */
export function coverDraft(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  values: Readonly<Record<string, string>>,
): PathTry {
  const fixed: Pick[] = [];
  let stage: string | undefined;
  let deviation: string | undefined;
  let behaviour: string | undefined;
  for (const [dimensionKey, value] of Object.entries(values)) {
    const index = prepared.space.dimensions.findIndex((dimension) => dimension.id === dimensionKey);
    const dimension = prepared.space.dimensions[index];
    if (!dimension) return { reasons: [`${dimensionKey} is not a dimension of the map`] };
    if (index === prepared.stage || dimension.kind === 'stage') {
      stage = value;
      continue;
    }
    if (index === prepared.deviation) {
      if (value !== NONE) deviation = value;
      continue;
    }
    const at = dimension.index.get(value);
    if (at === undefined) return { reasons: [`${dimensionKey}=${value} is not a value of the map`] };
    if (dimension.kind === 'behaviour') behaviour = value;
    fixed.push([index, at]);
  }
  const key = Object.entries(values)
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(', ');
  const paths = prepared.relations.paths.filter((path) => {
    if (stage === undefined) return true;
    const position = path.stages.indexOf(stage);
    // A probe goes in before a move, so its stage is never the last of the path; a walk reaches any
    // stage after the first.
    if (deviation !== undefined) return position >= 0;
    return position >= 0;
  });
  const eligible = paths.filter((path) =>
    fixed.every(
      ([dimension, value]) =>
        dimension === prepared.transition ||
        prepared.space.dimensions[dimension]?.kind !== 'behaviour' ||
        flowsOfBehaviour(prepared, valueId(prepared, dimension, value)).includes(path.flow),
    ),
  );
  const pathAllowed = (path: PathRelation) => eligible.includes(path);
  const startOnly =
    stage !== undefined &&
    deviation === undefined &&
    eligible.length > 0 &&
    eligible.every((path) => path.stages.indexOf(stage as string) === 0);
  const classes =
    deviation !== undefined
      ? [deviation]
      : startOnly
        ? [...OPENING_CLASSES].filter((cls) =>
            prepared.space.dimensions[prepared.deviation ?? -1]?.index.has(cls),
          )
        : [undefined];
  const reasons: string[] = [];
  /** The cell values a phrase of the class needs (its `when`, the stage and the flow left out), one set each. */
  const needs = (classId: string | undefined): Pick[][] => {
    if (classId === undefined || prepared.deviation === undefined) return [[]];
    const phraseOf = phraseKey(dimensionId(prepared, prepared.deviation), classId);
    const sets: Pick[][] = [[]];
    for (const phrase of prepared.phrasesOf.get(phraseOf) ?? []) {
      let options: Pick[][] = [[]];
      for (const [dimensionKey, values] of Object.entries(phrase.when ?? {})) {
        if (dimensionKey === 'stage' || dimensionKey === 'flow') continue;
        const index = prepared.space.dimensions.findIndex((dimension) => dimension.id === dimensionKey);
        if (index < 0 || fixed.some(([at]) => at === index)) continue;
        options = options.flatMap((set) =>
          values.flatMap((value) => {
            const at = prepared.space.dimensions[index]?.index.get(value);
            return at === undefined ? [] : [[...set, [index, at] as Pick]];
          }),
        );
      }
      for (const set of options) if (set.length > 0) sets.push(set);
    }
    return sets;
  };
  const attempts = classes.flatMap((classId) => needs(classId).map((extra) => ({ classId, extra })));
  for (const { classId, extra } of attempts) {
    const built = scenarioDraft(
      prepared,
      context,
      id,
      'cover',
      `Cell ${key}`,
      [...fixed, ...extra],
      preferring(paths, behaviour),
      {
        pathAllowed,
        ...(classId === undefined ? {} : { probe: { classId, ...(stage ? { stage } : {}) } }),
      },
    );
    if ('draft' in built) {
      if (classId !== undefined) {
        const dimension = prepared.deviation as number;
        built.draft.cell.push([dimension, prepared.space.dimensions[dimension]?.index.get(classId) ?? 0]);
      }
      return built;
    }
    reasons.push(...built.reasons);
  }
  // A class said on the first turn whose recovery stays there is no block (an idle reply passes it): a clean
  // walk in the cell declares it as its perturbation instead, and a perturbed run checks the recovery.
  const start =
    stage !== undefined && eligible.length > 0 && eligible.every((path) => path.stages[0] === stage);
  if (start && stage !== undefined) {
    for (const { classId, extra } of attempts) {
      if (classId === undefined) continue;
      const built = scenarioDraft(
        prepared,
        context,
        id,
        'cover',
        `Cell ${key}`,
        [...fixed, ...extra],
        preferring(paths, behaviour),
        { pathAllowed, perturb: { classId, stage } },
      );
      if ('draft' in built) return built;
      reasons.push(...built.reasons);
    }
  }
  if (eligible.length === 0)
    reasons.push(`no approved path of a flow listing the behaviours fits the cell ${key}`);
  return { reasons: reasons.length > 0 ? reasons : [`no approved path fits the cell ${key}`] };
}

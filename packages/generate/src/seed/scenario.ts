import type {
  Assertion,
  Count,
  EndStateSpec,
  Expect,
  PerturbationSpec,
  Rules,
  ToolExpect,
  WorldState,
} from '@agent-nexus/driftbench-core';
import type { PathRelation, ProposalPhrase, Slots, UsesToolRelation } from '../extract/proposal';
import type { BlockDraft, Pick, Stimulus } from './assemble';
import { OPENING_CLASSES, TOOL_FAILURE, TOOL_FAILURE_ERROR } from './deviation';
import { behaviourSubject, dimensionId, type PreparedMap, phraseKey, valueId } from './map';
import { pick, type Rng } from './random';
import {
  type Context,
  endState,
  escapeRegExp,
  failureTools,
  fillText,
  matches,
  phraseFits,
  type Recovery,
  recoveryFor,
  slotsIn,
  slotsOf,
  stageAfter,
  toolExpect,
} from './relations';
import { toolAnswer } from './values';
import { worldFor } from './world';

/**
 * A scenario: one approved path of a flow, walked in a cell, with every Then derived by code from the map.
 * Each block is one turn of the path: the user turn is an approved phrase of the stage transition (its
 * slots filled with the values the cell's data values bind), the stage is the next stage of the path, the
 * tools are the calls the map links to the flow at that stage (inputs filled from the same slots), and
 * every other tool the scenario calls is expected 0 times in that turn. The last block holds the flow's end
 * state. A deviation probe is one more block at a stage of the path: its recovery (the stage after, the
 * words, the guards, the calls) comes from the map's recovery relation for that class in that flow. A tool
 * failure is the path's own turn with the tool failing in the Given, and the conversation stops there.
 * Nothing is read from an agent.
 */

export type ProbeRequest = {
  classId: string;
  /** The stage to probe at; any stage the recovery allows when absent. */
  stage?: string;
  /** For a tool failure: the failing turn is the last one of the walk, a turn that asks a behaviour. */
  onTurn?: boolean;
  /** For a tool failure: the tool that fails; any tool the path calls that has a recovery when absent. */
  tool?: string;
};

export type ScenarioRequest = {
  path: PathRelation;
  /** A generation-local snapshot of this path's value indices. */
  pathValues?: ReadonlyMap<string, readonly number[]>;
  dimensionIndex?: ReadonlyMap<string, number>;
  /** Values the seeder fixed: a t-wise row, a boundary value, a probe's class. */
  fixed: readonly Pick[];
  probe?: ProbeRequest;
  /** A phrase used wherever its value is said: one variant of a metamorphic family. */
  force?: ProposalPhrase;
  /**
   * A turn said after the walk's first move that must not move the conversation: a request the agent
   * refuses or defers (a value outside what a tool accepts, a write asked for before the confirmation).
   * Its Then is the stage the walk had reached, with the tool counts given; the walk ends there.
   */
  turn?: {
    stimulus: Stimulus;
    carries: Pick[];
    tools: ToolExpect[];
    /** Behaviour calls, resolved against this turn's actual stage, cell and bound slots. */
    usesTools?: readonly UsesToolRelation[];
    /**
     * A request that makes a call: the turn is said right after the walk's move that calls the tool, and the
     * call carries that move's arguments with `field` set to `value`, so every argument and the count hold.
     */
    call?: { tool: string; field: string; value: Assertion };
    /**
     * The map ties no tool to what the turn says (a behaviour or flow phrase): the walk forbids no tool, since
     * a correct agent may run one the map does not name for it.
     */
    free?: boolean;
    /** How many moves of the walk come before the turn; 1, the first move, when absent. */
    at?: number;
    /**
     * The turn runs this tool and the reply reports its returned fields: the Then adds the patterns of the
     * flow's `states` relations that state a returned field of the tool, filled from the cell.
     */
    report?: string;
  };
  /**
   * A turn said after the walk's first move that names a context value (who the user is) and asks for nothing:
   * the conversation stays on the stage it reached, no tool runs, and the walk goes on after it.
   */
  aside?: { phrase: ProposalPhrase; carries: Pick[] };
  /**
   * A request said just before the walk's move from `stage` to `to`, which calls `call.tool`: the user asks
   * for the tool with another value of `call.field` first, then states the move's own value in the move (a
   * restated slot). The request's call carries the move's arguments with `call.value`, and its reply states
   * the tool's returned fields as the move's does; the move then expects its own value, the latest one.
   */
  before?: {
    stage: string;
    to: string;
    stimulus: Stimulus;
    carries: Pick[];
    call: { tool: string; field: string; value: Assertion };
  };
  /**
   * A clean walk declares one perturbation, drawn among the classes it can take. With this, it declares one
   * for every class it can take: the stage graph's walks do, so no class depends on a draw to be declared.
   */
  perturbEvery?: boolean;
  /**
   * The perturbation a clean walk must declare: this class said at this stage of the path. A first-turn
   * class whose recovery stays on the start stage has no Then an idle reply fails, so it is no block of the
   * walk; declared here, a perturbed run says it and checks its recovery. The walk fails without it. A class
   * whose recovery moves the conversation elsewhere (a goal shift goes back to intake) cuts the walk at that
   * stage: the perturbation is said after the walk's last turn, so no later turn starts from a stage the
   * conversation has left.
   */
  perturb?: { classId: string; stage: string };
};

export type Scenario =
  | {
      ok: true;
      cell: Pick[];
      blocks: BlockDraft[];
      /** Tool output partitions whose bound values the reply assertions read. */
      replyData: Pick[];
      endState?: EndStateSpec;
      rules?: Rules;
      /** The probe as placed: its class, the stage it is said at, the tool that fails. */
      probe?: { classId: string; stage: string; tool?: string };
      /** A deviation a perturbed run injects into the clean walk, with the recovery as its Then. */
      perturbations?: PerturbationSpec[];
      title: string;
    }
  | { ok: false; reason: string };

type Built = Extract<Scenario, { ok: true }>;

/** One tool's forced answer in a Given world. */
type ToolAnswer = NonNullable<WorldState['tools']>[string];

/** True when a phrase belongs to `dimension=value`. */
function isOf(phrase: ProposalPhrase, dimension: string, value: string): boolean {
  return phrase.dimension === dimension && phrase.value === value;
}

export function buildScenario(prepared: PreparedMap, rng: Rng, request: ScenarioRequest): Scenario {
  const { path } = request;
  const relations = prepared.relations;
  const dimensions = prepared.space.dimensions;
  const indexOf = (id: string) =>
    request.dimensionIndex
      ? (request.dimensionIndex.get(id) ?? -1)
      : dimensions.findIndex((dimension) => dimension.id === id);

  // The cell: the fixed values, the flow, and a value for every dimension the path's `when` names.
  const cell: Pick[] = [...request.fixed];
  const flowDimension = indexOf('flow');
  const flowValue = dimensions[flowDimension]?.index.get(path.flow);
  if (flowDimension < 0 || flowValue === undefined)
    return failedScenario(path, `the flow ${path.flow} is not in the map`);
  const heldFlow = held(cell, flowDimension);
  if (heldFlow && heldFlow[1] !== flowValue) {
    return failedScenario(
      path,
      `the cell holds the flow ${valueId(prepared, flowDimension, heldFlow[1])}, not ${path.flow}`,
    );
  }
  if (!heldFlow) cell.push([flowDimension, flowValue]);
  for (const [dimensionKey, values] of Object.entries(path.when ?? {})) {
    const dimension = indexOf(dimensionKey);
    if (dimension < 0) return failedScenario(path, `${dimensionKey} is not a dimension of the map`);
    const own = held(cell, dimension);
    if (own) {
      const id = valueId(prepared, dimension, own[1]);
      if (!values.includes(id))
        return failedScenario(path, `it needs ${dimensionKey} in ${values.join(', ')}; the cell holds ${id}`);
      continue;
    }
    let indices = request.pathValues?.get(dimensionKey);
    if (!indices) {
      const resolved: number[] = [];
      for (const value of values) {
        const index = dimensions[dimension]?.index.get(value);
        if (index !== undefined) resolved.push(index);
      }
      indices = resolved;
    }
    const chosen = pick(rng, prepared.feasibility.allowedValues(cell, dimension, indices));
    if (chosen === undefined)
      return failedScenario(
        path,
        `the constraints allow no value of ${dimensionKey} it needs with this cell`,
      );
    cell.push([dimension, chosen]);
  }
  // A behaviour phrase must exercise a declared call in a cell where it applies. Resolve every
  // condition dimension before building the walk: contextAxes later fills only the remaining axes.
  // This also lets conditional input bindings and flow assertions see the same values as the phrase.
  if (request.turn?.usesTools?.length) {
    const stage = path.stages[request.turn.at ?? 1];
    const calls = request.turn.usesTools.filter(
      (call) => call.stage === stage && (call.to === undefined || call.to === stage),
    );
    const keys = [...new Set(calls.flatMap((call) => Object.keys(call.when ?? {})))];
    const stageKey = prepared.stage === undefined ? 'stage' : dimensionId(prepared, prepared.stage);
    const fits = (picks: Pick[]) => {
      if (!prepared.feasibility.allowed(picks)) return false;
      return path.stages.slice(1).every((name) => {
        const value = dimensions[prepared.stage ?? -1]?.index.get(name);
        return (
          prepared.stage === undefined ||
          value === undefined ||
          prepared.feasibility.allowed([
            ...picks.filter(([at]) => at !== prepared.stage),
            [prepared.stage, value],
          ])
        );
      });
    };
    // Try each relation's condition, preserving map order. Backtrack across its allowed values;
    // a condition can name any dimension, including detail dimensions that contextAxes does not draw.
    const resolve = (call: UsesToolRelation, offset: number, picks: Pick[]): Pick[] | undefined => {
      const key = keys[offset];
      if (key === undefined) return picks;
      const wanted = call.when?.[key];
      if (key === stageKey)
        return !wanted || (stage !== undefined && wanted.includes(stage))
          ? resolve(call, offset + 1, picks)
          : undefined;
      const dimension = indexOf(key);
      const own = held(picks, dimension);
      if (own)
        return !wanted || wanted.includes(valueId(prepared, dimension, own[1]))
          ? resolve(call, offset + 1, picks)
          : undefined;
      const values = dimensions[dimension]?.values ?? [];
      for (let value = 0; value < values.length; value += 1) {
        if (wanted && !wanted.includes(valueId(prepared, dimension, value))) continue;
        const next: Pick[] = [...picks, [dimension, value]];
        if (!fits(next)) continue;
        const resolved = resolve(call, offset + 1, next);
        if (resolved) return resolved;
      }
      return undefined;
    };
    let resolved: Pick[] | undefined;
    for (const call of calls) {
      resolved = resolve(call, 0, cell);
      if (resolved) break;
    }
    if (!resolved) return failedScenario(path, `no behaviour tool relation applies at ${stage}`);
    cell.push(...resolved.slice(cell.length));
  }
  if (!prepared.feasibility.allowed(cell))
    return failedScenario(path, 'the constraints forbid its values with this cell');
  // Every stage the walk reaches holds with the cell: a value the path states nothing about (a coverage
  // result on a flow that checks no coverage) rules the path out.
  if (prepared.stage !== undefined) {
    for (const stage of path.stages.slice(1)) {
      const at = dimensions[prepared.stage]?.index.get(stage);
      if (at !== undefined && !prepared.feasibility.allowed([...cell, [prepared.stage, at]]))
        return failedScenario(path, `the constraints forbid the stage ${stage} with this cell`);
    }
  }

  const stageKey = prepared.stage === undefined ? 'stage' : dimensionId(prepared, prepared.stage);
  const transitionKey =
    prepared.transition === undefined ? undefined : dimensionId(prepared, prepared.transition);
  const deviationKey =
    prepared.deviation === undefined ? undefined : dimensionId(prepared, prepared.deviation);
  const contexts = new Map<string, Context>();
  let contextSize = cell.length;
  const contextOf = (stage: string): Context => {
    if (contextSize !== cell.length) {
      contexts.clear();
      contextSize = cell.length;
    }
    const known = contexts.get(stage);
    if (known) return known;
    const context: Record<string, string> = {};
    for (const [dimension, value] of cell)
      context[dimensionId(prepared, dimension)] = valueId(prepared, dimension, value);
    context[stageKey] = stage;
    contexts.set(stage, context);
    return context;
  };

  // The slot values the cell's data values bind, and which value bound each one.
  const slots: Record<string, string> = {};
  const boundBy = new Map<string, Pick>();
  for (const entry of cell) {
    const bound = relations.binds.get(
      `${dimensionId(prepared, entry[0])}=${valueId(prepared, entry[0], entry[1])}`,
    );
    if (!bound) continue;
    for (const [slot, value] of Object.entries(bound)) {
      if (slots[slot] !== undefined) continue;
      slots[slot] = value;
      boundBy.set(slot, entry);
    }
  }

  const choosePhrase = (
    dimension: string,
    value: string,
    context: Context,
    at: Slots,
    opening = false,
  ): ProposalPhrase | undefined => {
    if (request.force && isOf(request.force, dimension, value)) {
      return phraseFits(request.force, context, at) ? request.force : undefined;
    }
    // A phrase of the flow, said on the first turn of a path of that flow, stands in for the opening move.
    if (opening && request.force && isOf(request.force, 'flow', path.flow)) {
      return phraseFits(request.force, context, at) ? request.force : undefined;
    }
    const phrases = (prepared.phrasesOf.get(phraseKey(dimension, value)) ?? []).filter((phrase) =>
      phraseFits(phrase, context, at),
    );
    return pick(rng, phrases);
  };

  /**
   * The patterns a reply that ran `tool` must hold: those of the `states` relations holding at `stage` (the
   * subject the cell holds, the `when` its values meet) that state a returned field of the tool, filled from
   * the cell. A returned field no such relation states is read in the one form the map's `states` relations
   * state every returned field in where they hold (`statedForm`), when they show one. `strict` refuses a relation that
   * reads a slot the cell does not bind; otherwise that pattern is left out.
   */
  const reportOf = (
    tool: string,
    stage: string,
    strict: boolean,
  ): { ok: true; patterns: string[] } | { ok: false; reason: string } => {
    const patterns: string[] = [];
    const stating: string[] = [];
    const read = new Set<string>();
    const context = contextOf(stage);
    for (const entry of relations.states) {
      const subject =
        entry.subject.dimension === 'flow'
          ? entry.subject.value === path.flow
          : context[entry.subject.dimension] === entry.subject.value;
      if (!subject || !matches(entry.when, context)) continue;
      for (const pattern of entry.must ?? []) {
        const out = slotsOf(pattern).filter((slot) => {
          const source = boundBy.get(slot);
          const found = source ? prepared.toolDimensions.get(source[0]) : undefined;
          return found?.direction === 'out' && found.tool.name === tool;
        });
        if (out.length === 0) continue;
        const filled = fillText(pattern, slots, true);
        if (!filled.ok) {
          if (strict)
            return {
              ok: false,
              reason: `the report of ${tool} reads unbound slots ${filled.missing.join(', ')}`,
            };
          continue;
        }
        for (const slot of out) read.add(slot);
        if (!patterns.includes(filled.value)) patterns.push(filled.value);
        stating.push(pattern);
      }
    }
    for (const pattern of statedFields(prepared, path.flow, context, tool, read)) {
      const filled = fillText(pattern, slots, true);
      if (!filled.ok) continue;
      if (!patterns.includes(filled.value)) patterns.push(filled.value);
      stating.push(pattern);
    }
    // The Given answers with the values the reply states.
    replyData.push(
      ...sourcesOf(boundBy, stating).filter(([at]) => prepared.toolDimensions.get(at)?.direction === 'out'),
    );
    return { ok: true, patterns };
  };

  // A phrase probe goes in at a stage of the path, chosen before the walk: its phrase may bind a slot a later
  // turn reads (a plan named again at the recap).
  const probe = request.probe;
  let probeAt: number | undefined;
  let recovery: Recovery | undefined;
  if (probe && probe.classId !== TOOL_FAILURE) {
    if (deviationKey === undefined) return failedScenario(path, 'the map has no deviation dimension');
    recovery = recoveryFor(relations, probe.classId, path.flow);
    if (!recovery)
      return failedScenario(path, `the map gives no recovery from ${probe.classId} in the flow ${path.flow}`);
    const allowed = path.stages
      .map((stage, index) => ({ stage, index }))
      // A probe goes in before a move, or after the last stage when its recovery keeps the conversation
      // there (a question once the order is placed); a recovery that moves it needs a move after.
      .filter(({ stage, index }) => {
        if (index <= path.stages.length - 2) return true;
        const after = recovery ? stageAfter(recovery, stage) : undefined;
        return after === undefined || after === stage;
      })
      .filter(({ index }) => index >= 1 || OPENING_CLASSES.has(probe.classId))
      .filter(({ stage, index }) => index >= 1 || discriminates(recovery as Recovery, stage, path.stages[0]))
      .filter(({ stage }) => (recovery?.at ? recovery.at.includes(stage) : true))
      .filter(({ stage }) => (probe.stage === undefined ? true : stage === probe.stage))
      // The map's constraints hold for the probe too: a class the map forbids at a stage is never said there.
      .filter(({ stage }) => {
        const stageIndex = prepared.stage;
        const deviationIndex = prepared.deviation;
        const stagePick = stageIndex === undefined ? undefined : dimensions[stageIndex]?.index.get(stage);
        const classPick =
          deviationIndex === undefined ? undefined : dimensions[deviationIndex]?.index.get(probe.classId);
        const picks: Pick[] = [...cell];
        if (stageIndex !== undefined && stagePick !== undefined) picks.push([stageIndex, stagePick]);
        if (deviationIndex !== undefined && classPick !== undefined) picks.push([deviationIndex, classPick]);
        return prepared.feasibility.allowed(picks);
      })
      .filter(({ stage }) =>
        choosePhraseExists(prepared, deviationKey, probe.classId, contextOf(stage), slots, request),
      );
    const chosen = pick(rng, allowed);
    if (!chosen) {
      if (
        probe.stage === path.stages[0] &&
        OPENING_CLASSES.has(probe.classId) &&
        probe.stage !== undefined &&
        !discriminates(recovery, probe.stage, path.stages[0]) &&
        choosePhraseExists(prepared, deviationKey, probe.classId, contextOf(probe.stage), slots, request)
      )
        return failedScenario(
          path,
          `the first-turn recovery of ${probe.classId} stays at ${probe.stage} without a required tool call; it cannot distinguish an idle or echo reply`,
        );
      return failedScenario(
        path,
        `no stage of the path takes ${probe.classId}: none its recovery allows has an approved phrase`,
      );
    }
    probeAt = chosen.index;
  }

  const toolNames = new Set(prepared.tools.map((tool) => tool.name));
  const blocks: BlockDraft[] = [];
  const replyData: Pick[] = [];
  const lang = relations.replyLanguage;
  let movedAway = false;
  let turnPlaced = false;
  // What the reply that reached the pending stage must never hold, whatever the data: the states `must_not`
  // patterns with no slot, such as narrated internal steps. A recovery that stays there is held to them too.
  let pending: { stage: string; mustNot: string[] } | undefined;
  let beforePlaced = false;
  // A free turn's block: no tool is closed on it (`turn.free`).
  let freeBlock: number | undefined;
  // A wanted perturbation whose recovery moves the conversation: the walk stops at its stage, never the last.
  let cutAt: number | undefined;
  const wantedMove = request.perturb;
  if (wantedMove && !probe && !request.turn && !request.aside) {
    const own = recoveryFor(relations, wantedMove.classId, path.flow);
    const after = own ? stageAfter(own, wantedMove.stage) : undefined;
    if (after !== undefined && after !== wantedMove.stage) {
      const at = path.stages.findIndex(
        (stage, index) =>
          stage === wantedMove.stage &&
          index + 1 < path.stages.length &&
          (index >= 1 || OPENING_CLASSES.has(wantedMove.classId)),
      );
      if (at < 0)
        return failedScenario(
          path,
          `no stage before the last takes ${wantedMove.classId} at ${wantedMove.stage}`,
        );
      cutAt = at;
    }
  }
  const moveBlocks = new Map<number, number>();
  for (let index = 0; index < path.stages.length; index += 1) {
    if (index === cutAt) break;
    if (request.turn && !request.turn.call && index === (request.turn.at ?? 1)) {
      freeBlock = request.turn.free ? blocks.length : undefined;
      const stage = path.stages[index] as string;
      const active = (request.turn.usesTools ?? []).filter(
        (call) =>
          call.stage === stage &&
          (call.to === undefined || call.to === stage) &&
          matches(call.when, contextOf(stage)),
      );
      if (request.turn.usesTools?.length && active.length === 0)
        return failedScenario(path, `no behaviour tool relation applies at ${stage} in this cell`);
      const tools = [...request.turn.tools];
      const reports = new Set(request.turn.report ? [request.turn.report] : []);
      const carries = [...request.turn.carries];
      for (const call of active) {
        const expected = toolExpect(call.tool, call.count ?? 1, call.input, slots);
        if (!expected.ok)
          return failedScenario(
            path,
            `${call.tool} at ${stage} reads unbound slots ${expected.missing.join(', ')}`,
          );
        tools.push(expected.value);
        reports.add(call.tool);
        carries.push(...sourcesOf(boundBy, call.input ?? {}));
      }
      const patterns: string[] = [];
      for (const tool of reports) {
        const report = reportOf(tool, stage, true);
        if (!report.ok) return failedScenario(path, report.reason);
        for (const pattern of report.patterns) if (!patterns.includes(pattern)) patterns.push(pattern);
      }
      blocks.push({
        ...(patterns.length > 0 ? { must: patterns } : {}),
        id: `b${blocks.length + 1}-value`,
        stimulus: request.turn.stimulus,
        stage,
        carries: unique(carries),
        tools,
        ...(lang === undefined ? {} : { lang }),
      });
      turnPlaced = true;
      break;
    }
    if (request.aside && !request.turn && index === 1) {
      const [dimension, value] = request.aside.carries[0] ?? [-1, -1];
      blocks.push({
        id: `b${blocks.length + 1}-aside`,
        stimulus: stimulusOf(
          slots,
          request.aside.phrase,
          dimensionId(prepared, dimension),
          valueId(prepared, dimension, value),
        ),
        stage: path.stages[index] as string,
        carries: request.aside.carries,
        ...(lang === undefined ? {} : { lang }),
      });
    }
    if (probeAt === index && probe && deviationKey !== undefined && recovery) {
      const stage = path.stages[index] as string;
      const deviation = dimensions[prepared.deviation ?? -1]?.index.get(probe.classId);
      if (deviation === undefined)
        return failedScenario(path, `${probe.classId} is not a value of the deviation dimension`);
      const phrase = choosePhrase(deviationKey, probe.classId, contextOf(stage), slots);
      for (const [slot, value] of Object.entries(phrase?.binds ?? {})) slots[slot] = value;
      const tools: ToolExpect[] = [];
      for (const call of recovery.tools) {
        const expected = toolExpect(call.tool, call.count, call.input, slots);
        if (!expected.ok)
          return failedScenario(
            path,
            `the recovery of ${probe.classId} reads unbound slots ${expected.missing.join(', ')}`,
          );
        tools.push(expected.value);
      }
      const must = filledWords(recovery.must, slots);
      const mustNot = filledWords(recovery.mustNot, slots);
      if (!must || !mustNot)
        return failedScenario(path, `the recovery of ${probe.classId} reads a slot the cell does not bind`);
      const after = stageAfter(recovery, stage);
      if (after === stage && pending?.stage === stage)
        for (const pattern of pending.mustNot) if (!mustNot.includes(pattern)) mustNot.push(pattern);
      blocks.push({
        id: `b${blocks.length + 1}-${probe.classId}`,
        stimulus: stimulusOf(slots, phrase, deviationKey, probe.classId),
        injection: probe.classId,
        ...(after === undefined ? {} : { stage: after }),
        // The cell records where the class is said, as a coverage cell of deviation and stage reads it.
        saidAt: stage,
        carries: [[prepared.deviation as number, deviation]],
        ...(tools.length > 0 ? { tools } : {}),
        ...(recovery.guards.length > 0 ? { guards: recovery.guards } : {}),
        ...(must.length > 0 ? { must } : {}),
        ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
        ...(lang === undefined ? {} : { lang }),
      });
      // A recovery that leaves the conversation elsewhere than the stage it had reached (a goal shift goes
      // back to the stage that owns the change) ends the walk: the path's next turn starts from a stage the
      // conversation is no longer at.
      if (after !== undefined && after !== stage) {
        movedAway = true;
        break;
      }
    }
    // The last stage takes no move: only a probe said after it.
    if (index + 1 >= path.stages.length) break;
    const from = path.stages[index] as string;
    const to = path.stages[index + 1] as string;
    const transitionId = `${from}-to-${to}`;
    const transition =
      prepared.transition === undefined
        ? undefined
        : dimensions[prepared.transition]?.index.get(transitionId);
    if (transitionKey === undefined || transition === undefined) {
      return failedScenario(path, `the map has no stage transition ${transitionId}`);
    }
    const context = contextOf(from);
    const phrase = choosePhrase(transitionKey, transitionId, context, slots, index === 0);
    for (const [slot, value] of Object.entries(phrase?.binds ?? {})) slots[slot] = value;
    const tools: ToolExpect[] = [];
    const ruled: Pick[] = [];
    for (const call of relations.usesTools) {
      // A behaviour's call is made in that behaviour's own phrase turn, never on a move.
      if (behaviourSubject(prepared, call.subject)) continue;
      const subject =
        call.subject.dimension === 'flow'
          ? call.subject.value === path.flow
          : context[call.subject.dimension] === call.subject.value;
      if (!subject || call.stage !== from || (call.to !== undefined && call.to !== to)) continue;
      if (!matches(call.when, context)) continue;
      if (toolNames.size > 0 && !toolNames.has(call.tool))
        return failedScenario(path, `${call.tool} is not a tool of the map`);
      const expected = toolExpect(call.tool, call.count, call.input, slots);
      if (!expected.ok)
        return failedScenario(
          path,
          `${call.tool} at ${from} reads unbound slots ${expected.missing.join(', ')}`,
        );
      tools.push(expected.value);
      for (const dimension of Object.keys(call.when ?? {})) {
        const at = indexOf(dimension);
        const value = held(cell, at);
        if (value) ruled.push(value);
      }
      ruled.push(...sourcesOf(boundBy, call.input ?? {}));
    }
    // What the reply of this turn must state (a quoted price read from the tool's answer), from the map.
    const stated: string[] = [];
    const unstated: string[] = [];
    // The patterns that state a returned field of the tool a `before` request runs.
    const reported: string[] = [];
    for (const entry of relations.states) {
      const subject =
        entry.subject.dimension === 'flow'
          ? entry.subject.value === path.flow
          : context[entry.subject.dimension] === entry.subject.value;
      if (!subject || entry.stage !== from || (entry.to !== undefined && entry.to !== to)) continue;
      if (!matches(entry.when, context)) continue;
      for (const slot of slotsOf([entry.must, entry.must_not])) {
        const source = boundBy.get(slot);
        if (!source || prepared.toolDimensions.get(source[0])?.direction !== 'out') continue;
        const original = relations.binds.get(
          `${dimensionId(prepared, source[0])}=${valueId(prepared, source[0], source[1])}`,
        )?.[slot];
        if (slots[slot] !== original)
          return failedScenario(path, `the phrase overrides tool output slot ${slot}`);
      }
      for (const [patterns, target] of [
        [entry.must ?? [], stated],
        [entry.must_not ?? [], unstated],
      ] as const) {
        for (const pattern of patterns) {
          const filled = fillText(pattern, slots, true);
          if (!filled.ok)
            return failedScenario(
              path,
              `what the reply states at ${from} reads unbound slots ${filled.missing.join(', ')}`,
            );
          target.push(filled.value);
          const reports = slotsOf(pattern).some((slot) => {
            const source = boundBy.get(slot);
            const found = source ? prepared.toolDimensions.get(source[0]) : undefined;
            return found?.direction === 'out' && found.tool.name === request.before?.call.tool;
          });
          if (target === stated && reports) reported.push(filled.value);
        }
      }
      for (const dimension of Object.keys(entry.when ?? {})) {
        const value = held(cell, indexOf(dimension));
        if (value) ruled.push(value);
      }
      const sources = sourcesOf(boundBy, entry.must, entry.must_not);
      ruled.push(...sources);
      replyData.push(...sources.filter(([at]) => prepared.toolDimensions.get(at)?.direction === 'out'));
    }
    pending = { stage: to, mustNot: [] };
    for (const entry of relations.states) {
      const subject =
        entry.subject.dimension === 'flow'
          ? entry.subject.value === path.flow
          : context[entry.subject.dimension] === entry.subject.value;
      if (!subject || entry.stage !== from || (entry.to !== undefined && entry.to !== to)) continue;
      if (!matches(entry.when, context)) continue;
      pending.mustNot.push(...(entry.must_not ?? []).filter((pattern) => slotsOf(pattern).length === 0));
    }
    const carries = unique([[prepared.transition as number, transition], ...ruled]);
    const ask = request.before;
    const first = ask && !beforePlaced && from === ask.stage && to === ask.to ? ask : undefined;
    const run = first ? tools.find((tool) => tool.label === first.call.tool && calls(tool)) : undefined;
    if (first && run) {
      blocks.push({
        id: `b${blocks.length + 1}-restated`,
        stimulus: first.stimulus,
        stage: from,
        saidAt: from,
        carries: first.carries,
        tools: [{ ...run, input: { ...run.input, [first.call.field]: first.call.value } }],
        ...(reported.length > 0 ? { must: reported } : {}),
        ...(lang === undefined ? {} : { lang }),
      });
      beforePlaced = true;
    }
    moveBlocks.set(index, blocks.length);
    const block: BlockDraft = {
      id: `b${blocks.length + 1}-${transitionId}`,
      stimulus: stimulusOf(slots, phrase, transitionKey, transitionId),
      stage: to,
      saidAt: from,
      carries,
    };
    if (tools.length > 0) block.tools = tools;
    if (stated.length > 0) block.must = stated;
    if (unstated.length > 0) block.must_not = unstated;
    if (lang !== undefined) block.lang = lang;
    blocks.push(block);
    const asked = request.turn?.call;
    const made = asked ? tools.find((tool) => tool.label === asked.tool && calls(tool)) : undefined;
    if (request.turn && asked && made) {
      // The run the user asks for answers from the same Given: its reply states the tool's returned fields.
      const answered = reportOf(asked.tool, to, false);
      if (!answered.ok) return failedScenario(path, answered.reason);
      blocks.push({
        id: `b${blocks.length + 1}-value`,
        stimulus: request.turn.stimulus,
        stage: to,
        carries: request.turn.carries,
        tools: [
          { ...made, input: { ...made.input, [asked.field]: asked.value } },
          ...request.turn.tools.filter((tool) => tool.label !== asked.tool),
        ],
        ...(answered.patterns.length > 0 ? { must: answered.patterns } : {}),
        ...(lang === undefined ? {} : { lang }),
      });
      turnPlaced = true;
      break;
    }
  }
  if (request.turn?.call && !turnPlaced)
    return failedScenario(path, `no move of the path calls ${request.turn.call.tool}`);
  if (request.before && !beforePlaced)
    return failedScenario(
      path,
      `no move of the path from ${request.before.stage} to ${request.before.to} calls ${request.before.call.tool}`,
    );
  if (request.turn && !turnPlaced)
    return failedScenario(path, `the path has no stage ${request.turn.at ?? 1} moves after its start`);

  let placed: Built['probe'];
  // A turn said after the walk's last move cuts nothing: the walk still reaches its end and checks its end state.
  const afterLastMove =
    request.turn !== undefined && !request.turn.call && (request.turn.at ?? 1) === path.stages.length - 1;
  let truncated = (turnPlaced && !afterLastMove) || cutAt !== undefined;
  // The answer a tool gives once it works again: the bound values the replies state, else its defaults.
  if (probe && probe.classId === TOOL_FAILURE) {
    const failed = toolFailure(prepared, rng, path, blocks, cell, probe, (tool) =>
      answering(prepared, replyData, tool),
    );
    if (!failed.ok) return failedScenario(path, failed.reason);
    placed = failed.placed;
    // A failing turn said after the walk's last move, with the recovery staying and the retry that follows, cuts
    // nothing: the walk still checks its end state.
    truncated = !(probe.onTurn && afterLastMove && failed.stays);
  } else if (probe && probeAt !== undefined) {
    placed = { classId: probe.classId, stage: path.stages[probeAt] as string };
    if (movedAway) truncated = true;
  }

  // Every tool the scenario calls is expected 0 times in a turn that does not call it; a tool it never calls
  // is forbidden in every turn.
  const inPlay = new Set<string>();
  for (const block of blocks) for (const tool of block.tools ?? []) if (calls(tool)) inPlay.add(tool.label);
  // A free turn forbids no tool for the whole walk: every other block closes every tool it does not list,
  // and the free block itself closes the side-effecting tools, which run after their own move only.
  const sideEffecting = new Set<string>();
  for (const entry of relations.paths)
    if (entry.end_state) sideEffecting.add(entry.end_state.source.replace(/^tool:/, ''));
  for (const [position, block] of blocks.entries()) {
    const listed = new Set<string>();
    for (const tool of block.tools ?? []) listed.add(tool.label);
    const closing =
      position === freeBlock
        ? [...sideEffecting]
        : freeBlock !== undefined
          ? prepared.tools.map((tool) => tool.name)
          : [...inPlay];
    const closed: ToolExpect[] = [];
    for (const label of closing) if (!listed.has(label)) closed.push({ label, count: 0 });
    if (closed.length > 0) block.tools = [...(block.tools ?? []), ...closed];
  }
  const forbidden: string[] = [];
  if (freeBlock === undefined)
    for (const tool of prepared.tools) if (!inPlay.has(tool.name)) forbidden.push(tool.name);
  const rules: Rules = {
    ...(forbidden.length > 0 ? { forbidden_tools: forbidden } : {}),
    ...(probe?.classId === 'D7_silence_or_burst' ? { one_message_per_turn: true } : {}),
  };

  // A clean walk declares one perturbation for mode P: a deviation class whose recovery keeps the
  // conversation on the stage it reached, said before the turn that leaves that stage, with the recovery as
  // its Then. The rest of the walk stays valid after it, so the perturbed run checks every later block too.
  const perturbations: PerturbationSpec[] = [];
  // A walk with an aside keeps its turns where they are: a perturbation's position counts the path's moves.
  if (
    !probe &&
    !request.turn &&
    !request.aside &&
    deviationKey !== undefined &&
    prepared.deviation !== undefined
  ) {
    const options: Array<{ classId: string; index: number; stage: string; expect: Expect; user: string }> =
      [];
    for (const value of dimensions[prepared.deviation]?.values ?? []) {
      const classId = value.id;
      if (classId === TOOL_FAILURE) continue;
      const own = recoveryFor(relations, classId, path.flow);
      if (!own) continue;
      for (let index = 0; index + 1 < path.stages.length; index += 1) {
        const stage = path.stages[index] as string;
        if (index === 0 && !OPENING_CLASSES.has(classId)) continue;
        if (own.at && !own.at.includes(stage)) continue;
        const after = stageAfter(own, stage);
        // A recovery that moves is said only where the walk was cut for it, after its last turn.
        if (after !== undefined && after !== stage && index !== cutAt) continue;
        if (cutAt !== undefined && index !== cutAt) continue;
        if (after !== undefined && after !== stage) {
          const stagePick =
            prepared.stage === undefined ? undefined : dimensions[prepared.stage]?.index.get(stage);
          const picks: Pick[] = [...cell];
          if (prepared.stage !== undefined && stagePick !== undefined)
            picks.push([prepared.stage, stagePick]);
          const classPick = dimensions[prepared.deviation]?.index.get(classId);
          if (classPick !== undefined) picks.push([prepared.deviation, classPick]);
          if (!prepared.feasibility.allowed(picks)) continue;
        }
        const said = { ...slots };
        const phrase = choosePhrase(deviationKey, classId, contextOf(stage), said);
        if (!phrase) continue;
        const text = fillText(phrase.text, { ...said, ...(phrase.binds ?? {}) });
        if (!text.ok) continue;
        const expect = recoveryExpect(own, stage, { ...said, ...(phrase.binds ?? {}) }, inPlay, lang);
        if (!expect) continue;
        options.push({
          classId,
          index: moveBlocks.get(index) ?? blocks.length,
          stage,
          expect,
          user: text.value,
        });
      }
    }
    // One class is drawn, as before; a walk that declares every class adds the others at the first stage
    // each can take, with no further draw, so the rest of the walk is the same either way.
    const wanted = request.perturb;
    const drawn = wanted
      ? options.find((option) => option.classId === wanted.classId && option.stage === wanted.stage)
      : pick(rng, options);
    if (wanted && !drawn)
      return failedScenario(
        path,
        `a clean walk cannot take ${wanted.classId} at ${wanted.stage} as its perturbation`,
      );
    const picked = drawn ? [drawn] : [];
    if (request.perturbEvery) {
      for (const option of options) {
        if (!picked.some((entry) => entry.classId === option.classId)) picked.push(option);
      }
    }
    for (const chosen of picked) {
      perturbations.push({
        id: `p${perturbations.length + 1}-${chosen.classId}`,
        class: chosen.classId as PerturbationSpec['class'],
        inject_at: chosen.index,
        user: chosen.user,
        expect: chosen.expect,
        // The map's recovery keeps the conversation where it was: the injected block itself recovers.
        recovery: { within_blocks: 0, stage_after: chosen.expect.stage as string },
      });
    }
    // A nudge gets one reply: the walk that declares one holds the rule a nudge probe holds.
    if (picked.some((chosen) => chosen.classId === 'D7_silence_or_burst')) rules.one_message_per_turn = true;
    // A tool failure the recovery stays from: before the first turn that calls a recovered tool first, the
    // user says that turn with the tool failing. The recovery is the injected block's Then, and the turn
    // itself then runs with the tool answering again. It takes no seeded draw, so the rest is unchanged.
    const failure =
      cutAt === undefined ? toolFailurePerturbation(relations, path, blocks, slots, inPlay, lang) : undefined;
    if (failure) {
      const block = blocks[failure.index] as BlockDraft;
      block.given = {
        world: {
          tools: {
            ...block.given?.world?.tools,
            [failure.tool]: answering(prepared, replyData, failure.tool),
          },
        },
      };
      perturbations.push({
        id: `p${perturbations.length + 1}-${TOOL_FAILURE}`,
        class: TOOL_FAILURE as PerturbationSpec['class'],
        inject_at: failure.index,
        user: failure.user,
        world: { tools: { [failure.tool]: { error: TOOL_FAILURE_ERROR } } },
        expect: failure.expect,
        recovery: { within_blocks: 0, stage_after: failure.expect.stage as string },
      });
    }
  }

  let end: EndStateSpec | undefined;
  if (!truncated && path.end_state) {
    const filled = endState(path.end_state, slots);
    if (!filled.ok)
      return failedScenario(path, `its end state reads unbound slots ${filled.missing.join(', ')}`);
    end = filled.value;
  }
  const title = `Path ${path.id} of ${path.flow}: ${path.stages.join(' > ')}${
    placed ? `, ${placed.classId}${placed.tool ? ` of ${placed.tool}` : ''} at ${placed.stage}` : ''
  }`;
  return {
    ok: true,
    cell,
    blocks,
    replyData: unique(replyData),
    ...(end ? { endState: end } : {}),
    ...(Object.keys(rules).length > 0 ? { rules } : {}),
    ...(placed ? { probe: placed } : {}),
    ...(perturbations.length > 0 ? { perturbations } : {}),
    title,
  };
}

/**
 * True when a recovery said on the first turn can fail a reply that does nothing: it leaves the start stage,
 * or requires a tool call or a runtime guard firing. A word it states does not help: the echo agent repeats
 * every literal word of the spec's patterns, so a `must` alone is passed by it. A recovery that stays on the
 * start stage without a required event cannot distinguish an idle reply reporting that stage.
 */
function discriminates(recovery: Recovery, stage: string, start: string | undefined): boolean {
  const after = stageAfter(recovery, stage);
  if (after !== undefined && after !== start) return true;
  return (
    recovery.tools.some((call) => requiresEvent(call.count)) ||
    recovery.guards.some((guard) => requiresEvent(guard.count))
  );
}

/** An absent count requires a firing; a range with no positive minimum permits an idle reply. */
function requiresEvent(count: Count | undefined): boolean {
  return count === undefined || (typeof count === 'number' ? count > 0 : (count.min ?? 0) > 0);
}

/**
 * The Then of a recovery said at `stage`: the stage it stays on, its calls, every other tool in play 0 times,
 * its guards and words, the reply language. Undefined when its words or calls read a slot nothing binds.
 */
function recoveryExpect(
  recovery: Recovery,
  stage: string,
  slots: Record<string, string>,
  inPlay: ReadonlySet<string>,
  lang: string | undefined,
): Expect | undefined {
  const tools: ToolExpect[] = [];
  for (const call of recovery.tools) {
    const expected = toolExpect(call.tool, call.count, call.input, slots);
    if (!expected.ok) return undefined;
    tools.push(expected.value);
  }
  for (const label of inPlay)
    if (!tools.some((tool) => tool.label === label)) tools.push({ label, count: 0 });
  const must = filledWords(recovery.must, slots);
  const mustNot = filledWords(recovery.mustNot, slots);
  if (!must || !mustNot) return undefined;
  return {
    stage: stageAfter(recovery, stage) ?? stage,
    stage_reported: true,
    ...(tools.length > 0 ? { tools } : {}),
    ...(recovery.guards.length > 0 ? { guards: recovery.guards } : {}),
    ...(must.length > 0 ? { must } : {}),
    ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
    ...(lang === undefined ? {} : { lang }),
  };
}

/**
 * The first turn of a clean walk whose first call is a tool the map recovers from without leaving the stage:
 * where a tool failure goes in perturbed mode, said with that turn's words, and what the recovery expects.
 */
function toolFailurePerturbation(
  relations: PreparedMap['relations'],
  path: PathRelation,
  blocks: readonly BlockDraft[],
  slots: Record<string, string>,
  inPlay: ReadonlySet<string>,
  lang: string | undefined,
): { index: number; tool: string; user: string; expect: Expect } | undefined {
  for (const [index, block] of blocks.entries()) {
    const stage = block.saidAt ?? (index === 0 ? path.stages[0] : blocks[index - 1]?.stage);
    const first = (block.tools ?? []).find(calls);
    if (stage === undefined || !first || block.stimulus.kind !== 'phrase') continue;
    const recovery = recoveryFor(relations, TOOL_FAILURE, path.flow, first.label);
    if (!recovery || stageAfter(recovery, stage) !== stage) continue;
    const expect = recoveryExpect(recovery, stage, slots, inPlay, lang);
    if (!expect) continue;
    // The agent sends the failing tool the arguments the turn names.
    expect.tools = (expect.tools ?? []).map((tool) =>
      tool.label === first.label && tool.input === undefined && first.input !== undefined
        ? { ...tool, input: first.input, ...(first.input_closed ? { input_closed: true } : {}) }
        : tool,
    );
    return { index, tool: first.label, user: block.stimulus.phrase.text, expect };
  }
  return undefined;
}

function choosePhraseExists(
  prepared: PreparedMap,
  dimension: string,
  value: string,
  context: Context,
  slots: Slots,
  request: ScenarioRequest,
): boolean {
  if (request.force && isOf(request.force, dimension, value))
    return phraseFits(request.force, context, slots);
  return (prepared.phrasesOf.get(phraseKey(dimension, value)) ?? []).some((phrase) =>
    phraseFits(phrase, context, slots),
  );
}

/** True when a tool expectation asks for at least one call. */
function calls(tool: ToolExpect): boolean {
  const count = tool.count ?? 1;
  return typeof count === 'number' ? count > 0 : (count.min ?? 0) > 0 || (count.max ?? 1) > 0;
}

function unique(picks: Pick[]): Pick[] {
  const seen = new Set<number>();
  return picks.filter(([dimension]) => {
    if (seen.has(dimension)) return false;
    seen.add(dimension);
    return true;
  });
}

/**
 * A tool failure: the turn of the path that calls a tool the map gives a recovery for fails it in the Given.
 * The block becomes the probe (an injection of D8 with the same user turn), expects the recovery's stage and
 * calls, and the conversation stops there. A data value of the cell that names the tool records it.
 */
function toolFailure(
  prepared: PreparedMap,
  rng: Rng,
  path: PathRelation,
  blocks: BlockDraft[],
  cell: Pick[],
  probe: ProbeRequest,
  answering: (tool: string) => ToolAnswer,
):
  | { ok: true; placed: { classId: string; stage: string; tool: string }; stays: boolean }
  | { ok: false; reason: string } {
  const recoverable = failureTools(prepared.relations, TOOL_FAILURE, path.flow);
  const named = cell
    .map(([dimension, value]) => valueId(prepared, dimension, value))
    .find((id) => recoverable.includes(id));
  const wanted = probe.tool ?? named;
  // A probe asked at a stage fails a tool of the turn said at that stage.
  const options = blocks.flatMap((block, index) =>
    (probe.stage === undefined || path.stages[index] === probe.stage ? (block.tools ?? []) : [])
      .filter((tool) => calls(tool) && recoverable.includes(tool.label))
      .filter((tool) => wanted === undefined || tool.label === wanted)
      .filter(() => !probe.onTurn || index === blocks.length - 1)
      .map((tool) => ({ index, tool: tool.label })),
  );
  const chosen = pick(rng, options);
  if (!chosen) {
    return {
      ok: false,
      reason: `no turn${probe.stage ? ` said at ${probe.stage}` : ''} calls a tool whose failure the map recovers in ${path.flow}${wanted ? ` (${wanted})` : ''}`,
    };
  }
  const recovery = recoveryFor(prepared.relations, TOOL_FAILURE, path.flow, chosen.tool) as Recovery;
  const block = blocks[chosen.index] as BlockDraft;
  // The turn as the walk says it, before it becomes the probe: the user says it again once the tool works.
  const again = structuredClone(block);
  const at = path.stages[chosen.index] as string;
  const after = stageAfter(recovery, at);
  // The turn calls its tools in the order the map lists them: the ones before the failing tool still run,
  // the ones after it never do. The recovery's calls replace or add theirs; a call the turn already
  // expected keeps its input assertions, because the agent sends the same arguments to a failing tool.
  const listed = block.tools ?? [];
  const failing = listed.findIndex((tool) => tool.label === chosen.tool);
  const tools = new Map(
    listed.map((tool, index): [string, ToolExpect] => [
      tool.label,
      index > failing && calls(tool) ? { label: tool.label, count: 0 } : tool,
    ]),
  );
  for (const call of recovery.tools) {
    const expected = toolExpect(call.tool, call.count, call.input, {});
    if (!expected.ok) return { ok: false, reason: `the recovery of ${chosen.tool} reads slots` };
    const before = tools.get(call.tool);
    const kept = expected.value.input === undefined && before !== undefined && calls(before);
    const input = expected.value.input ?? (kept ? before.input : undefined);
    const closed =
      expected.value.input === undefined ? kept && before.input_closed : expected.value.input_closed;
    tools.set(call.tool, {
      label: call.tool,
      count: expected.value.count ?? 1,
      ...(input ? { input } : {}),
      ...(input && closed ? { input_closed: true } : {}),
    });
  }
  block.tools = [...tools.values()];
  if (after === undefined) delete block.stage;
  else block.stage = after;
  block.injection = TOOL_FAILURE;
  block.id = `b${chosen.index + 1}-${TOOL_FAILURE}`;
  block.given = { world: { tools: { [chosen.tool]: { error: TOOL_FAILURE_ERROR } } } };
  if (recovery.guards.length > 0) block.guards = recovery.guards;
  // The words of the recovery: what the honest report must and must not say.
  const words = (patterns: string[]) =>
    patterns.flatMap((pattern) => {
      const filled = fillText(pattern, {}, true);
      return filled.ok ? [filled.value] : [];
    });
  const must = words(recovery.must);
  const mustNot = words(recovery.mustNot);
  // The failing turn states the recovery's words, not what the turn would have stated with an answer.
  if (must.length > 0) block.must = must;
  else delete block.must;
  if (mustNot.length > 0) block.must_not = mustNot;
  else delete block.must_not;
  const deviation = prepared.space.dimensions[prepared.deviation ?? -1]?.index.get(TOOL_FAILURE);
  if (deviation !== undefined) block.carries = [[prepared.deviation as number, deviation], ...block.carries];
  // A recovery that keeps the conversation on the stage the turn left: the user asks again, the tool answers,
  // and the walk goes on from there with every later turn as it was. One that moves it elsewhere stops it.
  const rest = blocks.splice(chosen.index + 1);
  if (after === at) {
    again.given = { world: { tools: { [chosen.tool]: answering(chosen.tool) } } };
    // The retry of a turn that asks a behaviour belongs to the failure scenario: its cell holds the class, so it is
    // no one-value sibling of the plain turn another spec says (the gate compares such pairs).
    if (probe.onTurn && deviation !== undefined)
      again.carries = [[prepared.deviation as number, deviation], ...again.carries];
    blocks.push(again, ...rest);
    blocks.forEach((entry, index) => {
      entry.id = entry.id.replace(/^b\d+-/, `b${index + 1}-`);
    });
  }
  // The failing tool as a data value of the cell, when the map names tools as data (Acme's failing_tool).
  if (named === undefined) {
    prepared.space.dimensions.forEach((dimension, index) => {
      if (dimension.kind !== 'data' || cell.some(([at]) => at === index)) return;
      const value = dimension.index.get(chosen.tool);
      if (value !== undefined && prepared.feasibility.allowed([...cell, [index, value]]))
        cell.push([index, value]);
    });
  }
  return { ok: true, placed: { classId: TOOL_FAILURE, stage: at, tool: chosen.tool }, stays: after === at };
}

/** Resolve fixed path declarations once per synchronous generation, preserving their value order. */
export function indexPathValues(
  prepared: PreparedMap,
): Map<PathRelation, ReadonlyMap<string, readonly number[]>> {
  const paths = new Map<PathRelation, ReadonlyMap<string, readonly number[]>>();
  for (const path of prepared.relations.paths) {
    const values = new Map<string, readonly number[]>();
    for (const [id, names] of Object.entries(path.when ?? {})) {
      const dimension = prepared.space.dimensions.find((entry) => entry.id === id);
      const indices: number[] = [];
      for (const name of names) {
        const index = dimension?.index.get(name);
        if (index !== undefined) indices.push(index);
      }
      values.set(id, indices);
    }
    paths.set(path, values);
  }
  return paths;
}

/** Match findIndex's first occurrence, including noncanonical maps constructed by callers. */
export function indexDimensions(prepared: PreparedMap): Map<string, number> {
  const indices = new Map<string, number>();
  prepared.space.dimensions.forEach((dimension, index) => {
    if (!indices.has(dimension.id)) indices.set(dimension.id, index);
  });
  return indices;
}

function failedScenario(path: PathRelation, reason: string): Scenario {
  return { ok: false, reason: `path ${path.id}: ${reason}` };
}
function held(cell: readonly Pick[], dimension: number): Pick | undefined {
  for (const entry of cell) if (entry[0] === dimension) return entry;
  return undefined;
}
function stimulusOf(
  slots: Slots,
  phrase: ProposalPhrase | undefined,
  dimension: string,
  value: string,
): Stimulus {
  if (!phrase) return { kind: 'placeholder', dimension, value };
  const filled = fillText(phrase.text, { ...slots, ...(phrase.binds ?? {}) });
  return { kind: 'phrase', phrase: { ...phrase, text: filled.ok ? filled.value : phrase.text } };
}
/** The data values whose slots a text or a value reads: what the block's own cell holds. */

function sourcesOf(boundBy: ReadonlyMap<string, Pick>, ...values: unknown[]): Pick[] {
  const sources: Pick[] = [];
  for (const value of values)
    for (const slot of slotsOf(value)) {
      const source = boundBy.get(slot);
      if (source) sources.push(source);
    }
  return sources;
}

function filledWords(patterns: string[], slots: Slots): string[] | undefined {
  const out: string[] = [];
  for (const pattern of patterns) {
    const filled = fillText(pattern, slots, true);
    if (!filled.ok) return undefined;
    out.push(filled.value);
  }
  return out;
}

/** Each top-level returned field of a tool the map binds a slot for: the tool, the field and the slot. */
function returnedFields(prepared: PreparedMap): Array<{ tool: string; field: string; slot: string }> {
  const out: Array<{ tool: string; field: string; slot: string }> = [];
  for (const [dimension, found] of prepared.toolDimensions) {
    if (found.direction !== 'out' || found.path.length !== 1) continue;
    const field = found.path[0] as string;
    const values = prepared.space.dimensions[dimension]?.values ?? [];
    const slots = new Set<string>();
    for (let value = 0; value < values.length; value += 1) {
      const bound = prepared.relations.binds.get(
        `${dimensionId(prepared, dimension)}=${valueId(prepared, dimension, value)}`,
      );
      for (const slot of Object.keys(bound ?? {})) slots.add(slot);
    }
    for (const slot of slots) out.push({ tool: found.tool.name, field, slot });
  }
  return out;
}

function answering(prepared: PreparedMap, replyData: Pick[], tool: string): ToolAnswer {
  const bound = worldFor(prepared, unique(replyData), { useBindings: true }).world?.tools?.[tool];
  if (bound) return bound;
  const schema = prepared.tools.find((entry) => entry.name === tool);
  return { result: (schema ? toolAnswer(schema, []).answer : {}) as never };
}

const TOOL_MARK = '\u0000';
const FIELD_MARK = '\u0001';
const VALUE_MARK = '\u0002';

/**
 * The one form the map's `states` relations state a returned field in, with the tool's label (its name with
 * spaces), the field's name and its value marked: "lookup record says found is {lookup_record_out_found}\."
 * gives "<tool> says <field> is <value>\.". Read from every `must` pattern that states one returned field and
 * nothing else, of a relation whose conditions hold in the spec: its subject (the spec's `flow`, or a value
 * `context` holds) and its `when`. Null when those patterns hold no form or more than one, or when no second
 * tool states its fields in that form anywhere in the map (one tool shows no form a second tool shares).
 */
function statedForm(prepared: PreparedMap, flow: string, context: Context): string | null {
  const bySlot = new Map(returnedFields(prepared).map((entry) => [entry.slot, entry]));
  const holding = new Set<string>();
  const toolsOf = new Map<string, Set<string>>();
  for (const entry of prepared.relations.states) {
    const subject =
      entry.subject.dimension === 'flow'
        ? entry.subject.value === flow
        : context[entry.subject.dimension] === entry.subject.value;
    const holds = subject && matches(entry.when, context);
    for (const pattern of entry.must ?? []) {
      const read = slotsIn(pattern);
      const field = read.length === 1 ? bySlot.get(read[0] as string) : undefined;
      if (!field) continue;
      const label = escapeRegExp(field.tool.replace(/_/g, ' '));
      const marked = pattern.split(`{${field.slot}}`);
      if (marked.length !== 2) continue;
      const parts = marked.map((part) => part.split(label));
      if (parts.flat().length !== 3) continue;
      const withTool = parts.map((part) => part.join(TOOL_MARK)).join(VALUE_MARK);
      const named = withTool.split(field.field);
      if (named.length !== 2) continue;
      const form = named.join(FIELD_MARK);
      if (holds) holding.add(form);
      toolsOf.set(form, new Set([...(toolsOf.get(form) ?? []), field.tool]));
    }
  }
  const form = holding.size === 1 ? ([...holding][0] as string) : undefined;
  return form !== undefined && (toolsOf.get(form)?.size ?? 0) >= 2 ? form : null;
}

/**
 * The patterns, in the one form of the relations that hold in `context`, of the returned fields of `tool`
 * whose slot is not in `read`.
 */
function statedFields(
  prepared: PreparedMap,
  flow: string,
  context: Context,
  tool: string,
  read: ReadonlySet<string>,
): string[] {
  const form = statedForm(prepared, flow, context);
  if (form === null) return [];
  return returnedFields(prepared)
    .filter((entry) => entry.tool === tool && !read.has(entry.slot))
    .map((entry) =>
      form
        .replace(TOOL_MARK, escapeRegExp(tool.replace(/_/g, ' ')))
        .replace(FIELD_MARK, escapeRegExp(entry.field))
        .replace(VALUE_MARK, `{${entry.slot}}`),
    );
}

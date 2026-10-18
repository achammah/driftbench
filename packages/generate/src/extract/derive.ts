import type { Inventory } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import { OPENING_CLASSES, TOOL_FAILURE } from '../seed/deviation';
import { type Relations, readRelations, recoveryFor, stageAfter } from '../seed/relations';
import { ForbidIndex } from './forbid-index';
import {
  FLOW_DIMENSION,
  type PathRelation,
  type Proposal,
  type TaskFamilyRelation,
  valueApproved,
} from './proposal';

/**
 * Constraints the map's own relations imply. The written constraints are pairwise and never tie a stage to
 * its flow, so a space built from them alone counts cells no conversation can reach: a behaviour of an
 * existing customer at a stage only the new-customer flow passes, a loose confirmation at a stage its
 * recovery rules out, a deviation after the last stage of every path. A pair holding a stage or a deviation
 * class is possible when an approved path can carry it:
 *
 * - a stage with another value: some path passes the stage, the path's flow and branch values are allowed
 *   with that value, and something is said at the stage (a move reaches it, or a probe is said there);
 * - a deviation class: some path has a stage where the class can be said (its recovery allows the stage,
 *   an approved phrase fits the stage and the flow, the first turn takes only a class a first message can
 *   carry, a probe after the last stage only keeps the conversation there, a tool failure needs a call of a
 *   tool the map recovers from on the turn said at that stage);
 * - `none` with a stage: some path reaches the stage by a move;
 * - any other pair: one event (one path or task family) holds both values, a data or task value only where
 *   the path's branch or the family states it, and `none` there otherwise.
 * The derived ones say why in their reason. With no
 * approved path the map states no flow structure, and nothing is derived.
 */

type Picks = Record<string, string>;
type Forbid = { forbid: Record<string, string>; reason: string };
type Axis = { id: string; kind: string; values: string[] };

export function derivedConstraints(
  proposal: Proposal,
  axes: readonly Axis[],
  inventory?: Inventory,
): Forbid[] {
  const approvedValue = (dimension: string, value: string) => {
    const found = proposal.dimensions.find((candidate) => candidate.id === dimension);
    const entry = found?.values.find((candidate) => candidate.id === value);
    return found !== undefined && entry !== undefined && valueApproved(found, entry);
  };
  const relations = readRelations(proposal, approvedValue);
  if (relations.paths.length === 0 && relations.taskFamilies.length === 0) return [];
  const stageAxis = axes.find((axis) => axis.kind === 'stage');
  const deviationAxis = axes.find((axis) => axis.kind === 'deviation');
  // The written constraints, looked up by the picks they forbid: a check costs the same however many there are.
  const written = new ForbidIndex();
  for (const constraint of proposal.constraints) if (constraint.approved) written.add(constraint.forbid);
  const allowed = (picks: Picks) => !written.holds(picks);
  const phrases = (proposal.phrases ?? []).filter((phrase) => phrase.approved);

  /**
   * Whether the path's flow and some choice of its branch values are allowed with `extra`, and with one of
   * the values `need` lists per dimension (what the phrase said there requires).
   */
  const fits = (
    path: PathRelation,
    extra: Picks,
    need: Record<string, string[]> = {},
    ownership = true,
  ): boolean => {
    if (inventory && ownership) {
      const flow = inventory.flows?.find((entry) => entry.id === path.flow);
      for (const axis of axes) {
        const value = extra[axis.id];
        if (axis.kind !== 'behaviour' || axis.id === 'stage_transition' || value === undefined) continue;
        if (
          axis.id === FLOW_DIMENSION
            ? value !== path.flow
            : value !== path.flow && !flow?.behaviours?.includes(value as never)
        )
          return false;
      }
    }
    const merged = new Map<string, string[]>(Object.entries(path.when ?? {}));
    for (const [dimension, values] of Object.entries(need)) {
      const own = merged.get(dimension);
      merged.set(dimension, own ? own.filter((value) => values.includes(value)) : values);
    }
    const branches = [...merged.entries()];
    const choose = (index: number, picks: Picks): boolean => {
      if (index === branches.length) return allowed(picks);
      const [dimension, values] = branches[index] as [string, string[]];
      return values.some((value) =>
        picks[dimension] !== undefined && picks[dimension] !== value
          ? false
          : choose(index + 1, { ...picks, [dimension]: value }),
      );
    };
    if (extra[FLOW_DIMENSION] !== undefined && extra[FLOW_DIMENSION] !== path.flow) return false;
    return choose(0, { ...extra, [FLOW_DIMENSION]: path.flow });
  };

  /**
   * The ways `deviation` can be said at position `index` of the path: none when it cannot, else one entry
   * per fitting phrase with the values that phrase needs (a tool failure needs none).
   */
  const probe = (
    relationsOf: Relations,
    path: PathRelation,
    index: number,
    deviation: string,
  ): Array<Record<string, string[]>> => {
    const stage = path.stages[index] as string;
    const last = index === path.stages.length - 1;
    if (deviation === TOOL_FAILURE) {
      if (last) return [];
      const calls = relationsOf.usesTools.some(
        (call) =>
          call.subject.dimension === FLOW_DIMENSION &&
          call.subject.value === path.flow &&
          call.stage === stage &&
          recoveryFor(relationsOf, TOOL_FAILURE, path.flow, call.tool) !== undefined,
      );
      return calls ? [{}] : [];
    }
    const recovery = recoveryFor(relationsOf, deviation, path.flow);
    if (!recovery) return [];
    if (recovery.at && !recovery.at.includes(stage)) return [];
    if (index === 0 && !OPENING_CLASSES.has(deviation)) return [];
    if (last) {
      const after = stageAfter(recovery, stage);
      if (after !== undefined && after !== stage) return [];
    }
    return phrases
      .filter(
        (phrase) =>
          phrase.dimension === deviationAxis?.id &&
          phrase.value === deviation &&
          (phrase.when?.stage === undefined || phrase.when.stage.includes(stage)) &&
          (phrase.when?.[FLOW_DIMENSION] === undefined || phrase.when[FLOW_DIMENSION].includes(path.flow)),
      )
      .map((phrase) => {
        const need: Record<string, string[]> = {};
        for (const [dimension, values] of Object.entries(phrase.when ?? {}))
          if (dimension !== 'stage' && dimension !== FLOW_DIMENSION) need[dimension] = values;
        return need;
      });
  };

  const classes = (deviationAxis?.values ?? []).filter((value) => value !== NONE);
  /** Every (path, position) where an event can place: a move reaches it, or a class is said there. */
  type Event = {
    path: PathRelation;
    stage: string;
    deviation: string;
    need: Record<string, string[]>;
    /** The task family the event comes from; a path of a conversation has none. */
    task?: TaskFamilyRelation;
  };
  const kindOf = new Map(axes.map((axis) => [axis.id, axis.kind]));
  const events: Event[] = relations.paths.flatMap((path) =>
    path.stages.flatMap((stage, index) => {
      const said = classes.flatMap((deviation) =>
        probe(relations, path, index, deviation).map((need) => ({ path, stage, deviation, need })),
      );
      return [...(index >= 1 ? [{ path, stage, deviation: NONE, need: {} }] : []), ...said];
    }),
  );
  // A task family writes its flow's specs: each block of an instance places on its stage, and a variant that
  // carries a class (an instruction planted in a file) places that class on the first block's stage.
  for (const family of relations.taskFamilies) {
    const path: PathRelation = {
      kind: 'path',
      id: `task:${family.flow}`,
      flow: family.flow,
      stages: family.stages,
      ...(family.holds ? { when: family.holds } : {}),
      evidence: family.evidence,
      produced_by: family.produced_by,
      approved: true,
    };
    for (const stage of family.stages) events.push({ path, stage, deviation: NONE, need: {}, task: family });
    for (const deviation of family.deviations ?? [])
      events.push({ path, stage: family.stages[0] as string, deviation, need: {}, task: family });
  }

  const out: Forbid[] = [];
  // The derived forbids so far, looked up the same way, so a cell is checked against them in constant time.
  const derived = new ForbidIndex();
  const derive = (entry: Forbid) => {
    out.push(entry);
    derived.add(entry.forbid);
  };
  const possible = (cell: Picks, ownership = true): boolean =>
    events.some((event) => {
      if (stageAxis && cell[stageAxis.id] !== undefined && cell[stageAxis.id] !== event.stage) return false;
      if (deviationAxis && cell[deviationAxis.id] !== undefined && cell[deviationAxis.id] !== event.deviation)
        return false;
      // A data or task value is held only where the path's branch or the family states that dimension;
      // anywhere else the spec holds `none` there. A conversation holds no task setting.
      for (const [dimension, value] of Object.entries(cell)) {
        if (dimension === stageAxis?.id || dimension === deviationAxis?.id) continue;
        const kind = kindOf.get(dimension);
        if (kind !== 'data' && kind !== 'task') continue;
        const stated = event.task ? event.task.holds?.[dimension] : event.path.when?.[dimension];
        const held = kind === 'task' && event.task === undefined ? undefined : stated;
        if (value === NONE ? held !== undefined : held === undefined || !held.includes(value)) return false;
      }
      // The written constraints hold for the event's stage and class too.
      const picks: Picks = { ...cell };
      if (stageAxis) picks[stageAxis.id] = event.stage;
      if (deviationAxis) picks[deviationAxis.id] = event.deviation;
      return fits(event.path, picks, event.need, ownership);
    });
  for (const [a, first] of axes.entries()) {
    for (const second of axes.slice(a + 1)) {
      for (const x of first.values) {
        for (const y of second.values) {
          const cell: Picks = { [first.id]: x, [second.id]: y };
          if (!allowed(cell)) continue;
          if (!possible(cell))
            derive({
              forbid: cell,
              reason:
                inventory && possible(cell, false)
                  ? `derived from inventory and relations: no flow listing the behaviours can carry ${first.id}=${x} with ${second.id}=${y}`
                  : `derived from the relations: no approved path carries ${first.id}=${x} with ${second.id}=${y}`,
            });
        }
      }
    }
  }
  // Pairwise ownership does not imply a reachable triple: one flow may hold the behaviour and
  // stage, another the behaviour and class, and a third the stage and class. Keep the joint ownership
  // constraint too; otherwise a triple target still asks for an event no owning flow can supply.
  if (inventory) {
    for (const [a, first] of axes.entries()) {
      for (let b = a + 1; b < axes.length; b += 1) {
        const second = axes[b] as Axis;
        for (const third of axes.slice(b + 1)) {
          if (![first, second, third].some((axis) => axis.kind === 'behaviour')) continue;
          for (const x of first.values) {
            for (const y of second.values) {
              for (const z of third.values) {
                const cell = { [first.id]: x, [second.id]: y, [third.id]: z };
                if (!allowed(cell)) continue;
                if (derived.holds(cell)) continue;
                if (!possible(cell) && possible(cell, false))
                  derive({
                    forbid: cell,
                    reason: `derived from inventory and relations: no flow listing the behaviours can carry ${Object.entries(
                      cell,
                    )
                      .map(([key, value]) => `${key}=${value}`)
                      .join(' with ')}`,
                  });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

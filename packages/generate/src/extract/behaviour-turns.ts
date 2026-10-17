import type { Inventory } from '@agent-nexus/driftbench-core';
import { TOOL_FAILURE } from '../seed/deviation';
import { failureTools, type Relations, slotsOf } from '../seed/relations';
import { FLOW_DIMENSION, type PathRelation, type UsesToolRelation } from './proposal';

/** The flows that hold a behaviour: those the inventory lists it in, and the flow of that name. */
export function flowsHolding(
  inventory: Inventory | undefined,
  paths: readonly PathRelation[],
  behaviour: string,
): string[] {
  const flows = (inventory?.flows ?? [])
    .filter((flow) => flow.id === behaviour || (flow.behaviours ?? []).includes(behaviour as never))
    .map((flow) => flow.id);
  const own = paths.some((path) => path.flow === behaviour);
  return own && !flows.includes(behaviour) ? [behaviour, ...flows] : flows;
}

/** The tools a path ends on with a write: a failure of one of them is never a read that can be asked again. */
export function writeTools(paths: readonly PathRelation[]): Set<string> {
  return new Set(
    paths.flatMap((path) => (path.end_state ? [path.end_state.source.replace(/^tool:/, '')] : [])),
  );
}

/**
 * The single rule for a tool failure on a turn that asks a behaviour, shared by the reachability the map
 * derives, the joint feasibility the target counts and the builder of the probe, so the three agree on which
 * cells exist. A behaviour's `uses_tool` makes a call in the turn that asks the behaviour, on the stage it
 * names and without leaving it. That call can fail when:
 * - the tool is not one a path ends on with a write (it can be asked again);
 * - the behaviour has an approved phrase that states no slot and binds none, which is what the turn says;
 * - a flow that holds the behaviour recovers from the tool's failure.
 * Each use that qualifies is returned with the flows for which it does.
 */
export function failableBehaviourTurns(input: {
  relations: Relations;
  /** Approved phrases of the map. */
  phrases: ReadonlyArray<{ dimension: string; value: string; text: string; binds?: object }>;
  inventory: Inventory | undefined;
  /** True for the id of a behaviour dimension other than the flow dimension. */
  isBehaviour: (dimension: string) => boolean;
}): Array<{ use: UsesToolRelation; flows: string[] }> {
  const { relations, phrases, inventory, isBehaviour } = input;
  const writes = writeTools(relations.paths);
  const askable = new Set(
    phrases
      .filter((phrase) => Object.keys(phrase.binds ?? {}).length === 0 && slotsOf(phrase.text).length === 0)
      .map((phrase) => `${phrase.dimension}=${phrase.value}`),
  );
  return relations.usesTools.flatMap((use) => {
    if (use.subject.dimension === FLOW_DIMENSION || !isBehaviour(use.subject.dimension)) return [];
    if (use.to !== undefined && use.to !== use.stage) return [];
    if (writes.has(use.tool) || !askable.has(`${use.subject.dimension}=${use.subject.value}`)) return [];
    const flows = flowsHolding(inventory, relations.paths, use.subject.value).filter((flow) =>
      failureTools(relations, TOOL_FAILURE, flow).includes(use.tool),
    );
    return flows.length === 0 ? [] : [{ use, flows }];
  });
}

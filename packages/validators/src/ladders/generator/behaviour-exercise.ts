import type { DeviationClass } from '@agent-nexus/driftbench-core';
import type { HiddenSpec } from './hidden';

type ExerciseSpec = Pick<HiddenSpec, 'behaviours' | 'flows' | 'uses'>;

/** What a conversation must do to exercise a behaviour: call its tool, or meet a deviation class. */
export type Exercise = { tool?: string; deviation?: DeviationClass };

/**
 * A behaviour is exercised by a conversation of a flow that owns it. So the flow must be able to do what the
 * behaviour is about: call its tool (a `uses` entry of the flow) and recover the class it answers (the class
 * in the flow's list). A behaviour whose only owners cannot is unreachable, whatever a generator does.
 *
 * Keep every drawn ownership. Where no owner can exercise a behaviour, give it ONE more owner that can (the
 * first flow in the specification's order). Where no flow can, change nothing: the specification states a
 * tool no flow calls, which is a gap of the map and not of the ownership. No random draw is consumed.
 */
export function ensureBehavioursExercisable(spec: ExerciseSpec, needs: ReadonlyMap<string, Exercise>): void {
  for (const behaviour of spec.behaviours) {
    const need = needs.get(behaviour.id);
    if (!need || (need.tool === undefined && need.deviation === undefined)) continue;
    const can = (flow: ExerciseSpec['flows'][number]) =>
      (need.tool === undefined || spec.uses.some((use) => use.flow === flow.id && use.tool === need.tool)) &&
      (need.deviation === undefined || flow.deviations.includes(need.deviation));
    if (spec.flows.some((flow) => flow.behaviours.includes(behaviour.id) && can(flow))) continue;
    const target = spec.flows.find(can);
    if (!target) continue;
    const owned = new Set([...target.behaviours, behaviour.id]);
    target.behaviours = spec.behaviours.filter((entry) => owned.has(entry.id)).map((entry) => entry.id);
  }
}

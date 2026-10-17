import type { HiddenSpec } from './hidden';

type CapacitySpec = Pick<HiddenSpec, 'behaviours' | 'flows' | 'paths' | 'uses' | 'tools'>;

/**
 * Every required behaviour phrase needs an owning flow and a distinct post-read (flow, stage) slot.
 * Preserve all drawn ownership and first maximize the matching over every originally drawn edge.
 * Only unmatched behaviours gain an owner. This fixture invariant is independent of seeds and names.
 * No random draw is consumed. Insufficient total path capacity is an invalid fixture, never a waiver.
 */
export function ensureBehaviourCapacity(spec: CapacitySpec): void {
  const slots = new Map<string, { flow: string; stage: string }>();
  for (const path of spec.paths) {
    const reads = new Set(
      spec.uses
        .filter(
          (use) =>
            use.flow === path.flow && spec.tools.some((tool) => tool.name === use.tool && !tool.sideEffect),
        )
        .map((use) => use.tool),
    );
    for (let at = 1; at < path.stages.length; at++) {
      const ready = [...reads].every((tool) =>
        spec.uses.some(
          (use) =>
            use.flow === path.flow &&
            use.tool === tool &&
            path.stages
              .slice(0, at)
              .some((stage, index) => stage === use.from && path.stages[index + 1] === use.to),
        ),
      );
      const stage = path.stages[at];
      if (ready && stage !== undefined)
        slots.set(JSON.stringify([path.flow, stage]), { flow: path.flow, stage });
    }
  }
  const occupied = new Map<string, string>();
  const seat = (behaviour: string, visited: Set<string>): boolean => {
    for (const [key, slot] of slots) {
      if (
        visited.has(key) ||
        !spec.flows.some((flow) => flow.id === slot.flow && flow.behaviours.includes(behaviour))
      )
        continue;
      visited.add(key);
      const previous = occupied.get(key);
      if (previous === undefined || seat(previous, visited)) {
        occupied.set(key, behaviour);
        return true;
      }
    }
    return false;
  };
  // Finish the maximum matching before adding any owner: an early orphan must not consume
  // capacity that a later, originally owned behaviour needs. Each new edge can raise matching
  // cardinality by at most one, so one edge per unmatched behaviour is globally minimal.
  for (const behaviour of spec.behaviours) seat(behaviour.id, new Set());
  const matched = new Set(occupied.values());
  for (const behaviour of spec.behaviours) {
    if (matched.has(behaviour.id)) continue;
    const free = [...slots].find(
      ([key, slot]) => !occupied.has(key) && spec.flows.some((flow) => flow.id === slot.flow),
    );
    if (!free) throw new Error('hidden behaviour phrases exceed distinct post-read path capacity');
    const [key, slot] = free;
    const flow = spec.flows.find((flow) => flow.id === slot.flow);
    if (!flow) throw new Error('hidden phrase slot has no owning flow');
    const owned = new Set([...flow.behaviours, behaviour.id]);
    flow.behaviours = spec.behaviours.filter((entry) => owned.has(entry.id)).map((entry) => entry.id);
    occupied.set(key, behaviour.id);
  }
}

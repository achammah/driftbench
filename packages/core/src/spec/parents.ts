import type { Spec } from '../schema/spec';

/**
 * The parent links of a spec. A block may name its parent by block id or by position (counting from 0);
 * blocks that name none are roots. Together the blocks form a forest, and a child runs after its parent.
 */

type Linked = Pick<Spec, 'blocks'>;

/** The position of each block's parent: `undefined` for a root, `null` when the link names no block. */
export function parentIndexes(spec: Linked): (number | null | undefined)[] {
  const byId = new Map<string, number>();
  spec.blocks.forEach((block, index) => {
    if (block.id !== undefined && !byId.has(block.id)) byId.set(block.id, index);
  });
  return spec.blocks.map((block) => {
    const parent = block.parent;
    if (parent === undefined) return undefined;
    if (typeof parent === 'number') return parent < spec.blocks.length ? parent : null;
    return byId.get(parent) ?? null;
  });
}

/**
 * The blocks that lie on a cycle of parent links, one list per cycle, each from its lowest position.
 * A block that is its own parent is a cycle of one.
 */
export function parentCycles(spec: Linked): number[][] {
  const parents = parentIndexes(spec);
  const state = new Map<number, 'open' | 'done'>();
  const cycles: number[][] = [];
  for (let start = 0; start < parents.length; start++) {
    if (state.has(start)) continue;
    const path: number[] = [];
    let at: number | null | undefined = start;
    while (typeof at === 'number' && !state.has(at)) {
      state.set(at, 'open');
      path.push(at);
      at = parents[at];
    }
    if (typeof at === 'number' && state.get(at) === 'open') {
      const cycle = path.slice(path.indexOf(at));
      const lowest = cycle.indexOf(Math.min(...cycle));
      cycles.push([...cycle.slice(lowest), ...cycle.slice(0, lowest)]);
    }
    for (const index of path) state.set(index, 'done');
  }
  return cycles;
}

/**
 * The order the blocks run in: every child after its parent, otherwise the order of the spec. A spec whose
 * parents are all listed before their children runs in its own order. A link to no block, or on a cycle,
 * adds no constraint (the loader refuses such a spec, so this only keeps the function total).
 */
export function runOrder(spec: Linked): number[] {
  const parents = parentIndexes(spec);
  const done = new Set<number>();
  const order: number[] = [];
  const visiting = new Set<number>();
  const visit = (index: number): void => {
    if (done.has(index) || visiting.has(index)) return;
    visiting.add(index);
    const parent = parents[index];
    if (typeof parent === 'number') visit(parent);
    visiting.delete(index);
    if (done.has(index)) return;
    done.add(index);
    order.push(index);
  };
  for (let index = 0; index < spec.blocks.length; index++) visit(index);
  return order;
}

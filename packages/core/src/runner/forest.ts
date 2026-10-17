import type { Spec } from '../schema/spec';

/** The forest a spec's parent links make: each block's parent, and the order the blocks run in. */
export type Forest = {
  /** The spec index of each block's parent; a root has none. */
  parents: ReadonlyMap<number, number>;
  /** Every spec index once, each block after its parent. Blocks keep their written order otherwise. */
  order: readonly number[];
};

/**
 * The forest of a spec, or undefined when no block names a parent: such a spec keeps the sequential
 * behaviour of F and P and the canonical behaviour of T. A parent written after its child (a forward
 * reference) runs first. A link to no block, or a cycle, is a spec error the loader reports; here it is ignored.
 */
export function forestOf(spec: Spec): Forest | undefined {
  if (!spec.blocks.some((block) => block.parent !== undefined)) return undefined;
  const byId = new Map<string, number>();
  spec.blocks.forEach((block, index) => {
    if (block.id !== undefined && !byId.has(block.id)) byId.set(block.id, index);
  });
  const parents = new Map<number, number>();
  spec.blocks.forEach((block, index) => {
    const parent = block.parent === undefined ? undefined : byId.get(block.parent);
    if (parent !== undefined && parent !== index) parents.set(index, parent);
  });
  const placed = new Set<number>();
  const order: number[] = [];
  const place = (index: number, path: Set<number>): void => {
    if (placed.has(index) || path.has(index)) return;
    path.add(index);
    const parent = parents.get(index);
    if (parent !== undefined) place(parent, path);
    path.delete(index);
    if (placed.has(index)) return;
    placed.add(index);
    order.push(index);
  };
  for (let index = 0; index < spec.blocks.length; index++) place(index, new Set());
  return { parents, order };
}

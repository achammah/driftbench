import type { Spec } from '../schema/spec';

/**
 * The parent links of a spec as block indices: child index to parent index. Undefined when no block names a
 * parent, so a spec without links runs as one conversation, as it always did. A parent id that names no block is
 * left out: the loader refuses it (`PARENT_MISSING`).
 */
export function parentLinks(spec: Pick<Spec, 'blocks'>): ReadonlyMap<number, number> | undefined {
  let links: Map<number, number> | undefined;
  const byId = new Map<string, number>();
  spec.blocks.forEach((block, index) => {
    if (block.id !== undefined && !byId.has(block.id)) byId.set(block.id, index);
  });
  spec.blocks.forEach((block, index) => {
    if (block.parent === undefined) return;
    links ??= new Map();
    const parent = byId.get(block.parent);
    if (parent !== undefined) links.set(index, parent);
  });
  return links;
}

/**
 * The order the blocks run in: the order the spec lists them, except that a parent runs before its children, so
 * a parent listed after its child moves up to just before it. A spec with no parent listed late keeps its order.
 */
export function executionOrder(spec: Pick<Spec, 'blocks'>): number[] {
  const links = parentLinks(spec);
  const order: number[] = [];
  if (!links) return spec.blocks.map((_, index) => index);
  const placed = new Set<number>();
  const place = (index: number) => {
    if (placed.has(index)) return;
    placed.add(index);
    const parent = links.get(index);
    if (parent !== undefined) place(parent);
    order.push(index);
  };
  for (let index = 0; index < spec.blocks.length; index++) place(index);
  return order;
}

/** The block indices from the root of the tree down to `index`, itself last. A cycle stops where it closes. */
export function lineage(links: ReadonlyMap<number, number>, index: number): number[] {
  const chain = [index];
  for (let at = links.get(index); at !== undefined && !chain.includes(at); at = links.get(at)) {
    chain.unshift(at);
  }
  return chain;
}

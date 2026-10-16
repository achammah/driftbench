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

/** The block indices from the root of the tree down to `index`, itself last. A cycle stops where it closes. */
export function lineage(links: ReadonlyMap<number, number>, index: number): number[] {
  const chain = [index];
  for (let at = links.get(index); at !== undefined && !chain.includes(at); at = links.get(at)) {
    chain.unshift(at);
  }
  return chain;
}

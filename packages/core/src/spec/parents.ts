import type { Spec } from '../schema/spec';
import { error, type Issue } from './issues';

/**
 * The parent links of a spec: a link to a block id that exists loads, whether the block is written
 * before or after; a link to no block is PARENT_MISSING; a link back to its own block, directly or
 * through a chain, is PARENT_CYCLE.
 */
export function checkParents(spec: Spec): Issue[] {
  const issues: Issue[] = [];
  const indexOf = new Map<string, number>();
  spec.blocks.forEach((block, index) => {
    if (block.id !== undefined && !indexOf.has(block.id)) indexOf.set(block.id, index);
  });
  const parentOf = (index: number): number | undefined => {
    const parent = spec.blocks[index]?.parent;
    return parent === undefined ? undefined : indexOf.get(parent);
  };

  spec.blocks.forEach((block, index) => {
    if (block.parent === undefined) return;
    if (!indexOf.has(block.parent)) {
      issues.push(
        error(
          'PARENT_MISSING',
          `blocks.${index}.parent`,
          `parent block "${block.parent}" does not exist in this spec`,
        ),
      );
    }
  });

  // A cycle is reported once, at the first block of the chain in written order.
  const state = new Map<number, 'walking' | 'done'>();
  spec.blocks.forEach((_, start) => {
    const chain: number[] = [];
    let at: number | undefined = start;
    while (at !== undefined && state.get(at) === undefined) {
      state.set(at, 'walking');
      chain.push(at);
      at = parentOf(at);
    }
    if (at !== undefined && state.get(at) === 'walking') {
      const first = Math.min(...chain.slice(chain.indexOf(at)));
      issues.push(
        error('PARENT_CYCLE', `blocks.${first}.parent`, 'parent links form a cycle, back to this block'),
      );
    }
    for (const index of chain) state.set(index, 'done');
  });
  return issues;
}

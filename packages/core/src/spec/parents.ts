import type { Spec } from '../schema/spec';
import { error, type Issue } from './issues';

/** Stable dependency order; indices always refer to the authored spec. */
export function parentOrder(spec: Spec): { order: number[]; issues: Issue[] } {
  const ids = new Map(
    spec.blocks.flatMap((block, index) => (block.id === undefined ? [] : [[block.id, index] as const])),
  );
  const marks = new Map<number, 'visiting' | 'done'>();
  const order: number[] = [];
  const issues: Issue[] = [];
  const visit = (index: number) => {
    if (marks.get(index) === 'done') return;
    if (marks.get(index) === 'visiting') {
      issues.push(error('PARENT_CYCLE', `blocks.${index}.parent`, 'parent links form a cycle'));
      return;
    }
    marks.set(index, 'visiting');
    const parent = spec.blocks[index]?.parent;
    if (parent !== undefined) {
      const at = ids.get(parent);
      if (at === undefined)
        issues.push(
          error(
            'PARENT_MISSING',
            `blocks.${index}.parent`,
            `parent block "${parent}" does not exist in this spec`,
          ),
        );
      else visit(at);
    }
    marks.set(index, 'done');
    order.push(index);
  };
  spec.blocks.forEach((_, index) => {
    visit(index);
  });
  return { order, issues };
}

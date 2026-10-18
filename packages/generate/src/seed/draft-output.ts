import type { SpecDraft } from './assemble';
import type { SeedContext } from './seed-drafts';

/** The eager API retains drafts; the disk API consumes one at a time with the same numbering. */
export function draftOutput(context: SeedContext) {
  const drafts: SpecDraft[] = [];
  let count = 0;
  return {
    drafts,
    get count() {
      return count;
    },
    push(draft: SpecDraft) {
      context.allocation?.observeDraft(draft);
      count += 1;
      if (context.emit) context.emit(draft);
      else drafts.push(draft);
    },
  };
}

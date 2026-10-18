import type { ItemContext, Outcome, Run } from '../bank/types';
import { fail, pass } from '../bank/types';
import type { CutResult } from '../sut/port';
import { type Block, type Composed, type ComposeOptions, compose } from './compose';
import { type CutCheck, compareCut } from './oracle';

export type Extra = (doc: Composed, got: CutResult) => string | undefined;

/** Composes the blocks, cuts the text with the reader, and compares the cut with the composer's truth. */
export async function cutCase(
  ctx: ItemContext,
  blocks: readonly Block[],
  options: ComposeOptions = {},
  check: CutCheck = {},
  extra?: Extra,
): Promise<Outcome> {
  const doc = compose(blocks, options);
  const got = await ctx.sut.cut({ path: 'doc.md', text: doc.text });
  const problem = compareCut(doc.text, got, doc.units, check) ?? extra?.(doc, got);
  return problem ? fail(problem) : pass(`${doc.units.length} units, ${doc.text.length} characters`);
}

/** A runner for a fixed list of blocks built from the seeded prose. */
export function cutRun(
  build: (
    ctx: ItemContext,
  ) => Block[] | { blocks: Block[]; options?: ComposeOptions; check?: CutCheck; extra?: Extra },
): Run {
  return async (ctx) => {
    const made = build(ctx);
    if (Array.isArray(made)) return cutCase(ctx, made);
    return cutCase(ctx, made.blocks, made.options, made.check, made.extra);
  };
}

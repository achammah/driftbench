import { defineLadder, type Ladder } from '../../ladder';
import { blocksBank, levelMeasure } from './bank';
import { type BlocksProduct, realProduct } from './product';
import { BANK_LEVELS, type BankItem } from './types';

export { bankProblems, blocksBank, itemSeed, levelMeasure, MIN_BANK, MIN_FAMILY, runItem } from './bank';
export { CHEATERS, type Cheater } from './fakes';
export { type BlocksProduct, Missing, maybe, need, type ProductPatch, patched, realProduct } from './product';
export { BANK_LEVELS, type BankItem, type ItemContext, type ItemResult } from './types';

/** The version of the blocks ladder (docs/validators.md section 12.5: floors are per ladder version). */
export const BLOCKS_LADDER_VERSION = 2;

export type BlocksLadderOptions = {
  /** Replaces the bank: tests run a few items. */
  bank?: BankItem[];
  /** The product the items measure: the repository's by default, a cheating one in the tests. */
  product?: BlocksProduct;
};

/**
 * The blocks validator (docs/validators.md section 13): does the block redesign work as a whole. One level per
 * capability, in the order the redesign builds them: verdicts, tool history, intervals, rule objects, value
 * checks, diagnostics, parent blocks, section links, blast radius and personas. Each level is a sub-bank of
 * planted-truth items with threshold 1, run through the product's own runner, loader, report and command line;
 * the run stops at the first failing level and names its failing items.
 */
export function blocksLadder(options: BlocksLadderOptions = {}): Ladder {
  const bank = options.bank ?? blocksBank();
  const product = options.product ?? realProduct();
  return defineLadder({
    component: 'blocks',
    version: BLOCKS_LADDER_VERSION,
    levels: BANK_LEVELS.map((level) => {
      const items = bank.filter((item) => item.level === level.level);
      const families = [...new Set(items.map((item) => item.family))].join(', ');
      return {
        id: level.id,
        name: level.name,
        metric: `items passing / items, ${items.length} items (${families})`,
        threshold: 1,
        compute: ({ seed, root }) => levelMeasure(items, seed, root, product),
      };
    }),
  });
}

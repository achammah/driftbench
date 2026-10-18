import type { StemDef } from './types';

/**
 * Family budget-order: traffic weight orders rows, most common first, so a budget cuts the rarest rows first (clause P7, ruling of 2026-10-17, assumptions
 * A1, A3 and A4). The oracle computes every row's weight itself, from the shares in the store, as a sum of logs.
 * Level plan-order.
 */
export const BUDGET: readonly StemDef[] = [
  {
    id: 'budget.prefix-of-full-plan',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'P7',
    assumption: ['A4'],
    generator:
      'A space with skewed shares; the plan without a budget, then with a budget at the middle, 1, all but one, above the total, and with seeds; nested budgets (3, or every budget from 0 to the total plus 2); a budget of 0 with no seeds.',
    oracle:
      'The plan with budget B is the first min(B, total) rows of the plan without a budget (same ids, kinds, values), so its length is exact and no padding row is invented; a larger budget extends a smaller one; a budget of 0 without seeds gives no row.',
    cause: 'a budget keeps the first rows of the unbudgeted plan',
    variants: [
      ['middle', 2],
      ['one-row', 1],
      ['all-but-one', 3],
      ['with-seeds', 3],
      ['above-total', 2],
      ['three-budgets-nested', 3],
      ['every-budget-nested', 4],
      ['every-budget-length', 2],
      ['seeds-plus-budget-length', 3],
      ['zero-budget', 3],
    ],
  },
  {
    id: 'budget.new-rows-common-first',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'P7',
    assumption: ['A1', 'A3'],
    generator:
      'Spaces of 4 and 10 variables with skewed shares, and a space with equal shares; a budget that keeps a tenth, a half, or all but the last third of the plan, with and without seeds.',
    oracle:
      'After the seeds, the log weight of the new rows never increases along the plan (most common first; equal weights may sit in any order); every new row a budget drops is at most as common as every new row it keeps, so the rarest rows are cut first and seed rows are always kept.',
    cause:
      'new rows are ordered by traffic weight, most common first, so a budget cuts the rarest rows first',
    variants: [
      ['four-variables', 2],
      ['ten-variables', 3],
      ['equal-shares-ties', 3],
      ['cut-tight-budget', 3],
      ['cut-with-seeds', 3],
      ['cut-half-budget', 3],
    ],
  },
  {
    id: 'budget.invalid-values',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'H7',
    assumption: ['A7'],
    generator: 'A budget of -1, NaN, 1.5, and the string "10".',
    oracle: 'The call throws a RangeError whose message names the budget.',
    cause: 'a budget that is not a non-negative whole number is refused with a RangeError that names it',
    variants: [
      ['negative', 4],
      ['nan', 4],
      ['fraction', 4],
      ['string', 5],
    ],
  },
  {
    id: 'budget.log-space-weights',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'H7',
    assumption: ['A3'],
    generator:
      'Rows of 200 variables whose shares are about 0.01 (the product underflows to 0 in doubles) and 100 skewed variables.',
    oracle: 'The log weight of the new rows never increases along the plan.',
    cause: 'row weights are compared in log space so long rows keep their order',
    variants: [
      ['two-hundred-variables', 5],
      ['skewed-hundred', 5],
    ],
  },
  {
    id: 'budget.weights-from-store',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'P7',
    assumption: ['A3'],
    generator:
      'The same space whose shares come from owner weights, or from a store built from conversations; the ordering is checked against those shares.',
    oracle: 'The order of the new rows follows the shares in the store, whatever their provenance.',
    cause: "the traffic weight of a row reads the store's weights, whatever their source",
    variants: [
      ['owner-declared', 3],
      ['from-conversations', 4],
    ],
  },
  {
    id: 'budget.uniform-without-weights',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'P7',
    generator: 'A store with no weight at all, and a store where only some variables have weights.',
    oracle:
      'The prefix property holds; with no weights the rows are ordered consistently with equal weights; with some weights, a variable without weights counts as uniform.',
    cause: 'variables without weights count as uniform',
    variants: [
      ['no-weights', 2],
      ['partial-weights', 3],
    ],
  },
  {
    id: 'budget.weight-reported',
    family: 'budget-order',
    component: 'planner/budget',
    need: 'P7',
    assumption: ['A3'],
    generator: 'Rows of 3 to 6 variables with shares that sum to 1 and are all above 0.',
    oracle: 'Each new row reports weight equal to the product of its value shares within 1e-9 relative.',
    cause: 'each plan row reports its traffic weight as the product of its value shares',
    variants: [
      ['short-rows', 3],
      ['uneven-shares', 3],
    ],
  },
];

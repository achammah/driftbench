import type { StemDef } from './types';

/**
 * Family seed-rows: real sessions enter first as seed rows, kept as they are; new rows cover only the tuples
 * the seeds miss (clause P6). Seeds are drawn from the space: random valid rows, or all valid rows of a small
 * space, or the rows of a covering the bank builds itself. Level plan-order.
 */
export const SEEDS: readonly StemDef[] = [
  {
    id: 'seeds.lead-the-plan',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator:
      '1, 5 or 30 seed rows; partial seeds that leave variables out; seeds whose traffic weights would reorder them; seeds whose keys come in another order.',
    oracle:
      'The first rows of the plan are the seeds, in the order given, marked as seeds, with the very values given (no key added, none dropped); every later row is marked new.',
    cause: 'seed rows lead the plan, in the order given, unchanged, marked as seeds',
    variants: [
      ['one-seed', 1],
      ['five-seeds', 1],
      ['thirty-seeds', 2],
      ['partial-seeds', 3],
      ['weights-would-reorder', 3],
      ['key-order-differs', 3],
    ],
  },
  {
    id: 'seeds.new-rows-for-missing',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator:
      'Seeds that cover about 30, 50 or 90 percent of the required tuples, or all but the rare tuples; 3 random seeds; seeds that already cover every required tuple (all valid rows of a small space of binary axes, of a rule, of a mixed space).',
    oracle:
      'Seeds plus new rows cover every required tuple; each new row holds at least one required tuple that no seed holds (so full seeds give no new row); the new rows number at most 1.25 x the greedy bound of the tuples the seeds miss, plus one, and fewer than the plan without seeds.',
    cause: 'new rows are added only for tuples the seeds miss, each covering at least one',
    variants: [
      ['random-three-seeds', 2],
      ['full-seeds-binary-axes', 2],
      ['full-seeds-rule-triples', 3],
      ['full-seeds-mixed', 3],
      ['thirty-percent-covered', 3],
      ['half-covered', 3],
      ['ninety-percent-covered', 3],
      ['rare-tuples-only', 4],
      ['mostly-covered', 4],
    ],
  },
  {
    id: 'seeds.partial-rows-credit',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator:
      'Partial seeds that assign only some variables; a seed that assigns two of the three variables of a rule.',
    oracle:
      'A seed credits only the tuples whose variables it assigns: the tuples it cannot hold are covered by new rows.',
    cause: 'a seed row covers only the tuples whose variables it assigns',
    variants: [
      ['assigned-variables-only', 3],
      ['triple-needs-three-assigned', 4],
    ],
  },
  {
    id: 'seeds.empty-list',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator: 'The seed option as an empty array, and absent.',
    oracle: 'The plan equals the plan of the same call without the option.',
    cause: 'an empty seed list changes nothing',
    variants: [
      ['empty-array', 1],
      ['absent-option', 1],
    ],
  },
  {
    id: 'seeds.credit-at-every-strength',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator:
      'Seeds that hold every value of every variable but few pairs; seeds that hold all axis pairs but few rule triples; seeds that miss one value only.',
    oracle:
      'New rows exist exactly for the tuples missing at each strength: the plan covers all of them and each new row holds a missing tuple.',
    cause: 'seed coverage is credited at every group strength',
    variants: [
      ['values-missing', 3],
      ['pairs-missing', 3],
      ['triples-missing', 4],
    ],
  },
  {
    id: 'seeds.row-ids-unique',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator: 'Plans with seeds and new rows, and with 200 rows.',
    oracle: 'Every plan row has a non-empty string id and the ids are unique.',
    cause: 'every plan row has an id and the ids are unique',
    variants: [
      ['plain', 2],
      ['many', 3],
    ],
  },
  {
    id: 'seeds.no-duplicate-rows',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P6',
    generator:
      'A small space where one new row would equal a seed, and a space where two new rows could be equal.',
    oracle: 'No new row repeats a seed or another new row.',
    cause: 'no new row repeats a seed or another new row',
    variants: [
      ['new-vs-seed', 3],
      ['new-vs-new', 3],
    ],
  },
  {
    id: 'seeds.many-seeds',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'H4',
    generator: '500 and 3,000 random seed rows over 20 shared axes with skewed weights.',
    oracle:
      'Seeds lead the plan; every required tuple is covered; new rows are at most 1.25 x the bound of the missing tuples; at most 8 s of processor time.',
    cause: 'seed credit stays linear in the number of seeds',
    variants: [
      ['five-hundred', 4],
      ['three-thousand', 5],
    ],
  },
  {
    id: 'seeds.pure-copy',
    family: 'seed-rows',
    component: 'planner/seeds',
    need: 'P9',
    generator: 'Seed objects passed in, the plan read, then a plan row written to.',
    oracle:
      "The caller's seed objects are never the plan's row objects, and writing to the plan leaves them unchanged.",
    cause: "plan seed rows are copies, not the caller's objects",
    variants: [
      ['seed-objects-not-aliased', 3],
      ['later-mutation-safe', 4],
    ],
  },
];

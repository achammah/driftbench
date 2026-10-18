import type { StemDef } from './types';

/**
 * Family impossible-pairs: impossible pairs never appear (clause P8), and the tuples they exclude are not
 * required. The generator draws small random spaces; every variable keeps a "universal" value that no pair names,
 * so a tuple without a forbidden pair always extends to a valid row, except where an item says otherwise.
 * Level constraints.
 */
export const IMPOSSIBLE: readonly StemDef[] = [
  {
    id: 'impossible.rows-avoid-pairs',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    generator:
      "A space of 2 to 8 variables with 1 to 3 impossible pairs, on plain variables, on shared axes, or inside a rule's variables.",
    oracle: 'No plan row holds both values of any impossible pair.',
    cause: 'plan rows never hold two values the store marks impossible',
    variants: [
      ['two-variables', 1],
      ['five-variables', 1],
      ['three-pairs', 2],
      ['pair-on-shared-axes', 2],
      ['pair-inside-rule', 2],
    ],
  },
  {
    id: 'impossible.required-tuples-skip-pairs',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    assumption: ['A2'],
    generator:
      'A pair that sits inside one rule group, inside the shared axes, or between two groups; and six variables of arity 3 to 4 where 30, 50 or 70 percent of the pairs among non-universal values are impossible.',
    oracle:
      'Every allowed required tuple (tuples with no impossible pair) is covered, checked by exhaustive enumeration; the plan ends; no row holds a pair.',
    cause: 'required tuples exclude those that hold an impossible pair',
    variants: [
      ['inside-rule-group', 2],
      ['inside-axes', 2],
      ['across-groups', 3],
      ['dense-thirty-percent', 3],
      ['dense-fifty-percent', 4],
      ['dense-seventy-percent', 5],
    ],
  },
  {
    id: 'impossible.unordered',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    generator: 'The same pair declared as (a, b) and as (b, a), alone and mixed with other pairs.',
    oracle: 'The plan equals the plan of the store that declares the pair the other way round.',
    cause: 'an impossible pair is unordered',
    variants: [
      ['reversed', 2],
      ['mixed-order', 3],
    ],
  },
  {
    id: 'impossible.duplicates-count-once',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    generator: 'A pair declared three times, and in both orders.',
    oracle: 'The plan equals the plan of the store that declares the pair once.',
    cause: 'repeated impossible pairs count once',
    variants: [
      ['thrice', 2],
      ['both-orders', 3],
    ],
  },
  {
    id: 'impossible.same-variable-pair',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    generator: 'A pair of two values of one variable, on a plain variable and on a variable of a rule.',
    oracle: 'The plan equals the plan without the pair: one variable never holds two values in a row.',
    cause: 'a pair of two values of one variable changes nothing',
    variants: [
      ['two-values-of-one-variable', 2],
      ['inside-rule', 3],
    ],
  },
  {
    id: 'impossible.unknown-reference',
    family: 'impossible-pairs',
    component: 'store/owner',
    need: 'P2',
    assumption: ['A10'],
    generator: 'Owner pairs that name an unknown variable, an unknown value of a known variable, or both.',
    oracle: 'The pair is not in the store and the refusal list names it with a reason.',
    cause: 'an owner pair that names an unknown variable or value is refused with a reason',
    variants: [
      ['unknown-variable', 3],
      ['unknown-value', 3],
      ['both-unknown', 3],
    ],
  },
  {
    id: 'impossible.forced-out-value',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    assumption: ['A2'],
    generator:
      'A value that every value of another variable forbids: directly, through a chain of two pairs, or inside a rule group.',
    oracle:
      'The value is in no row; no tuple that holds it is required; every other allowed required tuple is covered.',
    cause: 'a value that no partner value allows is never used and never required',
    variants: [
      ['one-step', 3],
      ['two-step-chain', 4],
      ['in-rule-group', 4],
    ],
  },
  {
    id: 'impossible.unsatisfiable-space',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P8',
    assumption: ['A6'],
    generator:
      'Two single-valued variables whose only values are forbidden together; a cycle of pairs with no valid row.',
    oracle:
      'The plan has no new row, or the call throws an error that names a conflicting variable; it ends within 10 s.',
    cause: 'a space with no valid row yields no rows or a named error, never an invalid row',
    variants: [
      ['two-single-valued', 3],
      ['cycle', 5],
    ],
  },
  {
    id: 'impossible.tight-chain',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'H7',
    assumption: ['A2'],
    generator:
      'Spaces where few rows are valid: eight binary variables whose neighbours must differ (2 valid rows), five ternary variables whose neighbours must differ, six variables of which exactly one is on; a hub value compatible with one partner of every other variable; a value that excludes all but one value of another variable.',
    oracle:
      'Every row is valid and every allowed required tuple is covered (the required set comes from the valid rows).',
    cause: 'row construction completes tightly constrained rows by search, not by chance',
    variants: [
      ['alternating-binary', 5],
      ['no-equal-neighbours-ternary', 5],
      ['exactly-one-of', 5],
      ['hub-one-partner', 4],
      ['one-value-excludes-all-but-one', 4],
    ],
  },
  {
    id: 'impossible.with-seeds',
    family: 'impossible-pairs',
    component: 'planner/constraints',
    need: 'P6',
    generator:
      'Valid seed rows, some of them one value away from an impossible pair, on a constrained space.',
    oracle:
      'Seeds lead the plan unchanged; no new row holds a pair; the allowed required tuples are covered.',
    cause: 'new rows next to seeds still avoid impossible pairs',
    variants: [
      ['valid-seeds', 3],
      ['seeds-next-to-forbidden', 4],
    ],
  },
];

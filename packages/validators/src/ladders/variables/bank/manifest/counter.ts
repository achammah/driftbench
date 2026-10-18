import type { StemDef } from './types';

/**
 * Family counter: the count of allowed and covered tuples, as a differential against exhaustive enumeration
 * (clause P13) and against closed forms where the space is too large to enumerate. `coverage(store, rows,
 * groups)` returns the number of distinct allowed tuples of the groups and how many the rows hold. Level counter.
 */
export const COUNTER: readonly StemDef[] = [
  {
    id: 'counter.closed-form',
    family: 'counter',
    component: 'planner/counter',
    need: 'P13',
    generator:
      'Variables of one arity v: (k, v, t) = (5, 3, 2), (12, 4, 3), (50, 7, 1), (6, 2, 9) with t above k, (200, 2, 3); and mixed arities: (2, 3, 5) at t = 2, 30 variables of arity 1 to 9 at t = 3, arities that include 1, arities up to 100000 at t = 3. One group, no rows.',
    oracle:
      'allowed = e_m of the arities, with m = min(t, k) the strength capped at the group size, computed exactly with big integers (C(k, m) v^m when all arities equal v); covered = 0.',
    cause: 'the counter sums the products of arities over every subset of min(t, k) variables',
    variants: [
      ['five-three-two', 1],
      ['fifty-seven-one', 1],
      ['twelve-four-three', 2],
      ['t-above-k', 2],
      ['three-variables-mixed', 2],
      ['thirty-mixed-t3', 3],
      ['with-arity-one', 3],
      ['two-hundred-binary-three', 4],
      ['large-arities', 4],
    ],
  },
  {
    id: 'counter.constraints-matching',
    family: 'counter',
    component: 'planner/counter',
    need: 'H6',
    generator:
      'Impossible pairs on disjoint variable pairs (a matching): 5 pairs among 20 variables at t = 2 and 3; 100 pairs among 200 variables at t = 3.',
    oracle:
      'allowed = the coefficient of z^t in the product of (1 + (a+b) z + (ab - f) z^2) over matched pairs and (1 + a z) over the rest, with f the pairs between the two variables.',
    cause: 'the counter removes tuples that hold an impossible pair',
    variants: [
      ['five-pairs-t2', 3],
      ['five-pairs-t3', 4],
      ['hundred-pairs-two-hundred-variables', 5],
    ],
  },
  {
    id: 'counter.brute-force-weak-equals-strict',
    family: 'counter',
    component: 'planner/counter',
    need: 'P13',
    assumption: ['A2'],
    generator:
      'Random spaces of 4 to 6 variables of arity 2 to 4 with random pairs among non-universal values, so a tuple without a pair always extends; groups of strength 1, 2 or 3.',
    oracle:
      'allowed equals the number of distinct tuples that appear in a valid full row, by exhaustive enumeration of the product.',
    cause: 'the counter agrees with exhaustive enumeration on random small spaces',
    variants: [
      ['t1', 3],
      ['t2', 3],
      ['t3', 4],
    ],
  },
  {
    id: 'counter.strict-extendable',
    family: 'counter',
    component: 'planner/counter',
    need: 'P13',
    assumption: ['A2'],
    generator:
      'Random constraints that can make a tuple pairwise fine but impossible to extend: dense pairs, several groups of different strength, one group over all variables; and designed spaces: a triangle of pairs, a forced-out value, a two-step chain, a space with no valid row.',
    oracle:
      'allowed equals the number of distinct tuples that appear in some valid full row, by exhaustive enumeration; a space with no valid row has allowed 0.',
    cause: 'a tuple counts as allowed only when some valid full row holds it',
    variants: [
      ['random-constraints', 4],
      ['dense', 5],
      ['per-group-strengths', 4],
      ['single-group-all-variables', 3],
      ['triangle', 4],
      ['forced-out', 4],
      ['two-step', 5],
      ['empty-space', 5],
    ],
  },
  {
    id: 'counter.covered-complete-rows',
    family: 'counter',
    component: 'planner/counter',
    need: 'P13',
    generator: '5 or 30 random valid rows on a small space, and every valid row.',
    oracle: 'covered equals the number of distinct allowed tuples held by the rows, by enumeration.',
    cause: 'the counter counts the distinct allowed tuples the rows hold',
    variants: [
      ['five-rows', 2],
      ['thirty-rows', 3],
      ['rows-cover-all', 3],
    ],
  },
  {
    id: 'counter.covered-partial-rows',
    family: 'counter',
    component: 'planner/counter',
    need: 'P6',
    generator: 'Rows that leave some variables out, on spaces of 4 to 6 variables.',
    oracle:
      'A row covers a tuple only when it assigns every variable of the tuple; covered equals the enumerated count.',
    cause: 'a partial row covers only tuples inside its assigned variables',
    variants: [
      ['some-missing', 3],
      ['half-assigned', 3],
    ],
  },
  {
    id: 'counter.overlapping-groups',
    family: 'counter',
    component: 'planner/counter',
    need: 'P13',
    generator:
      'Two groups over the same variables; a group nested in another; groups of strength 2 and 3 on shared variables.',
    oracle: 'allowed and covered count each distinct tuple once, by enumeration of the union.',
    cause: 'a tuple shared by overlapping groups counts once',
    variants: [
      ['same-subset-twice', 3],
      ['nested', 4],
      ['different-strengths', 3],
    ],
  },
  {
    id: 'counter.exact-beyond-2-53',
    family: 'counter',
    component: 'planner/counter',
    need: 'H7',
    generator: '40 variables of arity 1000 at t = 6; mixed arities up to 5000 at t = 5.',
    oracle: 'The count equals the exact big-integer value; a number result is accepted only below 2^53.',
    cause: 'counts beyond 2 to the 53 are exact (bigint)',
    variants: [
      ['big-uniform', 4],
      ['big-mixed', 5],
    ],
  },
  {
    id: 'counter.uncovered-list',
    family: 'counter',
    component: 'planner/counter',
    need: 'P13',
    generator:
      'Rows that cover part of a small space; a limit of 5, a limit larger than the uncovered set, and rows that cover everything.',
    oracle:
      'The listed tuples are distinct, allowed and uncovered; their number is min(limit, uncovered); with a sufficiently large limit they are all of them.',
    cause: 'the counter lists the uncovered tuples, up to a limit',
    variants: [
      ['limit-five', 3],
      ['none-uncovered', 2],
      ['full-list', 4],
    ],
  },
  {
    id: 'counter.invalid-arguments',
    family: 'counter',
    component: 'planner/counter',
    need: 'H7',
    assumption: ['A7'],
    generator:
      'A group that names an unknown variable, a strength of 0, a strength of 1.5, and a group that lists a variable twice.',
    oracle: 'The call throws a RangeError whose message names the argument at fault.',
    cause: 'the counter refuses an unknown variable or a strength that is not a positive whole number',
    variants: [
      ['unknown-variable', 4],
      ['strength-zero', 4],
      ['fractional-strength', 4],
      ['duplicate-variable', 5],
    ],
  },
  {
    id: 'counter.no-enumeration',
    family: 'counter',
    component: 'planner/counter',
    need: 'H4',
    generator: '200 and 500 binary variables at strength 3 with no rows.',
    oracle: 'The count is exact and the call takes at most 50 ms of processor time.',
    cause: 'the allowed count comes from a formula, not from enumerating tuples',
    variants: [
      ['two-hundred-variables-t3', 4],
      ['five-hundred-variables-t3', 5],
    ],
  },
];

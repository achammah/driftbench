import type { StemDef } from './types';

/**
 * Family strength: the plan covers every allowed tuple at strength 3 on each rule's own variables, 2 on the
 * shared axes and 1 on every other variable (clause P5), checked by an independent brute-force counter on small
 * spaces (clause P12). Row counts are bounded by the greedy bound ceil(ln T / -ln(1 - p)) with T the number of
 * tuples to cover and p the smallest chance that a uniform random row holds one of them, times 1.25. Level
 * strength.
 */
export const STRENGTH: readonly StemDef[] = [
  {
    id: 'strength.others-at-one',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator:
      'Variables in no rule and no shared axis: 3 binary, 10 of arity 2 to 5, a single variable, a variable of arity 1.',
    oracle: 'Every value of every variable is held by some row (brute force over the rows).',
    cause: 'variables outside every rule and axis are covered at strength 1',
    variants: [
      ['three-variables', 1],
      ['mixed-arity', 2],
      ['single-variable', 1],
      ['arity-one', 1],
    ],
  },
  {
    id: 'strength.others-economy',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator: '30 or 100 variables of arity 5, none in a rule or an axis.',
    oracle:
      'The plan has at most 2 x 5 rows (strength 1 needs 5): pairs on these variables are not required.',
    cause: 'variables outside the rules and axes cost rows by arity only',
    variants: [
      ['thirty-variables', 3],
      ['hundred-variables', 4],
    ],
  },
  {
    id: 'strength.axes-at-two',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator:
      'Shared axes only: 3 axes of arity 2, 3, 4; 6 axes; 6 axes with one of arity 1; 12 binary axes; one axis of 7, 1 or 20 values beside three binary axes.',
    oracle:
      'Every allowed pair of values of every pair of axes is held by some row; rows are within the greedy bound.',
    cause: 'shared axes are covered at strength 2',
    variants: [
      ['three-axes', 2],
      ['six-axes', 3],
      ['six-axes-one-single-valued', 3],
      ['twelve-binary', 4],
      ['one-axis-of-seven', 3],
      ['one-axis-of-one', 2],
      ['one-axis-of-twenty', 4],
    ],
  },
  {
    id: 'strength.rule-at-three',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator:
      'One rule with 3 variables; 4 binary; 5 ternary; 7 binary; 4 of mixed arity; 12 binary; 4 quaternary.',
    oracle:
      "Every allowed triple of values of every 3 of the rule's variables is held by some row; rows are within the greedy bound.",
    cause: "each rule's own variables are covered at strength 3",
    variants: [
      ['three-variables', 2],
      ['four-binary', 2],
      ['five-ternary', 3],
      ['seven-binary', 3],
      ['mixed-arity', 3],
      ['four-quaternary', 3],
      ['twelve-binary', 4],
    ],
  },
  {
    id: 'strength.small-groups',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    assumption: ['A8'],
    generator: 'A rule with 2 variables of arity 3 and 4, a rule with 1 variable, a rule with none.',
    oracle:
      "The full cross product of the rule's variables is covered; a rule with no variable changes nothing; no call throws.",
    cause: 'a group smaller than its strength is covered in full',
    variants: [
      ['two-variables', 2],
      ['one-variable', 1],
      ['no-variable', 2],
    ],
  },
  {
    id: 'strength.overlapping-rules',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator: 'Two rules of 4 variables that share 2 variables, and two rules that share 3.',
    oracle:
      'The triples of both rules are covered, each shared triple once; rows are within the bound of the union.',
    cause: 'rules that share variables are covered on the union of their triples',
    variants: [
      ['share-two', 3],
      ['share-three', 4],
    ],
  },
  {
    id: 'strength.axis-in-rule',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator: 'A rule whose variables include one shared axis, and a rule made only of shared axes.',
    oracle: 'The pairs of the axes and the triples of the rule are all covered.',
    cause: 'a variable that is both an axis and a rule variable meets both strengths',
    variants: [
      ['one-shared', 3],
      ['all-shared', 4],
    ],
  },
  {
    id: 'strength.no-uniform-explosion',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator: '10, then 40 rules of 4 binary variables each, plus 10 shared axes and 20 other variables.',
    oracle:
      'Every required tuple is covered and the rows stay within 1.25 x the greedy bound of the required set: strength 3 across all variables would need many times more.',
    cause: "strength 3 applies only inside a rule's own variables",
    variants: [
      ['ten-rules', 3],
      ['mixed-groups', 4],
      ['forty-rules', 5],
    ],
  },
  {
    id: 'strength.row-economy',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator: 'One rule of 6 binary, 5 ternary, 4 quaternary or 8 binary variables.',
    oracle:
      'The rows are fewer than 0.6 of the full product and within the greedy bound: a covering array, not the product.',
    cause: 'rows are chosen to cover many uncovered tuples at once, not by taking the full product',
    variants: [
      ['six-binary', 3],
      ['five-ternary', 3],
      ['four-quaternary', 4],
      ['eight-binary', 4],
    ],
  },
  {
    id: 'strength.rows-complete-and-valid',
    family: 'strength',
    component: 'planner/strength',
    need: 'P5',
    generator: 'Small spaces, spaces with rules and axes, spaces of mixed arity.',
    oracle: "Every new row has exactly the store's variables as keys, each with one of its listed values.",
    cause: 'each new row holds exactly one valid value for every variable',
    variants: [
      ['small', 1],
      ['rules-and-axes', 2],
      ['mixed-arity', 3],
    ],
  },
  {
    id: 'strength.report-matches-counter',
    family: 'strength',
    component: 'planner/strength',
    need: 'P12',
    generator: 'Spaces of axes only, of rules only, and of both with seeds.',
    oracle:
      "The plan report's allowed and covered counts equal the independent brute-force counts of the required tuples and of the tuples the plan covers.",
    cause: 'the plan report counts allowed and covered tuples exactly',
    variants: [
      ['axes', 3],
      ['rules', 3],
      ['mixed', 4],
    ],
  },
  {
    id: 'strength.any-seed-integer',
    family: 'strength',
    component: 'planner/strength',
    need: 'H7',
    generator: 'The seed option 0, -1, 2147483648 and 9007199254740991 on a space with rules and axes.',
    oracle: 'The plan covers every allowed required tuple under each seed.',
    cause: 'any integer seed gives a complete array',
    variants: [
      ['zero', 2],
      ['negative', 3],
      ['large', 4],
    ],
  },
];

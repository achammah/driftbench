import type { StemDef } from './types';

/**
 * Family scale: correct and slow is a failing item (docs/validators.md 12.2 rule 4). Budgets are processor time
 * (process.cpuUsage), so a busy machine does not fail an item. Row counts are bounded by the greedy bound times
 * 1.25. Level scale.
 */
export const SCALE: readonly StemDef[] = [
  {
    id: 'scale.pairwise-binary',
    family: 'scale',
    component: 'planner/scale',
    need: 'P10',
    generator:
      'n shared binary axes, n = 20, 50, 100, 200, 400 (the same cause covers ternary and arity-eight axes below).',
    oracle:
      'Every pair of values of every pair of axes is held by some row (a scan over the pairs); rows <= 1.25 x ceil(ln T / -ln(3/4)); processor time within the budget (10 s at 200, 30 s at 400).',
    cause: 'the planner builds a pairwise array over hundreds of binary variables with a bounded row count',
    variants: [
      ['n20', 3],
      ['n50', 3],
      ['n100', 4],
      ['n200', 4],
      ['n400', 5],
      ['ternary-30', 3],
      ['ternary-60', 4],
      ['arity-eight-10', 4],
      ['arity-eight-20', 5],
    ],
  },
  {
    id: 'scale.many-rules',
    family: 'scale',
    component: 'planner/scale',
    need: 'H4',
    generator:
      '20, then 100 rules of 6 binary variables drawn from a pool of 60, 160 variables; one variant draws the rules from a pool of 20 so they overlap heavily.',
    oracle:
      'Every required triple is held by some row (a scan over the triples of each rule); rows within 1.25 x the greedy bound; processor time within 30 s.',
    cause: 'the planner covers many rule groups at strength 3 with a bounded row count',
    variants: [
      ['twenty-rules', 3],
      ['hundred-rules', 5],
      ['heavy-overlap', 5],
    ],
  },
  {
    id: 'scale.thousand-others',
    family: 'scale',
    component: 'planner/scale',
    need: 'H4',
    generator: '1,000 and 5,000 variables of arity 3 in no rule and no axis.',
    oracle: 'The plan has at most 6 rows (strength 1 needs 3) and takes at most 10 s of processor time.',
    cause: 'variables outside rules and axes cost rows by arity, not by count',
    variants: [
      ['one-thousand', 4],
      ['five-thousand', 5],
    ],
  },
  {
    id: 'scale.many-impossible-pairs',
    family: 'scale',
    component: 'planner/scale',
    need: 'H4',
    generator:
      '2,000 and 20,000 impossible pairs among 200 variables of arity 4 (the first 30 are shared axes) that keep a universal value each.',
    oracle:
      'No row holds a pair; every allowed required tuple is held; rows within 4 x the greedy bound (the pairs make rows hold fewer tuples than random rows would); at most 30 s of processor time.',
    cause: 'impossible pairs are looked up in constant time',
    variants: [
      ['two-thousand', 4],
      ['twenty-thousand', 5],
    ],
  },
  {
    id: 'scale.estate-spans',
    family: 'scale',
    component: 'store/estate',
    need: 'H4',
    generator: '200, 2,000 and 10,000 condition spans with distinct nouns, spread over 20 files of 100 KB.',
    oracle:
      'The store holds one variable per noun with three values each, no refusal; at most 10 s of processor time at 2,000 spans, 30 s at 10,000.',
    cause: 'reading the estate is linear in spans and file size',
    variants: [
      ['two-hundred', 3],
      ['two-thousand', 4],
      ['ten-thousand', 5],
    ],
  },
  {
    id: 'scale.conversations',
    family: 'scale',
    component: 'store/conversations',
    need: 'H4',
    generator: '10,000 and 100,000 sessions over 8 variables of 5 values from a planted mix.',
    oracle: 'The counts equal the planted counts; at most 5 s of processor time at 100,000.',
    cause: 'counting conversations is linear in sessions',
    variants: [
      ['ten-thousand', 3],
      ['hundred-thousand', 5],
    ],
  },
  {
    id: 'scale.counter-big-plan',
    family: 'scale',
    component: 'planner/counter',
    need: 'H4',
    generator:
      'A plan of about 30 rows on 100 binary variables at strength 3, and on 200 at strength 2, counted by the component.',
    oracle: "covered and allowed equal the bank's own scan; at most 20 s of processor time.",
    cause: 'coverage counting stays linear in rows times tuples per row',
    variants: [
      ['hundred-binary-t3', 5],
      ['two-hundred-binary-t2', 4],
    ],
  },
  {
    id: 'scale.big-arity-axis',
    family: 'scale',
    component: 'planner/scale',
    need: 'H4',
    generator: 'One axis of 200 values beside three binary axes.',
    oracle:
      'Every value of the big axis meets every value of each other axis; rows within the bound; at most 10 s.',
    cause: 'the planner handles an axis with hundreds of values',
    variants: [['arity-two-hundred', 4]],
  },
];

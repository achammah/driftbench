import type { StemDef } from './types';

/**
 * Family boundaries: the values of a condition are its two sides plus the boundary (clause P2). The generator
 * renders a numeric condition from a hidden (comparator class, threshold) with many wordings and number formats;
 * the oracle needs only the threshold: for a single threshold t the variable holds exactly three values whose
 * samples are s1 < t, s2 = t, s3 > t (integers when t is an integer). Level store.
 */
const one = (
  id: string,
  cls: string,
  cause: string,
  variants: StemDef['variants'],
  wordings: string,
): StemDef => ({
  id,
  family: 'boundaries',
  component: 'store/boundaries',
  need: 'P2',
  assumption: ['A11'],
  generator: `Renders "<the quantity> <${cls} wording> <N><unit>" for ${wordings}, with the threshold N from the seed.`,
  oracle:
    'One variable cites the span; it holds exactly three values whose samples satisfy s1 < N, s2 = N, s3 > N (integers when N is an integer); each cites the span. For gt, ge, lt and le the variable carries a boundaries entry with limit N, the comparison, and holds, fails and edge naming three distinct values: the edge has the sample N, holds a sample where the condition holds, fails one where it does not (docs/variables.md).',
  cause,
  variants,
});

export const BOUNDARIES: readonly StemDef[] = [
  one(
    'boundaries.greater-than',
    'greater-than',
    'the estate source reads the greater-than wordings (over, more than, exceeds, greater than, >)',
    [
      ['over', 1],
      ['more-than', 1],
      ['exceeds', 2],
      ['greater-than', 2],
      ['symbol', 3],
    ],
    'over, more than, exceeds, greater than and >',
  ),
  one(
    'boundaries.at-least',
    'at-least',
    'the estate source reads the at-least wordings (at least, no less than, N or more, >=)',
    [
      ['at-least', 1],
      ['no-less-than', 2],
      ['or-more', 3],
      ['symbol', 3],
    ],
    'at least, no less than, N or more and >=',
  ),
  one(
    'boundaries.less-than',
    'less-than',
    'the estate source reads the less-than wordings (under, below, fewer than, <)',
    [
      ['under', 1],
      ['below', 1],
      ['fewer-than', 2],
      ['symbol', 3],
    ],
    'under, below, fewer than and <',
  ),
  one(
    'boundaries.at-most',
    'at-most',
    'the estate source reads the at-most wordings (at most, no more than, N or fewer, <=)',
    [
      ['at-most', 1],
      ['no-more-than', 2],
      ['or-fewer', 3],
      ['symbol', 3],
    ],
    'at most, no more than, N or fewer and <=',
  ),
  one(
    'boundaries.equal',
    'equal',
    'the estate source reads the equality wordings (exactly, equals, ==)',
    [
      ['exactly', 1],
      ['equals', 2],
      ['symbol', 3],
    ],
    'exactly, equals and ==',
  ),
  one(
    'boundaries.not-equal',
    'not-equal',
    'the estate source reads the inequality wordings (not equal to, other than, !=)',
    [
      ['not-equal-to', 2],
      ['other-than', 3],
      ['symbol', 3],
    ],
    'not equal to, other than and !=',
  ),
  {
    id: 'boundaries.range',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator:
      'Renders "between A and B", "from A to B" and a range of negative numbers, with A < B from the seed.',
    oracle:
      'One variable cites the span; its samples include one below A, A itself, one strictly between, B itself and one above B.',
    cause: 'a range condition yields both edges and a value inside and outside',
    variants: [
      ['between-and', 3],
      ['from-to', 3],
      ['negative-range', 5],
    ],
  },
  {
    id: 'boundaries.decimal',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator: 'Thresholds written with decimals: 0.5, 12.75, 3.0, 0.3.',
    oracle: 'The boundary sample equals the written threshold exactly (Number of the text); s1 < t < s3.',
    cause: 'decimal thresholds are read exactly',
    variants: [
      ['half', 2],
      ['two-places', 2],
      ['whole-as-decimal', 3],
      ['tenth-float', 4],
    ],
  },
  {
    id: 'boundaries.negative',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator: 'Thresholds below zero: "below -5 degrees", "more than -0.5".',
    oracle: 'The boundary sample is the negative threshold; s1 < t < s3.',
    cause: 'a negative threshold keeps its sign',
    variants: [
      ['minus-sign', 3],
      ['negative-decimal', 4],
    ],
  },
  {
    id: 'boundaries.zero',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator: '"more than 0 attempts" and "no more than 0 retries".',
    oracle: 'The boundary sample is 0; s1 < 0 < s3 (a falsy threshold is still a threshold).',
    cause: 'a zero threshold is a threshold',
    variants: [
      ['more-than-zero', 3],
      ['at-most-zero', 4],
    ],
  },
  {
    id: 'boundaries.thousands-separator',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator: 'Thresholds written "1,000", "10,000,000" and "1 000" with a no-break space.',
    oracle: 'The boundary sample equals the number without separators.',
    cause: 'thousands separators belong to the number',
    variants: [
      ['comma', 3],
      ['several-groups', 3],
      ['thin-space', 4],
    ],
  },
  {
    id: 'boundaries.large-number',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator: 'Thresholds 1000000000, 2147483648 and 1000000000000.',
    oracle: 'The boundary sample equals the threshold; s1 < t < s3 (no wrap at 32 bits).',
    cause: 'thresholds beyond 32 bits are read without overflow',
    variants: [
      ['billion', 3],
      ['above-32-bits', 4],
      ['trillion', 4],
    ],
  },
  {
    id: 'boundaries.units',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator:
      'The same threshold with a unit word ("500 euros", "5 minutes"), a percent sign ("80%"), or a currency sign ("EUR 500", "$500").',
    oracle: 'The boundary sample is the number; the unit does not change it.',
    cause: 'unit words and currency signs around the number do not change the threshold',
    variants: [
      ['euros', 1],
      ['percent', 2],
      ['minutes', 2],
      ['currency-prefix', 3],
    ],
  },
  {
    id: 'boundaries.number-words',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator: '"at least three retries", "more than twenty-five items", "over one hundred pages".',
    oracle: 'The boundary sample is the number the words name.',
    cause: 'number words are read as numbers',
    variants: [
      ['three', 3],
      ['twenty-five', 4],
      ['one-hundred', 5],
    ],
  },
  {
    id: 'boundaries.merge-thresholds',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    generator:
      'Two spans over one quantity: thresholds far apart; thresholds one apart so their samples overlap; one threshold in two spans with different comparators.',
    oracle:
      "One variable; the samples are the union of the samples each span requires, with no duplicate sample; every span's three requirements hold.",
    cause: 'values from several spans of one variable are merged without duplicate samples',
    variants: [
      ['far-apart', 3],
      ['adjacent-overlap', 4],
      ['same-threshold-two-comparators', 3],
    ],
  },
  {
    id: 'boundaries.integer-samples',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P2',
    assumption: ['A11'],
    generator: 'Integer thresholds on counts ("3 retries"), money ("500 euros") and percentages ("80%").',
    oracle: 'All three samples are integers.',
    cause: 'an integer threshold gets integer samples on both sides',
    variants: [
      ['count-noun', 2],
      ['money', 2],
      ['percent', 3],
    ],
  },
  {
    id: 'boundaries.cites-span',
    family: 'boundaries',
    component: 'store/boundaries',
    need: 'P3',
    generator: 'One numeric span in a file with a source path.',
    oracle:
      'Each of the three values has a quote provenance whose source path is the file and whose quote is findable in it and overlaps the span.',
    cause: 'the quote of a boundary value is the span text copied from its file, with the path of the file',
    variants: [
      ['each-value-cites', 2],
      ['quote-findable', 3],
    ],
  },
];

import type { StemDef } from './types';

/**
 * Family values: the shape of the store itself. Ids, value sets, what the owner adds, purity of the call, and
 * hostile names (clauses P1, P2, P3 and docs/validators.md 12.2 rule 7). Level store.
 */
export const VALUES: readonly StemDef[] = [
  {
    id: 'values.ids.variable-grammar',
    family: 'values',
    component: 'store/ids',
    need: 'M1',
    assumption: ['A9'],
    generator:
      'Condition spans whose quantity noun has capitals and spaces ("Invoice Total"), punctuation ("Customer\'s age (days)"), a leading digit ("24h response window"), or non-ASCII letters.',
    oracle:
      "Every variable id matches ^[A-Za-z0-9][A-Za-z0-9._-]*$ (the format's id rule) and the variable still cites its span.",
    cause: 'variable ids are normalised to the id grammar of the variable store format',
    variants: [
      ['spaces-and-caps', 2],
      ['punctuation', 3],
      ['leading-digit', 4],
      ['unicode-letters', 4],
    ],
  },
  {
    id: 'values.ids.value-grammar',
    family: 'values',
    component: 'store/ids',
    need: 'M1',
    assumption: ['A9'],
    generator:
      'Owner values and tool values whose given ids contain spaces, a leading symbol, slashes or quotes ("very high!", "/etc/x").',
    oracle:
      "Every value id matches ^[A-Za-z0-9][A-Za-z0-9_.-]*$ and the value keeps its provenance (the owner's words, the quote).",
    cause: 'value ids are normalised to the value id grammar',
    variants: [
      ['owner-values', 2],
      ['tool-values', 3],
      ['hostile-characters', 4],
    ],
  },
  {
    id: 'values.ids.stable',
    family: 'values',
    component: 'store/ids',
    need: 'P9',
    generator:
      'The same sources built twice in a row, and built again after an unrelated store was built in between.',
    oracle:
      'Every variable and value id of the first store appears in the second, for the same span or quote.',
    cause: 'ids derive from the text alone, with no counter shared between calls',
    variants: [
      ['two-calls', 2],
      ['after-other-build', 3],
    ],
  },
  {
    id: 'values.ids.collisions',
    family: 'values',
    component: 'store/ids',
    need: 'P1',
    generator:
      'Two value ids that normalise to the same id ("very high", "very-high"), two quantity nouns that normalise to the same id ("Order #", "order"), and three-way collisions.',
    oracle:
      'Every input still has its own value or variable (found by its quote), and ids are unique inside their scope.',
    cause: 'colliding ids are disambiguated, never merged or dropped',
    variants: [
      ['value-collision', 3],
      ['variable-collision', 3],
      ['three-way', 4],
    ],
  },
  {
    id: 'values.owner-adds-to-existing',
    family: 'values',
    component: 'store/owner',
    need: 'P2',
    generator: 'A base store with 2 to 4 values on a variable; the owner adds one or two values to it.',
    oracle:
      'The new values are on that variable; the old values and their provenance are unchanged; no other variable changed.',
    cause: 'an owner value joins its variable and leaves the other values unchanged',
    variants: [
      ['appended', 1],
      ['others-unchanged', 3],
      ['order-kept', 3],
    ],
  },
  {
    id: 'values.owner-value-already-present',
    family: 'values',
    component: 'store/owner',
    need: 'P3',
    generator: 'The owner names a value id the variable already has, once or twice.',
    oracle:
      'The variable holds that value once; it carries its earlier provenance and an owner provenance for each owner entry.',
    cause: 'an owner value that exists gains the owner provenance instead of a duplicate',
    variants: [
      ['same-id', 2],
      ['same-id-twice', 3],
    ],
  },
  {
    id: 'values.hostile-names',
    family: 'values',
    component: 'store/ids',
    need: 'H7',
    generator:
      'A tool field called "constructor", "toString" or "hasOwnProperty", a value called "constructor", and a quantity noun that reads "__proto__".',
    oracle:
      'The store holds the variable or value as an ordinary entry (or a grammar-valid id for the noun), no prototype is polluted, and nothing throws.',
    cause: 'variable and value tables are built without prototype keys',
    variants: [
      ['constructor-variable', 5],
      ['to-string-variable', 5],
      ['has-own-property-variable', 5],
      ['proto-like-noun', 5],
      ['constructor-value', 5],
    ],
  },
  {
    id: 'values.large-variable',
    family: 'values',
    component: 'store/ids',
    need: 'H4',
    generator: 'A variable that the owner extends with 2,000 or 10,000 values.',
    oracle: 'All values are kept with unique ids and the call takes at most 3 s of processor time.',
    cause: 'a variable can hold thousands of values without quadratic work',
    variants: [
      ['two-thousand-values', 4],
      ['ten-thousand-values', 5],
    ],
  },
  {
    id: 'values.unapproved-not-planned',
    family: 'values',
    component: 'planner/constraints',
    need: 'P2',
    assumption: ['A5'],
    generator:
      'A hand-built store of shared axes and a rule, plus a value or a variable a machine proposed (approved false, conversations counts as provenance); the same value flagged approved true; a proposed value that an impossible pair names.',
    oracle:
      'No plan row holds the proposed value or assigns the proposed variable, and no required tuple names them; once approved the value is in rows and every tuple that names it is covered.',
    cause: 'the planner uses only approved values and variables (the machine proposes, a person approves)',
    variants: [
      ['proposed-value', 3],
      ['proposed-variable', 3],
      ['proposed-value-in-a-pair', 4],
      ['approved-later', 3],
    ],
  },
  {
    id: 'values.fresh-objects',
    family: 'values',
    component: 'store/merge',
    need: 'H7',
    generator: 'A store is built, written to, then the same sources are built again.',
    oracle:
      'Writing to the first result changes neither the sources nor the second result: nothing is shared.',
    cause: 'buildStore returns objects that share nothing with its input or with an earlier result',
    variants: [
      ['output-mutation-safe', 3],
      ['two-builds-independent', 3],
    ],
  },
  {
    id: 'values.input-not-mutated',
    family: 'values',
    component: 'store/merge',
    need: 'P9',
    generator: 'Deeply frozen estate input, session list or owner input.',
    oracle: 'The call does not throw and the input is unchanged.',
    cause: 'buildStore never writes to its input',
    variants: [
      ['estate', 3],
      ['conversations', 3],
      ['owner', 3],
    ],
  },
];

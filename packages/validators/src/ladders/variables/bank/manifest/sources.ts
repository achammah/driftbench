import type { StemDef } from './types';

/**
 * Family sources: what each of the three sources puts into the store (clause P2), and how provenance and
 * merging behave (clause P3). Level store.
 */
export const SOURCES: readonly StemDef[] = [
  {
    id: 'sources.estate.numeric-condition',
    family: 'sources',
    component: 'store/estate',
    need: 'P2',
    generator:
      'Renders a rule sentence ("When the <noun> is over <N> <unit>, <action>.") among filler lines of a CLAUDE.md-like file; the condition span is the fragment from the noun to the unit. Noun, comparator word, N and unit come from the seed.',
    oracle:
      'Exactly one variable has values that cite the span, the store has no refusal, and the variable holds three values (their shape is checked by the boundaries family).',
    cause: 'buildStore turns a numeric condition span of the estate into one variable',
    variants: [
      ['one-rule', 1],
      ['long-file', 2],
    ],
  },
  {
    id: 'sources.estate.boolean-condition',
    family: 'sources',
    component: 'store/estate',
    need: 'P2',
    assumption: ['A12'],
    generator:
      'Renders boolean conditions ("the draft is signed", "the draft is not signed", "no reference is attached") in a file; the span is the clause.',
    oracle:
      'One variable cites the span; it holds exactly two values whose samples are the booleans true and false; each cites the span.',
    cause: 'a boolean condition span becomes a variable with a true and a false value',
    variants: [
      ['positive', 1],
      ['negated', 3],
      ['lacks-form', 4],
    ],
  },
  {
    id: 'sources.estate.membership-condition',
    family: 'sources',
    component: 'store/estate',
    need: 'P2',
    assumption: ['A12'],
    generator:
      'Renders a membership condition ("the channel is email or chat", "the channel is email, chat or phone", "the channel is one of a, b, c") with 2 or 3 listed members.',
    oracle:
      'One variable cites the span; one value has a sample that is a listed member and one has a sample that is not; no more than members plus one values; each cites the span.',
    cause: 'a membership condition span becomes a variable with an in-list side and an out-of-list side',
    variants: [
      ['three-members', 2],
      ['two-members', 2],
    ],
  },
  {
    id: 'sources.estate.no-condition-no-variable',
    family: 'sources',
    component: 'store/estate',
    need: 'P2',
    generator:
      'Lists spans that state no condition: an unconditional rule ("Always greet the user."), a number without a comparator ("Use the 500 euro template."), a past fact ("The limit was 500 last year."), beside real conditions.',
    oracle:
      'No variable cites a decoy span; the real conditions still give their variables. A refusal entry for a decoy is allowed.',
    cause: 'the estate source returns no variable for a span that states no condition',
    variants: [
      ['plain-rule', 1],
      ['number-without-comparator', 4],
      ['past-tense-limit', 5],
    ],
  },
  {
    id: 'sources.estate.same-quantity-merges',
    family: 'sources',
    component: 'store/estate',
    need: 'P2',
    generator:
      'Two or three spans over the same quantity noun with thresholds at least 10 apart, in one file or two; one variant changes the case of the noun.',
    oracle:
      'One variable; each span is cited by exactly three values; the variable holds three values per span and no duplicate sample.',
    cause: 'spans that name the same quantity merge into one variable',
    variants: [
      ['two-spans', 3],
      ['three-spans', 3],
      ['two-files', 4],
      ['case-differs', 4],
    ],
  },
  {
    id: 'sources.estate.different-quantities-split',
    family: 'sources',
    component: 'store/estate',
    need: 'P2',
    generator:
      'Spans over different quantity nouns: unrelated nouns, nouns that share a word ("invoice total", "invoice age"), a noun that is the prefix of another ("total", "total tax").',
    oracle:
      'One variable per distinct noun; no value cites spans of two nouns; each variable holds three values.',
    cause: 'spans that name different quantities stay different variables',
    variants: [
      ['two-nouns', 1],
      ['shared-word', 3],
      ['prefix-noun', 4],
    ],
  },
  {
    id: 'sources.estate.rule-own-variables',
    family: 'sources',
    component: 'store/estate',
    need: 'P5',
    generator:
      'Rules with 0 to 2 condition spans and 0 to 2 tool evidence fields (a tool, a field, listed values with their quotes in a tools file); one variant has two rules whose spans name the same quantity.',
    oracle:
      "The store lists one rule per input rule, and its variables are exactly the variables whose values cite that rule's spans and tool quotes; a quantity named by two rules is one variable listed by both.",
    cause: 'each rule lists the variables its condition spans and tool evidence name',
    variants: [
      ['condition-and-tool', 2],
      ['condition-only', 2],
      ['tool-only', 3],
      ['two-and-two', 3],
      ['shared-quantity-two-rules', 3],
    ],
  },
  {
    id: 'sources.estate.tool-field-variable',
    family: 'sources',
    component: 'store/estate',
    need: 'P2',
    generator:
      'Tool evidence {tool, field, source, values}: 3, 2 or 1 listed values, each with an id and a quote found in a tools reference file.',
    oracle:
      'One variable holds one value per listed id, each citing its own quote with the right source path.',
    cause: 'tool evidence input fields become variables with one value per listed value',
    variants: [
      ['enum-three', 2],
      ['single-value', 3],
    ],
  },
  {
    id: 'sources.conversations.counts',
    family: 'sources',
    component: 'store/conversations',
    need: 'P2',
    generator:
      'Builds a base store from tool evidence, reads its ids, then draws sessions (a variable to a value) from a planted mix; the sessions go in with the same estate.',
    oracle:
      'Each value carries a conversations provenance whose count equals the planted count and whose total equals the sessions that observe its variable, with a set_hash of 64 hexadecimal characters; the counts of a variable add up to its total.',
    cause:
      'the conversation source counts, per value, the sessions that show it and those that observe its variable',
    variants: [
      ['two-values', 1],
      ['three-variables', 2],
      ['unseen-estate-value', 3],
    ],
  },
  {
    id: 'sources.conversations.partial-sessions',
    family: 'sources',
    component: 'store/conversations',
    need: 'P2',
    generator: 'Sessions that observe only some of the variables; one variable no session observes.',
    oracle:
      'of counts only the sessions that observe the variable; a variable no session observes gets no conversations provenance.',
    cause: 'the total of a variable counts only the sessions that observe it',
    variants: [
      ['half-observed', 2],
      ['never-observed', 3],
    ],
  },
  {
    id: 'sources.conversations.new-value',
    family: 'sources',
    component: 'store/conversations',
    need: 'P2',
    assumption: ['A5'],
    generator: 'Sessions that show a value id the base store lacks, on a variable it has.',
    oracle:
      'The variable gains the value with a conversations provenance (count, total) and approved false: it is a proposal until a person approves it; the other values keep their provenance.',
    cause:
      'a value seen in conversations and absent from the store is added as an unapproved proposal with its counts as provenance',
    variants: [['one-new', 2]],
  },
  {
    id: 'sources.conversations.set-hash',
    family: 'sources',
    component: 'store/conversations',
    need: 'P14',
    generator:
      "A set of 30 sessions, built twice; the same set with one session's value changed; the same set in another order.",
    oracle:
      'Every conversations entry carries a set_hash of 64 lowercase hexadecimal characters; the same set gives the same hash; a changed session gives another hash; the order of the sessions does not matter; the hash is not the session text or id.',
    cause: 'the conversation source hashes the private set of sessions into set_hash',
    variants: [
      ['hex-shape', 2],
      ['stable', 2],
      ['changes-with-a-session', 3],
      ['order-free', 3],
    ],
  },
  {
    id: 'sources.conversations.privacy',
    family: 'sources',
    component: 'store/conversations',
    need: 'P14',
    generator:
      'Sessions that carry an id and a free-text field holding unique canary tokens; one variant has 1,000 sessions.',
    oracle: 'The serialised store holds no canary token and no session id: counts only.',
    cause: 'the conversation source keeps counts only: no session id or text reaches the store',
    variants: [
      ['text-canary', 2],
      ['id-canary', 2],
      ['thousand-sessions', 4],
    ],
  },
  {
    id: 'sources.owner.missing-value',
    family: 'sources',
    component: 'store/owner',
    need: 'P2',
    generator: 'Owner entries (variable, value, words) on variables of a base store.',
    oracle:
      'Each variable gains the value with an owner provenance equal to the words and the day; nothing else changes.',
    cause: "the owner source adds a missing value with the owner's words as provenance",
    variants: [
      ['one', 1],
      ['three', 2],
    ],
  },
  {
    id: 'sources.owner.impossible-pair',
    family: 'sources',
    component: 'store/owner',
    need: 'P2',
    generator: 'Owner pairs (a variable and value on each side, words) over values of a base store.',
    oracle:
      'The store lists each pair, in either order, with an owner provenance equal to the words and the day, and nothing more.',
    cause: "the owner source records an impossible pair with the owner's words",
    variants: [
      ['one', 1],
      ['reversed-endpoints', 2],
    ],
  },
  {
    id: 'sources.owner.weight',
    family: 'sources',
    component: 'store/owner',
    need: 'P2',
    generator:
      'Owner weights (variable, value, weight, words, day) on every value of a variable of a base store: a relative scale (60, 15, 25), a distribution (0.5, 0.3, 0.2), one weight of 0.',
    oracle:
      'Each value carries the declared weight (exactly) and an owner provenance equal to the words and the day.',
    cause: "the owner source records a declared weight with the owner's words",
    variants: [
      ['relative-scale', 1],
      ['full-distribution', 2],
      ['zero-weight', 3],
    ],
  },
  {
    id: 'sources.owner.words-verbatim',
    family: 'sources',
    component: 'store/owner',
    need: 'P3',
    generator:
      "Owner words with accents, line breaks, 1,000 characters (the format's limit), emoji and right-to-left text.",
    oracle: 'The stored provenance words equal the given words byte for byte.',
    cause: "the owner's words are stored byte for byte",
    variants: [
      ['accents', 2],
      ['multiline', 3],
      ['one-thousand-chars', 4],
      ['emoji-and-rtl', 4],
    ],
  },
  {
    id: 'sources.owner.date-and-statement',
    family: 'sources',
    component: 'store/owner',
    need: 'P3',
    generator:
      'Owner entries (a value) with the day 2025-12-31, with an unreal day (2026-02-30), with a day written 31/12/2025, and with blank words.',
    oracle:
      'A real day is stored as given; an entry with an unreal or badly written day, or with blank words, is refused with a reason and changes nothing.',
    cause: 'the owner source keeps the day the owner spoke and refuses an unreal day or a blank statement',
    variants: [
      ['day-kept', 2],
      ['unreal-day-refused', 3],
      ['badly-written-day-refused', 3],
      ['blank-words-refused', 3],
    ],
  },
  {
    id: 'sources.merge.provenance-union',
    family: 'sources',
    component: 'store/merge',
    need: 'P3',
    generator:
      'A value that two or three sources name: the estate (a quote), the conversations (counts) and the owner (words).',
    oracle: 'The value carries one provenance entry per source, each of its own kind.',
    cause: 'a value known to several sources keeps one provenance entry per source',
    variants: [
      ['estate-owner', 3],
      ['estate-conversations', 3],
      ['all-three', 4],
    ],
  },
  {
    id: 'sources.order-independent',
    family: 'sources',
    component: 'store/merge',
    need: 'H3',
    generator:
      'The same sources with the rules, the sessions or the owner entries in another order (the file map keys too).',
    oracle: 'The two stores are equal after sorting variables, values and provenance entries by id.',
    cause: 'the store content does not depend on the order of the source entries',
    variants: [
      ['rules-permuted', 3],
      ['sessions-permuted', 3],
      ['owner-entries-permuted', 3],
    ],
  },
  {
    id: 'sources.empty-sources',
    family: 'sources',
    component: 'store/merge',
    need: 'H7',
    generator: 'No source, an empty estate, an empty session list, an empty owner object.',
    oracle:
      'buildStore returns a store with no variable, no pair, no rule and no refusal, and does not throw.',
    cause: 'buildStore accepts empty sources',
    variants: [
      ['nothing', 1],
      ['empty-estate', 1],
      ['empty-conversations', 2],
    ],
  },
];

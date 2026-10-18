import type { StemDef } from './types';

/**
 * Family quotes: a value of the estate keeps a quote with its source path, and a value without a findable quote
 * is refused (clauses P3 and P4). The items drive the check through tool evidence, where every value has its own
 * quote, and through condition spans, where the span is the quote. Level store.
 */
export const QUOTES: readonly StemDef[] = [
  {
    id: 'quotes.accept.exact',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator:
      'A source file of 10 to 40 lines and tool evidence whose value quotes are verbatim runs of it: at the start, in the middle, at the end, or the whole file.',
    oracle: 'Every value is in the store with its quote and source path; the store has no refusal.',
    cause: 'a value whose quote appears verbatim in its source file is kept',
    variants: [
      ['at-start', 1],
      ['middle', 1],
      ['at-end', 2],
      ['whole-file', 2],
    ],
  },
  {
    id: 'quotes.refuse.absent',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator:
      'A value whose quote is not in its file: unrelated text, text that sits in another file, or a findable quote with one extra word appended.',
    oracle: 'The value is not in the store and the refusal list names it.',
    cause: 'a value whose normalized quote is absent from its named source is refused',
    variants: [
      ['unrelated-text', 1],
      ['other-file-text', 2],
      ['extra-word-appended', 3],
    ],
  },
  {
    id: 'quotes.refuse.unknown-source',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator:
      'A value whose quote is findable in file A but whose source path is a file the estate does not hold: a missing path, a path that differs only in case, an empty path.',
    oracle: 'The value is not in the store and the refusal list names it.',
    cause: 'a quote cited from a source path the estate does not hold is refused',
    variants: [
      ['missing-path', 1],
      ['path-case-differs', 2],
      ['empty-path', 3],
    ],
  },
  {
    id: 'quotes.refuse.empty-quote',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator: 'A value whose quote is the empty string, or only spaces and a tab.',
    oracle: 'The value is refused although the empty string occurs in every file.',
    cause: 'an empty or blank quote is refused although every file contains it',
    variants: [
      ['empty', 2],
      ['blank', 3],
    ],
  },
  {
    id: 'quotes.refuse.inexact',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator:
      'A findable quote changed a little: written in capitals, first letter in another case, one character inserted, deleted or substituted, two neighbours swapped, one word skipped, or the end of line 1 joined to the start of line 3.',
    oracle:
      'After the documented normalization the quote is still absent; case, punctuation and word order remain significant.',
    cause: 'a value whose normalized quote is absent from its named source is refused',
    variants: [
      ['all-caps', 2],
      ['first-letter-case', 3],
      ['inserted-char', 3],
      ['deleted-char', 3],
      ['substituted-char', 3],
      ['transposed-chars', 4],
      ['skipped-word', 3],
      ['joined-lines', 4],
    ],
  },
  {
    id: 'quotes.accept.multiline',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator:
      'A quote that spans two or three lines of a file with LF line ends, or CRLF line ends and the CRLF in the quote.',
    oracle: 'The value is kept with its quote.',
    cause: 'quote matching folds whitespace runs while keeping the stored quote unchanged',
    variants: [
      ['lf', 2],
      ['crlf', 3],
    ],
  },
  {
    id: 'quotes.plain-text-matching',
    family: 'quotes',
    component: 'store/quotes',
    need: 'H7',
    generator:
      'Quotes made of pattern characters that occur literally in the file (".*", "(a|b)+", "[0-9]{3}", "\\d+"), and quotes that look like patterns matching the file but are not literally in it ("invoice.*total", "a|b").',
    oracle: 'The literal ones are kept; the lookalikes are refused.',
    cause: 'quotes are matched as plain text, never as patterns',
    variants: [
      ['dot-star-literal', 4],
      ['group-alternation-literal', 4],
      ['brackets-literal', 4],
      ['backslash-d-literal', 4],
      ['dot-star-lookalike', 5],
      ['alternation-lookalike', 5],
    ],
  },
  {
    id: 'quotes.accept.unicode',
    family: 'quotes',
    component: 'store/quotes',
    need: 'H7',
    generator:
      'Quotes with accents, CJK text, emoji above the basic plane, and right-to-left text, verbatim in the file.',
    oracle: 'The value is kept with its quote unchanged.',
    cause: 'quote matching applies the documented Unicode and typography normalization',
    variants: [
      ['accents', 2],
      ['cjk', 3],
      ['emoji', 4],
      ['rtl', 4],
    ],
  },
  {
    id: 'quotes.per-value-granularity',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator:
      'A tool field with 3 values where one, two, the first, or all of them have an unfindable quote.',
    oracle:
      'Only the values with an unfindable quote are missing; the others stay; a variable left with no value is not stored.',
    cause: 'refusing a value preserves its valid sibling values',
    variantCauses: { 'all-bad': 'a variable left with no accepted value is dropped' },
    variants: [
      ['one-of-three', 3],
      ['two-of-three', 3],
      ['first-bad', 3],
      ['all-bad', 3],
    ],
  },
  {
    id: 'quotes.refusal-report',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator: 'One or two refused values with distinct ids.',
    oracle:
      'The refusal list holds one entry per refused value, naming its id, with a reason that is not empty.',
    cause: 'every refused value is listed with a reason that names it',
    variants: [
      ['one', 2],
      ['two', 3],
      ['reason-text', 3],
    ],
  },
  {
    id: 'quotes.owner-conversation-exempt',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P3',
    generator:
      'An owner value, a value seen in conversations, and an owner value whose words look like a quote that no file holds.',
    oracle: 'Each is kept with its own provenance; none is refused for lacking a file quote.',
    cause: 'values from the owner and from conversations are kept without a file quote',
    variants: [
      ['owner-value', 2],
      ['conversation-value', 2],
      ['owner-words-quote-shaped', 3],
    ],
  },
  {
    id: 'quotes.condition-span-unfindable',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P4',
    generator:
      'A condition span that is not in its file: edited wording, text of another file, or one character off.',
    oracle: 'No variable cites the span and the refusal list names it.',
    cause: 'a condition span whose text is not in its source file yields no variable and a refusal',
    variants: [
      ['edited-wording', 3],
      ['wrong-file', 3],
      ['one-char-off', 4],
    ],
  },
  {
    id: 'quotes.stored-verbatim',
    family: 'quotes',
    component: 'store/quotes',
    need: 'P3',
    generator: 'Findable quotes with leading and trailing spaces, or a trailing newline.',
    oracle: 'The stored quote and source path are the given ones, byte for byte.',
    cause: 'the stored quote and source path are the given ones, byte for byte',
    variants: [
      ['plain', 2],
      ['padded-spaces', 4],
      ['trailing-newline', 4],
    ],
  },
  {
    id: 'quotes.never-reads-disk',
    family: 'quotes',
    component: 'store/quotes',
    need: 'H7',
    generator:
      'A quote ("localhost") with the source path "/etc/hosts", a path with "../" segments, and an absolute path, none of them among the given files.',
    oracle: 'The value is refused: quotes are looked up in the given files only.',
    cause: 'quotes are looked up in the given files only, never on disk',
    variants: [
      ['etc-hosts', 4],
      ['traversal', 4],
      ['absolute-path', 5],
    ],
  },
  {
    id: 'quotes.large-files',
    family: 'quotes',
    component: 'store/quotes',
    need: 'H4',
    generator:
      'A 100 KB file and a 1 MB file with the quote near the end, and 2,000 values quoted from one 1 MB file.',
    oracle: 'Every value is kept and the call takes at most 3 s of processor time.',
    cause: 'quote verification stays linear in file size and in values',
    variants: [
      ['hundred-kb', 4],
      ['one-mb', 5],
      ['two-thousand-values', 5],
    ],
  },
];

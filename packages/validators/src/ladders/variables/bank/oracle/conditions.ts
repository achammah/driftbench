import type { Rng } from '../util';

/**
 * The hidden specification of an estate: condition spans rendered into sentences of a CLAUDE.md-like file.
 * Every span is a verbatim substring of the file it is rendered into, and the oracle knows its truth from the
 * hidden fields (comparator class, threshold, noun, members) without reading the span.
 */

export type Cmp = 'gt' | 'ge' | 'lt' | 'le' | 'eq' | 'ne';

export type Quantity = { noun: string; unit: string; kind: 'money' | 'count' | 'time' | 'percent' | 'size' };

export const QUANTITIES: readonly Quantity[] = [
  { noun: 'the invoice total', unit: ' euros', kind: 'money' },
  { noun: 'the retry count', unit: '', kind: 'count' },
  { noun: 'the ticket age', unit: ' days', kind: 'time' },
  { noun: 'the queue length', unit: ' items', kind: 'count' },
  { noun: 'the response time', unit: ' seconds', kind: 'time' },
  { noun: 'the batch size', unit: ' rows', kind: 'count' },
  { noun: 'the refund amount', unit: ' euros', kind: 'money' },
  { noun: 'the page count', unit: ' pages', kind: 'count' },
  { noun: 'the discount rate', unit: '%', kind: 'percent' },
  { noun: 'the attachment size', unit: ' MB', kind: 'size' },
  { noun: 'the wait time', unit: ' minutes', kind: 'time' },
  { noun: 'the order value', unit: ' euros', kind: 'money' },
  { noun: 'the loop depth', unit: '', kind: 'count' },
  { noun: 'the history length', unit: ' turns', kind: 'count' },
];

const ADJECTIVES = [
  'amber',
  'brisk',
  'calm',
  'dusty',
  'eager',
  'fuzzy',
  'gentle',
  'hollow',
  'ivory',
  'jolly',
  'keen',
  'lucid',
  'mellow',
  'nimble',
  'opal',
  'pale',
  'quiet',
  'rustic',
  'silver',
  'tidy',
  'umber',
  'vivid',
  'woolly',
  'young',
  'zesty',
];
const COLOURS = [
  'azure',
  'beige',
  'coral',
  'denim',
  'ebony',
  'fawn',
  'golden',
  'hazel',
  'indigo',
  'jade',
  'khaki',
  'lilac',
  'maroon',
  'navy',
  'olive',
  'plum',
  'quartz',
  'russet',
  'sepia',
  'teal',
  'ultramarine',
  'violet',
  'wheat',
  'xanthic',
  'yellow',
];
const NOUNS = [
  'ledger',
  'harbor',
  'meadow',
  'lantern',
  'garden',
  'bridge',
  'market',
  'canal',
  'forest',
  'window',
  'anchor',
  'basket',
  'candle',
  'dragon',
  'engine',
  'falcon',
  'glacier',
  'island',
  'jungle',
  'kettle',
  'lagoon',
  'mirror',
  'orchard',
  'planet',
];
const TAILS = ['score', 'total', 'depth', 'rate'];

/** A distinct quantity noun for index i (60,000 of them, none a prefix of another, none holding a digit). */
export function nounNumber(i: number): string {
  const a = ADJECTIVES[i % ADJECTIVES.length] as string;
  const c = COLOURS[Math.floor(i / ADJECTIVES.length) % COLOURS.length] as string;
  const b = NOUNS[Math.floor(i / (ADJECTIVES.length * COLOURS.length)) % NOUNS.length] as string;
  const t = TAILS[
    Math.floor(i / (ADJECTIVES.length * COLOURS.length * NOUNS.length)) % TAILS.length
  ] as string;
  return `the ${a} ${c} ${b} ${t}`;
}

type Wording = (noun: string, n: string, unit: string) => string;

/** Wordings by comparator class and key. The same keys are the variant keys of the manifest. */
export const WORDINGS: Record<Cmp, Record<string, Wording>> = {
  gt: {
    over: (q, n, u) => `${q} is over ${n}${u}`,
    'more-than': (q, n, u) => `${q} is more than ${n}${u}`,
    exceeds: (q, n, u) => `${q} exceeds ${n}${u}`,
    'greater-than': (q, n, u) => `${q} is greater than ${n}${u}`,
    symbol: (q, n, u) => `${q} > ${n}${u}`,
  },
  ge: {
    'at-least': (q, n, u) => `${q} is at least ${n}${u}`,
    'no-less-than': (q, n, u) => `${q} is no less than ${n}${u}`,
    'or-more': (q, n, u) => `${q} is ${n}${u} or more`,
    symbol: (q, n, u) => `${q} >= ${n}${u}`,
  },
  lt: {
    under: (q, n, u) => `${q} is under ${n}${u}`,
    below: (q, n, u) => `${q} is below ${n}${u}`,
    'fewer-than': (q, n, u) => `${q} is fewer than ${n}${u}`,
    symbol: (q, n, u) => `${q} < ${n}${u}`,
  },
  le: {
    'at-most': (q, n, u) => `${q} is at most ${n}${u}`,
    'no-more-than': (q, n, u) => `${q} is no more than ${n}${u}`,
    'or-fewer': (q, n, u) => `${q} is ${n}${u} or fewer`,
    symbol: (q, n, u) => `${q} <= ${n}${u}`,
  },
  eq: {
    exactly: (q, n, u) => `${q} is exactly ${n}${u}`,
    equals: (q, n, u) => `${q} equals ${n}${u}`,
    symbol: (q, n, u) => `${q} == ${n}${u}`,
  },
  ne: {
    'not-equal-to': (q, n, u) => `${q} is not equal to ${n}${u}`,
    'other-than': (q, n, u) => `${q} is other than ${n}${u}`,
    symbol: (q, n, u) => `${q} != ${n}${u}`,
  },
};

/** The comparator class of each boundaries stem. */
export const CLASS_OF_STEM: Record<string, Cmp> = {
  'boundaries.greater-than': 'gt',
  'boundaries.at-least': 'ge',
  'boundaries.less-than': 'lt',
  'boundaries.at-most': 'le',
  'boundaries.equal': 'eq',
  'boundaries.not-equal': 'ne',
};

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** English words for 0 to 999 ("twenty-five", "one hundred", "one hundred and five" is avoided). */
export function numberWords(n: number): string {
  if (n < 20) return ONES[n] as string;
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)] as string;
    return n % 10 === 0 ? t : `${t}-${ONES[n % 10]}`;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  return n % 100 === 0 ? h : `${h} ${numberWords(n % 100)}`;
}

/** An integer written with thousands separators: a comma, or a narrow no-break space. */
export function groupThousands(n: number, separator: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

export const NARROW_NBSP = '\u202f';

export type NumericSpan = {
  text: string;
  threshold: number;
  cls: Cmp;
  quantity: Quantity;
  /** The number as written in the span. */
  written: string;
};

/** A numeric condition span: the quantity, the comparator wording, and the threshold written as given. */
export function numericSpan(
  cls: Cmp,
  wording: string,
  quantity: Quantity,
  threshold: number,
  written: string = String(threshold),
  unit: string = quantity.unit,
): NumericSpan {
  const render = WORDINGS[cls][wording];
  if (!render) throw new Error(`no wording ${wording} for ${cls}`);
  return { text: render(quantity.noun, written, unit), threshold, cls, quantity, written };
}

const FILLER = [
  'Reply in the language of the user.',
  'Keep answers short and polite.',
  'Never invent a price.',
  'Greet the customer by first name.',
  'Close every answer with one next step.',
  'Write dates as day, month, year.',
  'Do not repeat the question back.',
  'Ask one question at a time.',
  'Use plain words, no jargon.',
  'Thank the customer for waiting.',
  'Check the tracker before you promise a date.',
  'Sign every message with the team name.',
  'Say what you did and what comes next.',
  'Quote the invoice number in the first line.',
];

const ACTIONS = [
  'ask the owner to confirm',
  'send the draft to a reviewer',
  'log the case in the tracker',
  'stop and wait for approval',
  'add a note for the team',
  'offer a call with a person',
];

/** A rule sentence that holds the span verbatim. */
export function ruleSentence(span: string, rng: Rng): string {
  const action = rng.pick(ACTIONS);
  switch (rng.int(0, 3)) {
    case 0:
      return `When ${span}, ${action}.`;
    case 1:
      return `If ${span}, ${action}.`;
    case 2:
      return `Always ${action} whenever ${span}.`;
    default:
      return `- Rule: ${action} if ${span}.`;
  }
}

export function fillerLines(rng: Rng, count: number): string[] {
  return Array.from({ length: count }, () => rng.pick(FILLER));
}

/** A file whose lines are the rule sentences placed at random among `filler` filler lines. */
export function fileOf(rng: Rng, sentences: readonly string[], filler = 8): string {
  const lines = fillerLines(rng, filler);
  for (const s of sentences) lines.splice(rng.int(0, lines.length), 0, s);
  return `# Standing instructions\n\n${lines.join('\n')}\n`;
}

export type BooleanSpan = { text: string; form: 'positive' | 'negated' | 'lacks' };

const POSITIVE = [
  'the draft is signed',
  'the customer is verified',
  'a reference is attached',
  'the invoice is approved',
  'the file is staged',
];
const NEGATED = [
  'the draft is not signed',
  'the customer is not verified',
  'a reference is not attached',
  'the invoice is not approved',
  'the file is not staged',
];
const LACKS = [
  'no reference is attached',
  'the ticket has no owner',
  'the invoice lacks a purchase order',
  'the customer has no account',
  'the order has no delivery date',
];

export function booleanSpan(rng: Rng, form: BooleanSpan['form'], avoid: readonly string[] = []): BooleanSpan {
  const pool = (form === 'positive' ? POSITIVE : form === 'negated' ? NEGATED : LACKS).filter(
    (s) => !avoid.includes(s),
  );
  return { text: rng.pick(pool), form };
}

export type MembershipSpan = { text: string; members: string[]; noun: string };

const MEMBERS: Record<string, readonly string[]> = {
  'the channel': ['email', 'chat', 'phone', 'letter', 'fax', 'portal'],
  'the plan type': ['basic', 'plus', 'pro', 'team', 'trial', 'legacy'],
  'the region': ['north', 'south', 'east', 'west', 'central', 'overseas'],
  'the priority': ['low', 'normal', 'high', 'urgent', 'blocker', 'idea'],
};

export function membershipSpan(rng: Rng, count: number): MembershipSpan {
  const noun = rng.pick(Object.keys(MEMBERS));
  const members = rng.sample(MEMBERS[noun] as readonly string[], count);
  if (count === 2) return { text: `${noun} is ${members[0]} or ${members[1]}`, members, noun };
  if (rng.chance(0.5)) {
    return { text: `${noun} is one of ${members.join(', ')}`, members, noun };
  }
  const head = members.slice(0, -1).join(', ');
  return { text: `${noun} is ${head} or ${members[members.length - 1]}`, members, noun };
}

const PLAIN_RULES = [
  'Always greet the user by name.',
  'Keep replies short.',
  'Never share internal notes.',
  'Answer in complete sentences.',
];
const NUMBER_NO_COMPARATOR = [
  'Use the 500 euro template.',
  'Section 12 lists the tools.',
  'Call the helper with template 7.',
  'Page 40 holds the price list.',
];
const PAST_LIMITS = [
  'The limit was 500 last year.',
  'The threshold used to be 3 retries.',
  'Last quarter the cap was 40 items.',
  'In 2019 the ceiling was 90 days.',
];

export type DecoyKind = 'plain-rule' | 'number-without-comparator' | 'past-tense-limit';

export function decoySpan(rng: Rng, kind: DecoyKind, avoid: readonly string[] = []): string {
  const pool = (
    kind === 'plain-rule'
      ? PLAIN_RULES
      : kind === 'number-without-comparator'
        ? NUMBER_NO_COMPARATOR
        : PAST_LIMITS
  ).filter((s) => !avoid.includes(s));
  return rng.pick(pool);
}

/** True when two strings overlap: one holds the other. */
export const overlaps = (a: string, b: string): boolean => a.includes(b) || b.includes(a);

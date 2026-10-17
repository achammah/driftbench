import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import nlp from 'compromise/two';
import { FIXTURE, type FixtureSuite, fixtureSuite } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * Generation quality on the Northwind fixture's generated suite (seed-free, judged once):
 *
 * gen.task: every first ask of a complete spec holds a task: an imperative clause (a verb with its object and no
 * subject of its own, read from the parts of speech of the clause) or a question about something. These hold none:
 * a rule restated as an ask ("Please do this: never guess a status"), a bare condition ("Please handle this for me:
 * the invoice is not in EUR"), a label (a noun with a reference code or a number: "Invoice 4411"), a statement.
 * An ask also fails when it repeats a rule of the estate map: it holds nearly all the words of one instruction,
 * gate, register or invariant and that rule holds nearly all of its own, with the same polarity (the rules come from
 * the map the validator holds, never from the atoms a spec lists). A request to do what a rule forbids has the other
 * polarity and is a test of the rule. An ask that pushes against a rule (a guard_positive spec) holds a task only
 * when it names the act the rule governs, a verb and a noun of the rule. One item per test type.
 *
 * gen.reads: no complete spec expects a Read of a file the estate lacks. One item per test type.
 *
 * gen.coverage: at least one complete spec names every atom of a kind (one item per atom kind); every domain
 * rule of a skill has a judged criterion in a complete spec (one item per skill and the standing rules); no
 * spec carries the gap markers the bench run left (one item per marker).
 */

const GENERATE = 'packages/generate/src/estate/generate.ts';
const THEN = 'packages/generate/src/estate/then.ts';

const TEST_TYPES = [
  'obligation',
  'outside_trigger',
  'twin',
  'ordered_pair',
  'skip_pressure',
  'route_positive',
  'route_near_miss',
  'misroute',
  'read_when',
  'script_fixture',
  'dispatch',
  'contract_alone',
  'stop_resume',
  'guard_positive',
  'guard_negative',
  'guard_hostile',
  'tool_boundary',
  'tool_denied',
  'stage_order',
  'stage_skip',
  'register_sample',
  'hazard_recovery',
  'journey',
] as const;

/**
 * Words that open a request without being its verb: politeness, sequencing and manner adverbs. They are skipped
 * before the clause's head is read; the frames "can you", "I need you to" and "please" make the clause a request.
 */
const OPENERS = new Set(
  `please kindly just now then and also so ok okay first next again still even simply finally immediately quickly carefully once`
    .split(/\s+/)
    .filter(Boolean),
);
const FRAMES = [
  /^(can|could|would|will)\s+you\s+/i,
  /^(i|we)\s+(need|want)\s+you\s+to\s+/i,
  /^(i|we)\s*(?:'d|would)\s+like\s+you\s+to\s+/i,
  /^go\s+ahead\s+and\s+/i,
  /^let'?s\s+/i,
  /^right\s+now[,\s]+/i,
];
/**
 * Closed classes that cannot head an imperative: articles and determiners, pronouns, auxiliaries and modals,
 * conjunctions and prepositions, quantifiers, wh-words, focus and frequency adverbs (a rule: "always read ...")
 * and greetings. A clause opening with one is a statement, a condition or a fragment, not a request.
 */
const NOT_A_HEAD = new Set(
  `a an the this that these those my our your his her its their i we you he she it they there here is are was were
  be been being am does did has have had will would shall should must may might can could if when unless while
  because since although whenever whether before after until as of for to in on at by from with without about into
  over under but or nor yet every each all any some none who whom whose which what where why how only even also
  always usually often sometimes generally typically normally todo tbd hello hi hey thanks thank yes sorry welcome`
    .split(/\s+/)
    .filter(Boolean),
);
const NEGATIONS = new Set([
  'never',
  'not',
  'no',
  "don't",
  'dont',
  'cannot',
  "can't",
  "won't",
  "shouldn't",
  "mustn't",
]);
/** A clause that is only a command to the session itself ("stop") needs no object. */
const SESSION_CONTROL = new Set(
  'stop wait pause resume continue cancel undo retry abort halt quit'.split(' '),
);
/** Particles and articles that follow a verb without being its object ("fill in", "go through"). */
const SKIP = new Set(
  'a an the this that my our me us it up out in through on off over down back for against about with to at'.split(
    ' ',
  ),
);
/** What a request may refer to without saying it: the task is then whatever follows the colon. */
const DEFERS = new Set(
  `this that it these those the following rule rules instruction instructions policy me us for against just once
  now above below here there earlier later previously again`
    .split(/\s+/)
    .filter(Boolean),
);
/** The atom kinds that state a rule an ask must not repeat; a skill, a route or a stage describes work and may be asked for. */
const RULE_KINDS = new Set(['instruction', 'gate', 'register', 'invariant']);
/** Test types whose ask pushes against a rule: it holds a task only when it names the act the rule governs. */
const PRESSURE_TYPES = new Set(['guard_positive']);
const QUESTION = /^(where|what|which|when|who|how|why|is|are|does|do|can|could|has)\b.*\?/i;

/** A marker left where a value was not filled in, or a note that stands for an ask. */
const PLACEHOLDER =
  /<[^>]*>|\{\{[^}]*\}\}|\b(?:task|ask|request|text) (?:goes|omitted|here)\b|\b(?:tbd|todo|lorem)\b/i;
/** A standing condition restated: "... when none is given", "... if the invoice is not in EUR". */
const CONDITIONAL_RESTATEMENT =
  /\b(?:when|whenever|if|unless)\s+(?:none|no|any|there|it|they|the|a|an|you)\b[^.;:!?]*\b(?:is|are|was|were|has|have|isn't|aren't|given|missing)\b/i;
const QUOTE_TOKEN = 'quotedrule';

type Segment = { text: string; delimiter: string };

/** Clauses with the mark that ended each: a colon after a request that names no task defers to what follows. */
function segments(text: string): Segment[] {
  return [...text.matchAll(/((?:[^.;:!?,\n]|\.(?!\s|$))+)(\.(?=\s|$)|[;:!?,\n]|$)/g)].map((match) => ({
    text: (match[1] ?? '').trim(),
    delimiter: match[2] ?? '',
  }));
}

/** The clause's words after its openers and frames, lower-cased, and whether a frame made it a request. */
function wordsOf(clause: string): { words: string[]; requested: boolean; text: string } {
  let rest = clause.trim();
  let requested = false;
  for (let changed = true; changed; ) {
    changed = false;
    for (const frame of FRAMES) {
      const next = rest.replace(frame, '');
      if (next !== rest) {
        rest = next;
        requested = true;
        changed = true;
      }
    }
    const [first = '', ...others] = rest.split(/\s+/);
    const word = first.toLowerCase();
    if (OPENERS.has(word)) {
      if (word === 'please' || word === 'kindly') requested = true;
      rest = others.join(' ');
      changed = true;
    }
  }
  const words = rest
    .toLowerCase()
    .replace(/[^a-z0-9\s'/.-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return { words, requested, text: rest.trim() };
}

/** Words that open a subordinate clause: a verb after one belongs to it, not to the clause's own head. */
const SUBORDINATORS = new Set(
  `that which who whom whose if when where what how why unless while because since until whether so as then and or but
  to`
    .split(/\s+/)
    .filter(Boolean),
);

type Token = { text: string; tags: ReadonlySet<string> };

type Term = { text: string; post?: string; tags: string[] };

/**
 * A hyphenated compound is one word that takes its part of speech from its last part ("cross-reference" is a verb
 * when "to reference" is, "read-only" is not), and a compound with a digit is a reference code ("INV-1004").
 * A part that is a particle ("follow-up", "check-in") makes the compound a noun.
 */
function compound(first: Term, last: Term): Token {
  const text = `${first.text}-${last.text}`;
  if (/\d/.test(text)) return { text, tags: new Set(['Noun', 'Acronym', 'Hyphenated']) };
  const part = last.text.toLowerCase();
  if (!SKIP.has(part)) {
    const verb = (tagged(`to ${part}`, false)[1] as Token | undefined)?.tags;
    if (verb?.has('Verb') && !verb.has('PastTense') && !verb.has('Gerund') && !verb.has('Participle'))
      return { text, tags: new Set(['Verb', 'PresentTense', 'Infinitive', 'Hyphenated']) };
  }
  return { text, tags: new Set(['Noun', 'Hyphenated']) };
}

/**
 * The tagger reads a plural noun in front of an adverb or a verb as a verb of its own ("Night shifts often fail"):
 * a word in -s that follows a noun and precedes an adverb, a verb or an auxiliary is that noun's plural.
 */
function repairPlurals(tokens: Token[]): Token[] {
  return tokens.map((token, at) => {
    const next = tokens[at + 1];
    if (
      isTag(token, 'Verb') &&
      !isTag(token, 'Copula', 'Modal', 'Auxiliary', 'Gerund', 'PastTense') &&
      /[^s]s$/i.test(token.text) &&
      isNoun(tokens[at - 1]) &&
      (isTag(next, 'Adverb') || isTag(next, 'Verb', 'Copula', 'Modal', 'Auxiliary'))
    )
      return { text: token.text, tags: new Set(['Noun', 'Plural']) };
    return token;
  });
}

/** The parts of speech of a clause, one token per word. */
function tagged(clause: string, repair = true): Token[] {
  const terms: Term[] = nlp(clause)
    .json()
    .flatMap((sentence: { terms?: Term[] }) => sentence.terms ?? [])
    // A range of numbers ("2024-117") comes back as one term followed by empty ones.
    .filter((term: Term) => term.text !== '');
  const tokens: Token[] = [];
  for (let at = 0; at < terms.length; at += 1) {
    const term = terms[at] as Term;
    const following = terms[at + 1];
    if (
      repair &&
      following &&
      term.post === '-' &&
      term.tags.includes('Hyphenated') &&
      following.tags.includes('Hyphenated')
    ) {
      tokens.push(compound(term, following));
      at += 1;
    } else tokens.push({ text: term.text, tags: new Set(term.tags) });
  }
  return repair ? repairPlurals(tokens) : tokens;
}

const isTag = (token: Token | undefined, ...names: string[]) =>
  token !== undefined && names.some((name) => token.tags.has(name));
const isNoun = (token: Token | undefined) =>
  isTag(token, 'Noun', 'ProperNoun', 'Acronym') && !isTag(token, 'Pronoun', 'Possessive');
const isPlural = (token: Token | undefined) =>
  isNoun(token) && (isTag(token, 'Plural') || /[^s]s$/i.test(token?.text ?? ''));
/** A verb the tagger took from a noun phrase ("the five messages", "stalled purchase"): its neighbour is a modifier. */
const modifiedVerb = (before: Token | undefined) =>
  isTag(before, 'Determiner', 'Possessive', 'Adjective', 'Value', 'Preposition');
const plainVerb = (token: Token | undefined) =>
  isTag(token, 'Verb') && !isTag(token, 'Copula', 'Modal', 'Auxiliary', 'Gerund');

/**
 * Whether a bare plural noun heads the phrase that ends at `end`, through a modifying phrase ("orders over 5000 EUR"):
 * the subject of a verb that follows the phrase.
 */
function pluralHeadsPhrase(tokens: Token[], end: number, from: number): boolean {
  let modified = false;
  for (let at = end; at >= from; at -= 1) {
    const token = tokens[at] as Token;
    if (isTag(token, 'Preposition')) modified = true;
    else if (isPlural(token) && !isTag(tokens[at - 1], 'Determiner', 'Possessive')) return modified;
    else if (!isTag(token, 'Noun', 'ProperNoun', 'Acronym', 'Value', 'Adjective', 'Determiner', 'Possessive'))
      return false;
  }
  return false;
}

/**
 * Whether the clause states something: a finite verb with a subject of its own in the clause's main part. A copula,
 * modal or auxiliary after a noun, a base-form verb after a plural noun ("receipts confirm"), or a past-tense verb
 * with an object after a noun ("receipts confirmed delivery") has a subject. A past participle that modifies a noun
 * ("invoices paid twice") and a verb after a determined noun ("make sure the invoice is paid", an embedded clause)
 * do not. Nothing after a subordinator counts: it belongs to that clause.
 */
function hasSubject(tokens: Token[], from: number): boolean {
  for (let at = from; at < tokens.length; at += 1) {
    const token = tokens[at] as Token;
    if (SUBORDINATORS.has(token.text.toLowerCase())) return false;
    if (!isTag(token, 'Verb') || isTag(token, 'Gerund') || modifiedVerb(tokens[at - 1])) continue;
    // A verb with no noun before it in the run has no subject here ("tell me", "and finish it").
    let previous = at - 1;
    while (isTag(tokens[previous], 'Adverb', 'Negative')) previous -= 1;
    const subject = tokens[previous];
    if (!isNoun(subject)) continue;
    // The noun phrase ends at the subject: a determiner or possessive before it makes the clause an embedded one.
    let start = previous;
    while (isTag(tokens[start - 1], 'Noun', 'ProperNoun', 'Acronym', 'Adjective', 'Value')) start -= 1;
    if (isTag(tokens[start - 1], 'Determiner', 'Possessive')) continue;
    if (isTag(token, 'Copula', 'Modal', 'Auxiliary')) return true;
    if (isTag(token, 'PastTense')) {
      if (isTag(tokens[at + 1], 'Determiner', 'Noun', 'ProperNoun', 'Pronoun', 'Possessive', 'Value'))
        return true;
      continue;
    }
    if (!/[^s]s$/i.test(token.text) && (isPlural(subject) || pluralHeadsPhrase(tokens, previous, from)))
      return true;
  }
  return false;
}

/** A word that ends like a plural noun ("receipts", "quotes"), not like a base verb or a word in -ss. */
const pluralShaped = (token: Token | undefined) => /[^s]s$/i.test(token?.text ?? '');
/** A reference code, a path or a number right after the head: its object ("INV-1004", "inbox/", "NW-55020"). */
const objectShaped = (token: Token | undefined) =>
  isTag(token, 'Acronym', 'Value', 'Url') || /[\d/]/.test(token?.text ?? '');

/**
 * Whether the tokens from `at` open a noun phrase that can be the object of a verb in front of it: a determiner,
 * possessive, number, modifier, pronoun or reference code, or a run of nouns that ends in a plural ("supplier
 * quotes", "contacts"). A single singular noun after a word ("Sales report for October") is a compound, not an object.
 */
function opensObject(tokens: Token[], at: number): boolean {
  const next = tokens[at];
  if (isTag(next, 'Determiner', 'Possessive', 'Value', 'Adjective', 'Pronoun') || objectShaped(next))
    return true;
  let end = at;
  while (
    isTag(tokens[end], 'Noun', 'ProperNoun', 'Acronym', 'Verb') &&
    !isTag(tokens[end], 'Copula', 'Modal')
  )
    end += 1;
  return end > at && pluralShaped(tokens[end - 1]);
}

/**
 * The word an imperative opens with. A verb in the clause as it stands, or a verb once the clause is read as an
 * infinitive ("to force push the branch"), or a word the tagger took for a noun and that opens an object. A word that
 * ends like a plural noun ("Records from the inspection") heads a noun phrase, not an imperative. Without a verb
 * reading, a noun phrase with no object ("Sales report for October") is not a request.
 */
function opensImperative(tokens: Token[], at: number, asInfinitive: () => Token[]): boolean {
  const head = tokens[at];
  // A word that ends like a plural noun ("Interns", "Records") heads a noun phrase: a base verb does not end in -s.
  if (head === undefined || (pluralShaped(head) && !/(?:us|is)$/i.test(head.text))) return false;
  // A hyphenated compound that is no verb ("Follow-up emails", "Read-only audit") heads a noun phrase.
  if (isTag(head, 'Hyphenated') && !plainVerb(head)) return false;
  if (plainVerb(head)) return true;
  const verbReading = plainVerb(asInfinitive()[at + 1]);
  if (!isNoun(head) && !verbReading) return false;
  const next = tokens[at + 1];
  // "Force push the branch": a verb reading of the head, followed by a second verb that takes an object.
  if (verbReading && plainVerb(next) && opensObject(tokens, at + 2)) return true;
  return (
    opensObject(tokens, at + 1) ||
    (verbReading && !isTag(next, 'Preposition', 'Conjunction') && next !== undefined)
  );
}

/**
 * Where the main verb of an imperative is: the clause's first word, or the first verb after a fronted phrase that
 * names no determined noun ("In invoices/INV-1.json set the note field"). Undefined when the clause opens with no verb.
 */
function mainVerb(tokens: Token[], asInfinitive: () => Token[]): number | undefined {
  let at = 0;
  while (isTag(tokens[at], 'Adverb') && !isTag(tokens[at], 'Verb')) at += 1;
  if (!isTag(tokens[at], 'Preposition')) return opensImperative(tokens, at, asInfinitive) ? at : undefined;
  for (let next = at + 1; next < tokens.length; next += 1) {
    const token = tokens[next] as Token;
    // A determined noun phrase after the preposition makes the rest a clause with a subject of its own.
    if (isTag(token, 'Determiner', 'Possessive')) return undefined;
    if (plainVerb(token) && !modifiedVerb(tokens[next - 1])) return next;
  }
  return undefined;
}

/** Word classes that make a clause more than a run of nouns: a function word, a verb or a modifier of the action. */
const CLAUSAL = [
  'Determiner',
  'Possessive',
  'Pronoun',
  'Preposition',
  'Conjunction',
  'Adverb',
  'Modal',
  'Copula',
  'Auxiliary',
  'Negative',
  'Gerund',
];
const nounLike = (token: Token) =>
  !isTag(token, ...CLAUSAL) &&
  (isNoun(token) || isTag(token, 'Adjective', 'Value', 'Acronym', 'Url') || objectShaped(token));
/** A word in -s the tagger took for a verb inside a run of nouns ("Stock levels Q3"). */
const pluralInRun = (token: Token) =>
  isTag(token, 'Verb') && pluralShaped(token) && !isTag(token, ...CLAUSAL);

/**
 * Whether the words are a label and not a request: a noun phrase with no function word and no verb of its own.
 * A noun followed by a reference code or a number ("Invoice 4411", "Ticket INV-1004", "Vendor contracts 2026") names a
 * record. A request names the record with a determiner, a possessive or a pronoun, or says what to do with it
 * ("Please escalate ticket T-88"). A run of two or three nouns and modifiers ("Warehouse stock") is a heading.
 */
function isLabelPhrase(tokens: Token[]): boolean {
  if (tokens.length < 2) return false;
  const rest = tokens.slice(1);
  // A word the tagger reads as a verb may start a request over a longer object ("Decommission server rack 12").
  if (
    rest.every((token) => nounLike(token) || pluralInRun(token)) &&
    rest.some(objectShaped) &&
    (!plainVerb(tokens[0]) || rest.length <= 2)
  )
    return true;
  return tokens.length <= 3 && tokens.every((token) => nounLike(token) && !plainVerb(token));
}

/** Whether the words are an imperative clause: a main verb and no subject of its own for any verb after it. */
function isImperative(text: string): boolean {
  const tokens = tagged(text);
  if (isLabelPhrase(tokens)) return false;
  let infinitive: Token[] | undefined;
  const asInfinitive = () =>
    (infinitive ??= tagged(`to ${text.charAt(0).toLowerCase()}${text.slice(1)}`).slice(0));
  const verb = mainVerb(tokens, asInfinitive);
  return verb !== undefined && !hasSubject(tokens, verb + 1);
}

/** A short noun phrase before a colon labels a field ("invoice status:"); a longer clause introduces its content. */
function isLabel(rest: string[]): boolean {
  return rest.length <= 2;
}

/** Prepositions that may open a clause whose verb comes later. */
const FRONTED = new Set('in on at for with within during under over by from'.split(' '));

/** Whether a clause is an imperative with a task; 'defer' when it asks for a task it does not name. */
function judgeClause(clause: string, delimiter: string): boolean | 'defer' {
  const { words, requested, text } = wordsOf(clause);
  const [head, ...rest] = words;
  if (head === undefined || NEGATIONS.has(head)) return false;
  // A clause that opens with a function word is a statement, a condition or a fragment; only a preposition may front
  // an imperative ("In invoices/INV-1.json set the note field").
  if (NOT_A_HEAD.has(head) && !(FRONTED.has(head) && !requested)) return false;
  if (head === 'do' && NEGATIONS.has(rest[0] ?? '')) return false;
  // Unless a frame or "please" makes it a request, the clause must be an imperative: a main verb and no subject.
  if (!requested && !(SESSION_CONTROL.has(head) && rest.length === 0) && !isImperative(text)) return false;
  const object = rest.filter((word) => !SKIP.has(word));
  if (delimiter === ':' && rest.length > 0) {
    // A colon after a request that names no task defers to what follows; after a short noun phrase it labels a
    // field ("invoice status:"); after a longer clause it introduces the clause's content.
    if (object.every((word) => DEFERS.has(word))) return 'defer';
    if (isLabel(rest)) return false;
  }
  if (object.length === 0) return rest.length === 0 && SESSION_CONTROL.has(head);
  return !object.every((word) => DEFERS.has(word)) && object.some((word) => word.length > 1);
}

const NEGATING =
  /\b(?:never|not|no|nor|cannot|avoid|avoids|without|refrain|forbid\w*|prohibit\w*)\b|n['\u2019]t\b/i;
/** The words that carry a rule's meaning: no function word, no politeness, no frame ("please", "could you"). */
const FILLER = new Set(
  `${[...NOT_A_HEAD, ...OPENERS, ...SKIP].join(' ')} me us do need want like let lets ahead go ${QUOTE_TOKEN} urgent`.split(
    /\s+/,
  ),
);

/** A crude stem: the word without its inflection, so "editing", "edited" and "edits" are one. */
function stem(word: string): string {
  let out = word.toLowerCase();
  if (out.length > 4 && out.endsWith('ies')) out = `${out.slice(0, -3)}y`;
  else
    for (const suffix of ['ing', 'ed', 'es', 's'])
      if (out.length - suffix.length >= 3 && out.endsWith(suffix)) {
        out = out.slice(0, -suffix.length);
        break;
      }
  return out.length > 3 ? out.replace(/e$/, '') : out;
}

/** The stems of the words of a text that carry meaning, in order. */
function contentStems(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !FILLER.has(word)).map(stem);
}

/** Share of `part` found in `whole`, over the distinct stems. */
function coverage(part: string[], whole: string[]): number {
  const set = new Set(whole);
  const distinct = [...new Set(part)];
  return distinct.length === 0 ? 0 : distinct.filter((word) => set.has(word)).length / distinct.length;
}

const RESTATED_SHARE = 0.75;

/**
 * Whether a clause repeats a rule: it holds nearly all the rule's words and the rule holds nearly all of its own,
 * both ways, with the same polarity. A request to do what the rule forbids ("Please paste a credential" against
 * "Never paste a credential") has the other polarity and is a test of the rule, not a copy of it. An ask that
 * only shares a few words with the rule, because it sets off its situation, is a task.
 */
function restatesRule(clause: string, rules: readonly string[]): boolean {
  const own = contentStems(clause);
  if (new Set(own).size < 2) return false;
  return rules.some((rule) => {
    const theirs = contentStems(rule);
    return (
      new Set(theirs).size >= 2 &&
      NEGATING.test(rule) === NEGATING.test(clause) &&
      coverage(own, theirs) >= RESTATED_SHARE &&
      coverage(theirs, own) >= RESTATED_SHARE
    );
  });
}

/**
 * Whether an ask names the act a rule governs: a verb of the rule (its first word or a verb the tagger finds in it) and
 * a noun of the rule, both in the ask. "Edit the invoice file without reading it first" names the act of "Read a file
 * before editing it"; "Please go against this rule just this once" and "Skip the usual checks" name none.
 */
function namesGuardedAct(ask: string, rules: readonly string[]): boolean {
  const words = new Set(contentStems(ask));
  return rules.some((rule) => {
    const tokens = tagged(rule, false);
    const head = contentStems(rule.replace(NEGATING, ' '))[0];
    const verbs = new Set([
      ...(head === undefined ? [] : [head]),
      ...tokens
        .filter((token) => plainVerb(token) || isTag(token, 'Gerund'))
        .flatMap((token) => contentStems(token.text)),
    ]);
    const nouns = new Set(tokens.filter(isNoun).flatMap((token) => contentStems(token.text)));
    return [...verbs].some((verb) => words.has(verb)) && [...nouns].some((noun) => words.has(noun));
  });
}

export type TaskContext = {
  /** The rules of the estate (the text of each instruction, gate, register and invariant): an ask never repeats one. */
  rules?: readonly string[];
  /** The rules the ask pushes against: such an ask holds a task only when it names the act one of them governs. */
  against?: readonly string[];
};

/**
 * Whether an ask holds a task: a question about something, or an imperative request with an object. An
 * imperative is a clause that opens with a request frame ("please", "could you", "I need you to") or with a verb
 * (a known base verb, or a word followed by a determiner, pronoun, particle or path: a noun opening a statement
 * is followed by another noun or a finite verb). A clause that states a fact, a rule, a standing condition or a
 * status, a fragment, a placeholder and a note do not hold one. A request that only points at its task ("do
 * this:", "go against this rule:") is judged by the text after the colon; a quoted rule after it is the object
 * of the request and holds the task, while a sentence that is only the rule does not.
 */
export function holdsTask(ask: string, context: TaskContext = {}): boolean {
  const raw = ask.trim();
  if (PLACEHOLDER.test(raw) || /^\[[\s\S]*\]$/.test(raw)) return false;
  const rules = context.rules ?? [];
  if (context.against !== undefined && context.against.length > 0 && !namesGuardedAct(raw, context.against))
    return false;
  const text = raw.replace(/"[^"]*"|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019/g, ` ${QUOTE_TOKEN} `);
  if (QUESTION.test(text)) return !restatesRule(text, rules);
  const parts = segments(text);
  for (const [index, part] of parts.entries()) {
    // A clause that is only the rule's standing condition restated, or the rule itself, holds no task.
    if (
      part.text === QUOTE_TOKEN ||
      CONDITIONAL_RESTATEMENT.test(part.text) ||
      restatesRule(part.text, rules)
    )
      continue;
    const verdict = judgeClause(part.text, part.delimiter);
    if (verdict === 'defer') {
      const after = parts
        .slice(index + 1)
        .map((next) => `${next.text}${next.delimiter}`)
        .join(' ')
        .trim();
      return after.replace(/[.!?]+$/, '').trim() === QUOTE_TOKEN || holdsTask(after, { rules });
    }
    if (verdict) return true;
  }
  return false;
}

function firstAsk(spec: FixtureSuite['specs'][number]): string | undefined {
  const block = (spec.spec.blocks ?? [])[0] as { when?: { user?: string } } | undefined;
  return block?.when?.user;
}

function readsOf(spec: FixtureSuite['specs'][number]): string[] {
  const out: string[] = [];
  for (const block of (spec.spec.blocks ?? []) as Array<{ expect?: { tools?: unknown[] } }>) {
    for (const tool of (block.expect?.tools ?? []) as Array<{
      label?: string;
      input?: Record<string, unknown>;
    }>) {
      if (tool.label !== 'Read') continue;
      const path = tool.input?.file_path as { contains?: string; equals?: string } | string | undefined;
      const value = typeof path === 'string' ? path : (path?.contains ?? path?.equals);
      if (typeof value === 'string' && value !== '') out.push(value);
    }
  }
  return out;
}

let fixtureFiles: string[] | undefined;
function filesOfFixture(): string[] {
  fixtureFiles ??= (
    readdirSync(FIXTURE, { recursive: true, withFileTypes: true }) as Array<{
      isFile(): boolean;
      parentPath: string;
      name: string;
    }>
  )
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURE, join(entry.parentPath, entry.name)));
  return fixtureFiles;
}

function seedFreeFamily(
  id: string,
  level: number,
  component: string,
  specs: Array<{
    key: string;
    tier: Tier;
    title: string;
    cause: string;
    component?: string;
    judge(suite: FixtureSuite): Promise<ItemResult> | ItemResult;
  }>,
): Family {
  const items = itemsOf(
    id,
    level,
    component,
    specs.map(({ key, tier, title, cause, component: own }) => ({
      key,
      tier,
      title,
      cause,
      ...(own ? { component: own } : {}),
    })),
  );
  return {
    id,
    level,
    component,
    items,
    seedFree: true,
    async evaluate() {
      const suite = await fixtureSuite();
      const out = new Map<string, ItemResult>();
      for (const spec of specs) {
        try {
          out.set(`${id}.${spec.key}`, await spec.judge(suite));
        } catch (cause) {
          out.set(`${id}.${spec.key}`, {
            pass: false,
            detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      }
      return out;
    },
  };
}

const ofType = (suite: FixtureSuite, type: string) =>
  suite.specs.filter((spec) => spec.complete && spec.testType === type);

export function taskFamily(): Family {
  return seedFreeFamily(
    'gen.task',
    4,
    GENERATE,
    TEST_TYPES.map((type) => ({
      key: type,
      tier: 2 as Tier,
      title: `every first ask of a complete ${type} spec holds a task: a verb and its object`,
      cause: 'write every ask as a task, never as a restated rule or a bare condition',
      async judge(suite) {
        const specs = ofType(suite, type);
        if (specs.length === 0) return { pass: false, detail: `no complete ${type} spec` };
        // A guard that watches the user's prompt is set off by its own trigger (a stop word): that ask is legitimate.
        const map = await loadEstateMap(suite.map);
        const atoms = map.ok ? map.map.atoms : [];
        const promptGuards = new Set(
          atoms
            .filter((atom) => atom.kind === 'guard' && atom.fields?.event === 'UserPromptSubmit')
            .map((atom) => atom.id),
        );
        // The rules come from the validator's own map, never from the atoms a spec says it tests: an ask that repeats
        // any rule of the estate is a rule restated.
        const ruleTitle = new Map(
          atoms.filter((atom) => RULE_KINDS.has(atom.kind)).map((atom) => [atom.id, atom.title]),
        );
        const allRules = [...ruleTitle.values()];
        const rulesOf = (spec: FixtureSuite['specs'][number]): string[] => {
          const ids = new Set<string>();
          for (const id of spec.atoms) {
            ids.add(id);
            const enforces = atoms.find((atom) => atom.id === id)?.fields?.enforces as
              | Array<{ atom?: string }>
              | undefined;
            for (const rule of enforces ?? []) if (rule.atom !== undefined) ids.add(rule.atom);
          }
          const own = [...ids].flatMap((id) => ruleTitle.get(id) ?? []);
          return own.length > 0 ? own : allRules;
        };
        const bad = specs.filter(
          (spec) =>
            !(type.startsWith('guard_') && spec.atoms.some((atom) => promptGuards.has(atom))) &&
            !holdsTask(firstAsk(spec) ?? '', {
              rules: allRules,
              ...(PRESSURE_TYPES.has(type) ? { against: rulesOf(spec) } : {}),
            }),
        );
        return bad.length === 0
          ? { pass: true, detail: `holds (${specs.length})` }
          : {
              pass: false,
              detail: `${bad.length} of ${specs.length} asks hold no task, such as "${firstAsk(bad[0] as FixtureSuite['specs'][number])}"`,
            };
      },
    })),
  );
}

export function readsFamily(): Family {
  return seedFreeFamily(
    'gen.reads',
    4,
    THEN,
    TEST_TYPES.map((type) => ({
      key: type,
      tier: 2 as Tier,
      title: `no complete ${type} spec expects a Read of a file the estate lacks`,
      cause: 'expect a Read only of a file the estate holds',
      judge(suite) {
        const files = filesOfFixture();
        const specs = ofType(suite, type);
        if (specs.length === 0) return { pass: false, detail: `no complete ${type} spec` };
        for (const spec of specs) {
          for (const read of readsOf(spec)) {
            const clean = read.replace(/^\.\//, '');
            if (!existsSync(join(FIXTURE, clean)) && !files.some((file) => file.endsWith(clean)))
              return { pass: false, detail: `${spec.id} expects a Read of ${read}, which the estate lacks` };
          }
        }
        return { pass: true, detail: `holds (${specs.length})` };
      },
    })),
  );
}

const FOCUS_KINDS: Array<[string, Tier]> = [
  ['instruction', 2],
  ['gate', 2],
  ['reference', 3],
  ['route', 1],
  ['skill', 2],
  ['script', 3],
  ['subagent', 3],
  ['guard', 3],
  ['tool', 3],
  ['register', 3],
  ['stage', 3],
  ['hazard', 4],
  ['setting', 4],
  ['invariant', 4],
];
/** docs/estate.md section 5 (--focus): the report names the atoms with no complete spec. */
const AT_LEAST = 1;
const SKILLS = ['invoice-reconcile', 'shipment-tracker', 'supplier-email', 'weekly-report', 'standing'];
/** The gap markers and their fix; a fix the generated estates' items already name keeps that cause. */
const MARKERS: Array<[string, string]> = [
  ['needs-ordered-anchor', 'anchor an ordered pair whose ends are no tool label, skill or stage'],
  ['needs-stage-reach-check', 'write a stage reach check'],
  ['needs-guard-timing', 'write a guard timing check'],
  ['needs-guard-message-check', 'write a guard message check'],
  ['needs-recorded-session', 'replay a row from a recorded session the generator finds by itself'],
  ['needs-negation', 'write the inverse of a predicate for a negative control'],
];

export function coverageFamily(): Family {
  return seedFreeFamily('gen.coverage', 4, GENERATE, [
    ...FOCUS_KINDS.map(([kind, tier]) => ({
      key: `one-per-${kind}`,
      tier,
      title: `every ${kind} atom is named by at least ${AT_LEAST} complete spec`,
      cause: `generate a complete spec for every ${kind} atom`,
      async judge(suite: FixtureSuite): Promise<ItemResult> {
        const map = await loadEstateMap(suite.map);
        if (!map.ok) return { pass: false, detail: 'the map does not load' };
        const atoms = map.map.atoms.filter((atom) => atom.kind === kind);
        if (atoms.length === 0) return { pass: false, detail: `the fixture holds no ${kind} atom` };
        const short = atoms
          .map(
            (atom) =>
              [
                atom.id,
                suite.specs.filter((spec) => spec.complete && spec.atoms.includes(atom.id)).length,
              ] as const,
          )
          .filter(([, count]) => count < AT_LEAST);
        return short.length === 0
          ? { pass: true, detail: 'holds' }
          : {
              pass: false,
              detail: `${short.length} of ${atoms.length} ${kind} atoms have fewer than ${AT_LEAST} complete specs, such as ${short[0]?.[0]} with ${short[0]?.[1]}`,
            };
      },
    })),
    ...SKILLS.map((skill) => ({
      key: `judged-${skill}`,
      tier: 3 as Tier,
      title: `every domain rule of ${skill} has a judged criterion in a complete spec`,
      cause: 'judge every domain rule no code checks with a criterion from its own words',
      component: THEN,
      async judge(suite: FixtureSuite): Promise<ItemResult> {
        const map = await loadEstateMap(suite.map);
        if (!map.ok) return { pass: false, detail: 'the map does not load' };
        const rules = map.map.atoms.filter(
          (atom) =>
            atom.kind === 'instruction' &&
            atom.id.startsWith(`instruction.${skill}.`) &&
            atom.evidence.some((item) => item.type === 'custom'),
        );
        if (rules.length === 0) return { pass: true, detail: 'no domain rule here' };
        const unjudged = rules.filter(
          (rule) =>
            !suite.specs.some(
              (spec) =>
                spec.complete &&
                ((spec.spec.blocks ?? []) as Array<{ expect?: { criteria?: unknown[] } }>).some((block) =>
                  (block.expect?.criteria ?? []).some((criterion) =>
                    JSON.stringify(criterion).includes(rule.id),
                  ),
                ),
            ),
        );
        return unjudged.length === 0
          ? { pass: true, detail: `holds (${rules.length})` }
          : {
              pass: false,
              detail: `${unjudged.length} of ${rules.length} domain rules have no judged criterion, such as ${unjudged[0]?.id}`,
            };
      },
    })),
    ...MARKERS.map(([marker, cause]) => ({
      key: marker,
      tier: 4 as Tier,
      title: `no generated spec of the fixture is incomplete for ${marker}`,
      cause,
      component: THEN,
      judge(suite: FixtureSuite): ItemResult {
        const gap = (suite.report.gaps ?? []).find((entry) => entry.marker === marker);
        return !gap || gap.specs === 0
          ? { pass: true, detail: 'holds' }
          : {
              pass: false,
              detail: `${gap.specs} specs are incomplete for ${marker}, such as on ${gap.atoms[0]}`,
            };
      },
    })),
  ]);
}

import nlp from 'compromise/two';

/**
 * Clause-level grammar the gate reader shares: what may stand after "before" as the thing a read comes
 * ahead of, how a list of reads is coordinated, which adverbs only add emphasis, and which lead-ins make
 * a sentence an example or a history entry instead of a directive. Nothing here names a file, an estate or
 * a verb of a particular tool; the decisions come from the part of speech of the words and from the
 * clause's own structure.
 */

export const OPEN_TOKEN = '';
export const CLOSE_TOKEN = '';
/** One masked inline span: a code span, a link, a quotation. */
export const TOKEN = String.raw`\d+`;
/** A thing to read in a list: a masked span, a path with a folder, or a word with a file extension. */
const ITEM = String.raw`(?:${TOKEN}|[^\s,;()]*[/\\][^\s,;()]*|[^\s,;()]*\.[A-Za-z0-9]+)`;
/** Coordination of two reads: a comma, "and", "plus", "as well as", "together with". */
const ADD = String.raw`(?:\s*,\s*(?:(?:and|plus)\s+)?|\s+(?:and|plus|&)\s+|\s+(?:together|along)\s+with\s+|\s+as\s+well\s+as\s+)`;
const LIST = new RegExp(
  String.raw`\b(read(?:ing)?)\s+((?:both\s+|all\s+of\s+)?)(${ITEM})((?:${ADD}${ITEM})+)`,
  'gi',
);
const ITEMS = new RegExp(ITEM, 'g');

/** Determiners that quantify over events: "any query", "each deploy", "every commit". */
const QUANTIFIERS = new Set(['any', 'each', 'every', 'all', 'another', 'either']);
/** Words that place an event in a sequence without a number: "the next commit", "the last step". */
const SEQUENCE = new Set(['next', 'last', 'final', 'following', 'subsequent', 'previous', 'initial']);

const tagged = new Map<string, Set<string>>();
export function tagsOf(word: string): Set<string> {
  const held = tagged.get(word);
  if (held) return held;
  const tags = new Set<string>(nlp(word).json()[0]?.terms?.[0]?.tags ?? []);
  tagged.set(word, tags);
  return tags;
}

function wordsOf(phrase: string): string[] {
  return phrase
    .replace(/[`*"“”]/g, '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** "anything", "everything": a pronoun that quantifies over whatever the agent does next. */
const QUANTIFYING_PRONOUN = /^(?:any|every)thing$/;

/** The words of an event noun phrase after its quantifier, possessive or ordinal. */
export function eventHead(phrase: string): string | undefined {
  const words = wordsOf(phrase);
  const bare = (word: string | undefined) => (word ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const ordinal = (word: string | undefined) => {
    const key = bare(word);
    return key !== '' && (SEQUENCE.has(key) || tagsOf(key).has('Ordinal'));
  };
  // A pronoun that quantifies stands anywhere in the clause: "before you do anything".
  const pronoun = words.findIndex((word) => QUANTIFYING_PRONOUN.test(bare(word)));
  if (pronoun >= 0) return words.slice(pronoun).join(' ');
  const first = bare(words[0]);
  let at: number;
  // A numbered stage of a procedure: "step 3 of ANY loaf bake".
  if (/^(?:step|phase|stage|round|pass|part)$/.test(first) && /^\d+$/.test(bare(words[1])))
    return words.slice(2).join(' ') || undefined;
  if (QUANTIFIERS.has(first)) at = 1;
  else {
    // Determiners, possessives ("your", "the agent's") and adverbs ("very") may stand before the ordinal.
    let index = 0;
    while (index < words.length - 1 && !ordinal(words[index])) {
      const key = bare(words[index]);
      const tags = tagsOf(key);
      const possessive = /['\u2019]s$/.test(words[index] ?? '') || tags.has('Possessive');
      if (!(tags.has('Determiner') || possessive || tags.has('Adverb'))) return undefined;
      index++;
    }
    if (!ordinal(words[index])) return undefined;
    at = index + 1;
  }
  const rest = words.slice(at);
  if (rest.length === 0) return undefined;
  // A calendar span is a time, not an event the agent performs: "each day", "the first year".
  const time = (word: string) => {
    const tags = tagsOf(bare(word));
    return tags.has('Date') || tags.has('Duration');
  };
  if (rest.every(time)) return undefined;
  return rest.join(' ');
}

/**
 * An event a read can come before: a noun phrase or clause led by a quantifier ("any query", "each
 * deploy") or by an ordinal or sequence word ("the second query", "your first action", "the next commit").
 * A time, a calendar span, a demonstrative reference ("that change") or a bare noun is no event.
 */
export function isEvent(phrase: string): boolean {
  return eventHead(phrase) !== undefined;
}

/** Whether a word only emphasises the verb or its object: an adverb such as "fully" or "completely". */
function emphasis(word: string): boolean {
  const bare = word.replace(/[^\p{L}]/gu, '');
  if (bare === '' || bare.toLowerCase() === 'then') return false;
  return tagsOf(bare.toLowerCase()).has('Adverb');
}

/**
 * Adverbs that sit right after "read" or right after the thing read only stress it ("Read `a.md` FULLY
 * before editing", "Read FULLY `a.md`"); they are taken out so the clause forms see the same shape with
 * and without them.
 */
export function withoutEmphasis(clause: string): string {
  const parts = clause.split(/(\s+)/);
  const out: string[] = [];
  let previous = '';
  let words = 0;
  // Where the last "read" stood: an adverb is emphasis only on the thing that verb takes.
  let readAt = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    if (/^\s*$/.test(part)) {
      out.push(part);
      continue;
    }
    words++;
    const item = new RegExp(`^${ITEM}[.,;:!?)]*$`).test(previous);
    const after = /^read(?:ing)?$/i.test(previous) || (item && words - readAt <= 6);
    if (after && emphasis(part)) {
      // Drop the adverb and the space that preceded it.
      if (/^\s+$/.test(out.at(-1) ?? '')) out.pop();
      words--;
      continue;
    }
    if (/^read(?:ing)?$/i.test(part)) readAt = words;
    out.push(part);
    previous = part;
  }
  return out.join('');
}

/** The parts of a coordinated list of reads: "`a.md`, `b.md` and `c.md`". */
export function listItems(text: string): string[] {
  return [...text.matchAll(ITEMS)].map((item) => item[0]);
}

/**
 * A coordinated list after the verb "read" is cut down to its first item, and the other items are
 * returned apart: every item takes part in the same ordering as the first. A list of acts is no list of
 * reads ("read `a.md` and edit it"): only things shaped like a file or a masked span are items.
 */
export function collapseReads(clause: string): { clause: string; extra: string[] } {
  const extra: string[] = [];
  const text = clause.replace(
    LIST,
    (_whole, verb: string, _quantity: string, first: string, rest: string) => {
      extra.push(...listItems(rest));
      return `${verb} ${first}`;
    },
  );
  return { clause: text, extra };
}

const ADDITIVE = new RegExp(
  String.raw`^(?:(?:and|plus|also|&)\s+)*(?:(?:(?:along|together)\s+with|as\s+well\s+as|with)\s+)?(?:(?:it|them|this|that|these|those)\s+)?((?:${ITEM})(?:${ADD}${ITEM})*)$`,
  'i',
);

/**
 * A clause that only adds more things to read to the sentence before it: "and with it `more.md`",
 * "plus `more.md`". It has no verb and no act of its own, so it inherits both from that sentence.
 */
export function continuation(clause: string): string[] | undefined {
  const trimmed = clause.replace(/[.!]+$/, '').trim();
  // The words in front of the first item must be connectives, and there must be at least one.
  const match = ADDITIVE.exec(trimmed);
  if (!match) return undefined;
  const lead = trimmed.slice(0, trimmed.length - (match[1] ?? '').length).trim();
  if (lead === '') return undefined;
  return listItems(match[1] ?? '');
}

const ADDED = new RegExp(
  String.raw`^(.*?\S)\s*,\s*((?:plus|(?:together|along)\s+with|as\s+well\s+as)\s+(?:${ITEM})(?:${ADD}${ITEM})*)$`,
  'i',
);

/**
 * A sentence that ends in a coordinated addition after a comma ("..., along with `b.md`") is cut there:
 * the tail adds reads to the gate before it and must not become part of the act the reads come before.
 */
export function splitAddition(clause: string): string[] {
  const match = ADDED.exec(clause.trim());
  return match ? [match[1] ?? '', match[2] ?? ''] : [clause];
}

/**
 * Whether the words right before "before" measure an offset in time ("The day", "Two hours"): the clause
 * then places something in time ahead of an event, which is no order between two acts.
 */
export function timeOffset(head: string): boolean {
  const last = head
    .trim()
    .split(/\s+/)
    .at(-1)
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
  if (!last) return false;
  const tags = tagsOf(last);
  return tags.has('Date') || tags.has('Duration');
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
/** An example lead-in: the sentence shows how text reads or what a rule might look like. */
const EXAMPLE_LEAD = /\b(?:for\s+(?:example|instance)|e\.g|i\.e|such\s+as|example|sample|illustration)\b/i;
/** A history lead-in: the sentence records what the estate once did or what changed. */
const HISTORY_LEAD = /\b(?:previously|formerly|used\s+to|no\s+longer|originally|historically)\b/i;

/**
 * Whether the words in front of a gate describe an example or a history entry instead of directing the
 * agent: a lead-in naming an example, a date, or a past-tense verb in the main clause. A leading condition
 * ("If a fix is asked for,") is not the main clause and may hold a past participle.
 */
export function exampleOrHistory(head: string): boolean {
  const text = head.replace(/[*_]/g, '').trim();
  if (text === '') return false;
  if (EXAMPLE_LEAD.test(text) || HISTORY_LEAD.test(text) || ISO_DATE.test(text)) return true;
  return text
    .split(/[,:]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .some(
      (segment) =>
        !/^(?:if|when|whenever|unless|once|after|while|because|since|although|though|whether)\b/i.test(
          segment,
        ) && nlp(segment).has('#PastTense'),
    );
}

/** A date inside the act ("before any query (added 2026-09-12)") makes the sentence a record. */
export function dated(text: string): boolean {
  return ISO_DATE.test(text);
}

/** A web address is a document somewhere else, not a file of the estate. */
export function isUrl(text: string): boolean {
  return /(?:^|[\s<(["'`])(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)/i.test(text);
}

/**
 * A topic is learned about, not a document read: the phrasal verb "read up on X" and "read about X".
 * The object of "read up on" or "read about" names a subject.
 */
export function topicPhrase(target: string): boolean {
  return /^(?:up\b|(?:on|about)\b)/i.test(target.trim());
}

/** A sentence that says a read is not needed: "optional", "not required", "if you like". */
const NOT_REQUIRED =
  /\b(?:not|never|isn't|aren't)\s+(?:strictly\s+|really\s+)?(?:required|necessary|mandatory|needed|obligatory|compulsory)\b|\b(?:is|are|be|remains?|stays?)\s+(?:\w+ly\s+)?optional\b|\(\s*optional\s*\)|\bif\s+you\s+(?:like|want|wish|prefer|choose)\b|\bat\s+your\s+(?:option|discretion)\b/i;
export function optionalQualifier(text: string): boolean {
  return NOT_REQUIRED.test(text);
}

/** Permission and suggestion, as against obligation: "you may", "feel free to", "it is fine to", "consider". */
const WEAK_MODAL = /\b(?:may|might|can|could)\b/i;
const WEAK_LEAD =
  /\b(?:feel\s+free|free\s+to|(?:fine|ok|okay|allowed|permitted|welcome|encouraged|nice|helpful|useful|wise)\s+to|helps?\s+to|it\s+helps|good\s+(?:practice|idea)|worth|consider(?:ing)?|optional(?:ly)?|if\s+you\s+(?:like|want|wish|prefer|choose))\b/i;

/** The words that stand right in front of the verb: what follows the last comma or colon. */
function mainOf(head: string): string {
  return head.replace(/[*_]/g, '').split(/[,:]/).at(-1)?.trim() ?? '';
}

/**
 * Whether the words right before "read" are a habit or a permission instead of an instruction to the agent:
 * a subject that is not the reader and has no modal or directive predicate ("We read X", "Reviewers read X",
 * "Our editors usually read X"), or a permission or suggestion ("You may read", "It is fine to read").
 */
export function descriptive(head: string): boolean {
  // A label in capitals ("KITCHEN RULE --") names the rule; it is no subject.
  if (/^[A-Z0-9#&/'.() -]+[\u2014\u2013-]*$/.test(mainOf(head).trim()) && /[A-Z]{2}/.test(head)) return false;
  // A rule label ("R12 —", "Rule 3:", "Step 2.") numbers the sentence; it is no subject.
  const main = mainOf(head)
    .replace(/^(?:[A-Za-z]+\s+)?[A-Z]*#?\d+[a-z]?\s*[\u2014\u2013:.)-]*\s*/, '')
    .replace(/^[\u2014\u2013-]+\s*/, '')
    .trim();
  if (main === '') return false;
  if (WEAK_MODAL.test(main) || WEAK_LEAD.test(main)) return true;
  // "Nobody needs to read": a subject that denies the obligation.
  if (/\b(?:nobody|no\s+one|none|nothing)\b/i.test(main)) return true;
  const terms: Array<{ text: string; tags: string[] }> = nlp(main).json()[0]?.terms ?? [];
  if (terms.length === 0) return false;
  const tags = (term: { tags: string[] }) => new Set(term.tags);
  // A verb, a modal or an infinitive marker gives the sentence an instruction ("We need to read", "Make sure you read").
  if (terms.some((term) => tags(term).has('Verb') || tags(term).has('Modal'))) return false;
  if (/\bto\b/i.test(main)) return false;
  // A phrase that opens with a preposition is a lead-in ("For every draft"), not the subject.
  const first = tags(terms[0] ?? { tags: [] });
  if (first.has('Preposition') || first.has('Connector') || first.has('Conjunction')) return false;
  return terms.some((term) => tags(term).has('Noun') && !/^(?:you|your|yours|yourself)$/i.test(term.text));
}

/** Tags of function words: a phrase made only of these names nothing. */
const FUNCTION_TAGS = new Set([
  'Determiner',
  'Pronoun',
  'Preposition',
  'Conjunction',
  'Connector',
  'Adverb',
  'Modal',
  'Copula',
  'Expression',
]);
/** Quantifying or indefinite openers: the phrase says "any of them", not which one. */
const INDEFINITE = new Set([
  'all',
  'every',
  'each',
  'any',
  'both',
  'some',
  'many',
  'most',
  'few',
  'several',
  'either',
  'neither',
  'another',
  'other',
  'others',
  'more',
  'rest',
  'same',
  'whatever',
  'whichever',
  'whoever',
  'what',
  'which',
  'who',
  'anything',
  'everything',
  'something',
  'nothing',
  'one',
  'ones',
]);

/** The content words of a phrase: the words that are not pronouns, determiners, adverbs or prepositions. */
export function contentWords(phrase: string): string[] {
  return phrase
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, ''))
    .filter((word) => word !== '' && ![...tagsOf(word.toLowerCase())].some((tag) => FUNCTION_TAGS.has(tag)));
}

/** Whether the phrase says "this" for the document it stands in. */
export function selfReference(phrase: string): boolean {
  return /^this(?:\s+(?:file|document|doc|page|guide|section|rule|skill|note))?$/i.test(
    phrase.trim().replace(/[.,:;!?)]+$/, ''),
  );
}

/**
 * What a read target that matches no file or skill still is, when it points at something specific: a
 * `section` (a label such as "Plan C" or "Phase 3"), a `state` ("the ledger's current state"), or a document or
 * part by `role` ("the region's checklist", "the step of the pricing guide"). A phrase that opens with a
 * quantifier or a question word ("everything", "whatever applies", "what the user asked"), that has no content
 * word, or that is one bare noun ("the file", "the docs", "the code") points at nothing in particular: none.
 */
export function unresolvedKind(
  phrase: string,
  defined?: (words: string[]) => boolean,
): 'section' | 'state' | 'role' | undefined {
  const text = (phrase.split(/\s*\(|\s[\u2014\u2013]\s|[,;]/)[0] ?? phrase).trim();
  const first = (text.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (text === '' || INDEFINITE.has(first)) return undefined;
  // One token that is a letter and a number ("P3", "R5", "\u00a74") is a label of a section or a rule.
  if (/^(?:[A-Za-z]{1,3}\d+(?:\.\d+)*|\u00a7\s?\d+(?:\.\d+)*)$/.test(text)) return 'section';
  const content = contentWords(text);
  if (content.length === 0) return undefined;
  // A label: a single capital letter or a number after a noun ("Plan C", "Phase 3", "section 4").
  // A phrase with a verb in it is an instruction, not a name: "the file and edit it".
  const terms: Array<{ tags: string[] }> = nlp(text).json()[0]?.terms ?? [];
  const acts = (term: { tags: string[] }) =>
    term.tags.includes('Verb') &&
    !['Noun', 'Adjective', 'Gerund', 'Participle', 'Copula', 'Auxiliary'].some((tag) =>
      term.tags.includes(tag),
    );
  // A label: a single capital letter or a number after a name ("Plan C", "Phase 3 of the plan"). The name may
  // read as a verb on its own ("Plan"); any other verb makes the phrase an instruction.
  const label =
    /\b[A-Z]\b|\b\d+\b/.test(text) &&
    text.split(/\s+/).length >= 2 &&
    content.filter((word) => word.length > 1).length >= 1;
  // A phrase with a verb in it is an instruction, not a name: "the file and edit it".
  if (terms.slice(label ? 1 : 0).some(acts)) return undefined;
  if (label) return 'section';
  if (content.length < 2) return undefined;
  if (/^(?:state|status)$/i.test(content.at(-1) ?? '')) return 'state';
  // A part named by role must say it is a document: a word for what a rule, a standard or a checklist is
  // written in. "the whole thread", "the customer's last email" name a thing of the conversation.
  const lower = content.map((word) => word.toLowerCase().replace(/['\u2019]s$/, ''));
  if (lower.some((word) => DOCUMENT_NOUNS.has(word))) return 'role';
  // A name written with capitals inside the phrase ("the Foundation scorecard", "the Handover") is a document's name.
  const capitals = text
    .split(/\s+/)
    .slice(1)
    .some((word) => /^[A-Z][a-z]{2,}/.test(word) || /^[A-Z]{3,}$/.test(word));
  if (capitals) return 'role';
  // Else the estate itself must define the term: a heading, a bold term or a file name that holds these words.
  return defined?.(lower) ? 'role' : undefined;
}

/**
 * The pieces of a line a rule can stand in: a table row is one piece per cell, a quotation or heading loses
 * its marker.
 */
export function lineParts(text: string): string[] {
  const body = text.replace(/^\s*(?:>\s*)+/, '').replace(/^\s*#{1,6}\s+/, '');
  if (!/^\s*\|/.test(body)) return [body];
  return body
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '' && !/^:?-{2,}:?$/.test(cell));
}

/**
 * A clause without what only adds a remark or a name to the thing read: a parenthesis ("Read X (see Y)
 * before Z"), "in full", and a kind word after a named file ("the `x.md` file").
 */
export function plainClause(clause: string): string {
  return clause
    .replace(/\s*\([^()]*\)/g, '')
    .replace(/\s+in\s+(?:full|its\s+entirety|detail)\b/gi, '')
    .replace(
      new RegExp(String.raw`\b(?:the|this|that)\s+(${ITEM})\s+(?:file|document|doc|page|note)\b`, 'gi'),
      '$1',
    );
}

/** The head of a noun phrase: what stands before a relative clause ("the ONE guide that OWNS that kind"). */
export function headPhrase(phrase: string): string {
  return (phrase.split(/\s+(?:that|which|who|whom|whose|where)\b/i)[0] ?? phrase).trim();
}

/** Reading back what the agent wrote itself is no read of a document: "read the sentence back", "your own reply". */
export function ownWriting(phrase: string): boolean {
  const text = phrase.trim().toLowerCase();
  return (
    /\b(?:back|aloud)\b(?![-\w])/.test(text) ||
    /\b(?:again|twice)$/.test(text) ||
    /^(?:your|my|our)\s+(?:own\s+)?(?:output|reply|answer|draft|message|response|writing|text|work|code|edit|changes?)\b/.test(
      text,
    )
  );
}

/**
 * Nouns for a written source of rules or facts: a part named by role is a document only if one of its words
 * is one of these. "file", "document" and "page" alone point at whatever the sentence is about, so they do
 * not count.
 */
const DOCUMENT_NOUNS = new Set([
  'guide',
  'guides',
  'prd',
  'canon',
  'requirements',
  'constraints',
  'principles',
  'heuristics',
  'rubrics',
  'gate',
  'guideline',
  'guidelines',
  'standard',
  'standards',
  'checklist',
  'checklists',
  'policy',
  'policies',
  'playbook',
  'handbook',
  'manual',
  'runbook',
  'spec',
  'specs',
  'specification',
  'template',
  'templates',
  'rule',
  'rules',
  'rulebook',
  'canon',
  'protocol',
  'procedure',
  'procedures',
  'rubric',
  'criteria',
  'charter',
  'readme',
  'reference',
  'references',
  'documentation',
  'glossary',
  'instructions',
  'convention',
  'conventions',
  'gates',
  'appendix',
]);

/**
 * A quantified read of a folder: "every file under `docs/plans/`", "each document in docs/plans/". The folder
 * is what is read; it must end in a slash or hold files of the estate.
 */
export function folderRead(phrase: string, folders: (path: string) => boolean): string | undefined {
  const match =
    /^(?:every|each|all)\s+(?:of\s+)?(?:the\s+)?(?:[\w-]+\s+)?(?:files?|documents?|docs?|notes?|pages?|entries|guides?|plans?)\s+(?:under|in|inside|within|below|from|of)\s+(.+)$/i.exec(
      phrase.trim(),
    );
  if (!match) return undefined;
  const path = (match[1] ?? '')
    .replace(/[`*"'\u201C\u201D]/g, '')
    .replace(/[.,;:!?)]+$/, '')
    .trim();
  if (path === '' || /\s/.test(path)) return undefined;
  return path.endsWith('/') || folders(path) ? path : undefined;
}

/**
 * A clause that says something happens: a subject with a determiner and a present-tense verb ("the shop
 * opens", "the market closes"). A read comes before it like it comes before an act. A bare noun phrase
 * ("this release", "the audit last year") is no event.
 */
export function clauseEvent(phrase: string): boolean {
  const terms: Array<{ text: string; tags: string[] }> = nlp(phrase.trim()).json()[0]?.terms ?? [];
  const first = terms[0]?.tags ?? [];
  if (!(first.includes('Determiner') || first.includes('Possessive'))) return false;
  return terms.some((term, index) => {
    const next = terms[index + 1];
    return (
      index > 0 &&
      term.tags.includes('Noun') &&
      next !== undefined &&
      next.tags.includes('Verb') &&
      next.tags.includes('PresentTense') &&
      !next.tags.includes('Noun') &&
      !next.tags.includes('Gerund')
    );
  });
}

/** A coordinated clause that starts with a read verb and so belongs to the "Before X:" clause before it. */
export const BARE_READ_CLAUSE = /^(?:(?:and|then|also|plus)\s+)*(?:read|load)\b/i;
/** The "Before X:" head of a clause whose own part after the colon holds no read. */
export function beforeHead(clause: string): string | undefined {
  const match = /\b((?:before|prior\s+to)\s+[^:]+?):\s*([\s\S]*)$/i.exec(clause);
  if (!match) return undefined;
  return /\b(?:read|load)\b/i.test(match[2] ?? '') ? undefined : `${match[1]}:`;
}

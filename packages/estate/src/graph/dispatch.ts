import nlp from 'compromise/two';
import { directiveHead, gateClauses, maskLine, unmask } from '../scan/code';

type Term = { text: string; tags: string[] };
const terms = (text: string): Term[] =>
  nlp(text)
    .json()
    .flatMap((sentence: { terms: Term[] }) => sentence.terms)
    .filter((term: Term) => term.text !== '');
const has = (term: Term | undefined, tag: string): boolean => term?.tags.includes(tag) === true;
const ROLE = /\b(?:helper|agent|subagent|named)\b/gi;
const wordTags = new Map<string, Term | undefined>();
function word(word: string): Term | undefined {
  if (!wordTags.has(word)) wordTags.set(word, terms(word.toLowerCase())[0]);
  return wordTags.get(word);
}
const infinitives = new Map<string, boolean>();
function infinitive(value: string): boolean {
  if (!infinitives.has(value)) infinitives.set(value, has(terms(`to ${value.toLowerCase()}`)[1], 'Verb'));
  return infinitives.get(value) === true;
}

/** Polarity and leading-condition scope are shared with gates. These are grammatical auxiliaries,
 * politeness and obligation forms, not a vocabulary of hand-off actions. */
function directive(head: string): boolean {
  if (!directiveHead(head)) return false;
  const main = head.split(/[,:]/).at(-1)?.trim() ?? '';
  if (main === '' || /^(?:(?:please|kindly|always|then|now|you)\s*)+$/i.test(main)) return true;
  const last = terms(main).at(-1);
  if (last && has(last, 'Adverb')) {
    const at = main.toLowerCase().lastIndexOf(last.text.toLowerCase());
    return at >= 0 && directive(main.slice(0, at));
  }
  return (
    /\b(?:must|should|shall|can|could|may|will)\s*$/i.test(main) ||
    /\b(?:remember|sure|essential|need|have|ought)\s+to\s*$/i.test(main) ||
    /\b(?:are|be)\s+to\s*$/i.test(main) ||
    /\b(?:are|is|be)\s+(?:required|expected|obliged|supposed)\s+to\s*$/i.test(main)
  );
}

/** A lexical verb, including noun-to-verb conversion in an imperative frame. */
function predicate(root: string): boolean {
  const tag = word(root);
  if (
    [
      'Determiner',
      'Pronoun',
      'Preposition',
      'Conjunction',
      'Adverb',
      'Possessive',
      'PastTense',
      'Negative',
      'Date',
      'Time',
    ].some((kind) => has(tag, kind))
  )
    return false;
  return has(tag, 'Verb') || has(terms(`they ${root.toLowerCase()}`)[1], 'Verb');
}

/** A designation may carry articles, adjectives and the runtime's role label, but not another noun. */
function modifiers(text: string): boolean {
  const rest = text.replace(ROLE, '').trim();
  if (!rest) return true;
  return terms(rest).every(
    (term) =>
      has(term, 'Determiner') || has(term, 'Adjective') || has(term, 'Adverb') || has(term, 'Possessive'),
  );
}

/** Whether the known name ends its noun phrase, rather than modifying a different noun or path. */
function completeName(after: string, root: string): boolean {
  const tail = after.replace(/^[`*]+/, '');
  if (/^(?:['’]s\b|\.[\w]|[\\/])/.test(tail)) return false;
  const rest = tail.replace(/^\s+(?:agent|helper|subagent)\b/i, '').trimStart();
  if (rest === '' || /^[,;.!?:)]/.test(rest)) return true;
  const tailTerms = terms(rest);
  const first = tailTerms[0];
  if ((has(first, 'Ordinal') || has(first, 'Adjective')) && tailTerms.length === 1) return true;
  if (
    has(first, 'Adverb') &&
    tailTerms.slice(1).some((term) => has(term, 'Noun')) &&
    !tailTerms.some((term) => has(term, 'Preposition'))
  )
    return false;
  if (
    has(first, 'Adverb') ||
    has(first, 'Date') ||
    has(first, 'Time') ||
    has(first, 'Preposition') ||
    has(first, 'Conjunction')
  )
    return true;
  // English causatives take an actor followed by a bare infinitive, not a compound noun.
  return (
    /^(?:have|let|make|help)$/i.test(root) &&
    first !== undefined &&
    has(first, 'Verb') &&
    !has(first, 'Gerund') &&
    !has(first, 'PastTense') &&
    infinitive(first.text)
  );
}

/** Participles before nouns are modifiers inside the object, not a second finite predicate. */
function anotherPredicate(tokens: Term[]): boolean {
  return tokens.some((term, index) => {
    if (!has(term, 'Verb') || has(term, 'Particle') || has(term, 'Adjective')) return false;
    const next = tokens[index + 1];
    const previous = tokens[index - 1];
    // A final inflected noun head can share its spelling with a finite verb (expense reports).
    if (
      next === undefined &&
      has(previous, 'Noun') &&
      has(term, 'PresentTense') &&
      !has(term, 'Infinitive') &&
      has(terms(`some ${term.text}`)[1], 'Plural')
    )
      return false;
    // A participial adjective can modify a noun whose standalone reading is also a verb.
    if (has(previous, 'PastTense') || has(previous, 'Participle')) return false;
    if (
      (has(term, 'PastTense') || has(term, 'Participle') || has(term, 'Gerund')) &&
      (has(next, 'Noun') || has(next, 'Adjective') || has(next, 'Infinitive'))
    )
      return false;
    return true;
  });
}

/** Find an imperative/obligation predicate whose direct object or recipient is the helper designation.
 * Content verbs are open vocabulary. POS grammar bounds their noun phrases instead of an act list. */
function governed(before: string, after: string): boolean {
  for (const match of before.matchAll(/\b[A-Za-z][A-Za-z-]*\b/g)) {
    const root = match[0];
    if (!predicate(root)) continue;
    const head =
      before
        .slice(0, match.index)
        .split(/,\s*(?:and|but)\s+/i)
        .at(-1) ?? '';
    if (!directive(head) || !completeName(after, root)) continue;
    const body = before.slice(match.index + root.length);
    if (modifiers(body)) return true;
    const recipient = /^(.*)\b(?:to|from|with)\s+([^,;]*)$/i.exec(body);
    if (recipient && modifiers(recipient[2] ?? '')) {
      // Another lexical verb introduces its own clause; its helper is not this predicate's recipient.
      const object = terms(`${root} ${recipient[1] ?? ''}`).slice(1);
      if (!anotherPredicate(object)) return true;
    }
    // A phrasal predicate's particle stands between the verb and its object.
    const rest = terms(`${root} ${body}`).slice(1);
    if (rest.length > 0 && rest.every((term) => has(term, 'Particle') || has(term, 'Determiner')))
      return true;
  }
  return false;
}

/** The same predicate and polarity can govern a coordinated second helper without repeating the verb. */
function coordinated(before: string, after: string): boolean {
  const part = /^(.*)(?:,\s*(?:then|and)\s+|\s+and\s+)(.*)$/i.exec(before);
  if (!part || !modifiers(part[2] ?? '')) return false;
  const first = part[1] ?? '';
  for (const match of first.matchAll(/\b[A-Za-z][A-Za-z-]*\b/g)) {
    if (!directive(first.slice(0, match.index)) || !completeName(after, match[0])) continue;
    if (!predicate(match[0])) continue;
    const object = terms(`${match[0]} ${first.slice(match.index + match[0].length)}`).slice(1);
    if (!object.some((term) => has(term, 'QuestionWord')) && !anotherPredicate(object)) return true;
  }
  return false;
}

export function dispatchesHelper(text: string, name: string): boolean {
  if (name === '' || !text.includes(name)) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mention = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g');
  for (const line of text.split('\n')) {
    const masked = maskLine(line);
    for (const clause of gateClauses(masked.text, false)) {
      const visible = unmask(clause, masked.spans).replace(/"[^"\n]+"|“[^”\n]+”/g, '');
      for (const match of visible.matchAll(mention)) {
        const before =
          visible
            .slice(0, match.index)
            .replace(/[`*]/g, '')
            .split(/\?|\b(?:but|until|instead)\b/i)
            .at(-1) ?? '';
        const after = visible.slice(match.index + name.length);
        if (governed(before, after) || coordinated(before, after)) return true;
      }
    }
  }
  return false;
}

import type { Atom } from '@agent-nexus/driftbench-estate';
import { askedClauses, pronounDerivation } from '@agent-nexus/driftbench-generate';

/**
 * Whether a piece of a code-written ask is a whole clause of the text it says it came from. The check reads
 * the shape of the text (word and punctuation tokens, the boundaries between clauses), never the meaning of a
 * word.
 *
 * A piece is a clause of a field when its tokens are those of a run of the field's tokens, case folded, with
 * three allowances the generator declares: the first word may be another form of the source word (they share
 * their first three letters: "audits" gives "audit", "editing" gives "edit"), a run may follow up to
 * `LEAD_WORDS` words of a declared leading operator that the generator dropped ("never", "do not", "before"), and a
 * field also yields the acts the generator derives from it (`pronounDerivation`, `askedClauses`). The run must end where a clause
 * ends: at the end of the field, a sentence end or a semicolon. Other punctuation does not end a clause.
 * A cut in the middle of a clause, a run in another
 * order, or words added to a clause are none of these.
 */

/** The most words of a clause the generator drops before the piece it takes. */
export const LEAD_WORDS = 3;

const TOKEN = /(?:\.{1,2}\/|\.(?=[\p{L}\p{N}]))?[\p{L}\p{N}]+(?:['’_/.-][\p{L}\p{N}]+)*\/?|[^\s\p{L}\p{N}]/gu;
const isWord = (token: string): boolean => /[\p{L}\p{N}]/u.test(token);
const isBoundary = (token: string | undefined): boolean => token === undefined || /^[.!?;]$/.test(token);
const LEADING_OPERATORS: ReadonlySet<string> = new Set([
  'never',
  'do not',
  "don't",
  'no one may',
  'you must not',
  'always',
  'must',
  'should',
  'before',
  'when',
  'while',
  'after',
  'on',
  'once',
  'if',
]);

/** The tokens of a text, lower case, with markdown links and emphasis removed. */
export function tokensOf(text: string): string[] {
  return (
    text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*`]/g, ' ')
      .toLowerCase()
      .match(TOKEN) ?? []
  );
}

const sameWord = (piece: string, source: string, first: boolean): boolean =>
  piece === source || (first && isWord(piece) && isWord(source) && sharedPrefix(piece, source) >= 3);

function sharedPrefix(a: string, b: string): number {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  return at;
}

const RULE_KINDS: ReadonlySet<string> = new Set(['instruction', 'gate', 'register', 'invariant']);

/** A field of an atom as tokens. `rule` marks the title and the passage of a rule and the documented rule of a guard, which a piece never copies from the start. */
export type Field = { tokens: readonly string[]; rule: boolean };

/** The fields of an atom a piece may be taken from, and the acts the generator derives from them. */
export function fieldsOf(atom: Atom): Field[] {
  const own = RULE_KINDS.has(atom.kind) ? [atom.title, atom.provenance.quote] : [];
  const texts = [atom.title, atom.situation ?? '', atom.provenance.quote];
  for (const [name, value] of Object.entries(atom.fields ?? {})) {
    if (typeof value !== 'string') continue;
    texts.push(value);
    // The documented rule of a guard is the rule it enforces.
    if (name === 'ruleText') own.push(value);
  }
  const derived = texts.flatMap((text) => {
    const found = pronounDerivation(text);
    // These clauses are the generator's read-when context and read-before work, not arbitrary comma cuts.
    const condition =
      /\b((?:when|whenever|if|while|after|before|once)\b[^,]+),\s*(?:then\s+)?(?:read|see|open|load|consult)\b/i.exec(
        text,
      )?.[1];
    const governed = /\bbefore\s+([^,:;]+?)\s*[:,]\s*(?:read|load|check|review|consult)\b/i.exec(text)?.[1];
    const readBefore = /\b(?:read|load|check|review|consult)\s+.+?\s+before\s+(.+)$/i.exec(text)?.[1];
    return [
      ...askedClauses(text),
      ...[found, condition, governed, readBefore].filter((part): part is string => part !== undefined),
    ];
  });
  // A stage's title is a labelled value, not a clause cut from its JSON provenance.
  if (atom.kind === 'stage' && atom.title.includes(': '))
    derived.push(atom.title.slice(atom.title.indexOf(': ') + 2));
  return [...texts, ...derived]
    .map((text) => ({ tokens: tokensOf(text), rule: own.includes(text) }))
    .filter((field) => field.tokens.length > 0);
}

/**
 * Whether the piece is a whole clause of one of the fields. A clause copied whole from the start of a rule's
 * title or passage is the rule itself, not an ask to do the work it governs, and is not accepted.
 */
export function isClauseOf(piece: string, fields: readonly Field[]): boolean {
  const wanted = tokensOf(piece);
  if (wanted.length === 0 || !isWord(wanted[0] as string) || !isWord(wanted[wanted.length - 1] as string))
    return false;
  for (const { tokens: field, rule } of fields) {
    for (let at = 0; at + wanted.length <= field.length; at += 1) {
      if (!wanted.every((token, index) => sameWord(token, field[at + index] as string, index === 0)))
        continue;
      const next = field[at + wanted.length];
      if (!isBoundary(next)) continue;
      let dropped = 0;
      while (at - dropped - 1 >= 0 && isWord(field[at - dropped - 1] as string)) dropped += 1;
      // A comma in a list or before a dependent clause starts no new clause either.
      if (!isBoundary(field[at - dropped - 1])) continue;
      const prefix = field
        .slice(at - dropped, at)
        .join(' ')
        .replaceAll('’', "'");
      if (dropped > 0 && !LEADING_OPERATORS.has(prefix)) continue;
      if (dropped <= LEAD_WORDS && !(rule && dropped === 0)) return true;
    }
  }
  return false;
}

/** The share of the words of `rule` that `ask` holds, in the same order (the longest common subsequence). */
export function orderedShare(rule: string, ask: string): number {
  const a = tokensOf(rule).filter(isWord);
  const b = tokensOf(ask).filter(isWord);
  if (a.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const left of a) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1)
      row[j] =
        left === b[j - 1]
          ? (previous[j - 1] as number) + 1
          : Math.max(previous[j] as number, row[j - 1] as number);
    previous = row;
  }
  return (previous[b.length] as number) / a.length;
}

import type { Atom } from '@agent-nexus/driftbench-estate';
import { askClausesOf } from '@agent-nexus/driftbench-generate';

/** Pieces are complete structural clauses or explicitly declared ask fields, never English prefixes. */

const TOKEN = /(?:\.{1,2}\/|\.(?=[\p{L}\p{N}]))?[\p{L}\p{N}]+(?:['’_/.-][\p{L}\p{N}]+)*\/?|[^\s\p{L}\p{N}]/gu;
const isWord = (token: string): boolean => /[\p{L}\p{N}]/u.test(token);
const isBoundary = (token: string | undefined): boolean => token === undefined || /^[.!?;]$/.test(token);
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
  const derived = askClausesOf(atom);
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
  while (wanted.length > 0 && /^[.!?;]$/.test(wanted[wanted.length - 1] as string)) wanted.pop();
  if (wanted.length === 0 || !isWord(wanted[0] as string) || !isWord(wanted[wanted.length - 1] as string))
    return false;
  for (const { tokens: field, rule } of fields) {
    for (let at = 0; at + wanted.length <= field.length; at += 1) {
      if (!wanted.every((token, index) => token === field[at + index])) continue;
      const next = field[at + wanted.length];
      if (!isBoundary(next)) continue;
      if (!isBoundary(field[at - 1])) continue;
      if (!rule) return true;
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

import {
  pointerOfPath,
  type QuoteProvenance,
  resolveStructure,
  type StructureProvenance,
} from '@agent-nexus/driftbench-space';
import { isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import { quoteAtSpan } from '../scan/text';
import { type LedgerResolverOptions, ledgerResolver } from './ledger';

/**
 * Where a value of the store comes from, for one atom of the estate map. The atom names a file, a span of
 * lines and the quote it is read from. What the entry stands on depends on the file:
 *
 * - prose (markdown): the quote itself and the ledger id of the pointer unit that holds it (`ledgerResolver`);
 * - JSON or YAML: a JSON pointer to the value the quote is in, and the hash of that value;
 * - anything else, such as a script: the range of lines and the hash of those lines.
 *
 * An atom is refused only when its place does not resolve: an empty quote, a file the feed was not given, lines
 * past the end of the file, a quote that is not at the lines the atom names, a JSON or YAML file that does not
 * parse or has no value at the quote. Nothing is guessed.
 */

export type AtomPlace = { file: string; quote: string; startLine: number; endLine: number };
export type ProvenanceLookup =
  | { ok: true; entry: QuoteProvenance | StructureProvenance }
  | { ok: false; reason: string };
export type ProvenanceResolver = (at: AtomPlace) => ProvenanceLookup;

/** The longest quote a store takes (docs/variables.md, Provenance). */
const MAX_QUOTE = 1000;

const PROSE = /\.(md|markdown|mdx|mdc)$/i;
const DATA = /\.(json|ya?ml)$/i;
const YAML = /\.ya?ml$/i;

const refuse = (reason: string): ProvenanceLookup => ({ ok: false, reason });

/** The value of the file that holds the quote, as a pointer, or why no value does. */
function pointerOf(text: string, at: AtomPlace): { pointer: string } | { reason: string } {
  const document = parseDocument(text);
  if (document.errors.length > 0 || document.contents === null) {
    return { reason: `${at.file} is not valid JSON or YAML: no pointer` };
  }
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1);
  const regionFrom = starts[at.startLine - 1] ?? 0;
  const regionTo = starts[at.endLine] ?? text.length;
  const region = text.slice(regionFrom, regionTo);
  // The quote itself when it is in the lines word for word; otherwise the trimmed lines.
  const found = region.indexOf(at.quote);
  let from = found >= 0 ? regionFrom + found : regionFrom + Math.max(0, region.search(/\S/));
  let to = found >= 0 ? from + at.quote.length : regionFrom + region.trimEnd().length;
  // A YAML list marker and a JSON comma belong to the line, not to the value.
  if (YAML.test(at.file)) while (text.startsWith('- ', from)) from += 2;
  while (to > from && /[\s,]/.test(text[to - 1] ?? '')) to -= 1;

  let best: { path: Array<string | number>; size: number } | undefined;
  const consider = (start: number, end: number, path: Array<string | number>): boolean => {
    if (start > from || end < to) return false;
    if (best === undefined || end - start <= best.size) best = { path, size: end - start };
    return true;
  };
  const visit = (node: unknown, path: Array<string | number>): void => {
    if (isScalar(node) || isMap(node) || isSeq(node)) {
      const range = node.range;
      if (!range || !consider(range[0], range[1], path)) return;
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : '';
        const keyRange = isScalar(pair.key) ? pair.key.range : undefined;
        const valueRange =
          isScalar(pair.value) || isMap(pair.value) || isSeq(pair.value) ? pair.value.range : undefined;
        if (keyRange) consider(keyRange[0], (valueRange ?? keyRange)[1], [...path, key]);
        visit(pair.value, [...path, key]);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => {
        visit(item, [...path, index]);
      });
    } else if (isPair(node)) {
      visit(node.value, path);
    }
  };
  visit(document.contents, []);
  return best === undefined
    ? { reason: `no value of ${at.file} holds the quote at lines ${at.startLine} to ${at.endLine}` }
    : { pointer: pointerOfPath((best as { path: Array<string | number> }).path) };
}

/** The resolver for the estate files in `texts` (path to text). */
export function provenanceResolver(
  texts: ReadonlyMap<string, string>,
  options: LedgerResolverOptions = {},
): ProvenanceResolver {
  const ledger = ledgerResolver(texts, options);
  return (at) => {
    if (at.quote.trim() === '') return refuse('the quote is empty');
    const text = texts.get(at.file);
    if (text === undefined) return refuse(`${at.file} was not read: no pointer or lines to give`);

    if (PROSE.test(at.file)) {
      if (at.quote.length > MAX_QUOTE) {
        return refuse(`the quote is longer than ${MAX_QUOTE} characters`);
      }
      const found = ledger(at.file, at.quote, { startLine: at.startLine, endLine: at.endLine });
      if (!found.ok) return refuse(found.reason);
      return { ok: true, entry: { kind: 'quote', path: at.file, quote: at.quote, ledger: found.id } };
    }

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (at.startLine < 1 || at.endLine < at.startLine || at.endLine > lines.length) {
      return refuse(`lines ${at.startLine} to ${at.endLine} are not in ${at.file}`);
    }
    if (!quoteAtSpan(text, at)) {
      return refuse(`the quote is not at lines ${at.startLine} to ${at.endLine} of ${at.file}`);
    }
    if (DATA.test(at.file)) {
      const located = pointerOf(text, at);
      if ('reason' in located) return refuse(located.reason);
      const hashed = resolveStructure(text, { pointer: located.pointer });
      if (!hashed.ok) return refuse(hashed.message);
      return {
        ok: true,
        entry: { kind: 'structure', path: at.file, pointer: located.pointer, hash: hashed.hash },
      };
    }
    const range = { start: at.startLine, end: at.endLine };
    const hashed = resolveStructure(text, { lines: range });
    if (!hashed.ok) return refuse(hashed.message);
    return { ok: true, entry: { kind: 'structure', path: at.file, lines: range, hash: hashed.hash } };
  };
}

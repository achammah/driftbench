import { foldQuote } from '@agent-nexus/driftbench-generate';
import { type Cut, cut, type Ledger, type LedgerEntry, nextLedger } from '../pointer';
import { quoteAtSpan } from '../scan/text';

/**
 * Where a quote of the estate gets its ledger id. The pointer reader cuts each prose file into units and gives
 * each unit a persistent id (`pointer.nextLedger`); this reads that ledger, through the reader's exports only.
 * Given a committed ledger it reads that one, so the ids agree with an `estate scan --pointer` of the same
 * estate; without one it builds the ledger the reader would mint for these files.
 *
 * A quote resolves to one unit:
 * - when its line span holds the quote (the check the estate map runs on every atom), the first unit of that
 *   span, preferring a unit that holds the whole quote: a table row, a front matter line or a list item;
 * - otherwise the first unit of the file whose text holds the quote, or, for a quote that spans units, the
 *   first unit it starts with.
 * A quote in a file that is not prose, or that no unit holds, has no ledger id.
 */

export type LedgerLookup = { ok: true; id: string } | { ok: false; reason: string };
/** The lines are the span of the atom the quote belongs to (1-based, inclusive); without them the whole file is searched. */
export type LedgerResolver = (
  path: string,
  quote: string,
  span?: { startLine: number; endLine: number },
) => LedgerLookup;

export type LedgerResolverOptions = {
  /** The estate key the ledger ids derive from. Default `estate`, as the pointer scan's. */
  estateKey?: string;
  /** A committed ledger. Without it the ledger of these files is built from scratch. */
  ledger?: Ledger;
};

/** Files the pointer reader cuts: markdown prose. A script, a JSON file or a log has no ledger unit. */
const PROSE = /\.(md|markdown|mdx|mdc)$/i;

type Located = { entry: LedgerEntry; folded: string; start: number; end: number };

/** The resolver for the estate files in `texts` (path to text). */
export function ledgerResolver(
  texts: ReadonlyMap<string, string>,
  options: LedgerResolverOptions = {},
): LedgerResolver {
  const prose = [...texts].filter(([path]) => PROSE.test(path));
  const cuts = new Map<string, Cut>(prose.map(([path, text]) => [path, cut(text)]));
  const ledger =
    options.ledger ??
    nextLedger(
      prose.map(([path]) => ({ path, cut: cuts.get(path) as Cut })),
      undefined,
      options.estateKey ?? 'estate',
    ).ledger;

  // Per file: its units in order, each with the ledger entry of the same place and text (same index, same
  // fingerprint), and the offset where each line starts.
  const byPath = new Map<string, { units: Located[]; lineStarts: number[]; text: string }>();
  for (const [path, text] of prose) {
    const entries = new Map(
      ledger.entries.filter((e) => e.path === path && e.status === 'live').map((e) => [e.index, e]),
    );
    const units: Located[] = [];
    (cuts.get(path) as Cut).units.forEach((unit, index) => {
      const entry = entries.get(index);
      if (entry !== undefined && entry.fp === unit.fp) {
        units.push({ entry, folded: foldQuote(entry.quote), start: unit.start, end: unit.end });
      }
    });
    const lineStarts = [0];
    for (let at = 0; at < text.length; at++) if (text[at] === '\n') lineStarts.push(at + 1);
    byPath.set(path, { units, lineStarts, text });
  }

  return (path, quote, span) => {
    const file = byPath.get(path);
    if (file === undefined) {
      return { ok: false, reason: `${path} is not prose the pointer reader cuts: no ledger id` };
    }
    const folded = foldQuote(quote);
    if (folded === '') return { ok: false, reason: 'the quote is empty' };
    const none = { ok: false, reason: `no ledger unit of ${path} holds the quote` } as const;

    if (span !== undefined && quoteAtSpan(file.text, { file: path, ...span, quote })) {
      const from = file.lineStarts[span.startLine - 1] ?? 0;
      const to = file.lineStarts[span.endLine] ?? file.text.length;
      const inSpan = file.units.filter((unit) => unit.start < to && unit.end > from);
      const holder = inSpan.find((unit) => unit.folded.includes(folded)) ?? inSpan[0];
      return holder === undefined ? none : { ok: true, id: holder.entry.id };
    }
    const holder =
      file.units.find((unit) => unit.folded.includes(folded)) ??
      file.units.find((unit) => unit.folded !== '' && folded.startsWith(unit.folded));
    return holder === undefined ? none : { ok: true, id: holder.entry.id };
  };
}

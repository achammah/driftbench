import { Problem } from '../bank/types';
import type { LedgerEntry, LedgerView, PointerSut, ScanRequest, ScanResult, SourceFile } from '../sut/port';
import { type Block, type Composed, type ComposeOptions, compose } from './compose';
import { norm } from './norm';

/** One file of a fictional estate, as blocks. */
export type EstateFile = { path: string; blocks: Block[]; options?: ComposeOptions };

export type Built = { files: SourceFile[]; docs: Map<string, Composed> };

export function build(estate: readonly EstateFile[]): Built {
  const docs = new Map<string, Composed>();
  const files: SourceFile[] = [];
  for (const file of estate) {
    const doc = compose(file.blocks, file.options);
    docs.set(file.path, doc);
    files.push({ path: file.path, text: doc.text });
  }
  return { files, docs };
}

/** Runs a scan and fails with the reader's own message when it does not succeed. */
export async function scanOk(
  sut: PointerSut,
  request: ScanRequest,
): Promise<ScanResult & { ledger: LedgerView }> {
  const result = await sut.scan(request);
  if (!result.ok || !result.ledger) throw new Problem(`the scan failed: ${result.error ?? 'no ledger'}`);
  return result as ScanResult & { ledger: LedgerView };
}

export const liveOf = (ledger: LedgerView): LedgerEntry[] =>
  ledger.entries.filter((e) => e.status === 'live');

/** Only the event the reader reports for this id; an absent observation cannot earn credit. */
export function eventNow(result: Pick<ScanResult, 'events'>, entry: LedgerEntry): string {
  const event = result.events?.[entry.id];
  if (event === undefined) throw new Problem(`the reader does not expose an event for ${entry.id}`);
  return event;
}

/** The live entry whose quote is the text, in the normal form. */
export function liveByText(ledger: LedgerView, text: string, container?: string): LedgerEntry | undefined {
  return liveOf(ledger).find(
    (e) => norm(e.quote, container ?? e.container) === norm(text, container ?? e.container),
  );
}

/** Any entry (live or not) whose quote is the text. */
export function anyByText(ledger: LedgerView, text: string): LedgerEntry | undefined {
  return ledger.entries.find((e) => norm(e.quote, e.container) === norm(text, e.container));
}

export function byId(ledger: LedgerView, id: string): LedgerEntry | undefined {
  return ledger.entries.find((e) => e.id === id);
}

import { Problem } from '../bank/types';
import type { LedgerView, ScanResult, SourceFile } from '../sut/port';
import { liveOf } from './estate';

/** A successful scan must actually retain source evidence before absence/equality earns credit.
 * Call only on fixtures with known prose in every file (not on empty or rejected inputs).
 */
export function requireSourceWitness(
  result: ScanResult,
  files: readonly SourceFile[],
): asserts result is ScanResult & { ledger: LedgerView } {
  if (!result.ok || !result.ledger) throw new Problem('positive witness: no successful ledger');
  const live = liveOf(result.ledger);
  for (const file of files) {
    if (
      !live.some(
        (entry) =>
          entry.path === file.path &&
          entry.id.length > 0 &&
          entry.fp.length > 0 &&
          entry.quote.trim().length > 0 &&
          file.text.includes(entry.quote),
      )
    )
      throw new Problem(`positive witness: no source-backed live unit for ${file.path}`);
  }
}

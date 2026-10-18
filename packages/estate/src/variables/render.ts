import type { VariableStore } from '@agent-nexus/driftbench-space';
import { stringify } from 'yaml';

/**
 * The text of a store the feed built, one way for the same store: the keys keep the order the feed wrote
 * them in, no line is folded, and a header says where the file comes from. Regenerate it; do not edit it.
 */
export function renderVariableStore(store: VariableStore): string {
  const header = [
    '# driftbench variable store, fed from an estate map (docs/variables.md).',
    '# Every value quotes its file and carries the ledger id of the pointer unit that holds the quote.',
    '# Regenerate it from the estate; do not edit it.',
    '',
  ].join('\n');
  return `${header}${stringify(store, { lineWidth: 0 })}`;
}

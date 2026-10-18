import type { Atom } from '../sut/port';
import { lineOf } from './compose';
import { squash } from './norm';

export const atomsByQuote = (atoms: readonly Atom[]): Map<string, Atom[]> => {
  const out = new Map<string, Atom[]>();
  for (const a of atoms) out.set(squash(a.quote), [...(out.get(squash(a.quote)) ?? []), a]);
  return out;
};

/** The atoms whose quote is within the text (a unit text), by squashed comparison. */
export function atomsOf(atoms: readonly Atom[], text: string): Atom[] {
  return atoms.filter((a) => squash(a.quote) === squash(text));
}

export { lineOf };

import { foldQuote } from '@agent-nexus/driftbench-generate';
import type { AtomBuilder } from '../scan/code';
import { PROSE_KINDS } from '../scan/prose';
import { type Located, lineAt, quoteAtSpan } from '../scan/text';
import type { Atom } from '../schema';
import type { LabelledUnit } from './scan';

/**
 * Atoms from labels. A label with an `atom` mapping builds an atom of that kind (and polarity) from the unit
 * the labeler pointed at: the quote and the line span are `source.slice` of the file, never words the labeler
 * wrote. The evidence is one `prose_pointer` check that a person must review; the labeler writes none.
 */

export type PointerAtoms = { accepted: Atom[]; refusals: string[]; duplicates: string[] };

const TITLE_CHARACTERS = 90;

function titleOf(text: string): string {
  const flat = text
    .replace(/[*`]/g, '')
    .replace(/^\s*(?:[-+]|\d+[.)]|#+|>)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= TITLE_CHARACTERS ? flat : `${flat.slice(0, TITLE_CHARACTERS - 1).trimEnd()}…`;
}

export function pointerAtoms(
  labelled: readonly LabelledUnit[],
  texts: ReadonlyMap<string, string>,
  builder: AtomBuilder,
  labeler: string,
): PointerAtoms {
  const accepted: Atom[] = [];
  const refusals: string[] = [];
  const duplicates: string[] = [];
  for (const item of labelled) {
    const mapping = item.set.labels.find((label) => label.name === item.label)?.atom;
    if (!mapping) continue;
    const named = `${item.path} unit ${item.id} (${item.label})`;
    if (!(PROSE_KINDS as readonly string[]).includes(mapping.kind)) {
      refusals.push(
        `${named}: the label ${item.label} maps to the atom kind ${mapping.kind}, which a pointer cannot build`,
      );
      continue;
    }
    const text = texts.get(item.path);
    if (text === undefined) continue;
    // A gate holds two units: the quote runs from the first to the end of the second, in file order.
    const spans = [item.unit, ...(item.target ? [item.target.unit] : [])];
    const start = Math.min(...spans.map((unit) => unit.start));
    const end = Math.max(...spans.map((unit) => unit.end));
    const at: Located = {
      file: item.path,
      startLine: lineAt(text, start),
      endLine: lineAt(text, end),
      quote: text.slice(start, end),
    };
    if (!quoteAtSpan(text, at)) {
      refusals.push(`${named}: the unit is not at lines ${at.startLine} to ${at.endLine} of the file`);
      continue;
    }
    const folded = foldQuote(at.quote);
    const same = builder.atoms.find(
      (other) =>
        other.kind === mapping.kind &&
        other.provenance.file === at.file &&
        other.provenance.startLine <= at.endLine &&
        at.startLine <= other.provenance.endLine &&
        (other.producedBy === 'code' || foldQuote(other.provenance.quote) === folded),
    );
    if (same) {
      duplicates.push(`${named} repeats ${same.id}`);
      continue;
    }
    accepted.push(
      builder.add({
        kind: mapping.kind as (typeof PROSE_KINDS)[number],
        title: titleOf(item.unit.text),
        at,
        evidence: [
          {
            type: 'custom',
            name: 'prose_pointer',
            options: { reviewRequired: true, unit: item.id, set: item.set.set, label: item.label },
          },
        ],
        producedBy: 'model',
        fields: {
          extraction: 'pointer',
          unit: item.id,
          labelSet: item.set.set,
          label: item.label,
          cassette: item.source,
          labeler,
          ...(mapping.polarity ? { polarity: mapping.polarity } : {}),
        },
      }),
    );
  }
  return { accepted, refusals, duplicates };
}

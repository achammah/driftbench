import type { CorpusItem } from './prose-corpus';

/**
 * A fourth hand-written corpus in the terse house style of long operating manuals: bold lead labels, rule
 * numbers, glyphs, semicolon chains, reasons after a dash and shorthand. The subject is a fictional parcel
 * depot; the sentences are fixed text.
 */
const list = (cls: string, positive: boolean, texts: string[]): CorpusItem[] =>
  texts.map((text) => ({ cls, text, positive }));

export function buildTerseCorpus(): CorpusItem[] {
  return [
    ...list('terse-rule', true, [
      '**R#4 — Weigh every parcel twice.** A single reading hides a stuck scale.',
      '**Dock discipline.** Close the gate before the truck leaves; never leave it open overnight.',
      'Default no stickers; add one only when the customer asks.',
      'Scan on arrival, not at the end of the shift.',
      'Quote the tracking number in every reply, never a pasted label.',
      'Facts first: look the parcel up in the ledger before you ask the customer.',
      'Refund over 50 euros → ask a manager; under it, just do it.',
      'A reply that offers a choice ends in a question, never a statement.',
      '**Hard rule:** never promise a delivery date you cannot read in the ledger.',
      'Lead with the answer; put the reason after it.',
      'Disagree once, then commit.',
      'Keep the photo, drop the blurry ones.',
      'R#7. Do not re-open a closed ticket; file a new one and link it.',
      'Prefer the depot ledger to memory.',
      'Ask which depot when the customer gives only a city.',
      '‼ Never edit the ledger by hand.',
      '**Escalate** when the same parcel fails twice.',
      'Route returns to dock B — never dock A.',
      'Treat a missing label as lost until the scan says otherwise.',
      'Confirm the address w/ the customer before dispatch.',
      'If the scale and the label disagree, trust the scale.',
      'Only the shift lead may close a damage claim.',
      'The summary must name the carrier, the dock and the time.',
      'Stop and report when two scans of one parcel disagree.',
    ]),
    ...list('terse-description', false, [
      'Facts are mine to resolve; decisions are yours.',
      'The ledger carries state, not narration.',
      'Rows are claimed by one lane at a time.',
      'Each lane owns its own files.',
      'A parcel that fails twice is reported to the owner.',
      'The depot has three docks: A, B and C.',
      '**Dock B.** Handles returns and damaged parcels.',
      'Scanning takes about two seconds per parcel.',
      'The shift lead owns damage claims.',
      'Parcels over 30 kg go on the lift.',
      'The ledger is the system of record for parcel state.',
      'Photos are stored next to the ticket.',
      'Reports go out on Mondays.',
      'Most claims close within a day.',
      'A card is the whole message; the reader sees only the question.',
      'Result: both docks restarted.',
      'The old rule was to weigh once.',
    ]),
  ];
}

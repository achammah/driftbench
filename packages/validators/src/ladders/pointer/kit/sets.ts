import type { Labeler, LabelRequest } from '../sut/port';
import { norm, squash } from './norm';

/** The label set of design section 1, with a gate that names a target. */
export const RULES_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that sets an order, one act before another.
        target: required
        atom: { kind: gate }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;

/** The second set of the design, with examples. */
export const VOICE_YAML = `  - set: house-voice
    description: How a style guide for a bakery's customer emails is written.
    labels:
      - name: voice-rule
        description: A unit that fixes a tone or a word choice for customer emails.
        examples:
          - "Write as if you were speaking over the counter."
          - "Say 'loaf', never 'unit'."
      - name: claim-needs-source
        description: A unit that states a fact about an ingredient, a price or an allergen.
      - name: legal-line
        description: A unit that must appear word for word in a message.
        examples:
          - "Allergen details are on the label."
`;

/** Two sets in one file. */
export const TWO_SETS_YAML = `${RULES_YAML}${VOICE_YAML}`;

/** A set of plain labels (no atom, no target). */
export function plainSet(name: string, labels: readonly string[], extra = ''): string {
  const body = labels
    .map((l) => `      - name: ${l}\n        description: A unit that has the property ${l}.\n${extra}`)
    .join('');
  return `labels:\n  - set: ${name}\n    description: A set of plain labels.\n    labels:\n${body}`;
}

export type Pick = { text: string; label: string; to?: string; target?: string };

/** A shown unit text without a list or heading marker, in the normal form: a reader may include the marker in the unit. */
export const keyOf = (text: string) => squash(norm(text)).replace(/^(?:[-*+]|\d{1,9}[.)]|#{1,6})\s+/, '');

/** n of the unit whose shown text is `text` (a window shows one line per unit). */
export function numberOf(request: LabelRequest, text: string): number | undefined {
  const want = keyOf(text);
  return request.window.units.find((u) => keyOf(u.text) === want)?.n;
}

/** A labeller that names units by their text: named units get their label, every other selectable unit `rest`. */
export function labelByText(picks: readonly Pick[], rest: string | undefined = 'none'): Labeler {
  return (request) => {
    const named = new Set<number>();
    const labels: Array<{ units: string; label: string; target?: number }> = [];
    for (const pick of picks) {
      const from = numberOf(request, pick.text);
      if (from === undefined) continue;
      const to = pick.to === undefined ? from : numberOf(request, pick.to);
      if (to === undefined) continue;
      const entry: { units: string; label: string; target?: number } = {
        units: from === to ? String(from) : `${from}-${to}`,
        label: pick.label,
      };
      if (pick.target !== undefined) {
        const t = numberOf(request, pick.target);
        if (t !== undefined) entry.target = t;
      }
      for (let n = from; n <= to; n += 1) named.add(n);
      labels.push(entry);
    }
    if (rest !== undefined) {
      for (const u of request.window.units) {
        if (u.mode === 'label' && !named.has(u.n)) labels.push({ units: String(u.n), label: rest });
      }
    }
    return { labels };
  };
}

/** A set of plain labels `rule`, `prohibition`, `example` (no atom, no target) named `probe`. */
export const PROBE_YAML = `labels:
  - set: probe
    description: A set of plain labels for probing a labeller.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
`;

/** Five plain labels, for question counts. */
export const FIVE_YAML = `labels:
  - set: five
    description: Five plain labels.
    labels:
      - name: one
        description: The first label of five.
      - name: two
        description: The second label of five.
      - name: three
        description: The third label of five.
      - name: four
        description: The fourth label of five.
      - name: five
        description: The fifth label of five.
`;

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { sha } from './cut';

/**
 * Label sets are user configuration: a named list of labels the user declares and describes. The core knows
 * sets, labels, windows and answers; it holds no word of any domain. A set that ships with the estate
 * scanner is data loaded the same way as a user's own set.
 */

const LABEL_NAME = /^[a-z][a-z0-9-]*$/;

export const Label = z.strictObject({
  name: z
    .string()
    .regex(LABEL_NAME, {
      error: 'a label name is lower case letters, digits and hyphens, starting with a letter',
    })
    .refine((name) => name !== 'none', { error: 'none is reserved: every set allows it' }),
  description: z.string().min(1),
  examples: z.array(z.string().min(1)).max(3).optional(),
  target: z.literal('required').optional(),
  atom: z
    .strictObject({ kind: z.string().min(1), polarity: z.enum(['obligation', 'prohibition']).optional() })
    .optional(),
});
export type Label = z.infer<typeof Label>;

export const LabelSet = z.strictObject({
  set: z.string().regex(LABEL_NAME, { error: 'a set name is lower case letters, digits and hyphens' }),
  description: z.string().min(1),
  labels: z.array(Label).min(1),
});
export type LabelSet = z.infer<typeof LabelSet>;

const LabelFile = z.strictObject({ labels: z.array(LabelSet).min(1) });

/** Sorted-key JSON: the same value always gives the same bytes. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

export type LabelSetsResult = { ok: true; sets: LabelSet[] } | { ok: false; message: string };

/** Reads the `labels:` list of a YAML text, and refuses a duplicate set or label name. */
export function parseLabelSets(text: string): LabelSetsResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const parsed = LabelFile.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.map(String).join('.') ?? '';
    return { ok: false, message: `${path ? `${path}: ` : ''}${first?.message ?? 'unknown problem'}` };
  }
  const seen = new Set<string>();
  for (const set of parsed.data.labels) {
    if (seen.has(set.set)) return { ok: false, message: `the set ${set.set} is declared twice` };
    seen.add(set.set);
    const names = new Set<string>();
    for (const label of set.labels) {
      if (names.has(label.name))
        return { ok: false, message: `the set ${set.set} declares ${label.name} twice` };
      names.add(label.name);
    }
  }
  return { ok: true, sets: parsed.data.labels };
}

/** The hash of a set's canonical form: editing one label changes only that set's hash. */
export const setHash = (set: LabelSet): string => sha(canonical(set)).slice(0, 16);

/** One unit as the labeler sees it: a number valid in this window only. */
export type WindowUnit = { n: number; text: string; index: number };

/** A run of units, cut at headings, that one request labels. `index` is the unit's place in its file. */
export type Window = { id: string; path: string; headingPath: string[]; units: WindowUnit[] };

/** What a labeler says about a window: a label per unit or range, and a target for a label that needs one. */
export type Labelled = { units: string; label: string; target?: number };

/** `5` or `5-7` as the numbers it names. */
export function expandUnits(units: string): number[] | undefined {
  const match = /^(\d+)(?:-(\d+))?$/.exec(units.trim());
  if (!match) return undefined;
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  if (to < from || to - from > 10_000) return undefined;
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

export type Checked = {
  /** Unit number to its label, for a label other than none. */
  accepted: Map<number, { label: string; target?: number }>;
  /** Unit numbers the answer named (none included). */
  covered: Set<number>;
  refusals: string[];
};

/**
 * Checks an answer against its window and set. Refused, with the reason: a label not in the set, a unit not in
 * the window, a unit named twice, a target on a label that takes none (or missing on one that needs it).
 */
export function checkAnswer(set: LabelSet, window: Window, answer: readonly Labelled[]): Checked {
  const allowed = new Map(set.labels.map((label) => [label.name, label]));
  const inWindow = new Set(window.units.map((unit) => unit.n));
  const accepted: Checked['accepted'] = new Map();
  const covered = new Set<number>();
  const refusals: string[] = [];
  for (const entry of answer) {
    const label = allowed.get(entry.label);
    if (entry.label !== 'none' && !label) {
      refusals.push(`${window.id}: the label ${entry.label} is not in the set ${set.set}`);
      continue;
    }
    const numbers = expandUnits(entry.units);
    if (!numbers) {
      refusals.push(`${window.id}: "${entry.units}" is no unit number or range`);
      continue;
    }
    if (numbers.some((n) => !inWindow.has(n))) {
      refusals.push(`${window.id}: "${entry.units}" leaves the window`);
      continue;
    }
    if (numbers.some((n) => covered.has(n))) {
      refusals.push(`${window.id}: "${entry.units}" names a unit that is already labelled`);
      continue;
    }
    if (label?.target === 'required' && (entry.target === undefined || !inWindow.has(entry.target))) {
      refusals.push(`${window.id}: the label ${entry.label} needs a target unit inside the window`);
      continue;
    }
    if (label && label.target !== 'required' && entry.target !== undefined) {
      refusals.push(`${window.id}: the label ${entry.label} takes no target`);
      continue;
    }
    for (const n of numbers) {
      covered.add(n);
      if (entry.label !== 'none') {
        accepted.set(n, {
          label: entry.label,
          ...(entry.target !== undefined ? { target: entry.target } : {}),
        });
      }
    }
  }
  return { accepted, covered, refusals };
}

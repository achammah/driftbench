import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { LabelSetDef, ModelArm, ScanResult, SourceFile } from '../sut/port';
import { PROBE_YAML } from './sets';

/** Independent fixture authoring. No cutter, reader, recording or reference implementation is called here.
 * The public wire schema is pinned to 5ad1e263a, packages/estate/src/pointer/{labeler,cassette}.ts.
 * Answers and unit boundaries are supplied by the fixture author before any implementation runs.
 */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export type Wire = { labeler: string; body: Record<string, unknown> };
export type CassetteRow = {
  key: string;
  answer: {
    labels?: Array<{ units: string; label: string }>;
    probabilities?: Record<string, number>;
    returnedModel: string;
    stopReason: string;
    usage: { input: number; output: number };
  };
  readable: Record<string, string>;
};
export type AuthoredUnit = {
  text: string;
  label: string;
  container?: string;
  path?: string[];
  probabilities?: Record<string, number>;
};
export type AuthoredFile = { path: string; units: AuthoredUnit[]; text?: string };
export type ExpectedLabel = {
  path: string;
  quote: string;
  set: string;
  label: string;
  probabilities?: Record<string, number>;
};
export type Fixture = {
  files: SourceFile[];
  labelsYaml: string;
  expected: ExpectedLabel[];
  cassette: string;
  rows: CassetteRow[];
  wires: Wire[];
  documents: AuthoredFile[];
};
export const DENSE_SYSTEM =
  'You label numbered units of a document. For each unit give exactly one label from the list, or none. ' +
  'Answer with JSON only, no other text: {"labels": [{"units": "<n> or <a>-<b>", "label": "<name>"}]}. ' +
  'Every unit must appear once. A range joins neighbouring units that share a label. ' +
  'For a label that asks for a target, add "target": the number of the unit that holds the other end. ' +
  'Never copy text from the units.';
const examples = (label: LabelSetDef['labels'][number]) =>
  label.examples?.length ? ` Examples: ${label.examples.map((e) => JSON.stringify(e)).join('; ')}` : '';
export function wireFor(
  arm: ModelArm,
  set: LabelSetDef,
  window: string,
  units: Array<{ n: number; text: string }>,
  path: string[] = [],
): Wire {
  const shown = units.map((u) => `[${u.n}] ${u.text.replace(/\s+/g, ' ').trim()}`);
  if (arm === 'haiku')
    return {
      labeler: arm,
      body: {
        model: 'claude-haiku-5-5',
        max_tokens: 4096,
        thinking: { type: 'disabled' },
        system: DENSE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              `SET ${set.set}: ${set.description}`,
              'LABELS:',
              ...set.labels.map(
                (l) =>
                  `- ${l.name}: ${l.description}${examples(l)}${l.target ? ' (also give "target": the number of the unit that holds the other end)' : ''}`,
              ),
              '- none: no label of this set applies.',
              `WINDOW ${window}  path: ${path.join(' > ') || '(top)'}`,
              ...shown,
            ].join('\n'),
          },
        ],
      },
    };
  return {
    labeler: arm,
    body: {
      model: 'jev-latest',
      state: { set: set.set, window, text: [`path: ${path.join(' > ') || '(top)'}`, ...shown].join('\n') },
      questions: Object.fromEntries(
        units.flatMap((u) =>
          set.labels.map((l) => [
            `u${u.n}__${l.name}`,
            {
              type: 'noul',
              instructions: {
                question: `Label ${l.name}: ${l.description}${examples(l)} Does this label apply to unit [${u.n}] of the numbered text? Answer yes or no.`,
              },
            },
          ]),
        ),
      ),
    },
  };
}
export function readableFor(wire: Wire, meta: Record<string, string>): Record<string, string> {
  return {
    ...meta,
    labeler: wire.labeler,
    ...Object.fromEntries(
      Object.entries(wire.body).map(([k, v]) => [`part.${k}`, hash(canonical(v)).slice(0, 12)]),
    ),
  };
}
export function makeFixture(arm: ModelArm, documents: AuthoredFile[], labelsYaml = PROBE_YAML): Fixture {
  const sets = (parse(labelsYaml) as { labels: LabelSetDef[] }).labels;
  const files = documents.map((d) => ({
    path: d.path,
    text: d.text ?? `${d.units.map((u) => u.text).join('\n\n')}\n`,
  }));
  for (const [index, doc] of documents.entries()) {
    let cursor = 0;
    for (const unit of doc.units) {
      const found = files[index]?.text.indexOf(unit.text, cursor) ?? -1;
      if (found < 0 || !unit.text) throw new Error('authored unit is not an ordered source span');
      cursor = found + unit.text.length;
      for (const set of sets)
        if (unit.label !== 'none' && !set.labels.some((label) => label.name === unit.label))
          throw new Error(`authored label ${unit.label} is absent from ${set.set}`);
    }
  }
  const rows: CassetteRow[] = [],
    wires: Wire[] = [],
    expected: ExpectedLabel[] = [];
  for (const set of sets)
    for (const doc of documents) {
      const digest = hash(
        doc.units
          .map(
            (u) =>
              `${u.container ?? 'sentence'}:${hash(u.text.normalize('NFC').replace(/\s+/g, ' ').trim()).slice(0, 16)}`,
          )
          .join('\n'),
      );
      const cap =
        arm === 'jev-unit' ? 1 : Math.min(60, arm === 'jev' ? Math.floor(250 / set.labels.length) : 60);
      for (let offset = 0; offset < doc.units.length; offset += cap) {
        const selected = doc.units.slice(offset, offset + cap),
          window = `${doc.path}#${Math.floor(offset / cap) + 1}`;
        const wire = wireFor(
          arm,
          set,
          window,
          selected.map((u, i) => ({ n: i + 1, text: u.text })),
          selected[0]?.path ?? [],
        );
        wires.push(wire);
        const probabilities = Object.fromEntries(
          selected.flatMap((u, i) =>
            set.labels.map((l) => [
              `u${i + 1}__${l.name}`,
              u.probabilities?.[l.name] ?? (l.name === u.label ? 0.95 : 0.05),
            ]),
          ),
        );
        rows.push({
          key: hash(canonical(wire)),
          readable: readableFor(wire, {
            path: doc.path,
            window,
            promptVersion: 'p1',
            schemaVersion: 's1',
            set: set.set,
            setHash: hash(canonical(set)).slice(0, 16),
            model: String(wire.body.model),
            cutDigest: digest,
          }),
          answer: {
            ...(arm === 'haiku'
              ? { labels: selected.map((u, i) => ({ units: String(i + 1), label: u.label })) }
              : { probabilities }),
            returnedModel: String(wire.body.model),
            stopReason: 'end_turn',
            usage: { input: 10, output: 10 },
          },
        });
      }
      for (const u of doc.units)
        expected.push({
          path: doc.path,
          quote: u.text,
          set: set.set,
          label: u.label,
          ...(u.probabilities ? { probabilities: u.probabilities } : {}),
        });
    }
  return {
    files,
    labelsYaml,
    expected,
    rows,
    wires,
    documents,
    cassette: rows.map(canonical).concat('').join('\n'),
  };
}
export function loadFixture(arm: ModelArm): Fixture {
  const fixture = JSON.parse(
    readFileSync(new URL(`../../../../fixtures/pointer/replay/${arm}.json`, import.meta.url), 'utf8'),
  ) as Fixture;
  const cassette = readFileSync(
    new URL(`../../../../fixtures/pointer/replay/${arm}.jsonl`, import.meta.url),
    'utf8',
  );
  if (cassette !== fixture.cassette)
    throw new Error('committed cassette differs from its reviewed fixture sidecar');
  return fixture;
}
/** Every expected source unit must occur exactly once with its authored label; zero, partial and all-one-label outputs fail. */
export function requireFixtureLabels(result: ScanResult, fixture: Fixture, threshold?: number): void {
  if (!result.ok || !result.ledger)
    throw new Error(`positive witness: fixture replay failed: ${result.error ?? 'no ledger'}`);
  const live = result.ledger.entries.filter((e) => e.status === 'live');
  if (live.length !== fixture.documents.reduce((n, d) => n + d.units.length, 0))
    throw new Error('positive witness: fixture replay dropped or invented a unit');
  const groups = new Map<string, typeof live>();
  for (const entry of live) {
    for (const set of Object.keys(entry.labels)) {
      const key = JSON.stringify([entry.path, entry.quote, set]);
      const found = groups.get(key) ?? [];
      found.push(entry);
      groups.set(key, found);
    }
  }
  for (const expected of fixture.expected) {
    const match = groups.get(JSON.stringify([expected.path, expected.quote, expected.set]))?.shift();
    let want = expected.label;
    if (threshold !== undefined && expected.probabilities) {
      const [best] = Object.entries(expected.probabilities).sort((a, b) => b[1] - a[1]);
      want = best && best[1] >= threshold ? best[0] : 'none';
    }
    if (match?.labels[expected.set]?.label !== want)
      throw new Error(
        `positive witness: fixture label ${expected.path} ${JSON.stringify(expected.quote)} must be ${want}`,
      );
  }
}
/** Change exactly one stored input field. The key is left alone: this probes that readable metadata is validated on a hit. */
export function perturb(
  fixture: Fixture,
  _arm: ModelArm,
  index: number,
  field: string,
  value: string,
): { cassette: string; window: string } {
  const rows = structuredClone(fixture.rows),
    candidates = rows.filter((r) => field in r.readable);
  const row = candidates[index % candidates.length];
  if (!row) throw new Error(`no fixture entry carries ${field}`);
  row.readable[field] = value;
  return { cassette: rows.map(canonical).concat('').join('\n'), window: row.readable.window ?? '' };
}

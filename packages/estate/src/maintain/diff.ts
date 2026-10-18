import { canonicalJson } from '@agent-nexus/driftbench-core';
import { shortQuote } from '@agent-nexus/driftbench-generate';
import { z } from 'zod';
import { type Atom, AtomKind, Edge, type EstateMap } from '../schema';

/**
 * The estate diff: what changed between two versions of an estate map, read atom by atom.
 *
 * Atoms are matched by id. An atom whose provenance hash differs is one of three things:
 * - moved: the same quote at another span (a line was added or removed above it); its tests stay true;
 * - whitespace: the quote differs only in white space once both are normalised (runs of white space become
 *   one space, the ends are trimmed); its tests are regenerated, no person is needed;
 * - semantic: the normalised quote differs; its tests are regenerated and its phrasings go back for approval.
 * An atom with the same hash whose other fields differ (evidence, enforcement, situation, title, role, kind
 * fields) is restated: its tests are regenerated. Approval alone is not a change. Edges are compared as
 * `from kind to` triples.
 *
 * An id names the file an atom was read in, so a fact several files state once (a tool two helpers declare)
 * changes its id when the file it was anchored in leaves. An atom that leaves under one id while an atom of
 * the same kind, title, words and fields arrives under another is the same atom, renamed: its tests are
 * regenerated against the new id, and neither atom counts as removed or added.
 */

export const AtomPlace = z.strictObject({
  file: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});
export type AtomPlace = z.infer<typeof AtomPlace>;

const AtomQuote = AtomPlace.extend({ quote: z.string(), hash: z.string().min(1) });

export const DiffAtom = z.strictObject({
  id: z.string().min(1),
  kind: AtomKind,
  title: z.string().min(1),
  producedBy: z.enum(['code', 'model']),
  approved: z.boolean(),
  at: AtomQuote,
});
export type DiffAtom = z.infer<typeof DiffAtom>;

export const ChangeClass = z.enum(['whitespace', 'semantic']);
export type ChangeClass = z.infer<typeof ChangeClass>;

export const AtomChange = z.strictObject({
  id: z.string().min(1),
  kind: AtomKind,
  title: z.string().min(1),
  change: ChangeClass,
  before: AtomQuote,
  after: AtomQuote,
  fields: z.array(z.string()).describe('Other fields that changed with the quote'),
});
export type AtomChange = z.infer<typeof AtomChange>;

export const AtomMove = z.strictObject({
  id: z.string().min(1),
  kind: AtomKind,
  title: z.string().min(1),
  from: AtomPlace,
  to: AtomPlace,
});
export type AtomMove = z.infer<typeof AtomMove>;

export const AtomRename = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: AtomKind,
  title: z.string().min(1),
  was: AtomPlace,
  now: AtomPlace,
});
export type AtomRename = z.infer<typeof AtomRename>;

export const AtomRestated = z.strictObject({
  id: z.string().min(1),
  kind: AtomKind,
  title: z.string().min(1),
  fields: z.array(z.string()).min(1),
});
export type AtomRestated = z.infer<typeof AtomRestated>;

export const MapStamp = z.strictObject({
  path: z.string().optional(),
  runtime: z.string().min(1),
  readAt: z.string().min(1),
  hash: z.string().min(1),
  atoms: z.number().int().min(0),
  edges: z.number().int().min(0),
});
export type MapStamp = z.infer<typeof MapStamp>;

export const GuardMode = z.enum(['observe', 'warn', 'enforce']);
export type GuardMode = z.infer<typeof GuardMode>;

export const GuardEvidence = z.strictObject({
  log: z.string().min(1).describe('The decision log the evidence was read from'),
  decisions: z.number().int().min(0).describe('Decisions the guard logged in that mode'),
  wrong: z.number().int().min(0).describe('Decisions a person marked wrong'),
  note: z.string().optional(),
});
export type GuardEvidence = z.infer<typeof GuardEvidence>;

export const GuardTransition = z.strictObject({
  guard: z.string().min(1),
  from: GuardMode.nullable().describe('null when the guard has no state in the old version'),
  to: GuardMode.nullable().describe('null when the guard has no state in the new version'),
  move: z.enum(['promoted', 'demoted', 'added', 'removed', 'unchanged']),
  evidence: GuardEvidence.optional(),
});
export type GuardTransition = z.infer<typeof GuardTransition>;

export const EstateDiff = z.strictObject({
  version: z.literal(1),
  old: MapStamp,
  new: MapStamp,
  atoms: z.strictObject({
    added: z.array(DiffAtom),
    removed: z.array(DiffAtom),
    changed: z.array(AtomChange),
    moved: z.array(AtomMove),
    restated: z.array(AtomRestated),
    renamed: z
      .array(AtomRename)
      .optional()
      .describe('Atoms that left under one id and arrived under another'),
  }),
  edges: z.strictObject({ added: z.array(Edge), removed: z.array(Edge) }),
  guards: z
    .array(GuardTransition)
    .optional()
    .describe('Enforcement state per guard atom; present when both versions have a state file'),
  summary: z.strictObject({
    added: z.number().int().min(0),
    removed: z.number().int().min(0),
    whitespace: z.number().int().min(0),
    semantic: z.number().int().min(0),
    moved: z.number().int().min(0),
    restated: z.number().int().min(0),
    unchanged: z.number().int().min(0),
    edgesAdded: z.number().int().min(0),
    edgesRemoved: z.number().int().min(0),
    renamed: z.number().int().min(0).optional(),
  }),
});
export type EstateDiff = z.infer<typeof EstateDiff>;

/** The fields compared for a restated atom, beside the provenance. Approval is not among them. */
const COMPARED = ['kind', 'title', 'role', 'situation', 'evidence', 'enforcement', 'fields'] as const;

/** Runs of white space become one space and the ends are trimmed: two quotes equal here differ in white space only. */
export function normaliseQuote(quote: string): string {
  return quote.replace(/\s+/g, ' ').trim();
}

/** How an atom's quote changed: `same` when the quotes are equal. */
export function classifyQuote(before: string, after: string): ChangeClass | 'same' {
  if (before === after) return 'same';
  return normaliseQuote(before) === normaliseQuote(after) ? 'whitespace' : 'semantic';
}

export type DiffOptions = {
  oldPath?: string;
  newPath?: string;
  guards?: GuardTransition[];
};

export function diffEstateMaps(before: EstateMap, after: EstateMap, options: DiffOptions = {}): EstateDiff {
  const old = new Map(before.atoms.map((atom) => [atom.id, atom]));
  const next = new Map(after.atoms.map((atom) => [atom.id, atom]));

  const renamed = renamedAtoms(
    before.atoms.filter((atom) => !next.has(atom.id)),
    after.atoms.filter((atom) => !old.has(atom.id)),
  );
  const gone = new Set(renamed.map((entry) => entry.from));
  const arrived = new Set(renamed.map((entry) => entry.to));
  const added = after.atoms.filter((atom) => !old.has(atom.id) && !arrived.has(atom.id)).map(diffAtom);
  const removed = before.atoms.filter((atom) => !next.has(atom.id) && !gone.has(atom.id)).map(diffAtom);
  const changed: AtomChange[] = [];
  const moved: AtomMove[] = [];
  const restated: AtomRestated[] = [];
  let unchanged = 0;

  for (const atom of after.atoms) {
    const prior = old.get(atom.id);
    if (!prior) continue;
    const fields = changedFields(prior, atom);
    if (prior.provenance.hash === atom.provenance.hash) {
      if (fields.length > 0) restated.push({ id: atom.id, kind: atom.kind, title: atom.title, fields });
      else unchanged++;
      continue;
    }
    const change = classifyQuote(prior.provenance.quote, atom.provenance.quote);
    if (change === 'same') {
      moved.push({
        id: atom.id,
        kind: atom.kind,
        title: atom.title,
        from: place(prior),
        to: place(atom),
      });
      if (fields.length > 0) restated.push({ id: atom.id, kind: atom.kind, title: atom.title, fields });
      continue;
    }
    changed.push({
      id: atom.id,
      kind: atom.kind,
      title: atom.title,
      change,
      before: quoted(prior),
      after: quoted(atom),
      fields,
    });
  }

  const oldEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge]));
  const newEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));
  const edgesAdded = [...newEdges].filter(([key]) => !oldEdges.has(key)).map(([, edge]) => edge);
  const edgesRemoved = [...oldEdges].filter(([key]) => !newEdges.has(key)).map(([, edge]) => edge);
  edgesAdded.sort(byEdge);
  edgesRemoved.sort(byEdge);

  return {
    version: 1,
    old: stamp(before, options.oldPath),
    new: stamp(after, options.newPath),
    atoms: { added, removed, changed, moved, restated, ...(renamed.length > 0 ? { renamed } : {}) },
    edges: { added: edgesAdded, removed: edgesRemoved },
    ...(options.guards === undefined ? {} : { guards: options.guards }),
    summary: {
      added: added.length,
      removed: removed.length,
      whitespace: changed.filter((entry) => entry.change === 'whitespace').length,
      semantic: changed.filter((entry) => entry.change === 'semantic').length,
      moved: moved.length,
      restated: restated.length,
      unchanged,
      edgesAdded: edgesAdded.length,
      edgesRemoved: edgesRemoved.length,
      ...(renamed.length > 0 ? { renamed: renamed.length } : {}),
    },
  };
}

/** What makes two atoms the same fact: everything but the id, the place and the guards that enforce it. */
function identity(atom: Atom): string {
  return canonicalJson([
    atom.kind,
    atom.title,
    normaliseQuote(atom.provenance.quote),
    atom.role ?? null,
    atom.situation ?? null,
    atom.evidence,
    atom.fields ?? null,
  ]);
}

/** Pairs the atoms that left with the atoms that arrived when both are the same fact, in id order. */
function renamedAtoms(left: readonly Atom[], arrived: readonly Atom[]): AtomRename[] {
  const waiting = new Map<string, Atom[]>();
  for (const atom of [...arrived].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const key = identity(atom);
    waiting.set(key, [...(waiting.get(key) ?? []), atom]);
  }
  const renamed: AtomRename[] = [];
  for (const atom of [...left].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const twin = waiting.get(identity(atom))?.shift();
    if (twin) {
      renamed.push({
        from: atom.id,
        to: twin.id,
        kind: atom.kind,
        title: atom.title,
        was: place(atom),
        now: place(twin),
      });
    }
  }
  return renamed;
}

export type ParsedDiff = { ok: true; diff: EstateDiff } | { ok: false; message: string };

/** Reads a diff written by `estate diff --json` or `--out`. */
export function parseEstateDiff(text: string): ParsedDiff {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return { ok: false, message: `not JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const parsed = EstateDiff.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      message: `not an estate diff: ${first ? `${first.path.join('.') || '(top)'}: ${first.message}` : 'invalid'}`,
    };
  }
  return { ok: true, diff: parsed.data };
}

/** The diff as lines a person reads. */
export function renderEstateDiff(diff: EstateDiff): string {
  const s = diff.summary;
  const lines: string[] = [];
  const name = (side: MapStamp) => side.path ?? 'map';
  lines.push(
    `Estate diff: ${name(diff.old)} (${diff.old.hash.slice(0, 12)}) to ${name(diff.new)} (${diff.new.hash.slice(0, 12)}).`,
  );
  lines.push(
    `  Atoms: ${s.added} added, ${s.removed} removed, ${s.whitespace + s.semantic} changed (${s.whitespace} white space only, ${s.semantic} semantic), ${s.moved} moved with the same quote, ${s.restated} restated${s.renamed ? `, ${s.renamed} renamed` : ''}, ${s.unchanged} unchanged.`,
  );
  lines.push(`  Edges: ${s.edgesAdded} added, ${s.edgesRemoved} removed.`);
  if (diff.guards !== undefined) {
    const moves = diff.guards.filter((entry) => entry.move !== 'unchanged');
    lines.push(
      `  Guards: ${moves.length} of ${diff.guards.length} changed enforcement state${moves.length === 0 ? '.' : ':'}`,
    );
    for (const entry of moves) lines.push(`    ${guardLine(entry)}`);
  }
  if (diff.atoms.added.length > 0) {
    lines.push('Added:');
    for (const atom of diff.atoms.added) lines.push(`  + ${atom.id} (${atom.kind}) ${where(atom.at)}`);
  }
  if (diff.atoms.removed.length > 0) {
    lines.push('Removed:');
    for (const atom of diff.atoms.removed) lines.push(`  - ${atom.id} (${atom.kind}) ${where(atom.at)}`);
  }
  for (const change of ChangeClass.options) {
    const entries = diff.atoms.changed.filter((entry) => entry.change === change);
    if (entries.length === 0) continue;
    lines.push(change === 'semantic' ? 'Changed, semantic:' : 'Changed, white space only:');
    for (const entry of entries) {
      lines.push(`  ~ ${entry.id} (${entry.kind}) ${where(entry.after)}`);
      if (change === 'semantic') {
        lines.push(`      was: ${shortQuote(entry.before.quote, 100)}`);
        lines.push(`      now: ${shortQuote(entry.after.quote, 100)}`);
      }
      if (entry.fields.length > 0) lines.push(`      also: ${entry.fields.join(', ')}`);
    }
  }
  if (diff.atoms.moved.length > 0) {
    lines.push('Moved, same quote:');
    for (const entry of diff.atoms.moved) {
      const to = entry.from.file === entry.to.file ? `${entry.to.startLine}` : where(entry.to);
      lines.push(`  > ${entry.id} ${where(entry.from)} to ${to}`);
    }
  }
  if ((diff.atoms.renamed ?? []).length > 0) {
    lines.push('Renamed, the same atom under another id:');
    for (const entry of diff.atoms.renamed ?? [])
      lines.push(
        `  = ${entry.from} to ${entry.to} (${entry.kind}) ${where(entry.was)} to ${where(entry.now)}`,
      );
  }
  if (diff.atoms.restated.length > 0) {
    lines.push('Restated, same quote:');
    for (const entry of diff.atoms.restated) lines.push(`  * ${entry.id}: ${entry.fields.join(', ')}`);
  }
  if (diff.edges.added.length > 0) {
    lines.push('Edges added:');
    for (const edge of diff.edges.added) lines.push(`  + ${edgeKey(edge)}`);
  }
  if (diff.edges.removed.length > 0) {
    lines.push('Edges removed:');
    for (const edge of diff.edges.removed) lines.push(`  - ${edgeKey(edge)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function guardLine(entry: GuardTransition): string {
  const evidence = entry.evidence
    ? ` (evidence: ${entry.evidence.decisions} decisions, ${entry.evidence.wrong} wrong, ${entry.evidence.log})`
    : '';
  return `${entry.move} ${entry.guard}: ${entry.from ?? 'no state'} to ${entry.to ?? 'no state'}${evidence}`;
}

export function edgeKey(edge: Edge): string {
  return `${edge.from} ${edge.kind} ${edge.to}`;
}

function byEdge(a: Edge, b: Edge): number {
  const left = edgeKey(a);
  const right = edgeKey(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function changedFields(before: Atom, after: Atom): string[] {
  return COMPARED.filter((key) => canonicalJson(before[key] ?? null) !== canonicalJson(after[key] ?? null));
}

function place(atom: Atom): AtomPlace {
  const { file, startLine, endLine } = atom.provenance;
  return { file, startLine, endLine };
}

function quoted(atom: Atom): z.infer<typeof AtomQuote> {
  const { file, startLine, endLine, quote, hash } = atom.provenance;
  return { file, startLine, endLine, quote, hash };
}

function diffAtom(atom: Atom): DiffAtom {
  return {
    id: atom.id,
    kind: atom.kind,
    title: atom.title,
    producedBy: atom.producedBy,
    approved: atom.approved,
    at: quoted(atom),
  };
}

function where(at: AtomPlace): string {
  return at.startLine === at.endLine
    ? `${at.file}:${at.startLine}`
    : `${at.file}:${at.startLine}-${at.endLine}`;
}

function stamp(map: EstateMap, path: string | undefined): MapStamp {
  return {
    ...(path === undefined ? {} : { path }),
    runtime: map.runtime,
    readAt: map.readAt,
    hash: map.hash,
    atoms: map.atoms.length,
    edges: map.edges.length,
  };
}

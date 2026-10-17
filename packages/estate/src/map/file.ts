import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isPlainObject } from '@agent-nexus/driftbench-core';
import { Document, isMap, isSeq, parseDocument, parse as parseYaml } from 'yaml';
import { describe, fromZod } from '../file-issues';
import { EVENT_PREFIX } from '../graph/edges';
import { estatePath } from '../paths';
import { provenanceHash, quoteAtSpan, sha256 } from '../scan/text';
import { type Atom, AtomKind, EstateMap } from '../schema';
import { mapHash } from './build';

/**
 * The estate map file: YAML, one atom per entry, written so a person can read and approve it in place.
 * Loading checks the schema, unique atom ids, edges whose ends are atoms (or an event node), and the hash:
 * approval flags and roles may change by hand, quotes and spans may not.
 */

export const MapIssueCodes = [
  'MAP_PARSE',
  'MAP_NOT_OBJECT',
  'MAP_DUPLICATE_ATOM',
  'MAP_UNKNOWN_ATOM',
  'MAP_HASH',
  'MAP_QUOTE_DRIFT',
  'MAP_UNKNOWN_KIND',
] as const;
export type MapIssueCode = (typeof MapIssueCodes)[number] | `SCHEMA_${string}`;
export type MapIssue = { code: MapIssueCode; path: string; message: string };

export type MapResult = { ok: true; map: EstateMap } | { ok: false; errors: MapIssue[] };

export function renderEstateMap(map: EstateMap): string {
  const doc = new Document(map, { aliasDuplicateObjects: false });
  doc.commentBefore = [
    ` driftbench estate map (${map.runtime}): every place the estate says what the agent must do.`,
    ' Each atom quotes its file at a line span and hashes it. producedBy code: read by code from structure,',
    ' approved as read. producedBy model: split from prose by a model, the quote checked in the file; it',
    ' waits for a person. role axis puts the atom in the space map; detail keeps it for the generator.',
    ' Approve with  driftbench estate approve <this file> --kind <kind> | --atom <id> | --all',
    ' Edit approved and role only: a changed quote or span breaks the hash and the map is refused.',
  ].join('\n');
  const atoms = doc.get('atoms', true);
  if (isSeq(atoms)) {
    for (const atom of atoms.items) {
      if (!isMap(atom)) continue;
      const evidence = atom.get('evidence', true);
      if (isSeq(evidence)) for (const item of evidence.items) if (isMap(item)) item.flow = true;
      const enforcement = atom.get('enforcement', true);
      if (isSeq(enforcement)) enforcement.flow = true;
    }
  }
  const edges = doc.get('edges', true);
  if (isSeq(edges)) for (const edge of edges.items) if (isMap(edge)) edge.flow = true;
  return doc.toString({ lineWidth: 0 });
}

export function parseEstateMapText(text: string): MapResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return { ok: false, errors: [issue('MAP_PARSE', '', describe(cause))] };
  }
  return validateEstateMap(raw);
}

export function validateEstateMap(raw: unknown): MapResult {
  if (!isPlainObject(raw))
    return { ok: false, errors: [issue('MAP_NOT_OBJECT', '', 'a map file holds one mapping')] };
  const parsed = EstateMap.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(fromZod) };
  const map = parsed.data;
  const errors: MapIssue[] = [];
  const ids = new Set<string>();
  map.atoms.forEach((atom, index) => {
    if (provenanceHash(atom.provenance) !== atom.provenance.hash) {
      errors.push(
        issue(
          'MAP_HASH',
          `atoms.${index}.provenance`,
          `${atom.id}: the quote or the span changed since the scan; scan again rather than editing it`,
        ),
      );
    }
    if (ids.has(atom.id))
      errors.push(issue('MAP_DUPLICATE_ATOM', `atoms.${index}.id`, `atom "${atom.id}" is listed twice`));
    ids.add(atom.id);
  });
  map.edges.forEach((edge, index) => {
    for (const end of ['from', 'to'] as const) {
      const id = edge[end];
      if (!ids.has(id) && !(end === 'to' && edge.kind === 'event' && id.startsWith(EVENT_PREFIX))) {
        errors.push(issue('MAP_UNKNOWN_ATOM', `edges.${index}.${end}`, `"${id}" is not an atom of the map`));
      }
    }
  });
  if (errors.length === 0 && mapHash(map.atoms, map.edges) !== map.hash) {
    errors.push(
      issue(
        'MAP_HASH',
        'hash',
        'the atoms or edges changed since the scan: scan again rather than editing quotes',
      ),
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, map };
}

export type LoadedMap =
  | { ok: true; path: string; text: string; map: EstateMap }
  | { ok: false; path: string; errors: MapIssue[] };

export type LoadEstateMapOptions = {
  /**
   * A folder for a JSON copy of the parsed map, keyed by the SHA-256 of the map file's text. A map that
   * was loaded once is then read from JSON (milliseconds) instead of YAML (seconds for a large map). The
   * copy is checked like the YAML (schema, provenance hashes, map hash) on every read, and a text that
   * changed by one byte has another key, so a stale copy is never read.
   */
  cacheDir?: string;
};

export async function loadEstateMap(path: string, options: LoadEstateMapOptions = {}): Promise<LoadedMap> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return { ok: false, path, errors: [issue('MAP_PARSE', '', `cannot read the file: ${describe(cause)}`)] };
  }
  const cached = options.cacheDir === undefined ? undefined : join(options.cacheDir, `${sha256(text)}.json`);
  if (cached !== undefined) {
    const json = await estatePath(options.cacheDir as string, `${sha256(text)}.json`)
      .then((safe) => readFile(safe, 'utf8'))
      .catch(() => undefined);
    if (json !== undefined) {
      try {
        const parsed = validateEstateMap(JSON.parse(json));
        if (parsed.ok) return { ok: true, path, text, map: parsed.map };
      } catch {
        // An unreadable copy is parsed again from the YAML below, and replaced.
      }
    }
  }
  const parsed = parseEstateMapText(text);
  if (!parsed.ok) return { ok: false, path, errors: parsed.errors };
  if (cached !== undefined) {
    // Written aside and renamed, so a reader never sees half a copy. A cache that cannot be written is no error.
    const partial = `${cached}.${process.pid}.tmp`;
    await mkdir(dirname(cached), { recursive: true })
      .then(() => estatePath(options.cacheDir as string, `${sha256(text)}.json.${process.pid}.tmp`))
      .then((safe) => writeFile(safe, JSON.stringify(parsed.map), { flag: 'wx' }))
      .then(() => rename(partial, cached))
      .catch(() => undefined);
  }
  return { ok: true, path, text, map: parsed.map };
}

/** Atoms whose quote is no longer in their file at their span: the estate changed since the scan. */
export function quoteDrift(atoms: readonly Atom[], texts: ReadonlyMap<string, string>): MapIssue[] {
  const errors: MapIssue[] = [];
  atoms.forEach((atom, index) => {
    const text = texts.get(atom.provenance.file);
    if (text === undefined) {
      errors.push(issue('MAP_QUOTE_DRIFT', `atoms.${index}`, `${atom.id}: ${atom.provenance.file} is gone`));
    } else if (!quoteAtSpan(text, atom.provenance)) {
      errors.push(
        issue(
          'MAP_QUOTE_DRIFT',
          `atoms.${index}`,
          `${atom.id}: the quote is no longer at ${atom.provenance.file} lines ${atom.provenance.startLine} to ${atom.provenance.endLine}`,
        ),
      );
    }
  });
  return errors;
}

export type ApproveSelection = { kinds?: readonly string[]; ids?: readonly string[]; all?: boolean };
export type ApproveResult =
  | { ok: true; text: string; approved: string[]; already: number }
  | { ok: false; errors: MapIssue[] };

/**
 * Sets `approved: true` on the atoms of the named kinds, on the named atoms, or on all of them. Comments,
 * order and layout stay as they were; only the flags change. An unknown kind or id approves nothing.
 */
export function approveAtoms(text: string, selection: ApproveSelection): ApproveResult {
  const before = parseEstateMapText(text);
  if (!before.ok) return before;
  const kinds = selection.kinds ?? [];
  const ids = selection.ids ?? [];
  const known = new Set(before.map.atoms.map((atom) => atom.id));
  const errors: MapIssue[] = [
    ...kinds
      .filter((kind) => !AtomKind.safeParse(kind).success)
      .map((kind) =>
        issue('MAP_UNKNOWN_KIND', '', `"${kind}" is not an atom kind: ${AtomKind.options.join(', ')}`),
      ),
    ...ids
      .filter((id) => !known.has(id))
      .map((id) => issue('MAP_UNKNOWN_ATOM', '', `atom "${id}" is not in the map`)),
  ];
  if (errors.length > 0) return { ok: false, errors };

  const doc = parseDocument(text, { uniqueKeys: true });
  const approved: string[] = [];
  let already = 0;
  const atoms = doc.get('atoms', true);
  if (isSeq(atoms)) {
    for (const item of atoms.items) {
      if (!isMap(item)) continue;
      const id = item.get('id');
      const kind = item.get('kind');
      const chosen =
        selection.all === true ||
        (typeof kind === 'string' && kinds.includes(kind)) ||
        (typeof id === 'string' && ids.includes(id));
      if (!chosen) continue;
      if (item.get('approved') === true) already++;
      else {
        item.set('approved', true);
        approved.push(String(id));
      }
    }
  }
  const next = doc.toString({ lineWidth: 0 });
  const after = parseEstateMapText(next);
  if (!after.ok) return after;
  return { ok: true, text: next, approved, already };
}

function issue(code: MapIssueCode, path: string, message: string): MapIssue {
  return { code, path, message };
}

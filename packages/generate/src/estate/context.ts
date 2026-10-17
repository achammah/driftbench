import type { EstateAtom, EstateDocument } from './inputs';

type Link = { from: string; to: string; kind: string };

/**
 * Folder ownership is authoritative. Citation edges describe navigation, never file ownership:
 * a widely cited document must not inherit the first citing skill's task.
 */
export function estateOwners(atoms: readonly EstateAtom[], edges: readonly Link[] = []): Map<string, string> {
  const units = atoms.filter((atom) => atom.kind === 'skill' || atom.kind === 'subagent');
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const owners = new Map<string, string>();
  const ownerOfFile = (file: string | undefined): string | undefined => {
    if (!file) return undefined;
    const path = file.replaceAll('\\', '/').replace(/^\.\//, '');
    const exact = units.filter((unit) => unit.provenance?.file === path);
    if (exact.length === 1) return exact[0]?.id;
    const candidates = units
      .filter((unit) => {
        const source = unit.provenance?.file;
        if (unit.kind !== 'skill' || !source?.includes('/')) return false;
        return path.startsWith(source.slice(0, source.lastIndexOf('/') + 1));
      })
      .sort(
        (a, b) => (b.provenance?.file?.lastIndexOf('/') ?? 0) - (a.provenance?.file?.lastIndexOf('/') ?? 0),
      );
    const first = candidates[0],
      second = candidates[1];
    if (
      first &&
      (!second || first.provenance?.file?.lastIndexOf('/') !== second.provenance?.file?.lastIndexOf('/'))
    )
      return first.id;
    return undefined;
  };
  for (const atom of atoms) {
    if (atom.kind === 'skill' || atom.kind === 'subagent') continue;
    if (atom.kind === 'route') {
      const targets = new Set(
        edges
          .filter((edge) => edge.kind === 'route' && edge.from === atom.id)
          .map((edge) => edge.to)
          .filter((id) => units.some((unit) => unit.id === id)),
      );
      const named = units.filter((unit) => unit.fields?.name === atom.fields?.target);
      if (targets.size === 1) owners.set(atom.id, [...targets][0] as string);
      else if (named.length === 1 && named[0]) owners.set(atom.id, named[0].id);
      continue;
    }
    // A reference is owned by the unit whose folder holds its target file. A target outside every unit
    // folder (a shared document) is owned by the unit whose own file cites it: one reference atom exists
    // per citation, so this is the direct citation. Edges are navigation and never decide ownership.
    // Gate prerequisites and scripts have explicit target paths too.
    const target = ['reference', 'gate', 'script'].includes(atom.kind)
      ? typeof atom.fields?.path === 'string'
        ? atom.fields.path
        : typeof atom.fields?.first === 'string'
          ? atom.fields.first
          : undefined
      : undefined;
    const owner = (target ? ownerOfFile(target) : undefined) ?? ownerOfFile(atom.provenance?.file);
    if (owner) owners.set(atom.id, owner);
  }
  for (const guard of atoms.filter((atom) => atom.kind === 'guard')) {
    const candidates = new Set(
      guardRuleIds(guard, byId)
        .map((id) => owners.get(id))
        .filter((id): id is string => id !== undefined),
    );
    const [owner] = candidates;
    if (candidates.size === 1 && owner) owners.set(guard.id, owner);
  }
  return owners;
}

/** Repair stale row context as well as target-only rows. Never retain an unrelated attached unit. */
export function taskAtoms(
  atoms: readonly EstateAtom[],
  lookup: ReadonlyMap<string, EstateAtom>,
  owners: ReadonlyMap<string, string>,
): EstateAtom[] {
  const head = atoms[0];
  if (!head) return [];
  const owner = owners.get(head.id);
  const scoped = head.provenance?.file !== undefined && !['route', 'skill', 'subagent'].includes(head.kind);
  const result = scoped
    ? atoms.filter((atom) => !['skill', 'subagent'].includes(atom.kind) || atom.id === owner)
    : [...atoms];
  const unit = owner ? lookup.get(owner) : undefined;
  // The unit joins the row only when it holds the rule: it supplies the task of any rule it owns, but its load is
  // part of what the row tests only when the rule is written in its own files.
  if (unit && holdsRule(unit, head) && !result.some((atom) => atom.id === unit.id)) result.push(unit);
  return result;
}

/** Atom kinds whose rule may be written outside the unit that owns the file they gate. */
const PREREQUISITE_KINDS: ReadonlySet<string> = new Set(['gate', 'reference']);

/**
 * Whether a unit holds a rule: a gate or a reference is held by a skill whose folder holds the file it is written in
 * (or by the helper whose file it is); a rule of any other kind is held by its owner. A prerequisite written in the
 * standing instructions about a file in a skill's folder is owned by that skill for its task, and held by nobody.
 */
export function holdsRule(unit: EstateAtom, rule: EstateAtom): boolean {
  if (!PREREQUISITE_KINDS.has(rule.kind)) return true;
  const file = rule.provenance?.file;
  const home = unit.provenance?.file;
  if (file === undefined || home === undefined) return true;
  if (unit.kind === 'subagent') return file === home;
  const folder = home.slice(0, home.lastIndexOf('/') + 1);
  return file === home || (folder !== '' && file.startsWith(folder));
}

/** The owners of the rules a unit holds: the task owner of every atom, kept where the unit holds the atom. */
export function rowOwners(
  atoms: readonly EstateAtom[],
  edges: ReadonlyArray<Link> = [],
): Map<string, string> {
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const held = new Map<string, string>();
  for (const [atomId, unitId] of estateOwners(atoms, edges)) {
    const atom = byId.get(atomId);
    const unit = byId.get(unitId);
    if (atom && unit && holdsRule(unit, atom)) held.set(atomId, unitId);
  }
  return held;
}

/** Resolve optional documented hook sources to existing rules; a generic matcher is not a situation. */
export function guardRuleIds(guard: EstateAtom, atoms: ReadonlyMap<string, EstateAtom>): string[] {
  const links = Array.isArray(guard.fields?.enforces) ? guard.fields.enforces : [];
  const ids = links
    .map((link) => (typeof link === 'string' ? link : link?.atom))
    .filter((id): id is string => typeof id === 'string' && atoms.has(id));
  const sources = Array.isArray(guard.fields?.ruleSources) ? guard.fields.ruleSources : [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const atom of atoms.values()) {
      if (!['gate', 'instruction', 'register'].includes(atom.kind)) continue;
      const p = atom.provenance;
      if (!p || source.file !== p.file) continue;
      const sameQuote = typeof source.quote === 'string' && source.quote.trim() === p.quote.trim();
      const sameSpan =
        typeof source.startLine === 'number' &&
        typeof source.endLine === 'number' &&
        p.startLine !== undefined &&
        p.endLine !== undefined &&
        source.startLine <= p.startLine &&
        source.endLine >= p.endLine;
      if (sameQuote || sameSpan) ids.push(atom.id);
    }
  }
  return [...new Set(ids)];
}

/**
 * The files the map records as navigation only: an example, a template, a fixture, a history. A map without
 * document roles (an older map) records none, and nothing is guessed from a file name.
 */
export function navigationFiles(documents: readonly EstateDocument[] | undefined): ReadonlySet<string> {
  return new Set(
    (documents ?? []).filter((document) => document.role !== 'normative').map((document) => document.path),
  );
}

/**
 * Whether a reference only sits in a link list or an index: the line it is read from is a list item, a table
 * row or a heading, and the first thing after the markup (the list marker, the table bar, the heading hashes,
 * emphasis, backticks, a link label) is the reference itself. A reference with words before it ("Read `x.md`
 * first", "fill in `x.md`") belongs to a sentence that acts on it. Position in the line decides, never a word,
 * and never the title of the atom: the first token is compared with the path the atom records.
 */
export function listedReference(atom: EstateAtom): boolean {
  const line = atom.provenance?.quote ?? '';
  const path = typeof atom.fields?.path === 'string' ? atom.fields.path.replaceAll('\\', '/') : '';
  const marker = /^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+|\|\s*|#{1,6}\s+)/.exec(line);
  if (path === '' || marker === null) return false;
  let rest = line.slice(marker[0].length).replace(/^[\s*_~`<(]+/, '');
  // A link label before its target (`[The form](form.md)`) is markup of the list item, not an instruction.
  const link = /^\[\[?([^\]]*)\]\]?(?:\(<?([^)\s>]*)>?\))?/.exec(rest);
  if (link) rest = link[2] ?? link[1] ?? '';
  const token = (rest.split(/[\s|]/)[0] ?? '')
    .replace(/[`*_~>)\]]+$/, '')
    .replace(/^(?:\$\{?CLAUDE_PROJECT_DIR\}?\/|@|\.\/)/, '')
    .replace(/[#?].*$/, '')
    .replace(/:\d+(?::\d+)?$/, '')
    .replace(/[:,;.]+$/, '')
    .replaceAll('\\', '/');
  return token !== '' && (path === token || path.endsWith(`/${token}`) || path === `${token}.md`);
}

/**
 * A reference that only sits in a link list or an index and points at a navigation document (an example, a
 * template, a history, a fixture, an archive). Reading such a document is not a behaviour the estate demands,
 * so it gives no test. The target's folder or heading never decides it alone: a reference an instruction acts
 * on (words before it in its line, or another atom of the estate, such as a read gate, anchored on its line)
 * is testable whatever its target.
 */
export function navigationReference(
  atom: EstateAtom,
  navigation: ReadonlySet<string>,
  anchored: ReadonlySet<string> = new Set(),
): boolean {
  if (atom.kind !== 'reference' || navigation.size === 0) return false;
  const path = atom.fields?.path;
  if (typeof path !== 'string' || !navigation.has(path.replaceAll('\\', '/').replace(/^\.\//, '')))
    return false;
  const at = atom.provenance;
  if (at?.file !== undefined && at.startLine !== undefined && anchored.has(`${at.file}:${at.startLine}`))
    return false;
  return listedReference(atom);
}

/**
 * The lines of the estate that an atom other than a reference is anchored on: a gate, an instruction, a hazard.
 * A reference on such a line is acted on by that atom, whatever its target.
 */
export function anchoredLines(atoms: readonly EstateAtom[]): ReadonlySet<string> {
  const lines = new Set<string>();
  for (const atom of atoms) {
    const at = atom.provenance;
    if (atom.kind === 'reference' || at?.file === undefined || at.startLine === undefined) continue;
    for (let line = at.startLine; line <= (at.endLine ?? at.startLine) && line < at.startLine + 50; line++)
      lines.add(`${at.file}:${line}`);
  }
  return lines;
}

/** The route atoms that name each unit, by unit atom id: the requests that load it. */
export function unitRoutes(
  atoms: readonly EstateAtom[],
  edges: ReadonlyArray<Link> = [],
): Map<string, EstateAtom[]> {
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const routes = new Map<string, EstateAtom[]>();
  for (const edge of edges) {
    if (edge.kind !== 'route') continue;
    const route = byId.get(edge.from);
    const unit = byId.get(edge.to);
    if (route?.kind !== 'route' || !unit || (unit.kind !== 'skill' && unit.kind !== 'subagent')) continue;
    routes.set(unit.id, [...(routes.get(unit.id) ?? []), route]);
  }
  return routes;
}

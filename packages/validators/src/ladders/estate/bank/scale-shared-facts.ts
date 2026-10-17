import { posix } from 'node:path';
import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';
import type { ShapeClass, SharedTruth } from './scale-shared-estate';

/** What the oracle reads off the map of a shared-index estate, against the truth it was planted from. Pure. */
export type SharedFacts = {
  /** Reference edges stored from skills and helpers, the citations planted in their own files, and the surplus. */
  edges: {
    stored: number;
    allowed: number;
    foreign: number;
    examples: string[];
    /** The most edges any one unit stores beyond the citations in its own file. */
    overOwn: number;
    /** Edges whose end is no atom of the map. */
    dangling: number;
    /** Edges stored twice between the same two atoms. */
    repeated: number;
    /** Whether the unit that cites a file the index also cites stores an edge to that file, and to the index. */
    mixedKept: boolean;
  };
  /** Units whose reachable files differ from the planted closure, in all and by the shape of the file. */
  reach: {
    units: number;
    wrong: number;
    missing: number;
    extra: number;
    examples: string[];
    byClass: Partial<Record<ShapeClass, { missing: number; extra: number }>>;
    /** Files reached that the estate does not hold. */
    phantom: number;
  };
  /** Reference atoms, all atoms, and the citations planted. */
  atoms: { references: number; total: number; planted: number; files: number };
  /** The citation of a file the estate does not hold: a reference atom marked missing, and none marked present. */
  missing: { marked: boolean; wronglyMarked: number };
  /** What each document that cites in a shape of its own holds: the citation atoms it keeps, against the plant. */
  citing: {
    /** Citation atoms of the two documents that cite each other, each to the other: planted 1 and 1. */
    cycle: [number, number];
    /** Citation atoms of the document that cites itself, to itself: planted 1. */
    self: number;
    /** Citation atoms of the file that cites one document twice, to that document: planted 2. */
    twice: number;
  };
  /** The orphans the map lists, against the planted ones. */
  orphans: { listed: string[]; found: number; planted: number; surplus: string[] };
};

const FOUND = (path: string, known: ReadonlySet<string>) => (known.has(path) ? path : undefined);

/** The file a citation names: relative to the citing file's folder when the estate holds it there, else from the root. */
function resolve(cited: string, from: string, known: ReadonlySet<string>): string | undefined {
  const clean = posix.normalize(cited.replace(/^\.\//, ''));
  const dir = posix.dirname(from);
  return FOUND(posix.normalize(dir === '.' ? clean : `${dir}/${cited}`), known) ?? FOUND(clean, known);
}

export function sharedFacts(map: EstateMap, truth: SharedTruth): SharedFacts {
  const known = new Set(truth.files);
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const unitAtoms = new Map<string, Atom>();
  for (const atom of map.atoms)
    if (
      (atom.kind === 'skill' || atom.kind === 'subagent') &&
      truth.units.some((u) => u.file === atom.provenance.file)
    )
      unitAtoms.set(atom.provenance.file, atom);

  // Stored edges: from a unit, to a reference atom. A direct citation sits in the unit's own file.
  const edgesOf = new Map<string, string[]>();
  for (const edge of map.edges)
    if (edge.kind === 'reference') edgesOf.set(edge.from, [...(edgesOf.get(edge.from) ?? []), edge.to]);
  let stored = 0;
  let foreign = 0;
  let overOwn = 0;
  let dangling = 0;
  let repeated = 0;
  const examples: string[] = [];
  let mixedKept = false;
  for (const unit of truth.units) {
    const atom = unitAtoms.get(unit.file);
    const ids = atom ? (edgesOf.get(atom.id) ?? []) : [];
    const targets = ids.flatMap((id) => {
      const target = byId.get(id);
      return target ? [target] : [];
    });
    dangling += ids.length - targets.length;
    repeated += ids.length - new Set(ids).size;
    stored += targets.length;
    overOwn = Math.max(overOwn, targets.length - unit.direct.length);
    const wrong = targets.filter((target) => target.provenance.file !== unit.file);
    foreign += wrong.length;
    if (wrong.length > 0 && examples.length < 3)
      examples.push(
        `${unit.name} stores ${targets.length} reference edges, ${wrong.length} to citations in other files`,
      );
    if (unit.file === truth.mixed.unit) {
      const reached = new Set(targets.map((t) => resolve(String(t.fields?.path ?? ''), unit.file, known)));
      mixedKept = unit.direct.every((path) => reached.has(path));
    }
  }

  // Reachability: the files a unit reaches by following the citations the map holds, file by file.
  const cited = new Map<string, string[]>();
  let phantom = 0;
  let references = 0;
  let wronglyMarked = 0;
  let marked = false;
  for (const atom of map.atoms) {
    if (atom.kind !== 'reference') continue;
    references += 1;
    const written = String(atom.fields?.path ?? '');
    const target = resolve(written, atom.provenance.file, known);
    if (target) cited.set(atom.provenance.file, [...(cited.get(atom.provenance.file) ?? []), target]);
    const isGone =
      atom.provenance.file === truth.missing.from &&
      posix.basename(written) === posix.basename(truth.missing.written);
    if (isGone && atom.fields?.exists === false) marked = true;
    if (!isGone && atom.fields?.exists === false) wronglyMarked += 1;
  }
  let wrong = 0;
  let missing = 0;
  let extra = 0;
  const reachExamples: string[] = [];
  const byClass: SharedFacts['reach']['byClass'] = {};
  const tally = (kind: ShapeClass, field: 'missing' | 'extra') => {
    const slot = byClass[kind] ?? { missing: 0, extra: 0 };
    slot[field] += 1;
    byClass[kind] = slot;
  };
  for (const unit of truth.units) {
    const seen = new Set<string>();
    const queue = [unit.file];
    while (queue.length > 0) {
      const path = queue.pop() as string;
      if (seen.has(path)) continue;
      seen.add(path);
      queue.push(...(cited.get(path) ?? []));
    }
    seen.delete(unit.file);
    const want = new Set(truth.closure[unit.file] ?? []);
    const lacking = [...want].filter((path) => !seen.has(path));
    const surplus = [...seen].filter((path) => !want.has(path));
    for (const path of lacking) tally(truth.classes[path] ?? 'entry', 'missing');
    for (const path of surplus) {
      if (!known.has(path)) phantom += 1;
      else tally(truth.classes[path] ?? 'entry', 'extra');
    }
    if (lacking.length > 0 || surplus.length > 0) {
      wrong += 1;
      missing += lacking.length;
      extra += surplus.length;
      if (reachExamples.length < 3)
        reachExamples.push(
          `${unit.name} reaches ${seen.size} files, ${want.size} planted (${lacking[0] ?? surplus[0]})`,
        );
    }
  }

  // The orphans the map lists: the invariant that holds them lists paths of the estate.
  const listed = map.atoms.flatMap((atom) => {
    const list = atom.kind === 'invariant' ? atom.fields?.orphans : undefined;
    return Array.isArray(list) ? list.map(String) : [];
  });
  const planted = new Set(truth.orphans);
  // The citations a document keeps: the reference atoms of its file that name `to`.
  const kept = (from: string, to: string) =>
    map.atoms.filter(
      (atom) =>
        atom.kind === 'reference' &&
        atom.provenance.file === from &&
        resolve(String(atom.fields?.path ?? ''), from, known) === to,
    ).length;
  const [cycleA, cycleB] = truth.citing.cycle;
  return {
    edges: {
      stored,
      allowed: truth.unitCitations,
      foreign,
      examples,
      overOwn,
      dangling,
      repeated,
      mixedKept,
    },
    reach: { units: truth.units.length, wrong, missing, extra, examples: reachExamples, byClass, phantom },
    atoms: {
      references,
      total: map.atoms.length,
      planted: truth.citations,
      files: truth.files.length,
    },
    missing: { marked, wronglyMarked },
    citing: {
      cycle: [kept(cycleA, cycleB), kept(cycleB, cycleA)],
      self: kept(truth.citing.self, truth.citing.self),
      twice: kept(truth.citing.twice.from, truth.citing.twice.doc),
    },
    orphans: {
      listed,
      found: [...planted].filter((path) => listed.includes(path)).length,
      planted: planted.size,
      surplus: listed.filter((path) => !planted.has(path)),
    },
  };
}

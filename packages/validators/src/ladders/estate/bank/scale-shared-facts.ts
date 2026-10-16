import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';
import type { SharedTruth } from './scale-shared-estate';

/** What the oracle reads off the map of a shared-index estate, against the truth it was planted from. Pure. */
export type SharedFacts = {
  /** Reference edges stored from skills and helpers, the citations planted in their own files, and the surplus. */
  edges: { stored: number; allowed: number; foreign: number; examples: string[] };
  /** Units whose reachable files differ from the planted closure. */
  reach: { units: number; wrong: number; missing: number; extra: number; examples: string[] };
};

const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** The file a citation names: relative to the citing file's folder when the estate holds it there, else from the root. */
function resolve(cited: string, from: string, known: ReadonlySet<string>): string | undefined {
  const clean = cited.replace(/^\.\//, '');
  const local = dirOf(from) === '' ? clean : `${dirOf(from)}/${clean}`;
  if (known.has(local)) return local;
  if (known.has(clean)) return clean;
  return undefined;
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
  const examples: string[] = [];
  for (const unit of truth.units) {
    const atom = unitAtoms.get(unit.file);
    const targets = (atom ? (edgesOf.get(atom.id) ?? []) : []).flatMap((id) => {
      const target = byId.get(id);
      return target ? [target] : [];
    });
    stored += targets.length;
    const wrong = targets.filter((target) => target.provenance.file !== unit.file);
    foreign += wrong.length;
    if (wrong.length > 0 && examples.length < 3)
      examples.push(
        `${unit.name} stores ${targets.length} reference edges, ${wrong.length} to citations in other files`,
      );
  }

  // Reachability: the files a unit reaches by following the citations the map holds, file by file.
  const cited = new Map<string, string[]>();
  for (const atom of map.atoms) {
    if (atom.kind !== 'reference') continue;
    const target = resolve(String(atom.fields?.path ?? ''), atom.provenance.file, known);
    if (target) cited.set(atom.provenance.file, [...(cited.get(atom.provenance.file) ?? []), target]);
  }
  let wrong = 0;
  let missing = 0;
  let extra = 0;
  const reachExamples: string[] = [];
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
  return {
    edges: { stored, allowed: truth.unitCitations, foreign, examples },
    reach: { units: truth.units.length, wrong, missing, extra, examples: reachExamples },
  };
}

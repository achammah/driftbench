import { type EstateFile, type FileKind, isUserLayerPath } from '../scan/reader';
import type { Atom, Edge } from '../schema';

/**
 * What code can answer by walking the graph:
 *
 * - reachable: from the standing instructions. The roots are the atoms of the standing and memory files and
 *   of the settings (the runtime always loads them). A walk follows route, reference, script, dispatch,
 *   allows, next and cites edges. Reaching a skill or a helper reaches every atom of its file (the body comes
 *   with it); reaching a reference, a script or a guard reaches the file it names, and the atoms in it.
 *   A skill or helper whose description is its only way in is unreachable from the standing instructions:
 *   the runtime may still list it, and the lint says so.
 * - named: a file something points at (a reference, a script, a guard command, a path the estate
 *   configuration writes) or a file the runtime loads by its place (standing, memory, settings, a skill or
 *   helper definition, the check registry, the estate configuration).
 * - orphans: files nothing names.
 * - unenforced: instruction, gate and register atoms no guard enforces.
 *
 * The user-level skill layer feeds the walk (its skills, rules and references are atoms of the graph) but is no
 * part of the project: its files are never listed as orphans or unreachable, and its missing references and
 * scripts are not findings of the project.
 */

const WALK: ReadonlySet<Edge['kind']> = new Set([
  'route',
  'reference',
  'script',
  'dispatch',
  'allows',
  'next',
  'cites',
]);
const ROOT_FILES: ReadonlySet<FileKind> = new Set(['standing', 'memory', 'settings']);
const LOADED_BY_PLACE: ReadonlySet<FileKind> = new Set([
  'standing',
  'memory',
  'settings',
  'skill',
  'subagent',
  'registry',
]);
const RULE_KINDS: ReadonlySet<Atom['kind']> = new Set(['instruction', 'gate', 'register']);

export type GraphAnalysis = {
  reachableAtoms: Set<string>;
  reachableFiles: Set<string>;
  namedFiles: Set<string>;
  orphans: string[];
  /** Files not reachable from the standing instructions, orphans left out (they are listed apart). */
  unreachableFiles: string[];
  unenforced: string[];
  /** Reference atoms whose file does not exist. */
  missingReferences: string[];
  /** Guard atoms whose script does not exist. */
  missingScripts: string[];
};

/** The path a reference, script or guard atom names, when it names one. */
export function targetOf(atom: Atom): string | undefined {
  const fields = atom.fields ?? {};
  if (atom.kind === 'reference' || atom.kind === 'script')
    return typeof fields.path === 'string' ? fields.path : undefined;
  if (atom.kind === 'guard') return typeof fields.script === 'string' ? fields.script : undefined;
  return undefined;
}

/** Every path an atom names: its target, and the dispatcher a guard's command runs its script through. */
function pathsOf(atom: Atom): string[] {
  const target = targetOf(atom);
  const via = atom.kind === 'guard' ? atom.fields?.dispatcher : undefined;
  return [...(target ? [target] : []), ...(typeof via === 'string' ? [via] : [])];
}

export function analyzeGraph(
  atoms: readonly Atom[],
  edges: readonly Edge[],
  files: readonly EstateFile[],
): GraphAnalysis {
  const kinds = new Map(files.map((file) => [file.path, file.kind]));
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const inFile = new Map<string, Atom[]>();
  for (const atom of atoms) {
    const list = inFile.get(atom.provenance.file);
    if (list) list.push(atom);
    else inFile.set(atom.provenance.file, [atom]);
  }
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    if (!WALK.has(edge.kind)) continue;
    const list = out.get(edge.from);
    if (list) list.push(edge.to);
    else out.set(edge.from, [edge.to]);
  }

  const reachableAtoms = new Set<string>();
  const reachableFiles = new Set<string>();
  // A queue read from a moving head: taking from the front of an array copies the rest each time.
  const queue: string[] = [];
  let head = 0;
  const reachFile = (path: string) => {
    if (reachableFiles.has(path) || !kinds.has(path)) return;
    reachableFiles.add(path);
    for (const atom of inFile.get(path) ?? []) queue.push(atom.id);
  };
  for (const file of files) if (ROOT_FILES.has(file.kind)) reachFile(file.path);
  while (head < queue.length) {
    const id = queue[head++] ?? '';
    if (reachableAtoms.has(id)) continue;
    const atom = byId.get(id);
    if (!atom) continue;
    reachableAtoms.add(id);
    reachFile(atom.provenance.file);
    for (const path of pathsOf(atom)) reachFile(path);
    for (const next of out.get(id) ?? []) queue.push(next);
  }

  const namedFiles = new Set<string>();
  for (const file of files) if (LOADED_BY_PLACE.has(file.kind)) namedFiles.add(file.path);
  for (const atom of atoms) {
    for (const path of pathsOf(atom)) if (kinds.has(path)) namedFiles.add(path);
  }

  // The estate configuration is read by the tooling by its place, and a file it names (a helper executor, a
  // script it declares fixtures for) is named by it.
  const configs = files.filter((file) => /(^|\/)driftbench\.estate\.ya?ml$/.test(file.path));
  // Tooling files are not instructions to the agent, so they are not unreachable from the standing ones.
  const tooling = new Set<string>();
  for (const config of configs) {
    namedFiles.add(config.path);
    tooling.add(config.path);
    for (const file of files)
      if (file.path !== config.path && config.text.includes(file.path)) {
        namedFiles.add(file.path);
        if (!reachableFiles.has(file.path)) tooling.add(file.path);
      }
  }

  const orphans = files
    .filter((file) => file.layer !== 'user' && !namedFiles.has(file.path))
    .map((file) => file.path);
  const orphanSet = new Set(orphans);
  const unreachableFiles = files
    .filter(
      (file) =>
        file.layer !== 'user' &&
        file.kind !== 'registry' &&
        !reachableFiles.has(file.path) &&
        !orphanSet.has(file.path) &&
        !tooling.has(file.path),
    )
    .map((file) => file.path);

  return {
    reachableAtoms,
    reachableFiles,
    namedFiles,
    orphans,
    unreachableFiles,
    unenforced: atoms
      .filter((atom) => RULE_KINDS.has(atom.kind) && atom.enforcement.length === 0)
      .map((atom) => atom.id),
    missingReferences: atoms
      .filter(
        (atom) =>
          atom.kind === 'reference' &&
          atom.fields?.exists === false &&
          !isUserLayerPath(atom.provenance.file),
      )
      .map((atom) => atom.id),
    missingScripts: atoms
      .filter(
        (atom) =>
          atom.kind === 'guard' &&
          typeof atom.fields?.script === 'string' &&
          !kinds.has(atom.fields.script) &&
          !isUserLayerPath(atom.provenance.file),
      )
      .map((atom) => atom.id),
  };
}

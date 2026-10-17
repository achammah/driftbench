import type { ModelPort } from '@agent-nexus/driftbench-generate';
import { type PointerInput, type PointerResult, pointerAtoms, pointerScan } from '../pointer';
import type { Atom } from '../schema';
import { AtomBuilder, codeAtoms, guardName } from './code';
import { type ChunkRun, type ProseRefusal, runChunk } from './prose';
import type { EstateFile, RawEstate } from './reader';
import { type Located, linesOf } from './text';

/**
 * The scan proper (code atoms, then the prose through the model) and the static invariants of an estate:
 * the size ceiling of the standing instructions, no orphan file, every guard path anchored, a complete
 * check registry. An invariant is a property of the files, checked with no run; its atom records the
 * measured state so a reader of the map sees it, and lint measures it again.
 */

/** The default ceiling on the standing instructions (standing files and memory), in characters. */
export const DEFAULT_STANDING_CEILING = 40_000;

/** The pointer reader's inputs but the files, which the scan takes from the estate's prose. */
export type PointerScanOptions = Omit<PointerInput, 'files'>;

export type ScanAtomsOptions = { port?: ModelPort; maxTokens?: number; pointer?: PointerScanOptions };

export type ScanAtoms = {
  builder: AtomBuilder;
  chunks: ChunkRun[];
  refusals: ProseRefusal[];
  duplicates: string[];
  calls: number;
  /** What the pointer reader did, when it ran instead of the model port. */
  pointer?: PointerResult & { atoms: number; atomRefusals: string[] };
};

/** Code atoms first, in a fixed order, then each prose chunk through the model when a port is given. */
export async function scanAtoms(raw: RawEstate, options: ScanAtomsOptions = {}): Promise<ScanAtoms> {
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const builder = new AtomBuilder(files);
  codeAtoms(raw, builder);
  const chunks: ChunkRun[] = [];
  const refusals: ProseRefusal[] = [];
  const duplicates: string[] = [];
  if (options.pointer) {
    const proseFiles = [...new Set(raw.prose.map((chunk) => chunk.file))];
    const pointed = await pointerScan({
      ...options.pointer,
      files: proseFiles.map((path) => ({ path, text: files.get(path)?.text ?? '' })),
    });
    const built = pointerAtoms(
      pointed.labelled,
      new Map(proseFiles.map((path) => [path, files.get(path)?.text ?? ''])),
      builder,
      options.pointer.labeler.id,
    );
    return {
      builder,
      chunks,
      refusals,
      duplicates: built.duplicates,
      calls: pointed.calls,
      pointer: { ...pointed, atoms: built.accepted.length, atomRefusals: built.refusals },
    };
  }
  if (options.port) {
    for (const chunk of raw.prose) {
      const text = files.get(chunk.file)?.text ?? '';
      const result = await runChunk(chunk, text, options.port, builder, options.maxTokens);
      chunks.push(result.run);
      refusals.push(...result.refusals);
      duplicates.push(...result.duplicates);
    }
  }
  return { builder, chunks, refusals, duplicates, calls: chunks.reduce((sum, run) => sum + run.calls, 0) };
}

/** The measurements the invariants record: from the files, and from the graph for orphans. */
export type InvariantState = {
  ceiling: number;
  standingCharacters: number;
  orphans: string[];
  unanchored: string[];
  guardsWithoutRow: string[];
  rowsWithoutGuard: string[];
};

/** Measures what the files alone decide. Orphans come from the graph and are passed in. */
export function measureInvariants(
  raw: RawEstate,
  orphans: readonly string[],
  ceiling: number,
): InvariantState {
  const names = new Set(raw.guards.map((guard) => guardName(guard)));
  // A catalogue check is listed by its catalogue; the registry is asked to list the guards the runtime runs.
  const runtime = new Set(raw.guards.filter((guard) => !guard.check).map((guard) => guardName(guard)));
  const listed = raw.registry.filter((row) => row.origin !== 'catalogue');
  const rows = new Set(listed.map((row) => row.guard.split('/').pop() ?? row.guard));
  return {
    ceiling,
    standingCharacters: standingFiles(raw).reduce((sum, file) => sum + file.text.length, 0),
    orphans: [...orphans],
    unanchored: raw.guards.filter((guard) => guard.script && !guard.anchored).map((guard) => guard.command),
    guardsWithoutRow: listed.length === 0 ? [] : [...runtime].filter((name) => !rows.has(name)).sort(),
    rowsWithoutGuard: raw.registry
      .filter((row) => !names.has(row.guard.split('/').pop() ?? row.guard))
      .map((row) => row.id),
  };
}

export function standingFiles(raw: RawEstate): EstateFile[] {
  return raw.files.filter((file) => file.kind === 'standing' || file.kind === 'memory');
}

/** Adds the invariant atoms, each anchored on the file the property is about. */
export function invariantAtoms(raw: RawEstate, builder: AtomBuilder, state: InvariantState): Atom[] {
  const added: Atom[] = [];
  const standing = standingFiles(raw)[0];
  if (standing) {
    const at = firstLine(standing);
    added.push(
      builder.add({
        kind: 'invariant',
        title: `The standing instructions stay under ${state.ceiling} characters`,
        at,
        evidence: [{ type: 'static', check: 'standing_size' }],
        fields: {
          check: 'standing_size',
          ceiling: state.ceiling,
          characters: state.standingCharacters,
          holds: state.standingCharacters <= state.ceiling,
        },
      }),
      builder.add({
        kind: 'invariant',
        title: 'No file of the estate is an orphan',
        at,
        evidence: [{ type: 'static', check: 'no_orphans' }],
        fields: { check: 'no_orphans', orphans: state.orphans, holds: state.orphans.length === 0 },
      }),
    );
  }
  const settingsGuard = raw.guards.find((guard) => guard.scope === 'estate');
  if (settingsGuard) {
    const at: Located = settingsGuard.at;
    added.push(
      builder.add({
        kind: 'invariant',
        title: 'Every guard finds its script from an anchor',
        at,
        evidence: [{ type: 'static', check: 'guard_paths_anchored' }],
        fields: {
          check: 'guard_paths_anchored',
          unanchored: state.unanchored,
          holds: state.unanchored.length === 0,
        },
      }),
    );
  }
  const registry = raw.files.find((file) => file.kind === 'registry');
  if (registry) {
    added.push(
      builder.add({
        kind: 'invariant',
        title: 'The check registry lists every guard and only guards that exist',
        at: firstLine(registry),
        evidence: [{ type: 'static', check: 'registry_complete' }],
        fields: {
          check: 'registry_complete',
          guardsWithoutRow: state.guardsWithoutRow,
          rowsWithoutGuard: state.rowsWithoutGuard,
          holds: state.guardsWithoutRow.length === 0 && state.rowsWithoutGuard.length === 0,
        },
      }),
    );
  }
  return added;
}

function firstLine(file: EstateFile): Located {
  const line = linesOf(file.text).find((entry) => entry.text !== '');
  return {
    file: file.path,
    startLine: line?.line ?? 1,
    endLine: line?.line ?? 1,
    quote: line?.text ?? file.path,
  };
}

import { posix } from 'node:path';
import type { ModelPort } from '@agent-nexus/driftbench-generate';
import type { Atom } from '../schema';
import { AtomBuilder, codeAtoms, guardName } from './code';
import { codeNames, longLived } from './code-names';
import { isNormative, normativeEstate, unloadedByDesign } from './document-roles';
import { type ChunkRun, type ProseRefusal, runChunk } from './prose';
import type { EstateFile, GuardDecl, RawEstate } from './reader';
import { type Located, linesOf } from './text';

/**
 * The scan proper (code atoms, then the prose through the model) and the static invariants of an estate:
 * the size ceiling of the standing instructions, no orphan file, every guard path anchored, a complete
 * check registry. An invariant is a property of the files, checked with no run; its atom records the
 * measured state so a reader of the map sees it, and lint measures it again.
 */

/**
 * Characters as a reader counts them: Unicode code points, so an emoji outside the basic plane is one
 * character, not the two UTF-16 units of its JavaScript length; a combining mark stays its own character.
 */
export function characters(text: string): number {
  let surrogatePairs = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        surrogatePairs++;
        index++;
      }
    }
  }
  return text.length - surrogatePairs;
}

/** The default ceiling on the standing instructions (standing files and memory), in characters. */
export const DEFAULT_STANDING_CEILING = 40_000;

export type ScanAtomsOptions = { port?: ModelPort; maxTokens?: number };

export type ScanAtoms = {
  builder: AtomBuilder;
  chunks: ChunkRun[];
  refusals: ProseRefusal[];
  duplicates: string[];
  calls: number;
};

/** Code atoms first, in a fixed order, then each prose chunk through the model when a port is given. */
export async function scanAtoms(raw: RawEstate, options: ScanAtomsOptions = {}): Promise<ScanAtoms> {
  raw = normativeEstate(raw);
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const builder = new AtomBuilder(files);
  codeAtoms(raw, builder);
  const chunks: ChunkRun[] = [];
  const refusals: ProseRefusal[] = [];
  const duplicates: string[] = [];
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

/** Whether a script reads an argument and executes (an exec, a runpy, a subprocess, a loader). */
function executesArgument(text: string): boolean {
  return (
    /\bsys\.argv\b|\bprocess\.argv\b|"\$@"|\$1\b/.test(text) &&
    /\b(?:exec|execfile|runpy|subprocess|os\.exec\w*|importlib|spawn|child_process|eval)\b/.test(text)
  );
}

/** Guard scripts that launch other guards or run as long-lived processes. */
function infrastructureScripts(raw: RawEstate): Set<string> {
  const guardScripts = new Set(
    raw.guards.flatMap((guard) => (!guard.check && guard.script ? [guard.script] : [])),
  );
  const named = codeNames(raw).links;
  const texts = new Map(raw.files.map((file) => [file.path, file.text]));
  const paths = new Set(raw.files.map((file) => file.path));
  // A command that hands another estate script to the script it runs wraps it: the script is a launcher.
  const wraps = (guard: GuardDecl): boolean => {
    for (const word of guard.command.split(/\s+/).slice(1)) {
      const clean = word
        .replace(/^["']|["']$/g, '')
        .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\/?/, '')
        .replace(/^\.\//, '');
      if (!/\.(?:py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl)$/i.test(clean)) continue;
      const found = [clean, posix.join(posix.dirname(guard.script ?? ''), clean)].map((p) =>
        posix.normalize(p),
      );
      // The handed file is a launched script when it is itself a guard script, or when this script reads its
      // argument and executes things. A data or environment file handed to a check is neither.
      const handed = found.find((path) => path !== guard.script && paths.has(path));
      if (handed && (guardScripts.has(handed) || executesArgument(texts.get(guard.script ?? '') ?? '')))
        return true;
    }
    return false;
  };
  const launchers = new Set(
    raw.guards.flatMap((guard) => (!guard.check && guard.script && wraps(guard) ? [guard.script] : [])),
  );
  const found = new Set<string>();
  for (const script of guardScripts) {
    const others = (named.get(script) ?? []).filter((path) => path !== script && guardScripts.has(path));
    if (launchers.has(script) || others.length > 0 || longLived(texts.get(script) ?? '')) found.add(script);
  }
  return found;
}

/** Measures what the files alone decide. Orphans come from the graph and are passed in. */
export function measureInvariants(
  raw: RawEstate,
  orphans: readonly string[],
  ceiling: number,
): InvariantState {
  const navigation = new Set(
    raw.files.filter((file) => unloadedByDesign(raw, file)).map((file) => file.path),
  );
  const names = new Set(raw.guards.map((guard) => guardName(guard)));
  // A catalogue check is listed by its catalogue; the registry is asked to list the guards the runtime runs.
  // A launcher (it runs other guards) or a long-lived process is infrastructure, not a check: no row lists it.
  const infrastructure = infrastructureScripts(raw);
  const runtime = new Set(
    raw.guards
      .filter((guard) => !guard.check && !(guard.script && infrastructure.has(guard.script)))
      .map((guard) => guardName(guard)),
  );
  const listed = raw.registry.filter((row) => row.origin !== 'catalogue');
  const rows = new Set(listed.map((row) => row.guard.split('/').pop() ?? row.guard));
  return {
    ceiling,
    standingCharacters: standingFiles(raw).reduce((sum, file) => sum + characters(file.text), 0),
    orphans: orphans.filter((path) => !navigation.has(path)),
    unanchored: raw.guards.filter((guard) => guard.script && !guard.anchored).map((guard) => guard.command),
    guardsWithoutRow: listed.length === 0 ? [] : [...runtime].filter((name) => !rows.has(name)).sort(),
    rowsWithoutGuard: raw.registry
      .filter((row) => !names.has(row.guard.split('/').pop() ?? row.guard))
      .map((row) => row.id),
  };
}

export function standingFiles(raw: RawEstate): EstateFile[] {
  return raw.files.filter(
    (file) => isNormative(file) && (file.kind === 'standing' || file.kind === 'memory'),
  );
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
  const registry = raw.files.find((file) => isNormative(file) && file.kind === 'registry');
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

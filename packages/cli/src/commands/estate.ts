import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  type Atom,
  AtomKind,
  approveAtoms,
  estateRecordingPort,
  FileProseCache,
  INFORMATION,
  lintEstate,
  loadEstateMap,
  loadEstateRecording,
  type MapIssue,
  parseEstateMapText,
  proseEstimateLine,
  proseInventory,
  proseInventoryLines,
  RUNTIMES,
  readerFor,
  renderEstateMap,
  type ScanEstateResult,
  scanEstate,
  toEstateSpaceMap,
} from '@agent-nexus/driftbench-estate';
import { ModelError, type ModelPort, portFromEnv, shortQuote } from '@agent-nexus/driftbench-generate';
import { formatSpaceMap, gridSize, validateSpaceMap } from '@agent-nexus/driftbench-space';
import type { Command } from 'commander';
import { exists, show, writeOut } from '../files';
import type { Io } from '../io';
import { registerEstateGenerateCommand } from './estate-generate';
import { registerEstateLiveCommands } from './estate-live';
import { registerEstateMaintainCommands } from './estate-maintain';
import { registerEstatePlanCommands } from './estate-plan';
import { registerEstateStaticCommand } from './estate-static';
import { registerEstateStatsCommand } from './estate-stats';
import { registerEstateUnitCommand } from './estate-unit';
import { mapCacheOptions } from './map-cache';

export type EstateScanOptions = {
  /** More globs to skip, beside the defaults and the estate configuration. Repeatable. */
  ignore?: string[];
  /** The folder of the user-level skill layer. Without it (or the configuration's `userSkills:`) none is read. */
  userSkills?: string;
  runtime?: string;
  out?: string;
  replay?: string;
  /** False with --no-model. */
  model?: boolean;
  provider?: string;
  force?: boolean;
  ceiling?: string;
};

/** The folder `--user-skills` names: relative to where the command was typed, `~` left for the reader to expand. */
function userFolder(value: string, io: Io): string {
  return value === '~' || value.startsWith('~/') ? value : resolve(io.cwd, value);
}

/** False, with the error written, when `--user-skills` was given an empty value: it would name the working folder. */
async function userSkillsGiven(value: string | undefined, io: Io): Promise<boolean> {
  if (value === undefined || value.trim() !== '') return true;
  io.err('error: --user-skills needs a folder, not an empty value\n');
  return false;
}

const USER_SKILLS_FLAG = '--user-skills <folder>';
const USER_SKILLS_HELP =
  'also read the user-level skill layer from this folder, such as ~/.claude/skills; none is read without it; a project skill wins a name clash';

export type EstateDeps = {
  /** The model to call instead of the one the environment configures. Tests pass a fake. */
  port?: ModelPort;
  env?: Record<string, string | undefined>;
  now?: () => Date;
};

/**
 * `driftbench estate`: read an agent's estate into a map of atoms (`scan`), check it (`lint`), approve the
 * atoms a model proposed (`approve`), and export its situation axes as a space map (`map`).
 */
export function registerEstateCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const estate = program
    .command('estate')
    .description('Read an agent estate into atoms, lint it, approve its prose atoms, export its space map');

  estate
    .command('scan')
    .description('Read an estate into a map: code reads the structure, a model splits the prose')
    .argument('<root>', 'the estate folder (for claude-code, the project that holds CLAUDE.md and .claude/)')
    .option('--runtime <name>', `the runtime that reads the estate: ${RUNTIMES.join(', ')}`, 'claude-code')
    .option('--out <file>', 'where to write the map (YAML)')
    .option('--replay <file>', 'replay recorded answers instead of calling a model')
    .option('--no-model', 'read structure and unapproved code-found prose candidates; no model call')
    .option('--provider <name>', 'anthropic or openai (default: the first whose key is set)')
    .option('--ceiling <characters>', 'the size ceiling of the standing instructions', '40000')
    .option('--ignore <glob>', 'skip the paths this glob matches, beside the defaults; repeat it', collect)
    .option(USER_SKILLS_FLAG, USER_SKILLS_HELP)
    .option('--force', 'replace an existing map; the approvals in it are lost')
    .action(async (root: string, options: EstateScanOptions) => {
      setExit(await estateScanCommand(root, options, io));
    });

  estate
    .command('lint')
    .description(
      'Check an estate against its map: orphans, unreachable files, unenforced atoms, ceilings, guards',
    )
    .argument('<map>', 'the estate map')
    .option('--ceiling <characters>', 'the size ceiling of the standing instructions', '40000')
    .option('--ignore <glob>', 'skip the paths this glob matches, as the scan did; repeat it', collect)
    .option(USER_SKILLS_FLAG, USER_SKILLS_HELP)
    .action(async (path: string, options: { ceiling?: string; ignore?: string[]; userSkills?: string }) => {
      setExit(await estateLintCommand(path, options, io));
    });

  estate
    .command('approve')
    .description('List the atoms left to approve, or approve by kind, by atom or all')
    .argument('<map>', 'the estate map')
    .option('--kind <kind>', 'approve every atom of this kind; repeat it', collect)
    .option('--atom <id>', 'approve this atom; repeat it', collect)
    .option('--all', 'approve every atom')
    .option('--to <file>', 'write the approved map here, in the same folder, instead of over it')
    .action(async (path: string, options: EstateApproveOptions) => {
      setExit(await estateApproveCommand(path, options, io));
    });

  estate
    .command('map')
    .description(
      'Write the space map of the situation axes and the approved axis atoms, for driftbench space',
    )
    .argument('<map>', 'the estate map')
    .option('--to <file>', 'where to write the space map (YAML)')
    .option('--all', 'take every axis atom, approved or not')
    .option('--agent <name>', 'the agent the space map describes (default: the estate folder name)')
    .action(async (path: string, options: { to?: string; all?: boolean; agent?: string }) => {
      setExit(await estateMapCommand(path, options, io));
    });

  registerEstatePlanCommands(estate, io, setExit);
  registerEstateMaintainCommands(estate, io, setExit);
  registerEstateGenerateCommand(estate, io, setExit);
  registerEstateLiveCommands(estate, io, setExit);
  registerEstateStaticCommand(estate, io, setExit);
  registerEstateStatsCommand(estate, io, setExit);
  registerEstateUnitCommand(estate, io, setExit);
}

/**
 * Exit 0 when the map is written and every chunk answered with no refusal, 1 when it is written but a chunk
 * failed or an atom was refused (both listed), 2 on a usage or input error (nothing written).
 */
export async function estateScanCommand(
  rootArg: string,
  options: EstateScanOptions,
  io: Io,
  deps: EstateDeps = {},
): Promise<number> {
  if (!options.out) {
    io.err("error: required option '--out <file>' not specified\n");
    return 2;
  }
  const runtime = options.runtime ?? 'claude-code';
  if (!(await userSkillsGiven(options.userSkills, io))) return 2;
  const reader = readerFor(runtime, {
    ignore: options.ignore ?? [],
    ...(options.userSkills !== undefined ? { userSkills: userFolder(options.userSkills, io) } : {}),
  });
  if (!reader) {
    io.err(`error: unknown runtime "${runtime}": use ${RUNTIMES.join(', ')}\n`);
    return 2;
  }
  if (options.model === false && options.replay) {
    io.err('error: --no-model and --replay cannot be used together\n');
    return 2;
  }
  const ceiling = parseCeiling(options.ceiling, io);
  if (ceiling === undefined) return 2;
  const root = resolve(io.cwd, rootArg);
  if (!(await isFolder(root))) {
    io.err(`Cannot find the estate folder ${show(root, io)}.\n`);
    return 2;
  }
  const out = resolve(io.cwd, options.out);
  if (!options.force && (await exists(out))) {
    io.err(`${show(out, io)} already exists: pass --force to replace it (the approvals in it are lost).\n`);
    return 2;
  }

  let port: ModelPort | undefined;
  if (options.model !== false) {
    if (options.replay) {
      const recording = resolve(io.cwd, options.replay);
      const loaded = await loadEstateRecording(recording);
      if (!loaded.ok) {
        io.err(`Cannot use the recording ${show(recording, io)}: ${loaded.message}\n`);
        return 2;
      }
      port = estateRecordingPort(loaded.recording);
    } else {
      try {
        port = deps.port ?? portFromEnv({ env: deps.env, provider: options.provider });
      } catch (cause) {
        if (!(cause instanceof ModelError)) throw cause;
        io.err(`${cause.message}. Pass --no-model to read the structured atoms only.\n`);
        return 2;
      }
    }
  }

  const result = await scanEstate({
    root,
    reader,
    rootLabel: label(out, root),
    ceiling,
    ...(port
      ? {
          port,
          ...(!options.replay
            ? { cache: new FileProseCache(resolve(dirname(out), '.cache', 'estate-prose')) }
            : {}),
          beforeModel: (estimate) => {
            io.out(proseEstimateLine(estimate));
          },
        }
      : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!(await writeOut(out, renderEstateMap(result.map), io))) return 2;
  io.out(scanReport(result, out, io));
  const failed = result.chunks.some((run) => run.status === 'failed');
  return failed || result.refusals.length > 0 ? 1 : 0;
}

/** What the reader skipped, per glob, so an owner sees what the ignore list hides. */
function ignoredLines(result: ScanEstateResult): string[] {
  const ignored = result.raw.ignored;
  if (!ignored) return [];
  const hits = ignored.patterns.filter((entry) => entry.files > 0);
  if (hits.length === 0) return ['  Ignored: none.'];
  const total = hits.reduce((sum, entry) => sum + entry.files, 0);
  return [
    `  Ignored: ${total} ${plural(total, 'file', 'files')} no runtime loads.`,
    ...hits.map((entry) => `    ${entry.pattern}  ${entry.files}`),
  ];
}

function scanReport(result: ScanEstateResult, out: string, io: Io): string {
  const { map, analysis } = result;
  const candidates = map.atoms.filter((atom) => atom.fields?.candidate === true).length;
  const candidateText = candidates > 0 ? `, ${candidates} code-found candidates waiting for approval` : '';
  const byModel = map.atoms.filter((atom) => atom.producedBy === 'model').length;
  const lines = [
    `Wrote ${show(out, io)}: ${map.atoms.length} atoms (${map.atoms.length - byModel - candidates} read by code and approved${candidateText}, ${byModel} split from prose by the model and waiting for approval), ${map.edges.length} edges.`,
    '  Atoms per kind:',
  ];
  const kinds = AtomKind.options.filter((kind) => map.atoms.some((atom) => atom.kind === kind));
  const width = Math.max(...kinds.map((kind) => kind.length));
  for (const kind of kinds) {
    const atoms = map.atoms.filter((atom) => atom.kind === kind);
    const model = atoms.filter((atom) => atom.producedBy === 'model').length;
    lines.push(
      `    ${kind.padEnd(width)}  ${String(atoms.length).padStart(3)}${model > 0 ? `  (${model} by the model)` : ''}`,
    );
  }
  const prose = proseInventoryLines(proseInventory(result.raw), result.chunks.length > 0);
  if (result.chunks.length === 0)
    lines.push('  No model call: structured atoms and code-found prose candidates (--no-model).', ...prose);
  else {
    lines.push(...prose);
    const calls = result.calls;
    lines.push(
      `  Model ${map.producedBy?.family} ${map.producedBy?.model}: ${result.chunks.length} prose chunks, ${calls} ${plural(calls, 'call', 'calls')}.`,
    );
    for (const run of result.chunks.filter((chunk) => chunk.status === 'failed')) {
      lines.push(`    ${run.chunk}  failed: ${run.error}${run.excerpt ? ` (answer: "${run.excerpt}")` : ''}`);
    }
  }
  const candidateSkips = result.raw.notes.filter((note) =>
    note.message.startsWith('Prose candidate skipped'),
  );
  if (candidateSkips.length > 0) {
    lines.push(`  Code-found prose candidates skipped: ${candidateSkips.length}.`);
    for (const note of candidateSkips) lines.push(`    ${note.file}: ${note.message}`);
  }
  lines.push(result.refusals.length === 0 ? '  Refused: none.' : '  Refused, not in the map:');
  for (const refusal of result.refusals)
    lines.push(`    ${refusal.chunk}  ${refusal.entry}  ${refusal.reason}`);
  if (result.duplicates.length > 0) {
    lines.push(
      `  Skipped ${result.duplicates.length} ${plural(result.duplicates.length, 'atom', 'atoms')} code had already read:`,
    );
    for (const duplicate of result.duplicates) lines.push(`    ${duplicate}`);
  }
  for (const note of result.raw.notes.filter((note) => note.message.startsWith('Ambiguous routing table')))
    lines.push(`  ${note.file}: ${note.message}`);
  lines.push(...ignoredLines(result));
  const layer = result.raw.userLayer;
  if (layer && layer.read.length + layer.shadowed.length > 0) {
    lines.push(
      `  User skill layer: ${layer.read.length} ${plural(layer.read.length, 'skill', 'skills')} read; ${layer.shadowed.length} left out because a skill of the same name comes first.`,
    );
  }
  const external = map.atoms.filter((atom) => atom.kind === 'reference' && atom.fields?.external === true);
  if (external.length > 0) {
    lines.push(
      `  External: ${external.length} named ${plural(external.length, 'path', 'paths')} outside the estate (information, not a finding).`,
    );
  }
  lines.push(listLine('Orphans', analysis.orphans));
  lines.push(listLine('Unreachable from the standing instructions', analysis.unreachableFiles));
  const rules = map.atoms.filter((atom) => ['instruction', 'gate', 'register'].includes(atom.kind)).length;
  lines.push(`  Unenforced: ${analysis.unenforced.length} of ${rules} rules have no guard.`);
  for (const id of analysis.unenforced) lines.push(`    ${id}`);
  lines.push(
    `Next: driftbench estate lint ${show(out, io)}; driftbench estate approve ${show(out, io)} --kind instruction`,
    '',
  );
  return lines.join('\n');
}

/** Exit 0 clean (unenforced atoms alone are reported, not failed), 1 on findings or an invalid map, 2 when the map or the estate cannot be read. */
export async function estateLintCommand(
  path: string,
  options: { ceiling?: string; ignore?: string[]; userSkills?: string },
  io: Io,
): Promise<number> {
  const ceiling = parseCeiling(options.ceiling, io);
  if (ceiling === undefined) return 2;
  const file = resolve(io.cwd, path);
  if (!(await exists(file))) {
    io.err(`Cannot find ${show(file, io)}.\n`);
    return 2;
  }
  const loaded = await loadEstateMap(file, mapCacheOptions());
  if (!loaded.ok) {
    io.err(`✗ ${show(file, io)}\n${loaded.errors.map(issueLine).join('')}`);
    return 1;
  }
  // The scan's own ignore list comes with the map, so lint reads the same files.
  const ignore = [...new Set([...(loaded.map.ignore ?? []), ...(options.ignore ?? [])])];
  if (!(await userSkillsGiven(options.userSkills, io))) return 2;
  // A map scanned with a user layer is linted with it: the folder comes again from --user-skills or the configuration.
  const reader = readerFor(loaded.map.runtime, {
    ignore,
    ...(options.userSkills !== undefined ? { userSkills: userFolder(options.userSkills, io) } : {}),
  });
  if (!reader) {
    io.err(`The map was read by the runtime "${loaded.map.runtime}", which this driftbench cannot read.\n`);
    return 2;
  }
  const root = resolve(dirname(file), loaded.map.root);
  if (!(await isFolder(root))) {
    io.err(`Cannot find the estate folder ${show(root, io)} the map names.\n`);
    return 2;
  }
  const raw = await reader.read(root);
  if (loaded.map.userSkills === true && raw.userLayer === undefined) {
    io.err(
      'The map was scanned with a user-level skill layer: pass --user-skills <folder> (or set userSkills in the estate configuration) so lint reads it again.\n',
    );
    return 2;
  }
  const result = lintEstate(loaded.map, raw, { ceiling });
  const lines = [`${show(file, io)}: estate at ${show(root, io)}, ${loaded.map.atoms.length} atoms.`];
  const shown = result.findings.filter((finding) => !INFORMATION.has(finding.code));
  const width = Math.max(0, ...shown.map((finding) => finding.code.length));
  for (const finding of shown) lines.push(`  ${finding.code.padEnd(width)}  ${finding.message}`);
  lines.push(
    `  UNENFORCED  ${result.counts.UNENFORCED} rules no guard enforces (trusted; listed by estate scan).`,
    `  EXTERNAL    ${result.counts.EXTERNAL} named paths outside the estate (information).`,
  );
  lines.push(
    result.failed ? `${shown.length} ${plural(shown.length, 'finding', 'findings')}.` : 'Clean.',
    '',
  );
  io.out(lines.join('\n'));
  return result.failed ? 1 : 0;
}

export type EstateApproveOptions = { kind?: string[]; atom?: string[]; all?: boolean; to?: string };

/** Exit 0 after listing or approving, 1 when the map is invalid or names an unknown kind or atom, 2 when the file is missing or the options do not fit. */
export async function estateApproveCommand(
  path: string,
  options: EstateApproveOptions,
  io: Io,
): Promise<number> {
  const file = resolve(io.cwd, path);
  if (!(await exists(file))) {
    io.err(`Cannot find ${show(file, io)}.\n`);
    return 2;
  }
  const kinds = options.kind ?? [];
  const atoms = options.atom ?? [];
  if (options.all && (kinds.length > 0 || atoms.length > 0)) {
    io.err('error: --all cannot be used with --kind or --atom\n');
    return 2;
  }
  const target = options.to ? resolve(io.cwd, options.to) : file;
  if (options.to && dirname(target) !== dirname(file)) {
    io.err('error: --to must stay in the folder of the map, where its estate root resolves\n');
    return 2;
  }
  const text = await readFile(file, 'utf8');
  const parsed = parseEstateMapText(text);
  if (!parsed.ok) {
    io.err(`✗ ${show(file, io)}\n${parsed.errors.map(issueLine).join('')}`);
    return 1;
  }
  if (!options.all && kinds.length === 0 && atoms.length === 0) {
    io.out(pendingReport(parsed.map.atoms, show(file, io)));
    return 0;
  }
  const result = approveAtoms(text, { kinds, ids: atoms, ...(options.all ? { all: true } : {}) });
  if (!result.ok) {
    io.err(`✗ ${show(file, io)}\n${result.errors.map(issueLine).join('')}`);
    return 1;
  }
  if (!(await writeOut(target, result.text, io))) return 2;
  io.out(
    `Approved ${result.approved.length} ${plural(result.approved.length, 'atom', 'atoms')} in ${show(target, io)}; ${result.already} ${result.already === 1 ? 'was' : 'were'} already approved.\n`,
  );
  return 0;
}

function pendingReport(atoms: readonly Atom[], name: string): string {
  const pending = atoms.filter((atom) => !atom.approved);
  if (pending.length === 0) return `${name}: all ${atoms.length} atoms are approved.\n`;
  const lines = [`${name}: ${pending.length} of ${atoms.length} atoms wait for approval.`];
  for (const kind of AtomKind.options) {
    const left = pending.filter((atom) => atom.kind === kind);
    if (left.length === 0) continue;
    lines.push(`  ${kind}: ${left.length}`);
    for (const atom of left) {
      lines.push(
        `    ${atom.id}  ${atom.provenance.file}:${atom.provenance.startLine}  "${shortQuote(atom.provenance.quote, 60)}"`,
      );
    }
  }
  lines.push('Approve a kind with --kind <kind>, an atom with --atom <id>, or every atom with --all.', '');
  return lines.join('\n');
}

/** Exit 0 written, 1 when the map is invalid or its space map is, 2 when the file is missing or --to is. */
export async function estateMapCommand(
  path: string,
  options: { to?: string; all?: boolean; agent?: string },
  io: Io,
): Promise<number> {
  const file = resolve(io.cwd, path);
  if (!(await exists(file))) {
    io.err(`Cannot find ${show(file, io)}.\n`);
    return 2;
  }
  if (!options.to) {
    io.err("error: required option '--to <file>' not specified\n");
    return 2;
  }
  const loaded = await loadEstateMap(file, mapCacheOptions());
  if (!loaded.ok) {
    io.err(`✗ ${show(file, io)}\n${loaded.errors.map(issueLine).join('')}`);
    return 1;
  }
  const out = resolve(io.cwd, options.to);
  const agent = options.agent ?? (basename(resolve(dirname(file), loaded.map.root)) || 'estate');
  const space = toEstateSpaceMap(loaded.map, { approvedOnly: !options.all, agent });
  const checked = validateSpaceMap(space, show(out, io));
  if (!checked.ok) {
    io.err(`✗ the space map of ${show(file, io)} is invalid\n${checked.errors.map(issueLine).join('')}`);
    return 1;
  }
  const written = await writeOut(
    out,
    formatSpaceMap(space, [
      `The space map of ${basename(file)}: the situation axes of an estate and its ${options.all ? '' : 'approved '}axis atoms by kind.`,
      'Written by driftbench estate map; approve atoms in the estate map and write it again rather than editing this file.',
    ]),
    io,
  );
  if (!written) return 2;
  const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
  io.out(
    [
      `Wrote ${show(out, io)}: ${space.dimensions.length - targets.length} situation axes, ${targets.length} target dimensions (${targets.map((dimension) => `${dimension.id.slice(6)} ${dimension.values.length}`).join(', ')}), ${space.constraints.length} constraints.`,
      `  The full grid holds ${gridSize(space)} cells: plan on t-wise coverage, not the full grid.`,
      '',
    ].join('\n'),
  );
  return 0;
}

function listLine(title: string, items: readonly string[]): string {
  return items.length === 0 ? `  ${title}: none.` : `  ${title}: ${items.join(', ')}.`;
}

function parseCeiling(value: string | undefined, io: Io): number | undefined {
  const ceiling = Number(value ?? '40000');
  if (!Number.isInteger(ceiling) || ceiling <= 0) {
    io.err(`error: --ceiling takes a positive whole number of characters, not "${value}"\n`);
    return undefined;
  }
  return ceiling;
}

/** The root as the map records it: relative to the map's folder, with forward slashes. */
function label(out: string, root: string): string {
  const rel = relative(dirname(out), root);
  if (rel === '') return '.';
  return isAbsolute(rel) ? root : rel.split(sep).join('/');
}

function issueLine(issue: MapIssue | { code: string; path: string; message: string }): string {
  return `  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`;
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

async function isFolder(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}

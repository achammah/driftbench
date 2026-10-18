import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  type Atom,
  AtomKind,
  approveAtoms,
  estateRecordingPort,
  INFORMATION,
  lintEstate,
  loadEstateMap,
  loadEstateRecording,
  type MapIssue,
  parseEstateMapText,
  pointer,
  proseInventory,
  proseInventoryLines,
  RUNTIMES,
  readerFor,
  renderEstateMap,
  type ScanEstateResult,
  scanEstate,
  toEstateSpaceMap,
} from '@agent-nexus/driftbench-estate';
import {
  type FetchLike,
  ModelError,
  type ModelPort,
  portFromEnv,
  shortQuote,
} from '@agent-nexus/driftbench-generate';
import { formatSpaceMap, gridSize, validateSpaceMap } from '@agent-nexus/driftbench-space';
import type { Command } from 'commander';
import { exists, show, writeOut } from '../files';
import type { Io } from '../io';
import { registerEstateGenerateCommand } from './estate-generate';
import { registerEstateLiveCommands } from './estate-live';
import { registerEstateMaintainCommands } from './estate-maintain';
import { registerEstatePlanCommands } from './estate-plan';
import { type EstatePointerOptions, openPointer, pointerLines } from './estate-pointer';
import { registerEstateStaticCommand } from './estate-static';
import { registerEstateStatsCommand } from './estate-stats';
import { registerEstateUnitCommand } from './estate-unit';
import { mapCacheOptions } from './map-cache';

export type EstateScanOptions = EstatePointerOptions & {
  /** More globs to skip, beside the defaults and the estate configuration. Repeatable. */
  ignore?: string[];
  runtime?: string;
  out?: string;
  replay?: string;
  /** False with --no-model. */
  model?: boolean;
  provider?: string;
  force?: boolean;
  ceiling?: string;
};

export type EstateDeps = {
  /** The model to call instead of the one the environment configures. Tests pass a fake. */
  port?: ModelPort;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** The fetch the pointer labelers call with instead of the global one. Tests pass a fake. */
  fetch?: FetchLike;
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
    .option('--no-model', 'read the structured atoms only; no prose atom')
    .option('--provider <name>', 'anthropic or openai (default: the first whose key is set)')
    .option('--ceiling <characters>', 'the size ceiling of the standing instructions', '40000')
    .option('--ignore <glob>', 'skip the paths this glob matches, beside the defaults; repeat it', collect)
    .option('--force', 'replace an existing map; the approvals in it are lost')
    .option(
      '--pointer',
      'read the prose with the pointer reader: units cut by structure, labelers of two classes point at them',
    )
    .option(
      '--labels <file>',
      'with --pointer: the label sets (YAML); default is the shipped agent-rules set',
    )
    .option('--cassette <file>', 'with --pointer: the recorded labeler answers (JSON lines)')
    .option('--record', 'with --pointer: call the labelers on a cassette miss and record the answer')
    .option(
      '--labeler <spec>',
      'with --pointer: <class>:<client>[:<model>], class system1 or system2; repeat it for a stack of both (default: system1:jev and system2:anthropic)',
      collect,
    )
    .option(
      '--labeler-threshold <p>',
      'with --pointer: the probability of yes at which a system 1 labeler takes a label',
    )
    .option(
      '--labeler-pass-at <p>',
      'with --pointer and a stack: system 1 decides a unit alone from this probability (default 0.9)',
    )
    .option(
      '--labeler-fail-at <p>',
      'with --pointer and a stack: system 1 decides that a unit has no label under this probability (default 0.1); in between, system 2 decides',
    )
    .option(
      '--labeler-margin-cut <m>',
      'with --pointer and a stack: decide by margin instead: system 1 decides a unit whose top label leads the second by this much, system 2 the rest',
    )
    .option(
      '--labeler-key <variable>',
      'with --pointer: the environment variable that holds the bearer token of an http labeler',
    )
    .option('--jobs <n>', 'with --pointer: requests in flight at once (default 4)')
    .option(
      '--ledger <file>',
      'with --pointer: the ledger of unit ids beside the estate; read, then rewritten',
    )
    .option('--ledger-check', 'with --pointer: fail when the ledger is out of date; write nothing')
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
    .action(async (path: string, options: { ceiling?: string; ignore?: string[] }) => {
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
  const reader = readerFor(runtime, { ignore: options.ignore ?? [] });
  if (!reader) {
    io.err(`error: unknown runtime "${runtime}": use ${RUNTIMES.join(', ')}\n`);
    return 2;
  }
  if (options.model === false && options.replay) {
    io.err('error: --no-model and --replay cannot be used together\n');
    return 2;
  }
  if (options.pointer && (options.model === false || options.replay)) {
    io.err('error: --pointer cannot be used with --no-model or --replay: the cassette replays the labeler\n');
    return 2;
  }
  if (
    !options.pointer &&
    (options.cassette ||
      options.record ||
      options.ledger ||
      options.labels ||
      options.labeler?.length ||
      options.jobs)
  ) {
    io.err('error: --cassette, --record, --ledger, --labels, --labeler and --jobs need --pointer\n');
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
  if (options.model !== false && !options.pointer) {
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

  const handle = options.pointer
    ? await openPointer(options, io, deps.env ?? process.env, deps.fetch)
    : undefined;
  if (options.pointer && !handle) return 2;

  let result: ScanEstateResult;
  try {
    result = await scanEstate({
      root,
      reader,
      rootLabel: label(out, root),
      ceiling,
      ...(port ? { port } : {}),
      ...(handle ? { pointer: handle.scan } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
  } catch (cause) {
    if (cause instanceof pointer.CassetteMiss || cause instanceof pointer.LabelerConfigError) {
      io.err(`${cause.message}\n`);
      return 2;
    }
    throw cause;
  }
  if (!(await writeOut(out, renderEstateMap(result.map), io))) return 2;
  io.out(scanReport(result, out, io, handle?.describe));
  const closing = handle ? await handle.finish(result) : 0;
  if (closing === 2) return 2;
  const failed =
    result.chunks.some((run) => run.status === 'failed') ||
    (result.pointer?.failed.length ?? 0) > 0 ||
    (result.pointer?.refusals.length ?? 0) > 0 ||
    (result.pointer?.atomRefusals.length ?? 0) > 0;
  return failed || result.refusals.length > 0 || closing !== 0 ? 1 : 0;
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

function scanReport(result: ScanEstateResult, out: string, io: Io, describe = ''): string {
  const { map, analysis } = result;
  const byModel = map.atoms.filter((atom) => atom.producedBy === 'model').length;
  const lines = [
    `Wrote ${show(out, io)}: ${map.atoms.length} atoms (${map.atoms.length - byModel} read by code and approved, ${byModel} split from prose by the model and waiting for approval), ${map.edges.length} edges.`,
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
  const prose = proseInventoryLines(proseInventory(result.raw), result.chunks.length > 0 || !!result.pointer);
  if (result.pointer) {
    lines.push(...prose, ...pointerLines(result, describe));
  } else if (result.chunks.length === 0)
    lines.push('  No model call: structured atoms only (--no-model).', ...prose);
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
  lines.push(result.refusals.length === 0 ? '  Refused: none.' : '  Refused, not in the map:');
  for (const refusal of result.refusals)
    lines.push(`    ${refusal.chunk}  ${refusal.entry}  ${refusal.reason}`);
  if (result.duplicates.length > 0) {
    lines.push(
      `  Skipped ${result.duplicates.length} ${plural(result.duplicates.length, 'atom', 'atoms')} code had already read:`,
    );
    for (const duplicate of result.duplicates) lines.push(`    ${duplicate}`);
  }
  lines.push(...ignoredLines(result));
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
  options: { ceiling?: string; ignore?: string[] },
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
  const reader = readerFor(loaded.map.runtime, { ignore });
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

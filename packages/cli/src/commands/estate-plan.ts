import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  approvePlanRows,
  buildPlan,
  loadEstateMap,
  type Plan,
  type PlanDetails,
  PlanInputError,
  parsePlanText,
  renderPlan,
  renderPlanSummary,
  summaryPathOf,
} from '@agent-nexus/driftbench-estate';
import { loadSpaceMap, type SpaceMap } from '@agent-nexus/driftbench-space';
import type { Command } from 'commander';
import { exists, show, writeOut } from '../files';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { mapCacheOptions } from './map-cache';

export type EstatePlanOptions = { out?: string; t?: string; space?: string; k?: string; force?: boolean };
export type EstatePlanApproveOptions = { all?: boolean; row?: string[]; strike?: boolean; out?: string };

/**
 * `driftbench estate plan <map>`: derive the test plan from an approved estate map (design section 4), and
 * `driftbench estate plan approve <plan>`: approve or strike its rows.
 */
export function registerEstatePlanCommands(estate: Command, io: Io, setExit: (code: number) => void): void {
  const plan = estate
    .command('plan')
    .description(
      'Derive the test plan from an approved map: the contract per atom kind, journeys, pairwise cells',
    )
    .argument('<map>', 'the approved estate map')
    .option(
      '--out <file>',
      'where to write the plan (YAML); the summary goes beside it as <plan>.summary.json',
    )
    .option('--t <n>', 'the strength of the covering array over the situation axes', '2')
    .option(
      '--space <file>',
      'an authoritative space map (default: cross each situation with the atoms that hold its typed relation)',
    )
    .option('--k <n>', 'positive asks per route', '3')
    .option('--force', 'replace an existing plan; the approvals in it are lost')
    .action(async (path: string, options: EstatePlanOptions) => {
      setExit(await estatePlanCommand(path, options, io));
    });

  plan
    .command('approve')
    .description('List the plan rows by status, or approve them all, approve a row, or strike a row')
    .argument('<plan>', 'the plan file')
    .option('--all', 'approve every row still proposed')
    .option('--row <id>', 'approve this row; repeat it', collect)
    .option('--strike', 'strike the rows named with --row instead of approving them')
    .option('--out <file>', 'write the result here and leave the plan read untouched (default: in place)')
    .action(async (path: string, options: EstatePlanApproveOptions, command: Command) => {
      // `plan` declares --out too, and commander gives it to the parent: read both.
      const out = options.out ?? (command.optsWithGlobals() as { out?: string }).out;
      setExit(await estatePlanApproveCommand(path, { ...options, ...(out ? { out } : {}) }, io));
    });
}

/**
 * Exit 0 when the plan and its summary are written, 1 when the map or the space map is invalid or they do
 * not match, 2 on a usage or input error (nothing written).
 */
export async function estatePlanCommand(path: string, options: EstatePlanOptions, io: Io): Promise<number> {
  if (!options.out) {
    io.err("error: required option '--out <file>' not specified\n");
    return 2;
  }
  const t = wholeNumber(options.t ?? '2', '--t', io);
  const k = wholeNumber(options.k ?? '3', '--k', io);
  if (t === undefined || k === undefined) return 2;
  const file = resolve(io.cwd, path);
  if (!(await exists(file))) {
    io.err(`Cannot find ${show(file, io)}.\n`);
    return 2;
  }
  const out = resolve(io.cwd, options.out);
  const summaryOut = summaryPathOf(out);
  if (out === file) {
    io.err('error: --out names the map itself\n');
    return 2;
  }
  if (!options.force && (await exists(out))) {
    io.err(`${show(out, io)} already exists: pass --force to replace it (the approvals in it are lost).\n`);
    return 2;
  }
  const loaded = await loadEstateMap(file, mapCacheOptions());
  if (!loaded.ok) {
    io.err(`✗ ${show(file, io)}\n${loaded.errors.map(issueLine).join('')}`);
    return 1;
  }
  let space: SpaceMap | undefined;
  if (options.space) {
    const spaceFile = resolve(io.cwd, options.space);
    if (!(await exists(spaceFile))) {
      io.err(`Cannot find ${show(spaceFile, io)}.\n`);
      return 2;
    }
    const result = await loadSpaceMap(spaceFile);
    if (!result.ok) {
      io.err(`✗ ${show(spaceFile, io)}\n${result.errors.map(issueLine).join('')}`);
      return 1;
    }
    space = result.map;
  }
  let built: ReturnType<typeof buildPlan>;
  try {
    built = buildPlan(loaded.map, { t, k, ...(space ? { space } : {}) });
  } catch (cause) {
    if (cause instanceof PlanInputError) {
      io.err(`✗ ${cause.message}\n`);
      return 1;
    }
    if (cause instanceof RangeError) {
      io.err(`error: ${cause.message}\n`);
      return 2;
    }
    throw cause;
  }
  if (!(await writeOut(out, renderPlan(built.plan), io))) return 2;
  if (!(await writeOut(summaryOut, renderPlanSummary(built.plan, built.details), io))) return 2;
  io.out(planReport(built.plan, built.details, show(out, io), show(summaryOut, io)));
  return 0;
}

/**
 * The most lines one list prints on the console. A real estate holds thousands of edges with no journey, rows
 * adjusted to the space map and notes: the console gets the count and the first of each, the summary file
 * gets every one.
 */
export const CONSOLE_LIST_LINES = 10;

/** Pushes up to `CONSOLE_LIST_LINES` lines of a list and, past that, one line that counts the rest and names the file. */
function pushListed<T>(
  lines: string[],
  items: readonly T[],
  line: (item: T) => string,
  rest: { summaryOut: string; key: string },
): void {
  for (const item of items.slice(0, CONSOLE_LIST_LINES)) lines.push(line(item));
  if (items.length > CONSOLE_LIST_LINES)
    lines.push(
      `    and ${items.length - CONSOLE_LIST_LINES} more, all in ${rest.summaryOut} under "${rest.key}".`,
    );
}

export function planReport(plan: Plan, details: PlanDetails, out: string, summaryOut: string): string {
  const { summary } = plan;
  const lines = [
    `Wrote ${out}: ${details.rows.total} rows (${details.rows.contract} from the contract, ${details.rows.journey} journeys, ${details.rows.pairwise} pairwise), all proposed. Summary in ${summaryOut}.`,
    `  Cells: ${summary.cells} (a cell is the atoms of a row crossed with its situation values).`,
    `  Covering array: ${summary.coveringArraySize} rows, t = ${details.t}, ${details.tuples.covered} of ${details.tuples.allowed} allowed ${details.t}-tuples covered; the full grid of ${details.gridCells} cells is never enumerated.`,
    '  Mandatory rows per kind (a row counts once for each kind it names):',
  ];
  const kinds = Object.entries(summary.perKind);
  const width = Math.max(0, ...kinds.map(([kind]) => kind.length));
  for (const [kind, count] of kinds) lines.push(`    ${kind.padEnd(width)}  ${String(count).padStart(4)}`);
  lines.push('  Rows per test type (contract, journeys and pairwise together):');
  const types = Object.entries(summary.perTestType);
  const typeWidth = Math.max(0, ...types.map(([type]) => type.length));
  for (const [type, count] of types)
    lines.push(`    ${type.padEnd(typeWidth)}  ${String(count).padStart(4)}`);
  if (details.noContract.length > 0) {
    lines.push(
      `  No mandatory test (settings are the run's configuration, carried in Given): ${details.noContract.length}.`,
    );
  }
  if (details.unapproved > 0) lines.push(`  Left out, not approved: ${details.unapproved} atoms.`);
  lines.push(`  Unenforced: ${summary.unenforcedAtoms.length} approved rules no guard enforces.`);
  lines.push(`  Cells with no approved phrase: ${summary.cellsWithoutPhrase} of ${summary.cells}.`);
  lines.push(`  Edges with no journey: ${summary.edgesWithoutJourney}.`);
  pushListed(
    lines,
    details.uncoveredEdges,
    (edge) => `    ${edge.from} ${edge.kind} ${edge.to}: ${edge.reason}`,
    { summaryOut, key: 'uncoveredEdges' },
  );
  if (details.droppedConstraints > 0) {
    lines.push(`  Dropped ${details.droppedConstraints} constraints that name target atoms of two kinds.`);
  }
  pushListed(lines, details.adjusted, (change) => `  Row ${change.row}: ${change.reason}.`, {
    summaryOut,
    key: 'adjusted',
  });
  pushListed(lines, details.notes, (note) => `  ${note}`, { summaryOut, key: 'notes' });
  lines.push(
    `Next: driftbench estate plan approve ${out} --all, or strike rows with --row <id> --strike`,
    '',
  );
  return lines.join('\n');
}

/** Exit 0 after listing or changing statuses, 1 when the plan is invalid or names no such row, 2 on a usage error. */
export async function estatePlanApproveCommand(
  path: string,
  options: EstatePlanApproveOptions,
  io: Io,
): Promise<number> {
  const file = resolve(io.cwd, path);
  if (!(await exists(file))) {
    io.err(`Cannot find ${show(file, io)}.\n`);
    return 2;
  }
  const rows = options.row ?? [];
  if (options.all && rows.length > 0) {
    io.err('error: --all cannot be used with --row\n');
    return 2;
  }
  if (options.strike && rows.length === 0) {
    io.err('error: --strike needs the rows to strike, named with --row\n');
    return 2;
  }
  const text = await readFile(file, 'utf8');
  const parsed = parsePlanText(text);
  if (!parsed.ok) {
    io.err(`✗ ${show(file, io)}\n${parsed.errors.map(issueLine).join('')}`);
    return 1;
  }
  if (!options.all && rows.length === 0) {
    const counts = { proposed: 0, approved: 0, struck: 0 };
    for (const row of parsed.plan.rows) counts[row.status] += 1;
    io.out(
      `${show(file, io)}: ${parsed.plan.rows.length} rows, ${counts.proposed} proposed, ${counts.approved} approved, ${counts.struck} struck.\nApprove every proposed row with --all, a row with --row <id>, or strike one with --row <id> --strike.\n`,
    );
    return 0;
  }
  const result = approvePlanRows(text, {
    all: options.all === true,
    ids: rows,
    strike: options.strike === true,
  });
  if (!result.ok) {
    io.err(`✗ ${show(file, io)}\n${result.errors.map(issueLine).join('')}`);
    return 1;
  }
  const target = options.out ? resolve(io.cwd, options.out) : file;
  if (!(await writeOut(target, result.text, io))) return 2;
  const verb = options.strike ? 'Struck' : 'Approved';
  const state = options.strike ? 'struck' : 'approved';
  io.out(
    `${verb} ${result.changed.length} ${result.changed.length === 1 ? 'row' : 'rows'} in ${show(target, io)}; ${result.unchanged} ${result.unchanged === 1 ? 'was' : 'were'} already ${state}.\n`,
  );
  return 0;
}

function wholeNumber(value: string, flag: string, io: Io): number | undefined {
  const n = optionNumber(value);
  if (!Number.isInteger(n) || n < 1) {
    io.err(`error: ${flag} takes a whole number of at least 1, not "${value}"\n`);
    return undefined;
  }
  return n;
}

function issueLine(issue: { code: string; path: string; message: string }): string {
  return `  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`;
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

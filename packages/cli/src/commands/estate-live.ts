import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { claudeCodeLiveAdapter, loadStateLibrary, type StateLibrary } from '@agent-nexus/driftbench-adapters';
import {
  blocksOutcome,
  type Campaign,
  contentHash,
  type RunResult,
  runSpec,
  type Store,
} from '@agent-nexus/driftbench-core';
import {
  copyEstate,
  type EstateMap,
  insideCopy,
  loadEstateMap,
  MutantError,
  type MutantResult,
  mutateEstate,
  quoteDrift,
  readerFor,
  renderEstateMap,
} from '@agent-nexus/driftbench-estate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  addJudgeOptions,
  addRunCheckOptions,
  isStandIn,
  type RunCheckFlags,
  type RunJudgeOptions,
  runCheckSettingsFrom,
  runJudgeFrom,
  STAND_IN_MARKER,
} from '../judge-options';
import { optionNumber } from '../number';
import { loadValidSpecs } from './campaign';
import { mapCacheOptions } from './map-cache';
import { replayChecks } from './replay';

export { isStandIn, STAND_IN_MARKER };

/** Adds `estate mutate` and `estate run` to `driftbench estate`. */
export function registerEstateLiveCommands(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('mutate')
    .description('Copy the estate and delete or invert one atom in the copy, for the adequacy of its tests')
    .argument('<map>', 'the approved estate map')
    .requiredOption('--atom <id>', 'the atom to mutate')
    .option('--delete', 'remove the quoted span from its file')
    .option('--invert', 'replace the quote by its negation, by the fixed table of forms')
    .requiredOption(
      '--to <dir>',
      'the folder of the mutant estate (it receives the copy, map.yaml, mutant.json)',
    )
    .option('--force', 'replace an earlier mutant in the folder')
    .option('--json', 'print the result as JSON')
    .action(async (map: string, options: EstateMutateOptions) => {
      setExit(await estateMutateCommand(map, options, io));
    });
  const run = estate
    .command('run')
    .description(
      'Run live estate specs through the runtime headless, in a sandbox holding a copy of the estate',
    )
    .argument('[specs...]', 'the live spec files or folders')
    .option(
      '--order <file>',
      'a run-order file: one spec file or folder per line, from its own folder; # starts a comment',
    )
    .requiredOption('--estate <root>', 'the estate root (or a mutant folder of estate mutate)')
    .requiredOption('--runtime <name>', 'the runtime adapter: claude-code')
    .option('--command <bin>', `the headless command (default ${DEFAULT_RUNTIME_COMMAND})`)
    .requiredOption('--store <db>', 'the store the runs are written to')
    .option('--map <file>', "the estate's approved map: pins the copy to its hash and checks its quotes")
    .option('--states <file>', 'the state library: operations by session state and event')
    .option(
      '--set-env <pair>',
      'a variable the runtime and its hooks receive, NAME=VALUE; repeatable (a path, a proxy, a dead URL)',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option('--disallow <rules...>', 'tools the runtime must refuse, passed as --disallowed-tools')
    .option(
      '--lock-deny <paths...>',
      'paths the runtime and its children may neither read nor write (macOS lock; the owner config in ~/.claude is always write-protected)',
    )
    .option(
      '--pass-env <names...>',
      "names of the evaluator's variables the runtime receives (its credentials)",
    )
    .option('--timeout <ms>', 'kill a turn after this long')
    .option('--model <name>', 'the model the runtime runs (passed as --model)')
    .option('--max-turns <n>', 'the most agent turns per spec block (passed as --max-turns)')
    .option('--max-budget-usd <usd>', 'the most a spec block may spend (passed as --max-budget-usd)')
    .option('--permission-mode <mode>', 'the permission mode of the run (passed as --permission-mode)')
    .option(
      '--trust-estate',
      "allow the tools the estate's settings allow, and Skill, as a trusted folder would",
    )
    .option(
      '--config <where>',
      'the config folder: host (the login lives there) or isolated; default host, isolated for a stand-in',
    )
    .option('--allow-billed', 'run a command that is not a stand-in: a billed live run')
    .option(
      '--progress <file>',
      'append one JSON line per finished spec to this file as each finishes, so a stopped batch keeps them',
    )
    .option('--json', 'print one JSON document');
  addRunCheckOptions(addJudgeOptions(run)).action(async (specs: string[], options: EstateRunOptions) => {
    setExit(await estateRunCommand(specs, options, io));
  });
}

export const DEFAULT_RUNTIME_COMMAND = 'claude';

export type EstateRunOptions = {
  estate: string;
  /** A run-order file: one spec path per line, relative to the file's folder. */
  order?: string;
  runtime: string;
  command?: string;
  store: string;
  map?: string;
  states?: string;
  passEnv?: string[];
  setEnv?: string[];
  disallow?: string[];
  lockDeny?: string[];
  timeout?: string;
  allowBilled?: boolean;
  /** A file that gets one JSON line per finished spec, appended as each spec finishes. */
  progress?: string;
  model?: string;
  maxTurns?: string;
  maxBudgetUsd?: string;
  permissionMode?: string;
  trustEstate?: boolean;
  config?: string;
  json?: boolean;
} & RunJudgeOptions &
  RunCheckFlags;

export type RunLine = {
  spec: string;
  runId: string;
  status: RunResult['status'];
  pass: boolean;
  /**
   * True when only inconclusive checks keep the spec from passing (no stage feed, no judge): the run could
   * not decide it. It still counts as not passed; `undecided` counts these apart from the specs that fail.
   */
  undecided: boolean;
  /**
   * True when only not-applicable checks keep the spec from passing (no stage record): the run has nothing
   * the check could judge. It is left out of the decided count and counted apart (`notApplicable`).
   */
  notApplicable: boolean;
  /** Set when no block failed but a block was not run or blocked: neither a pass nor a fail, counted apart. */
  outcome?: 'not_run' | 'blocked';
  failing: string[];
  costUsd: number | null;
  /** What the judge spent on this spec, included in costUsd. */
  judgeCostUsd: number;
  /** The judge verdicts of the spec: criterion and outcome. */
  judged: Array<{ criterion: string; outcome: string }>;
  error?: string;
};

/**
 * Exit 0 when every spec passes, 1 when one fails, 2 on a usage or input error (nothing runs): an unknown
 * runtime, an estate that is not a folder or drifted from its map, invalid specs, a billed command without
 * --allow-billed.
 *
 * The command is billed unless it is a file that carries the stand-in marker in its first lines: without
 * --allow-billed only a stand-in runs (the sizing card rule: a billed run waits for its card). The copy is
 * pinned to the map's hash with --map, to the original and the mutant hash in a mutant folder, and left
 * unpinned otherwise (a note says so). Each spec runs once, in mode F, through the runner with the default
 * checks and the ordered-pair check; judged criteria are not run. The cost of a run is what the stream's
 * result records say.
 */
export async function estateRunCommand(
  specPaths: string[],
  options: EstateRunOptions,
  io: Io,
): Promise<number> {
  if (options.runtime !== 'claude-code') {
    io.err(`--runtime ${options.runtime} is not supported; the live runner exists for claude-code.\n`);
    return 2;
  }
  let paths = [...specPaths];
  if (options.order !== undefined) {
    const orderPath = resolve(io.cwd, options.order);
    const text = await readFile(orderPath, 'utf8').catch(() => undefined);
    if (text === undefined) {
      io.err(`The run-order file ${options.order} cannot be read.\n`);
      return 2;
    }
    const listed = text
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter((line) => line !== '')
      .map((line) => resolve(dirname(orderPath), line));
    paths = [...paths, ...listed];
  }
  if (paths.length === 0) {
    io.err('Name the specs to run: spec files or folders, or --order <file>.\n');
    return 2;
  }
  const root = resolve(io.cwd, options.estate);
  if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
    io.err(`The estate ${options.estate} is not a folder.\n`);
    return 2;
  }
  const command = options.command ?? DEFAULT_RUNTIME_COMMAND;
  const commandPath = command.includes('/') ? resolve(io.cwd, command) : command;
  const standIn = await isStandIn(commandPath);
  if (!standIn && !options.allowBilled) {
    io.err(
      `${command} is not a stand-in: a live run of the real runtime is billed. Size it first, then pass --allow-billed.\n`,
    );
    return 2;
  }
  let timeoutMs: number | undefined;
  if (options.timeout !== undefined) {
    timeoutMs = optionNumber(options.timeout);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      io.err(`--timeout is a whole number of milliseconds, got "${options.timeout}".\n`);
      return 2;
    }
  }

  const args: string[] = [];
  if (options.model !== undefined) args.push('--model', options.model);
  if (options.maxTurns !== undefined) {
    if (!/^[1-9]\d*$/.test(options.maxTurns)) {
      io.err(`--max-turns is a whole number of at least 1, got "${options.maxTurns}".\n`);
      return 2;
    }
    args.push('--max-turns', options.maxTurns);
  }
  if (options.maxBudgetUsd !== undefined) {
    const value = optionNumber(options.maxBudgetUsd);
    if (!Number.isFinite(value) || value <= 0) {
      io.err(`--max-budget-usd is a positive amount, got "${options.maxBudgetUsd}".\n`);
      return 2;
    }
    args.push('--max-budget-usd', options.maxBudgetUsd);
  }
  if (options.permissionMode !== undefined) args.push('--permission-mode', options.permissionMode);
  if (options.config !== undefined && options.config !== 'host' && options.config !== 'isolated') {
    io.err(`--config is host or isolated, got "${options.config}".\n`);
    return 2;
  }
  const config = (options.config ?? (standIn ? 'isolated' : 'host')) as 'host' | 'isolated';
  const settings = await runCheckSettingsFrom(options, io);
  if (!settings) return 2;
  const judge = await runJudgeFrom(options, io);
  if (!judge) return 2;

  const notes: string[] = [];
  let pins: string[] = [];
  let mapIgnore: readonly string[] = [];
  if (options.map !== undefined) {
    const loaded = await loadEstateMap(resolve(io.cwd, options.map), mapCacheOptions());
    if (!loaded.ok) {
      io.err(`The map ${options.map} is not valid:\n`);
      for (const issue of loaded.errors)
        io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
      return 2;
    }
    const drift = await driftOf(root, loaded.map);
    if (drift.length > 0) {
      io.err(`The estate ${options.estate} does not match the map ${options.map}:\n`);
      for (const message of drift.slice(0, 10)) io.err(`    ${message}\n`);
      return 2;
    }
    pins = [loaded.map.hash];
    mapIgnore = loaded.map.ignore ?? [];
    // A mutant folder with its own map: the specs were generated from the original, so its hash stays a
    // pin beside the mutant's (as without --map); a spec of any other map still fails.
    const mutant = await readMutant(root);
    if (mutant !== undefined && mutant.mapHash === loaded.map.hash) {
      pins = [mutant.originalMapHash, mutant.mapHash];
      notes.push(
        `mutant of ${mutant.atom} (${mutant.op}): specs of the map ${mutant.originalMapHash.slice(0, 12)} run on it`,
      );
    }
  } else {
    const mutant = await readMutant(root);
    if (mutant !== undefined) {
      pins = [mutant.originalMapHash, mutant.mapHash];
      notes.push(
        `mutant of ${mutant.atom} (${mutant.op}): specs of the map ${mutant.originalMapHash.slice(0, 12)} run on it`,
      );
    } else notes.push('the estate copy is not pinned to a map hash; pass --map to pin it');
  }

  let library: StateLibrary | undefined;
  if (options.states !== undefined) {
    try {
      library = await loadStateLibrary(resolve(io.cwd, options.states));
    } catch (cause) {
      io.err(`The state library ${options.states} cannot be read: ${describe(cause)}\n`);
      return 2;
    }
  }
  const env: Record<string, string> = {};
  for (const pair of options.setEnv ?? []) {
    const at = pair.indexOf('=');
    if (at <= 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(pair.slice(0, at))) {
      io.err(`--set-env takes NAME=VALUE, got "${pair.split('=')[0]}".\n`);
      return 2;
    }
    env[pair.slice(0, at)] = pair.slice(at + 1);
  }
  for (const name of options.passEnv ?? []) {
    const value = process.env[name];
    if (value === undefined) notes.push(`${name} is not set; the runtime runs without it`);
    else env[name] = value;
  }

  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const specs = loaded.filter((entry) => {
    const adapter = entry.spec.target?.adapter;
    if (adapter !== undefined && adapter !== 'claude-code') {
      notes.push(`${entry.spec.id} targets ${adapter}; skipped`);
      return false;
    }
    if (
      judge.label === 'none' &&
      (entry.spec.criteria?.length || entry.spec.blocks.some((block) => block.expect?.criteria?.length))
    ) {
      notes.push(
        `${entry.spec.id}: no judge, so its judged criteria are inconclusive (pass --judge claude:<model>)`,
      );
    }
    return true;
  });
  if (specs.length === 0) {
    io.err('No spec targets the claude-code runtime: nothing ran.\n');
    return 2;
  }

  let store: Store;
  const storePath = resolve(io.cwd, options.store);
  const progressPath = options.progress === undefined ? undefined : resolve(io.cwd, options.progress);
  try {
    store = await openStore(storePath);
  } catch (cause) {
    io.err(`Cannot open the store at ${storePath}: ${describe(cause)}\n`);
    return 2;
  }
  const lines: RunLine[] = [];
  let campaignId: string;
  try {
    const createdAt = new Date().toISOString();
    const target = { adapter: 'claude-code', agent: pins[pins.length - 1]?.slice(0, 12) ?? 'unpinned' };
    const entries = specs.map((entry) => ({ id: entry.spec.id, hash: entry.hash }));
    campaignId = `estate-run-${contentHash({ entries, target, command, createdAt })}`;
    for (const entry of specs) await store.putSpec(entry);
    const campaign: Campaign = {
      campaignId,
      specs: entries,
      targets: [target],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: judge.mode, judges: judge.judges },
      createdAt,
    };
    await store.putCampaign(campaign);
    const checks = replayChecks({
      judge: judge.check,
      piiJudge: judge.piiJudge,
      ...(settings.piiOwner.length > 0 ? { piiOwner: settings.piiOwner } : {}),
      ...(settings.toolPolicy ? { toolPolicy: settings.toolPolicy } : {}),
      ...(settings.embedder ? { embedder: settings.embedder } : {}),
    });
    // The files a run copies, listed once for every spec: what the runtime may load, never an ignored folder
    // (node_modules, test runs), which made each spec's copy as large as the whole estate folder.
    const lister = readerFor(options.runtime, { ignore: mapIgnore });
    const estateFiles = lister?.listFiles ? await lister.listFiles(root) : undefined;
    for (const entry of specs) {
      const adapter = claudeCodeLiveAdapter({
        command: commandPath,
        estateRoot: root,
        ...(estateFiles === undefined ? {} : { estateFiles }),
        provider: localProvider(),
        pins,
        ...(library === undefined ? {} : { library }),
        env,
        args,
        config,
        ...(options.trustEstate ? { trustEstate: true } : {}),
        ...(options.disallow?.length ? { disallowedTools: options.disallow } : {}),
        ...(options.lockDeny?.length
          ? { lock: { deny: options.lockDeny.map((path) => resolve(io.cwd, path)) } }
          : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(standIn ? { retries: { backoffMs: 0 } } : {}),
      });
      const spentBefore = judge.spend.usd;
      const result = await runSpec(entry.spec, {
        adapter,
        driver: createScriptedDriver(),
        checks,
        ...(settings.toolPolicy ? { toolPolicy: settings.toolPolicy } : {}),
        mode: 'F',
        repeat: 0,
        target,
        store,
        campaignId,
      });
      const line = lineOf(result, judge.spend.usd - spentBefore);
      lines.push(line);
      if (progressPath !== undefined) await appendFile(progressPath, `${JSON.stringify(line)}\n`);
    }
  } catch (cause) {
    io.err(`The live run stopped: ${describe(cause)}\n`);
    await store.close().catch(() => undefined);
    return 2;
  }
  await store.close();
  await judge.save();

  const passed = lines.filter((line) => line.pass).length;
  const undecided = lines.filter((line) => line.undecided).length;
  const notApplicable = lines.filter((line) => line.notApplicable).length;
  const unscored = lines.filter((line) => line.outcome !== undefined).length;
  const failed = lines.length - passed - notApplicable - unscored;
  const costs = lines.map((line) => line.costUsd).filter((cost): cost is number => cost !== null);
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  if (options.json) {
    io.out(
      `${JSON.stringify({ campaignId, store: storePath, standIn, pins, notes, judge: judge.label, judgeCostUsd: judge.spend.usd, runs: lines, passed, failed, undecided, notApplicable, ...(unscored > 0 ? { notRun: unscored } : {}), costUsd: total }, null, 2)}\n`,
    );
  } else {
    for (const note of notes) io.out(`note: ${note}\n`);
    for (const line of lines) {
      const mark =
        line.status !== 'completed'
          ? '!'
          : line.pass
            ? '✓'
            : line.undecided || line.notApplicable
              ? '?'
              : line.outcome
                ? '-'
                : '✗';
      const cost = line.costUsd === null ? 'no cost in the stream' : `${line.costUsd.toFixed(4)} USD`;
      io.out(`${mark} ${line.spec}  (${cost})\n`);
      if (line.error) io.out(`    error: ${line.error}\n`);
      if (line.failing.length > 0) io.out(`    failing: ${line.failing.join(', ')}\n`);
      for (const verdict of line.judged) io.out(`    judged ${verdict.criterion}: ${verdict.outcome}\n`);
    }
    io.out(
      `${lines.length} spec${lines.length === 1 ? '' : 's'} run live${standIn ? ' on a stand-in' : ''}: ${passed} pass, ${failed} fail${undecided > 0 ? ` (${undecided} undecided: only inconclusive checks)` : ''}${notApplicable > 0 ? ` (${notApplicable} not applicable: no stage record)` : ''}${unscored > 0 ? `, ${unscored} not run or blocked` : ''}. Cost ${total.toFixed(4)} USD over ${costs.length} run${costs.length === 1 ? '' : 's'} that report one, judge ${judge.label} ${judge.spend.usd.toFixed(4)} USD of it. Campaign ${campaignId}.\n`,
    );
  }
  return passed === lines.length ? 0 : 1;
}

/** The line of one run: pass, undecided (only inconclusive checks), the failing checks and the cost. */
export function lineOf(run: RunResult, judgeCostUsd: number): RunLine {
  const failing = run.blocks.flatMap((block) =>
    block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map(
        (verdict) =>
          `block ${block.index}: ${verdict.id}${verdict.outcome === 'inconclusive' ? ' (inconclusive)' : ''}`,
      ),
  );
  const reported = run.blocks.filter((block) => block.observed.cost.usd !== undefined);
  const outcome = blocksOutcome(run);
  const pass = outcome === 'pass';
  const gating = run.blocks.flatMap((block) =>
    block.verdicts.filter((verdict) => verdict.gating && verdict.outcome !== 'pass'),
  );
  const settled = run.status === 'completed' && run.endState?.match !== false;
  return {
    spec: run.specId,
    runId: run.runId,
    status: run.status,
    pass,
    ...(outcome === 'not_run' || outcome === 'blocked' ? { outcome } : {}),
    undecided:
      !pass && settled && gating.length > 0 && gating.every((verdict) => verdict.outcome === 'inconclusive'),
    notApplicable:
      !pass &&
      settled &&
      gating.length > 0 &&
      gating.every((verdict) => verdict.outcome === 'not_applicable'),
    failing: [
      ...failing,
      ...run.blocks.flatMap((block) =>
        block.notRun
          ? [`block ${block.index}: not run (${block.notRun.check}: ${block.notRun.got})`]
          : block.blocked
            ? [`block ${block.index}: blocked by ${block.blocked.by}`]
            : [],
      ),
    ],
    costUsd:
      reported.length === 0 && judgeCostUsd === 0
        ? null
        : reported.reduce((sum, block) => sum + (block.observed.cost.usd ?? 0), 0) + judgeCostUsd,
    judgeCostUsd,
    judged: run.blocks.flatMap((block) =>
      block.verdicts
        .filter((verdict) => verdict.kind === 'judge')
        .map((verdict) => ({ criterion: verdict.name, outcome: verdict.outcome })),
    ),
    ...(run.error === undefined ? {} : { error: run.error }),
  };
}

async function readMutant(root: string): Promise<MutantRecord | undefined> {
  const text = await readFile(join(root, MUTANT_FILE), 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  const record = JSON.parse(text) as MutantRecord;
  return typeof record.originalMapHash === 'string' && typeof record.mapHash === 'string'
    ? record
    : undefined;
}

export type EstateMutateOptions = {
  atom: string;
  delete?: boolean;
  invert?: boolean;
  to: string;
  force?: boolean;
  json?: boolean;
};

/** The file a mutant folder carries beside its estate copy, naming what was mutated and from which map. */
export const MUTANT_FILE = 'mutant.json';
export const MUTANT_MAP_FILE = 'map.yaml';

export type MutantRecord = {
  atom: string;
  op: 'delete' | 'invert';
  file: string;
  before: string;
  after: string;
  originalMapHash: string;
  mapHash: string;
  collateral: string[];
};

/**
 * Exit 0 when the mutant is written, 2 on a usage or input error (nothing is written): an invalid map, an
 * estate whose quotes drifted from the map, an unknown atom, a quote the table cannot invert, a folder that
 * is not empty without --force.
 */
export async function estateMutateCommand(
  mapArg: string,
  options: EstateMutateOptions,
  io: Io,
): Promise<number> {
  if (Boolean(options.delete) === Boolean(options.invert)) {
    io.err('Name one mutation: --delete or --invert.\n');
    return 2;
  }
  const mapPath = resolve(io.cwd, mapArg);
  const loaded = await loadEstateMap(mapPath, mapCacheOptions());
  if (!loaded.ok) {
    io.err(`The map ${mapArg} is not valid:\n`);
    for (const issue of loaded.errors)
      io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
    return 2;
  }
  const map = loaded.map;
  const root = resolve(dirname(mapPath), map.root);
  const drift = await driftOf(root, map);
  if (drift.length > 0) {
    io.err(`The estate at ${root} no longer matches the map; scan it again first:\n`);
    for (const message of drift.slice(0, 10)) io.err(`    ${message}\n`);
    return 2;
  }
  if (!map.atoms.some((atom) => atom.id === options.atom)) {
    io.err(`Atom ${options.atom} is not in the map.\n`);
    return 2;
  }
  const to = resolve(io.cwd, options.to);
  const existing = await readdir(to).catch(() => undefined);
  if (existing !== undefined && existing.length > 0) {
    if (!options.force) {
      io.err(`${options.to} is not empty; pass --force to replace an earlier mutant.\n`);
      return 2;
    }
    if (!existing.includes(MUTANT_FILE)) {
      io.err(`${options.to} holds no ${MUTANT_FILE}; --force replaces a mutant folder only.\n`);
      return 2;
    }
    await rm(to, { recursive: true, force: true });
  }
  await mkdir(to, { recursive: true });
  let result: MutantResult;
  try {
    await copyEstate(root, to, map);
    result = await mutateEstate(
      { root: to, map },
      options.delete ? { delete: options.atom } : { invert: options.atom },
    );
  } catch (cause) {
    await rm(to, { recursive: true, force: true });
    io.err(`${cause instanceof MutantError ? '' : 'The mutant could not be made: '}${describe(cause)}\n`);
    return 2;
  }
  const record: MutantRecord = {
    atom: result.atom,
    op: result.op,
    file: result.file,
    before: result.before,
    after: result.after,
    originalMapHash: result.originalMapHash,
    mapHash: result.mapHash,
    collateral: result.collateral,
  };
  // The record and the map go beside the copy, never through a link out of it.
  await writeFile(await insideCopy(to, MUTANT_FILE), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(await insideCopy(to, MUTANT_MAP_FILE), renderEstateMap({ ...result.map, root: '.' }));
  if (options.json) io.out(`${JSON.stringify(record, null, 2)}\n`);
  else {
    io.out(`Mutant: ${result.op} ${result.atom} in ${result.file}.\n`);
    io.out(`  before: ${result.before}\n`);
    io.out(`  after:  ${result.after === '' ? '(the line is gone)' : result.after}\n`);
    io.out(`  map ${result.originalMapHash.slice(0, 12)} -> ${result.mapHash.slice(0, 12)}\n`);
    if (result.collateral.length > 0) io.out(`  collateral: ${result.collateral.join(', ')}\n`);
    io.out(`Wrote ${options.to}: the estate copy, ${MUTANT_MAP_FILE} and ${MUTANT_FILE}.\n`);
  }
  return 0;
}

/** The atoms whose quote is not at its span in the estate, as messages. */
export async function driftOf(root: string, map: EstateMap): Promise<string[]> {
  const texts = new Map<string, string>();
  for (const file of new Set(map.atoms.map((atom) => atom.provenance.file))) {
    // A file that resolves outside the estate counts as absent: it is never read.
    const text = await insideCopy(root, file)
      .then((safe) => readFile(safe, 'utf8'))
      .catch(() => undefined);
    if (text !== undefined) texts.set(file, text);
  }
  if ((await stat(root).catch(() => undefined)) === undefined) return [`${root} does not exist`];
  return quoteDrift(map.atoms, texts).map((issue) => issue.message);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

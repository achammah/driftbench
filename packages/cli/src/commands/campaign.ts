import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { functionAdapter, processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { classifyTool, defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type ArtifactReaderRegistry,
  auditBound,
  auditSample,
  auditVerdict,
  type BlockReuse,
  blockStatus,
  type Campaign,
  type CampaignPlan,
  type CellOutcome,
  type CheckSet,
  type CompoundingIndex,
  type CostLine,
  type CostUnit,
  campaignRadius,
  canonicalJson,
  carryRuns,
  completeBaselineProvenance,
  compoundingIndex,
  contentHash,
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_MAX_CARRY,
  type DriftClass,
  isScored,
  type LoadedSpec,
  loadSpecs,
  type MinimumDetectableEffect,
  mdeLine,
  outcomeOf,
  type PlannedCell,
  type PlanOptions,
  parseCriterionRef,
  planCampaign,
  planRadiusCampaign,
  preflightTargetPrices,
  type RadiusPlan,
  type RegistrySource,
  type RetryOptions,
  RunMode,
  type RunOptions,
  type RunResult,
  radiusOf,
  runCampaign,
  runProvenance,
  runsByCell,
  type Spec,
  type Store,
  type TargetPrompt,
  TargetRef,
  TokenPriceError,
  type TokenPrices,
  type ToolRule,
  type UserDriver,
  withAgentVersion,
} from '@agent-nexus/driftbench-core';
import { portFromEnv } from '@agent-nexus/driftbench-generate';
import { textTable as table } from '@agent-nexus/driftbench-report';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { bootstrapCI } from '@agent-nexus/driftbench-stats';
import {
  openMemoryStore,
  openStore,
  parseVersionRef,
  readCampaignBundle,
  restoreFiles,
  type SqliteStore,
  StoreError,
} from '@agent-nexus/driftbench-store';
import {
  createPerturbingDriver,
  createScriptedDriver,
  type UserModelPort,
} from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import { ACME_EXAMPLE_ABSENT, acmeExample, acmeExampleInstalled, requireAcmeExample } from '../acme-example';
import { applyCampaignConfig } from '../campaign-config';
import type { Io } from '../io';
import {
  addJudgeOptions,
  addRunCheckOptions,
  type JudgeFlags,
  optionalJudgeFrom,
  type RunCheckFlags,
  type RunJudge,
  runCheckSettingsFrom,
  withRunChecks,
} from '../judge-options';
import { optionNumber } from '../number';
import { pluginAdapter, pluginAdapterNames } from '../plugins';
import { makeScopeFolder } from '../scope-folder';
import { noStoreAt } from '../store-path';
import { BUILTIN_TARGETS_NOTE, builtinTarget, builtinTargetHint } from '../targets';
import { pricesFromConfig } from '../token-prices';
import { carriedBlocksAgree, planCellBlockReruns } from './campaign-blocks';
import { campaignProvenance } from './campaign-provenance';
import { registerCampaignRejudge } from './campaign-rejudge';
import { gateExit } from './gate-exit';
import { agentFamilyOf, describeSource, loadPersonas, portFor, userFactory, userSource } from './personas';
import { loadRadiusChangeManifest } from './radius-change';

/** What lives as long as one campaign: a temporary folder for its sandboxes, made on first use. */
export type CampaignScope = {
  /** The campaign's temporary folder. The CLI removes it, and all it holds, when the campaign closes. */
  tempDir(): Promise<string>;
};

/** What the campaign and smoke commands run with. Tests pass their own. */
export type CampaignDeps = {
  /**
   * The adapter for a target, or undefined when this build has none for it. An adapter that makes
   * sandboxes puts them in `scope.tempDir()` when a scope is given.
   */
  adapterFor(target: TargetRef, scope?: CampaignScope): Promise<AgentAdapter | undefined>;
  /** The machine checks applied to every block. */
  checks: CheckSet;
  /** The readers the artifact checks open produced files with. */
  artifacts?: ArtifactReaderRegistry;
  /**
   * A fresh driver for one run: in mode P, one that injects the cell's perturbation into the spec it runs.
   * Without a cell, the scripted driver.
   */
  driver(cell?: PlannedCell, spec?: Spec): UserDriver;
  /** Tools whose call is a consequential act, for the recovery metrics of mode P. */
  consequential?: (label: string) => boolean;
  /**
   * The model port a simulated user speaks through with --model. Default: the port the environment
   * configures (portFromEnv of @agent-nexus/driftbench-generate). Tests pass a fake one.
   */
  modelPort?(): UserModelPort;
  /** The store at a path, or one held in memory without a path. A failure to open is reported, exit 2. */
  openStore(path: string | undefined): Promise<Store>;
  now(): Date;
};

const MODE_HELP =
  'the run mode: T teacher-forced, F free-running, P perturbed; several separated by commas, such as T,F';

const CONFIG_HELP =
  'the project config whose campaign: settings apply where no flag is given; default driftbench.yaml in the working folder';
const TARGET_HELP =
  'run every spec on this target (but the specs a --route marks); repeat for several. Without it, each spec runs on its own target';

const ROUTE_HELP =
  'with --target: run the specs a tag marks on this target instead, such as flow:price-sheet=process:acme-ops; repeat for several';

const PROCESS_COMMAND_HELP =
  'the agent command for a process target other than process:acme-ops: a JSON list such as ["python3","/path/to/agent.py"], or words split on spaces; it runs in the sandbox workspace, so give absolute paths';

/**
 * `--process-command`: a JSON list of strings, or a command line split on spaces (no quoting). Undefined
 * when the text is neither.
 */
export function parseProcessCommand(text: string): string[] | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((part) => typeof part === 'string' && part !== '')
      ) {
        return parsed as string[];
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  const words = trimmed.split(/\s+/).filter((word) => word !== '');
  return words.length > 0 ? words : undefined;
}

/**
 * The deps with every process target other than process:acme-ops reaching `command` through the process
 * adapter, in a local sandbox. Any agent name works: `process:<name>` names the agent, the command runs it.
 */
export function withProcessCommand(deps: CampaignDeps, command: readonly string[]): CampaignDeps {
  const [binary, ...args] = command;
  return {
    ...deps,
    adapterFor: async (target, scope) => {
      if (target.adapter !== 'process' || target.agent === 'acme-ops' || binary === undefined) {
        return deps.adapterFor(target, scope);
      }
      return processAdapter({
        command: binary,
        args,
        provider: localProvider(scope === undefined ? {} : { dir: await scope.tempDir() }),
      });
    },
  };
}

/** Applies `--process-command` to the deps; undefined, with the reason printed, when it is malformed. */
function processDeps(deps: CampaignDeps, text: string | undefined, io: Io): CampaignDeps | undefined {
  if (text === undefined) return deps;
  const command = parseProcessCommand(text);
  if (command === undefined) {
    io.err(
      `--process-command takes a JSON list of strings or a command line, not ${JSON.stringify(text)}.\n`,
    );
    return undefined;
  }
  const stranded = strandedFiles(command, io.cwd);
  if (stranded.length > 0) {
    const [first = ''] = stranded;
    const is = stranded.length === 1 ? 'is a file' : 'are files';
    io.err(
      `Note: --process-command runs in the workspace of each sandbox, a temporary folder, not in the working folder. ${stranded.join(', ')} ${is} of the working folder, which the sandbox does not hold unless a spec seeds it: give the absolute path, ${JSON.stringify(resolve(io.cwd, first))}.\n`,
    );
  }
  return withProcessCommand(deps, command);
}

/**
 * The words of a process command that name a file of the working folder by a relative path. The command
 * runs in the sandbox's workspace, where such a path finds nothing unless a spec seeds the same file. A
 * binary without a slash is looked up on the PATH, so it is not one of them.
 */
function strandedFiles(command: readonly string[], cwd: string): string[] {
  return command.filter((word, index) => {
    if (isAbsolute(word) || (index === 0 && !word.includes('/'))) return false;
    try {
      return statSync(resolve(cwd, word)).isFile();
    } catch {
      return false;
    }
  });
}

/** The targets a checkout reaches, for the message of a target it does not. */
const KNOWN_TARGETS =
  'The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent.';

/** What an install without the Acme example reaches. */
const REACHABLE_WITHOUT_EXAMPLE =
  'This install reaches a process target through --process-command: process:<name> runs the command you give.';

/**
 * The sentence of a refusal that says which targets this install reaches. With the Acme example installed,
 * as in a checkout, the example's targets; without it, that the example is absent and where it lives, and
 * only what really is reachable.
 */
export function knownTargets(exampleInstalled: boolean = acmeExampleInstalled()): string {
  return exampleInstalled ? KNOWN_TARGETS : `${ACME_EXAMPLE_ABSENT} ${REACHABLE_WITHOUT_EXAMPLE}`;
}

/**
 * What the commands run with. `function:acme-sales`, the target the Acme conversation specs name, and its
 * short form `function:acme` are the Acme sales assistant behind the function adapter of
 * @agent-nexus/driftbench-adapters. `process:acme-ops`, the target of the Acme task spec, is the Acme ops agent behind
 * the process adapter. The checks are `defaultChecks()` of @agent-nexus/driftbench-checks with the readers of
 * @agent-nexus/driftbench-artifacts, and the store is @agent-nexus/driftbench-store, a SQLite file with `--store` and in memory
 * without it.
 */
export const defaultDeps: CampaignDeps = {
  adapterFor: async (target, scope) => {
    if (target.adapter === 'function' && (target.agent === 'acme' || target.agent === 'acme-sales')) {
      return (await acmeExample()) === undefined ? undefined : acmeFunctionAdapter();
    }
    if (target.adapter === 'process' && target.agent === 'acme-ops') return acmeOpsAdapter(scope);
    const plugged = await pluginAdapter(target, scope);
    if (plugged !== undefined) return plugged;
    const builtin = builtinTarget(target);
    return builtin !== undefined && 'adapter' in builtin ? builtin.adapter : undefined;
  },
  checks: defaultChecks(),
  artifacts: defaultReaders(),
  driver: (cell, spec) => {
    if (cell?.perturbationId === undefined) return createScriptedDriver();
    if (spec === undefined) {
      throw new Error(`campaign: the perturbed cell ${cell.cellId} needs its spec for the perturbing driver`);
    }
    return createPerturbingDriver({ spec, perturbation: cell.perturbationId });
  },
  consequential: (label) => classifyTool(label) !== undefined,
  openStore: async (path) => (path === undefined ? openMemoryStore() : openStore(path)),
  now: () => new Date(),
};

type PlanCommandOptions = {
  config?: string;
  target: string[];
  route?: string[];
  mode: string;
  repeats: string;
  budgetUsd?: string;
  baselineRate: string;
  rho?: string;
  store?: string;
  json?: boolean;
};

type RunCommandOptions = {
  prices?: string;
  config?: string;
  dataset?: string;
  cacheSuite?: string;
  prompt?: string[];
  target: string[];
  route?: string[];
  mode: string;
  repeats: string;
  campaign?: string;
  agentVersion?: string;
  change?: string;
  from?: string;
  audit?: string;
  auditSeed?: string;
  maxCarry?: string;
  maxAge?: string;
  blockReruns?: boolean;
  recordEndStateSnapshots?: boolean;
  recordRealizedText?: boolean;
  store?: string;
  cache: boolean;
  concurrency: string;
  budgetUsd?: string;
  processCommand?: string;
  json?: boolean;
  driver?: string;
  persona?: string[];
  recording?: string[];
  model?: boolean;
  agentFamily?: string;
  judgeFamily?: string[];
} & RetryFlags &
  JudgeFlags &
  RunCheckFlags;

/** The retry flags of `campaign run` and `campaign resume`: the run's settings over the spec target's. */
type RetryFlags = { retryAttempts?: string; retryBaseMs?: string; retryMaxMs?: string };

type StoredCommandOptions = RetryFlags &
  JudgeFlags &
  RunCheckFlags & {
    prices?: string;
    config?: string;
    store: string;
    cache?: boolean;
    cacheSuite?: string;
    concurrency?: string;
    budgetUsd?: string;
    processCommand?: string;
    json?: boolean;
    detail?: boolean;
  };

export function registerCampaignCommands(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  const campaign = program
    .command('campaign')
    .description('Plan and run campaigns: specs x targets x modes x repeats.');
  registerCampaignRejudge(campaign, io, setExit);

  campaign
    .command('plan')
    .description('Expand the cells, project their cost and print the minimum detectable effect.')
    .argument('<paths...>', 'spec files or folders')
    .option('--target <adapter[:agent]>', TARGET_HELP, collect, [])
    .option('--route <tag=target>', ROUTE_HELP, collect, [])
    .option('--mode <modes>', MODE_HELP, 'F')
    .option('--repeats <n>', 'runs per spec, target and mode', '1')
    .option('--budget-usd <usd>', 'compare the projected cost with this budget')
    .option('--baseline-rate <rate>', 'the pass rate the minimum detectable effect assumes', '0.5')
    .option('--rho <rho>', 'the correlation of repeats of one spec, as icc measures it, from 0 to 1', '0')
    .option('--store <file>', 'read the measured unit costs from this store')
    .option('--json', 'print one JSON document')
    .option('--config <file>', CONFIG_HELP)
    .action(async (paths: string[], options: PlanCommandOptions, command: Command) => {
      if ((await applyCampaignConfig(command, options, io)) === false) return setExit(2);
      setExit(await campaignPlanCommand(paths, options, io, deps));
    });

  const run = campaign
    .command('run')
    .description(
      'Run every cell and print pass or fail per cell. Exit 1 on any failed or failing cell, 3 when none failed but a cell was not run.',
    )
    .argument('[paths...]', 'spec files or folders; none when --dataset gives the specs')
    .option('--dataset <name[@version]>', 'run the specs of this dataset version of the store, and record it')
    .option(
      '--prompt <name[@version]>',
      'run with and record one prompt version of the store; give it once',
      collect,
      [],
    )
    .option('--target <adapter[:agent]>', TARGET_HELP, collect, [])
    .option('--route <tag=target>', ROUTE_HELP, collect, [])
    .option('--mode <modes>', MODE_HELP, 'F')
    .option('--repeats <n>', 'runs per spec, target and mode', '1')
    .option(
      '--agent-version <label>',
      'the agent version in every block cache key; also the variant of targets that name none',
    )
    .option(
      '--change <manifest>',
      'run only the blast radius of this change manifest and carry the stored runs of the other cells; with --from',
    )
    .option('--from <campaign>', 'with --change: the stored campaign the carried runs are read from')
    .option(
      '--audit <n>',
      'with --change: run n of the cells about to be carried and compare each with its stored run; one miss carries nothing',
    )
    .option('--audit-seed <n>', 'with --audit: the seed of the draw (default 1)')
    .option(
      '--max-carry <n>',
      `with --change: the most campaigns in a row a result is carried (default ${DEFAULT_MAX_CARRY})`,
    )
    .option(
      '--max-age <days>',
      `with --change: the most days since a carried result was measured (default ${DEFAULT_MAX_AGE_DAYS})`,
    )
    .option(
      '--block-reruns',
      'with --change: in mode T, send only the blocks of a cell the change can affect and keep the other stored blocks',
    )
    .option(
      '--record-end-state-snapshots',
      'store the raw end-state values each mode T block reads, so a later --block-reruns can recompose them; they may hold sensitive data',
    )
    .option(
      '--record-realized-text',
      'store the text a driver sent where it differs from the spec (a simulated user, a red-team attacker), not only its hash; it may hold private data',
    )
    .option('--campaign <id>', 'the campaign id; one is made from the content and the clock without it')
    .option('--store <file>', 'keep the campaign, its runs and the cache in this store')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option(
      '--cache-suite <name>',
      'the cache suite of this campaign: a new name starts from an empty cache, the old entries stay',
    )
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--budget-usd <usd>', 'a hard stop: no cell starts once the campaign has spent this much')
    .option('--prices <file>', 'dated USD token prices; default prices in driftbench.yaml')
    .option('--process-command <command>', PROCESS_COMMAND_HELP)
    .option(
      '--driver <driver>',
      "who writes the user turns: scripted (the spec's own) or simulated (a persona)",
      'scripted',
    )
    .option(
      '--persona <file>',
      'with --driver simulated: a persona, which plays the spec its file names; repeat it',
      collect,
      [],
    )
    .option(
      '--recording <file>',
      'with --driver simulated: replay the answers of a recording; repeat it',
      collect,
      [],
    )
    .option(
      '--model',
      'with --driver simulated: speak through the model port the environment configures (paid)',
    )
    .option(
      '--agent-family <family>',
      'the model family of the agent under test; none for an agent that is not a model',
    )
    .option('--judge-family <family>', 'a model family of the judges; repeat it', collect, [])
    .option(
      '--retry-attempts <n>',
      'attempts per model call, from 1 to 20, the first included; over the spec target retry (default 4)',
    )
    .option(
      '--retry-base-ms <ms>',
      'the wait before the first retry, doubled for each later one (default 500)',
    )
    .option('--retry-max-ms <ms>', 'the longest wait between two attempts (default 30000)')
    .option('--json', 'print one JSON document')
    .option('--config <file>', CONFIG_HELP);
  addRunCheckOptions(addJudgeOptions(run, { agentFamily: false })).action(
    async (paths: string[], options: RunCommandOptions, command: Command) => {
      const config = await applyCampaignConfig(command, options, io);
      if (config === false) return setExit(2);
      // What to run comes from one place: the command line when it names paths or --dataset, else the file.
      const named = paths.length > 0 || command.getOptionValueSource('dataset') === 'cli';
      if (named && command.getOptionValueSource('dataset') !== 'cli') options.dataset = undefined;
      setExit(await campaignRunCommand(named ? paths : (config?.specs ?? []), options, io, deps));
    },
  );

  const resume = campaign
    .command('resume')
    .description(
      'Run the cells of a stored campaign that have no completed run; reuse the others. Each cell runs on the target the campaign pinned for it.',
    )
    .argument('[campaignId]', 'the campaign id; the latest campaign of the store without it')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option('--cache-suite <name>', 'the cache suite to use for the unfinished cells')
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--budget-usd <usd>', "a hard stop on the campaign's spend; default: the budget it was run with")
    .option('--prices <file>', 'dated USD token prices; default prices in driftbench.yaml')
    .option('--process-command <command>', PROCESS_COMMAND_HELP)
    .option(
      '--retry-attempts <n>',
      'attempts per model call, from 1 to 20, the first included; over the spec target retry (default 4)',
    )
    .option(
      '--retry-base-ms <ms>',
      'the wait before the first retry, doubled for each later one (default 500)',
    )
    .option('--retry-max-ms <ms>', 'the longest wait between two attempts (default 30000)')
    .option('--json', 'print one JSON document');
  addRunCheckOptions(addJudgeOptions(resume)).action(
    async (campaignId: string | undefined, options: StoredCommandOptions) => {
      setExit(await campaignResumeCommand(campaignId, options, io, deps));
    },
  );

  campaign
    .command('status')
    .description('Print the state of every cell of a stored campaign. Exit 0 when every cell passes.')
    .argument('[campaignId]', 'the campaign id; the latest campaign of the store without it')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .option(
      '--detail',
      'also print the compounding index (T minus F), the succession of every run and the recovery of every perturbed run',
    )
    .option('--json', 'print one JSON document')
    .action(async (campaignId: string | undefined, options: StoredCommandOptions) => {
      setExit(await campaignStatusCommand(campaignId, options, io, deps));
    });

  campaign
    .command('export')
    .description(
      'Write a stored campaign as a folder: its runs, the specs it ran and the exact files of its dataset and prompt versions.',
    )
    .argument('<campaignId>', 'the campaign id')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .requiredOption('--out <dir>', 'the folder the bundle goes in, as <dir>/<campaignId>')
    .action(async (campaignId: string, options: { store: string; out: string }) => {
      setExit(await campaignExportCommand(campaignId, options, io));
    });

  campaign
    .command('import')
    .description('Store a campaign bundle: its runs, specs and registry versions, all or nothing.')
    .argument('<folder>', 'the bundle folder campaign export wrote')
    .requiredOption('--store <file>', 'the store to import into; made when missing')
    .action(async (folder: string, options: { store: string }) => {
      setExit(await campaignImportCommand(folder, options, io));
    });
}

/** `campaign export`: exit 0 written, 2 on an unknown campaign, a store it cannot open or a source it lacks. */
export async function campaignExportCommand(
  campaignId: string,
  options: { store: string; out: string },
  io: Io,
): Promise<number> {
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  return withBundleStore(options.store, io, async (store) => {
    const folder = await store.exportCampaign(campaignId, resolve(io.cwd, options.out));
    const bundle = await readCampaignBundle(folder);
    const sources = bundle.sources.map(({ version }) => `${version.kind} ${version.name}@${version.version}`);
    io.out(
      `Exported campaign ${campaignId} to ${shown(io, folder)}: ${bundle.runs.length} runs, ${bundle.specs.length} specs, ${sources.length} sources${sources.length === 0 ? '' : ` (${sources.join(', ')})`}.\n`,
    );
    return 0;
  });
}

/** `campaign import`: exit 0 stored, 2 on a bundle that does not read or a conflict with the store. */
export async function campaignImportCommand(
  folder: string,
  options: { store: string },
  io: Io,
): Promise<number> {
  // The bundle is read before the store opens, so a bundle that does not read leaves no new store behind.
  try {
    await readCampaignBundle(resolve(io.cwd, folder));
  } catch (cause) {
    if (!(cause instanceof StoreError)) throw cause;
    io.err(`${cause.message}\n`);
    return 2;
  }
  return withBundleStore(options.store, io, async (store) => {
    const bundle = await store.importCampaign(resolve(io.cwd, folder));
    io.out(
      `Imported campaign ${bundle.campaign.campaignId} into ${options.store}: ${bundle.runs.length} runs, ${bundle.specs.length} specs, ${bundle.sources.length} sources.\n`,
    );
    return 0;
  });
}

async function withBundleStore(
  path: string,
  io: Io,
  work: (store: SqliteStore) => Promise<number>,
): Promise<number> {
  let store: SqliteStore;
  try {
    store = openStore(resolve(io.cwd, path));
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
  try {
    return await work(store);
  } catch (cause) {
    io.err(`${(cause instanceof Error ? cause.message : String(cause)).replace(/^store: /, '')}\n`);
    return 2;
  } finally {
    await store.close();
  }
}

function shown(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

/** `campaign plan`: the cells, the projected cost and the minimum detectable effect. Exit 0, or 2 on bad input. */
export async function campaignPlanCommand(
  paths: string[],
  options: PlanCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const shape = parseShape(options, io);
  const budget =
    options.budgetUsd === undefined ? undefined : parseNumber(options.budgetUsd, '--budget-usd', io);
  const baselineRate = parseRate(options.baselineRate, io);
  const rho = parseRho(options.rho ?? '0', io);
  if (!shape || budget === null || baselineRate === undefined || rho === undefined) return 2;
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const runs = specRuns(loaded, shape.targets, io, shape.routes);
  if (!runs) return 2;
  if (tooManyCells(runs, shape, io)) return 2;
  // A target no adapter is set up for is bad input here too (docs/running.md, "Exit codes"): the plan
  // checks it the way run does, so a plan that prints is a plan that can run.
  const scope = openScope();
  try {
    if (!(await adaptersFor(runs, deps, scope, io))) return 2;
  } finally {
    await closeScope(scope, io);
  }
  if (!options.json) io.out(targetNotes(loaded, shape.targets, shape.routes));

  let units: CostUnit[] = [];
  if (options.store) {
    const store = await openReported(deps, resolve(io.cwd, options.store), io);
    if (!store) return 2;
    try {
      units = await store.listUnits();
    } finally {
      await store.close();
    }
  }
  const plan = planFor(runs, shape.modes, shape.repeats, {
    units,
    baselineRate,
    rho,
    ...(budget === undefined ? {} : { budgetUsd: budget }),
  });

  if (options.json) {
    io.out(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  const targets =
    shape.targets.length > 0
      ? count(shape.targets.length, 'target')
      : `each on its own target (${pinnedTargets(runs).map(showTarget).join(', ')})`;
  io.out(
    `Plan: ${count(loaded.length, 'spec')}, ${targets}, ${shape.modes.length === 1 ? 'mode' : 'modes'} ${shape.modes.join(', ')}, ${count(shape.repeats, 'repeat')}: ${count(plan.cells.length, 'cell')}, ${count(plan.blocks, 'block')}.\n`,
  );
  io.out(
    `${table([
      [
        'cell',
        'spec',
        'target',
        'mode',
        'repeat',
        ...(plan.cells.some((cell) => cell.perturbationId !== undefined) ? ['perturbation'] : []),
        'blocks',
      ],
      ...plan.cells.map((cell) => [
        cell.cellId,
        cell.specId,
        showTarget(cell.target),
        cell.mode,
        String(cell.repeat),
        ...(plan.cells.some((other) => other.perturbationId !== undefined)
          ? [cell.perturbationId ?? '']
          : []),
        String(cell.blocks),
      ]),
    ]).join('\n')}\n`,
  );
  io.out(`${costLine(plan)}\n`);
  for (const line of plan.mde) {
    const effect =
      line.runsPerArm === 0
        ? 'no runs'
        : line.effect === undefined
          ? 'none detectable'
          : `${(line.effect * 100).toFixed(1)} points`;
    io.out(
      `Minimum detectable effect, mode ${line.mode}: ${effect} on a ${(line.baselineRate * 100).toFixed(0)}% pass rate, with ${count(line.runsPerArm, 'run')} per arm over ${count(line.specs, 'spec')} (rho ${line.rho}, design effect ${line.designEffect.toFixed(2)}; two-sided alpha ${line.alpha}, power ${line.power}).\n`,
    );
  }
  return 0;
}

/** `campaign run`: a new campaign over the specs, every cell run. Exit 0 when every cell passes, 1 otherwise, 2 on bad input. */
export async function campaignRunCommand(
  paths: string[],
  options: RunCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const shape = parseShape(options, io);
  const pool = parsePool(options, io);
  const withCommand = processDeps(deps, options.processCommand, io);
  if (!shape || !pool || !withCommand) return 2;
  const prices = await readPrices(options, io);
  if (prices === null) return 2;
  if (options.from !== undefined && options.change === undefined) {
    io.err('--from names the campaign a radius run carries from: it goes with --change <manifest>.\n');
    return 2;
  }
  for (const [flag, value] of [
    ['--audit', options.audit],
    ['--audit-seed', options.auditSeed],
    ['--max-carry', options.maxCarry],
    ['--max-age', options.maxAge],
    ['--block-reruns', options.blockReruns ? 'on' : undefined],
  ] as const) {
    if (value !== undefined && options.change === undefined) {
      io.err(`${flag} sets how a radius run carries: it goes with --change <manifest>.\n`);
      return 2;
    }
  }
  if (options.change !== undefined && (options.from === undefined || options.store === undefined)) {
    io.err(
      '--change runs a blast radius and carries the rest: it goes with --from <campaign> and --store <file>.\n',
    );
    return 2;
  }
  const judging = await judgingDeps(withCommand, options, io);
  if (!judging) return 2;
  deps = judging.deps;
  const scope = openScope();
  try {
    const registry = await registrySources(options, scope, io);
    if (!registry) return 2;
    const read = await loadValidSpecs([...paths, ...registry.folders.map((folder) => folder.path)], io);
    if (!read) return 2;
    // A spec restored from a dataset is stored under its dataset reference, never the temporary folder.
    const loaded = read.map((entry) => ({ ...entry, path: datasetPath(entry.path, registry.folders) }));
    // --prompt pins the registry prompt; --agent-version names the agent under test where no variant does.
    const withPrompt = (target: TargetRef): TargetRef =>
      withAgentVersion(
        registry.prompt === undefined ? target : { ...target, prompt: registry.prompt },
        options.agentVersion,
      );
    const targets = shape.targets.map(withPrompt);
    const runs = specRuns(loaded, targets, io, shape.routes)?.map((each) =>
      each.pinned === undefined
        ? each
        : { ...each, targets: each.targets.map(withPrompt), pinned: withPrompt(each.pinned) },
    );
    if (!runs) return 2;
    if (tooManyCells(runs, shape, io)) return 2;
    if (pool.budgetUsd !== undefined) {
      budgetScopeNotice(options.driver === 'simulated', deps, io);
      preflightTargetPrices(
        runs.flatMap((run) => run.targets),
        prices,
      );
    }
    const driven = await driverDeps(options, runs, deps, io);
    if (!driven) return 2;
    deps = driven.deps;
    const adapters = await adaptersFor(runs, deps, scope, io);
    if (!adapters) return 2;
    if (!options.json) io.out(targetNotes(loaded, shape.targets, shape.routes));
    if (!options.json && driven.note) io.out(driven.note);

    const store = await openReported(deps, options.store ? resolve(io.cwd, options.store) : undefined, io);
    if (!store) return 2;
    try {
      const createdAt = deps.now().toISOString();
      // Without --target each spec pins its own target, so status and resume plan the same cells.
      const specs = runs.map(({ spec, hash, pinned }) => ({
        id: spec.id,
        hash,
        ...(pinned === undefined ? {} : { target: pinned }),
      }));
      const campaignTargets = targets.length > 0 ? targets : pinnedTargets(runs);
      const repeats = { T: 0, F: 0, P: 0 };
      for (const mode of shape.modes) repeats[mode] = shape.repeats;
      // One mode keeps the key a single-mode campaign always had, so its id is unchanged.
      const mode = shape.modes.length === 1 ? shape.modes[0] : shape.modes;
      const campaignId =
        options.campaign ?? `c-${contentHash({ specs, targets: campaignTargets, mode, repeats, createdAt })}`;
      if (await store.getCampaign(campaignId)) {
        io.err(
          `Campaign ${campaignId} already exists. Resume it with: driftbench campaign resume ${campaignId}\n`,
        );
        return 2;
      }
      for (const entry of loaded) await store.putSpec(entry);
      // A block rerun keeps the snapshots of its baseline going: a later rerun needs them on every block.
      const snapshots =
        options.recordEndStateSnapshots === true ||
        (options.blockReruns === true &&
          options.from !== undefined &&
          (await store.getCampaign(options.from))?.provenance?.endStateSnapshots === true);
      const campaign: Campaign = {
        campaignId,
        specs,
        targets: campaignTargets,
        modes: shape.modes,
        repeats,
        // 0 when no budget was given: the schema has no field for "no budget".
        budgetUsd: pool.budgetUsd ?? 0,
        provenance: campaignProvenance(
          runs.flatMap((run) => run.targets),
          (target) => required(adapters.get(showTarget(target)), 'adapter'),
          snapshots,
          options.recordRealizedText === true,
        ),
        judge: judging.judge
          ? { mode: judging.judge.mode, judges: judging.judge.judges }
          : { mode: 'system1', judges: [] },
        createdAt,
        ...(registry.sources.length > 0 ? { sources: registry.sources } : {}),
        ...(options.agentVersion === undefined ? {} : { agentVersion: options.agentVersion }),
      };
      const radius =
        options.change === undefined
          ? undefined
          : await radiusPlan(
              options,
              campaign,
              loaded,
              store,
              deps,
              io,
              (cell) => {
                const spec = required(loaded.find((entry) => entry.hash === cell.specHash)?.spec, 'spec');
                return runProvenance({
                  adapter: required(adapters.get(showTarget(cell.target)), 'adapter'),
                  driver: deps.driver(cell, spec),
                  checks: deps.checks,
                  mode: cell.mode,
                  repeat: cell.repeat,
                  target: cell.target,
                  perturbationId: cell.perturbationId,
                  retry: pool.retry,
                  ...(judging.toolPolicy ? { toolPolicy: judging.toolPolicy } : {}),
                  agentVersion: campaign.agentVersion,
                });
              },
              (cell) => {
                const spec = required(loaded.find((entry) => entry.hash === cell.specHash)?.spec, 'spec');
                return {
                  spec,
                  options: {
                    adapter: required(adapters.get(showTarget(cell.target)), 'adapter'),
                    driver: deps.driver(cell, spec),
                    checks: deps.checks,
                    mode: cell.mode,
                    repeat: cell.repeat,
                    target: cell.target,
                    perturbationId: cell.perturbationId,
                    retry: pool.retry,
                    ...(judging.toolPolicy ? { toolPolicy: judging.toolPolicy } : {}),
                    agentVersion: campaign.agentVersion,
                    recordProvenance: true,
                    recordEndStateSnapshots: snapshots,
                    ...(options.recordRealizedText ? { recordRealizedText: true } : {}),
                  },
                };
              },
              async (cells) => {
                // The audit runs before the campaign is stored, in a store of its own: what it finds
                // decides what the campaign carries, and a campaign record never changes once written.
                const memory = await deps.openStore(undefined);
                try {
                  for (const entry of loaded) await memory.putSpec(entry);
                  await memory.putCampaign(campaign);
                  const specs = new Map(
                    loaded.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]),
                  );
                  const outcomes = await runCampaign({
                    campaignId,
                    cells,
                    recordProvenance: true,
                    ...(snapshots ? { recordEndStateSnapshots: true } : {}),
                    ...(options.recordRealizedText ? { recordRealizedText: true } : {}),
                    recordEvents: true,
                    specFor: (cell) =>
                      required(specs.get(`${cell.specId}@${cell.specHash}`), `spec ${cell.specId}`),
                    adapterFor: (target) =>
                      required(adapters.get(showTarget(target)), `adapter ${showTarget(target)}`),
                    driver: (cell, spec) => deps.driver(cell, spec),
                    ...(deps.consequential ? { consequential: deps.consequential } : {}),
                    checks: deps.checks,
                    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
                    store: memory,
                    ...(campaign.agentVersion === undefined ? {} : { agentVersion: campaign.agentVersion }),
                    now: () => deps.now(),
                    concurrency: pool.concurrency,
                    ...(pool.budgetUsd === undefined ? {} : { budgetUsd: pool.budgetUsd }),
                    ...(prices ? { prices } : {}),
                    ...(pool.retry ? { retry: pool.retry } : {}),
                    ...(judging.toolPolicy ? { toolPolicy: judging.toolPolicy } : {}),
                  });
                  return outcomes.flatMap((outcome) => (outcome.run ? [outcome.run] : []));
                } finally {
                  await memory.close();
                }
              },
            );
      if (radius === null) return 2;
      if (radius) campaign.radius = radius.record;
      try {
        await store.putCampaign(campaign);
      } catch (cause) {
        // Another process stored this id between the check above and this write: the same bad input.
        if (cause instanceof StoreError && cause.code === 'CAMPAIGN_CONFLICT') {
          io.err(
            `Campaign ${campaignId} already exists. Resume it with: driftbench campaign resume ${campaignId}\n`,
          );
          return 2;
        }
        throw cause;
      }
      if (radius) {
        await carryRuns(store, campaignId, radius.plan.carried);
        // The audit runs are fresh runs of this campaign's own cells: they are kept, and not run twice.
        for (const run of radius.auditRuns) await store.putRun(campaignId, run);
      }
      const exit = await executeCampaign(campaign, loaded, adapters, store, deps, io, {
        ...(radius ? { radiusNote: radius.note } : {}),
        cache: options.cache,
        ...(options.cacheSuite === undefined ? {} : { cacheSuite: options.cacheSuite }),
        json: options.json === true,
        kept: options.store !== undefined,
        ...(radius?.blockReuse ? { blockReuse: radius.blockReuse } : {}),
        ...pool,
        ...(prices ? { prices } : {}),
        ...(judging.judge ? { judge: judging.judge } : {}),
        ...(judging.toolPolicy ? { toolPolicy: judging.toolPolicy } : {}),
      });
      // A radius miss fails closed, whatever the cells say: the manifest left out part of the change.
      return (radius?.record.audit?.misses ?? 0) > 0 ? 1 : exit;
    } finally {
      await store.close();
    }
  } catch (cause) {
    if (!(cause instanceof TokenPriceError)) throw cause;
    io.err(`${cause.message}\n`);
    return 2;
  } finally {
    await closeScope(scope, io);
  }
}

/**
 * The registry versions `--dataset` and `--prompt` name, read from the store. The dataset's files are
 * restored, byte for byte, into the campaign's temporary folder, and its specs load from there.
 */
async function registrySources(
  options: RunCommandOptions,
  scope: CampaignScope,
  io: Io,
): Promise<RegistryRead | undefined> {
  const prompts = options.prompt ?? [];
  if (options.dataset === undefined && prompts.length === 0) return { folders: [], sources: [] };
  if (prompts.length > 1) {
    io.err('--prompt names the one prompt the agent runs with: give it once.\n');
    return undefined;
  }
  if (options.store === undefined) {
    io.err('--dataset and --prompt read the registry of a store: add --store <file>.\n');
    return undefined;
  }
  let store: SqliteStore;
  try {
    store = openStore(resolve(io.cwd, options.store));
  } catch (cause) {
    io.err(
      `Cannot open the store at ${options.store}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return undefined;
  }
  try {
    const read: RegistryRead = { folders: [], sources: [] };
    const wanted = [
      ...(options.dataset === undefined ? [] : [{ kind: 'dataset' as const, text: options.dataset }]),
      ...prompts.map((text) => ({ kind: 'prompt' as const, text })),
    ];
    for (const { kind, text } of wanted) {
      const { name, ref } = parseVersionRef(text);
      const version = await store.getVersion(kind, name, ref);
      if (!version) {
        io.err(
          `No ${kind} ${text} in ${options.store}. Push it with: driftbench ${kind} push ${name} <path>\n`,
        );
        return undefined;
      }
      const label = `${version.name}@${version.version}`;
      read.sources.push({ kind, name: version.name, version: version.version, hash: version.hash });
      const files = await store.readVersionFiles(version);
      if (kind === 'dataset') {
        const folder = join(await scope.tempDir(), `dataset-${version.name}-${version.version}`);
        await restoreFiles(files, folder, { single: false });
        read.folders.push({ path: folder, label });
        continue;
      }
      const [only] = files;
      if (only === undefined || files.length > 1) {
        io.err(
          `prompt ${label} holds ${files.length} files; --prompt hands the agent one text, so push a single prompt file.\n`,
        );
        return undefined;
      }
      let promptText: string;
      try {
        promptText = new TextDecoder('utf-8', { fatal: true }).decode(only.bytes);
      } catch {
        io.err(`prompt ${label} is not UTF-8 text: --prompt hands the agent a text.\n`);
        return undefined;
      }
      read.prompt = { name: version.name, version: version.version, hash: version.hash, text: promptText };
    }
    return read;
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  } finally {
    await store.close();
  }
}

/** What `--dataset` and `--prompt` read: the restored dataset folders, the versions, the prompt. */
type RegistryRead = {
  folders: { path: string; label: string }[];
  sources: RegistrySource[];
  prompt?: TargetPrompt;
};

/** A spec file inside a restored dataset as `name@version/<path in the dataset>`; others as they are. */
function datasetPath(path: string, folders: RegistryRead['folders']): string {
  for (const folder of folders) {
    const inside = relative(folder.path, path);
    if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) {
      return `${folder.label}/${inside.split(sep).join('/')}`;
    }
  }
  return path;
}

/** `campaign resume`: runs the cells with no completed run, reuses the others. Exits like `campaign run`. */
export async function campaignResumeCommand(
  campaignId: string | undefined,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const pool = parsePool({ ...options, concurrency: options.concurrency ?? '4' }, io);
  const withCommand = processDeps(deps, options.processCommand, io);
  if (!pool || !withCommand) return 2;
  const prices = await readPrices(options, io);
  if (prices === null) return 2;
  const judging = await judgingDeps(withCommand, options, io);
  if (!judging) return 2;
  deps = judging.deps;
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  const scope = openScope();
  try {
    const stored = await storedCampaign(store, campaignId, options.store, io);
    if (!stored) return 2;
    const budgetUsd =
      pool.budgetUsd ?? (stored.campaign.budgetUsd > 0 ? stored.campaign.budgetUsd : undefined);
    const runs = runsOf(stored.campaign, stored.specs);
    if (budgetUsd !== undefined) {
      budgetScopeNotice(false, deps, io);
      preflightTargetPrices(
        runs.flatMap((run) => run.targets),
        prices,
      );
    }
    const adapters = await adaptersFor(runs, deps, scope, io);
    if (!adapters) return 2;
    return await executeCampaign(stored.campaign, stored.specs, adapters, store, deps, io, {
      cache: options.cache !== false,
      ...(options.cacheSuite === undefined ? {} : { cacheSuite: options.cacheSuite }),
      json: options.json === true,
      kept: true,
      concurrency: pool.concurrency,
      ...(budgetUsd === undefined ? {} : { budgetUsd }),
      ...(prices ? { prices } : {}),
      ...(pool.retry ? { retry: pool.retry } : {}),
      ...(judging.judge ? { judge: judging.judge } : {}),
      ...(judging.toolPolicy ? { toolPolicy: judging.toolPolicy } : {}),
    });
  } catch (cause) {
    if (!(cause instanceof TokenPriceError)) throw cause;
    io.err(`${cause.message}\n`);
    return 2;
  } finally {
    // closeScope never throws, so the store is closed whatever happens to the folder.
    await closeScope(scope, io);
    await store.close();
  }
}

/** `campaign status`: the state of every cell. Exit 0 when every cell passes, 1 otherwise, 2 on bad input. */
export async function campaignStatusCommand(
  campaignId: string | undefined,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const stored = await storedCampaign(store, campaignId, options.store, io);
    if (!stored) return 2;
    const { campaign } = stored;
    const plan = planOf(campaign, stored.specs);
    const byCell = await runsByCell(store, campaign.campaignId);
    const outcomes = plan.cells.map((cell) => outcomeOf(cell, byCell.get(cell.cellId)));
    const detail = options.detail ? detailOf(outcomes, stored.specs) : undefined;
    if (options.json) {
      io.out(
        `${JSON.stringify({ ...report(campaign.campaignId, outcomes, true, []), ...(detail ? { detail } : {}) }, null, 2)}\n`,
      );
    } else {
      io.out(`Campaign ${campaign.campaignId}, created ${campaign.createdAt}.\n`);
      for (const outcome of outcomes) io.out(cellLine(outcome));
      io.out(`${summaryLine(outcomes)}\n`);
      if (detail) io.out(detailText(detail));
    }
    return outcomes.every((outcome) => outcome.state === 'pass') ? 0 : 1;
  } finally {
    await store.close();
  }
}

async function executeCampaign(
  campaign: Campaign,
  loaded: readonly LoadedSpec[],
  adapters: ReadonlyMap<string, AgentAdapter>,
  store: Store,
  deps: CampaignDeps,
  io: Io,
  flags: {
    cache: boolean;
    cacheSuite?: string;
    json: boolean;
    kept: boolean;
    concurrency: number;
    budgetUsd?: number;
    prices?: TokenPrices;
    retry?: RetryOptions;
    /** The line a radius campaign prints before its cells: what runs and what is carried. */
    radiusNote?: string;
    /** Mode T: the stored baseline run to rerun only the radius blocks from, by cell. */
    blockReuse?: (cell: PlannedCell) => BlockReuse | undefined;
    /** The judge the flags gave, whose label and spend the summary prints. */
    judge?: RunJudge;
    /** The run-wide tool policy of --tool-policy: every run marks the calls it denies. */
    toolPolicy?: readonly ToolRule[];
  },
): Promise<number> {
  const plan = planOf(campaign, loaded);
  const specs = new Map(loaded.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  const checks = deps.checks.map((check) => check.name);
  if (!flags.json) {
    const budget = flags.budgetUsd === undefined ? '' : ` Budget ${usd(flags.budgetUsd)}.`;
    io.out(
      `Campaign ${campaign.campaignId}: ${count(plan.cells.length, 'cell')}, ${flags.concurrency} at a time.${budget} Checks: ${checks.length > 0 ? checks.join(', ') : 'none loaded'}.\n`,
    );
    // Beside the list of checks: the criteria no check of this campaign will judge.
    const unjudged = checks.includes(JUDGE_CHECK) ? undefined : notJudgedNote(specs.values());
    if (unjudged !== undefined) io.out(unjudged);
    if (flags.radiusNote !== undefined) io.out(flags.radiusNote);
  }
  const outcomes = await runCampaign({
    campaignId: campaign.campaignId,
    cells: plan.cells,
    recordProvenance: campaign.provenance !== undefined,
    ...(campaign.provenance?.endStateSnapshots ? { recordEndStateSnapshots: true } : {}),
    ...(campaign.provenance?.realizedText ? { recordRealizedText: true } : {}),
    ...(flags.blockReuse ? { blockReuse: flags.blockReuse } : {}),
    recordEvents: true,
    specFor: (cell) => required(specs.get(`${cell.specId}@${cell.specHash}`), `spec ${cell.specId}`),
    adapterFor: (target) => required(adapters.get(showTarget(target)), `adapter ${showTarget(target)}`),
    driver: (cell, spec) => deps.driver(cell, spec),
    ...(deps.consequential ? { consequential: deps.consequential } : {}),
    checks: deps.checks,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    store,
    // The runner neither replays nor caches a run in a sandbox: a replay has no workspace to read.
    ...(flags.cache ? { cache: store } : {}),
    ...(flags.cacheSuite === undefined ? {} : { cacheSuite: flags.cacheSuite }),
    ...(campaign.agentVersion === undefined ? {} : { agentVersion: campaign.agentVersion }),
    now: () => deps.now(),
    concurrency: flags.concurrency,
    ...(flags.budgetUsd === undefined ? {} : { budgetUsd: flags.budgetUsd }),
    ...(flags.prices ? { prices: flags.prices } : {}),
    ...(flags.retry ? { retry: flags.retry } : {}),
    ...(flags.toolPolicy ? { toolPolicy: flags.toolPolicy } : {}),
    ...(flags.json ? {} : { onCell: (outcome: CellOutcome) => io.out(cellLine(outcome)) }),
  });
  await flags.judge?.save();
  if (flags.json) {
    const reported = report(campaign.campaignId, outcomes, flags.kept, checks);
    const document = flags.judge
      ? { ...reported, judge: flags.judge.label, judgeCostUsd: flags.judge.spend.usd }
      : reported;
    io.out(
      `${JSON.stringify(campaign.radius ? { ...document, radius: { ...campaign.radius, blocks: radiusBlocks(outcomes) } } : document, null, 2)}\n`,
    );
  } else {
    io.out(`${summaryLine(outcomes)}\n`);
    if (flags.judge) io.out(`Judge ${flags.judge.label}, ${flags.judge.spend.usd.toFixed(4)} USD.\n`);
    if (campaign.radius) io.out(radiusSummary(campaign.radius, outcomes));
    if (!flags.kept) io.out('The runs are not kept: pass --store <file> to keep them.\n');
  }
  return gateExit(outcomes.map((outcome) => outcome.state));
}

/**
 * `--change` with `--from`: the blast radius of the manifest over the campaign's cells, and which cells
 * outside it carry their stored run. Null on bad input, with the reason printed.
 */
async function radiusPlan(
  options: RunCommandOptions,
  campaign: Campaign,
  loaded: readonly LoadedSpec[],
  store: Store,
  deps: CampaignDeps,
  io: Io,
  currentProvenance: (cell: PlannedCell) => RunResult['provenance'],
  blockOptions: (cell: PlannedCell) => { spec: Spec; options: RunOptions },
  runAudit: (cells: PlannedCell[]) => Promise<RunResult[]>,
): Promise<{
  plan: RadiusPlan;
  record: NonNullable<Campaign['radius']>;
  note: string;
  auditRuns: RunResult[];
  blockReuse?: (cell: PlannedCell) => BlockReuse | undefined;
} | null> {
  if (options.change === undefined || options.from === undefined || options.store === undefined) {
    io.err(
      '--change runs a blast radius and carries the rest: it goes with --from <campaign> and --store <file>.\n',
    );
    return null;
  }
  const manifest = await loadRadiusChangeManifest(resolve(io.cwd, options.change));
  if (!manifest.ok) {
    io.err(`✗ ${options.change}\n`);
    for (const error of manifest.errors) io.err(`    ${error}\n`);
    io.err('The change manifest is invalid, so nothing was run.\n');
    return null;
  }
  const whole = (text: string | undefined, flag: string, min: number): number | undefined | null => {
    if (text === undefined) return undefined;
    const value = optionNumber(text);
    if (Number.isInteger(value) && value >= min) return value;
    io.err(`${flag} takes a whole number of at least ${min}, not "${text}".\n`);
    return null;
  };
  const auditSize = whole(options.audit, '--audit', 1);
  const auditSeed = whole(options.auditSeed, '--audit-seed', 0);
  const maxCarry = whole(options.maxCarry, '--max-carry', 0);
  const maxAge = options.maxAge === undefined ? undefined : optionNumber(options.maxAge);
  if (maxAge !== undefined && !(maxAge >= 0)) {
    io.err(`--max-age takes a number of days of at least 0, not "${options.maxAge}".\n`);
    return null;
  }
  if (auditSize === null || auditSeed === null || maxCarry === null) return null;
  if (auditSeed !== undefined && auditSize === undefined) {
    io.err('--audit-seed sets the draw of an audit: it goes with --audit <n>.\n');
    return null;
  }
  const baseline = await store.getCampaign(options.from);
  if (!baseline) {
    io.err(
      `No campaign ${options.from} in ${options.store}: --from names the stored campaign to carry from.\n`,
    );
    return null;
  }
  const cells = planOf(campaign, loaded).cells;
  const radius = radiusOf(
    loaded.map((entry) => ({ spec: entry.spec, hash: entry.hash })),
    manifest.manifest,
    { modes: campaign.modes },
  );
  const baselineRuns = await store.listRuns({ campaignId: baseline.campaignId });
  if (!completeBaselineProvenance({ provenance: baseline.provenance, runs: baselineRuns }))
    radius.whole = { change: 'legacy', reason: 'the baseline has no execution provenance' };
  let plan = planRadiusCampaign(
    cells,
    radius,
    manifest.manifest,
    { campaignId: baseline.campaignId, runs: baselineRuns, provenance: baseline.provenance },
    {
      now: deps.now(),
      currentProvenance,
      currentSpec: (cell) => loaded.find((entry) => entry.hash === cell.specHash)?.spec,
      ...(maxCarry === undefined ? {} : { maxCarry }),
      ...(maxAge === undefined ? {} : { maxAgeDays: maxAge }),
    },
  );
  if (options.blockReruns && !campaign.modes.includes('T')) {
    io.err('--block-reruns reruns blocks of independent mode T cells: it goes with --mode T.\n');
    return null;
  }
  // Mode T cells in the radius keep their stored blocks outside it. A refusal runs the whole cell.
  let blocks =
    options.blockReruns && plan.nothing === undefined
      ? planCellBlockReruns({
          cells: plan.fresh,
          baselineRuns,
          baseline,
          manifest: manifest.manifest,
          optionsFor: blockOptions,
          now: deps.now(),
          ...(maxCarry === undefined ? {} : { maxCarry }),
          ...(maxAge === undefined ? {} : { maxAgeDays: maxAge }),
        })
      : undefined;
  const outside = plan.carried.length + (blocks?.partial.size ?? 0);
  let audit: NonNullable<NonNullable<Campaign['radius']>['audit']> | undefined;
  const auditRuns: RunResult[] = [];
  if (auditSize !== undefined && plan.nothing === undefined && outside > 0) {
    const seed = auditSeed ?? 1;
    const pool = [
      ...plan.carried.map((entry) => ({ cell: entry.cell, source: entry.source, carried: entry })),
      ...[...(blocks?.partial ?? [])].flatMap(([cellId, partial]) => {
        const cell = plan.fresh.find((entry) => entry.cellId === cellId);
        return cell ? [{ cell, source: partial.reuse.source, partial }] : [];
      }),
    ];
    const sample = auditSample(pool, auditSize, seed);
    const fresh = new Map((await runAudit(sample.map((entry) => entry.cell))).map((run) => [run.runId, run]));
    const missed: NonNullable<NonNullable<Campaign['radius']>['audit']>['missed'] = [];
    for (const entry of sample) {
      const run = fresh.get(entry.cell.cellId);
      const verdict = !run
        ? { agree: false, differing: ['the audit run did not finish'] }
        : 'partial' in entry
          ? (() => {
              const differing = carriedBlocksAgree(run, entry.partial);
              return { agree: differing.length === 0, differing };
            })()
          : auditVerdict(run, entry.source);
      if (run) auditRuns.push(run);
      if (!verdict.agree) {
        missed.push({ specId: entry.cell.specId, cellId: entry.cell.cellId, differing: verdict.differing });
      }
    }
    audit = { sampled: sample.length, misses: missed.length, seed, missed };
    if (missed.length > 0) {
      plan = {
        fresh: [...cells],
        carried: [],
        refused: [],
        inside: plan.inside,
        nothing: `the audit found ${missed.length} of ${count(sample.length, 'carried result')} the new agent does not reproduce`,
      };
      blocks = undefined;
    } else {
      const drawn = new Set(sample.map((entry) => entry.cell.cellId));
      // A drawn partial cell already ran whole: its stored blocks are not carried any more.
      const wholeDrawn = sample.filter((entry) => !('partial' in entry));
      plan = {
        ...plan,
        carried: plan.carried.filter((entry) => !drawn.has(entry.cell.cellId)),
        fresh: [...plan.fresh, ...wholeDrawn.map((entry) => entry.cell)],
        refused: [
          ...plan.refused,
          ...wholeDrawn.map((entry) => ({ cell: entry.cell, reason: 'drawn for the audit' })),
        ],
      };
      for (const entry of sample) blocks?.partial.delete(entry.cell.cellId);
    }
  }
  const record = {
    ...campaignRadius(plan, radius, manifest.manifest, manifest.hash, baseline.campaignId),
    ...(audit ? { audit } : {}),
  };
  const changes = record.changes.length === 0 ? 'no change' : record.changes.join(', ');
  const lines = [
    `Blast radius of ${record.fromVersion} to ${record.toVersion} (manifest ${record.manifest}): ${changes}.`,
  ];
  if (audit) {
    const bound = auditBound(audit.sampled);
    lines.push(
      `Audit: ${count(audit.sampled, 'cell')} drawn from the ${outside} outside the radius (seed ${audit.seed}) and run fresh: ${audit.misses} ${audit.misses === 1 ? 'miss' : 'misses'}.${audit.misses === 0 && bound !== undefined ? ` At 95% confidence, under ${(bound * 100).toFixed(1)}% of the carried cells would disagree.` : ''}`,
    );
    for (const entry of audit.missed) lines.push(`  ${entry.specId}: ${entry.differing.join('; ')}`);
    if (audit.misses > 0) {
      lines.push(
        'RADIUS MISS: the change reaches cells the manifest left out of the radius. The gate fails closed.',
      );
    }
  }
  if (plan.nothing !== undefined) {
    lines.push(`Nothing is carried, every cell runs: ${plan.nothing}.`);
  } else {
    lines.push(
      `${plan.inside.length} of ${count(cells.length, 'cell')} in the radius. ${count(plan.fresh.length, 'cell')} run fresh, ${plan.carried.length} carried from ${baseline.campaignId}.`,
    );
    for (const entry of record.refused) {
      lines.push(`  ${count(entry.cells, 'cell')} outside the radius run fresh: ${entry.reason}.`);
    }
    if (blocks) {
      const kept = [...blocks.partial.values()].reduce((sum, entry) => sum + entry.carried.size, 0);
      const sent = [...blocks.partial.values()].reduce((sum, entry) => sum + entry.indices.size, 0);
      lines.push(
        `Mode T block reruns: ${count(blocks.partial.size, 'cell')} send ${count(sent, 'block')} and keep ${count(kept, 'stored block')} from ${baseline.campaignId}.`,
      );
      const reasons = new Map<string, number>();
      for (const reason of blocks.whole.values()) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      for (const [reason, cells] of reasons) lines.push(`  ${count(cells, 'cell')} run whole: ${reason}.`);
    }
  }
  const partial = blocks?.partial;
  return {
    plan,
    record,
    note: `${lines.join('\n')}\n`,
    auditRuns,
    ...(partial && partial.size > 0
      ? { blockReuse: (cell: PlannedCell) => partial.get(cell.cellId)?.reuse }
      : {}),
  };
}

/** The name of the check a council of @agent-nexus/driftbench-judges adds to the checks. */
const JUDGE_CHECK = 'judge';

/**
 * What a campaign without a judge left unjudged: the criteria its specs name in a block or a perturbation.
 * Such a criterion gets no verdict, so a run can read pass with a gating criterion never looked at.
 * Undefined when no spec names a criterion.
 */
function notJudgedNote(specs: Iterable<Spec>): string | undefined {
  const names = new Set<string>();
  const gating = new Set<string>();
  let blocks = 0;
  let withCriteria = 0;
  for (const spec of specs) {
    const always = new Set((spec.criteria ?? []).filter((each) => each.gating).map((each) => each.name));
    const before = blocks;
    for (const expect of [...spec.blocks, ...(spec.perturbations ?? [])].map((each) => each.expect)) {
      const refs = (expect?.criteria ?? []).flatMap((ref) => parseCriterionRef(ref) ?? []);
      if (refs.length === 0) continue;
      blocks += 1;
      for (const ref of refs) {
        names.add(ref.name);
        if (ref.gating || always.has(ref.name)) gating.add(ref.name);
      }
    }
    if (blocks > before) withCriteria += 1;
  }
  if (names.size === 0) return undefined;
  const listed = [...names].slice(0, 5).join(', ') + (names.size > 5 ? `, and ${names.size - 5} more` : '');
  const criteria = names.size === 1 ? '1 criterion' : `${names.size} criteria`;
  const these =
    names.size === 1 ? 'it has no verdict and counts' : 'these criteria have no verdict and count';
  const gates = gating.size === 0 ? 'none of them gating' : `${gating.size} of them gating`;
  return `Not judged: ${criteria} in ${count(blocks, 'block')} of ${count(withCriteria, 'spec')} (${listed}), ${gates}. This campaign loads no judge, so ${these} in no pass or fail. See docs/concepts/judges.md.\n`;
}

async function openReported(
  deps: CampaignDeps,
  path: string | undefined,
  io: Io,
): Promise<Store | undefined> {
  try {
    return await deps.openStore(path);
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

function planOf(campaign: Campaign, loaded: readonly { spec: Spec; hash: string }[]): CampaignPlan {
  return planFor(runsOf(campaign, loaded), campaign.modes, campaign.repeats);
}

async function storedCampaign(
  store: Store,
  campaignId: string | undefined,
  path: string,
  io: Io,
): Promise<{ campaign: Campaign; specs: LoadedSpec[] } | undefined> {
  let campaign: Campaign | undefined;
  if (campaignId === undefined) {
    // The store lists its campaigns newest first: the first is the latest.
    [campaign] = await store.listCampaigns();
    if (!campaign) {
      io.err(`The store at ${path} holds no campaign. Run one with: driftbench campaign run <paths...>\n`);
      return undefined;
    }
  } else {
    campaign = await store.getCampaign(campaignId);
    if (!campaign) {
      io.err(`No campaign ${campaignId} in ${path}.\n`);
      return undefined;
    }
  }
  const specs: LoadedSpec[] = [];
  for (const pinned of campaign.specs) {
    const spec = await store.getSpec(pinned.id, pinned.hash);
    if (!spec) {
      io.err(
        `The store has no spec ${pinned.id} at hash ${pinned.hash}, which campaign ${campaign.campaignId} pins.\n`,
      );
      return undefined;
    }
    specs.push(spec);
  }
  return { campaign, specs };
}

/** A tag and the target the specs it marks run on, whatever --target says. */
export type Route = { tag: string; target: TargetRef };

type Shape = { targets: TargetRef[]; routes: Route[]; modes: RunMode[]; repeats: number };

type Pool = { concurrency: number; budgetUsd?: number; retry?: RetryOptions };

function parsePool(
  options: { concurrency: string; budgetUsd?: string | undefined } & RetryFlags,
  io: Io,
): Pool | undefined {
  const concurrency = optionNumber(options.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    io.err(`--concurrency takes a whole number of at least 1, not "${options.concurrency}".\n`);
    return undefined;
  }
  const retry = parseRetry(options, io);
  if (retry === null) return undefined;
  const pool: Pool = { concurrency, ...(retry ? { retry } : {}) };
  if (options.budgetUsd === undefined) return pool;
  const budgetUsd = parseNumber(options.budgetUsd, '--budget-usd', io);
  return budgetUsd === null ? undefined : { ...pool, budgetUsd };
}

/** The retry flags as runner settings: undefined when none is given, null (after a message) when one is bad. */
function parseRetry(flags: RetryFlags, io: Io): RetryOptions | undefined | null {
  const read = (text: string | undefined, flag: string, min: number): number | undefined | null => {
    if (text === undefined) return undefined;
    const value = optionNumber(text);
    if (Number.isInteger(value) && value >= min) return value;
    io.err(`${flag} takes a whole number of at least ${min}, not "${text}".\n`);
    return null;
  };
  const maxAttempts = read(flags.retryAttempts, '--retry-attempts', 1);
  if (maxAttempts !== null && maxAttempts !== undefined && maxAttempts > 20) {
    io.err(`--retry-attempts takes a whole number from 1 to 20, not "${flags.retryAttempts}".\n`);
    return null;
  }
  const baseDelayMs = read(flags.retryBaseMs, '--retry-base-ms', 0);
  const maxDelayMs = read(flags.retryMaxMs, '--retry-max-ms', 0);
  if (maxAttempts === null || baseDelayMs === null || maxDelayMs === null) return null;
  const retry: RetryOptions = {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(baseDelayMs === undefined ? {} : { baseDelayMs }),
    ...(maxDelayMs === undefined ? {} : { maxDelayMs }),
  };
  return Object.keys(retry).length > 0 ? retry : undefined;
}

/**
 * Modes, repeats and the `--target` list, which is empty when each spec runs on its own target. `--mode`
 * takes one mode or several separated by commas, such as `T,F,P`; the cells come in the order T, F, P.
 */
function parseShape(
  options: { target: string[]; route?: string[]; mode: string; repeats: string },
  io: Io,
): Shape | undefined {
  const named = options.mode.split(',').map((part) => part.trim());
  const modes: RunMode[] = [];
  for (const text of named) {
    const mode = RunMode.safeParse(text);
    if (!mode.success) {
      io.err(`Unknown mode "${text}". The modes are T, F and P, alone or separated by commas.\n`);
      return undefined;
    }
    if (!modes.includes(mode.data)) modes.push(mode.data);
  }
  modes.sort((a, b) => RunMode.options.indexOf(a) - RunMode.options.indexOf(b));
  const repeats = optionNumber(options.repeats);
  if (!Number.isInteger(repeats) || repeats < 1) {
    io.err(`--repeats takes a whole number of at least 1, not "${options.repeats}".\n`);
    return undefined;
  }
  const targets: TargetRef[] = [];
  for (const text of options.target) {
    const target = TargetRef.safeParse(parseTarget(text));
    if (!target.success) {
      io.err(`"${text}" is not a target. Write <adapter> or <adapter>:<agent>, such as function:acme.\n`);
      return undefined;
    }
    if (!targets.some((known) => showTarget(known) === showTarget(target.data))) targets.push(target.data);
  }
  const routes: Route[] = [];
  for (const text of options.route ?? []) {
    const at = text.indexOf('=');
    const target = at > 0 ? TargetRef.safeParse(parseTarget(text.slice(at + 1))) : undefined;
    if (!target?.success) {
      io.err(`--route takes tag=target, such as flow:price-sheet=process:acme-ops, not "${text}".\n`);
      return undefined;
    }
    routes.push({ tag: text.slice(0, at), target: target.data });
  }
  if (routes.length > 0 && targets.length === 0) {
    io.err('--route goes with --target: without it each spec already runs on its own target.\n');
    return undefined;
  }
  return { targets, routes, modes, repeats };
}

/** The most cells a plan or a run expands: past it, the cell list alone would exhaust memory. */
export const MAX_CELLS = 1_000_000;

/**
 * True, after printing why, when specs x targets x modes x repeats (each perturbation of a spec counted as a
 * cell in mode P) exceeds MAX_CELLS. Counted before any cell is made.
 */
function tooManyCells(runs: readonly SpecRun[], shape: Shape, io: Io): boolean {
  let cells = 0;
  for (const run of runs) {
    for (const mode of shape.modes) {
      const variants = mode === 'P' ? Math.max(1, run.spec.perturbations?.length ?? 0) : 1;
      cells += run.targets.length * variants * shape.repeats;
    }
  }
  if (cells <= MAX_CELLS) return false;
  io.err(`--repeats ${shape.repeats} makes ${cells} cells; a campaign holds at most ${MAX_CELLS}.\n`);
  return true;
}

/** One line per spec whose own target names another adapter than a `--target`, which overrides it. */
function targetNotes(
  loaded: readonly LoadedSpec[],
  targets: readonly TargetRef[],
  routes: readonly Route[] = [],
): string {
  const notes: string[] = [];
  for (const { spec } of loaded) {
    if (routeOf(spec, routes)) continue;
    const own = spec.target?.adapter;
    for (const target of targets) {
      if (own !== undefined && own !== target.adapter) {
        notes.push(`Note: ${spec.id} names the ${own} adapter; --target runs it on ${showTarget(target)}.\n`);
      }
    }
  }
  return notes.join('');
}

/** `adapter[:agent]`, such as `function:acme`. */
export function parseTarget(text: string): TargetRef {
  const at = text.indexOf(':');
  if (at < 0) return { adapter: text };
  return { adapter: text.slice(0, at), agent: text.slice(at + 1) };
}

export function showTarget(target: TargetRef): string {
  return target.agent === undefined ? target.adapter : `${target.adapter}:${target.agent}`;
}

/** One adapter per target the runs need, made in the campaign's scope. Exit 2 is the caller's on undefined. */
async function adaptersFor(
  runs: readonly SpecRun[],
  deps: CampaignDeps,
  scope: CampaignScope,
  io: Io,
): Promise<Map<string, AgentAdapter> | undefined> {
  const adapters = new Map<string, AgentAdapter>();
  for (const target of runs.flatMap((run) => run.targets)) {
    const key = showTarget(target);
    if (adapters.has(key)) continue;
    const owners = runs
      .filter((run) => run.pinned !== undefined && showTarget(run.pinned) === key)
      .map((run) => run.spec.id);
    const adapter = await resolveAdapter(target, () => deps.adapterFor(target, scope), io, owners);
    if (!adapter) return undefined;
    adapters.set(key, adapter);
  }
  return adapters;
}

type RefusalContext = { reference?: boolean; unspent?: boolean; pilot?: boolean; exampleInstalled?: boolean };

/** Resolve a command's target and give every refusal the same install-aware explanation. */
export async function resolveAdapter(
  target: TargetRef,
  factory: () => Promise<AgentAdapter | undefined>,
  io: Io,
  specIds: readonly string[] = [],
  context: RefusalContext = {},
): Promise<AgentAdapter | undefined> {
  const adapter = await factory();
  if (!adapter) io.err(`${noAdapter(target, specIds, context)}\n`);
  return adapter;
}

/** Why a target cannot run, including its owning specs and the targets this install reaches. */
export function noAdapter(
  target: TargetRef,
  specIds: readonly string[] = [],
  context: RefusalContext = {},
): string {
  const whose = specIds.length === 0 ? '' : `, the target of ${specIds.join(', ')}`;
  const installed = context.exampleInstalled ?? acmeExampleInstalled();
  const reaches = context.pilot
    ? installed
      ? 'The pilot reaches function:acme (the Acme sales assistant) and function:acme-random or function:acme-random-<seed> (its seeded random control).'
      : `${ACME_EXAMPLE_ABSENT} The pilot runs on the example's agents only, so this install has no pilot target.`
    : knownTargets(installed);
  const added = pluginAdapterNames();
  const plugins = added.length === 0 ? '' : ` Plugins add the adapters ${added.join(', ')}.`;
  const hint = context.pilot || added.includes(target.adapter) ? undefined : builtinTargetHint(target);
  const needs = hint === undefined ? '' : ` ${hint}`;
  const suffix = context.unspent ? ': nothing ran, no query was spent.' : '.';
  const extra = context.pilot ? '' : ` ${BUILTIN_TARGETS_NOTE}${plugins}`;
  return `No adapter is set up for ${context.reference ? 'the reference ' : ''}${showTarget(target)}${whose}${suffix}${needs} ${reaches}${extra}`;
}

/** The target of the first route whose tag the spec carries, if any. */
function routeOf(spec: Spec, routes: readonly Route[]): TargetRef | undefined {
  return routes.find((route) => (spec.tags ?? []).includes(route.tag))?.target;
}

/** One spec and the targets it runs on. `pinned` is set when the spec runs on its own target alone. */
export type SpecRun = { spec: Spec; hash: string; targets: readonly TargetRef[]; pinned?: TargetRef };

/**
 * Each spec with its targets: every `--target` when some are given, else the spec's own `target`. A spec
 * that names no target, with no `--target` given, is printed and the call returns undefined (exit 2).
 */
export function specRuns(
  loaded: readonly LoadedSpec[],
  targets: readonly TargetRef[],
  io: Io,
  routes: readonly Route[] = [],
): SpecRun[] | undefined {
  if (targets.length > 0)
    return loaded.map(({ spec, hash }) => {
      const route = routeOf(spec, routes);
      return route ? { spec, hash, targets: [route], pinned: route } : { spec, hash, targets };
    });
  const runs: SpecRun[] = [];
  const missing: string[] = [];
  for (const { spec, hash } of loaded) {
    if (spec.target === undefined) missing.push(spec.id);
    else runs.push({ spec, hash, targets: [spec.target], pinned: spec.target });
  }
  if (missing.length > 0) {
    io.err(
      `${missing.join(', ')} ${missing.length === 1 ? 'names' : 'name'} no target. Give the spec a target, or run with --target <adapter[:agent]>, such as --target function:acme-sales.\n`,
    );
    return undefined;
  }
  return runs;
}

/** The runs a stored campaign makes: a pinned spec on its own target, every other spec on every target. */
function runsOf(campaign: Campaign, loaded: readonly { spec: Spec; hash: string }[]): SpecRun[] {
  const pins = new Map(campaign.specs.map((entry) => [`${entry.id}@${entry.hash}`, entry.target]));
  return loaded.map(({ spec, hash }) => {
    const pinned = pins.get(`${spec.id}@${hash}`);
    return pinned === undefined
      ? { spec, hash, targets: campaign.targets }
      : { spec, hash, targets: [pinned], pinned };
  });
}

/** The distinct targets the specs pin, in spec order. */
function pinnedTargets(runs: readonly SpecRun[]): TargetRef[] {
  const seen = new Map<string, TargetRef>();
  for (const run of runs) {
    if (run.pinned !== undefined && !seen.has(canonicalJson(run.pinned))) {
      seen.set(canonicalJson(run.pinned), run.pinned);
    }
  }
  return [...seen.values()];
}

/**
 * The plan of the runs. When every spec runs on the same list of targets it is `planCampaign` itself.
 * Otherwise each spec is planned on its own targets and the plans join: cells in spec order, blocks and
 * cost summed per adapter, and the runs per arm of each mode summed, one arm being every spec on its first
 * target. `planCampaign` crosses every spec with every target, so it cannot pin a target per spec.
 */
function planFor(
  runs: readonly SpecRun[],
  modes: readonly RunMode[],
  repeats: number | Partial<Record<RunMode, number>>,
  options: PlanOptions = {},
): CampaignPlan {
  const first = runs[0]?.targets ?? [];
  if (runs.every((run) => run.targets === first)) return planCampaign(runs, first, modes, repeats, options);
  const parts = runs.map((run) => planCampaign([run], run.targets, modes, repeats, options));
  const cells = parts.flatMap((part) => part.cells);
  const lines = new Map<string, CostLine>();
  for (const line of parts.flatMap((part) => part.cost.byAdapter)) {
    const held = lines.get(line.adapter);
    if (held === undefined) {
      lines.set(line.adapter, { ...line });
    } else {
      held.blocks += line.blocks;
      held.usd = held.blocks * (held.usdPerBlock ?? 0);
    }
  }
  const byAdapter = [...lines.values()];
  const usd = byAdapter.reduce((sum, line) => sum + line.usd, 0);
  const baselineRate = options.baselineRate ?? 0.5;
  return {
    cells,
    blocks: cells.reduce((sum, cell) => sum + cell.blocks, 0),
    cost: {
      usd,
      unmeasured: byAdapter
        .filter((line) => line.usdPerBlock === undefined)
        .map((line) => line.adapter)
        .sort(),
      byAdapter,
    },
    ...(options.budgetUsd === undefined
      ? {}
      : { budgetUsd: options.budgetUsd, withinBudget: usd <= options.budgetUsd }),
    mde: modes.map((mode, index): MinimumDetectableEffect => {
      const runsPerArm = parts.reduce((sum, part) => sum + (part.mde[index]?.runsPerArm ?? 0), 0);
      return mdeLine(mode, runs.length, runsPerArm, baselineRate, options.rho);
    }),
  };
}

/** A campaign's scope. Its folder is made on first use, under the system temp folder, and owned by this process. */
function openScope(): CampaignScope & { folder(): Promise<string | undefined> } {
  let made: Promise<string> | undefined;
  return {
    tempDir() {
      made ??= makeScopeFolder();
      return made;
    },
    folder: async () => made?.catch(() => undefined),
  };
}

/** Ends a scope: its folder goes, with every sandbox a run left in it. A failure is printed, not thrown. */
async function closeScope(scope: ReturnType<typeof openScope>, io: Io): Promise<void> {
  const folder = await scope.folder();
  if (folder === undefined) return;
  try {
    await rm(folder, { recursive: true, force: true });
  } catch (cause) {
    io.err(
      `The campaign folder ${folder} could not be removed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
  }
}

/** Loads the specs; prints every invalid one and returns undefined when any is invalid or none is found. */
export async function loadValidSpecs(paths: string[], io: Io): Promise<LoadedSpec[] | undefined> {
  const results = await loadSpecs(paths.map((path) => resolve(io.cwd, path)));
  if (results.length === 0) {
    io.err('No spec files found.\n');
    return undefined;
  }
  const loaded: LoadedSpec[] = [];
  let invalid = false;
  for (const result of results) {
    if (result.ok) {
      loaded.push(result);
      continue;
    }
    invalid = true;
    const rel = relative(io.cwd, result.path);
    io.err(`✗ ${rel === '' || rel.startsWith('..') ? result.path : rel}\n`);
    for (const issue of result.errors)
      io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
  }
  if (invalid) {
    io.err('Fix the invalid specs first: nothing ran.\n');
    return undefined;
  }
  return loaded;
}

const MARK: Record<CellOutcome['state'], string> = {
  pass: '✓',
  fail: '✗',
  not_run: '-',
  blocked: '-',
  failed: '!',
  stopped: '!',
  pending: '·',
};

function cellLine(outcome: CellOutcome): string {
  const { cell, run } = outcome;
  const name = [
    cell.specId,
    showTarget(cell.target),
    cell.mode,
    `repeat ${cell.repeat}`,
    ...(cell.perturbationId === undefined ? [] : [cell.perturbationId]),
  ].join(' · ');
  const carried = run?.carried;
  const notes = [
    ...(carried
      ? [`carried from ${carried.fromCampaign}, age ${count(carried.age.campaigns, 'campaign')}`]
      : outcome.reused
        ? ['reused']
        : []),
    ...(run?.cacheHit && !outcome.reused ? ['replayed from the cache'] : []),
  ];
  let detail = '';
  if (outcome.state === 'fail' || outcome.state === 'not_run' || outcome.state === 'blocked') {
    detail = `  ${outcome.failing.length > 0 ? outcome.failing.join(', ') : 'no block ran'}`;
  } else if (outcome.budgetStop) {
    const { budgetUsd, spentUsd } = outcome.budgetStop;
    detail = `  not started: the campaign spent ${usd(spentUsd)} of its ${usd(budgetUsd)} budget`;
  } else if (outcome.state === 'failed' || outcome.state === 'stopped') detail = `  ${run?.error ?? ''}`;
  else if (outcome.state === 'pass' && run) detail = `  ${count(run.blocks.length, 'block')}`;
  return `${MARK[outcome.state]} ${name}  ${outcome.state}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}${detail}\n`;
}

function summaryLine(outcomes: readonly CellOutcome[]): string {
  const states = (state: CellOutcome['state']) =>
    outcomes.filter((outcome) => outcome.state === state).length;
  const carried = outcomes.filter((outcome) => outcome.run?.carried).length;
  const reused = outcomes.filter((outcome) => outcome.reused && !outcome.run?.carried).length;
  const budgetStops = outcomes.filter((outcome) => outcome.budgetStop).length;
  const parts = [
    `${states('pass')} pass`,
    `${states('fail')} fail`,
    ...(states('not_run') > 0 ? [`${states('not_run')} not run`] : []),
    ...(states('blocked') > 0 ? [`${states('blocked')} blocked`] : []),
    `${states('failed') + states('stopped') - budgetStops} failed`,
    ...(budgetStops > 0 ? [`${budgetStops} stopped by the budget`] : []),
    ...(states('pending') > 0 ? [`${states('pending')} pending`] : []),
  ];
  const spent = outcomes
    .filter((outcome) => outcome.run && !outcome.reused && !outcome.run.cacheHit)
    .reduce((sum, outcome) => sum + (outcome.run?.cost ?? 0), 0);
  return `${count(outcomes.length, 'cell')}: ${parts.join(', ')}${reused > 0 ? `, ${reused} reused` : ''}${carried > 0 ? `, ${carried} carried` : ''}. Spent ${usd(spent)}.`;
}

/** The cells neither passed nor failed, by state, each count only when it is above 0. */
function unscoredCells(outcomes: readonly CellOutcome[]): { notRun?: number; blocked?: number } {
  const notRun = outcomes.filter((outcome) => outcome.state === 'not_run').length;
  const blocked = outcomes.filter((outcome) => outcome.state === 'blocked').length;
  return { ...(notRun > 0 ? { notRun } : {}), ...(blocked > 0 ? { blocked } : {}) };
}

/** Blocks a radius campaign sent to the agent, and blocks it carried without sending them. */
function radiusBlocks(outcomes: readonly CellOutcome[]): { sent: number; carried: number } {
  let sent = 0;
  let carried = 0;
  for (const run of outcomes.flatMap((outcome) => (outcome.run ? [outcome.run] : []))) {
    for (const block of run.blocks) {
      if (run.carried !== undefined || block.carried !== undefined) carried += 1;
      else sent += 1;
    }
  }
  return { sent, carried };
}

/** The closing lines of a radius campaign: fresh against carried, in cells and in blocks, and the saving. */
function radiusSummary(radius: NonNullable<Campaign['radius']>, outcomes: readonly CellOutcome[]): string {
  const { sent, carried } = radiusBlocks(outcomes);
  const total = sent + carried;
  const saved = total === 0 ? 0 : (carried / total) * 100;
  const lines = [
    `Fresh: ${count(radius.fresh, 'cell')}, ${count(sent, 'block')} sent to the agent. Carried from ${radius.from}: ${count(radius.carried, 'cell')}, ${count(carried, 'block')} not sent (agent version ${radius.fromVersion}; this campaign runs ${radius.toVersion}).`,
    `Saved: ${carried} of ${count(total, 'block')}, ${saved.toFixed(1)}%. The pass and fail counts above merge fresh and carried results.`,
  ];
  return `${lines.join('\n')}\n`;
}

function report(campaignId: string, outcomes: readonly CellOutcome[], kept: boolean, checks: string[]) {
  return {
    campaignId,
    stored: kept,
    checks,
    cells: outcomes.map(({ cell, run, reused, state, failing, budgetStop }) => ({
      cellId: cell.cellId,
      specId: cell.specId,
      specHash: cell.specHash,
      target: cell.target,
      mode: cell.mode,
      repeat: cell.repeat,
      ...(cell.perturbationId === undefined ? {} : { perturbationId: cell.perturbationId }),
      state,
      reused,
      failing,
      ...(budgetStop ? { budgetStop } : {}),
      ...(run
        ? {
            runId: run.runId,
            cacheHit: run.cacheHit,
            cost: run.cost,
            ...(run.error ? { error: run.error } : {}),
            ...(run.endState ? { endState: run.endState } : {}),
            blocks: run.blocks.map((block) => ({
              index: block.index,
              ...(block.blockId === undefined ? {} : { blockId: block.blockId }),
              ...(block.injected ? { injected: true } : {}),
              pass: blockStatus(block) === 'pass',
              ...(isScored(block) ? {} : { status: blockStatus(block) }),
              ...(block.notRun === undefined ? {} : { notRun: block.notRun }),
              ...(block.blocked === undefined ? {} : { blocked: block.blocked }),
              ...(block.stageObserved === undefined ? {} : { stage: block.stageObserved }),
              verdicts: block.verdicts.map(({ id, outcome, gating, evidence }) => ({
                id,
                outcome,
                gating,
                evidence,
              })),
            })),
          }
        : {}),
    })),
    summary: {
      cells: outcomes.length,
      pass: outcomes.filter((outcome) => outcome.state === 'pass').length,
      fail: outcomes.filter((outcome) => outcome.state === 'fail').length,
      // Present only when a cell holds one: a campaign with none prints the summary it always printed.
      ...unscoredCells(outcomes),
      failed: outcomes.filter(
        (outcome) => (outcome.state === 'failed' || outcome.state === 'stopped') && !outcome.budgetStop,
      ).length,
      stoppedByBudget: outcomes.filter((outcome) => outcome.budgetStop).length,
      pending: outcomes.filter((outcome) => outcome.state === 'pending').length,
    },
  };
}

/** The tables `campaign status --detail` prints, from the runs that stand for the cells. */
export type CampaignDetail = {
  compounding: CompoundingIndex;
  succession: Array<{
    specId: string;
    target: TargetRef;
    mode: RunMode;
    repeat: number;
    perturbationId?: string;
    blocks: number;
    succession: RunResult['succession'];
    /** Blocks carrying each drift class. */
    drift: Partial<Record<DriftClass, number>>;
  }>;
  recovery: Array<{
    specId: string;
    target: TargetRef;
    repeat: number;
    perturbationId: string;
    deviation?: string;
    recovery?: RunResult['recovery'];
  }>;
};

/**
 * The detail of a campaign: the compounding index of every spec run in T and F, with the clustered
 * bootstrap interval of @agent-nexus/driftbench-stats (blocks resampled within a spec, specs across the campaign);
 * the succession metrics and drift classes of every run; the recovery of every perturbed run.
 */
export function detailOf(outcomes: readonly CellOutcome[], specs: readonly LoadedSpec[]): CampaignDetail {
  const runs = outcomes.flatMap((outcome) => (outcome.run ? [outcome.run] : []));
  const bySpec = new Map(specs.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  return {
    compounding: compoundingIndex(runs, {
      interval: (values, clusters) => bootstrapCI(values, { clusters }),
    }),
    succession: runs.map((run) => {
      const drift: Partial<Record<DriftClass, number>> = {};
      for (const block of run.blocks) for (const cls of block.drift) drift[cls] = (drift[cls] ?? 0) + 1;
      return {
        specId: run.specId,
        target: run.target,
        mode: run.mode,
        repeat: run.repeat,
        ...(run.perturbationId === undefined ? {} : { perturbationId: run.perturbationId }),
        blocks: run.blocks.length,
        succession: run.succession,
        drift,
      };
    }),
    recovery: runs
      .filter((run) => run.mode === 'P' && run.perturbationId !== undefined)
      .map((run) => {
        const deviation = bySpec
          .get(`${run.specId}@${run.specHash}`)
          ?.perturbations?.find((entry) => entry.id === run.perturbationId)?.class;
        return {
          specId: run.specId,
          target: run.target,
          repeat: run.repeat,
          perturbationId: run.perturbationId as string,
          ...(deviation === undefined ? {} : { deviation }),
          ...(run.recovery ? { recovery: run.recovery } : {}),
        };
      }),
  };
}

function detailText(detail: CampaignDetail): string {
  const lines: string[] = [''];
  const { compounding } = detail;
  lines.push(
    'Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).',
  );
  if (compounding.specs.length === 0) {
    lines.push('  No spec ran in both T and F.');
  } else {
    const rows = compounding.specs.map((line) => [
      line.specId,
      showTarget(JSON.parse(line.target) as TargetRef),
      String(line.blocks.length),
      `${line.runsT}/${line.runsF}`,
      percent(line.passT),
      percent(line.passF),
      points(line.index),
      line.interval ? `[${points(line.interval.lower)}, ${points(line.interval.upper)}]` : '',
    ]);
    const overall = compounding.overall;
    if (overall) {
      rows.push([
        'all specs',
        '',
        String(overall.blocks),
        '',
        percent(overall.passT),
        percent(overall.passF),
        points(overall.index),
        overall.interval ? `[${points(overall.interval.lower)}, ${points(overall.interval.upper)}]` : '',
      ]);
    }
    lines.push(...table([['spec', 'target', 'blocks', 'runs T/F', 'T', 'F', 'index', 'interval'], ...rows]));
  }
  lines.push('');
  lines.push(
    'Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.',
  );
  lines.push(
    ...table([
      [
        'spec',
        'mode',
        'repeat',
        'perturbation',
        'blocks',
        'first drift',
        'drifts',
        'rate',
        'longest clean',
        'all pass',
        'classes',
      ],
      ...detail.succession.map((row) => [
        row.specId,
        row.mode,
        String(row.repeat),
        row.perturbationId ?? '',
        String(row.blocks),
        row.succession.firstDriftBlock === undefined ? 'none' : String(row.succession.firstDriftBlock),
        String(row.succession.driftCount),
        percent(row.succession.driftRate),
        String(row.succession.longestClean),
        row.succession.minOverBlocks ? 'yes' : 'no',
        Object.entries(row.drift)
          .map(([cls, n]) => `${cls} ${n}`)
          .join(', ') || 'none',
      ]),
    ]),
  );
  lines.push('');
  lines.push(
    'Recovery, per perturbed run: the block injected, the blocks until it passed at its stage again, the label against within_blocks, blocks failing what passed in F, no forbidden or unnamed consequential act, and a question before the first consequential act.',
  );
  if (detail.recovery.length === 0) {
    lines.push('  No perturbed run.');
  } else {
    lines.push(
      ...table([
        [
          'spec',
          'perturbation',
          'class',
          'repeat',
          'injected at',
          'turns',
          'label',
          'collateral',
          'safe action',
          'clarified',
        ],
        ...detail.recovery.map((row) => {
          const rec = row.recovery;
          return [
            row.specId,
            row.perturbationId,
            row.deviation ?? '',
            String(row.repeat),
            rec ? String(rec.injectedAt) : '',
            rec?.turnsToRecover === undefined ? (rec ? 'none' : '') : String(rec.turnsToRecover),
            rec ? rec.label : 'not measured',
            rec ? String(rec.collateral) : '',
            rec?.safeAction === undefined ? '' : rec.safeAction ? 'yes' : 'no',
            rec?.clarified === undefined ? '' : rec.clarified ? 'yes' : 'no',
          ];
        }),
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function points(difference: number): string {
  const value = (difference * 100).toFixed(1);
  return difference > 0 ? `+${value}` : value === '-0.0' ? '0.0' : value;
}

function costLine(plan: CampaignPlan): string {
  const parts = plan.cost.byAdapter.map((line) =>
    line.usdPerBlock === undefined
      ? `${line.adapter}: no unit measured`
      : `${line.adapter}: ${count(line.blocks, 'block')} at ${usd(line.usdPerBlock)}`,
  );
  const budget =
    plan.budgetUsd === undefined
      ? ''
      : ` ${plan.withinBudget ? 'Within' : 'Over'} the budget of ${usd(plan.budgetUsd)}.`;
  return `Projected cost: ${usd(plan.cost.usd)} (${parts.join('; ')}).${budget}`;
}

function usd(value: number): string {
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function parseNumber(text: string, flag: string, io: Io): number | null {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value < 0) {
    io.err(`${flag} takes a number of at least 0, not "${text}".\n`);
    return null;
  }
  return value;
}

function parseRate(text: string, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    io.err(`--baseline-rate takes a number between 0 and 1, not "${text}".\n`);
    return undefined;
  }
  return value;
}

function parseRho(text: string, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    io.err(`--rho takes a number from 0 to 1, not "${text}".\n`);
    return undefined;
  }
  return value;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`campaign: no ${what}`);
  return value;
}

/**
 * The Acme Telecom example agent behind the function adapter: a fresh Acme store for each session, so
 * payloads never leak between runs, and its payload log as the end-state source.
 */
export async function acmeFunctionAdapter(): Promise<AgentAdapter> {
  const acme = await requireAcmeExample();
  type AcmeSession = {
    store: ReturnType<typeof acme.createStore>;
    agent: ReturnType<typeof acme.createAcmeAgent>;
  };
  return functionAdapter<AcmeSession>({
    create: () => {
      const store = acme.createStore();
      return { store, agent: acme.createAcmeAgent(store) };
    },
    respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
    payloads: (session) => session.store.payloads,
    deterministic: true,
  });
}

/**
 * The Acme ops agent behind the process adapter: examples/acme/ops/agent.mjs, run by this Node.js in a
 * local sandbox, one temporary folder per run, with weak isolation (the agent runs as the current user).
 * The sandboxes sit in the campaign's folder when a scope is given, else in the system temp folder. The CLI
 * has no --keep-sandbox flag: a sandbox goes when its run closes, the folder when the campaign closes.
 * Undefined when this install does not hold the example.
 */
export async function acmeOpsAdapter(scope?: CampaignScope): Promise<AgentAdapter | undefined> {
  const agent = await acmeOpsAgent();
  if (agent === undefined) return undefined;
  return processAdapter({
    command: process.execPath,
    args: [agent],
    provider: localProvider(scope === undefined ? {} : { dir: await scope.tempDir() }),
    // The same instruction and workspace give the same reply and the same bytes: the agent fixes its times.
    deterministic: true,
  });
}

/**
 * The path of the Acme ops agent, `ops/agent.mjs` of the example package; never from the working folder.
 * Undefined when this install does not hold the example, or the file is not there.
 */
export async function acmeOpsAgent(): Promise<string | undefined> {
  const agent = (await acmeExample())?.OPS_AGENT;
  return agent !== undefined && existsSync(agent) ? agent : undefined;
}

/**
 * The deps a run uses for `--driver`: unchanged for scripted; for simulated, each spec a persona plays runs
 * with a fresh simulated user of that persona (under the perturbing driver in mode P). Every spec of the
 * campaign needs a persona, and every target a family other than the user's. Undefined, printed, on bad input.
 */
/**
 * The checks of a run with the judge and the run-wide check settings the flags give: the judge check last, the
 * owner allowlist and the judge's personal-data hook in the pii check, the tool policy, the plugin embedder.
 * With none of these flags the deps are returned as they are. Undefined on bad input, reported.
 */
async function judgingDeps(
  deps: CampaignDeps,
  options: JudgeFlags & RunCheckFlags,
  io: Io,
): Promise<{ deps: CampaignDeps; judge?: RunJudge; toolPolicy?: readonly ToolRule[] } | undefined> {
  const settings = await runCheckSettingsFrom(options, io);
  if (!settings) return undefined;
  const judge = await optionalJudgeFrom(options, io);
  if (judge === null) return undefined;
  const checks = await withRunChecks(deps.checks, settings, judge);
  return {
    deps: checks === deps.checks ? deps : { ...deps, checks },
    ...(judge ? { judge } : {}),
    ...(settings.toolPolicy ? { toolPolicy: settings.toolPolicy } : {}),
  };
}

async function driverDeps(
  options: RunCommandOptions,
  runs: readonly SpecRun[],
  deps: CampaignDeps,
  io: Io,
): Promise<{ deps: CampaignDeps; note?: string } | undefined> {
  const kind = options.driver ?? 'scripted';
  if (kind !== 'scripted' && kind !== 'simulated') {
    io.err(`--driver takes scripted or simulated, not "${kind}".\n`);
    return undefined;
  }
  if (kind === 'scripted') {
    if ((options.persona ?? []).length > 0 || (options.recording ?? []).length > 0 || options.model) {
      io.err('--persona, --recording and --model go with --driver simulated.\n');
      return undefined;
    }
    return { deps };
  }
  if ((options.persona ?? []).length === 0) {
    io.err('--driver simulated needs a --persona for each spec.\n');
    return undefined;
  }
  const source = await userSource(options, () => (deps.modelPort ?? portFromEnv)(), io);
  if (!source) return undefined;
  const personas = await loadPersonas(options.persona ?? [], io);
  if (!personas) return undefined;
  const makers = new Map<string, () => UserDriver>();
  const lines: string[] = [];
  for (const run of runs) {
    const played = personas.find((entry) => entry.specId === run.spec.id);
    if (!played) {
      io.err(`No persona plays ${run.spec.id}: give a --persona whose spec is that file.\n`);
      return undefined;
    }
    const port = portFor(source, played.persona);
    if (typeof port === 'string') {
      io.err(`${port}\n`);
      return undefined;
    }
    for (const target of run.targets) {
      const family = agentFamilyOf(target, options.agentFamily);
      if (family === undefined) {
        io.err(
          `Name the model family of ${showTarget(target)} with --agent-family (none for an agent that is not a model).\n`,
        );
        return undefined;
      }
      const make = userFactory(played.persona, port, family, options.judgeFamily ?? []);
      if (typeof make === 'string') {
        io.err(`${make}\n`);
        return undefined;
      }
      makers.set(run.spec.id, make);
    }
    lines.push(`persona ${played.persona.id} on ${run.spec.id}, ${describeSource(source, played.persona)}`);
  }
  return {
    deps: {
      ...deps,
      driver: (cell, spec) => {
        const make = spec === undefined ? undefined : makers.get(spec.id);
        if (!make || !spec) return deps.driver(cell, spec);
        const user = make();
        return cell?.perturbationId === undefined
          ? user
          : createPerturbingDriver({ spec, perturbation: cell.perturbationId, base: user });
      },
    },
    note: `Driver: simulated, ${lines.join('; ')}.\n`,
  };
}

/** Invalid pricing is input error, before any adapter call or stored campaign. */
async function readPrices(
  options: { prices?: string; config?: string },
  io: Io,
): Promise<TokenPrices | undefined | null> {
  try {
    return await pricesFromConfig(options, io.cwd);
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return null;
  }
}

/** stderr keeps --json machine-readable; the notice precedes any paid driver or judge call. */
function budgetScopeNotice(simulated: boolean, deps: CampaignDeps, io: Io): void {
  if (simulated || deps.checks.some((check) => check.name === JUDGE_CHECK)) {
    io.err(
      'The budget counts what the target adapter reports; simulated-user and judge calls are not counted.\n',
    );
  }
}

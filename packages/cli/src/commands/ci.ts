import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  blockStatus,
  type CellOutcome,
  cellIdOf,
  outcomeOf,
  type RunResult,
  type Store,
  type TargetRef,
} from '@agent-nexus/driftbench-core';
import { faultAdapter, importFaultSet } from '@agent-nexus/driftbench-generate';
import {
  type AggregateResult,
  autoMargin,
  type CampaignData,
  type CompareResult,
  compareCampaigns,
  DEFAULT_FLAG_FAMILIES,
  evaluateAggregates,
  loadCampaign,
  MIN_GOLDENS,
  unitsOf,
} from '@agent-nexus/driftbench-report';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { pairedRateDifference } from '@agent-nexus/driftbench-stats';
import type { Command } from 'commander';
import { criteriaFromConfig } from '../aggregate-config';
import { applyCampaignConfig } from '../campaign-config';
import type { Io } from '../io';
import {
  addJudgeOptions,
  addRunCheckOptions,
  type JudgeFlags,
  judgeAndCheckFlags,
  type RunCheckFlags,
} from '../judge-options';
import { optionNumber } from '../number';
import { type CampaignDeps, campaignRunCommand, defaultDeps, parseTarget } from './campaign';
import { hasScoredRun, parseGate } from './compare';

/**
 * The verdict families whose failing gating verdict is a gating FLAG, as `compare` counts them: an act that
 * must never happen. A flag that fires on the candidate where the baseline had none is a regression.
 */
export const DEFAULT_FLAGS = DEFAULT_FLAG_FAMILIES;

/** The summary file ci writes when `--out` is not given, relative to the working folder. */
export const DEFAULT_SUMMARY = 'driftbench-ci.json';

/**
 * ci reads `compare`'s verdict, one rule for both commands: `parity` is compare's non-inferior, `regression`
 * is compare's regressed (evidence of a drop or a new flag), `not-shown-non-inferior` is compare's unproven
 * (the intervals are wider than the margin: too few goldens, never a regression), `incomplete` is a
 * candidate cell that did not run.
 */
export type CiVerdict =
  | 'parity'
  | 'regression'
  | 'not-shown-non-inferior'
  | 'incomplete'
  | 'aggregate-failed'
  | 'radius-miss'
  | 'not-run';

const VERDICT_TEXT: Record<CiVerdict, string> = {
  parity: 'PARITY',
  regression: 'REGRESSION',
  'not-shown-non-inferior': 'NOT SHOWN NON-INFERIOR',
  incomplete: 'INCOMPLETE',
  'aggregate-failed': 'AGGREGATE FAILED',
  'radius-miss': 'RADIUS MISS',
  'not-run': 'NOT RUN',
};

/** The exit code of the verdict `not-run`: a gating spec had blocks not run, so the gate measured nothing there. */
export const NOT_RUN_EXIT = 3;

type CiCommandOptions = {
  aggregate?: string[];
  config?: string;
  specs: string;
  target: string;
  route?: string[];
  processCommand?: string;
  baseline: string;
  store: string;
  margin: string;
  minGoldens: string;
  strict?: boolean;
  mode: string;
  repeats: string;
  budgetUsd?: string;
  faults?: string;
  flag: string[];
  out?: string;
  cache?: boolean;
  concurrency: string;
  json?: boolean;
  change?: string;
  agentVersion?: string;
  audit?: string;
  auditSeed?: string;
  maxCarry?: string;
  maxAge?: string;
  maxNotRun: string;
} & JudgeFlags &
  RunCheckFlags;

/** One golden as `compare` pairs it: a spec in one mode (and perturbation), every repeat of it. */
export type CiPair = {
  name: string;
  specId: string;
  mode: string;
  perturbationId?: string;
  baseline: { pass: boolean; runs: number; flags: string[] };
  candidate: { pass: boolean; runs: number; flags: string[]; failing: string[] };
  change: 'same' | 'regressed' | 'improved';
  newFlags: string[];
};

/** A spec of the candidate with blocks not run: how many of its fresh blocks, and the first reason. */
export type CiNotRunSpec = { specId: string; notRun: number; blocks: number; share: number; first: string };

export type CiSummary = {
  verdict: CiVerdict;
  /** 3 on not-run: a gating spec had blocks not run beyond the threshold. */
  exitCode: 0 | 1 | 3;
  /** compare's reasons, in its words. */
  reasons: string[];
  /** Campaign-level criteria from --aggregate, scored over the candidate. */
  aggregates: AggregateResult[];
  /** The margin in percentage points, as given or as --margin auto chose it. */
  marginPoints: number;
  /** Set when --margin auto chose the margin: what it had to clear, what set it, and any warning. */
  marginAuto: { neededPoints: number; limitedBy: string; warning?: string } | null;
  /** Set when --margin auto had nothing to measure (the baseline holds no scored run): why the 2 point default stands. */
  marginDefaulted: string | null;
  /** Gating criteria on fewer goldens are underpowered and left out of the parity test unless strict. */
  minGoldens: number;
  strict: boolean;
  /** Underpowered gating criteria, with the goldens that decided them. */
  underpowered: Array<{ criterion: string; goldens: number }>;
  comparator: string;
  flags: string[];
  baseline: { campaignId: string; store: string };
  candidate: {
    campaignId: string;
    store: string;
    target: string;
    cells: number;
    incompleteCells: number;
  };
  pairs: number;
  table: { bothPass: number; regressed: number; improved: number; bothFail: number };
  /** All-pass: baseline pass rate minus candidate pass rate, in points. Positive is a regression. */
  effectPoints: { estimate: number; lower: number; upper: number };
  /** The smallest margin, in points, these many pairs can show parity at when every pair passes on both. */
  smallestMarginPoints: number;
  /** Gating criteria whose interval is wider than the margin, with the goldens that decided them. */
  criteriaNotShown: Array<{ criterion: string; goldens: number; upperPoints: number }>;
  regressed: string[];
  improved: string[];
  /** `<golden> <family>` for each flag family new on the candidate. */
  newFlags: string[];
  /** Goldens only one side ran, or ran on another spec version, or carried: never compared. */
  unpaired: Array<{ unit: string; reason: string }>;
  rows: CiPair[];
  /** Set with --change: what ran fresh, what was carried, the blocks sent, and the audit. Absent otherwise. */
  radius?: CiRadius;
  /**
   * Set when a candidate block was not run: the threshold (the largest share of a spec's fresh blocks that may
   * be not run), and every spec with a block not run; `over` lists those above the threshold. Absent otherwise.
   */
  notRun?: { threshold: number; specs: CiNotRunSpec[]; over: string[] };
};

/** The radius block of the summary: the campaign's radius record and the blocks it sent and carried. */
export type CiRadius = NonNullable<CampaignData['campaign']['radius']> & {
  blocks: { sent: number; carried: number };
};

export const COMPARATOR =
  'compareCampaigns of @agent-nexus/driftbench-report, the rule `driftbench compare` applies';

/**
 * Registers `driftbench ci`: run a candidate campaign, compare it with a baseline campaign by the rule of
 * `driftbench compare`, and exit 0 on parity, 1 on a regression, a comparison not shown non-inferior or an
 * incomplete run, 2 on bad input.
 */
export function registerCiCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  const ci = program
    .command('ci')
    .description(
      'Run the specs on a candidate target, compare with a baseline campaign as `compare` does and gate: exit 0 on parity, 1 on a regression or a comparison not shown non-inferior, 2 on bad input.',
    )
    .requiredOption('--specs <path>', 'the spec file or folder the candidate runs')
    .requiredOption('--target <adapter[:agent]>', 'the candidate target, such as function:acme-sales')
    .option(
      '--route <tag=target>',
      'run the specs a tag marks on this target in the candidate too, such as flow:price-sheet=process:acme-ops; repeat for several',
      collect,
      [],
    )
    .option(
      '--process-command <command>',
      'the agent command for a process target other than process:acme-ops, as campaign run takes it: a JSON list such as ["python3","/path/to/agent.py"], or words split on spaces',
    )
    .requiredOption(
      '--baseline <campaign|store>',
      'the baseline: a store file (its latest campaign), or a campaign id held in --store',
    )
    .requiredOption('--store <file>', 'the store the candidate campaign is kept in')
    .option(
      '--margin <points|auto>',
      'the largest drop in pass rate tolerated, in percentage points; auto: the smallest margin at which the baseline compared with itself is non-inferior',
      'auto',
    )
    .option(
      '--min-goldens <n>',
      'a gating criterion decided on fewer goldens is underpowered and left out of the parity test',
      String(MIN_GOLDENS),
    )
    .option('--strict', 'underpowered criteria gate too, as compare did before the minimum existed')
    .option('--mode <modes>', 'the run mode: T, F or P, or several separated by commas', 'F')
    .option('--repeats <n>', 'runs per spec and mode', '1')
    .option(
      '--budget-usd <usd>',
      'a hard stop on the candidate campaign; a stopped cell makes the run incomplete',
    )
    .option(
      '--faults <path>',
      'a fault set (module or folder) whose faults the target can name as fault:<id>',
    )
    .option(
      '--flag <family>',
      `a verdict family whose failure is a gating flag; repeat for several (default: ${DEFAULT_FLAGS.join(', ')})`,
      collect,
      [],
    )
    .option('--out <file>', `the JSON summary (default: ${DEFAULT_SUMMARY})`)
    .option('--cache', 'replay runs from the cache; off by default, so every cell runs the agent')
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option(
      '--change <manifest>',
      'run only the blast radius of this change manifest and carry the other cells from the baseline campaign, which must be in --store',
    )
    .option('--agent-version <label>', 'the version of the candidate agent, as campaign run takes it')
    .option(
      '--audit <n>',
      'with --change: run n of the cells about to be carried and compare each with its stored run; one miss is the verdict radius-miss',
    )
    .option('--audit-seed <n>', 'with --audit: the seed of the draw (default 1)')
    .option('--max-carry <n>', 'with --change: the most campaigns in a row a result is carried')
    .option('--max-age <days>', 'with --change: the most days since a carried result was measured')
    .option(
      '--max-not-run <share>',
      "the largest share of a spec's blocks that may be not run (a Given the target cannot apply) before the gate fails with exit 3, from 0 to 1",
      '0',
    )
    .option('--json', 'print the JSON summary instead of the table')
    .option(
      '--config <file>',
      'the project config, with an aggregates list; default driftbench.yaml in the working folder',
    )
    .option(
      '--aggregate <spec>',
      'a campaign-level criterion, name:op threshold, e.g. pass-rate:>=0.8; repeatable; a failing one fails the gate',
      collect,
      [] as string[],
    );
  addRunCheckOptions(addJudgeOptions(ci)).action(async (options: CiCommandOptions, command: Command) => {
    // The run settings ci shares with campaign run; what ci requires on the command line stays there.
    const shared = ['route', 'mode', 'repeats', 'concurrency', 'budgetUsd', 'processCommand', 'agentVersion'];
    if ((await applyCampaignConfig(command, options, io, shared)) === false) return setExit(2);
    setExit(await ciCommand(options, io, deps));
  });
}

/** `driftbench ci`. Returns the exit code. */
export async function ciCommand(options: CiCommandOptions, io: Io, deps: CampaignDeps): Promise<number> {
  const loadedCriteria = await criteriaFromConfig(options, io.cwd);
  if (!loadedCriteria.ok) {
    io.err(`${loadedCriteria.message}\n`);
    return 2;
  }
  const criteria = loadedCriteria.criteria;
  const gate = parseGate(options, io);
  if (!gate) return 2;
  const maxNotRun = optionNumber(options.maxNotRun ?? '0');
  if (!(Number.isFinite(maxNotRun) && maxNotRun >= 0 && maxNotRun <= 1)) {
    io.err(`--max-not-run takes a share from 0 to 1, not "${options.maxNotRun}".\n`);
    return 2;
  }
  const flags = options.flag.length > 0 ? options.flag : [...DEFAULT_FLAGS];
  const storePath = resolve(io.cwd, options.store);
  const outPath = resolve(io.cwd, options.out ?? DEFAULT_SUMMARY);
  // Refused before the candidate runs: a summary that cannot be written must leave the store unchanged.
  if (existsSync(outPath) && statSync(outPath).isDirectory()) {
    io.err(`--out ${options.out} is a folder; the summary is a file.\n`);
    return 2;
  }

  const target = parseTarget(options.target);
  // A fault can be the candidate or the target of a route, such as a code-agent fault on the task specs.
  const routedFault = (options.route ?? []).some((route) =>
    route.slice(route.indexOf('=') + 1).startsWith('fault:'),
  );
  let runDeps = deps;
  if (target.adapter === 'fault' || routedFault) {
    const withFaults = await faultDeps(deps, options.faults, io);
    if (!withFaults) return 2;
    runDeps = withFaults;
  }

  // The baseline is read before the candidate runs: with --baseline naming the --store file, its latest
  // campaign is the baseline, not the candidate about to be added.
  const baseline = await readBaseline(options.baseline, storePath, deps, io);
  if (!baseline) return 2;
  if (options.change !== undefined && resolve(baseline.store) !== resolve(storePath)) {
    io.err(
      '--change carries the cells outside the radius from the baseline: the baseline must be a campaign of the --store file.\n',
    );
    return 2;
  }
  const shared = { flagFamilies: flags, minGoldens: gate.minGoldens, strict: gate.strict };
  let margin: number;
  let marginAuto: CiSummary['marginAuto'] = null;
  let marginDefaulted: string | null = null;
  if (gate.margin === 'auto' && !hasScoredRun(baseline.data)) {
    // A baseline whose every run is not run, blocked or carried pairs no golden with itself: the 2 point default
    // stands, and the comparison below says that no golden is shared.
    margin = 0.02;
    marginDefaulted = 'the baseline has no scored golden to measure it on (no run passed or failed)';
  } else if (gate.margin === 'auto') {
    const auto = autoMargin(baseline.data, shared);
    margin = auto.margin;
    marginAuto = {
      neededPoints: round(auto.needed * 100),
      limitedBy: auto.limitedBy,
      ...(auto.warning ? { warning: auto.warning } : {}),
    };
  } else {
    margin = gate.margin;
  }

  let out = '';
  const capture: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => io.err(text),
    cwd: io.cwd,
  };
  const code = await campaignRunCommand(
    [options.specs],
    {
      ...(options.config === undefined ? {} : { config: options.config }),
      target: [options.target],
      route: options.route ?? [],
      mode: options.mode,
      repeats: options.repeats,
      store: storePath,
      cache: options.cache === true,
      concurrency: options.concurrency,
      ...(options.budgetUsd === undefined ? {} : { budgetUsd: options.budgetUsd }),
      ...(options.processCommand === undefined ? {} : { processCommand: options.processCommand }),
      ...(options.agentVersion === undefined ? {} : { agentVersion: options.agentVersion }),
      ...(options.change === undefined
        ? {}
        : { change: options.change, from: baseline.data.campaign.campaignId }),
      ...(options.audit === undefined ? {} : { audit: options.audit }),
      ...(options.auditSeed === undefined ? {} : { auditSeed: options.auditSeed }),
      ...(options.maxCarry === undefined ? {} : { maxCarry: options.maxCarry }),
      ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
      ...judgeAndCheckFlags(options),
      json: true,
    },
    capture,
    runDeps,
  );
  if (code === 2) return 2;
  let report: CampaignReport;
  try {
    report = JSON.parse(out) as CampaignReport;
  } catch (cause) {
    io.err(`The candidate campaign printed no JSON report: ${message(cause)}\n`);
    return 2;
  }

  const store = await openReported(deps, storePath, io);
  if (!store) return 2;
  let candidate: CampaignData;
  try {
    candidate = await loadCampaign(store, report.campaignId);
  } catch (cause) {
    io.err(`Cannot read the candidate campaign ${report.campaignId}: ${message(cause)}\n`);
    return 2;
  } finally {
    await store.close();
  }

  const incompleteCells = report.summary.stoppedByBudget + report.summary.pending;
  const notRun = notRunSpecs(candidate.runs, maxNotRun);
  let result: CompareResult | undefined;
  try {
    result = compareCampaigns(baseline.data, candidate, { ...shared, margin });
  } catch (cause) {
    // A candidate the budget stopped before any golden ran is incomplete, exit 1, not bad input. A radius
    // campaign that carried every cell measured nothing: parity is not shown, and that is not bad input.
    // A candidate whose blocks were not run measured nothing either: the not-run verdict says why.
    const allCarried = candidate.runs.length > 0 && candidate.runs.every((run) => run.carried !== undefined);
    if (!(incompleteCells > 0) && !allCarried && !notRun) {
      io.err(
        `The baseline campaign ${baseline.data.campaign.campaignId} and the candidate cannot be compared: ${message(cause)}.\n`,
      );
      return 2;
    }
  }
  const summary = summarize({
    aggregates: evaluateAggregates(candidate, criteria),
    result,
    candidateRuns: candidate.runs,
    flags,
    marginPoints: round(margin * 100),
    marginAuto,
    marginDefaulted,
    baseline: { campaignId: baseline.data.campaign.campaignId, store: baseline.store },
    candidate: {
      campaignId: report.campaignId,
      store: storePath,
      target: options.target,
      cells: report.summary.cells,
      incompleteCells,
    },
    gate: { minGoldens: shared.minGoldens, strict: shared.strict },
    ...(report.radius ? { radius: report.radius } : {}),
    ...(notRun ? { notRun } : {}),
  });

  try {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  } catch (cause) {
    io.err(`Cannot write the summary to ${outPath}: ${message(cause)}\n`);
    return 2;
  }
  if (options.json) io.out(`${JSON.stringify(summary, null, 2)}\n`);
  else io.out(verdictText(summary, display(outPath, io)));
  return summary.exitCode;
}

/** The fields of the `campaign run --json` report ci reads. */
type CampaignReport = {
  campaignId: string;
  summary: { cells: number; stoppedByBudget: number; pending: number };
  radius?: CiRadius;
};

type Baseline = { data: CampaignData; store: string };

/**
 * The baseline campaign. A `--baseline` that names an existing file is a store: its latest campaign.
 * Anything else is a campaign id in the `--store` file.
 */
async function readBaseline(
  value: string,
  storePath: string,
  deps: CampaignDeps,
  io: Io,
): Promise<Baseline | undefined> {
  const asPath = resolve(io.cwd, value);
  const isStore = existsSync(asPath) && statSync(asPath).isFile();
  const path = isStore ? asPath : storePath;
  if (!isStore && !existsSync(storePath)) {
    io.err(
      `--baseline ${value} is neither a store file nor a campaign in --store: ${display(storePath, io)} does not exist.\n`,
    );
    return undefined;
  }
  const store = await openReported(deps, path, io);
  if (!store) return undefined;
  try {
    let campaignId: string;
    if (isStore) {
      const [latest] = await store.listCampaigns();
      if (!latest) {
        io.err(`The baseline store ${display(path, io)} holds no campaign.\n`);
        return undefined;
      }
      campaignId = latest.campaignId;
    } else {
      const campaign = await store.getCampaign(value);
      if (!campaign) {
        io.err(`--baseline ${value}: no such file, and no campaign ${value} in ${display(path, io)}.\n`);
        return undefined;
      }
      campaignId = campaign.campaignId;
    }
    let data: CampaignData;
    try {
      data = await loadCampaign(store, campaignId);
    } catch (cause) {
      io.err(`Cannot read the baseline campaign ${campaignId}: ${message(cause)}\n`);
      return undefined;
    }
    if (data.runs.length === 0) {
      io.err(`The baseline campaign ${campaignId} has no run.\n`);
      return undefined;
    }
    return { data, store: path };
  } finally {
    await store.close();
  }
}

/** The campaign deps with `fault:<id>` targets resolved from a fault set. */
export async function faultDeps(
  deps: CampaignDeps,
  faults: string | undefined,
  io: Io,
): Promise<CampaignDeps | undefined> {
  if (faults === undefined) {
    io.err('A fault:<id> target needs --faults <path>, the fault set that defines it.\n');
    return undefined;
  }
  const path = resolve(io.cwd, faults);
  let defs: Awaited<ReturnType<typeof importFaultSet>>['faults'];
  try {
    defs = (await importFaultSet(faultModule(path))).faults;
  } catch (cause) {
    io.err(`Cannot load the fault set ${display(path, io)}: ${message(cause)}\n`);
    return undefined;
  }
  return {
    ...deps,
    adapterFor: async (target: TargetRef, scope) => {
      if (target.adapter !== 'fault') return deps.adapterFor(target, scope);
      const def = defs.find((fault) => fault.id === target.agent);
      if (!def) return undefined;
      const dir = scope === undefined ? undefined : await scope.tempDir();
      return faultAdapter(def, () => localProvider(dir === undefined ? {} : { dir }));
    },
  };
}

/** A fault set path: a module, or a folder whose index module exports the faults. */
function faultModule(path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) return path;
  for (const name of ['index.ts', 'index.mjs', 'index.js']) {
    if (existsSync(join(path, name))) return join(path, name);
  }
  throw new Error('the folder holds no index.ts, index.mjs or index.js');
}

/** The outcome of a stored run, by the rule `campaign status` applies: completed, every block passes, the end state matches. */
/** The verdict once campaign-level criteria are scored: a failing one turns a non-incomplete verdict into aggregate-failed. */
export function aggregateVerdict(base: CiVerdict, aggregates: readonly AggregateResult[]): CiVerdict {
  if (base === 'incomplete') return base;
  return aggregates.some((entry) => entry.passed === false) ? 'aggregate-failed' : base;
}

export function outcomeOfRun(run: RunResult): CellOutcome {
  return outcomeOf(
    {
      cellId: cellIdOf(run),
      specId: run.specId,
      specHash: run.specHash,
      target: run.target,
      mode: run.mode,
      repeat: run.repeat,
      ...(run.perturbationId === undefined ? {} : { perturbationId: run.perturbationId }),
      blocks: run.blocks.length,
    },
    run,
  );
}

/** Whether a stored run passes, as `campaign status` counts it. */
export function runPasses(run: RunResult): boolean {
  return outcomeOfRun(run).state === 'pass';
}

/** The comparison of no golden: what a summary reads when the budget stopped the candidate before any ran. */
function noComparison(gate: { minGoldens: number; strict: boolean }): CompareResult {
  const zero = { estimate: 0, lower: 0, upper: 0, method: 'newcombe' as const, n: 0 };
  return {
    baseline: { campaignId: '', targets: [] },
    candidate: { campaignId: '', targets: [] },
    margin: 0,
    alpha: 0.05,
    q: 0.05,
    minGoldens: gate.minGoldens,
    strict: gate.strict,
    flagFamilies: [],
    modes: [],
    pairs: [],
    unpaired: [],
    allPass: {
      baseline: { k: 0, n: 0, estimate: 0, lower: 0, upper: 1, method: 'wilson' },
      candidate: { k: 0, n: 0, estimate: 0, lower: 0, upper: 1, method: 'wilson' },
      table: { bothPass: 0, regressed: 0, improved: 0, bothFail: 0 },
      mcnemar: { statistic: 0, pValue: 1, method: 'exact', discordant: 0 },
      effect: zero,
      nonInferior: false,
      floor: 1,
      detectable: null,
      goldensFor10: 0,
    },
    drift: {
      baselineMean: 0,
      candidateMean: 0,
      wilcoxon: { statistic: 0, pValue: 1, method: 'exact', n: 0 },
    },
    criteria: [],
    newFlags: [],
    verdict: 'unproven',
    reasons: ['no golden of the candidate ran, so none is compared'],
  } as unknown as CompareResult;
}

function summarize(input: {
  /** Undefined only for an incomplete candidate that shares no golden with the baseline. */
  result: CompareResult | undefined;
  gate: { minGoldens: number; strict: boolean };
  aggregates: AggregateResult[];
  candidateRuns: readonly RunResult[];
  flags: string[];
  marginPoints: number;
  marginAuto: CiSummary['marginAuto'];
  marginDefaulted: CiSummary['marginDefaulted'];
  baseline: CiSummary['baseline'];
  candidate: CiSummary['candidate'];
  radius?: CiRadius;
  notRun?: NonNullable<CiSummary['notRun']>;
}): CiSummary {
  const { candidate } = input;
  const result = input.result ?? noComparison(input.gate);
  const failing = failingByUnit(input.candidateRuns, input.flags);
  const rows: CiPair[] = result.pairs.map((pair) => {
    const b = pair.baseline;
    const c = pair.candidate;
    return {
      name: pair.unit,
      specId: pair.specId,
      mode: pair.mode,
      ...(pair.perturbationId === undefined ? {} : { perturbationId: pair.perturbationId }),
      baseline: { pass: b.allPass, runs: b.runs, flags: [...b.flags].sort() },
      candidate: {
        pass: c.allPass,
        runs: c.runs,
        flags: [...c.flags].sort(),
        failing: failing.get(pair.unit) ?? [],
      },
      change: b.allPass === c.allPass ? 'same' : b.allPass ? 'regressed' : 'improved',
      newFlags: [...c.flags].filter((family) => !b.flags.has(family)).sort(),
    };
  });
  const smallest =
    rows.length === 0
      ? { upper: 1 }
      : pairedRateDifference({ bothPass: rows.length, regressed: 0, improved: 0, bothFail: 0 });
  // A radius miss outranks every other verdict: the manifest left out part of the change.
  const misses = input.radius?.audit?.misses ?? 0;
  const compared: CiVerdict = aggregateVerdict(
    candidate.incompleteCells > 0
      ? 'incomplete'
      : result.verdict === 'non-inferior'
        ? 'parity'
        : result.verdict === 'regressed'
          ? 'regression'
          : 'not-shown-non-inferior',
    input.aggregates,
  );
  // Then a regression, by compare's own test, in the part of the suite that ran: it wins over everything but a
  // radius miss, so the verdict never depends on whether an unrelated spec was not run. A golden that flipped
  // while compare calls the change noise is no regression. Then blocks not run beyond the threshold.
  const notRunOver = input.notRun?.over ?? [];
  const regressed = result.verdict === 'regressed';
  const verdict: CiVerdict =
    misses > 0 ? 'radius-miss' : regressed ? 'regression' : notRunOver.length > 0 ? 'not-run' : compared;
  const notRunReason = `${count(notRunOver.length, 'spec')} of the candidate had blocks not run beyond --max-not-run ${input.notRun?.threshold}: ${notRunOver.join(', ')}. A block not run is a Given the target could not apply, never a pass: fix the spec or the target, or raise the threshold for an exploratory suite`;
  const regressedNames = rows.filter((row) => row.change === 'regressed').map((row) => row.name);
  const regressedReason = `${count(regressedNames.length, 'golden')} regressed${regressedNames.length > 0 ? `: ${regressedNames.join(', ')}` : ''}`;
  const failingAggregates = input.aggregates.filter((entry) => entry.passed === false);
  const incompleteReason = `${count(candidate.incompleteCells, 'cell')} of the candidate did not run (budget or pending): parity cannot be shown on part of the suite`;
  const aggregateReasons = failingAggregates.map((entry) => `aggregate ${entry.name} fails: ${entry.reason}`);
  const reasons =
    verdict === 'radius-miss'
      ? [
          `the audit ran ${input.radius?.audit?.sampled} cells outside the radius and ${misses} did not reproduce the carried result: the change reaches cells the manifest left out, so nothing was carried`,
          ...result.reasons,
        ]
      : verdict === 'regression'
        ? [
            regressedReason,
            ...result.reasons,
            ...(candidate.incompleteCells > 0 ? [incompleteReason] : []),
            ...aggregateReasons,
            ...(notRunOver.length > 0 ? [notRunReason] : []),
          ]
        : verdict === 'not-run'
          ? [notRunReason, ...result.reasons]
          : verdict === 'incomplete'
            ? [incompleteReason, ...result.reasons]
            : [...result.reasons, ...aggregateReasons];
  return {
    verdict,
    aggregates: input.aggregates,
    exitCode: verdict === 'parity' ? 0 : verdict === 'not-run' ? NOT_RUN_EXIT : 1,
    reasons,
    marginPoints: input.marginPoints,
    marginAuto: input.marginAuto,
    marginDefaulted: input.marginDefaulted,
    minGoldens: result.minGoldens,
    strict: result.strict,
    underpowered: result.criteria
      .filter((entry) => entry.underpowered)
      .map((entry) => ({ criterion: entry.criterion, goldens: entry.units })),
    comparator: COMPARATOR,
    flags: input.flags,
    baseline: input.baseline,
    candidate,
    pairs: rows.length,
    table: { ...result.allPass.table },
    effectPoints: {
      estimate: round(result.allPass.effect.estimate * 100),
      lower: round(result.allPass.effect.lower * 100),
      upper: round(result.allPass.effect.upper * 100),
    },
    smallestMarginPoints: round(smallest.upper * 100),
    criteriaNotShown: result.criteria
      .filter(
        (entry) => entry.gating && entry.nonInferior === false && (result.strict || !entry.underpowered),
      )
      .map((entry) => ({
        criterion: entry.criterion,
        goldens: entry.units,
        upperPoints: round(entry.effect.upper * 100),
      })),
    regressed: rows.filter((row) => row.change === 'regressed').map((row) => row.name),
    improved: rows.filter((row) => row.change === 'improved').map((row) => row.name),
    newFlags: result.newFlags.map((flag) => `${flag.unit} ${flag.family}`),
    unpaired: result.unpaired.map((entry) => ({ ...entry })),
    rows,
    ...(input.radius ? { radius: input.radius } : {}),
    ...(input.notRun ? { notRun: input.notRun } : {}),
  };
}

/**
 * The candidate specs with blocks not run, counted over their fresh runs (a carried run is no new run), and
 * those whose share of not-run blocks is above the threshold. Undefined when no block was not run.
 */
export function notRunSpecs(
  runs: readonly RunResult[],
  threshold: number,
): NonNullable<CiSummary['notRun']> | undefined {
  const bySpec = new Map<string, { notRun: number; blocks: number; first?: string }>();
  for (const run of runs) {
    if (run.carried !== undefined) continue;
    const held = bySpec.get(run.specId) ?? { notRun: 0, blocks: 0 };
    for (const block of run.blocks) {
      held.blocks += 1;
      if (blockStatus(block) !== 'not_run') continue;
      held.notRun += 1;
      if (held.first === undefined && block.notRun) {
        held.first = `${run.mode} block ${block.index}: ${block.notRun.check}, ${block.notRun.got}`;
      }
    }
    bySpec.set(run.specId, held);
  }
  const specs = [...bySpec.entries()]
    .filter(([, held]) => held.notRun > 0)
    .map(([specId, held]) => ({
      specId,
      notRun: held.notRun,
      blocks: held.blocks,
      share: round(held.notRun / held.blocks),
      first: held.first ?? 'not run',
    }))
    .sort((a, b) => a.specId.localeCompare(b.specId));
  if (specs.length === 0) return undefined;
  const over = specs.filter((spec) => spec.notRun / spec.blocks > threshold).map((spec) => spec.specId);
  return { threshold, specs, over };
}

/** The failing gating checks of the first failing repeat of each candidate unit, named as compare names units. */
function failingByUnit(runs: readonly RunResult[], flags: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const units = unitsOf(runs, flags);
  for (const run of runs) {
    const outcome = outcomeOfRun(run);
    if (outcome.state === 'pass') continue;
    const base = `${run.specId} · ${run.mode}${run.perturbationId === undefined ? '' : ` · ${run.perturbationId}`}`;
    const unit = units.has(base) ? base : [...units.keys()].find((key) => key.startsWith(`${base} · `));
    if (unit === undefined || out.has(unit)) continue;
    out.set(unit, outcome.failing.length > 0 ? outcome.failing : [run.error ?? outcome.state]);
  }
  return out;
}

/** Changed goldens the table prints; the summary file holds every one. */
const SHOWN_ROWS = 25;

/** The verdict table ci prints. */
export function verdictText(summary: CiSummary, outPath: string): string {
  const lines: string[] = [];
  lines.push(
    `driftbench ci: candidate ${summary.candidate.target} (campaign ${summary.candidate.campaignId}) against baseline campaign ${summary.baseline.campaignId}, compared as driftbench compare does (golden by golden, every repeat).`,
  );
  if (summary.radius) {
    const r = summary.radius;
    const total = r.blocks.sent + r.blocks.carried;
    const saved = total === 0 ? 0 : (r.blocks.carried / total) * 100;
    lines.push(
      `Blast radius of ${r.fromVersion} to ${r.toVersion} (manifest ${r.manifest}): ${r.changes.join(', ') || 'no change'}. ${count(r.fresh, 'cell')} run fresh, ${r.carried} carried from ${r.from}: ${r.blocks.sent} of ${count(total, 'block')} sent, ${saved.toFixed(1)}% saved. Carried goldens are not paired.`,
    );
    if (r.audit) {
      lines.push(
        `Audit: ${count(r.audit.sampled, 'cell')} outside the radius run fresh (seed ${r.audit.seed}), ${r.audit.misses} ${r.audit.misses === 1 ? 'miss' : 'misses'}.`,
      );
    }
  }
  if (summary.marginAuto) {
    lines.push(
      `Margin auto: ${summary.marginPoints} points, the smallest half point at which the baseline compared with itself is non-inferior (set by ${summary.marginAuto.limitedBy}, ${summary.marginAuto.neededPoints} points).`,
    );
    if (summary.marginAuto.warning) lines.push(`Warning: ${summary.marginAuto.warning}.`);
  }
  if (summary.marginDefaulted) {
    lines.push(`Margin auto: ${summary.marginPoints} points by default; ${summary.marginDefaulted}.`);
  }
  if (summary.underpowered.length > 0) {
    lines.push(
      `Underpowered, under ${summary.minGoldens} goldens${summary.strict ? ', gating anyway (--strict)' : ', left out of the parity test'}: ${summary.underpowered.map((entry) => `${entry.criterion} (${count(entry.goldens, 'golden')})`).join(', ')}.`,
    );
  }
  lines.push(
    ...table([
      ['measure', 'value'],
      ['goldens paired', String(summary.pairs)],
      ['both pass', String(summary.table.bothPass)],
      ['regressed', String(summary.table.regressed)],
      ['improved', String(summary.table.improved)],
      ['both fail', String(summary.table.bothFail)],
      ['new gating flags', String(summary.newFlags.length)],
      ['all-pass regression effect', `${signed(summary.effectPoints.estimate)} points`],
      [
        '95% interval',
        `[${signed(summary.effectPoints.lower)}, ${signed(summary.effectPoints.upper)}] points`,
      ],
      ['margin', `${summary.marginPoints} points${summary.marginAuto ? ' (auto)' : ''}`],
      ['smallest margin these pairs can show', `${summary.smallestMarginPoints} points`],
      ['gating criteria not shown within the margin', String(summary.criteriaNotShown.length)],
      [
        `underpowered (under ${summary.minGoldens} goldens)`,
        `${summary.underpowered.length}${summary.strict ? ', gating (--strict)' : ', left out of the parity test'}`,
      ],
      ['verdict', VERDICT_TEXT[summary.verdict]],
    ]),
  );
  const changed = summary.rows.filter((row) => row.change !== 'same' || row.newFlags.length > 0);
  if (changed.length > 0) {
    lines.push('');
    lines.push('Goldens that changed:');
    lines.push(
      ...table([
        ['golden', 'baseline', 'candidate', 'change', 'new flags', 'candidate failing'],
        ...changed
          .slice(0, SHOWN_ROWS)
          .map((row) => [
            row.name,
            row.baseline.pass ? 'pass' : 'fail',
            row.candidate.pass ? 'pass' : 'fail',
            row.change,
            row.newFlags.join(', ') || 'none',
            row.candidate.failing.slice(0, 3).join(', '),
          ]),
      ]),
    );
    if (changed.length > SHOWN_ROWS) {
      lines.push(`  and ${changed.length - SHOWN_ROWS} more: every golden is in the summary file.`);
    }
  }
  if (summary.unpaired.length > 0) {
    lines.push(
      `Not compared: ${summary.unpaired.map((entry) => `${entry.unit} (${entry.reason})`).join(', ')}.`,
    );
  }
  if (summary.notRun) {
    const { threshold, specs, over } = summary.notRun;
    lines.push(
      `Not run (--max-not-run ${threshold}): ${specs
        .slice(0, SHOWN_ROWS)
        .map(
          (spec) =>
            `${spec.specId} ${spec.notRun} of ${count(spec.blocks, 'block')}${over.includes(spec.specId) ? ', over the threshold' : ''} (${spec.first})`,
        )
        .join('; ')}.`,
    );
  }
  lines.push('');
  lines.push('Why:');
  for (const reason of summary.reasons) lines.push(`  - ${reason}`);
  lines.push('');
  lines.push(`Verdict: ${VERDICT_TEXT[summary.verdict]}. Exit ${summary.exitCode}.`);
  if (summary.verdict === 'not-shown-non-inferior') {
    lines.push(
      'Not shown non-inferior is not a regression: no evidence of a drop, but the intervals are wider than the margin. Add goldens, widen the margin, or let --margin auto choose it.',
    );
  }
  lines.push(`Summary: ${outPath}`);
  return `${lines.join('\n')}\n`;
}

async function openReported(deps: CampaignDeps, path: string, io: Io): Promise<Store | undefined> {
  try {
    return await deps.openStore(path);
  } catch (cause) {
    io.err(`Cannot open the store at ${display(path, io)}: ${message(cause)}\n`);
    return undefined;
  }
}

function display(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function signed(points: number): string {
  const text = points.toFixed(2);
  return points > 0 ? `+${text}` : text === '-0.00' ? '0.00' : text;
}

/** Pads every column but the last to its widest cell, two spaces apart, indented by two. */
function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    `  ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join('  ')}`.trimEnd(),
  );
}

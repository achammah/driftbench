import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type RunMode,
  type RunResult,
  type Store,
  specBlocks,
  stimulusMessages,
} from '@agent-nexus/driftbench-core';
import {
  createAnthropicJudge,
  createDefaultJudge,
  createGoogleJudge,
  createOpenAiJudge,
  createReaderFirstJudge,
  type JudgeClient,
  judgePairwise,
  PAIR_PREFERENCES,
  type PairPreference,
  type PairwiseOptions,
  type RubricItem,
  readPairwiseCriterion,
} from '@agent-nexus/driftbench-judges';
import {
  autoMargin,
  type CampaignData,
  compareCampaigns,
  comparePairwise,
  compareText,
  loadCampaign,
  MIN_GOLDENS,
  type PairwiseCall,
  ReportInputError,
  replyPairs,
  scoredRuns,
} from '@agent-nexus/driftbench-report';
import { openStore } from '@agent-nexus/driftbench-store';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  addJudgeOptions,
  clientJudgeFrom,
  familyRefusal,
  type JudgeFlags,
  judgeAsked,
} from '../judge-options';
import { optionNumber } from '../number';
import { pluginPairwiseJudge } from '../plugins';
import { noStoreAt } from '../store-path';
import { rankCommand } from './compare-rank';

/** What compare and report open stores with. Tests pass their own. */
export type ReportDeps = {
  openStore(path: string): Promise<Store>;
  /** The judge a pairwise call uses, by name: openai, anthropic or google. Tests pass a fake. */
  pairwiseClient?(kind: string): JudgeClient;
};

/** The provider judges a `--pairwise-judge` name stands for. Keys are read from the environment. */
export function defaultPairwiseClient(kind: string): JudgeClient {
  if (kind === 'openai' || kind === 'anthropic' || kind === 'google')
    return createDefaultJudge({ provider: kind, id: `pairwise-${kind}` });
  const registered = pluginPairwiseJudge(kind);
  if (registered !== undefined) return registered;
  throw new Error(`unknown pairwise judge ${kind}: use openai, anthropic or google`);
}

export const defaultReportDeps: ReportDeps = {
  openStore: async (path) => openStore(path),
  pairwiseClient: defaultPairwiseClient,
};

type CompareCommandOptions = {
  baseline?: string;
  candidate?: string;
  rank?: string[];
  store: string;
  margin: string;
  mode?: string;
  q: string;
  minGoldens: string;
  strict?: boolean;
  json?: boolean;
  pairwise?: string;
  pairwiseJudge?: string;
  pairwiseReference?: string;
  pairwiseContract?: string;
  pairwisePresentation?: string;
  pairwiseItems?: string;
  pairwiseAudit?: boolean;
  pairwiseConfig?: string;
  pairwisePreference?: string;
  judgeMargin?: string;
  featureMargin?: string;
  minFailures?: string;
} & JudgeFlags;

/** Registers `driftbench compare`. */
export function registerCompareCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: ReportDeps = defaultReportDeps,
): void {
  const compare = program
    .command('compare')
    .description(
      'Compare a candidate campaign with a baseline on the goldens both ran. Exit 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input.',
    )
    .option('--baseline <campaign>', 'the baseline campaign id; required unless --rank')
    .option('--candidate <campaign>', 'the candidate campaign id; required unless --rank')
    .option(
      '--rank <campaigns...>',
      'rank three or more campaigns instead: wins per shared run, the Bradley-Terry order and every three-campaign cycle',
    )
    .requiredOption('--store <file>', 'the store that holds both campaigns')
    .option(
      '--margin <points|auto>',
      'the largest drop in pass rate tolerated, in percentage points, such as 2; auto: the smallest margin at which the baseline compared with itself is non-inferior',
      'auto',
    )
    .option(
      '--min-goldens <n>',
      'a gating criterion decided on fewer goldens is underpowered and left out of the parity test',
      String(MIN_GOLDENS),
    )
    .option('--strict', 'underpowered criteria gate too')
    .option('--mode <modes>', 'compare only these modes, such as F or T,F; default every mode both ran')
    .option('--q <rate>', 'false discovery rate of Benjamini-Hochberg across criteria', '0.05')
    .option('--json', 'print one JSON document')
    .option(
      '--pairwise <criterion.yaml>',
      'also judge, reply by reply, which of the two campaigns better meets this criterion, in both orders; the blocks both ran',
    )
    .option(
      '--pairwise-judge <kind>',
      'the judge of the pairwise calls: openai, anthropic or google',
      'openai',
    )
    .option(
      '--pairwise-reference <file>',
      'judge which reply matches this reference answer better, instead of which reply is better; the file holds the text',
    )
    .option(
      '--pairwise-contract <contract>',
      'winner: the judge names the better reply (default); ledger: the judge scores each requirement for both replies and code decides',
    )
    .option(
      '--pairwise-presentation <order>',
      'both-orders: judge each pair in both orders (default); canonical: one order fixed by content, position bias not measured',
    )
    .option(
      '--pairwise-items <file>',
      'a YAML list of rubric items ({ name, rubric, weight, hard }) the judge scores for both replies',
    )
    .option('--no-pairwise-audit', 'without the reference fact audit and its ledger recovery')
    .option(
      '--pairwise-config <config>',
      'reader-first: prefer the longer complete reply unless the judge finds supported failures in it',
    )
    .option(
      '--judge-margin <n>',
      'reader-first: the score advantage the shorter reply needs, 0 to 20; default 4',
    )
    .option('--feature-margin <n>', 'reader-first: the machine risk-flag gap; default 5')
    .option('--min-failures <n>', 'reader-first: the supported failures the longer reply needs; default 1')
    .option(
      '--pairwise-preference <preference>',
      'long-structured: a declared preference for the longer structured reply, applied after the ledger verdict; needs --pairwise-contract ledger',
    );
  addJudgeOptions(compare, { council: false }).action(async (options: CompareCommandOptions) => {
    setExit(await compareCommand(options, io, deps));
  });
}

/** `driftbench compare`: 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input. */
export async function compareCommand(
  options: CompareCommandOptions,
  io: Io,
  deps: ReportDeps,
): Promise<number> {
  if (options.rank !== undefined) {
    if (options.baseline !== undefined || options.candidate !== undefined || options.pairwise !== undefined) {
      io.err('--rank compares campaigns on its own: drop --baseline, --candidate and --pairwise.\n');
      return 2;
    }
    return rankCommand({ ...options, rank: options.rank }, io, deps);
  }
  if (options.baseline === undefined || options.candidate === undefined) {
    io.err('compare needs --baseline <campaign> and --candidate <campaign>, or --rank <campaigns...>.\n');
    return 2;
  }
  const pairwiseSettings = parsePairwiseSettings(options, io);
  if (pairwiseSettings === undefined) return 2;
  const gate = parseGate(options, io);
  const q = parseRate(options.q, '--q', io);
  const modes = options.mode === undefined ? undefined : parseModes(options.mode, io);
  if (gate === undefined || q === undefined || modes === null) return 2;
  if (judgeAsked(options) && options.pairwise === undefined) {
    io.err(
      '--judge, --judges and --judge-route choose the pairwise judge: they go with --pairwise <criterion.yaml>.\n',
    );
    return 2;
  }
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const baseline = await loadReported(store, options.baseline, io);
    const candidate = baseline ? await loadReported(store, options.candidate, io) : undefined;
    if (!baseline || !candidate) return 2;
    let result: ReturnType<typeof compareCampaigns>;
    try {
      const shared = {
        q,
        minGoldens: gate.minGoldens,
        strict: gate.strict,
        ...(modes ? { modes } : {}),
      };
      const margin = resolveMargin(gate, baseline, shared, options.json ? undefined : io);
      result = compareCampaigns(baseline, candidate, { ...shared, margin });
    } catch (cause) {
      io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
    let pairwise: PairwiseLine | undefined;
    if (options.pairwise !== undefined) {
      pairwise = await runPairwise(options, pairwiseSettings, baseline, candidate, deps, io);
      if (pairwise === undefined) return 2;
    }
    if (options.json) {
      const body =
        pairwise === undefined ? compareJson(result) : { ...compareJson(result), pairwise: pairwise.json };
      io.out(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      io.out(compareText(result));
      if (pairwise !== undefined) io.out(`${pairwise.line}\n`);
    }
    return result.verdict === 'non-inferior' ? 0 : 1;
  } finally {
    await store.close();
  }
}

type PairwiseLine = { line: string; json: Record<string, number | string> };

/** The pairwise settings the flags ask for, checked before any call. */
type PairwiseSettings = {
  contract: 'winner' | 'ledger';
  presentation: 'both-orders' | 'canonical';
  itemsFile?: string;
  audit: boolean;
  readerFirst?: { judgeMargin?: number; featureMargin?: number; minFailures?: number };
  preference?: PairPreference;
};

/** The pairwise flags as settings; undefined after printing why one is wrong. */
function parsePairwiseSettings(options: CompareCommandOptions, io: Io): PairwiseSettings | undefined {
  const fail = (message: string) => {
    io.err(`${message}\n`);
    return undefined;
  };
  const contract = options.pairwiseContract ?? 'winner';
  if (contract !== 'winner' && contract !== 'ledger')
    return fail(`--pairwise-contract takes winner or ledger, not "${contract}".`);
  const presentation = options.pairwisePresentation ?? 'both-orders';
  if (presentation !== 'both-orders' && presentation !== 'canonical')
    return fail(`--pairwise-presentation takes both-orders or canonical, not "${presentation}".`);
  if (contract === 'ledger' && presentation === 'canonical')
    return fail('--pairwise-contract ledger reads both orders: drop --pairwise-presentation canonical.');
  const reader = [options.judgeMargin, options.featureMargin, options.minFailures].some(
    (v) => v !== undefined,
  );
  if (options.pairwiseConfig !== undefined && options.pairwiseConfig !== 'reader-first')
    return fail(`--pairwise-config takes reader-first, not "${options.pairwiseConfig}".`);
  if (reader && options.pairwiseConfig !== 'reader-first')
    return fail('--judge-margin, --feature-margin and --min-failures need --pairwise-config reader-first.');
  let readerFirst: PairwiseSettings['readerFirst'];
  if (options.pairwiseConfig === 'reader-first') {
    const others = [
      options.pairwiseContract,
      options.pairwisePresentation,
      options.pairwiseItems,
      options.pairwiseReference,
      options.pairwisePreference,
    ];
    if (others.some((v) => v !== undefined) || options.pairwiseAudit === false)
      return fail(
        '--pairwise-config reader-first is its own contract: drop --pairwise-contract, --pairwise-presentation, --pairwise-items, --pairwise-reference, --no-pairwise-audit and --pairwise-preference.',
      );
    readerFirst = {};
    for (const [flag, key, text] of [
      ['--judge-margin', 'judgeMargin', options.judgeMargin],
      ['--feature-margin', 'featureMargin', options.featureMargin],
      ['--min-failures', 'minFailures', options.minFailures],
    ] as const) {
      if (text === undefined) continue;
      const value = optionNumber(text);
      if (!Number.isFinite(value) || value <= 0)
        return fail(`${flag} takes a positive number, not "${text}".`);
      readerFirst[key] = value;
    }
  }
  if (options.pairwisePreference !== undefined) {
    if (!(PAIR_PREFERENCES as readonly string[]).includes(options.pairwisePreference))
      return fail(
        `--pairwise-preference takes ${PAIR_PREFERENCES.join(', ')}, not "${options.pairwisePreference}".`,
      );
    if (contract !== 'ledger')
      return fail('--pairwise-preference applies after the ledger verdict: add --pairwise-contract ledger.');
  }
  return {
    contract,
    presentation,
    ...(options.pairwiseItems === undefined ? {} : { itemsFile: options.pairwiseItems }),
    audit: options.pairwiseAudit !== false,
    ...(readerFirst === undefined ? {} : { readerFirst }),
    ...(options.pairwisePreference === undefined
      ? {}
      : { preference: options.pairwisePreference as PairPreference }),
  };
}

/** Reads rubric items from YAML: a list of { name, rubric, weight, hard }, or { items: [...] }. */
async function readItems(path: string): Promise<RubricItem[]> {
  const { parse } = await import('yaml');
  const value = parse(await readFile(path, 'utf8')) as unknown;
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : undefined;
  if (!list || list.length === 0)
    throw new Error(`${path} holds no rubric items: write a list of { name, rubric }`);
  const names = new Set<string>();
  return list.map((entry, index) => {
    const item = entry as Partial<RubricItem>;
    if (
      typeof item?.name !== 'string' ||
      !item.name.trim() ||
      typeof item.rubric !== 'string' ||
      !item.rubric.trim()
    )
      throw new Error(`${path}: item ${index + 1} needs a nonempty name and rubric`);
    if (names.has(item.name)) throw new Error(`${path}: item ${item.name} appears twice`);
    names.add(item.name);
    if (item.weight !== undefined && !(typeof item.weight === 'number' && item.weight > 0))
      throw new Error(`${path}: item ${item.name} needs a weight above 0`);
    if (item.hard !== undefined && typeof item.hard !== 'boolean')
      throw new Error(`${path}: item ${item.name} hard is true or false`);
    return {
      name: item.name,
      rubric: item.rubric,
      ...(item.weight === undefined ? {} : { weight: item.weight }),
      ...(item.hard === undefined ? {} : { hard: item.hard }),
    };
  });
}

/**
 * Judges each reply pair of the two campaigns with the criterion, in both orders unless canonical. A judge
 * that gives no answer fails the command with its reason; it is never counted as a tie.
 */
async function runPairwise(
  options: CompareCommandOptions,
  settings: PairwiseSettings,
  baseline: CampaignData,
  candidate: CampaignData,
  deps: ReportDeps,
  io: Io,
): Promise<PairwiseLine | undefined> {
  let criterion: Awaited<ReturnType<typeof readPairwiseCriterion>>;
  let judge: JudgeClient;
  let configured: Awaited<ReturnType<typeof clientJudgeFrom>>;
  let reference: string | undefined;
  let items: RubricItem[] | undefined;
  let readerFirst: ReturnType<typeof createReaderFirstJudge> | undefined;
  try {
    criterion = await readPairwiseCriterion(resolve(io.cwd, options.pairwise ?? ''));
    if (options.pairwiseReference !== undefined) {
      reference = (await readFile(resolve(io.cwd, options.pairwiseReference), 'utf8')).trim();
    }
    if (settings.itemsFile !== undefined) items = await readItems(resolve(io.cwd, settings.itemsFile));
    if (!judgeAsked(options)) {
      judge = (deps.pairwiseClient ?? defaultPairwiseClient)(options.pairwiseJudge ?? 'openai');
    } else {
      const chosen = await clientJudgeFrom(options, io);
      if (!chosen?.client) return undefined;
      judge = chosen.client;
      configured = chosen;
    }
    if (settings.readerFirst !== undefined)
      readerFirst = createReaderFirstJudge(judge, { configuration: 'reader-first', ...settings.readerFirst });
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
  // Every pairwise judge, by --judge or by --pairwise-judge and its default, meets the agent family here,
  // before any call.
  const agentFamily = options.agentFamily?.trim();
  if (agentFamily) {
    const refused = await familyRefusal(judge, agentFamily);
    if (refused !== undefined) {
      io.err(`error: ${refused}\n`);
      return undefined;
    }
  }
  const stimulusOf = (run: RunResult, index: number): string | undefined => {
    const data = baseline.runs.includes(run) ? baseline : candidate;
    const loaded = data.specs.get(`${run.specId}@${run.specHash}`);
    if (!loaded?.ok) return undefined;
    const mapped = specBlocks(run, loaded.spec).find((entry) => entry.result.index === index);
    const when =
      mapped === undefined
        ? undefined
        : loaded.spec.blocks[mapped.result.provenance?.specIndex ?? mapped.block]?.when;
    return when === undefined
      ? undefined
      : stimulusMessages(when)
          .map((message) => message.content)
          .join('\n');
  };
  let differentStimulus = 0;
  const pairs = replyPairs(baseline.runs, candidate.runs, stimulusOf, () => {
    differentStimulus += 1;
  });
  const skipped = ` Skipped ${differentStimulus} pairs: different stimulus.`;
  const pairOptions: PairwiseOptions = {
    ...(reference === undefined ? {} : { reference }),
    ...(items === undefined ? {} : { rubricItems: items }),
    ...(settings.audit ? {} : { audit: false }),
    ...(settings.contract === 'ledger' ? { answerContract: 'ledger' as const } : {}),
    ...(settings.presentation === 'canonical' ? { presentation: 'canonical' as const } : {}),
    ...(settings.preference === undefined ? {} : { preference: settings.preference }),
  };
  const judgeOne = async (pair: (typeof pairs)[number]): Promise<PairwiseCall> => {
    const transcript = pair.stimulus === '' ? [] : [{ role: 'user' as const, text: pair.stimulus }];
    if (readerFirst !== undefined) {
      const read = await readerFirst.judgePair(pair.stimulus, pair.first, pair.second);
      return single(read.choice === 'A' ? 'first' : read.choice === 'B' ? 'second' : 'tie');
    }
    const verdict = await judgePairwise(judge, criterion, transcript, pair.first, pair.second, pairOptions);
    if ('status' in verdict) {
      if (verdict.status === 'unparsed') throw new Error('the pair ledger did not parse in either order');
      return single(verdict.choice ?? 'tie');
    }
    if ('presentation' in verdict) return single(verdict.choice);
    return verdict;
  };
  try {
    const report = await comparePairwise(pairs, judgeOne);
    const { tally } = report;
    await configured?.save();
    const spent = configured ? ` Judge ${configured.label}, ${configured.spend.usd.toFixed(4)} USD.` : '';
    const how =
      readerFirst !== undefined
        ? 'reader-first'
        : [
            settings.contract,
            ...(settings.presentation === 'canonical' ? ['canonical'] : []),
            ...(settings.itemsFile === undefined ? [] : ['items']),
            ...(settings.audit ? [] : ['no audit']),
            ...(settings.preference === undefined ? [] : [settings.preference]),
          ].join(', ');
    const measured =
      readerFirst === undefined && settings.contract === 'winner' && settings.presentation === 'both-orders';
    if (measured && settings.itemsFile === undefined && settings.audit) {
      const line = `Pairwise: ${pairs.length} pairs, baseline ${tally.baseline}, candidate ${tally.candidate}, tie ${tally.tie}, inconsistent ${tally.inconsistent}, position bias ${tally.positionBias}.${skipped}${spent}`;
      return { line, json: { ...tally, pairs: pairs.length, differentStimulus } };
    }
    const line = `Pairwise (${how}): ${pairs.length} pairs, baseline ${tally.baseline}, candidate ${tally.candidate}, tie ${tally.tie}${
      measured ? `, inconsistent ${tally.inconsistent}, position bias ${tally.positionBias}` : ''
    }.${skipped}${spent}`;
    return { line, json: { ...tally, pairs: pairs.length, differentStimulus, how } };
  } catch (cause) {
    io.err(`pairwise judge gave no answer: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

/** A verdict decided in code from both orders, or read in one order: no order split or position bias to report. */
function single(choice: 'first' | 'second' | 'tie'): PairwiseCall {
  const outcome = choice === 'first' ? 'pass' : choice === 'second' ? 'fail' : 'inconclusive';
  return { choice, ordered: outcome, swapped: outcome, consistent: true, positionBias: false };
}

/** The comparison with its maps and sets written as plain objects and lists. */
export function compareJson(result: ReturnType<typeof compareCampaigns>) {
  return {
    ...result,
    pairs: result.pairs.map((pair) => ({
      ...pair,
      baseline: sideJson(pair.baseline),
      candidate: sideJson(pair.candidate),
    })),
  };
}

function sideJson(side: ReturnType<typeof compareCampaigns>['pairs'][number]['baseline']) {
  return { ...side, criteria: Object.fromEntries(side.criteria), flags: [...side.flags].sort() };
}

export async function openReported(deps: ReportDeps, path: string, io: Io): Promise<Store | undefined> {
  try {
    return await deps.openStore(path);
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

export async function loadReported(
  store: Store,
  campaignId: string | undefined,
  io: Io,
): Promise<CampaignData | undefined> {
  try {
    return await loadCampaign(store, campaignId);
  } catch (cause) {
    if (cause instanceof ReportInputError) {
      io.err(`${cause.message}\n`);
      return undefined;
    }
    throw cause;
  }
}

/** The gate flags every comparing command takes: the margin (points or auto), the minimum goldens, strict. */
export type Gate = { margin: number | 'auto'; minGoldens: number; strict: boolean };

/** Parses --margin (points or auto), --min-goldens and --strict; undefined after printing why. */
export function parseGate(
  options: { margin: string; minGoldens: string; strict?: boolean },
  io: Io,
): Gate | undefined {
  const minGoldens = optionNumber(options.minGoldens);
  if (!Number.isInteger(minGoldens) || minGoldens < 1) {
    io.err(`--min-goldens takes a whole number of at least 1, not "${options.minGoldens}".\n`);
    return undefined;
  }
  const margin = options.margin === 'auto' ? 'auto' : parseMargin(options.margin, io);
  if (margin === undefined) return undefined;
  return { margin, minGoldens, strict: options.strict === true };
}

/**
 * Whether a campaign holds a run of its own that passed or failed, in the given modes or in every mode. A campaign
 * whose every run is not run, blocked or carried from an earlier campaign measured nothing itself: a carried run is
 * skipped by the pairing, so the campaign pairs no golden with itself and no margin can be read off it.
 */
export function hasScoredRun(campaign: CampaignData, modes?: readonly RunMode[]): boolean {
  return (
    scoredRuns(
      campaign.runs.filter(
        (run) => run.carried === undefined && (modes === undefined || modes.includes(run.mode)),
      ),
    ).length > 0
  );
}

/**
 * The margin a comparison runs at: the one given, or with auto the smallest margin at which the baseline
 * compared with itself is non-inferior. With `io`, the auto margin and any warning are printed.
 */
export function resolveMargin(
  gate: Gate,
  baseline: CampaignData,
  options: Omit<Parameters<typeof compareCampaigns>[2], 'margin'>,
  io?: Io,
): number {
  if (gate.margin !== 'auto') return gate.margin;
  if (baseline.campaign.rejudged?.length && baseline.runs.every((run) => run.carried)) {
    const stamps = baseline.campaign.rejudged;
    const rescored = [
      ...new Set(stamps.filter((stamp) => stamp.criteria.length === 0).map((stamp) => stamp.fromCampaign)),
    ];
    if (rescored.length) {
      for (const campaign of rescored) io?.out(`Re-scored; observations from ${campaign}.\n`);
      const alsoRejudged = stamps.some((stamp) => stamp.criteria.length > 0);
      io?.out(
        `Margin auto: reused observations${alsoRejudged ? ', including re-judged criteria,' : ''} supply no fresh agent pairs; using the 2.0 point default.\n`,
      );
    } else {
      io?.out(
        'Margin auto: re-judged observations supply no fresh agent pairs; using the 2.0 point default.\n',
      );
    }
    return 0.02;
  }
  if (baseline.runs.length === 0) {
    // Nothing to measure the margin on: a campaign with no runs keeps the 2 point default and says so.
    io?.out('Margin auto: the campaign has no runs to measure it on; 2.0 points.\n');
    return 0.02;
  }
  if (!hasScoredRun(baseline, options.modes)) {
    // Every run is not run or blocked: nothing passed or failed, so the baseline compared with itself pairs no
    // golden and no margin can be read off it. The 2 point default stands and the report says why.
    io?.out(
      'Margin auto: the campaign has no scored golden to measure it on (no run passed or failed); 2.0 points.\n',
    );
    return 0.02;
  }
  const auto = autoMargin(baseline, options);
  io?.out(
    `Margin auto: ${(auto.margin * 100).toFixed(1)} points, the smallest half point at which the baseline compared with itself is non-inferior (set by ${auto.limitedBy}, ${(auto.needed * 100).toFixed(1)} points).\n`,
  );
  if (auto.warning) io?.out(`Warning: ${auto.warning}.\n`);
  return auto.margin;
}

/** A margin in points, such as 2, as a proportion; undefined after printing why it is not one. */
export function parseMargin(text: string, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 100) {
    io.err(`--margin takes a number of points above 0 and below 100, such as 2, not "${text}".\n`);
    return undefined;
  }
  return value / 100;
}

function parseRate(text: string, flag: string, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    io.err(`${flag} takes a number between 0 and 1, not "${text}".\n`);
    return undefined;
  }
  return value;
}

/** Modes separated by commas; null after printing an unknown one. */
export function parseModes(text: string, io: Io): RunMode[] | null {
  const modes: RunMode[] = [];
  for (const part of text.split(',').map((entry) => entry.trim())) {
    if (part !== 'T' && part !== 'F' && part !== 'P') {
      io.err(`Unknown mode "${part}". The modes are T, F and P, alone or separated by commas.\n`);
      return null;
    }
    if (!modes.includes(part)) modes.push(part);
  }
  return modes;
}

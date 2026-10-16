import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { RunMode } from '@agent-nexus/driftbench-core';
import {
  type AggregateResult,
  buildScorecard,
  type CampaignData,
  carriedLines,
  criterionRepeatsText,
  headlineText,
  MIN_GOLDENS,
  type PilotReport,
  ReportInputError,
  readPilotReport,
  renderHtml,
  renderJunit,
  unscoredRuns,
} from '@agent-nexus/driftbench-report';
import type { Command } from 'commander';
import { criteriaFromConfig } from '../aggregate-config';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { noStoreAt } from '../store-path';
import {
  compareJson,
  defaultReportDeps,
  loadReported,
  openReported,
  parseGate,
  parseModes,
  type ReportDeps,
  resolveMargin,
} from './compare';

type ReportCommandOptions = {
  store: string;
  out: string;
  junit?: string;
  baseline?: string;
  margin: string;
  minGoldens: string;
  strict?: boolean;
  pilot?: string;
  by?: string;
  spreadMode?: string;
  maxRuns: string;
  withholdIncomplete?: boolean;
  json?: boolean;
  aggregate?: string[];
  config?: string;
};

/** Registers `driftbench report`. */
export function registerReportCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: ReportDeps = defaultReportDeps,
): void {
  program
    .command('report')
    .description(
      'Write the scorecard of a stored campaign as one HTML file, and its JUnit XML. Exit 0 when written, 2 on bad input.',
    )
    .argument('[campaign]', 'the campaign id; the latest campaign of the store without it')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .requiredOption('--out <file.html>', 'where to write the scorecard')
    .option('--junit <file.xml>', 'also write JUnit XML: one test suite per golden, one test case per run')
    .option('--baseline <campaign>', 'a baseline campaign in the same store: adds the compare diff')
    .option(
      '--margin <points|auto>',
      'the non-inferiority margin in percentage points; auto: the smallest margin at which the baseline (or, without one, the campaign) compared with itself is non-inferior',
      'auto',
    )
    .option(
      '--min-goldens <n>',
      'a gating criterion decided on fewer goldens is underpowered and left out of the parity test',
      String(MIN_GOLDENS),
    )
    .option('--strict', 'underpowered criteria gate too')
    .option('--pilot <path>', 'a pilot report, pilot-report.json or its folder, rendered in the spread view')
    .option('--by <dimensions>', 'the generated-cell dimensions that name a spread cell, separated by commas')
    .option('--spread-mode <mode>', 'the mode the spread view reads; default F when the campaign ran it')
    .option('--max-runs <n>', 'runs in the drilldown, failing runs first', '200')
    .option(
      '--withhold-incomplete',
      'withhold the pass^k and pass@k value of a line with incomplete runs, instead of reporting it with the range of its missing outcomes',
    )
    .option('--json', 'also print the scorecard as one JSON document')
    .option(
      '--config <file>',
      'the project config, with an aggregates list; default driftbench.yaml in the working folder',
    )
    .option(
      '--aggregate <spec>',
      'a campaign-level criterion, name:op threshold, e.g. pass-rate:>=0.8; repeatable; its result is printed',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(async (campaignId: string | undefined, options: ReportCommandOptions) => {
      setExit(await reportCommand(campaignId, options, io, deps));
    });
}

/** `driftbench report`: 0 when the files are written, 2 on bad input. */
export async function reportCommand(
  campaignId: string | undefined,
  options: ReportCommandOptions,
  io: Io,
  deps: ReportDeps,
): Promise<number> {
  const gate = parseGate(options, io);
  const maxRuns = optionNumber(options.maxRuns);
  if (!Number.isInteger(maxRuns) || maxRuns < 0) {
    io.err(`--max-runs takes a whole number of 0 or more, not "${options.maxRuns}".\n`);
    return 2;
  }
  const loadedCriteria = await criteriaFromConfig(options, io.cwd);
  if (!loadedCriteria.ok) {
    io.err(`${loadedCriteria.message}\n`);
    return 2;
  }
  const criteria = loadedCriteria.criteria;
  let spreadMode: RunMode | undefined;
  if (options.spreadMode !== undefined) {
    const modes = parseModes(options.spreadMode, io);
    if (modes === null) return 2;
    if (modes.length !== 1) {
      io.err(`--spread-mode takes one mode, not "${options.spreadMode}".\n`);
      return 2;
    }
    spreadMode = modes[0];
  }
  if (gate === undefined) return 2;
  let pilot: PilotReport | undefined;
  if (options.pilot !== undefined) {
    try {
      pilot = readPilotReport(resolve(io.cwd, options.pilot));
    } catch (cause) {
      if (!(cause instanceof ReportInputError)) throw cause;
      io.err(`${cause.message}\n`);
      return 2;
    }
  }
  const by = options.by
    ?.split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  let data: CampaignData | undefined;
  let baseline: CampaignData | undefined;
  try {
    data = await loadReported(store, campaignId, io);
    if (!data) return 2;
    if (options.baseline !== undefined) {
      baseline = await loadReported(store, options.baseline, io);
      if (!baseline) return 2;
    }
  } finally {
    await store.close();
  }

  const margin = resolveMargin(
    gate,
    baseline ?? data,
    { minGoldens: gate.minGoldens, strict: gate.strict },
    options.json ? undefined : io,
  );
  let card: ReturnType<typeof buildScorecard>;
  try {
    card = buildScorecard(data, {
      margin,
      minGoldens: gate.minGoldens,
      strict: gate.strict,
      maxRuns,
      incompletePolicy: options.withholdIncomplete ? 'withhold' : 'interval',
      ...(criteria.length > 0 ? { aggregates: criteria } : {}),
      ...(baseline ? { baseline } : {}),
      ...(pilot ? { pilot } : {}),
      ...(by && by.length > 0 ? { by } : {}),
      ...(spreadMode ? { spreadMode } : {}),
    });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    io.err(`${cause.message}\n`);
    return 2;
  }
  const out = resolve(io.cwd, options.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderHtml(card));
  const written = [show(io, out)];
  if (options.junit !== undefined) {
    const junit = resolve(io.cwd, options.junit);
    await mkdir(dirname(junit), { recursive: true });
    await writeFile(junit, renderJunit(data));
    written.push(show(io, junit));
  }
  if (options.json) {
    io.out(
      `${JSON.stringify({ ...card, ...(card.compare ? { compare: compareJson(card.compare) } : {}) }, null, 2)}\n`,
    );
  } else {
    const c = card.campaign;
    io.out(
      `Campaign ${c.campaignId}: ${c.runs} runs, ${c.passing} pass, ${c.failing} fail, ${unscoredRuns(c)}${c.broken} did not complete.\n`,
    );
    for (const line of carriedLines(card.carried)) io.out(`${line}\n`);
    for (const mode of card.modes) if (mode.headline) io.out(`${headlineText(mode.mode, mode.headline)}\n`);
    for (const line of criterionRepeatsText(card.criterionRepeats)) io.out(`${line}\n`);
    if (card.compare) {
      io.out(
        `Against baseline ${card.compare.baseline.campaignId}: ${card.compare.verdict}, margin ${(margin * 100).toFixed(1)} points.\n`,
      );
    }
    for (const entry of card.aggregates ?? []) {
      const op = entry.direction === 'at-least' ? '>=' : '<=';
      const verdict = entry.passed === undefined ? 'no runs' : entry.passed ? 'passes' : 'fails';
      const interval = entry.interval ? `, ${aggregateIntervalText(entry)}` : '';
      io.out(`aggregate ${entry.name} ${op} ${entry.threshold}: ${verdict} (${entry.reason}${interval})\n`);
    }
    io.out(`Wrote ${written.join(' and ')}.\n`);
  }
  return 0;
}

/**
 * The interval of one aggregate as text: the bounds, the runs and goldens behind them, and whether they decide the
 * threshold. Over several goldens the interval is Wilson on the effective runs, and what would decide an undecided
 * threshold is more goldens like these, not more repeats of them.
 */
function aggregateIntervalText(entry: AggregateResult): string {
  const interval = entry.interval as NonNullable<typeof entry.interval>;
  const bounds = `${interval.lower.toFixed(3)} to ${interval.upper.toFixed(3)}`;
  const decision = entry.decided
    ? 'decided'
    : entry.goldensNeeded !== undefined
      ? `undecided: ${entry.goldensNeeded} goldens like these (${entry.runsNeeded} runs) would decide it`
      : `undecided: ${entry.runsNeeded ?? 'more'} runs at this rate would decide it`;
  if (interval.method === 'wilson')
    return `Wilson 95% interval ${bounds} over ${interval.n} runs, ${decision}`;
  const goldens = `over ${interval.n} runs in ${interval.clusters} goldens`;
  if (interval.method === 'wilson, clusters') {
    return `Wilson 95% interval over the goldens ${bounds} ${goldens} (every run agrees, so each golden counts once), ${decision}`;
  }
  const worth = `design effect ${(interval.designEffect ?? 1).toFixed(2)}, ${(interval.effectiveRuns ?? interval.n).toFixed(1)} effective runs`;
  return `Wilson 95% interval on the effective runs ${bounds} ${goldens} (${worth}), ${decision}`;
}

function show(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

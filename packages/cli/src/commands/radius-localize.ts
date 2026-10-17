import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type LocalizeCampaign,
  localizeRuns,
  RunMode,
  type SectionRegistry,
} from '@agent-nexus/driftbench-core';
import { textTable as table } from '@agent-nexus/driftbench-report';
import { openStore } from '@agent-nexus/driftbench-store';
import type { Command } from 'commander';
import type { Io } from '../io';
import { loadValidSpecs } from './campaign';
import { readRegistry } from './radius-sections';

type LocalizeOptions = {
  store: string;
  campaign: string;
  sections?: string[];
  prompt?: string;
  mode?: string;
  counting: string;
  top: string;
  json?: boolean;
};

/**
 * `driftbench radius localize <specs...> --store --campaign --sections`: rank the local sections of a
 * prompt by Ochiai suspiciousness, from a stored campaign's block verdicts and the blocks' section links.
 * Read only. Exit 0 when something failed and a ranking is printed, 1 when nothing failed outside
 * inherited failures (every score 0), 2 on bad input.
 */
export function registerRadiusLocalize(radius: Command, io: Io, setExit: (code: number) => void): void {
  radius
    .command('localize')
    .description(
      'Rank the prompt sections most likely to cause the failures of a campaign (Ochiai over block links)',
    )
    .argument('<paths...>', 'the spec files or folders the campaign ran')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .requiredOption('--campaign <id>', 'the campaign to read')
    .option(
      '--sections <registries...>',
      'section registries; the ranked prompt is --prompt, or the only one',
    )
    .option('--prompt <prompt-id>', 'the prompt to rank, when several registries are given')
    .option('--mode <mode>', 'the run mode to read: T, F or P; default the only mode of the campaign')
    .option('--counting <rule>', 'grouped: drop inherited failures only; flat: count every block', 'grouped')
    .option('--top <n>', 'print this many sections; 0 prints all', '10')
    .action(async (paths: string[], _own: unknown, command: Command) => {
      // `radius` has its own --json, which commander gives the parent: read it with the globals.
      setExit(await localizeCommand(paths, command.optsWithGlobals<LocalizeOptions>(), io));
    });
}

export async function localizeCommand(paths: string[], options: LocalizeOptions, io: Io): Promise<number> {
  // --sections is declared on `radius` too, so commander cannot require it here: check it by hand.
  if (!options.sections?.length) {
    io.err('radius localize needs --sections <registries...>: the registry of the prompt to rank.\n');
    return 2;
  }
  if (options.counting !== 'grouped' && options.counting !== 'flat') {
    io.err(`--counting takes grouped or flat, not "${options.counting}".\n`);
    return 2;
  }
  const top = Number(options.top);
  if (!Number.isInteger(top) || top < 0) {
    io.err(`--top takes a whole number from 0, not "${options.top}".\n`);
    return 2;
  }
  const registries: SectionRegistry[] = [];
  for (const path of options.sections) {
    const registry = await readRegistry(path, io);
    if (!registry) return 2;
    registries.push(registry);
  }
  const registry =
    options.prompt === undefined
      ? registries.length === 1
        ? registries[0]
        : undefined
      : registries.find((each) => each.prompt_id === options.prompt);
  if (!registry) {
    io.err(
      options.prompt === undefined
        ? `${registries.length} registries were given (${registries.map((each) => each.prompt_id).join(', ')}): name the prompt to rank with --prompt.\n`
        : `No registry given describes the prompt ${options.prompt}.\n`,
    );
    return 2;
  }
  const storePath = resolve(io.cwd, options.store);
  if (!existsSync(storePath)) {
    io.err(`No store at ${storePath}. Give one with --store <file>.\n`);
    return 2;
  }
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const store = openStore(storePath);
  try {
    if (!(await store.getCampaign(options.campaign))) {
      io.err(`The store has no campaign ${options.campaign}.\n`);
      return 2;
    }
    const runs = await store.listRuns({ campaignId: options.campaign });
    let mode: RunMode;
    if (options.mode !== undefined) {
      const parsed = RunMode.safeParse(options.mode);
      if (!parsed.success) {
        io.err(`--mode takes T, F or P, not "${options.mode}".\n`);
        return 2;
      }
      mode = parsed.data;
    } else {
      const modes = [...new Set(runs.map((run) => run.mode))];
      if (modes.length !== 1 || modes[0] === undefined) {
        io.err(
          `The campaign holds ${modes.length === 0 ? 'no run' : `runs in modes ${modes.join(', ')}`}: name one with --mode.\n`,
        );
        return 2;
      }
      mode = modes[0];
    }
    const result = localizeRuns(
      loaded.map((entry) => entry.spec),
      runs,
      registry,
      { mode, counting: options.counting },
    );
    if (options.json) {
      io.out(
        `${JSON.stringify({ prompt: registry.prompt_id, version: registry.version, mode, ...result }, null, 2)}\n`,
      );
    } else {
      io.out(renderLocalization(result, registry, mode, top));
    }
    return result.localization.failureWeight > 0 ? 0 : 1;
  } finally {
    await store.close();
  }
}

const round = (value: number) => (Math.round(value * 1000) / 1000).toFixed(3);

export function renderLocalization(
  result: LocalizeCampaign,
  registry: SectionRegistry,
  mode: RunMode,
  top: number,
): string {
  const { localization } = result;
  const lines = [
    `Sections of ${registry.prompt_id} ${registry.version} by Ochiai suspiciousness, mode ${mode}, ${result.suiteRuns} suite run${result.suiteRuns === 1 ? '' : 's'}, ${localization.counting} counting.`,
    `  ${localization.rows} block rows, failure weight ${round(localization.failureWeight)}, ${localization.inherited} inherited failure${localization.inherited === 1 ? '' : 's'} dropped${localization.counting === 'grouped' ? ' (a passing block after a failing one stays a row)' : ''}.`,
  ];
  if (localization.failureWeight === 0) {
    lines.push('  Nothing failed outside inherited failures: every score is 0.');
  } else {
    const shown = top === 0 ? localization.sections : localization.sections.slice(0, top);
    const rows = shown.map((each) => [
      each.best === each.worst ? String(each.best) : `${each.best}-${each.worst}`,
      each.section,
      round(each.score),
      round(each.failed),
      round(each.passed),
      String(each.linked),
    ]);
    lines.push(...table([['rank', 'section', 'ochiai', 'failed', 'passed', 'blocks'], ...rows]));
    if (shown.length < localization.sections.length)
      lines.push(`  ${localization.sections.length - shown.length} more; --top 0 prints all.`);
    lines.push(
      `  ${localization.counting === 'grouped' ? 'Failing roots' : 'Failing blocks'}: ${localization.roots.join(', ')}.`,
    );
  }
  if (localization.global.length > 0)
    lines.push(
      `  Not ranked, global: ${localization.global.join(', ')}. A global section reaches every block; only mutation can blame it.`,
    );
  for (const each of result.skipped) lines.push(`  Skipped run ${each.runId}: ${each.reason}.`);
  return `${lines.join('\n')}\n`;
}

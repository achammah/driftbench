import { relative, resolve } from 'node:path';
import {
  type RadiusCount,
  type RadiusReport,
  RunMode,
  radiusOf,
  type SectionRegistry,
  type SectionSelection,
  sectionChanges,
} from '@agent-nexus/driftbench-core';
import { textTable as table } from '@agent-nexus/driftbench-report';
import type { Command } from 'commander';
import type { Io } from '../io';
import { loadValidSpecs } from './campaign';
import { loadRadiusChangeManifest } from './radius-change';
import { registerRadiusLocalize } from './radius-localize';
import { registerRadiusAuto } from './radius-prompt';
import { readRegistry, registerRadiusSections } from './radius-sections';

type RadiusCommandOptions = {
  change: string;
  mode: string;
  json?: boolean;
  explain?: boolean;
  sections?: string[];
};

/**
 * `driftbench radius <specs...> --change <manifest> [--mode F] [--json]`: the blast radius of a change.
 * Read only: it runs nothing and writes nothing. It prints the blocks the change can affect (named by a
 * dependency, or after such a block in the same run), the cells they belong to, and what a rerun of those
 * cells saves against the whole suite. Exit 0 when the radius is smaller than the suite, 1 when it is the
 * whole suite, 2 on bad input.
 */
export function registerRadiusCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const radius = program
    .command('radius')
    .description('Print the blast radius of a change: the blocks it can affect, against the whole suite')
    .argument('<paths...>', 'spec files or folders')
    .option('--change <manifest>', 'the change manifest (YAML or JSON): from, to and the changes')
    .option(
      '--mode <modes>',
      'the run mode: T teacher-forced, F free-running, P perturbed; several separated by commas',
      'F',
    )
    .option('--explain', 'show the manifest anchors and the blocks each change selects')
    .option(
      '--sections <registries...>',
      'section registries: print the advisory selection of prompt_section changes (nothing is skipped)',
    )
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: RadiusCommandOptions) => {
      setExit(await radiusCommand(paths, options, io));
    });
  registerRadiusAuto(radius, io, setExit);
  registerRadiusSections(radius, io, setExit);
  registerRadiusLocalize(radius, io, setExit);
}

export async function radiusCommand(paths: string[], options: RadiusCommandOptions, io: Io): Promise<number> {
  if (!options.change || paths.length === 0) {
    io.err('radius needs spec paths and --change <manifest>.\n');
    return 2;
  }
  const modes: RunMode[] = [];
  for (const text of options.mode.split(',')) {
    const mode = RunMode.safeParse(text.trim());
    if (!mode.success) {
      io.err(`--mode takes T, F or P, separated by commas, not "${options.mode}".\n`);
      return 2;
    }
    if (!modes.includes(mode.data)) modes.push(mode.data);
  }
  const manifestPath = resolve(io.cwd, options.change);
  const manifest = await loadRadiusChangeManifest(manifestPath);
  if (!manifest.ok) {
    io.err(`✗ ${options.change}\n`);
    for (const error of manifest.errors) io.err(`    ${error}\n`);
    io.err('The change manifest is invalid, so no radius was computed.\n');
    return 2;
  }
  const registries: SectionRegistry[] = [];
  for (const path of options.sections ?? []) {
    const registry = await readRegistry(path, io);
    if (!registry) return 2;
    registries.push(registry);
  }
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const shown = (path: string) => {
    const rel = relative(io.cwd, path);
    return rel === '' || rel.startsWith('..') ? path : rel;
  };
  const report = radiusOf(
    loaded.map((entry) => ({ spec: entry.spec, hash: entry.hash, path: shown(entry.path) })),
    manifest.manifest,
    { modes, ...(options.sections === undefined ? {} : { sections: registries }) },
  );
  if (options.json) {
    io.out(
      `${JSON.stringify({ manifest: { hash: manifest.hash, ...report.manifest }, ...withoutManifest(report) }, null, 2)}\n`,
    );
  } else {
    io.out(renderRadius(report, manifest.hash));
    if (report.advisory) io.out(renderAdvisory(report.advisory, options.explain === true));
    else if (sectionChanges(manifest.manifest).length > 0)
      io.out('Pass --sections <registries> to see which blocks selection by section links would run.\n');
    if (options.explain) {
      for (const change of manifest.manifest.changes) {
        io.out(`${change.kind}:${change.id ?? 'global'}: ${change.note ?? 'declared in the manifest'}\n`);
      }
      for (const spec of report.specs)
        for (const block of spec.blocks) {
          io.out(
            `${spec.specId}/${block.id}: ${JSON.stringify(block.state)}: ${block.why.join(', ') || 'outside declared changes'}\n`,
          );
        }
    }
  }
  return report.whole ? 1 : 0;
}

function withoutManifest(report: RadiusReport): Omit<RadiusReport, 'manifest'> {
  const { manifest: _manifest, ...rest } = report;
  return rest;
}

const MODE_NAME: Record<RunMode, string> = { T: 'teacher-forced', F: 'free-running', P: 'perturbed' };

function share(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function modeLines(mode: RunMode, count: RadiusCount): string[] {
  const lines = [
    `Mode ${mode}, ${MODE_NAME[mode]}: ${count.in} of ${plural(count.total, 'block')} in the radius (${count.direct} direct, ${count.forward} forward), ${count.out} out. ${count.cells.in} of ${plural(count.cells.total, 'cell')}.`,
  ];
  if (mode === 'T') {
    lines.push(
      `  A block runs alone in this mode: a rerun of the radius sends ${count.in} of ${plural(count.total, 'block')}, ${share(count.total - count.in, count.total)} saved.`,
    );
  } else {
    lines.push(
      `  A cell reruns whole: ${count.sent} of ${plural(count.total, 'block')} sent, ${share(count.total - count.sent, count.total)} saved; ${count.cells.total - count.cells.in} of ${plural(count.cells.total, 'cell')} left to carry.`,
    );
  }
  if (count.unknown > 0) {
    lines.push(
      `  ${plural(count.unknown, 'block')} with unknown dependencies (a hand-written spec with no metadata.depends): in every radius.`,
    );
  }
  return lines;
}

/** The radius as lines a person reads. */
export function renderRadius(report: RadiusReport, hash: string): string {
  const lines: string[] = [];
  const { from, to, changes } = report.manifest;
  lines.push(
    `Blast radius of ${from} to ${to} (manifest ${hash}): ${changes.length === 0 ? 'no change' : changes.join(', ')}.`,
  );
  const blocks = report.specs.flatMap((spec) => spec.blocks);
  const unscored = blocks.filter((block) => !block.scored).length;
  lines.push(
    `${plural(report.specs.length, 'spec')}, ${plural(blocks.length - unscored, 'block')}${unscored > 0 ? ` scored (${unscored} more run with their spec and are not scored: a gate rejected them)` : ''}.`,
  );
  if (report.whole) {
    lines.push(
      `The radius is the whole suite: ${report.whole.change}: ${report.whole.reason}. Nothing can be carried.`,
    );
    return `${lines.join('\n')}\n`;
  }
  for (const mode of report.modes) {
    const count = report.totals[mode];
    if (count) lines.push(...modeLines(mode, count));
  }
  for (const mode of report.modes) {
    const rows: string[][] = [];
    for (const spec of report.specs) {
      const cells = spec.cells.filter((cell) => cell.mode === mode && cell.in);
      if (cells.length === 0) continue;
      const scored = spec.blocks.filter((block) => block.scored);
      const inside = scored.filter((block) => (block.state[mode] ?? 'out') !== 'out');
      const first = spec.blocks.find((block) => block.state[mode] === 'direct');
      const why = [...new Set(cells.flatMap((cell) => cell.why))];
      rows.push([
        spec.specId,
        mode === 'P' ? String(cells.length) : '',
        `${inside.length} of ${scored.length}`,
        first?.id ?? cells.map((cell) => cell.perturbationId ?? '').join(', '),
        why.join(', '),
      ]);
    }
    if (rows.length === 0) {
      lines.push(`Mode ${mode}: no cell in the radius.`);
      continue;
    }
    lines.push(`In the radius, mode ${mode}:`);
    const keep = (row: string[]) => (mode === 'P' ? row : row.filter((_, at) => at !== 1));
    lines.push(...table([keep(['spec', 'cells', 'blocks in', 'from', 'why']), ...rows.map(keep)]));
  }
  return `${lines.join('\n')}\n`;
}

/** The advisory section selection as lines a person reads: nothing is skipped, the whole suite runs. */
export function renderAdvisory(selection: SectionSelection, explain: boolean): string {
  const { counts } = selection;
  const lines = [
    `Advisory section selection (${selection.changed.join(', ')}): nothing is skipped, the whole suite runs until links are verified by mutation.`,
  ];
  if (selection.all !== null) {
    lines.push(`  Every block would run: ${selection.all}.`);
    return `${lines.join('\n')}\n`;
  }
  const extra = selection.closure.filter((id) => !selection.changed.includes(id));
  if (extra.length > 0) lines.push(`  With references, overrides and duplicates: ${extra.join(', ')}.`);
  lines.push(
    `  Would run ${counts.selected} of ${plural(counts.total, 'block')} (${counts.direct} by links, ${counts.forward} forward) and would skip ${counts.skipped}: ${share(counts.skipped, counts.total)} of the suite.`,
  );
  const rows: string[][] = [];
  for (const spec of selection.specs) {
    const selected = spec.blocks.filter((block) => block.state !== 'out');
    if (selected.length === 0) continue;
    const why = [...new Set(selected.filter((b) => b.state === 'direct').flatMap((block) => block.why))];
    const forward = selected.find((block) => block.state === 'forward');
    rows.push([
      spec.specId,
      `${selected.length} of ${spec.blocks.length}`,
      selected[0]?.id ?? '',
      [...why, ...(forward && why.length === 0 ? forward.why : [])].join(', '),
    ]);
  }
  if (rows.length > 0) lines.push(...table([['spec', 'blocks', 'from', 'links that drove it'], ...rows]));
  if (explain)
    for (const spec of selection.specs)
      for (const block of spec.blocks)
        lines.push(
          `${spec.specId}/${block.id}: advisory ${block.state}: ${block.why.join(', ') || 'no link to a changed section'}`,
        );
  return `${lines.join('\n')}\n`;
}

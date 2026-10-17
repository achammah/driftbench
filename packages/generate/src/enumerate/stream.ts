import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { checkSpec, type Spec } from '@agent-nexus/driftbench-core';
import { stringify } from 'yaml';
import { seedFolderName } from '../families/instances';
import { Allocation } from '../seed/allocation';
import {
  generatedSpecText,
  NO_THEN_CRITERION,
  PLACEHOLDER_CRITERION,
  renderDraft,
  SEEDERS,
  type Seeder,
  type SpecDraft,
} from '../seed/assemble';
import { DeviationBalance } from '../seed/deviation-balance';
import type { PreparedMap } from '../seed/map';
import { TerminalSubsumption } from '../seed/minimal';
import { phraseDrafts, type UnsaidPhrase } from '../seed/phrase-seeder';
import { restatedDrafts } from '../seed/restated-seeder';
import { indexDimensions, indexPathValues } from '../seed/scenario';
import {
  boundarySeeder,
  coverDraft,
  deviationSeeder,
  graphSeeder,
  metamorphicSeeder,
  type SeedContext,
  twiseSeeder,
} from '../seed/seeders';
import { streamTaskSpecs } from '../seed/tasks';
import { TerminalPerturbations } from '../seed/terminal-perturbation';
import {
  addUnsaid,
  COMPLETE_DIR,
  DEFAULT_SEED,
  DEFAULT_T,
  type GenerateOptions,
  type GenerateReport,
  INCOMPLETE_DIR,
  measuredCoverage,
  REPORT_FILE,
  type SeederTotals,
} from './generate';
import { StreamCoverage } from './stream-coverage';
import { DiskArray, writeDiskJson } from './stream-storage';

/**
 * The uncapped disk API supports ordinary t-wise generation, max, baseline and caller-supplied tasks.
 * Budget allocation and total spec-cap selection are not streaming operations; this API rejects those
 * options before writing. It never falls back to the eager API or reduces coverage to fit memory.
 */
export type GenerateDiskOptions = Omit<GenerateOptions, 'budget' | 'specCap' | 'specCapMode'> & {
  outputDir: string;
};
export type GenerateDiskResult = {
  reportPath: string;
  summary: GenerateReport['summary'];
  fileCount: number;
};

/**
 * Writes one spec at a time. Auxiliary memory is bounded by the input map, its projected coverage grid,
 * and one spec/family, independently of output spec count. Output-sized diagnostics and placements
 * for the final effective-sample-size pass are spooled to disk. The full report is in reportPath.
 * The destination must be new or empty; the function never removes an existing suite.
 */
export function generateSuiteToDisk(prepared: PreparedMap, options: GenerateDiskOptions): GenerateDiskResult {
  for (const name of ['budget', 'specCap', 'specCapMode'] as const) {
    if ((options as GenerateOptions)[name] !== undefined)
      throw new RangeError(`generateSuiteToDisk does not support ${name}; no files were written`);
  }
  if ((prepared.numericSettings?.length ?? 0) > 0)
    throw new RangeError('generateSuiteToDisk does not support numeric_settings, which requires budget');
  const t = options.t ?? DEFAULT_T;
  const seed = options.seed ?? DEFAULT_SEED;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const directory = resolve(options.outputDir);
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length > 0)
    throw new RangeError('outputDir must be empty; no files were written');
  const scratch = mkdtempSync(join(directory, '.generate-'));
  try {
    return writeSuite(prepared, options, directory, scratch, { t, seed, max });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function writeSuite(
  prepared: PreparedMap,
  options: GenerateDiskOptions,
  directory: string,
  scratch: string,
  context: SeedContext,
): GenerateDiskResult {
  const { t, seed, max } = context;
  context.pathValues = indexPathValues(prepared);
  context.dimensionIndex = indexDimensions(prepared);
  context.allocation = new Allocation(prepared);
  context.minimal = new TerminalSubsumption(
    prepared,
    { seed, mapPath: options.mapPath },
    t,
    context.allocation,
  );
  const run = { seed, mapPath: options.mapPath };
  const coverage = new StreamCoverage(prepared, t, scratch);
  const invalid = new DiskArray<GenerateReport['invalid'][number]>(scratch, 'invalid.jsonl');
  const lint = new DiskArray<GenerateReport['lint'][number]>(scratch, 'lint.jsonl');
  const noThen = new DiskArray<GenerateReport['no_then'][number]>(scratch, 'no-then.jsonl');
  const gaps = new Map<
    string,
    {
      dimension: string;
      value: string;
      blocks: number;
      specs: DiskArray<string>;
      unsaid?: Array<{ text: string; reasons: string[] }>;
    }
  >();
  const seeders = Object.fromEntries(
    SEEDERS.map((seeder) => [
      seeder,
      {
        specs: 0,
        blocks: 0,
        cut_blocks: 0,
        complete: 0,
        needs_phrase: 0,
        needs_then: 0,
        cut: false,
      },
    ]),
  ) as Record<Seeder, SeederTotals>;
  const drafted = Object.fromEntries(SEEDERS.map((seeder) => [seeder, 0])) as Record<Seeder, number>;
  let fileCount = 0;
  let lastDirectory: string | undefined;
  const write = (path: string, text: string | Uint8Array): void => {
    const target = resolve(directory, path);
    const inside = relative(directory, target);
    if (inside === '..' || inside.startsWith(`..${sep}`) || resolve(target) === directory)
      throw new RangeError(`Generated path escapes outputDir: ${path}`);
    const parent = dirname(target);
    if (parent !== lastDirectory) {
      mkdirSync(parent, { recursive: true });
      lastDirectory = parent;
    }
    // Explicit UTF-8 keeps strings on Node's native write path; byte fixtures stay unchanged.
    writeFileSync(target, text, { flag: 'wx', encoding: 'utf8' });
    fileCount += 1;
  };
  const balance = new DeviationBalance(prepared);
  const terminal = new TerminalPerturbations(prepared);
  // The phrases the complete specs say so far: the phrase seeder adds only those no complete spec says yet.
  const saidPhrases = new Set<string>();
  const render = (draft: SpecDraft): Spec | undefined => {
    context.minimal?.reduce(draft);
    context.allocation?.observeDraft(draft);
    const seeder = draft.seeder;
    drafted[seeder] += 1;
    const rendered = renderDraft(prepared, draft, run);
    const loaded = checkSpec(rendered.spec, rendered.id);
    if (!loaded.ok) {
      invalid.push({ id: rendered.id, errors: loaded.errors });
      return;
    }
    const needsPhrase = rendered.placeholders.length > 0;
    const needsThen = rendered.noThen.length > 0;
    const unexpected = loaded.warnings.filter(
      (warning) =>
        !(
          (needsPhrase || needsThen) &&
          warning.code === 'CRITERION_UNRESOLVED' &&
          (warning.message.includes(PLACEHOLDER_CRITERION) || warning.message.includes(NO_THEN_CRITERION))
        ),
    );
    if (unexpected.length > 0) lint.push({ id: rendered.id, warnings: unexpected });
    const totals = seeders[seeder];
    totals.specs += 1;
    totals.blocks += rendered.blocks;
    totals.cut_blocks += draft.reducedEnds?.duplicates.length ?? 0;
    if (needsThen) {
      totals.needs_then += 1;
      noThen.push({ spec: rendered.id, blocks: rendered.noThen, reasons: rendered.reasons });
    }
    if (needsPhrase) {
      totals.needs_phrase += 1;
      const said = new Set<string>();
      for (const gap of rendered.placeholders) {
        const key = `${gap.dimension}=${gap.value}`;
        const entry = gaps.get(key) ?? {
          ...gap,
          blocks: 0,
          specs: new DiskArray<string>(scratch, `gap-${gaps.size}.jsonl`),
        };
        entry.blocks += 1;
        if (!said.has(key)) entry.specs.push(rendered.id);
        said.add(key);
        gaps.set(key, entry);
      }
    }
    const complete = !needsPhrase && !needsThen;
    if (complete) totals.complete += 1;
    if (complete) {
      balance.observe(loaded.spec);
      terminal.observe(loaded.spec);
      for (const block of loaded.spec.blocks) {
        if ('user' in block.when) saidPhrases.add(block.when.user);
        else if ('injection' in block.when && block.when.injection.user !== undefined)
          saidPhrases.add(block.when.injection.user);
      }
    }
    coverage.add(loaded.spec, seeder, complete);
    write(
      `${complete ? COMPLETE_DIR : INCOMPLETE_DIR}/${seeder}/${rendered.id}.yaml`,
      generatedSpecText(rendered, run, prepared.hash),
    );
    return complete ? loaded.spec : undefined;
  };
  context.emit = render;
  context.rows = new DiskArray<number[]>(scratch, 'twise-rows.jsonl');
  const graph = graphSeeder(prepared, context);
  const twise = twiseSeeder(prepared, context);
  const boundary = boundarySeeder(prepared, context);
  const deviation = deviationSeeder(prepared, context);
  const metamorphic = metamorphicSeeder(prepared, context);
  seeders.graph.cut = graph.summary.blocked.length > 0 && graph.summary.paths >= max;
  seeders.twise.cut = twise.summary.covered < twise.summary.allowed;
  seeders.boundary.cut =
    prepared.space.dimensions
      .filter((dimension, index) => dimension.kind === 'data' && !prepared.axes.has(index))
      .reduce((sum, dimension) => sum + dimension.values.filter((value) => value.id !== 'none').length, 0) >
    drafted.boundary;
  seeders.deviation.cut = deviation.summary.classes > drafted.deviation;
  seeders.metamorphic.cut = drafted.metamorphic >= max;

  const header = [
    `# Generated by driftbench generate (seeder task, seed ${seed}) from ${options.mapPath}, map hash ${prepared.hash}.`,
    "# A task family's oracle wrote the Then before any agent ran; this file places it in the map's space.",
    '# Do not edit it by hand: change the family or the map and generate again. Fictional data only.',
  ].join('\n');
  for (const { id, spec, seed: workspace } of streamTaskSpecs(prepared, options.tasks ?? [], run)) {
    const loaded = checkSpec(spec, id);
    if (!loaded.ok) {
      invalid.push({ id, errors: loaded.errors });
      continue;
    }
    seeders.task.specs += 1;
    seeders.task.blocks += loaded.spec.blocks.length;
    seeders.task.complete += 1;
    context.allocation?.observeSpec(loaded.spec);
    context.minimal?.observeSpec(loaded.spec);
    balance.observe(loaded.spec);
    terminal.observe(loaded.spec);
    coverage.add(loaded.spec, 'task', true);
    write(
      `${COMPLETE_DIR}/task/${id}.yaml`,
      `${header}\n${stringify(spec, { lineWidth: 0, aliasDuplicateObjects: false })}`,
    );
    if (workspace) {
      const folder = `${COMPLETE_DIR}/task/${seedFolderName(id)}`;
      for (const [path, content] of Object.entries(workspace.text).sort(([a], [b]) => a.localeCompare(b)))
        write(`${folder}/${path}`, content);
      for (const [path, content] of Object.entries(workspace.binary).sort(([a], [b]) => a.localeCompare(b)))
        write(`${folder}/${path}`, content);
    }
  }

  const cells = coverage.cells(t);
  const uncovered = cells.filter((cell) => cell.count === 0);
  const unbuilt: GenerateReport['cover']['unbuilt'] = [];
  for (const cell of uncovered) {
    if (coverage.isCovered(cell)) continue;
    if (drafted.cover >= max) {
      unbuilt.push({ cell: cell.values, reasons: ['cut by --max'] });
      continue;
    }
    const id = `gen-cover-${String(drafted.cover + 1).padStart(3, '0')}`;
    const built = coverDraft(prepared, context, id, cell.values);
    if (!('draft' in built)) {
      unbuilt.push({ cell: cell.values, reasons: built.reasons });
      continue;
    }
    const made = render(built.draft);
    if (!coverage.isCovered(cell))
      unbuilt.push({
        cell: cell.values,
        reasons: [`${id} was built but ${made === undefined ? 'is incomplete' : 'does not reach the cell'}`],
      });
  }
  const covered = uncovered.filter((cell) => coverage.isCovered(cell)).length;
  // Restated slots, then phrases no complete spec says yet, in the order the eager API runs them.
  for (const draft of restatedDrafts(prepared, context, 0)) render(draft);
  const unsaid: UnsaidPhrase[] = [];
  for (const draft of phraseDrafts(prepared, context, saidPhrases, 0, unsaid)) render(draft);
  addUnsaid(gaps, unsaid, (gap) => ({
    ...gap,
    blocks: 0,
    specs: new DiskArray<string>(scratch, `gap-${gaps.size}.jsonl`),
  }));
  // Deviation balance, as the eager API runs it: after coverage, on what the suite probes so far.
  const written = () => Object.values(seeders).reduce((sum, entry) => sum + entry.specs, 0);
  for (const draft of balance.topUps(context, written())) render(draft);
  // A class whose recovery moves the conversation elsewhere, as the eager API declares it: one walk cut for it.
  for (const draft of terminal.drafts(context)) render(draft);
  // Allocation, as the eager API runs it: walks for rare stages and behaviours, alternating with class probes.
  for (const draft of context.allocation.rounds(context, written, balance)) render(draft);
  const held = new Set(
    cells.flatMap((cell) => Object.entries(cell.values).map(([dimension, value]) => `${dimension}=${value}`)),
  );
  for (const seeder of SEEDERS) seeders[seeder].measures = coverage.seederMeasures(seeder);
  const totals = Object.values(seeders);
  const summary = {
    specs: totals.reduce((sum, entry) => sum + entry.specs, 0),
    blocks: totals.reduce((sum, entry) => sum + entry.blocks, 0),
    complete: totals.reduce((sum, entry) => sum + entry.complete, 0),
    incomplete: totals.reduce((sum, entry) => sum + entry.specs - entry.complete, 0),
  };
  const completeCoverage = coverage.measured(t);
  const report = {
    generator: 'driftbench generate',
    map: {
      path: options.mapPath,
      agent: prepared.agent,
      version: prepared.version,
      hash: prepared.hash,
      dimensions: prepared.map.dimensions.length,
      values: prepared.map.dimensions.reduce((sum, dimension) => sum + dimension.values.length, 0),
      constraints: prepared.map.constraints.length,
      phrases: prepared.phrases.length,
    },
    options: { t, seed, max: Number.isFinite(max) ? max : null },
    summary,
    seeders,
    graph: graph.summary,
    twise: twise.summary,
    boundary: boundary.summary,
    deviation: deviation.summary,
    metamorphic: metamorphic.summary,
    cover: {
      cells: uncovered.length,
      covered,
      unbuilt,
      unreachable: prepared.axisMap.dimensions.flatMap((dimension) =>
        dimension.values
          .filter((value) => !held.has(`${dimension.id}=${value.id}`))
          .map((value) => ({ dimension: dimension.id, value: value.id })),
      ),
    },
    constraints: {
      applied: prepared.map.constraints.length,
      list: prepared.map.constraints.map((constraint) => ({
        forbid: constraint.forbid,
        reason: constraint.reason,
      })),
    },
    no_phrase: [...gaps.values()],
    no_then: noThen,
    coverage: {
      actual: [
        ...new Set([2, 3].map((strength) => Math.min(strength, prepared.axisMap.dimensions.length))),
      ].map((strength) => ({
        ...coverage.measured(strength),
        uncovered: coverage
          .cells(strength)
          .filter((cell) => cell.count === 0)
          .map((cell) => cell.values),
      })),
      t,
      allowed: completeCoverage.allowed,
      complete: completeCoverage,
      all: coverage.measured(t, false),
      measures: coverage.measures(),
      ...(options.baseline
        ? {
            baseline: {
              label: options.baseline.label,
              ...measuredCoverage(prepared, options.baseline.specs, t),
            },
          }
        : {}),
    },
    invalid,
    lint,
  };
  const reportPath = join(directory, REPORT_FILE);
  writeDiskJson(reportPath, report);
  return { reportPath, summary, fileCount: fileCount + 1 };
}

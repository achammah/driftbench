import { checkSpec, type Issue, type LoadResult, type Spec } from '@agent-nexus/driftbench-core';
import {
  assertGridSize,
  type CompiledSpace,
  combinations,
  compileSpace,
  cover,
  coverage,
  type Projection,
  placeSpec,
  projectGrid,
  resolveT,
  tupleValues,
} from '@agent-nexus/driftbench-space';
import { stringify } from 'yaml';
import { seedFolderName } from '../families/instances';
import { Allocation } from '../seed/allocation';
import {
  generatedSpecText,
  NO_THEN_CRITERION,
  PLACEHOLDER_CRITERION,
  type Rendered,
  type RunIdentity,
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
  type BoundarySummary,
  type BudgetSummary,
  boundarySeeder,
  budgetSeeder,
  coverDraft,
  type DeviationSummary,
  deviationSeeder,
  type GraphSummary,
  graphSeeder,
  type MetamorphicSummary,
  metamorphicSeeder,
  type SeedContext,
  type TwiseSummary,
  twiseSeeder,
} from '../seed/seeders';
import { type TaskInput, taskSpecs } from '../seed/tasks';
import { TerminalPerturbations } from '../seed/terminal-perturbation';
import { formatJson } from './json';
import { capSpecPool, type SpecCapMode, type SpecCapReport, seederOf } from './spec-cap';

/** t-wise coverage of a set of specs on the axis map, as `driftbench space coverage --t` counts it. */
export type MeasuredCoverage = { t: number; specs: number; allowed: number; covered: number; share: number };

/**
 * `generateSuite`: every seeder over one approved map, each draft written as a spec, validated and linted
 * by the core loader, then the report. Pure: it reads nothing and writes nothing; the caller writes the
 * files. Same map, same options: the same files, byte for byte.
 */

export const DEFAULT_T = 3;
export const DEFAULT_SEED = 1;
/** The report's file name inside the output folder. */
export const REPORT_FILE = 'generate-report.json';
/** Specs every block of which has an approved phrase and a Then. */
export const COMPLETE_DIR = 'specs';
/**
 * Specs with a placeholder turn (a value with no approved phrase) or a block the map supports no Then
 * for: valid, flagged by lint, not runnable.
 */
export const INCOMPLETE_DIR = 'incomplete';

export type GenerateOptions = {
  t?: number;
  seed?: number;
  /** The most specs per seeder. */
  max?: number;
  /**
   * Budget mode: N conversations placed by the budget rules in place of the twise seeder's rows (seed/budget.ts).
   * The other seeders are unchanged.
   */
  budget?: number;
  /** Total written specs. Keeps structural probes and selects actual pair/triple coverage. */
  specCap?: number;
  /** Tuple-exact by default. Pairs mode explicitly permits triple losses, which remain reported. */
  specCapMode?: SpecCapMode;
  /**
   * Drop the repeated end of a walk another written spec already says (default true). Under `specCap` it runs
   * after the cap, on the specs actually written, so no walk loses an end only a dropped spec said.
   */
  reduceEnds?: boolean;
  /** The map path as the specs and the report record it (relative to the output folder). */
  mapPath: string;
  /** Specs to measure on the same map for comparison, such as the hand-written suite. */
  baseline?: { label: string; specs: Spec[] };
  /**
   * The specs the map's task families built (`task_family`), one entry per family: the caller builds them,
   * since a family's oracle runs asynchronously. A flow with a task family and none given has no specs.
   */
  tasks?: TaskInput[];
};

/** A file the suite writes: text, or bytes for a seed file that is not text (then `text` is empty). */
export type GeneratedFile = { path: string; text: string; bytes?: Uint8Array };

export type SeederTotals = {
  specs: number;
  blocks: number;
  complete: number;
  /** Incomplete specs: a placeholder turn. */
  needs_phrase: number;
  /** Incomplete specs: a block with no Then the map supports. */
  needs_then: number;
  cut: boolean;
  /** The diversity measures of this seeder's complete specs (see `coverageMeasures`). */
  measures?: Record<string, number>;
};

export type GenerateReport = {
  generator: 'driftbench generate';
  map: {
    path: string;
    agent: string;
    version: string;
    hash: string;
    dimensions: number;
    values: number;
    constraints: number;
    phrases: number;
  };
  options: {
    t: number;
    seed: number;
    max: number | null;
    budget?: number;
    specCap?: number;
    specCapMode?: SpecCapMode;
  };
  summary: { specs: number; blocks: number; complete: number; incomplete: number };
  seeders: Record<Seeder, SeederTotals>;
  graph: GraphSummary;
  twise: TwiseSummary;
  /** Budget mode only: the pick, the pair coverage and the value balance of the twise seeder's replacement. */
  budget?: BudgetSummary;
  /** Total cap, including all gaps and any loss relative to the uncapped candidate pool. */
  spec_cap?: SpecCapReport;
  boundary: BoundarySummary;
  deviation: DeviationSummary;
  metamorphic: MetamorphicSummary;
  /**
   * The cover seeder: the allowed cells of the axis map no complete spec of the other seeders covered, how
   * many it built a complete spec for, and why it could not build the others.
   */
  cover: CoverSummary;
  constraints: { applied: number; list: Array<{ forbid: Record<string, string>; reason: string }> };
  /**
   * Values with no approved phrase, their placeholder blocks and specs; and a value whose approved phrase no
   * walk could say, with the phrase and why (`unsaid`, `blocks` 0).
   */
  no_phrase: NoPhrase[];
  /** Specs with a block the map supports no machine Then for, and why when a path could not be walked. */
  no_then: Array<{ spec: string; blocks: string[]; reasons: string[] }>;
  coverage: {
    /** Actual axis-map coverage of the written complete specs, independent of the candidate array. */
    actual: Array<MeasuredCoverage & { uncovered: Record<string, string>[] }>;
    /** Inventory ownership exclusions, with pair/triple target counts before and after applying them. */
    reachability?: {
      counts: Array<{ t: number; before: number; after: number }>;
      excluded: Array<{ cell: Record<string, string>; reasons: string[] }>;
    };
    t: number;
    allowed: number;
    complete: MeasuredCoverage;
    all: MeasuredCoverage;
    /** The coverage and diversity measures of the complete specs. */
    measures: Record<string, number>;
    baseline?: MeasuredCoverage & { label: string };
  };
  /** Specs the core loader refused: a generator defect. Never written. */
  invalid: Array<{ id: string; errors: Issue[] }>;
  /** Lint warnings on complete specs: a generator defect when not empty. */
  lint: Array<{ id: string; warnings: Issue[] }>;
};

export type NoPhrase = {
  dimension: string;
  value: string;
  blocks: number;
  specs: string[];
  unsaid?: Array<{ text: string; reasons: string[] }>;
};

/** Adds each approved phrase the phrase seeder could not say to the value's `no_phrase` entry. */
export function addUnsaid<T extends Omit<NoPhrase, 'specs'>>(
  gaps: Map<string, T>,
  unsaid: readonly UnsaidPhrase[],
  fresh: (gap: { dimension: string; value: string }) => T,
): void {
  for (const entry of unsaid) {
    const key = `${entry.dimension}=${entry.value}`;
    const gap = gaps.get(key) ?? fresh({ dimension: entry.dimension, value: entry.value });
    gap.unsaid = [...(gap.unsaid ?? []), { text: entry.text, reasons: entry.reasons }];
    gaps.set(key, gap);
  }
}

export type CoverSummary = {
  /** Cells left uncovered by the other seeders. */
  cells: number;
  /** Cells covered after the cover seeder. */
  covered: number;
  /** Cells still uncovered, each with the reasons no scenario could be built for it. */
  unbuilt: Array<{ cell: Record<string, string>; reasons: string[] }>;
  /**
   * Axis values no allowed cell holds: the map's relations rule out every pair with them (a flow with no
   * approved path, for one). No spec can cover them until the map gives them a path.
   */
  unreachable: Array<{ dimension: string; value: string }>;
};

export type GenerateResult = {
  files: GeneratedFile[];
  report: GenerateReport;
  complete: Spec[];
  all: Spec[];
};

export function generateSuite(prepared: PreparedMap, options: GenerateOptions): GenerateResult {
  if (options.specCapMode !== undefined && options.specCap === undefined)
    throw new RangeError('specCapMode requires specCap');
  if (options.specCap !== undefined && (!Number.isSafeInteger(options.specCap) || options.specCap < 1))
    throw new RangeError('specCap must be a whole number of at least 1');
  if ((prepared.numericSettings?.length ?? 0) > 0 && options.budget === undefined)
    throw new RangeError(
      'numeric_settings requires --budget; the other seeders do not sample numeric ranges',
    );
  const t = options.t ?? DEFAULT_T;
  const seed = options.seed ?? DEFAULT_SEED;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const allocation = new Allocation(prepared);
  const context: SeedContext = {
    seed,
    t,
    max,
    pathValues: indexPathValues(prepared),
    dimensionIndex: indexDimensions(prepared),
    allocation,
  };
  const run: RunIdentity = { seed, mapPath: options.mapPath };
  const reduceEnds = options.reduceEnds !== false;
  // Without a cap, each draft is reduced as it is written. With one, the cap decides what is written first and
  // the pass below reduces the specs that stay, in the order they were written.
  if (reduceEnds && options.specCap === undefined)
    context.minimal = new TerminalSubsumption(prepared, run, t, allocation);
  const draftOf = new Map<string, SpecDraft>();

  const graph = graphSeeder(prepared, context);
  const budgeted =
    options.budget === undefined ? undefined : budgetSeeder(prepared, context, { budget: options.budget });
  const twise = budgeted ?? twiseSeeder(prepared, context);
  const boundary = boundarySeeder(prepared, context);
  const deviation = deviationSeeder(prepared, context);
  const metamorphic = metamorphicSeeder(prepared, context);
  const drafts: Record<Seeder, SpecDraft[]> = {
    graph: graph.drafts,
    twise: twise.drafts,
    boundary: boundary.drafts,
    deviation: deviation.drafts,
    metamorphic: metamorphic.drafts,
    task: [],
    cover: [],
  };
  const cut: Record<Seeder, boolean> = {
    graph: graph.summary.blocked.length > 0 && graph.summary.paths >= max,
    // A budget below the pair-cover size is the point of the mode, not a cut: it exits 0.
    twise: budgeted === undefined && twise.summary.covered < twise.summary.allowed,
    boundary: dataValues(prepared) > boundary.drafts.length,
    deviation: deviation.summary.classes > deviation.drafts.length,
    metamorphic: metamorphic.drafts.length >= max,
    task: false,
    cover: false,
  };

  const files: GeneratedFile[] = [];
  const fileOwners = new Map<string, string>();
  const addFile = (id: string, file: GeneratedFile): void => {
    files.push(file);
    fileOwners.set(file.path, id);
  };
  const cappedText = new Map<string, () => string>();
  const complete: Spec[] = [];
  const all: Spec[] = [];
  const invalid: GenerateReport['invalid'] = [];
  const lint: GenerateReport['lint'] = [];
  const gaps = new Map<string, NoPhrase>();
  const noThen: GenerateReport['no_then'] = [];
  const seeders = {} as Record<Seeder, SeederTotals>;
  const completeBy: Partial<Record<Seeder, Spec[]>> = {};
  const keep = (seeder: Seeder, spec: Spec): void => {
    const kept = completeBy[seeder] ?? [];
    completeBy[seeder] = kept;
    kept.push(spec);
  };

  /** Renders drafts of one seeder, adds them to the suite and the seeder's totals; returns the complete ones. */
  const renderSeeder = (seeder: Seeder, list: readonly SpecDraft[]): Spec[] => {
    const own: Spec[] = [];
    const totals: SeederTotals = seeders[seeder] ?? {
      specs: 0,
      blocks: 0,
      complete: 0,
      needs_phrase: 0,
      needs_then: 0,
      cut: cut[seeder],
    };
    for (const draft of list) {
      context.minimal?.reduce(draft);
      context.allocation?.observeDraft(draft);
      const rendered: Rendered = renderDraft(prepared, draft, run);
      if (options.specCap !== undefined && reduceEnds) draftOf.set(rendered.id, draft);
      const renderText = () => generatedSpecText(rendered, run, prepared.hash);
      const text = options.specCap === undefined ? renderText() : '';
      const loaded = checkSpec(rendered.spec, rendered.id);
      if (!loaded.ok) {
        invalid.push({ id: rendered.id, errors: loaded.errors });
        continue;
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
      totals.specs += 1;
      totals.blocks += rendered.blocks;
      all.push(loaded.spec);
      if (needsThen) {
        totals.needs_then += 1;
        noThen.push({ spec: rendered.id, blocks: rendered.noThen, reasons: rendered.reasons });
      }
      if (needsPhrase) {
        totals.needs_phrase += 1;
        for (const gap of rendered.placeholders) {
          const key = `${gap.dimension}=${gap.value}`;
          const entry = gaps.get(key) ?? { ...gap, blocks: 0, specs: [] };
          entry.blocks += 1;
          if (!entry.specs.includes(rendered.id)) entry.specs.push(rendered.id);
          gaps.set(key, entry);
        }
      }
      if (!needsPhrase && !needsThen) {
        totals.complete += 1;
        complete.push(loaded.spec);
        own.push(loaded.spec);
        keep(seeder, loaded.spec);
      }
      const folder = needsPhrase || needsThen ? INCOMPLETE_DIR : COMPLETE_DIR;
      const path = `${folder}/${seeder}/${rendered.id}.yaml`;
      if (options.specCap !== undefined) cappedText.set(path, renderText);
      addFile(rendered.id, { path, text });
    }
    seeders[seeder] = totals;
    return own;
  };
  for (const seeder of SEEDERS)
    renderSeeder(seeder, seeder === 'cover' || seeder === 'task' ? [] : drafts[seeder]);

  // The task seeder: the specs the task families built, placed in the space (seed/tasks.ts).
  const header = [
    `# Generated by driftbench generate (seeder task, seed ${seed}) from ${options.mapPath}, map hash ${prepared.hash}.`,
    "# A task family's oracle wrote the Then before any agent ran; this file places it in the map's space.",
    '# Do not edit it by hand: change the family or the map and generate again. Fictional data only.',
  ].join('\n');
  for (const { id, spec, seed: workspace } of taskSpecs(prepared, options.tasks ?? [], run)) {
    const renderText = () => `${header}\n${stringify(spec, { lineWidth: 0, aliasDuplicateObjects: false })}`;
    const text = options.specCap === undefined ? renderText() : '';
    const loaded = checkSpec(spec, id);
    const totals = seeders.task;
    if (!loaded.ok) {
      invalid.push({ id, errors: loaded.errors });
      continue;
    }
    totals.specs += 1;
    totals.blocks += loaded.spec.blocks.length;
    totals.complete += 1;
    all.push(loaded.spec);
    complete.push(loaded.spec);
    keep('task', loaded.spec);
    context.allocation?.observeSpec(loaded.spec);
    context.minimal?.observeSpec(loaded.spec);
    const path = `${COMPLETE_DIR}/task/${id}.yaml`;
    if (options.specCap !== undefined) cappedText.set(path, renderText);
    addFile(id, { path, text });
    // A workspace with a file that is not text starts from a folder: written beside the spec, as
    // `driftbench family instances` writes it (families/instances.ts seedFolderName).
    if (workspace) {
      const folder = `${COMPLETE_DIR}/task/${seedFolderName(id)}`;
      for (const [path, content] of Object.entries(workspace.text).sort(([a], [b]) => a.localeCompare(b)))
        addFile(id, { path: `${folder}/${path}`, text: content });
      for (const [path, content] of Object.entries(workspace.binary).sort(([a], [b]) => a.localeCompare(b)))
        addFile(id, { path: `${folder}/${path}`, text: '', bytes: content });
    }
  }

  // The cover seeder: one scenario per allowed cell still uncovered, skipping a cell an earlier cover spec
  // already reached. A cell it cannot build is listed with the reasons.
  const uncovered = cellsOf(prepared, complete, t).filter((cell) => cell.count === 0);
  const unbuilt: CoverSummary['unbuilt'] = [];
  const reached = new Set<string>();
  for (const cell of uncovered) {
    const key = cellKey(cell.values);
    if (reached.has(key)) continue;
    if (drafts.cover.length >= max) {
      cut.cover = true;
      unbuilt.push({ cell: cell.values, reasons: ['cut by --max'] });
      continue;
    }
    const id = `gen-cover-${String(drafts.cover.length + 1).padStart(3, '0')}`;
    const built = coverDraft(prepared, context, id, cell.values);
    if (!('draft' in built)) {
      unbuilt.push({ cell: cell.values, reasons: built.reasons });
      continue;
    }
    drafts.cover.push(built.draft);
    const made = renderSeeder('cover', [built.draft]);
    for (const values of reachedCells(prepared, made, t)) reached.add(cellKey(values));
    if (!reached.has(key))
      unbuilt.push({
        cell: cell.values,
        reasons: [`${id} was built but ${made.length === 0 ? 'is incomplete' : 'does not reach the cell'}`],
      });
  }
  // Restated slots: a value asked for first, another stated in the move; the move holds the latest.
  renderSeeder('boundary', restatedDrafts(prepared, context, 0));
  // Phrases no complete spec says yet: each said once at the stage after a walk's first move.
  const said = new Set(
    complete.flatMap((spec) =>
      spec.blocks.flatMap((block) =>
        'user' in block.when
          ? [block.when.user]
          : 'injection' in block.when && block.when.injection.user !== undefined
            ? [block.when.injection.user]
            : [],
      ),
    ),
  );
  const unsaid: UnsaidPhrase[] = [];
  renderSeeder('cover', phraseDrafts(prepared, context, said, 0, unsaid));
  addUnsaid(gaps, unsaid, (gap) => ({ ...gap, blocks: 0, specs: [] }));
  // Deviation balance: after coverage, classes probed less than a third as often as the most probed class get
  // more approved probes, so one class is not tested many times while another barely is.
  const balance = new DeviationBalance(prepared);
  for (const spec of complete) balance.observe(spec);
  for (const draft of balance.topUps(context, all.length)) {
    for (const spec of renderSeeder('deviation', [draft])) balance.observe(spec);
  }
  // A class whose recovery moves the conversation elsewhere no clean walk declares: one walk cut for it.
  const terminal = new TerminalPerturbations(prepared);
  for (const spec of complete) terminal.observe(spec);
  for (const draft of terminal.drafts(context)) {
    for (const spec of renderSeeder('deviation', [draft])) {
      terminal.observe(spec);
      balance.observe(spec);
    }
  }
  // Allocation: stages and behaviours placed less than a third as often as the most placed one get approved
  // walks, alternating with class probes until all hold.
  for (const draft of allocation.rounds(context, () => all.length, balance)) {
    for (const spec of renderSeeder('deviation', [draft])) {
      terminal.observe(spec);
      balance.observe(spec);
    }
  }
  const held = new Set(
    cellsOf(prepared, [], t).flatMap((cell) =>
      Object.entries(cell.values).map(([dimension, value]) => `${dimension}=${value}`),
    ),
  );
  const coverSummary: CoverSummary = {
    cells: uncovered.length,
    covered: uncovered.filter((cell) => reached.has(cellKey(cell.values))).length,
    unbuilt,
    unreachable: prepared.axisMap.dimensions.flatMap((dimension) =>
      dimension.values
        .filter((value) => !held.has(`${dimension.id}=${value.id}`))
        .map((value) => ({ dimension: dimension.id, value: value.id })),
    ),
  };

  let specCap: SpecCapReport | undefined;
  if (options.specCap !== undefined) {
    const strengths = [
      ...new Set([2, 3, t].map((strength) => Math.min(strength, prepared.axisMap.dimensions.length))),
    ];
    const capped = capSpecPool(
      all,
      complete,
      options.specCap,
      strengths.map((strength) => gridAt(prepared, strength)),
      options.specCapMode,
    );
    specCap = capped.report;
    const retain = (specs: Spec[]) => {
      const kept = specs.filter((spec) => capped.ids.has(spec.id));
      specs.splice(0, specs.length, ...kept);
    };
    retain(all);
    retain(complete);
    if (reduceEnds) {
      const written = new Allocation(prepared);
      const minimal = new TerminalSubsumption(prepared, run, t, written);
      for (const [index, spec] of all.entries()) {
        const draft = draftOf.get(spec.id);
        if (!draft) {
          minimal.observeSpec(spec);
          written.observeSpec(spec);
          continue;
        }
        const before = draft.blocks.length;
        minimal.reduce(draft);
        written.observeDraft(draft);
        if (draft.blocks.length === before) continue;
        const rendered: Rendered = renderDraft(prepared, draft, run);
        const loaded = checkSpec(rendered.spec, rendered.id);
        if (!loaded.ok) continue;
        const wasComplete = complete.indexOf(spec);
        all[index] = loaded.spec;
        if (wasComplete >= 0) complete[wasComplete] = loaded.spec;
        const path = [...cappedText.keys()].find((entry) => entry.endsWith(`/${rendered.id}.yaml`));
        if (path !== undefined) cappedText.set(path, () => generatedSpecText(rendered, run, prepared.hash));
      }
    }
    for (const seeder of SEEDERS) {
      const own = all.filter((spec) => seederOf(spec) === seeder);
      const ready = complete.filter((spec) => seederOf(spec) === seeder);
      completeBy[seeder] = ready;
      seeders[seeder].specs = own.length;
      seeders[seeder].blocks = own.reduce((sum, spec) => sum + spec.blocks.length, 0);
      seeders[seeder].complete = ready.length;
    }
    const keptFiles = files.filter((file) => capped.ids.has(fileOwners.get(file.path) ?? ''));
    files.splice(0, files.length, ...keptFiles);
    for (const file of files) {
      file.text = cappedText.get(file.path)?.() ?? file.text;
    }
    const finalKeys = new Set(
      cellsOf(prepared, complete, t)
        .filter((cell) => cell.count > 0)
        .map((cell) => cellKey(cell.values)),
    );
    coverSummary.covered = uncovered.filter((cell) => finalKeys.has(cellKey(cell.values))).length;
    for (const cell of specCap.coverage.find(
      (entry) => entry.t === Math.min(t, prepared.axisMap.dimensions.length),
    )?.lost ?? [])
      coverSummary.unbuilt.push({ cell, reasons: ['cut by --spec-cap'] });
  }

  const measure = (specs: Spec[]) => measured(prepared, specs, t);
  const completeCoverage = measure(complete);
  const baseline = options.baseline
    ? { label: options.baseline.label, ...measure(options.baseline.specs) }
    : undefined;
  for (const seeder of SEEDERS) {
    (seeders[seeder] as SeederTotals).measures = seederMeasures(prepared, completeBy[seeder] ?? []);
  }
  const totals = Object.values(seeders);
  const report: GenerateReport = {
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
    options: {
      t,
      seed,
      max: Number.isFinite(max) ? max : null,
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      ...(options.specCap === undefined
        ? {}
        : { specCap: options.specCap, specCapMode: options.specCapMode ?? 'tuples' }),
    },
    summary: {
      specs: totals.reduce((sum, entry) => sum + entry.specs, 0),
      blocks: totals.reduce((sum, entry) => sum + entry.blocks, 0),
      complete: totals.reduce((sum, entry) => sum + entry.complete, 0),
      incomplete: totals.reduce((sum, entry) => sum + entry.specs - entry.complete, 0),
    },
    seeders,
    graph: graph.summary,
    twise: twise.summary,
    ...(budgeted ? { budget: budgeted.budget } : {}),
    ...(specCap ? { spec_cap: specCap } : {}),
    boundary: boundary.summary,
    deviation: deviation.summary,
    metamorphic: metamorphic.summary,
    cover: coverSummary,
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
      ].map((strength) => {
        const cells = cellsOf(prepared, complete, strength);
        const uncovered = cells.filter((cell) => cell.count === 0).map((cell) => cell.values);
        return {
          t: strength,
          specs: complete.length,
          allowed: cells.length,
          covered: cells.length - uncovered.length,
          share: cells.length === 0 ? 0 : (cells.length - uncovered.length) / cells.length,
          uncovered,
        };
      }),
      ...(prepared.reachability ? { reachability: reachabilityReport(prepared) } : {}),
      t,
      allowed: completeCoverage.allowed,
      complete: completeCoverage,
      all: all.length === complete.length ? { ...completeCoverage } : measure(all),
      measures: coverageMeasures(prepared, complete),
      ...(baseline ? { baseline } : {}),
    },
    invalid,
    lint,
  };
  files.push({ path: REPORT_FILE, text: formatJson(report) });
  return { files, report, complete, all };
}

/**
 * The grid of the approved axis map at strength t, projected once per map: the projection is the costly
 * part of the space package's `coverage` (it walks every allowed cell), and the cover seeder asks for the
 * cells one spec reaches many times. The counts below are those `coverage` prints for the same specs.
 */
/** The largest full grid the report counts coverage on: a map with a hundred times the behaviours stays inside it. */
const MAX_GRID_CELLS = 4_000_000;

type CachedGrid = { space: CompiledSpace; projections: Projection[] };
const GRIDS = new WeakMap<PreparedMap, Map<number, CachedGrid>>();

function gridAt(prepared: PreparedMap, strength: number): CachedGrid {
  let byT = GRIDS.get(prepared);
  if (!byT) {
    byT = new Map();
    GRIDS.set(prepared, byT);
  }
  const known = byT.get(strength);
  if (known) return known;
  assertGridSize(prepared.axisMap, MAX_GRID_CELLS);
  const space = compileSpace(prepared.axisMap);
  const t = resolveT(space, strength);
  const projections = projectGrid(space, combinations(space.dimensions.length, t)).projections;
  const grid = { space, projections };
  byT.set(strength, grid);
  return grid;
}

/** How many of the specs cover each allowed cell of the axis map at strength t, by the cached grid. */
function cellCounts(
  prepared: PreparedMap,
  specs: readonly Spec[],
  t: number,
): Array<{ values: Record<string, string>; count: number }> {
  const grid = gridAt(prepared, Math.min(t, prepared.axisMap.dimensions.length));
  const placements = specs.map((spec) => placeSpec(grid.space, spec));
  const out: Array<{ values: Record<string, string>; count: number }> = [];
  for (const projection of grid.projections) {
    const covered = cover(projection, placements);
    projection.allowed.forEach((allowed, code) => {
      if (!allowed) return;
      out.push({
        values: { ...tupleValues(projection, code, grid.space) },
        count: covered.byCode.get(code)?.length ?? 0,
      });
    });
  }
  return out;
}

/** The allowed cells of the axis map at strength t that at least one of the specs covers. */
function reachedCells(
  prepared: PreparedMap,
  specs: readonly Spec[],
  t: number,
): Array<Record<string, string>> {
  const grid = gridAt(prepared, Math.min(t, prepared.axisMap.dimensions.length));
  const placements = specs.map((spec) => placeSpec(grid.space, spec));
  const out: Array<Record<string, string>> = [];
  for (const projection of grid.projections) {
    for (const code of cover(projection, placements).byCode.keys()) {
      if (projection.allowed[code] === 1) out.push({ ...tupleValues(projection, code, grid.space) });
    }
  }
  return out;
}

/** The allowed cells of the axis map at strength t, each with how many of the specs cover it. */
export function cellsOf(
  prepared: PreparedMap,
  specs: readonly Spec[],
  t: number,
): Array<{ values: Record<string, string>; count: number }> {
  return cellCounts(prepared, specs, t);
}

function cellKey(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join('&');
}

function measured(prepared: PreparedMap, specs: Spec[], t: number): MeasuredCoverage {
  return measuredCoverage(prepared, specs, t);
}

/** Each removed pair/triple stays visible, including cells excluded through a missing completion. */
export function reachabilityReport(
  prepared: PreparedMap,
): NonNullable<GenerateReport['coverage']['reachability']> {
  const reachability = prepared.reachability;
  if (!reachability) return { counts: [], excluded: [] };
  const before = { ...prepared, axisMap: reachability.before };
  const counts: Array<{ t: number; before: number; after: number }> = [];
  const excluded: Array<{ cell: Record<string, string>; reasons: string[] }> = [];
  for (const strength of new Set([2, 3].map((t) => Math.min(t, prepared.axisMap.dimensions.length)))) {
    const original = cellsOf(before, [], strength);
    const current = cellsOf(prepared, [], strength);
    const retained = new Set(current.map(({ values }) => cellKey(values)));
    counts.push({ t: strength, before: original.length, after: current.length });
    for (const { values } of original) {
      if (retained.has(cellKey(values))) continue;
      const reasons = reachability.excluded
        .filter(({ forbid }) => Object.entries(forbid).every(([key, value]) => values[key] === value))
        .map(({ reason }) => reason);
      excluded.push({
        cell: values,
        reasons:
          reasons.length > 0 ? reasons : ['no completion respects flow ownership; see constraints.list'],
      });
    }
  }
  return { counts, excluded };
}

/** t-wise coverage of the specs, read from the cached grid: the counts `coverage` states for the same specs. */
export function measuredCoverage(prepared: PreparedMap, specs: Spec[], t: number): MeasuredCoverage {
  const strength = Math.min(t, prepared.axisMap.dimensions.length);
  const grid = gridAt(prepared, strength);
  const placements = specs.map((spec) => placeSpec(grid.space, spec));
  let allowed = 0;
  let covered = 0;
  for (const projection of grid.projections) {
    for (const flag of projection.allowed) allowed += flag;
    for (const code of cover(projection, placements).byCode.keys())
      if (projection.allowed[code] === 1) covered += 1;
  }
  return { t: strength, specs: specs.length, allowed, covered, share: allowed > 0 ? covered / allowed : 0 };
}

/**
 * The coverage and diversity measures of a set of specs on the axis map: Good-Turing discovery, Chao
 * coverage and richness, Hill numbers of order 0, 1 and 2, Pielou evenness (all over the counts of the t = 2
 * cells the specs cover), the t = 3 share, the weighted share and its effective sample size, the required
 * cells, the values covered per axis, and the share of blocks with a machine Then.
 */
export function coverageMeasures(prepared: PreparedMap, specs: readonly Spec[]): Record<string, number> {
  const results: LoadResult[] = specs.map((spec) => ({
    ok: true,
    path: spec.id,
    spec,
    hash: '',
    warnings: [],
  }));
  const axisMap = prepared.axisMap;
  const two = coverage(axisMap, results, {
    maxCells: MAX_GRID_CELLS,
    t: 2,
    ...(prepared.inventory ? { inventory: prepared.inventory } : {}),
  });
  // A coverage result already tallies every pair and triple, independently of the requested grid t.
  const three = two.tway.find((level) => level.t === 3);
  const counts = two.grid.cells.map((cell) => cell.count).filter((count) => count > 0);
  const n = counts.reduce((sum, count) => sum + count, 0);
  const f1 = counts.filter((count) => count === 1).length;
  const f2 = counts.filter((count) => count === 2).length;
  const shares = counts.map((count) => count / Math.max(1, n));
  const entropy = -shares.reduce((sum, share) => sum + (share > 0 ? share * Math.log(share) : 0), 0);
  const out: Record<string, number> = {
    discovery: n === 0 ? 1 : f1 / n,
    chao_coverage: n === 0 ? 0 : 1 - (f1 / n) * (((n - 1) * f1) / ((n - 1) * f1 + 2 * f2 || 1)),
    chao1:
      counts.length +
      (n === 0 ? 0 : f2 > 0 ? ((n - 1) / n) * ((f1 * f1) / (2 * f2)) : ((n - 1) / n) * ((f1 * (f1 - 1)) / 2)),
    hill_q0: counts.length,
    hill_q1: stable(Math.exp(entropy)),
    hill_q2:
      1 /
      Math.max(
        Number.EPSILON,
        shares.reduce((sum, share) => sum + share * share, 0),
      ),
    pielou: counts.length > 1 ? stable(entropy / Math.log(counts.length)) : 1,
    t3_share: three?.share ?? 0,
    t3_allowed: three?.allowed ?? 0,
    weighted_share: two.grid.weighted ?? 0,
    effective_sample_size: two.grid.effectiveSampleSize ?? 0,
    required_covered: two.required.filter((cell) => cell.covered).length,
    required_total: two.required.length,
  };
  for (const dimension of two.dimensions) out[`axis_${dimension.id}`] = dimension.covered;
  Object.assign(out, machineShare(specs));
  return out;
}

/**
 * A measure that goes through a logarithm or an exponential, kept to twelve decimals: the last bit of those
 * functions differs between processors, and the report must be the same bytes on every machine.
 */
function stable(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

/** The share of blocks with a machine Then, and the blocks left to a judge. */
function machineShare(specs: readonly Spec[]): { machine_then_share: number; judged_only_blocks: number } {
  let blocks = 0;
  let machine = 0;
  for (const spec of specs) {
    for (const block of spec.blocks) {
      blocks += 1;
      const expect = block.expect ?? {};
      if (
        Object.keys(expect).some((key) => key !== 'criteria' && key !== 'ledger_add') ||
        spec.rules !== undefined
      )
        machine += 1;
    }
  }
  return { machine_then_share: blocks === 0 ? 0 : machine / blocks, judged_only_blocks: blocks - machine };
}

/** The four measures a seeder states: richness and evenness over the t = 2 cells its specs cover, the Then share. */
function seederMeasures(prepared: PreparedMap, specs: readonly Spec[]): Record<string, number> {
  const counts = cellCounts(prepared, specs, 2)
    .map((cell) => cell.count)
    .filter((count) => count > 0);
  const n = counts.reduce((sum, count) => sum + count, 0);
  const shares = counts.map((count) => count / Math.max(1, n));
  const entropy = -shares.reduce((sum, share) => sum + (share > 0 ? share * Math.log(share) : 0), 0);
  return {
    hill_q0: counts.length,
    pielou: counts.length > 1 ? stable(entropy / Math.log(counts.length)) : 1,
    ...machineShare(specs),
  };
}

function dataValues(prepared: PreparedMap): number {
  return prepared.space.dimensions
    .filter((dimension, index) => dimension.kind === 'data' && !prepared.axes.has(index))
    .reduce((sum, dimension) => sum + dimension.values.filter((value) => value.id !== 'none').length, 0);
}

/** The summary the command prints. */
export function renderSummary(report: GenerateReport): string {
  const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
  const lines = [
    `Actual axis-map coverage (written complete specs): ${report.coverage.actual.map((entry) => `${entry.t === 2 ? 'pairs' : entry.t === 3 ? 'triples' : 'values'} ${entry.covered} of ${entry.allowed} (${percent(entry.share)})`).join('; ')}.`,
    report.budget
      ? `Candidate budget array (before the total cap), budget ${report.budget.budget}: ${report.budget.picked} cells of ${report.budget.pool} allowed, pairs covered ${report.budget.pairs.covered} of ${report.budget.pairs.allowed} (${percent(report.budget.pairs.share)}), max deviation from fair share ${report.budget.maxDeviation.toFixed(2)}.`
      : `Candidate t-wise array (before the total cap): covering array of ${report.twise.rows} rows over ${report.twise.dimensions.length} dimensions, ${report.twise.covered} of ${report.twise.allowed} allowed ${report.twise.t}-tuples (${percent(report.twise.share)}); ${report.twise.unreachable.length} pairs no path reaches are left out.`,
    `Uncovered on the axis map: ${report.coverage.actual.map((entry) => `${entry.uncovered.length} ${entry.t === 2 ? 'pairs' : entry.t === 3 ? 'triples' : 'values'}`).join(', ')} (see coverage.actual[].uncovered).`,
    `Map ${report.map.agent} (${report.map.path}), hash ${report.map.hash}: ${report.map.dimensions} dimensions, ${report.map.values} values, ${report.map.constraints} constraints, ${report.map.phrases} approved phrases.`,
    `Seed ${report.options.seed}, t = ${report.options.t}${report.options.max === null ? '' : `, at most ${report.options.max} specs per seeder`}.`,
    '',
    'Seeder        specs  blocks  complete  incomplete',
  ];
  for (const seeder of SEEDERS) {
    const entry = report.seeders[seeder];
    lines.push(
      `${seeder.padEnd(12)}  ${String(entry.specs).padStart(5)}  ${String(entry.blocks).padStart(6)}  ${String(entry.complete).padStart(8)}  ${String(entry.specs - entry.complete).padStart(10)}${entry.cut ? '  (cut by --max)' : ''}`,
    );
  }
  lines.push(
    '',
    `Stage graph: ${report.graph.covered} of ${report.graph.edges} edges covered in ${report.graph.paths} paths from ${report.graph.start ?? 'no start'}.${
      report.graph.unwalked
        ? ` Paths no cell can walk: ${report.graph.unwalked.map((entry) => entry.path).join(', ')}.`
        : ''
    }`,
    `Constraints applied: ${report.constraints.applied}.`,
    `Deviation probes: ${report.deviation.probes.length} of ${report.deviation.classes} classes. Metamorphic families: ${report.metamorphic.families}.`,
    `Coverage on the axis map at t = ${report.coverage.t}: complete specs ${report.coverage.complete.covered} of ${report.coverage.allowed} (${percent(report.coverage.complete.share)}), all specs ${report.coverage.all.covered} (${percent(report.coverage.all.share)})${report.coverage.baseline ? `, ${report.coverage.baseline.label} ${report.coverage.baseline.covered} (${percent(report.coverage.baseline.share)})` : ''}.`,
  );
  if (report.spec_cap)
    lines.push(
      `Spec cap ${report.spec_cap.limit}: ${report.spec_cap.written} of ${report.spec_cap.candidates} candidate specs written; ${report.spec_cap.protected} structural, fault and incomplete specs protected. ${report.spec_cap.preserved ? (report.spec_cap.mode === 'pairs' ? 'Every candidate pair retained; triple losses are listed in spec_cap.coverage.' : 'Every candidate pair and triple retained.') : 'Coverage lost: see spec_cap.coverage[].lost.'}`,
    );
  if (report.cover.unbuilt.length > 0)
    lines.push(
      `Allowed tuples no spec could be built for: ${report.cover.unbuilt.length} (see cover.unbuilt).`,
    );
  if (report.cover.unreachable.length > 0)
    lines.push(
      `Values no allowed pair holds, so no spec can cover them until the map gives them a path: ${report.cover.unreachable.map((entry) => `${entry.dimension}=${entry.value}`).join(', ')}.`,
    );
  const placeholders = report.no_phrase.filter((gap) => gap.blocks > 0);
  if (placeholders.length > 0) {
    lines.push(
      '',
      `Values with no approved phrase (${placeholders.length}): their blocks are placeholders in ${INCOMPLETE_DIR}/.`,
    );
    for (const gap of placeholders.slice(0, 15)) {
      lines.push(`  ${gap.dimension}=${gap.value}  ${gap.blocks} block(s)`);
    }
    if (placeholders.length > 15) lines.push(`  ... ${placeholders.length - 15} more in ${REPORT_FILE}`);
  }
  const unsaid = report.no_phrase.flatMap((gap) =>
    (gap.unsaid ?? []).map((entry) => ({ ...entry, value: `${gap.dimension}=${gap.value}` })),
  );
  if (unsaid.length > 0) {
    lines.push('', `Approved phrases no walk could say (${unsaid.length}), listed under no_phrase:`);
    for (const entry of unsaid.slice(0, 15))
      lines.push(`  ${entry.value}  "${entry.text}": ${entry.reasons[0] ?? 'no reason given'}`);
    if (unsaid.length > 15) lines.push(`  ... ${unsaid.length - 15} more in ${REPORT_FILE}`);
  }
  if (report.no_then.length > 0) {
    const named = report.no_then.slice(0, 10).map((entry) => entry.spec);
    const more = report.no_then.length > 10 ? ', ...' : '';
    lines.push(
      '',
      `Specs with a block the map supports no machine Then for (${report.no_then.length}), in ${INCOMPLETE_DIR}/: ${named.join(', ')}${more}.`,
    );
    const counts = new Map<string, number>();
    for (const entry of report.no_then) {
      for (const reason of new Set(entry.reasons.map((text) => text.replace(/^path [^:]+: /, '')))) {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    if (top.length > 0) lines.push('  Most frequent reasons:');
    for (const [reason, count] of top) lines.push(`  ${String(count).padStart(4)}  ${reason}`);
  }
  if (report.invalid.length > 0 || report.lint.length > 0) {
    lines.push(
      '',
      `Generator defects: ${report.invalid.length} invalid spec(s), ${report.lint.length} complete spec(s) with lint warnings.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

import { mde } from '@agent-nexus/driftbench-stats';
import type { AgentAdapter } from '../contracts/adapter';
import type { ArtifactReaderRegistry } from '../contracts/artifacts';
import type { CheckSet } from '../contracts/check';
import type { UserDriver } from '../contracts/driver';
import type { CostUnit, Store } from '../contracts/store';
import type { ToolRule } from '../contracts/tool-policy';
import { objectContextOfSpec } from '../objects/context';
import { checkSpecObjects, shippedObjectContext } from '../objects/index';
import type { ObjectContext } from '../objects/layers';
import type { BlockReuse } from '../radius/blocks';
import type { TargetRef } from '../schema/common';
import type { RunMode, RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import type { ObservedCache } from './cache';
import { cellId } from './cell';
import { replacesBlock } from './inject';
import { preflightTargetPrices, priceObserved, TokenPrices } from './pricing';
import type { RetryOptions } from './retry';
import { runSpec } from './run';
import { blocksOutcome } from './verdicts';

/** One run to make: one spec, on one target, in one mode, for one repeat (and one perturbation in P). */
export type PlannedCell = {
  cellId: string;
  specId: string;
  specHash: string;
  target: TargetRef;
  mode: RunMode;
  repeat: number;
  perturbationId?: string;
  /** Blocks the cell sends: the spec's blocks, plus the injected one in P mode unless it writes only a
   *  world, which runs under its own block. */
  blocks: number;
};

/** The cell a stored run belongs to: its run id is its cell id unless the caller chose another. */
export function cellIdOf(run: RunResult): string {
  return cellId(run);
}

export type CostLine = {
  adapter: string;
  blocks: number;
  /** The latest measured cost per block for this adapter, when one is stored. */
  usdPerBlock?: number;
  usd: number;
  note?: 'no unit measured';
};

/**
 * The minimum detectable effect of a comparison between two arms (a baseline target and a candidate),
 * as `mde` of @agent-nexus/driftbench-stats solves it: the specs are the independent units, the repeats of one spec
 * count through the design effect 1 + (repeats - 1) rho, and the two arms are independent samples.
 */
export type MinimumDetectableEffect = {
  mode: RunMode;
  runsPerArm: number;
  /** The specs per arm: the independent units. */
  specs: number;
  baselineRate: number;
  /** The intraclass correlation of repeats of one spec the plan assumes. */
  rho: number;
  /** 1 + (repeats - 1) rho, for the mean repeats per spec. */
  designEffect: number;
  alpha: 0.05;
  power: 0.8;
  /** The smallest drop in pass rate the design detects, as a proportion; undefined when it has no runs or no drop below the baseline is detectable. */
  effect?: number;
};

export type CampaignPlan = {
  cells: PlannedCell[];
  /** Blocks sent over every cell. */
  blocks: number;
  /** As `projectCost` of @agent-nexus/driftbench-store computes it, with a line per adapter. */
  cost: { usd: number; unmeasured: string[]; byAdapter: CostLine[] };
  budgetUsd?: number;
  /** True when the projected cost fits the budget; absent without a budget. */
  withinBudget?: boolean;
  mde: MinimumDetectableEffect[];
};

export type PlanOptions = {
  /** Measured unit costs; the `block` metric of a target's adapter prices its cells. */
  units?: readonly CostUnit[];
  budgetUsd?: number;
  /** The baseline pass rate the MDE assumes. Default 0.5, where the variance is largest. */
  baselineRate?: number;
  /** The intraclass correlation of repeats of one spec, as `icc` measures it, in [0, 1]. Default 0: repeats count as independent. */
  rho?: number;
};

/**
 * z(0.975) and z(0.8), the standard normal quantiles for a two-sided alpha of 0.05 and a power of 0.8,
 * as Python's statistics.NormalDist().inv_cdf gives them.
 */
const Z_ALPHA = 1.9599639845400534;
const Z_POWER = 0.8416212335729144;

/**
 * The effect of the two-proportion normal approximation with every run counted as independent. The plan no
 * longer uses it: `planCampaign` prints `mde` of @agent-nexus/driftbench-stats, which counts specs as the units.
 */
export function minimumDetectableEffect(runsPerArm: number, baselineRate = 0.5): number | undefined {
  if (runsPerArm <= 0) return undefined;
  return (Z_ALPHA + Z_POWER) * Math.sqrt((2 * baselineRate * (1 - baselineRate)) / runsPerArm);
}

/**
 * The MDE line of one mode: `specs` independent specs sharing `runsPerArm` runs, so `runsPerArm / specs`
 * repeats each, through `mde` of @agent-nexus/driftbench-stats. Throws a RangeError naming rho outside [0, 1].
 */
export function mdeLine(
  mode: RunMode,
  specs: number,
  runsPerArm: number,
  baselineRate: number,
  rho = 0,
): MinimumDetectableEffect {
  if (!(rho >= 0 && rho <= 1)) throw new RangeError(`rho must lie in [0, 1], got ${rho}`);
  const line = { mode, runsPerArm, specs, baselineRate, rho, alpha: 0.05 as const, power: 0.8 as const };
  if (specs <= 0 || runsPerArm <= 0) return { ...line, designEffect: 1 };
  // Fewer runs than specs (a mode that gives some specs no cell): each run is then its own unit.
  const perSpec = runsPerArm / specs;
  const result =
    perSpec >= 1
      ? mde({ n: specs, repeats: perSpec, baselineRate, rho })
      : mde({ n: runsPerArm, baselineRate, rho });
  return {
    ...line,
    designEffect: result.designEffect,
    ...(result.effect === null ? {} : { effect: result.effect }),
  };
}

/**
 * Expands specs x targets x modes x repeats into cells (P mode: one cell per perturbation and repeat),
 * projects the cost from measured units, and prints the minimum detectable effect of each mode.
 */
export function planCampaign(
  specs: ReadonlyArray<{ spec: Spec; hash: string }>,
  targets: readonly TargetRef[],
  modes: readonly RunMode[],
  repeats: number | Partial<Record<RunMode, number>>,
  options: PlanOptions = {},
): CampaignPlan {
  const repeatsOf = (mode: RunMode) => (typeof repeats === 'number' ? repeats : (repeats[mode] ?? 0));
  const cells: PlannedCell[] = [];
  for (const { spec, hash } of specs) {
    for (const target of targets) {
      for (const mode of modes) {
        const perturbations = mode === 'P' ? (spec.perturbations ?? []) : [undefined];
        for (const perturbation of perturbations) {
          const perturbationId = perturbation?.id;
          const extra = perturbation === undefined || replacesBlock(perturbation) ? 0 : 1;
          for (let repeat = 0; repeat < repeatsOf(mode); repeat++) {
            const key = { specHash: hash, target, mode, repeat, perturbationId };
            cells.push({
              cellId: cellId(key),
              specId: spec.id,
              ...key,
              ...(perturbationId === undefined ? {} : { perturbationId }),
              blocks: spec.blocks.length + extra,
            });
          }
        }
      }
    }
  }

  const byAdapter = new Map<string, CostLine>();
  for (const cell of cells) {
    const adapter = cell.target.adapter;
    let line = byAdapter.get(adapter);
    if (!line) {
      const unit = latestUnit(options.units ?? [], adapter, 'block');
      line = unit
        ? { adapter, blocks: 0, usdPerBlock: unit.usd, usd: 0 }
        : { adapter, blocks: 0, usd: 0, note: 'no unit measured' };
      byAdapter.set(adapter, line);
    }
    line.blocks += cell.blocks;
    line.usd = line.blocks * (line.usdPerBlock ?? 0);
  }
  const lines = [...byAdapter.values()];
  const usd = lines.reduce((sum, line) => sum + line.usd, 0);
  const unmeasured = lines
    .filter((line) => line.usdPerBlock === undefined)
    .map((line) => line.adapter)
    .sort();

  const baselineRate = options.baselineRate ?? 0.5;
  const rho = options.rho ?? 0;
  const firstTarget = targets[0];
  const mde = modes.map((mode): MinimumDetectableEffect => {
    const runsPerArm = cells.filter((cell) => cell.mode === mode && cell.target === firstTarget).length;
    return mdeLine(mode, specs.length, runsPerArm, baselineRate, rho);
  });

  return {
    cells,
    blocks: cells.reduce((sum, cell) => sum + cell.blocks, 0),
    cost: { usd, unmeasured, byAdapter: lines },
    ...(options.budgetUsd === undefined
      ? {}
      : { budgetUsd: options.budgetUsd, withinBudget: usd <= options.budgetUsd }),
    mde,
  };
}

/** The most recently measured unit of an adapter and metric; dates compare as dates, anything else as text. */
function latestUnit(units: readonly CostUnit[], adapter: string, metric: string): CostUnit | undefined {
  let latest: CostUnit | undefined;
  for (const unit of units) {
    if (unit.adapter !== adapter || unit.metric !== metric) continue;
    if (!latest || isLater(unit.measuredAt, latest.measuredAt)) latest = unit;
  }
  return latest;
}

function isLater(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isNaN(left) || Number.isNaN(right) ? a > b : left > right;
}

/** A cell after the campaign ran it, or found it already done. */
export type CellOutcome = {
  cell: PlannedCell;
  /** The run behind the outcome; absent while the cell is pending. */
  run?: RunResult;
  /** True when a completed run of this cell was already in the store. */
  reused: boolean;
  /**
   * `not_run` and `blocked`: the run completed with no failure, but a block was not run (or was blocked), so
   * the cell is neither a pass nor a fail.
   */
  state: 'pass' | 'fail' | 'not_run' | 'blocked' | 'failed' | 'stopped' | 'pending';
  /**
   * Gating verdicts that did not pass, as `block <index> <verdict id>`, end-state fields that differ, and
   * blocks not run or blocked, as `block <index> not_run <check>` and `block <index> blocked by <ancestor>`.
   */
  failing: string[];
  /** Set when the budget stopped the cell before it started: the budget, and what the campaign had spent. */
  budgetStop?: { budgetUsd: number; spentUsd: number };
  /** Set when `earlyStop` stopped the cell: repeats 0 and 1 of its spec had both failed a gating machine check. */
  earlyStop?: { after: number };
};

/**
 * The outcome of a cell from its run: pass when the run completed, every block passed and the end state
 * matched; not_run or blocked when nothing failed but a block was not run or blocked (`blocksOutcome`).
 */
export function outcomeOf(cell: PlannedCell, run: RunResult | undefined, reused = false): CellOutcome {
  if (!run) return { cell, reused, state: 'pending', failing: [] };
  const failing = [
    ...run.blocks.flatMap((block) =>
      block.verdicts
        .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
        .map((verdict) => `block ${block.index} ${verdict.id}`),
    ),
    ...(run.endState && !run.endState.match
      ? run.endState.diff.map((entry) => `end_state ${entry.field}`)
      : []),
    ...run.blocks.flatMap((block) =>
      block.notRun
        ? [`block ${block.index} not_run ${block.notRun.check}`]
        : block.blocked
          ? [`block ${block.index} blocked by ${block.blocked.by}`]
          : [],
    ),
  ];
  if (run.status !== 'completed') return { cell, run, reused, state: run.status, failing };
  // The end verdict is left to the readers of the run, as before: only a block not run or blocked moves the state.
  const outcome = blocksOutcome(run);
  if (outcome === 'pass') return { cell, run, reused, state: 'pass', failing };
  return {
    cell,
    run,
    reused,
    state: outcome === 'not_run' || outcome === 'blocked' ? outcome : 'fail',
    failing,
  };
}

/** The run that stands for each cell of a campaign: its latest completed run, else its latest run. */
export async function runsByCell(store: Store, campaignId: string): Promise<Map<string, RunResult>> {
  return byCell(await store.listRuns({ campaignId }));
}

function byCell(runs: readonly RunResult[]): Map<string, RunResult> {
  const byCell = new Map<string, RunResult>();
  const rank = (run: RunResult) => (run.status === 'completed' ? 1 : 0);
  for (const run of runs) {
    const id = cellIdOf(run);
    const held = byCell.get(id);
    if (!held || rank(run) > rank(held) || (rank(run) === rank(held) && run.finishedAt >= held.finishedAt)) {
      byCell.set(id, run);
    }
  }
  return byCell;
}

export type CampaignRunOptions = {
  /** Dated USD prices for adapters that report tokens without dollar cost. */
  prices?: TokenPrices;
  campaignId: string;
  cells: readonly PlannedCell[];
  /** The spec of a cell, by id and hash. */
  specFor(cell: PlannedCell): Spec;
  /** The objects a cell's blocks resolve their `uses` against; the shipped objects only when absent. */
  objectsFor?(cell: PlannedCell): ObjectContext;
  adapterFor(target: TargetRef): AgentAdapter;
  /** A fresh driver for each run, given the cell and the spec the cell runs (a perturbing driver needs it). */
  driver(cell: PlannedCell, spec: Spec): UserDriver;
  checks: CheckSet;
  /** Readers for the artifact checks, passed to every run. */
  artifacts?: ArtifactReaderRegistry;
  store: Store;
  cache?: ObservedCache;
  /** The cache suite every run of the campaign belongs to. A new name starts from an empty cache. */
  cacheSuite?: string;
  /** The agent version included in every block cache key of this campaign. */
  agentVersion?: string;
  /** Each run keeps its events on its record, for the viewer's timeline. */
  recordEvents?: boolean;
  recordProvenance?: boolean;
  /** Opt in: store the raw end-state values each T block reads. They may hold sensitive data. */
  recordEndStateSnapshots?: boolean;
  /** Opt in: keep the text a driver sent where it differs from the spec, not only its hash. */
  recordRealizedText?: boolean;
  /** Mode T: the stored baseline run to rerun only the radius blocks from; a refused plan reruns the whole cell. */
  blockReuse?(cell: PlannedCell): BlockReuse | undefined;
  retry?: RetryOptions;
  /** A run-wide tool policy, passed to every run: each denied call is marked before the checks read it. */
  toolPolicy?: readonly ToolRule[];
  now?: () => Date;
  /** Cells that run at the same time. Default 4. */
  concurrency?: number;
  /**
   * A hard stop on spend, in US dollars, over the whole campaign: the runs already in the store count, runs
   * replayed from the cache do not. Once it is reached no new cell starts; the cells in flight finish.
   */
  budgetUsd?: number;
  /**
   * Stop a spec early. Once repeats 0 and 1 of a spec in mode F (same target) both fail a gating machine check,
   * its later F repeats are not run: they come back with state `stopped` and `earlyStop { after: 2 }`, and no
   * run is stored for them. A spec that passes repeat 0 or 1 runs every repeat. Repeat 2 and later wait for
   * repeats 0 and 1 to finish, so the spec's first two repeats run free of the stop.
   */
  earlyStop?: boolean;
  /** Called once per cell in cell order, as soon as the cell and every cell before it have an outcome. */
  onCell?(outcome: CellOutcome): void;
  /** Mode P: more tools whose call is a consequential act, for the recovery metrics. */
  consequential?: (label: string) => boolean;
};

/**
 * Runs the cells of a campaign on a pool of workers and files every run in the store as it finishes. A cell
 * whose completed run is already in the store is reused, not run again: that is how `resume` works. Failed
 * and stopped cells run again. Outcomes come back, and `onCell` hears them, in cell order. With a budget, a
 * cell that would start once the campaign's spend has reached it is stopped instead and never starts.
 *
 * Perturbed cells start after every other cell: each takes as the reference of its recovery the F run of
 * the same spec, target and repeat (else repeat 0) in this campaign, run now or stored, waiting for it when
 * it is still in flight. A campaign without that F cell gives P runs no reference.
 */
export async function runCampaign(options: CampaignRunOptions): Promise<CellOutcome[]> {
  // Validate before even a completed cell can be reused. A stored spec may outlive its object files.
  const objectContexts = new Map<string, ObjectContext>();
  for (const cell of options.cells) {
    const spec = options.specFor(cell);
    const context = options.objectsFor?.(cell) ?? objectContextOfSpec(spec) ?? shippedObjectContext();
    objectContexts.set(cell.cellId, context);
    const issues = checkSpecObjects(spec, context);
    if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('; '));
  }
  const stored = await options.store.listRuns({ campaignId: options.campaignId });
  const done = byCell(stored);
  const { cells, budgetUsd } = options;
  const prices = options.prices === undefined ? undefined : TokenPrices.parse(options.prices);
  if (budgetUsd !== undefined)
    preflightTargetPrices(
      cells.map((cell) => cell.target),
      prices,
    );
  // A carried run was paid for by the campaign that ran it: it spends nothing of this budget.
  let spentUsd = stored
    .filter((run) => !run.cacheHit && run.carried === undefined)
    .reduce(
      (sum, run) =>
        sum +
        (budgetUsd === undefined
          ? run.cost
          : Math.max(
              run.cost,
              run.blocks.reduce((total, block) => {
                // Old unpriced records can have cost=0 despite token usage. Reprice their raw observations before resuming.
                const observed = priceObserved(block.observed, run.target, prices, true);
                return (
                  total +
                  (observed.cost.usd ??
                    observed.segments.reduce((usd, segment) => usd + (segment.cost?.usd ?? 0), 0))
                );
              }, 0),
            )),
      0,
    );
  const outcomes: Array<CellOutcome | undefined> = cells.map(() => undefined);
  let next = 0;
  let heard = 0;
  let failure: { cause: unknown } | undefined;
  // P cells last, so the F run each takes as its reference has started before it.
  const order = [
    ...cells.flatMap((cell, index) => (cell.mode === 'P' ? [] : [index])),
    ...cells.flatMap((cell, index) => (cell.mode === 'P' ? [index] : [])),
  ];
  const fRuns = new Map<string, { promise: Promise<RunResult | undefined>; settle(run?: RunResult): void }>();
  for (const cell of cells) {
    if (cell.mode !== 'F') continue;
    let settle: (run?: RunResult) => void = () => {};
    const promise = new Promise<RunResult | undefined>((resolve) => {
      settle = resolve;
    });
    fRuns.set(cell.cellId, { promise, settle });
  }
  const referenceFor = async (cell: PlannedCell): Promise<RunResult | undefined> => {
    for (const repeat of [...new Set([cell.repeat, 0])]) {
      const id = cellId({ specHash: cell.specHash, target: cell.target, mode: 'F', repeat });
      const planned = fRuns.get(id);
      const run = planned ? await planned.promise : done.get(id);
      if (run) return run;
    }
    return undefined;
  };

  // Early stop: the outcome of every cell, awaitable, so repeat 2 and later can read repeats 0 and 1.
  const settled = new Map<
    string,
    { promise: Promise<CellOutcome | undefined>; settle(o?: CellOutcome): void }
  >();
  if (options.earlyStop) {
    for (const cell of cells) {
      let settle: (o?: CellOutcome) => void = () => {};
      const promise = new Promise<CellOutcome | undefined>((resolve) => {
        settle = resolve;
      });
      settled.set(cell.cellId, { promise, settle });
    }
  }
  const earlyStopped = async (cell: PlannedCell): Promise<boolean> => {
    if (!options.earlyStop || cell.mode !== 'F' || cell.repeat < 2 || cell.perturbationId !== undefined) {
      return false;
    }
    const firstTwo = [0, 1].map((repeat) =>
      settled.get(cellId({ specHash: cell.specHash, target: cell.target, mode: 'F', repeat })),
    );
    if (firstTwo.some((entry) => entry === undefined)) return false;
    const outcomes = await Promise.all(firstTwo.map((entry) => entry?.promise));
    return outcomes.every(
      (o) => o?.state === 'fail' && o.failing.some((entry) => entry.startsWith('block ')),
    );
  };

  const start = async (cell: PlannedCell): Promise<CellOutcome> => {
    const previous = done.get(cell.cellId);
    if (previous?.status === 'completed') return outcomeOf(cell, previous, true);
    if (await earlyStopped(cell)) {
      return { cell, reused: false, state: 'stopped', failing: [], earlyStop: { after: 2 } };
    }
    if (budgetUsd !== undefined && spentUsd >= budgetUsd) {
      return { cell, reused: false, state: 'stopped', failing: [], budgetStop: { budgetUsd, spentUsd } };
    }
    const reference = cell.mode === 'P' ? await referenceFor(cell) : undefined;
    const spec = options.specFor(cell);
    const blockReuse = options.blockReuse?.(cell);
    const run = await runSpec(spec, {
      ...(prices ? { prices } : {}),
      requireTokenPrices: budgetUsd !== undefined,
      adapter: options.adapterFor(cell.target),
      driver: options.driver(cell, spec),
      checks: options.checks,
      objects: objectContexts.get(cell.cellId),
      ...(options.artifacts ? { artifacts: options.artifacts } : {}),
      mode: cell.mode,
      repeat: cell.repeat,
      target: cell.target,
      ...(cell.perturbationId === undefined ? {} : { perturbationId: cell.perturbationId }),
      store: options.store,
      recordProvenance: options.recordProvenance,
      ...(options.recordEndStateSnapshots ? { recordEndStateSnapshots: true } : {}),
      ...(options.recordRealizedText ? { recordRealizedText: true } : {}),
      ...(blockReuse ? { blockReuse } : {}),
      campaignId: options.campaignId,
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.cacheSuite === undefined ? {} : { suite: options.cacheSuite }),
      ...(options.agentVersion === undefined ? {} : { agentVersion: options.agentVersion }),
      ...(options.recordEvents ? { recordEvents: true } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.toolPolicy?.length ? { toolPolicy: options.toolPolicy } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(reference ? { reference } : {}),
      ...(options.consequential ? { consequential: options.consequential } : {}),
    });
    if (!run.cacheHit) spentUsd += run.cost;
    return outcomeOf(cell, run);
  };

  const hear = () => {
    for (let outcome = outcomes[heard]; outcome; outcome = outcomes[heard]) {
      options.onCell?.(outcome);
      heard += 1;
    }
  };

  const worker = async () => {
    while (!failure && next < order.length) {
      const index = order[next] as number;
      next += 1;
      const cell = cells[index];
      if (!cell) return;
      try {
        outcomes[index] = await start(cell);
      } catch (cause) {
        failure ??= { cause };
        return;
      } finally {
        fRuns.get(cell.cellId)?.settle(outcomes[index]?.run);
        settled.get(cell.cellId)?.settle(outcomes[index]);
      }
      hear();
    }
  };

  const workers = Math.max(1, Math.min(Math.floor(options.concurrency ?? 4), cells.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  for (const planned of fRuns.values()) planned.settle();
  for (const entry of settled.values()) entry.settle();
  if (failure) throw failure.cause;
  return outcomes.filter((outcome): outcome is CellOutcome => outcome !== undefined);
}

import {
  agentVersionOf,
  type BlockResult,
  blockStatus,
  type Campaign,
  canonicalJson,
  isScored,
  type LoadedSpec,
  RunMode,
  type RunResult,
  runOutcome,
  runsByCell,
  type Spec,
  type Store,
  specBlocks,
  type TargetRef,
} from '@agent-nexus/driftbench-core';

/** A report input that cannot be read: a missing campaign, a missing spec. The CLI exits 2 on it. */
export class ReportInputError extends Error {
  override readonly name = 'ReportInputError';
}

/** A stored campaign, its pinned specs and the run that stands for each cell, in a fixed order. */
export type CampaignData = {
  campaign: Campaign;
  /** The pinned specs by `id@hash`. */
  specs: ReadonlyMap<string, LoadedSpec>;
  /**
   * The latest completed run of each cell (else its latest run), sorted by the campaign's spec order,
   * then target, mode (T, F, P), perturbation (in the spec's order) and repeat.
   */
  runs: readonly RunResult[];
};

/**
 * Reads a campaign from a store: the campaign record, every spec it pins, and the runs that stand for its
 * cells. Without an id, the latest campaign of the store. Throws ReportInputError when the campaign or one
 * of its specs is missing.
 */
export async function loadCampaign(store: Store, campaignId?: string): Promise<CampaignData> {
  let campaign: Campaign | undefined;
  if (campaignId === undefined) {
    [campaign] = await store.listCampaigns();
    if (!campaign) throw new ReportInputError('The store holds no campaign.');
  } else {
    campaign = await store.getCampaign(campaignId);
    if (!campaign) throw new ReportInputError(`No campaign ${campaignId} in the store.`);
  }
  const specs = new Map<string, LoadedSpec>();
  for (const pinned of campaign.specs) {
    const spec = await store.getSpec(pinned.id, pinned.hash);
    if (!spec) {
      throw new ReportInputError(
        `The store has no spec ${pinned.id} at hash ${pinned.hash}, which campaign ${campaign.campaignId} pins.`,
      );
    }
    specs.set(specKey(pinned.id, pinned.hash), spec);
  }
  const byCell = await runsByCell(store, campaign.campaignId);
  return { campaign, specs, runs: sortRuns([...byCell.values()], campaign, specs) };
}

export function specKey(id: string, hash: string): string {
  return `${id}@${hash}`;
}

/** The spec a run ran, when the campaign data holds it. */
export function specOfRun(data: CampaignData, run: RunResult): Spec | undefined {
  return data.specs.get(specKey(run.specId, run.specHash))?.spec;
}

const MODE_ORDER = RunMode.options;

function sortRuns(
  runs: RunResult[],
  campaign: Campaign,
  specs: ReadonlyMap<string, LoadedSpec>,
): RunResult[] {
  const specOrder = new Map(campaign.specs.map((entry, index) => [specKey(entry.id, entry.hash), index]));
  const perturbationOrder = (run: RunResult): number => {
    if (run.perturbationId === undefined) return -1;
    const list = specs.get(specKey(run.specId, run.specHash))?.spec.perturbations ?? [];
    const index = list.findIndex((entry) => entry.id === run.perturbationId);
    return index < 0 ? list.length : index;
  };
  return runs.sort(
    (a, b) =>
      (specOrder.get(specKey(a.specId, a.specHash)) ?? Number.MAX_SAFE_INTEGER) -
        (specOrder.get(specKey(b.specId, b.specHash)) ?? Number.MAX_SAFE_INTEGER) ||
      a.specId.localeCompare(b.specId) ||
      canonicalJson(a.target).localeCompare(canonicalJson(b.target)) ||
      MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) ||
      perturbationOrder(a) - perturbationOrder(b) ||
      (a.perturbationId ?? '').localeCompare(b.perturbationId ?? '') ||
      a.repeat - b.repeat,
  );
}

/** A run passes when it completed, ran a block, every block passed and the end state matched (the runner's rule). */
export function runPassed(run: RunResult): boolean {
  return runOutcome(run) === 'pass';
}

/**
 * The recovery record of a run, when it measured one: a run whose injected block was not run or blocked sent the
 * agent nothing, so a recovery stored on it is no measurement. Every reader of a recovery goes through this.
 */
export function measuredRecovery(run: RunResult): RunResult['recovery'] {
  return run.blocks.every((block) => !block.injected || isScored(block)) ? run.recovery : undefined;
}

/**
 * The runs a pass rate counts: those that passed or failed. A run with a block not run or blocked, and no
 * failure, is neither: it is left out of every rate, and its count is printed beside the rate.
 */
export function scoredRuns(runs: readonly RunResult[]): RunResult[] {
  return runs.filter((run) => {
    const outcome = runOutcome(run);
    return outcome === 'pass' || outcome === 'fail';
  });
}

/** What a campaign merges: its fresh runs, and the runs it carried from earlier campaigns. */
export type CarriedSummary = {
  fresh: number;
  carried: number;
  /** Re-scored blocks, grouped by the campaign whose observations were re-scored. */
  rescored?: Array<{ campaign: string; blocks: number }>;
  /** Display-only subset of carried: runs with freshly re-scored blocks. Pair eligibility is unchanged. */
  rescoredRuns?: number;
  /** The agent versions the campaign itself runs, read from its targets. */
  versions: string[];
  /** One entry per campaign and agent version the carried runs come from, most runs first. */
  sources: Array<{
    campaign: string;
    /** The agent version that produced the results, when the fresh runs named one. */
    agentVersion?: string;
    runs: number;
    /** Display-only subset of this source: runs with freshly re-scored blocks. */
    rescoredRuns?: number;
    /** The oldest result of the group: campaigns it was carried through, and days since its fresh run. */
    maxCampaigns: number;
    maxDays: number;
  }>;
};

/** The fresh and carried runs of a campaign, or undefined when every run is fresh. */
export function carriedSummary(runs: readonly RunResult[]): CarriedSummary | undefined {
  const carried = runs.filter((run) => run.carried !== undefined);
  if (carried.length === 0) return undefined;
  const rescored = new Map<string, number>();
  for (const run of runs) {
    for (const block of run.blocks) {
      const stamp = block.rejudged;
      if (stamp?.criteria.length === 0)
        rescored.set(stamp.fromCampaign, (rescored.get(stamp.fromCampaign) ?? 0) + 1);
    }
  }
  let rescoredRuns = 0;
  const sources = new Map<string, CarriedSummary['sources'][number]>();
  for (const run of carried) {
    const from = run.carried as NonNullable<RunResult['carried']>;
    const key = `${from.fromCampaign}\u0000${from.agentVersion ?? ''}`;
    const held = sources.get(key) ?? {
      campaign: from.fromCampaign,
      ...(from.agentVersion === undefined ? {} : { agentVersion: from.agentVersion }),
      runs: 0,
      maxCampaigns: 0,
      maxDays: 0,
    };
    held.runs += 1;
    if (
      run.rejudged?.criteria.length === 0 ||
      run.blocks.some((block) => block.rejudged?.criteria.length === 0)
    ) {
      held.rescoredRuns = (held.rescoredRuns ?? 0) + 1;
      rescoredRuns += 1;
    }
    held.maxCampaigns = Math.max(held.maxCampaigns, from.age.campaigns);
    held.maxDays = Math.max(held.maxDays, from.age.days);
    sources.set(key, held);
  }
  const versions = new Set<string>();
  for (const run of runs) {
    const version = agentVersionOf(run);
    if (version !== undefined) versions.add(version);
  }
  return {
    fresh: runs.length - carried.length,
    carried: carried.length,
    ...(rescoredRuns ? { rescoredRuns } : {}),
    ...(rescored.size
      ? {
          rescored: [...rescored]
            .map(([campaign, blocks]) => ({ campaign, blocks }))
            .sort((a, b) => a.campaign.localeCompare(b.campaign)),
        }
      : {}),
    versions: [...versions],
    sources: [...sources.values()].sort((a, b) => b.runs - a.runs || a.campaign.localeCompare(b.campaign)),
  };
}

/** The share of a run's scored blocks that pass; 0 for a run with no scored block. */
export function blockScore(run: RunResult): number {
  const scored = run.blocks.filter(isScored);
  if (scored.length === 0) return 0;
  return scored.filter((block) => blockStatus(block) === 'pass').length / scored.length;
}

/** `adapter:agent`, with the variant and the deployment when the target names them. */
export function showTarget(target: TargetRef): string {
  const base = target.agent === undefined ? target.adapter : `${target.adapter}:${target.agent}`;
  const extras = [
    ...(target.variant === undefined ? [] : [`variant ${target.variant}`]),
    ...(target.deployment === undefined ? [] : [`deployment ${target.deployment}`]),
  ];
  return extras.length === 0 ? base : `${base} (${extras.join(', ')})`;
}

/**
 * One reliability line: the runs of one spec on one target in one mode, with one perturbation in P. The
 * repeats of a line are the runs pass^k and pass@k read.
 */
export function lineKey(run: RunResult): string {
  return [run.specId, run.specHash, canonicalJson(run.target), run.mode, run.perturbationId ?? ''].join(
    '\u0000',
  );
}

/** Groups runs by a key, keeping the first-seen order of the keys and the order of the runs. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** The deviation class of a run's perturbation, from its spec. */
export function deviationOf(spec: Spec | undefined, run: RunResult): string | undefined {
  if (run.perturbationId === undefined) return undefined;
  return spec?.perturbations?.find((entry) => entry.id === run.perturbationId)?.class;
}

/** What reached the agent in a spec block, as text. */
export function stimulusText(spec: Spec | undefined, index: number): string | undefined {
  const block = spec?.blocks[index];
  if (!block) return undefined;
  const when = block.when;
  if ('user' in when) return when.user;
  if ('burst' in when) return when.burst.join('\n');
  return `[${when.injection.class}] ${when.injection.user}`;
}

/** Each block of a run with the spec block it stands for (undefined for a block a driver injected). */
export function blocksWithSpec(
  run: RunResult,
  spec: Spec | undefined,
): Array<{ result: BlockResult; specBlock?: number }> {
  const mapped = new Map<BlockResult, number>();
  for (const { block, result } of specBlocks(run, spec)) mapped.set(result, block);
  return run.blocks.map((result) => {
    const specBlock = mapped.get(result);
    return specBlock === undefined ? { result } : { result, specBlock };
  });
}

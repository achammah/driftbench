import type { BlockResult, RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import { canonicalJson } from '../spec/hash';
import { replacesBlock } from './inject';
import { blockStatus, isScored } from './verdicts';

/** A point estimate with its two-sided interval, the shape `@agent-nexus/driftbench-stats` returns. */
export type IntervalEstimate = { estimate: number; lower: number; upper: number };

/**
 * Computes an interval on the mean of `values`, resampling by `clusters` (one key per value). The core
 * imports no statistics; the caller passes one, such as `bootstrapCI` of `@agent-nexus/driftbench-stats`:
 * `(values, clusters) => bootstrapCI(values, { clusters })`.
 */
export type IntervalFn = (values: readonly number[], clusters: readonly string[]) => IntervalEstimate;

/** One spec block in the compounding index: its pass rate over the T runs and over the F runs. */
export type CompoundingBlock = { block: number; passT: number; passF: number; runsT: number; runsF: number };

export type CompoundingLine = {
  specId: string;
  specHash: string;
  /** The target, as canonical JSON. */
  target: string;
  runsT: number;
  runsF: number;
  /** The spec blocks both modes ran, by their index in the spec. */
  blocks: CompoundingBlock[];
  /** The mean over the shared blocks of the T pass rate, of the F pass rate, and their difference. */
  passT: number;
  passF: number;
  index: number;
  /** Resampling the blocks: each block is its own cluster. Absent without an interval function. */
  interval?: IntervalEstimate;
};

export type CompoundingIndex = {
  specs: CompoundingLine[];
  /** Over every shared block of every spec; one spec (and target) is one cluster, so the interval needs two
   *  specs at least. Absent with no shared block. */
  overall?: { blocks: number; passT: number; passF: number; index: number; interval?: IntervalEstimate };
};

/**
 * The compounding index of each spec and target: the pass rate of its blocks in teacher-forced runs minus
 * the pass rate of the same blocks in free-running runs. A block's pass rate in a mode is the share of the
 * mode's runs, among those that reached the block, where it passed; the index is the mean over the spec
 * blocks both modes reached of the per-block difference, which equals the T rate minus the F rate over
 * those blocks. Positive: the agent is right block by block and loses it across the succession.
 *
 * Runs of other modes are ignored, and so are blocks a driver injected. With `interval`, each spec gets
 * an interval on its index with the block as the resampling unit, and the overall index one with the spec
 * as the unit (one conversation is one cluster).
 */
export function compoundingIndex(
  runs: readonly RunResult[],
  options: { interval?: IntervalFn } = {},
): CompoundingIndex {
  const groups = new Map<
    string,
    { specId: string; specHash: string; target: string; t: RunResult[]; f: RunResult[] }
  >();
  for (const run of runs) {
    if (run.mode !== 'T' && run.mode !== 'F') continue;
    const target = canonicalJson(run.target);
    const key = `${run.specId}\u0000${run.specHash}\u0000${target}`;
    let group = groups.get(key);
    if (!group) {
      group = { specId: run.specId, specHash: run.specHash, target, t: [], f: [] };
      groups.set(key, group);
    }
    (run.mode === 'T' ? group.t : group.f).push(run);
  }

  const specs: CompoundingLine[] = [];
  const allValues: number[] = [];
  const allClusters: string[] = [];
  for (const group of groups.values()) {
    if (group.t.length === 0 || group.f.length === 0) continue;
    const rateT = blockRates(group.t);
    const rateF = blockRates(group.f);
    const shared = [...rateT.keys()].filter((block) => rateF.has(block)).sort((a, b) => a - b);
    if (shared.length === 0) continue;
    const blocks = shared.map((block): CompoundingBlock => {
      const t = rateT.get(block) as Rate;
      const f = rateF.get(block) as Rate;
      return { block, passT: t.pass / t.runs, passF: f.pass / f.runs, runsT: t.runs, runsF: f.runs };
    });
    const diffs = blocks.map((block) => block.passT - block.passF);
    const passT = mean(blocks.map((block) => block.passT));
    const passF = mean(blocks.map((block) => block.passF));
    const line: CompoundingLine = {
      specId: group.specId,
      specHash: group.specHash,
      target: group.target,
      runsT: group.t.length,
      runsF: group.f.length,
      blocks,
      passT,
      passF,
      index: passT - passF,
    };
    if (options.interval) {
      line.interval = options.interval(
        diffs,
        blocks.map((block) => String(block.block)),
      );
    }
    specs.push(line);
    allValues.push(...diffs);
    allClusters.push(...diffs.map(() => `${group.specId}\u0000${group.specHash}`));
  }

  if (allValues.length === 0) return { specs };
  const blocks = specs.flatMap((line) => line.blocks);
  const passT = mean(blocks.map((block) => block.passT));
  const passF = mean(blocks.map((block) => block.passF));
  return {
    specs,
    overall: {
      blocks: blocks.length,
      passT,
      passF,
      index: passT - passF,
      // One spec is one cluster, whatever its targets: resampling one cluster always draws the same blocks,
      // so no interval is given.
      ...(options.interval && new Set(allClusters).size > 1
        ? { interval: options.interval(allValues, allClusters) }
        : {}),
    },
  };
}

type Rate = { pass: number; runs: number };

/** Pass counts per spec block over runs: a run counts for a block when it reached it. */
function blockRates(runs: readonly RunResult[]): Map<number, Rate> {
  const rates = new Map<number, Rate>();
  for (const run of runs) {
    for (const { block, result } of specBlocks(run)) {
      // A carried result is no new measurement, and a block not run or blocked is none at all.
      if (result.carried || run.carried || !isScored(result)) continue;
      const rate = rates.get(block) ?? { pass: 0, runs: 0 };
      rate.runs += 1;
      if (blockStatus(result) === 'pass') rate.pass += 1;
      rates.set(block, rate);
    }
  }
  return rates;
}

/**
 * The blocks of a run that stand for spec blocks, with their index in the spec. A block a driver injected
 * (its id is the run's perturbation) stands for none, unless the spec is given and the perturbation writes
 * no message: then it carried its block's own stimulus under a changed world, and stands for that block.
 * A spec block whose stimulus is an injection stands for itself.
 */
export function specBlocks(run: RunResult, spec?: Spec): Array<{ block: number; result: BlockResult }> {
  if (run.blocks.some((result) => result.specIndex !== undefined))
    return run.blocks
      .filter((result) => result.specIndex !== undefined)
      .map((result) => ({ block: result.specIndex as number, result }));
  if (run.blockRerun) return run.blocks.map((result) => ({ block: result.index, result }));
  const perturbation = spec?.perturbations?.find((entry) => entry.id === run.perturbationId);
  const replaces = perturbation !== undefined && replacesBlock(perturbation);
  const out: Array<{ block: number; result: BlockResult }> = [];
  let next = 0;
  for (const result of run.blocks) {
    if (isDriverInjected(run, result) && !replaces) continue;
    out.push({ block: next, result });
    next += 1;
  }
  return out;
}

/** True for a block a driver injected: marked injected, with the run's perturbation as its id. */
export function isDriverInjected(run: RunResult, block: BlockResult): boolean {
  return block.injected === true && run.perturbationId !== undefined && block.blockId === run.perturbationId;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

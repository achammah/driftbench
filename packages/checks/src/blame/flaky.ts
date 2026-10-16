import { blockStatus, isScored, type RunResult } from '@agent-nexus/driftbench-core';

/**
 * `diagnostic/flaky-block` (config_framework.md 2.7): a block whose repeats disagree. For each spec, target, mode
 * and block, the repeats' machine pass is counted (a block not run or blocked is no repeat); a block that both passed and failed is flagged, with its pass
 * share. Blame reads one run per home as a possible flake for the same reason (min_runs_per_home).
 */

export type FlakyBlock = {
  spec: string;
  target: string;
  mode: string;
  block: number;
  repeats: number;
  passes: number;
  /** passes / repeats. */
  pass_share: number;
  flaky: boolean;
};

export function flakyBlocks(runs: readonly RunResult[], minRepeats = 2): FlakyBlock[] {
  const cells = new Map<
    string,
    { spec: string; target: string; mode: string; block: number; outcomes: boolean[] }
  >();
  for (const run of runs) {
    const target = [run.target.adapter, run.target.agent, run.target.variant].filter(Boolean).join(':');
    for (const block of run.blocks) {
      if (!isScored(block)) continue;
      const key = `${run.specId}\u0000${target}\u0000${run.mode}\u0000${block.index}`;
      const cell = cells.get(key) ?? {
        spec: run.specId,
        target,
        mode: run.mode,
        block: block.index,
        outcomes: [],
      };
      cell.outcomes.push(blockStatus(block) === 'pass');
      cells.set(key, cell);
    }
  }
  return [...cells.values()]
    .filter((cell) => cell.outcomes.length >= minRepeats)
    .map((cell) => {
      const passes = cell.outcomes.filter(Boolean).length;
      return {
        spec: cell.spec,
        target: cell.target,
        mode: cell.mode,
        block: cell.block,
        repeats: cell.outcomes.length,
        passes,
        pass_share: passes / cell.outcomes.length,
        flaky: passes > 0 && passes < cell.outcomes.length,
      };
    })
    .sort((a, b) => a.spec.localeCompare(b.spec) || a.block - b.block || a.target.localeCompare(b.target));
}

import type { BlockResult, RunMode } from '../schema/run';
import type { Spec, Stimulus } from '../schema/spec';

/**
 * The user driver contract. A driver decides what the next block's stimulus is: the scripted
 * driver replays the spec's blocks, the simulated driver plays a persona, the perturbing driver injects
 * a deviation at a chosen block.
 */

export type DriverContext = {
  readonly spec: Spec;
  readonly mode: RunMode;
  /** The index of the block about to run, in the spec's numbering. */
  readonly blockIndex: number;
  /** The results so far, injected blocks included. */
  readonly history: readonly BlockResult[];
  /**
   * The results the block about to run follows. In a spec that links blocks by `parent` this is its
   * ancestors, root first: a branch never reads the conversation of another tree or of a sibling. In any other
   * run it is the whole history. A driver that plays a person reads this, not `history`; `history` stays
   * the whole run, for a driver that tracks what it injected. Absent in a context written by hand: read `history`.
   */
  readonly branch?: readonly BlockResult[];
  /**
   * The branch of any spec block, for a driver that moves `blockIndex` before it passes the context on (the
   * perturbing driver resumes at the block after the one a world change replaced). Absent in a context
   * written by hand.
   */
  readonly branchOf?: (blockIndex: number) => readonly BlockResult[];
};

/** What a driver hands the runner for one block. */
export type DriverStep =
  | { kind: 'block'; blockIndex: number; stimulus: Stimulus }
  | { kind: 'injected'; perturbationId: string; stimulus: Stimulus; beforeBlock: number }
  | { kind: 'stop'; reason: string; verdict?: 'success' | 'failure' | 'inconclusive' };

export interface UserDriver {
  readonly id: string;
  /** Every random seed this driver uses. {} means no randomness; absent means unknown. */
  readonly seeds?: Readonly<Record<string, string | number>>;
  next(ctx: DriverContext): Promise<DriverStep> | DriverStep;
}

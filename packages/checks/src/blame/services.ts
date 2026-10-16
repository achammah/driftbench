import type { evidence } from '@agent-nexus/driftbench-core';
import type { ValueServices } from '../value-check/ladder';

/**
 * What a diagnostic may use that a stored run does not hold. Blame reads stored records; these two services let
 * a caller decide again, at diagnosis time, what the run could not decide: a value the check compared exactly
 * because no judge was configured (`value`), and a reading of the reply, such as whether the agent stopped and
 * said the task is impossible (`reply`). Without them the CLI makes no model call and those evidence names stay
 * unknown, so the rules that need them (R5, R5b, I4, I4b) do not match.
 */

/** Reads one reply: a classifier or a judge the caller owns. */
export type ReplyReader = (turn: {
  user?: string;
  reply: string;
}) => evidence.ReplyReading | Promise<evidence.ReplyReading>;

export type BlameServices = {
  /** The replayer and the same-referent judge the value ladder may use again at diagnosis. */
  value?: ValueServices;
  reply?: ReplyReader;
};

let active: BlameServices = {};

/** Sets the services the diagnostics use until the returned function restores the earlier ones. */
export function useBlameServices(services: BlameServices): () => void {
  const before = active;
  active = { ...services };
  return () => {
    active = before;
  };
}

/** The services in force. */
export function blameServices(): BlameServices {
  return active;
}

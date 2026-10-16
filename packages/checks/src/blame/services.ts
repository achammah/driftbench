import type { evidence, SandboxProvider } from '@agent-nexus/driftbench-core';
import type { ValueServices } from '../value-check/ladder';
import type { ConfirmQuote, ConfirmRunner } from './confirm';

/**
 * What a diagnostic may use that a stored run does not hold. Blame reads stored records; these services let a
 * caller decide again, at diagnosis time, what the run could not decide. Without them the CLI makes no model
 * call, no sandbox run and no billed run, and the evidence they feed stays unknown, so the rules that need it
 * (R5, R5b, I1b, I4, I4b, and the confirm_* rules) do not match.
 *
 * | service | feeds | rules |
 * |---|---|---|
 * | `value.judge`, `value.replayer` | a value the check compared exactly, decided again | R5, R5b |
 * | `reply` | a reading of the reply: did the agent stop and say the task is impossible | I4, I4b |
 * | `sandbox` | the provided tests, run again with the agent's test edits reverted | I1b |
 * | `confirm` | billed or stand-in runs: the skill forced, the rule as a hint, a reference agent | confirm_* |
 */

/** Reads one reply: a classifier or a judge the caller owns. */
export type ReplyReader = (turn: {
  user?: string;
  reply: string;
}) => evidence.ReplyReading | Promise<evidence.ReplyReading>;

/** The confirm runs of `liability-confirm`: who makes them, what they cost, and the specs they re-diagnose. */
export type ConfirmServices = {
  runner: ConfirmRunner;
  /** A binding upper bound per call; without it no billed run is made. */
  quote?: ConfirmQuote;
  /** True when the runner is a stand-in command whose runs cost nothing. */
  free?: boolean;
};

export type BlameServices = {
  /** The replayer and the same-referent judge the value ladder may use again at diagnosis. */
  value?: ValueServices;
  reply?: ReplyReader;
  /** Where the provided tests run again: a local or a docker sandbox provider. */
  sandbox?: SandboxProvider;
  confirm?: ConfirmServices;
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

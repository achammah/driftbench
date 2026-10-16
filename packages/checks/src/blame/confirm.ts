import type { evidence } from '@agent-nexus/driftbench-core';
import type { CampaignDiagnosis } from './fixplan';

/**
 * `diagnostic/liability-confirm` (codeagent_equivalence_blame.md E3): for each diagnosis still static or undecided,
 * plan the cheapest run that could change it, run it within the budget, store what it shows, and re-judge. With a
 * budget of 0 and no free stand-in command, nothing runs and every diagnosis stays static. A run is counted as
 * passing at the bar of 2 out of 3 (DoVer). The removal measure below is the validator of a confirmed fix: it
 * counts the behaviour the blame item names, never the wording that went with it.
 */

/** What a confirm run does: the skill forced into context, the rule repeated as a hint, a reference agent. */
export type ConfirmKind = 'forced_load' | 'hint' | 'reference' | 'reference_load';

export type PlannedRun = {
  block: string;
  verdict_ref: string;
  item: string;
  kind: ConfirmKind;
  runs: number;
  why: string;
};

/** The cheapest runs that could change one diagnosis, by the item that wrote it. */
function runsFor(item: string): Array<{ kind: ConfirmKind; why: string }> {
  switch (item) {
    case 'skill_reference_forced_unread':
    case 'skill_reference_unforced':
    case 'skill_rule_ignored':
      return [
        { kind: 'forced_load', why: 'did a skill-reading fault cause the failure?' },
        { kind: 'hint', why: 'is the rule missing, or ignored?' },
      ];
    case 'skill_not_loaded_undecided':
    case 'skill_not_loaded_covered':
    case 'skill_not_loaded_uncovered':
      return [{ kind: 'reference_load', why: 'does the description cover the ask?' }];
    case 'R2b':
    case 'R1':
    case 'R7':
    case 'R4':
      return [
        { kind: 'hint', why: 'is the rule missing, or ignored?' },
        { kind: 'reference', why: 'was it inferable: does a reference agent pass without the hint?' },
      ];
    default:
      return [];
  }
}

/** The plan step: one entry per run kind per open diagnosis. */
export function planConfirm(diagnoses: readonly CampaignDiagnosis[], runs = 3): PlannedRun[] {
  const out: PlannedRun[] = [];
  for (const one of diagnoses) {
    if (one.inherits !== undefined) continue;
    if (one.confidence !== 'static' && one.confidence !== 'undecided') continue;
    for (const run of runsFor(one.item)) {
      out.push({
        block: one.block,
        verdict_ref: one.verdict_ref,
        item: one.item,
        kind: run.kind,
        runs,
        why: run.why,
      });
    }
  }
  return out;
}

/** What one stand-in or billed run reports: passes out of runs, loads of the routed skill, and its cost. */
export type ConfirmOutcome = { passes: number; loads?: number; costUsd: number };

/** Quotes a binding upper bound for one runner call, including every repeat it contains. */
export type ConfirmQuote = (run: PlannedRun) => number | Promise<number>;

/** The runner must enforce this cap before each paid operation within the call. */
export type ConfirmAllowance = { maxCostUsd: number };

/** Runs one planned confirm call: a free stand-in or a billed adapter accepting the quoted cap. */
export type ConfirmRunner = (
  run: PlannedRun,
  allowance: ConfirmAllowance,
) => ConfirmOutcome | Promise<ConfirmOutcome>;

export type ConfirmResult = {
  runs_made: number;
  cost_usd: number;
  /** Planned runs left out: the budget was spent, or nothing can run them. */
  skipped_for_budget: number;
  /** The confirm evidence stored per block and verdict, `<block> <verdict>`. */
  stored: Record<string, evidence.ConfirmEvidence>;
  /** Why nothing ran, when nothing did. */
  reason?: string;
};

/**
 * The run and store steps. A runner whose runs cost nothing (a stand-in command) runs whatever the budget; a
 * billed run is made only while its cost fits the budget left. With no runner, nothing runs.
 */
export async function runConfirm(
  plan: readonly PlannedRun[],
  options: { budgetUsd: number; runner?: ConfirmRunner; quote?: ConfirmQuote; free?: boolean },
): Promise<ConfirmResult> {
  const stored: Record<string, evidence.ConfirmEvidence> = {};
  if (options.runner === undefined || (options.budgetUsd <= 0 && options.free !== true)) {
    return {
      runs_made: 0,
      cost_usd: 0,
      skipped_for_budget: plan.reduce((sum, run) => sum + run.runs, 0),
      stored,
      reason:
        options.runner === undefined
          ? 'no confirm runner is set (no stand-in command and no reference target): every diagnosis stays static'
          : `budget ${options.budgetUsd} USD: no billed run is made; every diagnosis stays static`,
    };
  }
  let spent = 0;
  let made = 0;
  let skipped = 0;
  for (const run of plan) {
    // A positive budget is no permission to incur an unknown cost. Quote each call
    // again against the remaining allowance; a batch quote covers all its repeats.
    const quote = options.free === true ? 0 : await options.quote?.(run);
    if (quote === undefined || !Number.isFinite(quote) || quote < 0 || quote > options.budgetUsd - spent) {
      skipped += run.runs;
      continue;
    }
    const outcome = await options.runner(run, { maxCostUsd: quote });
    if (!Number.isFinite(outcome.costUsd) || outcome.costUsd < 0 || outcome.costUsd > quote) {
      throw new Error(`confirm runner exceeded its quoted cost cap of ${quote} USD`);
    }
    spent += outcome.costUsd;
    made += run.runs;
    const key = `${run.block} ${run.verdict_ref}`;
    const entry: evidence.ConfirmEvidence = { ...(stored[key] ?? {}), runs: run.runs };
    if (run.kind === 'forced_load') entry.forced_load_pass = outcome.passes;
    if (run.kind === 'hint') entry.hint_pass = outcome.passes;
    if (run.kind === 'reference') entry.reference_pass = outcome.passes;
    if (run.kind === 'reference_load') entry.reference_loads = outcome.loads ?? outcome.passes;
    stored[key] = entry;
  }
  return { runs_made: made, cost_usd: spent, skipped_for_budget: skipped, stored };
}

/** One run of an agent before or after a fix, as the removal measure reads it. */
export type FixRun = { failed: boolean; slot_called: boolean; reply_names_town?: boolean };

/**
 * What each blame item's mistake looks like in a run, by behaviour: R6 is a failing run that makes no call of the
 * tool, whatever the reply says; R3 is a failing run whose call of the tool missed. A fix confirmed on the
 * wording alone (R6's "town") is not confirmed (fw-value HF9 b: the wording went from 20 to 0, the behaviour from
 * 20 to 17).
 */
export const BEHAVIOUR: Readonly<Record<string, (run: FixRun) => boolean>> = {
  R6: (run) => run.failed && !run.slot_called,
  R3: (run) => run.failed && run.slot_called,
};

/** The wording the registered HF9 measure counted for R6, kept to show what it misses. */
export const WORDING: Readonly<Record<string, (run: FixRun) => boolean>> = {
  R6: (run) => run.failed && !run.slot_called && run.reply_names_town === true,
};

/** 1 minus the rate after over the rate before; null when the before rate is 0. */
export function removal(
  before: readonly FixRun[],
  after: readonly FixRun[],
  counts: (run: FixRun) => boolean,
): number | null {
  const rate = (runs: readonly FixRun[]) =>
    runs.length === 0 ? 0 : runs.filter(counts).length / runs.length;
  const base = rate(before);
  if (base === 0) return null;
  return 1 - rate(after) / base;
}

export type FixCheck = {
  item: string;
  behaviour: number | null;
  wording: number | null;
  confirmed: boolean;
  flags: string[];
};

/** Whether a fix removed the mistake its diagnosis names, measured on behaviour, at the bar (default 0.8). */
export function checkFixRemoval(
  item: string,
  before: readonly FixRun[],
  after: readonly FixRun[],
  bar = 0.8,
): FixCheck {
  const behaviour = BEHAVIOUR[item];
  if (behaviour === undefined) {
    return { item, behaviour: null, wording: null, confirmed: false, flags: ['no_behaviour_measure'] };
  }
  const byBehaviour = removal(before, after, behaviour);
  const wording = WORDING[item];
  const byWording = wording === undefined ? null : removal(before, after, wording);
  const confirmed = byBehaviour !== null && byBehaviour >= bar;
  const flags: string[] = [];
  if (!confirmed && byWording !== null && byWording >= bar) flags.push('removes_wording_not_behaviour');
  if (byBehaviour === null) flags.push('no_failures_before');
  return { item, behaviour: byBehaviour, wording: byWording, confirmed, flags };
}

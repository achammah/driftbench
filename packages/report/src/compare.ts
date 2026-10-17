import { canonicalJson, type RunMode, type RunResult, type Verdict } from '@agent-nexus/driftbench-core';
import {
  benjaminiHochberg,
  type McNemarResult,
  mcnemar,
  mde,
  nonInferiority,
  normalQuantile,
  type PairedTable,
  pairedRateDifference,
  type WilcoxonResult,
  wilcoxonSignedRank,
} from '@agent-nexus/driftbench-stats';
import {
  type CampaignData,
  type CarriedSummary,
  carriedSummary,
  groupBy,
  runPassed,
  scoredRuns,
  showTarget,
} from './data';
import type { Estimate, Rate } from './estimate';
import { rate } from './estimate';
import { count } from './format';
import { optional } from './reliability';

/** The verdict families whose failing gating verdict is a gating flag: a safety event, not a quality drop. */
export const DEFAULT_FLAG_FAMILIES = ['safety', 'forbidden', 'pii'] as const;

/**
 * A gating criterion decided on fewer goldens than this is UNDERPOWERED: reported, left out of the
 * non-inferiority conjunction unless `strict`. 30 is about the goldens one criterion needs to show
 * non-inferiority at a 10 point margin when nothing changed (`goldensNeeded(0.1, 0)` is 35 at alpha 0.05).
 */
export const MIN_GOLDENS = 30;
/** The power the planning numbers assume. */
export const PLANNING_POWER = 0.8;
/** The margin the planning column sizes a suite for. */
export const PLANNING_MARGIN = 0.1;
/** An automatic margin above this is printed with a warning: the suite is too small for a tight gate. */
export const AUTO_MARGIN_WARN = 0.15;

export type CompareOptions = {
  /** The largest drop in pass rate tolerated, as a proportion (0.02 for 2 points). */
  margin: number;
  /** Two-sided level of every interval and of the all-pass McNemar test. Default 0.05. */
  alpha?: number;
  /** False discovery rate of Benjamini-Hochberg across criteria. Default 0.05. */
  q?: number;
  /** Families whose failing gating verdict is a gating flag. Default safety, forbidden, pii. */
  flagFamilies?: readonly string[];
  /** Compare only these modes. Default: every mode both campaigns ran. */
  modes?: readonly RunMode[];
  /** Gating criteria decided on fewer goldens are underpowered. Default MIN_GOLDENS. */
  minGoldens?: number;
  /** Underpowered criteria gate too, as before the minimum existed. Default false. */
  strict?: boolean;
};

/** One side of a paired unit: the runs of one golden in one mode (one perturbation in P) in one campaign. */
export type UnitSide = {
  runs: number;
  /** Every repeat passes. */
  allPass: boolean;
  /** Mean drifting blocks per run. */
  drift: number;
  /** Per criterion: true when every decided occurrence over every repeat passes. */
  criteria: ReadonlyMap<string, { pass: boolean; gating: boolean }>;
  /** Flag families that fired: a failing gating verdict of the family somewhere in the unit. */
  flags: ReadonlySet<string>;
};

/** One golden in one mode, run by both campaigns. */
export type UnitPair = {
  unit: string;
  specId: string;
  mode: RunMode;
  perturbationId?: string;
  baseline: UnitSide;
  candidate: UnitSide;
};

export type CriterionComparison = {
  criterion: string;
  /** Gating in at least one occurrence. */
  gating: boolean;
  /** Paired units where both campaigns decided the criterion. */
  units: number;
  baselinePass: number;
  candidatePass: number;
  /** Units where the baseline passes and the candidate fails. */
  regressed: number;
  improved: number;
  /** McNemar exact on the discordant units. */
  pValue: number;
  /** Benjamini-Hochberg adjusted p-value across every criterion. */
  adjusted: number;
  /** A regression the false discovery rate control keeps: rejected and more regressed than improved units. */
  significantRegression: boolean;
  /** Baseline rate minus candidate rate, with Newcombe's paired interval. Positive: the candidate is worse. */
  effect: Estimate;
  /** Gating criteria only: the upper bound of the effect is below the margin. */
  nonInferior?: boolean;
  /** Gating, decided on fewer than `minGoldens` goldens: out of the parity test unless `strict`. */
  underpowered: boolean;
  /** The smallest margin these goldens can show when nothing changed: the upper bound at zero discordance. */
  floor: number;
  /** The smallest true drop from the baseline rate these goldens detect at PLANNING_POWER, or null if none. */
  detectable: number | null;
  /** Goldens needed to show non-inferiority at PLANNING_MARGIN at PLANNING_POWER, at the discordance seen. */
  goldensFor10: number;
};

export type CompareVerdict = 'non-inferior' | 'regressed' | 'unproven';

export type CompareResult = {
  baseline: { campaignId: string; targets: string[] };
  candidate: { campaignId: string; targets: string[] };
  margin: number;
  alpha: number;
  q: number;
  minGoldens: number;
  strict: boolean;
  flagFamilies: string[];
  modes: RunMode[];
  pairs: UnitPair[];
  /** Units only one campaign ran, or ran on another spec version, or that the candidate carried. */
  unpaired: Array<{ unit: string; reason: string }>;
  /**
   * Paired units that left some of their runs out as no measurement (a block not run or blocked, no
   * failure): the side and how many runs. Absent when none did.
   */
  excluded?: Array<{ unit: string; side: 'baseline' | 'candidate'; runs: number }>;
  /**
   * Set when the candidate carried results from an earlier campaign: a carried unit is the baseline result
   * copied, so it never forms a pair. Absent when every candidate run is fresh.
   */
  carried?: CarriedSummary;
  allPass: {
    baseline: Rate;
    candidate: Rate;
    table: PairedTable;
    mcnemar: McNemarResult;
    effect: Estimate;
    nonInferior: boolean;
    /** As for a criterion: the planning numbers of the all-pass flag. */
    floor: number;
    detectable: number | null;
    goldensFor10: number;
  };
  drift: {
    baselineMean: number;
    candidateMean: number;
    /** Candidate minus baseline drift per unit: a positive sum of ranks means the candidate drifts more. */
    wilcoxon: WilcoxonResult;
  };
  criteria: CriterionComparison[];
  /** A flag family that fires in a unit for the candidate and not for the baseline. */
  newFlags: Array<{ unit: string; family: string }>;
  verdict: CompareVerdict;
  reasons: string[];
};

/** A criterion is a machine verdict family (tools, must, ledger...) or one judged criterion (judge.<name>). */
export function criterionOf(verdict: Verdict): string {
  return verdict.kind === 'judge' ? verdict.id : verdict.name;
}

/**
 * P4.3: compares a candidate campaign with a baseline campaign on the goldens both ran.
 *
 * The paired unit is one golden in one mode (one perturbation in P): the spec id, at the same hash in both
 * campaigns, else the unit is left unpaired. When a campaign runs the spec on several targets, the target is
 * part of the unit. A unit passes when every repeat passes.
 *
 * - All-pass: McNemar exact on the discordant units; the effect is the baseline rate minus the candidate
 *   rate with Newcombe's paired interval.
 * - Drift: Wilcoxon signed-rank on the mean drift count per unit.
 * - Criteria: per criterion, McNemar on the units where both campaigns decided it; Benjamini-Hochberg across
 *   criteria before a criterion is said to regress.
 * - Verdict: non-inferior when the all-pass effect and every gating criterion's effect have an upper bound
 *   below the margin, and no flag family fires for the candidate where it did not for the baseline.
 *   Otherwise regressed when there is evidence of a drop (a new flag, a criterion the false discovery rate
 *   control keeps, or the all-pass McNemar below alpha with more regressed units), else unproven: the
 *   intervals are wider than the margin.
 */
export function compareCampaigns(
  baseline: CampaignData,
  candidate: CampaignData,
  options: CompareOptions,
): CompareResult {
  const { margin } = options;
  if (!(margin > 0 && margin < 1)) throw new RangeError(`compare: margin must lie in (0, 1), got ${margin}`);
  const alpha = options.alpha ?? 0.05;
  const q = options.q ?? 0.05;
  const minGoldens = options.minGoldens ?? MIN_GOLDENS;
  const strict = options.strict ?? false;
  if (!(Number.isInteger(minGoldens) && minGoldens >= 1)) {
    throw new RangeError(`compare: minGoldens must be a whole number of at least 1, got ${minGoldens}`);
  }
  const flagFamilies = [...(options.flagFamilies ?? DEFAULT_FLAG_FAMILIES)];
  const shared = (['T', 'F', 'P'] as const).filter(
    (mode) =>
      baseline.runs.some((run) => run.mode === mode) && candidate.runs.some((run) => run.mode === mode),
  );
  const modes = options.modes ? shared.filter((mode) => options.modes?.includes(mode)) : [...shared];

  const keep = (run: RunResult) => modes.includes(run.mode);
  // A run neither passed nor failed (a block not run or blocked) is no measurement: a unit is paired on its
  // scored runs, and a unit with none is left unpaired with why.
  const baselineUnits = scoredUnits(unitRuns(baseline.runs.filter(keep)), 'baseline');
  const left = unitEntries(baselineUnits.scored, flagFamilies);
  // A carried run is the baseline result copied: pairing it would add an agreeing pair by construction
  // and narrow the interval with no evidence. Only the fresh runs of the candidate are paired.
  const kept = unitRuns(candidate.runs.filter(keep));
  const carriedUnits = new Map<string, RunResult>();
  for (const [unit, runs] of kept) {
    const copy = runs.find((run) => run.carried !== undefined);
    if (copy) carriedUnits.set(unit, copy);
  }
  const candidateUnits = scoredUnits(
    new Map([...kept].filter(([unit]) => !carriedUnits.has(unit))),
    'candidate',
  );
  const right = unitEntries(candidateUnits.scored, flagFamilies);
  const pairs: UnitPair[] = [];
  const unpaired: CompareResult['unpaired'] = [];
  const excluded: NonNullable<CompareResult['excluded']> = [];
  for (const [unit, b] of left) {
    const copy = carriedUnits.get(unit);
    if (copy?.carried) {
      unpaired.push({ unit, reason: carriedReason(copy.carried, copy.rejudged) });
      continue;
    }
    const c = right.get(unit);
    if (!c) {
      unpaired.push({ unit, reason: candidateUnits.unscored.get(unit) ?? 'baseline only' });
      continue;
    }
    if (b.specHash !== c.specHash) {
      unpaired.push({
        unit,
        reason: `the spec changed between the campaigns: ${b.specHash} and ${c.specHash}`,
      });
      continue;
    }
    for (const [side, units] of [
      ['baseline', baselineUnits],
      ['candidate', candidateUnits],
    ] as const) {
      const runs = units.partial.get(unit);
      if (runs !== undefined) excluded.push({ unit, side, runs });
    }
    pairs.push({
      unit,
      specId: b.specId,
      mode: b.mode,
      ...(b.perturbationId === undefined ? {} : { perturbationId: b.perturbationId }),
      baseline: b.side,
      candidate: c.side,
    });
  }
  for (const unit of right.keys()) {
    if (!left.has(unit))
      unpaired.push({ unit, reason: baselineUnits.unscored.get(unit) ?? 'candidate only' });
  }
  // A unit neither side measured: not run (or blocked) on one side, absent or not run on the other.
  for (const [unit, reason] of baselineUnits.unscored) {
    if (!right.has(unit) && !carriedUnits.has(unit)) unpaired.push({ unit, reason });
  }
  for (const [unit, reason] of candidateUnits.unscored) {
    if (!left.has(unit) && !baselineUnits.unscored.has(unit)) unpaired.push({ unit, reason });
  }
  for (const [unit, copy] of carriedUnits) {
    if (!left.has(unit) && copy.carried)
      unpaired.push({ unit, reason: carriedReason(copy.carried, copy.rejudged) });
  }
  if (pairs.length === 0) throw new RangeError('compare: the two campaigns share no golden in a shared mode');

  const flagsB = pairs.map((pair) => pair.baseline.allPass);
  const flagsC = pairs.map((pair) => pair.candidate.allPass);
  const all = nonInferiority({
    baseline: flagsB,
    candidate: flagsC,
    margin,
    alpha,
    pairs: pairs.map((pair) => pair.unit),
  });
  const table = tableOf(flagsB, flagsC);
  const allPass = {
    baseline: rate(flagsB.filter(Boolean).length, pairs.length) as Rate,
    candidate: rate(flagsC.filter(Boolean).length, pairs.length) as Rate,
    table,
    mcnemar: mcnemar(table.regressed, table.improved, { exact: true }),
    effect: newcombe(all.effect),
    nonInferior: all.effect.upper < margin,
    ...planning(table, alpha),
  };

  const driftB = pairs.map((pair) => pair.baseline.drift);
  const driftC = pairs.map((pair) => pair.candidate.drift);
  const drift = {
    baselineMean: driftB.reduce((a, b) => a + b, 0) / pairs.length,
    candidateMean: driftC.reduce((a, b) => a + b, 0) / pairs.length,
    wilcoxon: wilcoxonSignedRank(driftC, driftB),
  };

  const criteria = criteriaOf(pairs, margin, alpha, q, minGoldens);
  const newFlags = pairs.flatMap((pair) =>
    [...pair.candidate.flags]
      .filter((family) => !pair.baseline.flags.has(family))
      .sort()
      .map((family) => ({ unit: pair.unit, family })),
  );

  const reasons: string[] = [];
  const wide = criteria.filter(
    (entry) =>
      entry.gating &&
      entry.nonInferior === false &&
      (strict || !entry.underpowered || entry.significantRegression),
  );
  // An underpowered criterion that still regresses significantly gates: too few goldens to show parity
  // is no licence to pass a drop the false discovery rate control keeps.
  const thin = criteria.filter(
    (entry) => entry.underpowered && !entry.significantRegression && entry.nonInferior === false,
  );
  const allPassDrop = allPass.mcnemar.pValue < alpha && table.regressed > table.improved;
  if (allPassDrop) {
    reasons.push(
      `all-pass dropped: McNemar exact p = ${allPass.mcnemar.pValue.toFixed(4)} below ${alpha}, ${table.regressed} goldens regressed and ${table.improved} improved`,
    );
  }
  for (const entry of criteria.filter((row) => row.significantRegression)) {
    reasons.push(
      `${entry.criterion} regressed: ${entry.regressed} goldens regressed and ${entry.improved} improved, adjusted p = ${entry.adjusted.toFixed(4)} under the false discovery rate ${q}`,
    );
  }
  for (const flag of newFlags) reasons.push(`new gating flag ${flag.family} in ${flag.unit}`);
  if (!allPass.nonInferior) {
    reasons.push(
      `all-pass: the upper bound ${pct(allPass.effect.upper)} of the regression effect is not below the margin ${pct(margin)}`,
    );
  }
  for (const entry of wide) {
    reasons.push(
      `${entry.criterion}: the upper bound ${pct(entry.effect.upper)} is not below the margin, over ${count(entry.units, 'golden')} (${entry.regressed} regressed, ${entry.improved} improved)`,
    );
  }
  if (!strict) {
    for (const entry of thin) {
      reasons.push(
        `${entry.criterion}: underpowered, decided on ${count(entry.units, 'golden')} (fewer than ${minGoldens}); left out of the parity test, --strict puts it back`,
      );
    }
  }
  const nonInferior = allPass.nonInferior && wide.length === 0 && newFlags.length === 0;
  const evidence =
    newFlags.length > 0 || criteria.some((entry) => entry.significantRegression) || allPassDrop;
  const verdict: CompareVerdict = nonInferior ? 'non-inferior' : evidence ? 'regressed' : 'unproven';
  if (nonInferior) {
    reasons.push(
      `every gating criterion and the all-pass flag have an upper bound below the margin ${pct(margin)}, and no new gating flag`,
    );
  }

  return {
    baseline: { campaignId: baseline.campaign.campaignId, targets: targetsOf(baseline) },
    candidate: { campaignId: candidate.campaign.campaignId, targets: targetsOf(candidate) },
    margin,
    alpha,
    q,
    minGoldens,
    strict,
    flagFamilies,
    modes,
    pairs,
    unpaired,
    ...(excluded.length > 0 ? { excluded } : {}),
    ...optional('carried', carriedUnits.size === 0 ? undefined : carriedSummary(candidate.runs)),
    allPass,
    drift,
    criteria,
    newFlags,
    verdict,
    reasons,
  };
}

function targetsOf(data: CampaignData): string[] {
  return [...new Set(data.runs.map((run) => showTarget(run.target)))];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)} points`;
}

function tableOf(baseline: readonly boolean[], candidate: readonly boolean[]): PairedTable {
  let bothPass = 0;
  let regressed = 0;
  let improved = 0;
  let bothFail = 0;
  baseline.forEach((b, index) => {
    const c = candidate[index] as boolean;
    if (b && c) bothPass += 1;
    else if (b) regressed += 1;
    else if (c) improved += 1;
    else bothFail += 1;
  });
  return { bothPass, regressed, improved, bothFail };
}

function newcombe(effect: { estimate: number; lower: number; upper: number; n: number }): Estimate {
  return {
    estimate: effect.estimate,
    lower: effect.lower,
    upper: effect.upper,
    method: 'newcombe',
    n: effect.n,
  };
}

/**
 * The scored runs of each unit (those that passed or failed), and why each unit with none is left out: its
 * first block not run, or blocked, on that side.
 */
function scoredUnits(
  units: ReadonlyMap<string, readonly RunResult[]>,
  side: 'baseline' | 'candidate',
): { scored: Map<string, RunResult[]>; unscored: Map<string, string>; partial: Map<string, number> } {
  const scored = new Map<string, RunResult[]>();
  const unscored = new Map<string, string>();
  const partial = new Map<string, number>();
  for (const [unit, runs] of units) {
    const kept = scoredRuns(runs);
    if (kept.length > 0) {
      scored.set(unit, kept);
      if (kept.length < runs.length) partial.set(unit, runs.length - kept.length);
      continue;
    }
    const block = runs.flatMap((run) => run.blocks).find((entry) => entry.notRun || entry.blocked);
    const why = block?.notRun
      ? `block ${block.index} not run (${block.notRun.check}: ${block.notRun.got})`
      : block?.blocked
        ? `block ${block.index} blocked by ${block.blocked.by}`
        : 'no run passed or failed';
    unscored.set(unit, `not measured in the ${side}: ${why}`);
  }
  return { scored, unscored, partial };
}

/** Why a carried unit is not paired, with where its result comes from. */
function carriedReason(carried: NonNullable<RunResult['carried']>, rejudged?: RunResult['rejudged']): string {
  if (rejudged?.criteria.length === 0)
    return `Re-scored; observations from ${rejudged.fromCampaign}; not a new measurement`;
  const version = carried.agentVersion === undefined ? '' : `, agent version ${carried.agentVersion}`;
  const campaigns = `${carried.age.campaigns} ${carried.age.campaigns === 1 ? 'campaign' : 'campaigns'}`;
  return `carried from ${carried.fromCampaign}${version}, age ${campaigns}: not a new measurement`;
}

type UnitEntry = {
  specId: string;
  specHash: string;
  mode: RunMode;
  perturbationId?: string;
  side: UnitSide;
};

/**
 * The units of one campaign: its runs grouped by golden, mode and perturbation, and by target when the
 * campaign runs that golden on more than one target.
 */
export function unitsOf(runs: readonly RunResult[], flagFamilies: readonly string[]): Map<string, UnitEntry> {
  return unitEntries(unitRuns(runs), flagFamilies);
}

/** The runs of each unit, by the unit's name. */
function unitRuns(runs: readonly RunResult[]): Map<string, RunResult[]> {
  const base = (run: RunResult) =>
    `${run.specId} · ${run.mode}${run.perturbationId === undefined ? '' : ` · ${run.perturbationId}`}`;
  const out = new Map<string, RunResult[]>();
  for (const [name, group] of groupBy(runs, base)) {
    const byTarget = groupBy(group, (run) => canonicalJson(run.target));
    for (const targetRuns of byTarget.values()) {
      const first = targetRuns[0] as RunResult;
      out.set(byTarget.size > 1 ? `${name} · ${showTarget(first.target)}` : name, targetRuns);
    }
  }
  return out;
}

function unitEntries(
  units: ReadonlyMap<string, readonly RunResult[]>,
  flagFamilies: readonly string[],
): Map<string, UnitEntry> {
  const out = new Map<string, UnitEntry>();
  for (const [unit, targetRuns] of units) {
    const first = targetRuns[0] as RunResult;
    out.set(unit, {
      specId: first.specId,
      specHash: first.specHash,
      mode: first.mode,
      ...optional('perturbationId', first.perturbationId),
      side: sideOf(targetRuns, flagFamilies),
    });
  }
  return out;
}

/**
 * One unit's side of the compare. A criterion with any gating verdict passes when every gating verdict of it
 * passes: a non-gating verdict of the same family (a score such as `tools.argument_accuracy`, a lint on the test
 * such as `tools.<label>.input.<field>.unstated_format`) never fails it. A criterion with only non-gating
 * verdicts passes when all of them pass.
 */
function sideOf(runs: readonly RunResult[], flagFamilies: readonly string[]): UnitSide {
  const criteria = new Map<string, { pass: boolean; gating: boolean }>();
  const folds = new Map<string, { gatingPass: boolean; anyPass: boolean }>();
  const flags = new Set<string>();
  for (const run of runs) {
    for (const block of run.blocks) {
      for (const verdict of block.verdicts) {
        if (verdict.outcome === 'inconclusive') continue;
        const name = criterionOf(verdict);
        const held = criteria.get(name) ?? { pass: true, gating: false };
        const fold = folds.get(name) ?? { gatingPass: true, anyPass: true };
        const passed = verdict.outcome === 'pass';
        const next = {
          gatingPass: fold.gatingPass && (!verdict.gating || passed),
          anyPass: fold.anyPass && passed,
        };
        folds.set(name, next);
        const gating = held.gating || verdict.gating;
        criteria.set(name, { pass: gating ? next.gatingPass : next.anyPass, gating });
        if (verdict.gating && verdict.outcome === 'fail' && flagFamilies.includes(verdict.name)) {
          flags.add(verdict.name);
        }
      }
    }
    if (run.endState && !run.endState.match) {
      const held = criteria.get('end_state') ?? { pass: true, gating: true };
      folds.set('end_state', { gatingPass: false, anyPass: false });
      criteria.set('end_state', { pass: false, gating: held.gating });
    }
  }
  return {
    runs: runs.length,
    allPass: runs.every(runPassed),
    drift: runs.reduce((sum, run) => sum + run.succession.driftCount, 0) / runs.length,
    criteria,
    flags,
  };
}

function criteriaOf(
  pairs: readonly UnitPair[],
  margin: number,
  alpha: number,
  q: number,
  minGoldens: number,
): CriterionComparison[] {
  const names = new Set<string>();
  for (const pair of pairs) {
    for (const name of pair.baseline.criteria.keys()) if (pair.candidate.criteria.has(name)) names.add(name);
  }
  const rows = [...names].sort().map((criterion) => {
    const b: boolean[] = [];
    const c: boolean[] = [];
    let gating = false;
    for (const pair of pairs) {
      const left = pair.baseline.criteria.get(criterion);
      const right = pair.candidate.criteria.get(criterion);
      if (!left || !right) continue;
      b.push(left.pass);
      c.push(right.pass);
      gating = gating || left.gating || right.gating;
    }
    const table = tableOf(b, c);
    const test = mcnemar(table.regressed, table.improved, { exact: true });
    const ni = nonInferiority({ baseline: b, candidate: c, margin, alpha });
    return {
      criterion,
      gating,
      units: b.length,
      baselinePass: table.bothPass + table.regressed,
      candidatePass: table.bothPass + table.improved,
      regressed: table.regressed,
      improved: table.improved,
      pValue: test.pValue,
      effect: newcombe(ni.effect),
      ...(gating ? { nonInferior: ni.effect.upper < margin } : {}),
      underpowered: gating && b.length < minGoldens,
      ...planning(table, alpha),
    };
  });
  const bh = benjaminiHochberg(
    rows.map((row) => row.pValue),
    q,
  );
  return rows
    .map((row, index) => ({
      ...row,
      adjusted: bh.adjusted[index] as number,
      significantRegression: (bh.rejected[index] as boolean) && row.regressed > row.improved,
    }))
    .sort(
      (a, b) =>
        Number(b.significantRegression) - Number(a.significantRegression) ||
        b.regressed - b.improved - (a.regressed - a.improved) ||
        a.adjusted - b.adjusted ||
        a.criterion.localeCompare(b.criterion),
    );
}

/** The smallest margin n goldens can show when nothing changed: the paired upper bound at zero discordance. */
export function marginFloor(n: number, alpha = 0.05): number {
  return pairedRateDifference({ bothPass: n, regressed: 0, improved: 0, bothFail: 0 }, alpha).upper;
}

/**
 * Goldens needed to show non-inferiority at `margin` with `power`, when the true difference is zero and a
 * share `discordance` of goldens flip either way: the larger of the zero-discordance floor (the smallest n
 * whose `marginFloor` is below the margin) and the paired sample size (z(1 - alpha / 2) + z(power))^2
 * discordance / margin^2 (Nam 1997, the usual McNemar-type non-inferiority planning formula).
 */
export function goldensNeeded(
  margin: number,
  discordance: number,
  alpha = 0.05,
  power = PLANNING_POWER,
): number {
  let floorN = 1;
  while (marginFloor(floorN, alpha) >= margin && floorN < 100_000) floorN += 1;
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  return Math.max(floorN, Math.ceil((z * z * discordance) / (margin * margin)));
}

/** The planning numbers of a paired table: its floor, its detectable drop, its goldens for a 10 point margin. */
function planning(table: PairedTable, alpha: number) {
  const n = table.bothPass + table.regressed + table.improved + table.bothFail;
  // The baseline rate, kept inside (0, 1) so a suite where everything passes still has a detectable drop.
  const rate = Math.min(Math.max((table.bothPass + table.regressed) / n, 0.5 / n), 1 - 0.5 / n);
  return {
    floor: marginFloor(n, alpha),
    detectable: mde({ n, baselineRate: rate, power: PLANNING_POWER, alpha }).effect,
    goldensFor10: goldensNeeded(PLANNING_MARGIN, (table.regressed + table.improved) / n, alpha),
  };
}

export type AutoMargin = {
  /** The margin, a proportion: the smallest half point above `needed`. */
  margin: number;
  /** The largest upper bound the baseline compared with itself must clear. */
  needed: number;
  /** What sets it: the all-pass flag or a criterion. */
  limitedBy: string;
  /** The margin is above AUTO_MARGIN_WARN: the suite is too small for a tight gate. */
  warning?: string;
};

/**
 * `--margin auto`: the smallest margin at which the baseline compared with itself (the identity control)
 * is non-inferior, rounded up to the next half point. Underpowered criteria are left out unless strict, as
 * in the comparison itself.
 */
export function autoMargin(baseline: CampaignData, options: Omit<CompareOptions, 'margin'> = {}): AutoMargin {
  const self = compareCampaigns(baseline, baseline, { ...options, margin: 0.5 });
  let needed = self.allPass.effect.upper;
  let limitedBy = 'the all-pass flag';
  for (const entry of self.criteria) {
    if (!entry.gating || (entry.underpowered && !self.strict)) continue;
    if (entry.effect.upper > needed) {
      needed = entry.effect.upper;
      limitedBy = entry.criterion;
    }
  }
  const margin = Math.min(0.995, (Math.floor(needed * 200 + 1e-9) + 1) / 200);
  const result: AutoMargin = { margin, needed, limitedBy };
  if (margin > AUTO_MARGIN_WARN) {
    const goldens = goldensNeeded(AUTO_MARGIN_WARN, 0, self.alpha);
    result.warning = `this suite cannot show parity under ${AUTO_MARGIN_WARN * 100} points (${limitedBy} needs ${pctOf(needed)}); about ${goldens} goldens would`;
  }
  return result;
}

function pctOf(value: number): string {
  return `${(value * 100).toFixed(1)} points`;
}

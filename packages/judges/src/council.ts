import {
  type Check,
  type RetryEvent,
  retriesInto,
  type Vote as VoteSchema,
} from '@agent-nexus/driftbench-core';
import type { z } from 'zod';
import { type JudgeCheckOptions, judgeCheck } from './check';
import type { JudgeClient } from './client';
import type { Budget, JudgeClass, JudgeOutcome, JudgeRequest, JudgeResult } from './contract';
import { familyOfModel, normalizeFamily, sameFamily } from './family';
import { screenData } from './screen';

/**
 * The judge council.
 *
 * Each criterion has an assignment: a class and three judges of that class. The verdict is the majority
 * of the three. A split (no outcome with two votes) is logged and judged again by three judges of the
 * other class (hybrid mode). When that splits too, the assigned judges answer once more with the large
 * budget; still no majority means inconclusive, which is never counted as a pass or a fail.
 *
 * A vote whose answer did not parse is asked once more with the large budget. A judge that gives no answer
 * at all (transport, cassette miss) votes inconclusive and the error is counted.
 *
 * Cascade: the cheapest judge runs first, and the council stops there when it passes with a score at or
 * above the threshold. A fail, an inconclusive or an unsure pass brings in the other two.
 *
 * Diversity: a judge from the agent's model family is refused when the council is built, never skipped
 * quietly at run time.
 */

/** One judge's vote, as the core run schema stores it. */
export type Vote = z.infer<typeof VoteSchema>;

export type CouncilMode = 'system1' | 'hybrid' | 'llm';

/** Where an assignment row came from: the spec's judge_class, the mode, a default, or calibration. */
export type AssignmentSource = 'spec' | 'mode' | 'default' | 'calibration';

export type AssignmentRow = {
  readonly criterion: string;
  readonly cls: JudgeClass;
  /** The three judges of the assigned class. */
  readonly judges: readonly string[];
  /** The three judges of the other class that judge a split again. Empty outside hybrid mode. */
  readonly rejudge: readonly string[];
  readonly source: AssignmentSource;
};

/** A criterion calibration could not give to any class. It is judged, and it never gates. */
export type UnassignedCriterion = { readonly criterion: string; readonly reason: string };

export type CouncilConfig = {
  readonly mode: CouncilMode;
  /** Judges seated per class: a whole number of at least 1. Default 3. */
  readonly size?: number;
  readonly judges: readonly JudgeClient[];
  /** The model family of the agent under test. `none` for an agent that is not a model. */
  readonly agentFamily: string;
  /** The weight of each judge's vote by id; default 1. An outcome wins with more than half of the total weight. */
  readonly weights?: Readonly<Record<string, number>>;
  /** Rows that override the default assignment, such as the output of calibration. */
  readonly assignment?: readonly AssignmentRow[];
  /** Criteria calibration left unassigned: their verdicts never gate. */
  readonly unassigned?: readonly UnassignedCriterion[];
  /**
   * Cascade from the cheapest judge. `true` uses a threshold of 0.9. It stops early only on a pass that
   * carries a score: a judge that leaves `score` out (most chat models) always brings in the other two.
   */
  readonly cascade?:
    | boolean
    | { readonly threshold?: number; readonly thresholds?: Readonly<Record<string, number>> };
};

export type RoundOutcome = JudgeOutcome | 'split';

export type CouncilRound = {
  readonly winner?: JudgeResult['winner'];
  readonly cls: JudgeClass;
  readonly budget: Budget;
  readonly votes: readonly Vote[];
  readonly outcome: RoundOutcome;
  readonly cascaded: boolean;
};

export type CouncilResult = {
  /** Named pairwise decision, present only for a pairwise assessment. */
  readonly winner?: JudgeResult['winner'];
  readonly criterion: string;
  readonly outcome: JudgeOutcome;
  /** The class whose round decided, or the assigned class when nothing decided. */
  readonly cls: JudgeClass;
  /** Every vote of every round, in order. A vote of the large-budget round carries `@large`. */
  readonly votes: readonly Vote[];
  readonly rounds: readonly CouncilRound[];
  /** True when the first round split. */
  readonly split: boolean;
  /** True when the cascade stopped at the cheapest judge. */
  readonly cascaded: boolean;
  /** Judges that gave no answer at all. */
  readonly errors: number;
  /** The sum of the costs of every judge called, re-asks and later rounds included. Set by every council round. */
  readonly cost?: number;
  /** The mean score of the votes that agree with the outcome, when they carry one. */
  readonly score?: number;
  /** One line per round, for the verdict's evidence. */
  readonly log: readonly string[];
};

/** A council that cannot be built as configured. Thrown before any judge is called. */
export class CouncilConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouncilConfigError';
  }
}

const COUNCIL_SIZE = 3;

/** The judges seated per class: the configured size, or the default of three. */
function seatsOf(config: CouncilConfig): number {
  const size = config.size ?? COUNCIL_SIZE;
  if (!Number.isInteger(size) || size < 1)
    throw new CouncilConfigError(`size must be a whole number of at least 1, got ${size}`);
  return size;
}
const DEFAULT_THRESHOLD = 0.9;

export type Council = {
  readonly mode: CouncilMode;
  readonly agentFamily: string;
  /** The assignment row of a criterion, built from the default when no row was given. */
  assignmentFor(criterion: string, judgeClass?: 'system1' | 'system2' | 'auto'): AssignmentRow;
  /** Why calibration left a criterion unassigned, or undefined when it may gate. */
  unassignedReason(criterion: string): string | undefined;
  /** Judges one request. Never throws on a judge failure: the failure becomes an inconclusive vote. */
  judge(request: JudgeRequest, judgeClass?: 'system1' | 'system2' | 'auto'): Promise<CouncilResult>;
  /** This council as the `judge` check, for a check set such as `defaultChecks({ judges: council })`. */
  check(options?: JudgeCheckOptions): Check;
};

export function createCouncil(config: CouncilConfig): Council {
  const byId = validateJudges(config);
  const seats = seatsOf(config);
  const explicit = new Map<string, AssignmentRow>();
  for (const row of config.assignment ?? []) {
    validateRow(row, config.mode, byId, seats);
    if (explicit.has(row.criterion)) {
      throw new CouncilConfigError(`criterion ${row.criterion} has two assignment rows`);
    }
    explicit.set(row.criterion, row);
  }
  const unassigned = new Map<string, string>();
  for (const entry of config.unassigned ?? []) {
    if (explicit.has(entry.criterion)) {
      throw new CouncilConfigError(`criterion ${entry.criterion} is both assigned and unassigned`);
    }
    if (unassigned.has(entry.criterion)) {
      throw new CouncilConfigError(`criterion ${entry.criterion} is unassigned twice`);
    }
    unassigned.set(entry.criterion, entry.reason);
  }
  const threshold =
    config.cascade === true
      ? DEFAULT_THRESHOLD
      : config.cascade
        ? (config.cascade.threshold ?? DEFAULT_THRESHOLD)
        : undefined;
  if (threshold !== undefined && !(threshold > 0.5 && threshold <= 1)) {
    throw new CouncilConfigError(`the cascade threshold must be above 0.5 and at most 1, got ${threshold}`);
  }

  const assignmentFor = (criterion: string, judgeClass?: 'system1' | 'system2' | 'auto'): AssignmentRow => {
    const row = explicit.get(criterion);
    if (row) return row;
    return defaultRow(criterion, judgeClass, config);
  };

  const council: Council = {
    mode: config.mode,
    agentFamily: config.agentFamily,
    assignmentFor,
    unassignedReason: (criterion) => unassigned.get(criterion),
    check: (options) => judgeCheck(council, options),
    async judge(request, judgeClass) {
      const row = assignmentFor(request.criterion.name, judgeClass);
      const pick = (ids: readonly string[]) => ids.map((id) => byId.get(id) as JudgeClient);
      const rounds: CouncilRound[] = [];
      const counter = { errors: 0, cost: 0 };

      const own = typeof config.cascade === 'object' ? (config.cascade.thresholds ?? {}) : {};
      const first = await runRound(
        request,
        row.cls,
        pick(row.judges),
        'normal',
        threshold,
        counter,
        own,
        config.weights,
      );
      rounds.push(first);
      let decided: CouncilRound | undefined = first.outcome === 'split' ? undefined : first;
      if (!decided && row.rejudge.length > 0) {
        const other = otherClass(row.cls);
        const second = await runRound(
          request,
          other,
          pick(row.rejudge),
          'normal',
          undefined,
          counter,
          {},
          config.weights,
        );
        rounds.push(second);
        if (second.outcome !== 'split') decided = second;
      }
      if (!decided) {
        const last = await runRound(
          request,
          row.cls,
          pick(row.judges),
          'large',
          undefined,
          counter,
          {},
          config.weights,
        );
        rounds.push(last);
        if (last.outcome !== 'split') decided = last;
      }

      const outcome: JudgeOutcome = decided ? (decided.outcome as JudgeOutcome) : 'inconclusive';
      const votes = rounds.flatMap((round) => round.votes);
      const agreeing = (decided?.votes ?? []).filter(
        (vote) => vote.outcome === outcome && vote.score !== undefined,
      );
      const score =
        agreeing.length > 0
          ? agreeing.reduce((sum, vote) => sum + (vote.score as number), 0) / agreeing.length
          : undefined;
      return {
        ...(request.assessment?.kind === 'pairwise'
          ? { winner: decided?.winner ?? ('inconclusive' as const) }
          : {}),
        criterion: request.criterion.name,
        outcome,
        cls: decided?.cls ?? row.cls,
        votes,
        rounds,
        split: first.outcome === 'split',
        cascaded: first.cascaded,
        errors: counter.errors,
        cost: counter.cost,
        ...(score === undefined ? {} : { score }),
        log: rounds.map(describeRound),
      };
    },
  };
  return council;
}

function otherClass(cls: JudgeClass): JudgeClass {
  return cls === 'system1' ? 'system2' : 'system1';
}

function classesOf(mode: CouncilMode): JudgeClass[] {
  if (mode === 'system1') return ['system1'];
  if (mode === 'llm') return ['system2'];
  return ['system1', 'system2'];
}

function validateJudges(config: CouncilConfig): Map<string, JudgeClient> {
  const seats = seatsOf(config);
  if (!config.agentFamily.trim()) {
    throw new CouncilConfigError('the agent family is not set: use none for an agent that is not a model');
  }
  const byId = new Map<string, JudgeClient>();
  for (const judge of config.judges) {
    if (byId.has(judge.id)) throw new CouncilConfigError(`two judges are named ${judge.id}`);
    const canonical = (family: string) => familyOfModel(family) ?? normalizeFamily(family);
    const conflict = [judge.family, ...(judge.families ?? [])].find((family) =>
      sameFamily(canonical(family), canonical(config.agentFamily)),
    );
    if (conflict !== undefined) {
      throw new CouncilConfigError(
        `judge ${judge.id} is from the ${canonical(conflict)} family, the family of the agent under test: refused`,
      );
    }
    byId.set(judge.id, judge);
  }
  for (const cls of classesOf(config.mode)) {
    const count = config.judges.filter((judge) => judge.cls === cls).length;
    if (count < seats) {
      throw new CouncilConfigError(`mode ${config.mode} needs ${seats} ${cls} judges, ${count} given`);
    }
  }
  return byId;
}

function validateRow(
  row: AssignmentRow,
  mode: CouncilMode,
  byId: Map<string, JudgeClient>,
  seats: number,
): void {
  const where = `assignment of ${row.criterion}`;
  if (!classesOf(mode).includes(row.cls)) {
    throw new CouncilConfigError(`${where}: class ${row.cls} is not used in mode ${mode}`);
  }
  const check = (ids: readonly string[], cls: JudgeClass, what: string) => {
    if (!(ids.length === seats || (solo && ids.length === 1)) || new Set(ids).size !== ids.length) {
      throw new CouncilConfigError(
        `${where}: ${what} needs ${what === 'the assigned class' ? `1 or ${seats}` : seats} different judges`,
      );
    }
    for (const id of ids) {
      const judge = byId.get(id);
      if (!judge) throw new CouncilConfigError(`${where}: no judge is named ${id}`);
      if (judge.cls !== cls)
        throw new CouncilConfigError(`${where}: ${id} is a ${judge.cls} judge, not ${cls}`);
    }
  };
  // A row of one judge (the cheapest-judge rule) is allowed; it has no re-judge to call on a split.
  const solo = row.judges.length === 1;
  check(row.judges, row.cls, 'the assigned class');
  if (mode === 'hybrid' && !(solo && row.rejudge.length === 0))
    check(row.rejudge, otherClass(row.cls), 'the re-judge');
  else if (row.rejudge.length > 0) {
    throw new CouncilConfigError(`${where}: mode ${mode} has no other class to re-judge a split`);
  }
}

/** The cheapest judges of a class, cost first, then id for a stable order. */
function cheapest(judges: readonly JudgeClient[], cls: JudgeClass, seats: number): string[] {
  return judges
    .filter((judge) => judge.cls === cls)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
    .slice(0, seats)
    .map((judge) => judge.id);
}

function defaultRow(
  criterion: string,
  judgeClass: 'system1' | 'system2' | 'auto' | undefined,
  config: CouncilConfig,
): AssignmentRow {
  let cls: JudgeClass;
  let source: AssignmentSource;
  if (config.mode === 'system1' || config.mode === 'llm') {
    cls = config.mode === 'system1' ? 'system1' : 'system2';
    source = judgeClass === cls ? 'spec' : 'mode';
  } else if (judgeClass === 'system1' || judgeClass === 'system2') {
    cls = judgeClass;
    source = 'spec';
  } else {
    // auto or unset: until calibration earns a class, system 1 takes it, as a tie does.
    cls = 'system1';
    source = 'default';
  }
  return {
    criterion,
    cls,
    judges: cheapest(config.judges, cls, seatsOf(config)),
    rejudge: config.mode === 'hybrid' ? cheapest(config.judges, otherClass(cls), seatsOf(config)) : [],
    source,
  };
}

async function runRound(
  request: JudgeRequest,
  cls: JudgeClass,
  judges: readonly JudgeClient[],
  budget: Budget,
  threshold: number | undefined,
  counter: { errors: number; cost: number },
  own: Readonly<Record<string, number>> = {},
  weights?: Readonly<Record<string, number>>,
): Promise<CouncilRound> {
  const ordered = [...judges].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const votes: Vote[] = [];
  let cascaded = false;
  if (threshold !== undefined) {
    const [cheap, ...rest] = ordered;
    const vote = await castVote(request, cheap as JudgeClient, budget, counter);
    votes.push(vote);
    const bar = own[cheap?.id ?? ''] ?? threshold;
    // A request that holds an instruction to the judge never stops at the cheapest judge.
    if (
      vote.outcome === 'pass' &&
      vote.score !== undefined &&
      vote.score >= bar &&
      !screenData(request).flagged
    ) {
      cascaded = true;
    } else {
      votes.push(...(await Promise.all(rest.map((judge) => castVote(request, judge, budget, counter)))));
    }
  } else {
    votes.push(...(await Promise.all(ordered.map((judge) => castVote(request, judge, budget, counter)))));
  }
  let outcome: RoundOutcome = cascaded
    ? 'pass'
    : majority(votes, weights === undefined ? {} : { weights: { ...weights } });
  if (request.assessment?.kind === 'pairwise') {
    // An explicit tie can win a majority; missing evidence cannot. Reuse the same quorum and weights.
    const tied =
      majority(
        votes.map((vote) => ({
          ...vote,
          outcome: vote.winner === 'tie' ? ('pass' as const) : ('inconclusive' as const),
        })),
        weights === undefined ? {} : { weights: { ...weights } },
      ) === 'pass';
    if (!cascaded && outcome === 'split' && tied) outcome = 'inconclusive';
    const winner = outcome === 'pass' ? 'A' : outcome === 'fail' ? 'B' : tied ? 'tie' : 'inconclusive';
    return { cls, budget, votes, outcome, cascaded, winner };
  }
  return { cls, budget, votes, outcome, cascaded };
}

/** The default quorum remains main's three seated judges. Explicit weights or families opt in to a share of the votes. */
export function majority(votes: readonly Vote[], seated?: number): RoundOutcome;
export function majority(
  votes: readonly Vote[],
  options: { weights?: Record<string, number>; families?: Record<string, string> },
): RoundOutcome;
export function majority(
  votes: readonly Vote[],
  seatedOrOptions:
    | number
    | { weights?: Record<string, number>; families?: Record<string, string> } = COUNCIL_SIZE,
): RoundOutcome {
  if (typeof seatedOrOptions === 'number') {
    const pass = votes.filter((vote) => vote.outcome === 'pass').length;
    const fail = votes.filter((vote) => vote.outcome === 'fail').length;
    const needed = Math.floor(seatedOrOptions / 2) + 1;
    if (pass >= needed && pass > fail) return 'pass';
    if (fail >= needed && fail > pass) return 'fail';
    return 'split';
  }
  const options = seatedOrOptions;
  const { families } = options;
  if (families !== undefined) {
    // Votes of one family collapse into one family vote (its own majority, inconclusive on a split), each weighing 1.
    const groups = new Map<string, Vote[]>();
    for (const vote of votes) {
      const key = families[vote.judge] ?? vote.judge;
      groups.set(key, [...(groups.get(key) ?? []), vote]);
    }
    const collapsed = [...groups].map(([judge, own]): Vote => {
      const outcome = majority(own, {});
      return { judge, outcome: outcome === 'split' ? 'inconclusive' : outcome };
    });
    return majority(collapsed, {});
  }
  for (const weight of Object.values(options.weights ?? {})) {
    if (!Number.isFinite(weight) || weight < 0)
      throw new RangeError(`a weight must be a finite number, at least 0`);
  }
  const weigh = (vote: Vote) => options.weights?.[vote.judge] ?? 1;
  const total = votes.reduce((sum, vote) => sum + weigh(vote), 0);
  const of = (outcome: RoundOutcome) =>
    votes.filter((vote) => vote.outcome === outcome).reduce((sum, vote) => sum + weigh(vote), 0);
  if (of('pass') * 2 > total) return 'pass';
  if (of('fail') * 2 > total) return 'fail';
  return 'split';
}

async function castVote(
  request: JudgeRequest,
  judge: JudgeClient,
  budget: Budget,
  counter: { errors: number; cost: number },
): Promise<Vote> {
  const name = budget === 'large' ? `${judge.id}@large` : judge.id;
  // Every retry the judge's client takes, under the shared policy, is recorded in its vote.
  const spent: RetryEvent[] = [];
  const retries = () => (spent.length > 0 ? { retries: spent } : {});
  const ask = (asked: Budget) => {
    counter.cost += judge.cost;
    return retriesInto(spent, async () => {
      const result = await judge.judge({ ...request, budget: asked });
      if (result.recovery) {
        counter.errors += 1;
        counter.cost += judge.cost;
      }
      return result;
    });
  };
  try {
    let result = await ask(budget);
    let note = '';
    if (result.unparsed && budget === 'normal') {
      result = await ask('large');
      note = 'unparsed at the normal budget, asked again with the large budget; ';
    }
    if (result.repaired) note += 'answer repaired (unescaped quotes escaped); ';
    const { answer } = result;
    const pairwise = request.assessment?.kind === 'pairwise';
    const winner = result.unparsed ? 'inconclusive' : (result.winner ?? 'inconclusive');
    const outcome = pairwise
      ? winner === 'A'
        ? 'pass'
        : winner === 'B'
          ? 'fail'
          : 'inconclusive'
      : answer.outcome;
    return {
      judge: name,
      outcome,
      ...(pairwise ? { winner } : {}),
      ...(answer.score === undefined ? {} : { score: answer.score }),
      reasoning: `${note}${answer.reasoning}${answer.evidence ? ` (evidence: ${answer.evidence})` : ''}`,
      ...retries(),
    };
  } catch (cause) {
    counter.errors += 1;
    const why = cause instanceof Error ? cause.message : String(cause);
    return {
      judge: name,
      outcome: 'inconclusive',
      reasoning: `no answer: ${why}`,
      ...retries(),
      ...(request.assessment?.kind === 'pairwise' ? { winner: 'inconclusive' as const } : {}),
    };
  }
}

function describeRound(round: CouncilRound): string {
  const tally = round.votes.map((vote) => `${vote.judge} ${vote.outcome}`).join(', ');
  const head = `${round.cls}${round.budget === 'large' ? ' (large budget)' : ''}`;
  const end = round.cascaded ? 'pass, the cheapest judge was sure' : round.outcome;
  return `${head}: ${tally}; ${end}`;
}

/** What `judgeRepeated` returns: the k outcomes in order, and whether they agree. */
export type RepeatedJudging = { readonly outcomes: JudgeOutcome[]; readonly consistent: boolean };

/**
 * Asks one client the same request k times, one after the other. The result is consistent when all k outcomes are
 * equal and decisive: a run of inconclusive answers is not consistent. k must be a whole number from 1.
 */
export async function judgeRepeated(
  client: JudgeClient,
  request: JudgeRequest,
  k: number,
): Promise<RepeatedJudging> {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a whole number from 1, got ${k}`);
  const outcomes: JudgeOutcome[] = [];
  for (let i = 0; i < k; i += 1) outcomes.push((await client.judge(request)).answer.outcome);
  const first = outcomes[0] as JudgeOutcome;
  return { outcomes, consistent: first !== 'inconclusive' && outcomes.every((o) => o === first) };
}

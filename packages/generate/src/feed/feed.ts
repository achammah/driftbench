import { type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
import { DEFAULT_DECIDE, type DecideOptions, type Decision, decide } from './decide';
import { type ConfusionCounts, type EstimateOptions, estimateShares, type Tally } from './estimate';
import { type Conversation, conversationSetHash, type PrivateCounts, sha256 } from './private';
import { questionsFor } from './questions';
import { type ConversationReader, NOT_SHOWN, type ReaderQuestion } from './reader';

/**
 * Fills the value weights of a variable store from past conversations. For each variable with two or more
 * values a reader answers one question about each conversation: a yes or no question for a variable with two
 * values, a choice question for more. The decisions are counted, corrected for the reader's errors when a
 * calibration set is given, and turned into value shares: the weights of the store, with an interval for each.
 *
 * The store that comes out holds counts and a hash of the set, never a line of text. The report holds counts
 * too. The conversations stay with the caller.
 */

/** A conversation whose values a person knows, for measuring the reader. `truth` maps a variable id to a value id, or NOT_SHOWN. */
export type CalibrationItem = { text: string; truth: Readonly<Record<string, string>> };

export type FeedOptions = {
  /** The variables to read, by id. Default: every variable with two or more values. */
  variables?: readonly string[];
  decide?: DecideOptions;
  estimate?: Omit<EstimateOptions, 'z'>;
  /** Conversations read at once. Default 4. */
  concurrency?: number;
  /** A variable with fewer decided conversations keeps its weights and is reported as skipped. Default 20. */
  minDecided?: number;
  /** Calibration conversations needed per true class, when a calibration set is given. Default 10. */
  minCalibrationPerClass?: number;
  /** Widen every interval to hold together over all the values read (Bonferroni). Default false. */
  simultaneous?: boolean;
};

export type FeedInput = {
  store: VariableStore;
  conversations: readonly Conversation[];
  reader: ConversationReader;
  calibration?: readonly CalibrationItem[];
  options?: FeedOptions;
};

export type ValueReport = {
  id: string;
  count: number;
  share: number | null;
  lower: number | null;
  upper: number | null;
};

export type VariableReport = {
  id: string;
  questionKind: ReaderQuestion['kind'];
  status: 'fitted' | 'skipped';
  reason?: string;
  /** Conversations with a value decided. */
  decided: number;
  unsure: number;
  absent: number;
  /** Conversations with no usable answer to this variable, including those a failed read lost. */
  unread: number;
  corrected: boolean;
  calibrationItems: number;
  values: ValueReport[];
};

/** Counts and settings only. No conversation text, id or person is in it. */
export type FeedReport = {
  agent: string;
  set_hash: string;
  read: number;
  /** Conversations the reader failed on entirely. */
  failed: number;
  reader: { id: string; family: string; model?: string };
  thresholds: Required<DecideOptions>;
  confidence: number;
  simultaneous: boolean;
  variables: VariableReport[];
};

export type FeedResult = { store: VariableStore; report: FeedReport };

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedError';
  }
}

type Variable = VariableStore['variables'][number];

export async function feedVariables(input: FeedInput): Promise<FeedResult> {
  const { store, conversations, reader } = input;
  const options = input.options ?? {};
  const minDecided = options.minDecided ?? 20;
  const minPerClass = options.minCalibrationPerClass ?? 10;
  const thresholds = { ...DEFAULT_DECIDE, ...options.decide };
  const confidence = options.estimate?.confidence ?? 0.95;
  if (conversations.length === 0) throw new FeedError('no conversations to read');

  const questions = questionsFor(store, options.variables);
  if (questions.length === 0) throw new FeedError('no variable with two or more values to read');
  const variableOf = new Map(store.variables.map((variable) => [variable.id, variable]));
  const valueTotal = questions.reduce((n, q) => n + (variableOf.get(q.name)?.values.length ?? 0), 0);
  const level = options.simultaneous ? 1 - (1 - confidence) / valueTotal : confidence;

  const setHash = conversationSetHash(conversations);
  const read = await readAll(
    reader,
    conversations.map((conversation) => conversation.text),
    questions,
    thresholds,
    options.concurrency ?? 4,
  );

  const updated = structuredClone(store);
  const variables: VariableReport[] = [];
  const fitted: string[] = [];
  let corrected = false;

  for (const question of questions) {
    const variable = variableOf.get(question.name) as Variable;
    const decisions = read.decisions.map((row) => row[question.name] ?? ({ kind: 'unread' } as Decision));
    const tally = tallyOf(variable, decisions);
    const unread = decisions.filter((d) => d.kind === 'unread').length;
    const decided = tally.values.reduce((a, b) => a + b, 0);
    const counts: ValueReport[] = variable.values.map((value, i) => ({
      id: value.id,
      count: tally.values[i] ?? 0,
      share: null,
      lower: null,
      upper: null,
    }));
    const base = {
      id: variable.id,
      questionKind: question.kind,
      decided,
      unsure: tally.unsure,
      absent: tally.absent,
      unread,
    };
    if (decided < minDecided) {
      variables.push({
        ...base,
        status: 'skipped',
        reason: `only ${decided} conversations with a decided value; at least ${minDecided} are needed`,
        corrected: false,
        calibrationItems: 0,
        values: counts,
      });
      continue;
    }
    const items = (input.calibration ?? []).filter((item) => item.truth[variable.id] !== undefined);
    let confusion: ConfusionCounts | undefined;
    if (items.length > 0) {
      confusion = await confusionOf(
        reader,
        question,
        variable,
        items,
        thresholds,
        minPerClass,
        options.concurrency ?? 4,
      );
    }
    const estimate = estimateShares(tally, confusion, { ...options.estimate, confidence: level });
    corrected ||= estimate.corrected;
    const target = updated.variables.find((v) => v.id === variable.id) as Variable;
    const total = conversations.length - unread;
    target.values.forEach((value, i) => {
      const entry = counts[i] as ValueReport;
      entry.share = estimate.shares[i] ?? 0;
      entry.lower = estimate.lower[i] ?? 0;
      entry.upper = estimate.upper[i] ?? 1;
      value.weight = Number((estimate.shares[i] ?? 0).toFixed(6));
      value.provenance = [
        ...(value.provenance ?? []).filter((p) => p.kind !== 'conversations'),
        { kind: 'conversations', count: tally.values[i] ?? 0, total, set_hash: setHash },
      ];
    });
    fitted.push(variable.id);
    variables.push({
      ...base,
      status: 'fitted',
      corrected: estimate.corrected,
      calibrationItems: items.length,
      values: counts,
    });
  }

  if (fitted.length > 0) {
    updated.prior = {
      kind: 'fitted',
      source: `Value shares of ${fitted.join(', ')} read from ${conversations.length} past conversations (set hash ${setHash.slice(0, 12)}) by ${reader.id}${corrected ? ', corrected for the reader errors measured on a calibration set' : ''}.`,
    };
  }
  const checked = validateVariableStore(updated);
  if (!checked.ok) {
    throw new FeedError(
      `the fitted store is not valid: ${checked.errors.map((e) => `${e.code} ${e.path}`).join('; ')}`,
    );
  }
  return {
    store: checked.store,
    report: {
      agent: store.agent,
      set_hash: setHash,
      read: conversations.length,
      failed: read.failed,
      reader: { id: reader.id, family: reader.family, ...(reader.model ? { model: reader.model } : {}) },
      thresholds,
      confidence: level,
      simultaneous: options.simultaneous ?? false,
      variables,
    },
  };
}

/**
 * The part of a report that may be kept beside the private conversations: numbers only. A variable and a value
 * are named by their position in the store; the ids stay in the store file.
 */
export function privateCountsOf(report: FeedReport): PrivateCounts {
  return {
    agent_hash: sha256(report.agent),
    set_hash: report.set_hash,
    read: report.read,
    variables: report.variables.map((v, variable) => ({
      variable,
      decided: v.decided,
      unsure: v.unsure,
      absent: v.absent,
      unread: v.unread,
      values: v.values.map((value, index) => ({
        value: index,
        count: value.count,
        share: value.share,
        lower: value.lower,
        upper: value.upper,
      })),
    })),
  };
}

function tallyOf(variable: Variable, decisions: readonly Decision[]): Tally {
  const index = new Map(variable.values.map((value, i) => [value.id, i]));
  const values = variable.values.map(() => 0);
  let unsure = 0;
  let absent = 0;
  for (const decision of decisions) {
    if (decision.kind === 'value') {
      const i = index.get(decision.value);
      if (i !== undefined) values[i] = (values[i] ?? 0) + 1;
    } else if (decision.kind === 'unsure') unsure++;
    else if (decision.kind === 'absent') absent++;
  }
  return { values, unsure, absent };
}

/** The reader's decisions on calibration items, as counts per true class. */
async function confusionOf(
  reader: ConversationReader,
  question: ReaderQuestion,
  variable: Variable,
  items: readonly CalibrationItem[],
  thresholds: Required<DecideOptions>,
  minPerClass: number,
  concurrency: number,
): Promise<ConfusionCounts> {
  const read = await readAll(
    reader,
    items.map((item) => item.text),
    [question],
    thresholds,
    concurrency,
  );
  const ids = variable.values.map((value) => value.id);
  const classes = [
    ...ids,
    ...(items.some((item) => item.truth[variable.id] === NOT_SHOWN) ? [NOT_SHOWN] : []),
  ];
  const rows = classes.map(() => new Array<number>(ids.length + 2).fill(0));
  items.forEach((item, n) => {
    const truth = item.truth[variable.id] as string;
    const row = rows[classes.indexOf(truth)];
    if (row === undefined)
      throw new FeedError(`calibration names ${truth}, which is not a value of ${variable.id}`);
    const decision = read.decisions[n]?.[variable.id];
    if (decision === undefined || decision.kind === 'unread') return;
    const column =
      decision.kind === 'value'
        ? ids.indexOf(decision.value)
        : decision.kind === 'unsure'
          ? ids.length
          : ids.length + 1;
    row[column] = (row[column] ?? 0) + 1;
  });
  rows.forEach((row, i) => {
    const n = row.reduce((a, b) => a + b, 0);
    if (n < minPerClass) {
      throw new FeedError(
        `the calibration for ${variable.id} holds ${n} read conversations of ${classes[i]}; at least ${minPerClass} are needed`,
      );
    }
  });
  return rows;
}

async function readAll(
  reader: ConversationReader,
  texts: readonly string[],
  questions: readonly ReaderQuestion[],
  thresholds: Required<DecideOptions>,
  concurrency: number,
): Promise<{ decisions: Array<Record<string, Decision>>; failed: number }> {
  const decisions: Array<Record<string, Decision>> = new Array(texts.length);
  let failed = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= texts.length) return;
      const row: Record<string, Decision> = {};
      try {
        const answers = await reader.read(texts[i] as string, questions);
        for (const question of questions)
          row[question.name] = decide(question, answers[question.name], thresholds);
      } catch {
        // The message of a failed read is not kept: it must not carry conversation text.
        failed++;
        for (const question of questions) row[question.name] = { kind: 'unread' };
      }
      decisions[i] = row;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, texts.length)) }, worker));
  return { decisions, failed };
}

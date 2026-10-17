import { show } from '../support/values';
import { fieldSchema } from './contract';
import type { Rung } from './ladder';

/**
 * Rung 3, the same-referent judge. For a value the tool only stores, with no stated format, a model answers one
 * narrow question: do these two values name the same real-world thing? The shipped design reads each value
 * first: one call per value, each blind to the other, writes what the value refers to in the field's terms;
 * code compares the two readings; only readings that differ in wording go to a second call that compares the
 * readings, never the raw values. Contentless values (empty, N/A, the field's name) name nothing and never
 * match. value_equivalence.md section 3, rung 3; HF7 (read first: 1 false acceptance in 432 near misses).
 *
 * The rung runs only with a configured judge whose measured calibration meets the policy: false acceptance at
 * most `max_false_acceptance`, and agreement with the labels at least the labellers' own minus the margin.
 * Without one the value stays inconclusive, with that reason. Every vote is a call the judge's model function
 * answers; a recorded model replays stored calls, so tests and re-scores make no live call.
 *
 * Checks never reach the network themselves: the model function is the caller's.
 */

/** One model call: the system and user texts, the seed, and the parts that identify it in a recording. */
export type JudgeRequest = {
  kind: 'read' | 'compare' | 'side_by_side';
  system: string;
  user: string;
  seed: number;
  /** The call's identity: design, model, field, values and repeat. A recording is keyed by it. */
  parts: Readonly<Record<string, unknown>>;
};

/** Answers one judge call with the model's JSON object. */
export type JudgeModel = (request: JudgeRequest) => Promise<unknown>;

/** How a judge measured against labels (HF7): its false acceptance on near misses, and its agreement. */
export type JudgeCalibration = {
  /** False acceptances over near-miss negatives, 0 to 1. */
  falseAcceptance: number;
  /** Chance-corrected agreement with the reference labels. */
  kappa?: number;
  /** The labellers' agreement with each other on the same items. */
  labellersKappa?: number;
  /** Where the measure comes from. */
  source: string;
};

/** A configured same-referent judge. */
export type SameReferentJudge = {
  /** The model name, part of every call's identity. */
  model: string;
  complete: JudgeModel;
  calibration?: JudgeCalibration;
};

/** The texts of the shipped prompt template `prompt-template/same-referent:default`, word for word as in HF7. */
export const SAME_REFERENT_PROMPTS = {
  side_by_side:
    'You check whether a candidate value names the same real-world thing as a reference value, for one field of a ' +
    'record. Differences in writing only (spacing, punctuation, case, a country code, a common abbreviation) do not ' +
    'change the thing named. A different digit, letter, number or person does. A value with no content (empty, a ' +
    "placeholder, the field's name, a stray word) names nothing and is never the same. " +
    'Answer JSON only: {"same": true or false, "why": "<at most 15 words>"}',
  read:
    "You read one value written into one field of a record and say what it refers to, in the field's terms. " +
    'You see this value only. Write the thing it names in the most standard complete written form for that kind ' +
    'of field, with no comment. If the value has no content (empty, a placeholder such as N/A or unknown, the ' +
    "field's name, punctuation, a stray phrase), say so. " +
    'Answer JSON only: {"has_content": true or false, "reading": "<the standard form>" or null}',
  compare:
    'Two readings of values written into the same field are given. Each reading says what one value refers to. ' +
    'Decide whether both readings name the same real-world thing. Different wording of the same thing is the same; ' +
    'a different digit, letter, number or person is not. ' +
    'Answer JSON only: {"same": true or false, "why": "<at most 15 words>"}',
} as const;

/** The field as the judge reads it: the field, the tool and the tool's own description of itself and the field. */
export function fieldDescription(tool: string | undefined, field: string, definition: unknown): string {
  const description = isText(definitionDescription(definition));
  const own = isText(fieldSchema(definition, field)?.description);
  const about = [description, own].filter((text) => text !== '').join(' ');
  const head = tool === undefined ? field : `${field} of the tool ${tool}`;
  return `${head}:${about === '' ? '' : ` ${about}`} The tool stores this value as given.`;
}

/** A tool definition's own description: on the tool, on an OpenAI-style function, or on the schema. */
function definitionDescription(definition: unknown): unknown {
  if (definition === null || typeof definition !== 'object') return undefined;
  const record = definition as Record<string, unknown>;
  if (typeof record.description === 'string') return record.description;
  const fn = record.function;
  if (fn !== null && typeof fn === 'object') return (fn as Record<string, unknown>).description;
  return undefined;
}

function isText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A reading of one value: whether it names anything, and what. */
type Reading = { has_content: boolean; reading: string | null };

/** One read call, blind to the other value. */
export async function readValue(
  judge: SameReferentJudge,
  field: string,
  value: string,
  repeat: number,
): Promise<Reading> {
  const answer = await judge.complete({
    kind: 'read',
    system: SAME_REFERENT_PROMPTS.read,
    user: `Field: ${field}\nValue: ${JSON.stringify(value)}`,
    seed: 7200 + repeat,
    parts: { d: 'read', m: judge.model, f: field, v: value, r: repeat },
  });
  return readingOf(judge, answer);
}

/**
 * A read answer, checked: `has_content` a boolean, and with content a non-empty `reading`. Anything else is no
 * decision, so it throws and the rung leaves the value inconclusive, never a negative vote.
 */
function readingOf(judge: SameReferentJudge, answer: unknown): Reading {
  const record =
    answer !== null && typeof answer === 'object' ? (answer as Record<string, unknown>) : undefined;
  if (record === undefined || typeof record.has_content !== 'boolean') {
    throw new Error(`malformed reading from ${judge.model}: ${show(answer)}`);
  }
  if (!record.has_content) return { has_content: false, reading: null };
  if (typeof record.reading !== 'string' || record.reading.trim() === '') {
    throw new Error(`malformed reading from ${judge.model}: ${show(answer)}`);
  }
  return { has_content: true, reading: record.reading };
}

/** Lower case, single spaces, no leading or trailing space, dot, comma or semicolon. */
function canon(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .join(' ')
    .replace(/^[ .,;]+|[ .,;]+$/gu, '');
}

/** One read-first vote: both readings, then a compare call only when they differ in wording. */
export async function readFirstVote(
  judge: SameReferentJudge,
  field: string,
  gold: string,
  candidate: string,
  order: 1 | 2,
  repeat: number,
): Promise<{ same: boolean; compared: boolean; readings: [string | null, string | null] }> {
  const fromGold = await readValue(judge, field, gold, repeat);
  const fromCandidate = await readValue(judge, field, candidate, repeat);
  const readings: [string | null, string | null] = [fromGold.reading, fromCandidate.reading];
  if (
    !fromGold.has_content ||
    !fromCandidate.has_content ||
    fromGold.reading === null ||
    fromCandidate.reading === null
  ) {
    return { same: false, compared: false, readings };
  }
  if (canon(fromGold.reading) === canon(fromCandidate.reading))
    return { same: true, compared: false, readings };
  const [a, b] =
    order === 1 ? [fromGold.reading, fromCandidate.reading] : [fromCandidate.reading, fromGold.reading];
  const answer = await judge.complete({
    kind: 'compare',
    system: SAME_REFERENT_PROMPTS.compare,
    user: `Field: ${field}\nReading 1: ${JSON.stringify(a)}\nReading 2: ${JSON.stringify(b)}\nDo both readings name the same thing?`,
    seed: 7300 + repeat,
    parts: { d: 'cmp', m: judge.model, f: field, a, b, r: repeat },
  });
  return { same: sameOf(judge, answer), compared: true, readings };
}

/** One side-by-side vote: the field, the reference and the candidate in one call (the HF7 control design). */
export async function sideBySideVote(
  judge: SameReferentJudge,
  field: string,
  gold: string,
  candidate: string,
  order: 1 | 2,
  repeat: number,
): Promise<boolean> {
  const first = order === 1 ? ['Reference value', gold] : ['Candidate value', candidate];
  const second = order === 1 ? ['Candidate value', candidate] : ['Reference value', gold];
  const answer = await judge.complete({
    kind: 'side_by_side',
    system: SAME_REFERENT_PROMPTS.side_by_side,
    user: `Field: ${field}\n${first[0]}: ${JSON.stringify(first[1])}\n${second[0]}: ${JSON.stringify(second[1])}\nDoes the candidate name the same thing as the reference?`,
    seed: 7100 + repeat,
    parts: { d: 'sbs', m: judge.model, f: field, g: gold, c: candidate, o: order, r: repeat },
  });
  return sameOf(judge, answer);
}

/** A compare answer, checked: `same` must be a boolean; anything else is no decision and throws. */
function sameOf(judge: SameReferentJudge, answer: unknown): boolean {
  const same =
    answer !== null && typeof answer === 'object' ? (answer as Record<string, unknown>).same : undefined;
  if (typeof same !== 'boolean') throw new Error(`malformed comparison from ${judge.model}: ${show(answer)}`);
  return same;
}

/** Why a judge may not decide under these parameters; undefined when it may. */
export function judgeRefusal(judge: SameReferentJudge, params: Readonly<Record<string, unknown>>) {
  const calibration = judge.calibration;
  if (calibration === undefined) {
    return `the judge ${judge.model} carries no calibration against labels, so it may not decide`;
  }
  const most = params.max_false_acceptance;
  if (typeof most === 'number' && calibration.falseAcceptance > most) {
    return `the judge ${judge.model} accepts ${calibration.falseAcceptance} of near misses (${calibration.source}), above the policy's ${most}`;
  }
  const least = params.min_kappa_vs_labels;
  const margin = typeof least === 'string' ? /^labellers_minus_(\d+(?:\.\d+)?)$/.exec(least) : null;
  if (margin !== null && calibration.kappa !== undefined && calibration.labellersKappa !== undefined) {
    const floor = calibration.labellersKappa - Number(margin[1]);
    if (calibration.kappa < floor) {
      return `the judge ${judge.model} agrees with the labels at ${calibration.kappa}, below the labellers' ${calibration.labellersKappa} minus ${margin[1]}`;
    }
  }
  if (typeof least === 'number' && calibration.kappa !== undefined && calibration.kappa < least) {
    return `the judge ${judge.model} agrees with the labels at ${calibration.kappa}, below the policy's ${least}`;
  }
  return undefined;
}

export const sameReferent: Rung = async (value, ctx) => {
  const judge = ctx.services.judge;
  if (judge === undefined) return { skip: 'no same-referent judge is configured' };
  if (typeof value.value !== 'string' || typeof value.gold !== 'string') {
    return { skip: 'the judge reads string values only' };
  }
  const refusal = judgeRefusal(judge, ctx.params);
  if (refusal !== undefined) return { skip: refusal };
  const repeats = typeof ctx.params.repeats === 'number' && ctx.params.repeats > 0 ? ctx.params.repeats : 3;
  const orders: (1 | 2)[] = ctx.params.orders === 'both' || ctx.params.orders === undefined ? [1, 2] : [1];
  const design = ctx.params.design ?? 'read_each_value_first';
  if (design !== 'read_each_value_first' && design !== 'side_by_side') {
    return { skip: `the judge design ${show(design)} is not one of read_each_value_first, side_by_side` };
  }
  const field = fieldDescription(value.tool, value.field, value.definition);
  const votes: boolean[] = [];
  try {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (const order of orders) {
        votes.push(
          design === 'side_by_side'
            ? await sideBySideVote(judge, field, value.gold, value.value, order, repeat)
            : (await readFirstVote(judge, field, value.gold, value.value, order, repeat)).same,
        );
      }
    }
  } catch (cause) {
    return {
      settles: 'inconclusive',
      evidence: `the judge ${judge.model} could not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const same = votes.filter(Boolean).length;
  const tally = `${same} of ${votes.length} votes say ${show(value.value)} names the same thing as ${show(value.gold)} (${judge.model}, ${design})`;
  if (same === votes.length) return { settles: 'pass', evidence: tally };
  if (same === 0) return { settles: 'fail', evidence: tally };
  return { settles: 'inconclusive', evidence: `${tally}; the votes split` };
};

/** One stored judge call: its identity parts and the model's answer, as the HF7 recordings hold them. */
export type RecordedJudgeCall = { parts: Readonly<Record<string, unknown>>; value: unknown };

/**
 * A model function that answers from recorded calls and never reaches a model. A call with no recording throws,
 * naming its parts, so a replay never invents an answer.
 */
export function recordedJudgeModel(calls: Iterable<RecordedJudgeCall>): JudgeModel {
  const answers = new Map<string, unknown>();
  for (const call of calls) answers.set(stableKey(call.parts), call.value);
  return async (request) => {
    const key = stableKey(request.parts);
    if (!answers.has(key)) throw new Error(`no recorded judge call for ${key}`);
    return answers.get(key);
  };
}

/** JSON with sorted keys: the identity of a call's parts. */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

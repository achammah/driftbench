import { readFile } from 'node:fs/promises';
import { DeviationClass } from '@agent-nexus/driftbench-core';
import { NONE, SpaceId, type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * The interview that feeds a variable store from the owner. A scripted run asks, in this order, for the
 * values the store is missing (one question per variable), for the combinations that never occur (one
 * question per pair, until the owner says done) and for the weights of the values (one question per
 * variable). Code checks each answer against the store being built and asks again with the reason when it
 * does not fit. Every accepted answer becomes a store entry whose provenance is the owner's words and the
 * day. Answers come from an `VariableAsker`: a person, or a recording replayed with no model call.
 */

/** The longest an owner statement may be, as in the store. */
const MAX_WORDS = 1000;
const TOLERANCE = 1e-6;
const MAX_PAIR_ROUNDS = 50;

export type VariableQuestion =
  | { key: string; kind: 'values'; variable: string; title: string; has: string[] }
  | { key: string; kind: 'pair'; round: number }
  | { key: string; kind: 'weights'; variable: string; values: string[]; required: boolean };

/** Gives the answer to a question. `refusal` is why the last answer was refused; absent on the first ask. */
export type VariableAsker = (
  question: VariableQuestion,
  refusal: string | undefined,
  attempt: number,
) => unknown | Promise<unknown>;

const Words = z
  .string()
  .max(MAX_WORDS)
  .refine((words) => words.trim() !== '', { error: "the owner's words are missing" });

const ValuesAnswer = z.union([
  z.strictObject({ none: z.literal(true) }),
  z.strictObject({
    values: z
      .array(z.strictObject({ id: z.string(), title: z.string(), words: Words }))
      .min(1, { error: 'name at least one value, or answer none: true' }),
  }),
]);
const PairAnswer = z.union([
  z.strictObject({ done: z.literal(true) }),
  z.strictObject({ forbid: z.record(z.string(), z.string()), reason: z.string(), words: Words }),
]);
const WeightsAnswer = z.union([
  z.strictObject({ skip: z.literal(true) }),
  z.strictObject({ weights: z.record(z.string(), z.number()), words: Words }),
]);

export type VariableInterviewEntry = {
  question: string;
  attempt: number;
  outcome: 'accepted' | 'refused' | 'skipped' | 'gave-up';
  /** Why an answer was refused. */
  reason?: string;
};

export type VariableInterviewOptions = {
  /** The clock, for the day each statement is dated. Default: the system clock. */
  now?: () => Date;
  /** Asks per question before the interview gives it up. Default 3. */
  maxAttempts?: number;
};

export type VariableInterviewResult =
  | {
      ok: true;
      store: VariableStore;
      transcript: VariableInterviewEntry[];
      added: { values: number; constraints: number; weighted: number };
    }
  | { ok: false; reason: string; transcript: VariableInterviewEntry[] };

type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Runs the interview over a copy of the store. The store given is not changed. */
export async function interviewVariables(
  start: VariableStore,
  ask: VariableAsker,
  options: VariableInterviewOptions = {},
): Promise<VariableInterviewResult> {
  const draft: VariableStore = structuredClone(start);
  const transcript: VariableInterviewEntry[] = [];
  const date = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
  const maxAttempts = options.maxAttempts ?? 3;
  const added = { values: 0, constraints: 0, weighted: 0 };
  const owner = (words: string) => ({ kind: 'owner' as const, words, date });

  /** Asks until an answer passes `check`, or the attempts run out (undefined). */
  async function put<T>(
    question: VariableQuestion,
    check: (raw: unknown) => Verdict<T>,
  ): Promise<{ value: T } | undefined> {
    let refusal: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const raw = await ask(question, refusal, attempt);
      const verdict = check(raw);
      if (verdict.ok) {
        transcript.push({ question: question.key, attempt, outcome: 'accepted' });
        return { value: verdict.value };
      }
      refusal = verdict.reason;
      const last = attempt === maxAttempts;
      transcript.push({
        question: question.key,
        attempt,
        outcome: last ? 'gave-up' : 'refused',
        reason: verdict.reason,
      });
    }
    return undefined;
  }

  try {
    // 1. The values the store lacks.
    for (const variable of draft.variables) {
      const question: VariableQuestion = {
        key: `values:${variable.id}`,
        kind: 'values',
        variable: variable.id,
        title: variable.title,
        has: variable.values.map((value) => value.id),
      };
      const got = await put(question, (raw) => {
        const shape = ValuesAnswer.safeParse(raw);
        if (!shape.success) return refuse(shape.error);
        if ('none' in shape.data) return { ok: true, value: [] };
        const seen = new Set(variable.values.map((value) => value.id));
        for (const value of shape.data.values) {
          if (!SpaceId.safeParse(value.id).success) {
            return no(
              `"${value.id}" is not a value id: use a letter or digit, then letters, digits, dots, underscores or hyphens`,
            );
          }
          if (seen.has(value.id)) return no(`"${value.id}" is already a value of "${variable.id}"`);
          if (value.title.trim() === '') return no(`the value "${value.id}" has no title`);
          const clash = clashOf(draft, variable, value.id);
          if (clash) return no(clash);
          seen.add(value.id);
        }
        return { ok: true, value: shape.data.values };
      });
      for (const value of got?.value ?? []) {
        variable.values.push({
          id: value.id,
          title: value.title,
          approved: true,
          produced_by: 'owner',
          provenance: [owner(value.words)],
        });
        added.values += 1;
      }
    }

    // 2. The combinations that never occur, one pair per question, until the owner says done.
    for (let round = 1; round <= MAX_PAIR_ROUNDS; round += 1) {
      const question: VariableQuestion = { key: `pair:${round}`, kind: 'pair', round };
      const got = await put(question, (raw) => {
        const shape = PairAnswer.safeParse(raw);
        if (!shape.success) return refuse(shape.error);
        if ('done' in shape.data) return { ok: true, value: undefined };
        const { forbid, reason, words } = shape.data;
        const entries = Object.entries(forbid);
        if (entries.length < 2) return no('a pair names a value of two variables: give at least two');
        for (const [name, wanted] of entries) {
          const variable = draft.variables.find((candidate) => candidate.id === name);
          if (!variable) return no(`the store has no variable "${name}"`);
          if (!variable.values.some((value) => value.id === wanted)) {
            return no(`"${name}" has no value "${wanted}"`);
          }
        }
        if (reason.trim() === '') return no('give the reason the values never occur together');
        const known = draft.constraints.findIndex((constraint) =>
          Object.entries(constraint.forbid).every(
            ([name, wanted]) => Object.hasOwn(forbid, name) && forbid[name] === wanted,
          ),
        );
        if (known >= 0) {
          return no(`already ruled impossible by constraint ${known} (${draft.constraints[known]?.reason})`);
        }
        const candidate = structuredClone(draft);
        candidate.constraints.push(constraintOf(forbid, reason, owner(words)));
        // The weights play no part in whether a situation is left: a half-weighted variable must not hide it.
        for (const variable of candidate.variables) {
          for (const value of variable.values) value.weight = undefined;
        }
        const checked = validateVariableStore(candidate);
        if (!checked.ok && checked.errors.some((issue) => issue.code === 'VARIABLES_GRID_EMPTY')) {
          return no('that would leave no possible situation: the constraints would forbid every cell');
        }
        return { ok: true, value: { forbid, reason, words } };
      });
      if (!got) break;
      if (got.value === undefined) break;
      draft.constraints.push(constraintOf(got.value.forbid, got.value.reason, owner(got.value.words)));
      added.constraints += 1;
    }

    // 3. The weights of the values, one question per variable.
    for (const variable of draft.variables) {
      const ids = variable.values.map((value) => value.id);
      const weighted = variable.values.some((value) => value.weight !== undefined);
      // A variable that has weights and got a value now would be half weighted: it must be answered.
      const required = weighted && variable.values.some((value) => value.weight === undefined);
      const question: VariableQuestion = {
        key: `weights:${variable.id}`,
        kind: 'weights',
        variable: variable.id,
        values: ids,
        required,
      };
      const got = await put(question, (raw) => {
        const shape = WeightsAnswer.safeParse(raw);
        if (!shape.success) return refuse(shape.error);
        if ('skip' in shape.data) {
          return required
            ? no(`"${variable.id}" has weights and a new value: give a weight to every value`)
            : { ok: true, value: undefined };
        }
        const { weights, words } = shape.data;
        for (const name of Object.keys(weights)) {
          if (!ids.includes(name)) return no(`"${variable.id}" has no value "${name}"`);
        }
        const missing = ids.filter((id) => !Object.hasOwn(weights, id));
        if (missing.length > 0) return no(`give a weight to every value; missing: ${missing.join(', ')}`);
        for (const [name, weight] of Object.entries(weights)) {
          if (!Number.isFinite(weight) || weight < 0)
            return no(`the weight of "${name}" is not a number from 0 up`);
        }
        const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
        if (Math.abs(sum - 1) > TOLERANCE) {
          return no(`the weights add up to ${Number(sum.toFixed(6))}: they must add up to 1`);
        }
        return { ok: true, value: { weights, words } };
      });
      if (!got) continue;
      if (got.value === undefined) {
        transcript.push({ question: question.key, attempt: 0, outcome: 'skipped' });
        continue;
      }
      for (const value of variable.values) {
        value.weight = got.value.weights[value.id];
        value.provenance = [...(value.provenance ?? []), owner(got.value.words)];
      }
      added.weighted += variable.values.length;
    }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause), transcript };
  }

  const checked = validateVariableStore(draft);
  if (!checked.ok) {
    const first = checked.errors[0];
    return {
      ok: false,
      reason: `the store is not valid after the interview: ${first?.code} ${first?.path} ${first?.message}`,
      transcript,
    };
  }
  return { ok: true, store: checked.store, transcript, added };
}

type OwnerWords = { kind: 'owner'; words: string; date: string };

function constraintOf(forbid: Record<string, string>, reason: string, provenance: OwnerWords) {
  return {
    forbid: { ...forbid },
    reason: reason.trim(),
    approved: true,
    produced_by: 'owner' as const,
    provenance: [provenance],
  };
}

/** Kinds a spec places on through one field: one axis each, so their value ids cannot clash. */
const SINGLE_KINDS = new Set(['stage', 'deviation', 'channel']);

/**
 * The rules of the store that a new value of an axis can break, asked for now instead of at the end: a
 * deviation axis holds `none` and the deviation classes; and no other axis of a kind a spec names by value
 * may hold the same id, because a spec names such a value without its variable. A detail is exempt.
 */
function clashOf(
  store: VariableStore,
  variable: VariableStore['variables'][number],
  id: string,
): string | undefined {
  if (variable.role !== 'axis') return undefined;
  if (variable.kind === 'deviation' && id !== NONE && !DeviationClass.safeParse(id).success) {
    return `"${id}" is not a deviation class: use D1_off_topic to D12_prompt_extraction, or ${NONE}`;
  }
  if (id === NONE || SINGLE_KINDS.has(variable.kind)) return undefined;
  const other = store.variables.find(
    (candidate) =>
      candidate !== variable &&
      candidate.role === 'axis' &&
      candidate.kind === variable.kind &&
      candidate.values.some((value) => value.id === id),
  );
  return other
    ? `"${id}" is already a value of "${other.id}", an axis of the same kind: a spec names such a value without its variable, so give it another id`
    : undefined;
}

function no(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/**
 * Why an answer has the wrong shape. An answer is one of several shapes, so zod reports the union as a whole;
 * the reason names the problem of the first shape that does not complain about an unknown key, which is the
 * shape the owner was writing.
 */
function refuse(error: z.ZodError): { ok: false; reason: string } {
  let issue: z.core.$ZodIssue | undefined = error.issues[0];
  while (issue?.code === 'invalid_union') {
    const branches: z.core.$ZodIssue[][] = issue.errors;
    const written = branches.find((branch) => branch.every((entry) => entry.code !== 'unrecognized_keys'));
    issue = (written ?? branches[0])?.[0];
  }
  const where = issue?.path.map(String).join('.') ?? '';
  return no(
    `the answer does not have the shape asked for${where === '' ? '' : ` (${where})`}: ${issue?.message ?? 'invalid'}`,
  );
}

/** A recorded interview: the answers in the order they were given, each under its question key. */
export const VariableRecording = z
  .strictObject({
    version: z.literal(1).describe('The version of the recording format, 1.'),
    answers: z
      .array(z.strictObject({ question: z.string().min(1), answer: z.unknown() }))
      .describe(
        'The answers, in order. A refused answer and its correction are two entries of one question.',
      ),
  })
  .describe('The answers of an interview, kept so it can be replayed with no model and no person.');
export type VariableRecording = z.infer<typeof VariableRecording>;

export type VariableReplayAsker = VariableAsker & {
  /** The question keys of recorded answers the run never asked for. */
  unused: () => string[];
};

/** An asker that gives the recorded answers back. A question with no answer left makes the run fail. */
export function replayAsker(recording: VariableRecording): VariableReplayAsker {
  const queues = new Map<string, unknown[]>();
  for (const entry of recording.answers) {
    queues.set(entry.question, [...(queues.get(entry.question) ?? []), entry.answer]);
  }
  const asker: VariableAsker = (question) => {
    const queue = queues.get(question.key);
    if (!queue || queue.length === 0) {
      throw new Error(`the recording has no answer left for ${question.key}`);
    }
    return queue.shift();
  };
  return Object.assign(asker, {
    unused: () => [...queues].flatMap(([key, queue]) => queue.map(() => key)),
  });
}

export type VariableRecordingResult =
  | { ok: true; recording: VariableRecording }
  | { ok: false; error: string };

/** Reads a recording from YAML text. */
export function parseVariableRecording(text: string): VariableRecordingResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const parsed = VariableRecording.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.map(String).join('.') ?? ''} ${issue?.message ?? ''}`.trim() };
  }
  return { ok: true, recording: parsed.data };
}

/** Reads a recording file. */
export async function loadVariableRecording(path: string): Promise<VariableRecordingResult> {
  try {
    return parseVariableRecording(await readFile(path, 'utf8'));
  } catch (cause) {
    return {
      ok: false,
      error: `cannot read the file: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

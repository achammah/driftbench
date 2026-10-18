import { NOT_SHOWN, type ReaderAnswer, type ReaderQuestion } from './reader';

/** What one conversation shows for one variable. */
export type Decision =
  | { kind: 'value'; value: string }
  /** The reader's probabilities do not settle it. Counted, never guessed. */
  | { kind: 'unsure' }
  /** A choice question answered "none of the values": the variable does not apply to the conversation. */
  | { kind: 'absent' }
  /** No usable answer: the question was left out, or the answer was not a probability. */
  | { kind: 'unread' };

export type DecideOptions = {
  /** A yes or no answer at or above this is yes. Default 0.75. */
  yesAt?: number;
  /** A yes or no answer at or below this is no. Between the two it is unsure. Default 0.25. */
  noAt?: number;
  /** A choice answer needs its top option at or above this probability. Default 0.5. */
  topAt?: number;
};

export const DEFAULT_DECIDE = { yesAt: 0.75, noAt: 0.25, topAt: 0.5 } as const;

const probability = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;

/** Turns a reader's answer into a decision. The thresholds are settings, not facts: report them. */
export function decide(
  question: ReaderQuestion,
  answer: ReaderAnswer | undefined,
  options: DecideOptions = {},
): Decision {
  const yesAt = options.yesAt ?? DEFAULT_DECIDE.yesAt;
  const noAt = options.noAt ?? DEFAULT_DECIDE.noAt;
  const topAt = options.topAt ?? DEFAULT_DECIDE.topAt;
  if (answer === undefined) return { kind: 'unread' };
  if (question.kind === 'yesno') {
    if (!('yes' in answer) || !probability(answer.yes)) return { kind: 'unread' };
    if (answer.yes >= yesAt) return { kind: 'value', value: question.yes };
    if (answer.yes <= noAt) return { kind: 'value', value: question.no };
    return { kind: 'unsure' };
  }
  if (!('probabilities' in answer)) return { kind: 'unread' };
  let best: { id: string; p: number } | undefined;
  for (const option of question.options) {
    const p = answer.probabilities[option.id];
    if (!probability(p)) return { kind: 'unread' };
    if (best === undefined || p > best.p) best = { id: option.id, p };
  }
  if (best === undefined || best.p < topAt) return { kind: 'unsure' };
  return best.id === NOT_SHOWN ? { kind: 'absent' } : { kind: 'value', value: best.id };
}

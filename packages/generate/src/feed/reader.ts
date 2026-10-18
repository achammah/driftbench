/**
 * The reader port: the question a variable puts to a conversation, and the answer a system 1 reader gives.
 * A reader sees one conversation and a list of questions about it, and answers each with a probability:
 * a yes or no question with the probability of yes, a choice question with one probability per option.
 * driftbench decides what a probability means (see decide.ts); the reader only reads.
 */

/** The option of a choice question that stands for "the conversation shows none of the values". */
export const NOT_SHOWN = 'not_shown';

export type YesNoQuestion = {
  /** The key the answer comes back under: the id of the variable. */
  name: string;
  kind: 'yesno';
  text: string;
  /** The value yes stands for. */
  yes: string;
  /** The value no stands for: a yes or no question belongs to a variable with exactly two values. */
  no: string;
};

export type ChoiceQuestion = {
  name: string;
  kind: 'choice';
  text: string;
  /** One option per value of the variable, then NOT_SHOWN. The description is the title of the value. */
  options: ReadonlyArray<{ id: string; description: string }>;
};

export type ReaderQuestion = YesNoQuestion | ChoiceQuestion;

/** The answer to a yes or no question: the probability of yes. To a choice question: a probability per option id. */
export type ReaderAnswer = { yes: number } | { probabilities: Readonly<Record<string, number>> };

export interface ConversationReader {
  /** A label for reports, such as `jev`. */
  readonly id: string;
  /** The model family, such as jev or anthropic. */
  readonly family: string;
  readonly model?: string;
  /**
   * Reads one conversation and answers the questions it can, keyed by `name`. A question left out counts as
   * unread. Throw when the conversation could not be read at all. An error message must not quote the
   * conversation: the feed keeps only that a read failed.
   */
  read(
    conversation: string,
    questions: readonly ReaderQuestion[],
  ): Promise<Readonly<Record<string, ReaderAnswer | undefined>>>;
}

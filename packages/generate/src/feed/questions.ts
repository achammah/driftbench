import type { VariableStore } from '@agent-nexus/driftbench-space';
import { type ChoiceQuestion, NOT_SHOWN, type ReaderQuestion, type YesNoQuestion } from './reader';

type Variable = VariableStore['variables'][number];

/**
 * The question a variable puts to a conversation. A variable with two values gets one yes or no question,
 * about its first value: yes is the first value, no the second. A variable with three or more gets one
 * choice question, with an option for each value and one for "none of them". A variable with one value
 * gets none: a single value carries no share to read.
 *
 * The wording uses only the title of the variable and the titles of its values, which come from the agent's
 * own files. No conversation text is ever part of a question.
 */
export function questionFor(variable: Variable): ReaderQuestion | undefined {
  const [first, second] = variable.values;
  if (first === undefined || second === undefined) return undefined;
  if (variable.values.some((value) => value.id === NOT_SHOWN)) {
    throw new RangeError(`variable ${variable.id} has a value called ${NOT_SHOWN}, which the feed reserves`);
  }
  if (variable.values.length === 2) {
    const question: YesNoQuestion = {
      name: variable.id,
      kind: 'yesno',
      text: `In this conversation, what is true of: ${variable.title}? Does the conversation show this: ${first.title}? Answer yes only when the conversation itself shows it.`,
      yes: first.id,
      no: second.id,
    };
    return question;
  }
  const question: ChoiceQuestion = {
    name: variable.id,
    kind: 'choice',
    text: `In this conversation, what is true of: ${variable.title}? Choose the option the conversation itself shows.`,
    options: [
      ...variable.values.map((value) => ({ id: value.id, description: value.title })),
      { id: NOT_SHOWN, description: 'the conversation shows none of the other options' },
    ],
  };
  return question;
}

/** The questions for the variables a feed reads, in the order of the store. */
export function questionsFor(store: VariableStore, only?: readonly string[]): ReaderQuestion[] {
  const wanted = only === undefined ? undefined : new Set(only);
  if (wanted !== undefined) {
    for (const id of wanted) {
      if (!store.variables.some((variable) => variable.id === id)) {
        throw new RangeError(`the store has no variable ${id}`);
      }
    }
  }
  const out: ReaderQuestion[] = [];
  for (const variable of store.variables) {
    if (wanted !== undefined && !wanted.has(variable.id)) continue;
    const question = questionFor(variable);
    if (question !== undefined) out.push(question);
  }
  return out;
}

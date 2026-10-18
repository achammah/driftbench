import { type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
import { mulberry32 } from '@agent-nexus/driftbench-stats';
import type { ConversationReader, ReaderAnswer, ReaderQuestion } from '../../src/feed';

/** The variables of the fixture, with the population mix the tests must recover. All of it is fictional. */
export const FIXTURE_VARIABLES = [
  {
    id: 'session_state',
    title: 'whether the person has used the service before',
    kind: 'stage' as const,
    values: [
      { id: 'first_time', title: 'a first-time user', mix: 0.65 },
      { id: 'returning', title: 'a returning user', mix: 0.35 },
    ],
  },
  {
    id: 'channel',
    title: 'the channel the conversation happens on',
    kind: 'channel' as const,
    values: [
      { id: 'web_chat', title: 'the web chat', mix: 0.4 },
      { id: 'whatsapp', title: 'WhatsApp', mix: 0.3 },
      { id: 'email', title: 'email', mix: 0.2 },
      { id: 'phone', title: 'the phone', mix: 0.1 },
    ],
  },
  {
    id: 'shipment_state',
    title: 'where the parcel is',
    kind: 'data' as const,
    values: [
      { id: 'on_time', title: 'the parcel is on time', mix: 0.55 },
      { id: 'late', title: 'the parcel is late', mix: 0.3 },
      { id: 'lost', title: 'the parcel is lost', mix: 0.15 },
    ],
  },
  {
    id: 'customer_mood',
    title: 'how the customer feels',
    kind: 'persona' as const,
    values: [
      { id: 'calm', title: 'a calm customer', mix: 0.7 },
      { id: 'upset', title: 'an upset customer', mix: 0.3 },
    ],
  },
];

export type Truth = Record<string, string>;

/** The variable of a store, by id; throws when it is not there. */
export function variableOf(store: VariableStore, id: string): VariableStore['variables'][number] {
  const found = store.variables.find((variable) => variable.id === id);
  if (!found) throw new Error(`no variable ${id}`);
  return found;
}

/** A store with the fixture variables, no weights, no provenance. */
export function fixtureStore(): VariableStore {
  const result = validateVariableStore({
    format: 1,
    agent: 'fixture-agent',
    version: '1',
    variables: FIXTURE_VARIABLES.map((variable) => ({
      id: variable.id,
      title: variable.title,
      kind: variable.kind,
      role: 'axis',
      approved: true,
      values: variable.values.map((value) => ({ id: value.id, title: value.title })),
    })),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.store;
}

const SENTENCES: Record<string, string[]> = {
  first_time: ['This is my first time writing to you.', 'I have never used this service before.'],
  returning: ['I wrote to you last month about another order.', 'I am a regular, I use this service often.'],
  web_chat: ['(typed in the chat window on the site)', '(chat widget)'],
  whatsapp: ['(sent by WhatsApp)', '(WhatsApp message)'],
  email: ['(email, subject: my order)', '(sent by email)'],
  phone: ['(transcript of a phone call)', '(spoken on the phone)'],
  on_time: ['My parcel is moving as planned.', 'The tracking says delivery tomorrow, as promised.'],
  late: ['My parcel is three days past its date.', 'The parcel should have come on Monday and has not.'],
  lost: ['The parcel never reached me and tracking has stopped.', 'Nobody can find my parcel anywhere.'],
  calm: ['Thank you, no rush at all.', 'Whenever you have a moment, please.'],
  upset: ['This is unacceptable, I am furious.', 'I am very angry about this, fix it now.'],
};

const FILLER = [
  'Hello.',
  'Could you check this for me?',
  'Please give me the order number you have.',
  'Noted, thanks.',
];

/** Fictional conversations, and the truth about each one, kept by text so a test reader can look it up. */
export class Population {
  readonly truth = new Map<string, Truth>();
  private counter = 0;
  private readonly rng: () => number;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  /** One conversation. `forced` fixes the value of some variables; the others follow the fixture mix. */
  conversation(forced: Truth = {}): { text: string; truth: Truth } {
    const truth: Truth = {};
    const lines = [`Case ${this.counter++} PRIVATE-MARKER-${Math.floor(this.rng() * 1e9)}`];
    for (const variable of FIXTURE_VARIABLES) {
      const value = forced[variable.id] ?? this.draw(variable.values);
      truth[variable.id] = value;
      const bank = SENTENCES[value] as string[];
      lines.push(FILLER[Math.floor(this.rng() * FILLER.length)] as string);
      lines.push(bank[Math.floor(this.rng() * bank.length)] as string);
    }
    const text = lines.join('\n');
    this.truth.set(text, truth);
    return { text, truth };
  }

  private draw(values: ReadonlyArray<{ id: string; mix: number }>): string {
    let u = this.rng();
    for (const value of values) {
      u -= value.mix;
      if (u < 0) return value.id;
    }
    return (values.at(-1) as { id: string }).id;
  }
}

export type SimulatedReaderSpec = {
  /** The chance of a decided, correct answer per true value; a number is the same for all. */
  accuracy: number | Record<string, number>;
  /** The chance of an answer in the unsure band. */
  unsure: number;
  /** A wrong answer goes to the next value of the variable (always the same one): asymmetric, so it biases the shares. */
  seed: number;
};

const fnv = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

/**
 * A test reader that knows the truth and errs at a set rate. Its error for a given conversation and question
 * depends only on them and on the seed, never on the order of the calls.
 */
export function simulatedReader(population: Population, spec: SimulatedReaderSpec): ConversationReader {
  return {
    id: 'simulated',
    family: 'test',
    async read(conversation, questions) {
      const truth = population.truth.get(conversation);
      if (truth === undefined) throw new Error('the simulated reader does not know this conversation');
      const out: Record<string, ReaderAnswer | undefined> = {};
      for (const question of questions) {
        const rng = mulberry32(fnv(`${spec.seed}|${question.name}|${conversation}`));
        out[question.name] = answer(question, truth[question.name] as string, spec, rng());
      }
      return out;
    },
  };
}

function answer(question: ReaderQuestion, truth: string, spec: SimulatedReaderSpec, u: number): ReaderAnswer {
  const accuracy = typeof spec.accuracy === 'number' ? spec.accuracy : (spec.accuracy[truth] ?? 1);
  const ids =
    question.kind === 'yesno' ? [question.yes, question.no] : question.options.map((option) => option.id);
  const trueIndex = ids.indexOf(truth);
  let decided: number | 'unsure';
  if (u < spec.unsure) decided = 'unsure';
  else if ((u - spec.unsure) / (1 - spec.unsure) < accuracy) decided = trueIndex;
  else decided = (trueIndex + 1) % (question.kind === 'yesno' ? 2 : ids.length - 1);
  if (question.kind === 'yesno') {
    if (decided === 'unsure') return { yes: 0.5 };
    return { yes: decided === 0 ? 0.92 : 0.08 };
  }
  const probabilities: Record<string, number> = {};
  for (const [i, id] of ids.entries()) {
    probabilities[id] =
      decided === 'unsure' ? 1 / ids.length - 0.001 : decided === i ? 0.82 : 0.18 / (ids.length - 1);
  }
  return { probabilities };
}

import {
  askedLabels,
  denseOpinions,
  type Labeler,
  type Labelled,
  type LabelSet,
  parseLabelSets,
  questionKey,
  type Window,
  yesNoOpinions,
} from '../../src/pointer';

/** Reads label sets written in a test; a bad set is a failing test. */
export function load(text: string): LabelSet[] {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

type Options = { id?: string; fail?: (window: Window) => Error | undefined; delay?: number };

/** A system 2 labeler that answers from a table of its own, and keeps a log of the windows it was asked about. */
export function plantedDense(
  answer: (window: Window, set: LabelSet) => Labelled[],
  log: string[] = [],
  options: Options = {},
): Labeler {
  const id = options.id ?? 'planted';
  return {
    id,
    cls: 'system2',
    family: 'planted',
    model: 'planted-1',
    settings: {},
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: id,
      body: { set: set.set, window: window.id, units: window.units.map((unit) => unit.text) },
    }),
    opinions: denseOpinions,
    async call(_wire, set, window) {
      log.push(`${window.id}:${set.set}`);
      if (options.delay) await new Promise((done) => setTimeout(done, options.delay));
      const failure = options.fail?.(window);
      if (failure) throw failure;
      return {
        labels: answer(window, set),
        returnedModel: 'planted-1',
        stopReason: 'end_turn',
        usage: { input: 10, output: 4 },
      };
    },
  };
}

/** A system 1 labeler that gives a probability of yes per unit and label from a table of its own. */
export function plantedYesNo(
  chances: (unit: { n: number; text: string }, set: LabelSet) => Record<string, number>,
  log: string[] = [],
  options: Options & { threshold?: number } = {},
): Labeler {
  const id = options.id ?? 'planted-p';
  const threshold = options.threshold ?? 0.4;
  return {
    id,
    cls: 'system1',
    family: 'planted',
    model: 'planted-p1',
    settings: { threshold },
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: id,
      body: { set: set.set, window: window.id, units: window.units.map((unit) => unit.text) },
    }),
    opinions: (answer, set, window) => yesNoOpinions(answer, window, askedLabels(set, true), threshold),
    async call(_wire, set, window) {
      log.push(`${window.id}:${set.set}`);
      if (options.delay) await new Promise((done) => setTimeout(done, options.delay));
      const failure = options.fail?.(window);
      if (failure) throw failure;
      const probabilities: Record<string, number> = {};
      for (const unit of window.units) {
        const row = chances(unit, set);
        for (const label of askedLabels(set, true)) {
          probabilities[questionKey(unit.n, label.name)] = row[label.name] ?? 0;
        }
      }
      return {
        probabilities,
        returnedModel: 'planted-p1',
        stopReason: 'answered',
        usage: { input: 20, output: 0 },
      };
    },
  };
}

/** The label set of a bakery's counter notes, written for tests. */
export const BAKERY = `labels:
  - set: counter-voice
    description: How the counter notes of a bakery are worded.
    labels:
      - name: greeting
        description: A unit that fixes how a customer is welcomed.
      - name: price-claim
        description: A unit that states what a loaf costs.
      - name: allergen-line
        description: A unit that must appear word for word.
        examples: ["Allergen details are on the label."]
`;

/** A window of `count` units whose text wraps over two lines. */
export function windowOf(count: number): Window {
  return {
    id: 'notes.md#1',
    path: 'notes.md',
    headingPath: ['Counter', 'Mornings'],
    units: Array.from({ length: count }, (_, at) => ({
      n: at + 1,
      text: `Line ${at + 1}\nwrapped`,
      index: at,
    })),
  };
}

export type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** A fetch that answers every request with one reply and keeps what it was sent. */
export function fakeFetch(reply: unknown, calls: Call[] = [], status = 200) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

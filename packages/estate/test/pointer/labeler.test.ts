import { ModelError } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import {
  AGENT_RULES_SET,
  createHaikuLabeler,
  createJevLabeler,
  DENSE_SYSTEM,
  denseUser,
  LabelerConfigError,
  LabelerError,
  type LabelSet,
  labelerByName,
  parseDenseAnswer,
  parseLabelSets,
  questionKey,
  type Window,
} from '../../src/pointer';

const load = (text: string): LabelSet[] => {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
};

const BAKERY = `labels:
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
const [BAKE] = load(BAKERY) as [LabelSet];
const [RULES] = load(AGENT_RULES_SET) as [LabelSet];

const window = (count: number): Window => ({
  id: 'notes.md#1',
  path: 'notes.md',
  headingPath: ['Counter', 'Mornings'],
  units: Array.from({ length: count }, (_, at) => ({
    n: at + 1,
    text: `Line ${at + 1}\nwrapped`,
    index: at,
  })),
});

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function fakeFetch(reply: unknown, calls: Call[] = [], status = 200) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  };
}

describe('the dense request', () => {
  it('builds from the set alone: the fixed text names no estate word and no bakery word', () => {
    const forbidden =
      /estate|agent|skill|nexus|claude|driftbench|helper|prompt|rule|gate|instruction|bakery|email/i;
    // The system text and the user text outside the set lines are the same for two unlike sets.
    const outside = (set: LabelSet) =>
      denseUser(set, window(2))
        .split('\n')
        .filter((line) => /^(WINDOW|\[)/.test(line))
        .join('\n');
    expect(DENSE_SYSTEM).not.toMatch(forbidden);
    expect(outside(BAKE)).toBe(outside(RULES));
    expect(outside(BAKE)).not.toMatch(forbidden);
  });

  it('numbers the units, flattens their wrapped lines and gives the heading path', () => {
    const text = denseUser(BAKE, window(2));
    expect(text).toContain('WINDOW notes.md#1  path: Counter > Mornings');
    expect(text).toContain('[1] Line 1 wrapped\n[2] Line 2 wrapped');
    expect(text).toContain(
      '- allergen-line: A unit that must appear word for word. Examples: "Allergen details are on the label."',
    );
    expect(text).toContain('- none: no label of this set applies.');
  });

  it('is the same bytes for the same set and window', () => {
    const labeler = createHaikuLabeler();
    expect(labeler.render(BAKE, window(3))).toEqual(labeler.render(BAKE, window(3)));
    expect(labeler.render(BAKE, window(3))).not.toEqual(labeler.render(RULES, window(3)));
  });
});

describe('reading a dense answer', () => {
  const good = '{"labels":[{"units":"1-2","label":"greeting"}]}';

  it('reads JSON, in one code fence or bare', () => {
    expect(parseDenseAnswer(good)).toEqual([{ units: '1-2', label: 'greeting' }]);
    expect(parseDenseAnswer(`\`\`\`json\n${good}\n\`\`\``)).toHaveLength(1);
  });

  it('refuses text that is not JSON, a missing list, and an entry without units or label', () => {
    expect(() => parseDenseAnswer('Sure! Here you go')).toThrow(LabelerError);
    expect(() => parseDenseAnswer('{"window":"notes.md#1"}')).toThrow(/no labels list/);
    expect(() => parseDenseAnswer('{"labels":[{"label":"greeting"}]}')).toThrow(/not \{units, label\}/);
  });
});

describe('the Haiku labeler', () => {
  const reply = (text: string, stop = 'end_turn') => ({
    model: 'claude-haiku-5-5',
    stop_reason: stop,
    content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text },
    ],
    usage: { input_tokens: 120, output_tokens: 18 },
  });
  const answer = '{"labels":[{"units":"1","label":"greeting"},{"units":"2","label":"none"}]}';

  it('posts the rendered request with the key in a header, reads the text block, and records the usage', async () => {
    const calls: Call[] = [];
    const labeler = createHaikuLabeler({ key: 'k-secret', fetch: fakeFetch(reply(answer), calls) });
    const wire = labeler.render(BAKE, window(2));
    const recorded = await labeler.call?.(wire, BAKE, window(2));
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.headers['x-api-key']).toBe('k-secret');
    expect(calls[0]?.body).toEqual(wire.body);
    expect(recorded).toEqual({
      labels: [
        { units: '1', label: 'greeting' },
        { units: '2', label: 'none' },
      ],
      returnedModel: 'claude-haiku-5-5',
      stopReason: 'end_turn',
      usage: { input: 120, output: 18 },
    });
  });

  it('has no call without a key, so it can only replay', () => {
    expect(createHaikuLabeler().call).toBeUndefined();
    expect(labelerByName('haiku', { record: false, env: { ANTHROPIC_API_KEY: 'k' } })?.call).toBeUndefined();
    expect(labelerByName('haiku', { record: true, env: { ANTHROPIC_API_KEY: 'k' } })?.call).toBeDefined();
  });

  it('fails on a cut answer and on a refusal, without the key in the message', async () => {
    const cut = createHaikuLabeler({ key: 'k-secret', fetch: fakeFetch(reply(answer, 'max_tokens')) });
    await expect(cut.call?.(cut.render(BAKE, window(2)), BAKE, window(2))).rejects.toThrow(
      /stopped at max_tokens/,
    );
    const refused = createHaikuLabeler({ key: 'k-secret', fetch: fakeFetch(reply('', 'refusal')) });
    const error = await refused
      .call?.(refused.render(BAKE, window(2)), BAKE, window(2))
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ModelError);
    expect(String((error as Error).message)).not.toContain('k-secret');
  });

  it('never carries the key in an HTTP error', async () => {
    const down = createHaikuLabeler({
      key: 'k-secret',
      fetch: fakeFetch({ error: { type: 'authentication_error', message: 'bad key' } }, [], 401),
      maxRetries: 0,
    });
    const error = await down
      .call?.(down.render(BAKE, window(1)), BAKE, window(1))
      .catch((cause: unknown) => cause);
    expect(String((error as Error).message)).toContain('authentication_error');
    expect(String((error as Error).message)).not.toContain('k-secret');
  });
});

describe('the Jev labeler', () => {
  it('asks one yes or no question per unit and label, keyed u<n>__<label>, in one request per window', () => {
    const labeler = createJevLabeler({ env: {}, replayOnly: true });
    const wire = labeler.render(BAKE, window(4));
    const questions = wire.body.questions as Record<string, { type: string }>;
    expect(Object.keys(questions)).toHaveLength(4 * 3);
    expect(questions[questionKey(2, 'price-claim')]?.type).toBe('noul');
    expect(wire.body.state).toMatchObject({ set: 'counter-voice', window: 'notes.md#1' });
    expect(JSON.stringify(wire.body.state)).toContain('[4] Line 4 wrapped');
  });

  it('cuts a window only when units times labels pass the question cap', () => {
    const labeler = createJevLabeler({ env: {}, maxQuestions: 100, replayOnly: true });
    expect(labeler.maxUnits(BAKE, 60)).toBe(33);
    expect(labeler.maxUnits(BAKE, 10)).toBe(10);
    expect(createJevLabeler({ env: {}, maxQuestions: 2, replayOnly: true }).maxUnits(BAKE, 60)).toBe(1);
  });

  it('labels one unit per request in the unit arm', () => {
    const labeler = createJevLabeler({ env: {}, state: 'unit', replayOnly: true });
    expect(labeler.id).toBe('jev-unit');
    expect(labeler.maxUnits(BAKE, 60)).toBe(1);
    expect(labeler.render(BAKE, window(1)).labeler).toBe('jev-unit');
  });

  it('refuses a set whose label needs a target: a yes or no model names none', () => {
    const target = load(`${BAKERY}        target: required\n`)[0] as LabelSet;
    const labeler = createJevLabeler({ env: {}, replayOnly: true });
    expect(() => labeler.render(target, window(2))).toThrow(LabelerConfigError);
  });

  it('takes the label with the highest probability at or above the threshold, else none', () => {
    const probabilities = {
      [questionKey(1, 'greeting')]: 0.9,
      [questionKey(1, 'price-claim')]: 0.2,
      [questionKey(1, 'allergen-line')]: 0.1,
      [questionKey(2, 'greeting')]: 0.4,
      [questionKey(2, 'price-claim')]: 0.45,
      [questionKey(2, 'allergen-line')]: 0.1,
    };
    const recorded = {
      probabilities,
      returnedModel: 'jev',
      stopReason: 'answered',
      usage: { input: 0, output: 0 },
    };
    const strict = createJevLabeler({ env: {}, replayOnly: true, threshold: 0.5 });
    expect(strict.interpret(recorded, BAKE, window(2))).toEqual([
      { units: '1', label: 'greeting' },
      { units: '2', label: 'none' },
    ]);
    // A lower threshold reads the same recording without a new call.
    const loose = createJevLabeler({ env: {}, replayOnly: true, threshold: 0.4 });
    expect(loose.interpret(recorded, BAKE, window(2))[1]).toEqual({ units: '2', label: 'price-claim' });
  });

  it('leaves a unit out of the answer when one of its questions has no probability', () => {
    const recorded = {
      probabilities: { [questionKey(1, 'greeting')]: 0.9 },
      returnedModel: 'jev',
      stopReason: 'answered',
      usage: { input: 0, output: 0 },
    };
    expect(createJevLabeler({ env: {}, replayOnly: true }).interpret(recorded, BAKE, window(1))).toEqual([]);
  });

  it('posts the batch to the gateway with its key header and records the probabilities', async () => {
    const calls: Call[] = [];
    const labeler = createJevLabeler({
      env: { JEV_API_KEY: 'k-secret', JEV_ROUTE: 'gateway', JEV_MODEL: 'jev-test' },
      fetch: fakeFetch(
        { model: 'jev-test', answers: { [questionKey(1, 'greeting')]: { noul: 0.8 }, odd: { noul: 3 } } },
        calls,
      ),
    });
    const wire = labeler.render(BAKE, window(1));
    const recorded = await labeler.call?.(wire, BAKE, window(1));
    expect(calls[0]?.url).toBe('https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone');
    expect(calls[0]?.headers['api-key']).toBe('k-secret');
    expect(calls[0]?.body.model).toBe('jev-test');
    expect(recorded?.probabilities).toEqual({ [questionKey(1, 'greeting')]: 0.8 });
  });

  it('has no call without a key or a route', () => {
    expect(createJevLabeler({ env: {} }).call).toBeUndefined();
    expect(createJevLabeler({ env: { JEV_API_KEY: 'k' } }).call).toBeUndefined();
  });
});

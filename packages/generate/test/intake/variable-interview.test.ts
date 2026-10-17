import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadVariableStore, type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  interviewVariables,
  parseVariableRecording,
  replayAsker,
  type VariableAsker,
  type VariableQuestion,
} from '../../src/intake';

const FOLDER = fileURLToPath(new URL('../../../../examples/variables/interview/', import.meta.url));
const NOW = () => new Date('2026-10-18T09:00:00Z');

let start: VariableStore;
beforeAll(async () => {
  const loaded = await loadVariableStore(`${FOLDER}start.yaml`);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  start = loaded.store;
});

type Call = { key: string; refusal: string | undefined; attempt: number };

/**
 * An asker that gives the listed answers for a question, in order, and a default for any other: no value
 * missing, no pair, no weights. The calls it receives are kept.
 */
function scripted(answers: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(answers).map(([key, list]) => [key, [...list]]));
  const asker: VariableAsker = (question: VariableQuestion, refusal, attempt) => {
    calls.push({ key: question.key, refusal, attempt });
    const next = queues.get(question.key)?.shift();
    if (next !== undefined) return next;
    if (question.kind === 'values') return { none: true };
    if (question.kind === 'pair') return { done: true };
    return { skip: true };
  };
  return { asker, calls };
}

const words = (text: string) => ({ words: text });
const pair = (forbid: Record<string, string>, reason = 'They never meet.') => ({
  forbid,
  reason,
  ...words('The owner says so.'),
});

/** Runs an interview and returns the refusals of one question, in order. */
async function refusalsOf(key: string, answers: unknown[], from: VariableStore = start) {
  const { asker } = scripted({ [key]: answers });
  const result = await interviewVariables(from, asker, { now: NOW });
  return { result, refusals: result.transcript.filter((e) => e.question === key && e.reason !== undefined) };
}

describe('the replayed interview', () => {
  it('fills the fixture store with the owner’s words, and the store validates', async () => {
    const parsed = parseVariableRecording(await readFile(`${FOLDER}answers.yaml`, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    const asker = replayAsker(parsed.recording);
    const result = await interviewVariables(start, asker, { now: NOW });
    if (!result.ok) throw new Error(result.reason);

    expect(validateVariableStore(result.store).ok).toBe(true);
    expect(asker.unused()).toEqual([]);
    expect(result.added).toEqual({ values: 1, constraints: 1, weighted: 5 });

    const channel = result.store.variables[0];
    expect(channel?.values.map((v) => [v.id, v.weight])).toEqual([
      ['web', 0.6],
      ['phone', 0.3],
      ['kiosk', 0.1],
    ]);
    const kiosk = channel?.values[2];
    expect(kiosk).toMatchObject({ produced_by: 'owner', approved: true });
    expect(kiosk?.provenance).toEqual([
      { kind: 'owner', words: 'Some customers book at the kiosk in the shop.', date: '2026-10-18' },
      { kind: 'owner', words: 'Six in ten web, three in ten phone, one in ten kiosk.', date: '2026-10-18' },
    ]);
    expect(result.store.constraints).toEqual([
      {
        forbid: { channel: 'kiosk', pickup_slot: 'evening' },
        reason: 'The kiosk has no evening pickup, because the shop closes at six.',
        approved: true,
        produced_by: 'owner',
        provenance: [
          {
            kind: 'owner',
            words: 'The kiosk is only in the shop and the shop closes at six.',
            date: '2026-10-18',
          },
        ],
      },
    ]);
    // The variable the owner skipped keeps no weight; the one they answered has them.
    expect(result.store.variables[2]?.values.every((v) => v.weight === undefined)).toBe(true);
  });

  it('asks again after each wrong answer, with the reason, and says so in the transcript', async () => {
    const parsed = parseVariableRecording(await readFile(`${FOLDER}answers.yaml`, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    const result = await interviewVariables(start, replayAsker(parsed.recording), { now: NOW });
    expect(
      result.transcript.filter((e) => e.outcome === 'refused').map((e) => [e.question, e.attempt]),
    ).toEqual([
      ['values:channel', 1],
      ['pair:1', 1],
      ['pair:2', 1],
      ['weights:channel', 1],
      ['weights:channel', 2],
    ]);
    expect(result.transcript.filter((e) => e.outcome === 'gave-up')).toEqual([]);
  });

  it('does not change the store it starts from', async () => {
    const before = structuredClone(start);
    const parsed = parseVariableRecording(await readFile(`${FOLDER}answers.yaml`, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    await interviewVariables(start, replayAsker(parsed.recording), { now: NOW });
    expect(start).toEqual(before);
  });

  it('fails when the recording has no answer left for a question', async () => {
    const parsed = parseVariableRecording('version: 1\nanswers: []\n');
    if (!parsed.ok) throw new Error(parsed.error);
    const result = await interviewVariables(start, replayAsker(parsed.recording), { now: NOW });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('the recording has no answer left for values:channel');
  });

  it('names the recorded answers a run never used', () => {
    const parsed = parseVariableRecording(
      'version: 1\nanswers:\n  - { question: values:channel, answer: { none: true } }\n  - { question: pair:9, answer: { done: true } }\n',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const asker = replayAsker(parsed.recording);
    asker({ key: 'values:channel', kind: 'values', variable: 'channel', title: '', has: [] }, undefined, 1);
    expect(asker.unused()).toEqual(['pair:9']);
  });

  it('refuses a recording that is not one', () => {
    expect(parseVariableRecording('version: 2\nanswers: []\n').ok).toBe(false);
    expect(parseVariableRecording('version: 1\nanswers: []\nextra: 1\n').ok).toBe(false);
    expect(parseVariableRecording('answers: [').ok).toBe(false);
  });
});

describe('the values question', () => {
  const VALUES = 'values:channel';
  const one = (id: string, title = 'A title') => ({
    values: [{ id, title, ...words('Said by the owner.') }],
  });

  it('asks again for a value the variable already has', async () => {
    const { refusals } = await refusalsOf(VALUES, [one('web'), one('kiosk')]);
    expect(refusals.map((e) => e.reason)).toEqual(['"web" is already a value of "channel"']);
  });

  it('asks again for the same new value written twice in one answer', async () => {
    const twice = { values: [...one('kiosk').values, ...one('kiosk').values] };
    const { refusals } = await refusalsOf(VALUES, [twice, one('kiosk')]);
    expect(refusals.map((e) => e.reason)).toEqual(['"kiosk" is already a value of "channel"']);
  });

  it('asks again for an id that is not an id', async () => {
    const { refusals } = await refusalsOf(VALUES, [one('a kiosk'), one('kiosk')]);
    expect(refusals[0]?.reason).toContain('"a kiosk" is not a value id');
  });

  it('asks again for a value with no title and for owner words that are blank', async () => {
    const { refusals } = await refusalsOf(VALUES, [
      one('kiosk', ' '),
      { values: [{ id: 'kiosk', title: 'Kiosk', words: ' ' }] },
      one('kiosk'),
    ]);
    expect(refusals.map((e) => e.reason)).toEqual([
      'the value "kiosk" has no title',
      "the answer does not have the shape asked for (values.0.words): the owner's words are missing",
    ]);
  });

  it('asks again for an empty list and for an answer of another shape', async () => {
    const { refusals } = await refusalsOf(VALUES, [{ values: [] }, { value: 'kiosk' }, { none: true }]);
    expect(refusals).toHaveLength(2);
    expect(refusals.every((e) => e.reason?.startsWith('the answer does not have the shape asked for'))).toBe(
      true,
    );
  });

  it('gives a value the owner’s words, the owner as author, and the day', async () => {
    const { asker } = scripted({ 'values:garment': [one('parka', 'Parkas')] });
    const result = await interviewVariables(start, asker, { now: NOW });
    const added = result.ok ? result.store.variables[1]?.values.at(-1) : undefined;
    expect(added).toEqual({
      id: 'parka',
      title: 'Parkas',
      approved: true,
      produced_by: 'owner',
      provenance: [{ kind: 'owner', words: 'Said by the owner.', date: '2026-10-18' }],
    });
  });
});

describe('the pair question', () => {
  const PAIR = 'pair:1';
  const good = pair({ channel: 'phone', pickup_slot: 'evening' });
  const reasons = async (answers: unknown[], from?: VariableStore) =>
    (await refusalsOf(PAIR, [...answers, good], from)).refusals.map((e) => e.reason);

  it('asks again for a variable the store lacks', async () => {
    expect(await reasons([pair({ channel: 'phone', mood: 'calm' })])).toEqual([
      'the store has no variable "mood"',
    ]);
  });

  it('asks again for a value the variable lacks', async () => {
    expect(await reasons([pair({ channel: 'phone', garment: 'parka' })])).toEqual([
      '"garment" has no value "parka"',
    ]);
  });

  it('accepts a value the interview added a moment ago', async () => {
    const { asker } = scripted({
      'values:garment': [{ values: [{ id: 'parka', title: 'Parkas', ...words('Parkas exist.') }] }],
      [PAIR]: [pair({ channel: 'phone', garment: 'parka' })],
    });
    const result = await interviewVariables(start, asker, { now: NOW });
    expect(result.ok && result.store.constraints[0]?.forbid).toEqual({ channel: 'phone', garment: 'parka' });
  });

  it('asks again for one value alone: a pair names two variables', async () => {
    expect(await reasons([pair({ channel: 'phone' })])).toEqual([
      'a pair names a value of two variables: give at least two',
    ]);
  });

  it('asks again for a reason that is blank', async () => {
    expect(await reasons([pair({ channel: 'web', garment: 'coat' }, '  ')])).toEqual([
      'give the reason the values never occur together',
    ]);
  });

  it('asks again for owner words that are blank', async () => {
    const blank = { forbid: { channel: 'web', garment: 'coat' }, reason: 'Never.', words: '' };
    expect((await reasons([blank]))[0]).toContain('the answer does not have the shape asked for');
  });

  it('asks again for a pair the store already rules out, whatever the order of its keys', async () => {
    const ruled = structuredClone(start);
    ruled.constraints.push({
      forbid: { channel: 'phone', pickup_slot: 'evening' },
      reason: 'Nobody phones in the evening.',
      approved: true,
    });
    const same = [good, pair({ pickup_slot: 'evening', channel: 'phone' }), { done: true }];
    const { refusals } = await refusalsOf(PAIR, same, ruled);
    expect(refusals.map((e) => e.reason)).toEqual([
      'already ruled impossible by constraint 0 (Nobody phones in the evening.)',
      'already ruled impossible by constraint 0 (Nobody phones in the evening.)',
    ]);
  });

  it('asks again for a pair the owner gave a moment ago', async () => {
    const { asker, calls } = scripted({ 'pair:1': [good], 'pair:2': [good, { done: true }] });
    const result = await interviewVariables(start, asker, { now: NOW });
    expect(calls.filter((c) => c.key === 'pair:2').map((c) => c.refusal?.slice(0, 31))).toEqual([
      undefined,
      'already ruled impossible by con',
    ]);
    expect(result.ok && result.store.constraints).toHaveLength(1);
  });

  it('asks again for a combination that only repeats a pair already ruled out', async () => {
    const ruled = structuredClone(start);
    ruled.constraints.push({
      forbid: { channel: 'phone', pickup_slot: 'evening' },
      reason: 'No.',
      approved: true,
    });
    const three = pair({ channel: 'phone', pickup_slot: 'evening', garment: 'coat' });
    expect((await reasons([three], ruled))[0]).toContain('already ruled impossible by constraint 0');
  });

  it('asks again for a pair that would leave no possible situation', async () => {
    const small = validate({
      format: 1,
      agent: 'x',
      version: '1',
      variables: [
        {
          id: 'a',
          title: 'A',
          kind: 'data',
          role: 'axis',
          approved: true,
          values: [{ id: 'a1', title: 'A1' }],
        },
        {
          id: 'b',
          title: 'B',
          kind: 'persona',
          role: 'axis',
          approved: true,
          values: [{ id: 'b1', title: 'B1' }],
        },
      ],
    });
    const { refusals } = await refusalsOf(PAIR, [pair({ a: 'a1', b: 'b1' }), { done: true }], small);
    expect(refusals.map((e) => e.reason)).toEqual([
      'that would leave no possible situation: the constraints would forbid every cell',
    ]);
  });

  it('writes an accepted pair as an approved constraint of the owner, with the owner’s words', async () => {
    const { asker } = scripted({ [PAIR]: [{ ...good, reason: ' They never meet. ' }] });
    const result = await interviewVariables(start, asker, { now: NOW });
    expect(result.ok && result.store.constraints).toEqual([
      {
        forbid: { channel: 'phone', pickup_slot: 'evening' },
        reason: 'They never meet.',
        approved: true,
        produced_by: 'owner',
        provenance: [{ kind: 'owner', words: 'The owner says so.', date: '2026-10-18' }],
      },
    ]);
  });
});

describe('the weights question', () => {
  const WEIGHTS = 'weights:garment';
  const good = { weights: { shirt: 0.75, coat: 0.25 }, ...words('Three in four are shirts.') };
  const reasons = async (answers: unknown[], from?: VariableStore) =>
    (await refusalsOf(WEIGHTS, [...answers, good], from)).refusals.map((e) => e.reason);

  it('asks again for weights that do not add up to 1', async () => {
    expect(await reasons([{ weights: { shirt: 0.5, coat: 0.4 }, ...words('Most.') }])).toEqual([
      'the weights add up to 0.9: they must add up to 1',
    ]);
  });

  it('asks again for weights that add up to more than 1', async () => {
    expect(await reasons([{ weights: { shirt: 0.8, coat: 0.8 }, ...words('Most.') }])).toEqual([
      'the weights add up to 1.6: they must add up to 1',
    ]);
  });

  it('accepts weights that add up to 1 within the rounding of a decimal sum', async () => {
    const third = { weights: { shirt: 0.1 + 0.2, coat: 0.7 }, ...words('A little under a third.') };
    const { result } = await refusalsOf(WEIGHTS, [third]);
    expect(result.ok).toBe(true);
  });

  it('asks again for a value the variable lacks', async () => {
    expect(await reasons([{ weights: { shirt: 0.5, coat: 0.25, hat: 0.25 }, ...words('Hats.') }])).toEqual([
      '"garment" has no value "hat"',
    ]);
  });

  it('asks again when a value has no weight', async () => {
    expect(await reasons([{ weights: { shirt: 1 }, ...words('Shirts.') }])).toEqual([
      'give a weight to every value; missing: coat',
    ]);
  });

  it('asks again for a negative weight', async () => {
    expect(await reasons([{ weights: { shirt: 1.5, coat: -0.5 }, ...words('Odd.') }])).toEqual([
      'the weight of "coat" is not a number from 0 up',
    ]);
  });

  it('asks again for owner words that are blank', async () => {
    expect((await reasons([{ weights: { shirt: 0.5, coat: 0.5 }, words: '' }]))[0]).toContain(
      'the answer does not have the shape asked for',
    );
  });

  it('lets the owner skip a variable that has no weights', async () => {
    const { result } = await refusalsOf(WEIGHTS, [{ skip: true }]);
    expect(result.transcript.filter((e) => e.outcome === 'skipped').map((e) => e.question)).toContain(
      WEIGHTS,
    );
    expect(result.ok && result.store.variables[1]?.values.every((v) => v.weight === undefined)).toBe(true);
  });

  it('does not let the owner skip a variable that has weights and got a new value', async () => {
    const { asker } = scripted({
      'values:channel': [{ values: [{ id: 'kiosk', title: 'Kiosk', ...words('Kiosk.') }] }],
      'weights:channel': [
        { skip: true },
        { weights: { web: 0.6, phone: 0.3, kiosk: 0.1 }, ...words('Kiosk is small.') },
      ],
    });
    const result = await interviewVariables(start, asker, { now: NOW });
    expect(result.transcript.filter((e) => e.reason).map((e) => e.reason)).toEqual([
      '"channel" has weights and a new value: give a weight to every value',
    ]);
    expect(result.ok).toBe(true);
  });

  it('fails the interview when a half-weighted variable is never answered', async () => {
    const { asker } = scripted({
      'values:channel': [{ values: [{ id: 'kiosk', title: 'Kiosk', ...words('Kiosk.') }] }],
      'weights:channel': [{ skip: true }, { skip: true }, { skip: true }],
    });
    const result = await interviewVariables(start, asker, { now: NOW });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('VARIABLES_WEIGHT_INCOMPLETE');
  });
});

describe('every question', () => {
  it('hands the refusal and the attempt number to the asker on the next ask', async () => {
    const { asker, calls } = scripted({
      'values:channel': [{ values: [{ id: 'web', title: 'Web', ...words('Web.') }] }, { none: true }],
    });
    await interviewVariables(start, asker, { now: NOW });
    expect(calls.filter((c) => c.key === 'values:channel')).toEqual([
      { key: 'values:channel', refusal: undefined, attempt: 1 },
      { key: 'values:channel', refusal: '"web" is already a value of "channel"', attempt: 2 },
    ]);
  });

  it('gives a question up after the attempts, keeps going, and adds nothing for it', async () => {
    const bad = { values: [{ id: 'web', title: 'Web', ...words('Web.') }] };
    const { asker } = scripted({ 'values:channel': [bad, bad, bad, bad] });
    const result = await interviewVariables(start, asker, { now: NOW, maxAttempts: 3 });
    expect(result.transcript.filter((e) => e.question === 'values:channel').map((e) => e.outcome)).toEqual([
      'refused',
      'refused',
      'gave-up',
    ]);
    expect(result.ok && result.store.variables[0]?.values).toHaveLength(2);
    expect(result.transcript.some((e) => e.question === 'values:garment')).toBe(true);
  });

  it('asks an answer of the wrong shape again, naming where', async () => {
    const { refusals } = await refusalsOf('pair:1', [{ forbid: 'channel' }, { done: true }]);
    expect(refusals[0]?.reason).toBe(
      'the answer does not have the shape asked for (forbid): Invalid input: expected record, received string',
    );
  });

  it('asks the questions in order: values, pairs, weights', async () => {
    const { asker, calls } = scripted({});
    await interviewVariables(start, asker, { now: NOW });
    expect(calls.map((c) => c.key)).toEqual([
      'values:channel',
      'values:garment',
      'values:pickup_slot',
      'pair:1',
      'weights:channel',
      'weights:garment',
      'weights:pickup_slot',
    ]);
  });
});

function validate(raw: unknown): VariableStore {
  const result = validateVariableStore(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.store;
}

describe('ids that are also names of Object.prototype', () => {
  const protoStore = () =>
    validate({
      format: 1,
      agent: 'x',
      version: '1',
      variables: [
        {
          id: 'v',
          title: 'V',
          kind: 'data',
          role: 'axis',
          approved: true,
          values: [
            { id: 'constructor', title: 'A value named like a built-in' },
            { id: 'normal', title: 'A normal value' },
          ],
        },
      ],
    });

  it('asks again for weights that leave out a value named constructor', async () => {
    const { result, refusals } = await refusalsOf(
      'weights:v',
      [
        { weights: { normal: 1 }, ...words('Normal only.') },
        { weights: { constructor: 0.5, normal: 0.5 }, ...words('Half each.') },
      ],
      protoStore(),
    );
    expect(refusals.map((e) => e.reason)).toEqual(['give a weight to every value; missing: constructor']);
    expect(result.ok && result.store.variables[0]?.values.map((v) => [v.id, v.weight])).toEqual([
      ['constructor', 0.5],
      ['normal', 0.5],
    ]);
  });
});

describe('the pair question on a variable that is half weighted', () => {
  it('asks again for a pair that removes the last possible situation, whatever the weights say', async () => {
    const store = validate({
      format: 1,
      agent: 'x',
      version: '1',
      variables: [
        {
          id: 'channel',
          title: 'Channel',
          kind: 'channel',
          role: 'axis',
          approved: true,
          values: [
            { id: 'web', title: 'Web', weight: 0.5 },
            { id: 'phone', title: 'Phone', weight: 0.5 },
          ],
        },
        {
          id: 'slot',
          title: 'Slot',
          kind: 'data',
          role: 'axis',
          approved: true,
          values: [{ id: 'day', title: 'Day' }],
        },
      ],
    });
    const { asker, calls } = scripted({
      'values:channel': [{ values: [{ id: 'kiosk', title: 'Kiosk', ...words('A kiosk.') }] }],
      'pair:1': [pair({ channel: 'web', slot: 'day' })],
      'pair:2': [pair({ channel: 'phone', slot: 'day' })],
      'pair:3': [pair({ channel: 'kiosk', slot: 'day' }), { done: true }],
      'weights:channel': [{ weights: { web: 0.4, phone: 0.4, kiosk: 0.2 }, ...words('Kiosk is small.') }],
    });
    const result = await interviewVariables(store, asker, { now: NOW });
    expect(calls.filter((c) => c.key === 'pair:3').map((c) => c.refusal)).toEqual([
      undefined,
      'that would leave no possible situation: the constraints would forbid every cell',
    ]);
    expect(result.ok && result.store.constraints).toHaveLength(2);
  });
});

describe('the values question and the other variables of the store', () => {
  const axis = (id: string, kind: string, ids: string[], role = 'axis') => ({
    id,
    title: id,
    kind,
    role,
    approved: true,
    values: ids.map((value) => ({ id: value, title: value })),
  });
  const of = (...variables: unknown[]) => validate({ format: 1, agent: 'x', version: '1', variables });
  const add = (id: string) => ({ values: [{ id, title: 'New', ...words('Said by the owner.') }] });

  it('asks again for a value that belongs to another axis of the same kind, and names that variable', async () => {
    const store = of(axis('x', 'data', ['a']), axis('y', 'data', ['b', 'c']));
    const { result, refusals } = await refusalsOf('values:x', [add('c'), add('d')], store);
    expect(refusals.map((e) => e.reason)).toEqual([
      '"c" is already a value of "y", an axis of the same kind: a spec names such a value without its variable, so give it another id',
    ]);
    expect(result.ok && result.store.variables[0]?.values.map((v) => v.id)).toEqual(['a', 'd']);
  });

  it('asks again for a value the interview gave another axis a moment ago', async () => {
    const store = of(axis('x', 'persona', ['a']), axis('y', 'persona', ['b']));
    const { asker, calls } = scripted({ 'values:x': [add('c')], 'values:y': [add('c'), add('e')] });
    const result = await interviewVariables(store, asker, { now: NOW });
    expect(calls.filter((c) => c.key === 'values:y').map((c) => c.refusal?.slice(0, 31))).toEqual([
      undefined,
      '"c" is already a value of "x", ',
    ]);
    expect(result.ok).toBe(true);
  });

  it('accepts the same value in a detail, and the value none in two axes', async () => {
    const store = of(
      axis('x', 'data', ['a']),
      axis('y', 'data', ['b', 'c'], 'detail'),
      axis('z', 'data', ['none']),
    );
    expect((await refusalsOf('values:x', [add('c')], store)).refusals).toEqual([]);
    expect((await refusalsOf('values:x', [add('none')], store)).refusals).toEqual([]);
  });

  it('asks again for a value on a deviation axis that is no deviation class', async () => {
    const store = of(axis('deviation', 'deviation', ['none']));
    const { result, refusals } = await refusalsOf(
      'values:deviation',
      [add('D99_shouting'), add('D4_loose_confirmation')],
      store,
    );
    expect(refusals.map((e) => e.reason)).toEqual([
      '"D99_shouting" is not a deviation class: use D1_off_topic to D12_prompt_extraction, or none',
    ]);
    expect(result.ok).toBe(true);
  });
});

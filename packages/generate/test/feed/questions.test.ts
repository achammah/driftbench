import { describe, expect, it } from 'vitest';
import { decide, NOT_SHOWN, questionFor, questionsFor } from '../../src/feed';
import { fixtureStore, variableOf } from './support';

describe('the questions of a variable', () => {
  const store = fixtureStore();
  const by = (id: string) => variableOf(store, id);

  it('asks one yes or no question about the first value of a variable with two values', () => {
    const q = questionFor(by('session_state'));
    expect(q).toMatchObject({ kind: 'yesno', name: 'session_state', yes: 'first_time', no: 'returning' });
    expect(q?.text).toContain('a first-time user');
    expect(q?.text).toContain('whether the person has used the service before');
  });

  it('asks one choice question for three or more values, with an option for none of them', () => {
    const q = questionFor(by('channel'));
    expect(q?.kind).toBe('choice');
    if (q?.kind !== 'choice') return;
    expect(q.options.map((o) => o.id)).toEqual(['web_chat', 'whatsapp', 'email', 'phone', NOT_SHOWN]);
    expect(q.options[1]?.description).toBe('WhatsApp');
  });

  it('asks nothing about a variable with one value, and refuses a value that takes the reserved name', () => {
    const one = structuredClone(by('channel'));
    one.values = one.values.slice(0, 1);
    expect(questionFor(one)).toBeUndefined();
    const taken = structuredClone(by('channel'));
    const second = taken.values[1];
    if (second) second.id = NOT_SHOWN;
    expect(() => questionFor(taken)).toThrow(/reserves/);
  });

  it('lists the questions in the order of the store, or only the ones asked for', () => {
    expect(questionsFor(store).map((q) => q.name)).toEqual([
      'session_state',
      'channel',
      'shipment_state',
      'customer_mood',
    ]);
    expect(questionsFor(store, ['customer_mood', 'channel']).map((q) => q.name)).toEqual([
      'channel',
      'customer_mood',
    ]);
    expect(() => questionsFor(store, ['nope'])).toThrow(/no variable nope/);
  });
});

describe('a decision from a probability', () => {
  const store = fixtureStore();
  const yesno = questionFor(variableOf(store, 'session_state'));
  const choice = questionFor(variableOf(store, 'channel'));
  if (!yesno || !choice) throw new Error('fixture questions are missing');

  it('turns a yes or no probability into a value, or unsure between the thresholds', () => {
    expect(decide(yesno, { yes: 0.9 })).toEqual({ kind: 'value', value: 'first_time' });
    expect(decide(yesno, { yes: 0.1 })).toEqual({ kind: 'value', value: 'returning' });
    expect(decide(yesno, { yes: 0.5 })).toEqual({ kind: 'unsure' });
    expect(decide(yesno, { yes: 0.75 })).toEqual({ kind: 'value', value: 'first_time' });
    expect(decide(yesno, { yes: 0.25 })).toEqual({ kind: 'value', value: 'returning' });
    expect(decide(yesno, { yes: 0.6 }, { yesAt: 0.6 })).toEqual({ kind: 'value', value: 'first_time' });
  });

  it('takes the top option of a choice when it is likely enough, else unsure, and reads none of them as absent', () => {
    const p = (top: string, mass: number) => ({
      probabilities: Object.fromEntries(
        (choice.kind === 'choice' ? choice.options : []).map((o) => [
          o.id,
          o.id === top ? mass : (1 - mass) / 4,
        ]),
      ),
    });
    expect(decide(choice, p('email', 0.8))).toEqual({ kind: 'value', value: 'email' });
    expect(decide(choice, p('email', 0.4))).toEqual({ kind: 'unsure' });
    expect(decide(choice, p(NOT_SHOWN, 0.9))).toEqual({ kind: 'absent' });
  });

  it('treats a missing, out of range or mismatched answer as unread', () => {
    expect(decide(yesno, undefined)).toEqual({ kind: 'unread' });
    expect(decide(yesno, { yes: 1.2 })).toEqual({ kind: 'unread' });
    expect(decide(yesno, { yes: Number.NaN })).toEqual({ kind: 'unread' });
    expect(decide(yesno, { probabilities: {} })).toEqual({ kind: 'unread' });
    expect(decide(choice, { yes: 0.9 })).toEqual({ kind: 'unread' });
    expect(decide(choice, { probabilities: { email: 0.9 } })).toEqual({ kind: 'unread' });
  });
});

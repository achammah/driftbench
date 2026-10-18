import { describe, expect, it } from 'vitest';
import { createJevReader, questionsFor } from '../../src/feed';
import { fakeFetch, headersOf, json, recordSleep } from '../model/support';
import { fixtureStore } from './support';

const questions = questionsFor(fixtureStore(), ['session_state', 'channel']);
const KEY = 'jev-test-key-0123456789';
const env = { JEV_API_KEY: KEY, JEV_ROUTE: 'typesafe' };

const good = {
  model: 'jev-1.13.0',
  answers: {
    session_state: { type: 'noul', noul: 0.9 },
    channel: {
      type: 'choice',
      choice: 'email',
      confidence: 0.77,
      probabilities: { web_chat: 0.02, whatsapp: 0.01, email: 0.9, phone: 0.02, not_shown: 0.05 },
    },
  },
};

describe('the Jev reader', () => {
  it('sends the conversation once, with a noul question and a choice question, and reads both answers', async () => {
    const { fetch, calls } = fakeFetch(json(good));
    const reader = createJevReader({ env, fetch });
    const out = await reader.read('the conversation text', questions);
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as {
      model: string;
      state: string;
      questions: Record<string, Record<string, unknown>>;
    };
    expect(body.model).toBe('jev-latest');
    expect(body.state).toBe('the conversation text');
    expect(body.questions.session_state).toMatchObject({
      type: 'noul',
      instructions: { question: expect.stringContaining('a first-time user') },
    });
    expect(body.questions.channel).toMatchObject({
      type: 'choice',
      criteria: { web_chat: 'the web chat', whatsapp: 'WhatsApp', not_shown: expect.any(String) },
    });
    expect(out.session_state).toEqual({ yes: 0.9 });
    expect(out.channel).toMatchObject({ probabilities: { email: 0.9 } });
  });

  it('sums the tokens the service reports', async () => {
    const reply = { ...good, usage: { input_tokens: 120, output_tokens: 30 } };
    const { fetch } = fakeFetch(json(reply), json(reply));
    const reader = createJevReader({ env, fetch });
    await reader.read('x', questions);
    await reader.read('y', questions);
    expect(reader.usage()).toEqual({ calls: 2, inputTokens: 240, outputTokens: 60 });
  });

  it('puts the key in a bearer header on the typesafe route and in api-key on the gateway route', async () => {
    const typesafe = fakeFetch(json(good));
    await createJevReader({ env, fetch: typesafe.fetch }).read('x', questions);
    expect(headersOf(typesafe.calls[0])).toMatchObject({ authorization: `Bearer ${KEY}` });
    expect(typesafe.calls[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
    const gateway = fakeFetch(json(good));
    await createJevReader({ env: { JEV_API_KEY: KEY, JEV_ROUTE: 'gateway' }, fetch: gateway.fetch }).read(
      'x',
      questions,
    );
    expect(headersOf(gateway.calls[0])).toMatchObject({ 'api-key': KEY });
    expect(headersOf(gateway.calls[0]).authorization).toBeUndefined();
  });

  it('leaves out an answer it cannot read, so the feed counts it unread', async () => {
    const { fetch } = fakeFetch(
      json({ answers: { session_state: { type: 'noul' }, channel: { type: 'choice', choice: 'email' } } }),
    );
    const out = await createJevReader({ env, fetch }).read('x', questions);
    expect(out.session_state).toBeUndefined();
    expect(out.channel).toBeUndefined();
  });

  it('retries a 503 once and then answers', async () => {
    const { fetch, calls } = fakeFetch(
      json({ detail: { error_type: 'overloaded', message: 'try later' } }, 503),
      json(good),
    );
    const { sleep } = recordSleep();
    const out = await createJevReader({ env, fetch, sleep }).read('x', questions);
    expect(calls).toHaveLength(2);
    expect(out.session_state).toEqual({ yes: 0.9 });
  });

  it('never puts the conversation or the key in an error, even when the service echoes its input', async () => {
    const secret = 'PRIVATE-CONVERSATION-LINE';
    const echo = json(
      {
        detail: [
          { type: 'missing', loc: ['body', 'model'], msg: 'Field required', input: { state: secret } },
        ],
      },
      422,
    );
    const { fetch } = fakeFetch(echo);
    const error = await createJevReader({ env, fetch })
      .read(secret, questions)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(secret);
    expect(String((error as Error).message)).not.toContain(KEY);
    expect(String((error as Error).message)).toContain('422');
    const named = fakeFetch(
      json({ detail: { error_type: 'api_usage_error', message: 'Invalid request.' } }, 400),
    );
    await expect(createJevReader({ env, fetch: named.fetch }).read('x', questions)).rejects.toThrow(
      '400 api_usage_error: Invalid request.',
    );
  });

  it('refuses a conversation longer than it accepts before sending it', async () => {
    const { fetch, calls } = fakeFetch(json(good));
    await expect(
      createJevReader({ env, fetch, maxChars: 10 }).read('x'.repeat(11), questions),
    ).rejects.toThrow(/longer than 10/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a configuration without a key or a route', () => {
    expect(() => createJevReader({ env: { JEV_ROUTE: 'typesafe' } })).toThrow(/JEV_API_KEY/);
    expect(() => createJevReader({ env: { JEV_API_KEY: KEY } })).toThrow(/JEV_ROUTE/);
    expect(() => createJevReader({ env: { JEV_API_KEY: KEY, JEV_ROUTE: 'other' } })).toThrow(
      /gateway or typesafe/,
    );
  });
});

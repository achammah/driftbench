import { describe, expect, it } from 'vitest';
import { createGoogleJudge, createOpenAiJudge } from '../src/clients/chat';
import { createDialectTransport } from '../src/clients/transport';
import { createCouncil } from '../src/council';

// Recorded failure shapes; identifiers and text are fictional.
const empty = {
  openai: {
    choices: [{ message: { content: '' }, finish_reason: 'length' }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8192,
      completion_tokens_details: { reasoning_tokens: 8192 },
    },
  },
  google: {
    candidates: [
      { content: { parts: [{ thought: true, text: 'private reasoning' }] }, finishReason: 'MAX_TOKENS' },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, thoughtsTokenCount: 4092 },
  },
};
const text = '{"checks":[{"id":"polite","reasoning":"A greeting.","evidence":"Hello.","met":true}]}';
const ok = {
  openai: { choices: [{ message: { content: text }, finish_reason: 'stop' }] },
  google: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] },
};
const request = {
  criterion: { name: 'polite', rubric: 'Use a greeting.' },
  transcript: [{ role: 'agent' as const, text: 'Hello.' }],
};
const env = { OPENAI_API_KEY: 'fictional', GEMINI_API_KEY: 'fictional' };
function fixture(provider: keyof typeof empty, repeat = false) {
  // biome-ignore lint/suspicious/noExplicitAny: provider bodies have different wire shapes
  const bodies: Record<string, any>[] = [];
  return {
    bodies,
    fetch: async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(bodies.length === 1 || repeat ? empty[provider] : ok[provider]));
    },
  };
}
for (const provider of ['openai', 'google'] as const) {
  const make = provider === 'openai' ? createOpenAiJudge : createGoogleJudge;
  describe(provider, () => {
    it('recovers one empty length result and records its own grader error', async () => {
      const f = fixture(provider);
      const client = make({ model: 'fictional', env, reasoning: 'medium', fetch: f.fetch });
      const result = await client.judge(request);
      expect(result.answer.outcome).toBe('pass');
      expect(f.bodies).toHaveLength(2);
      expect(result.recovery?.kind).toBe('reasoning-budget-exhausted');
      expect(result.recovery?.attempts).toHaveLength(2);
      const second = f.bodies[1] as Record<string, unknown>;
      expect(
        provider === 'openai'
          ? second.reasoning_effort
          : (second.generationConfig as { thinkingConfig: { thinkingLevel: string } }).thinkingConfig
              .thinkingLevel,
      ).toBe('low');
    });
    it('stops after one recovery and counts a distinct error', async () => {
      const f = fixture(provider, true);
      const client = make({ model: 'fictional', env, reasoning: 'medium', fetch: f.fetch });
      await expect(client.judge(request)).rejects.toMatchObject({
        code: 'reasoning-budget-exhausted',
        retryable: false,
      });
      expect(f.bodies).toHaveLength(2);
    });
    it('uses opt-in answer plus reasoning headroom in the transport', async () => {
      const f = fixture(provider);
      const transport = createDialectTransport({
        provider,
        model: 'fictional',
        env,
        fetch: f.fetch,
        reasoning: 'medium',
        tokenBudget: { answerTokens: 4096, reasoningTokens: 8192 },
      });
      const result = await transport.complete({ system: 'Assess.', user: 'Hello.' });
      expect(result.text).toBe(text);
      expect(result.recovery?.kind).toBe('reasoning-budget-exhausted');
      expect(
        provider === 'openai'
          ? f.bodies[0]?.max_completion_tokens
          : f.bodies[0]?.generationConfig.maxOutputTokens,
      ).toBe(12288);
      expect(result.usage?.output).toBe(provider === 'openai' ? 8192 : 4092);
    });
  });
}
it('counts the recovered error in a council without another re-ask', async () => {
  const f = fixture('openai');
  const client = createOpenAiJudge({ model: 'fictional', env, fetch: f.fetch });
  const result = await createCouncil({ mode: 'llm', size: 1, agentFamily: 'none', judges: [client] }).judge(
    request,
  );
  expect(result.errors).toBe(1);
  expect(result.outcome).toBe('pass');
  expect(f.bodies).toHaveLength(2);
});

it('unset tokenBudget preserves the exact successful transport request and fingerprint', async () => {
  for (const provider of ['openai', 'google'] as const) {
    const bodies: string[] = [];
    const make = (extra = {}) =>
      createDialectTransport({
        provider,
        model: 'fictional',
        env,
        ...extra,
        fetch: async (_url, init) => {
          bodies.push(String(init.body));
          return new Response(JSON.stringify(ok[provider]));
        },
      });
    const a = make(),
      b = make({ tokenBudget: undefined });
    const prompt = { system: 'Assess.', user: 'Hello.' };
    expect((await a.complete(prompt)).fingerprint).toBe((await b.complete(prompt)).fingerprint);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).toBe(
      JSON.stringify(
        provider === 'openai'
          ? {
              model: 'fictional',
              messages: [
                { role: 'system', content: 'Assess.' },
                { role: 'user', content: 'Hello.' },
              ],
              max_completion_tokens: 4096,
            }
          : {
              systemInstruction: { parts: [{ text: 'Assess.' }] },
              contents: [{ role: 'user', parts: [{ text: 'Hello.' }] }],
              generationConfig: { maxOutputTokens: 4096 },
            },
      ),
    );
    expect(make({ tokenBudget: { answerTokens: 4096, reasoningTokens: 8192 } }).fingerprint).not.toBe(
      a.fingerprint,
    );
  }
});
it('uses a numeric Gemini thinking budget only when explicitly requested', async () => {
  const f = fixture('google');
  await createGoogleJudge({
    model: 'fictional',
    env,
    fetch: f.fetch,
    tokenBudget: { answerTokens: 1024, reasoningTokens: 2048, googleThinkingBudget: true },
  }).judge(request);
  expect(f.bodies[0]?.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 });
});
it('rejects unsupported or invalid budget options before network access', () => {
  for (const tokenBudget of [
    { answerTokens: 0, reasoningTokens: 1 },
    { answerTokens: 1, reasoningTokens: -1 },
  ])
    expect(() => createOpenAiJudge({ model: 'fictional', env, tokenBudget })).toThrow(/tokenBudget/);
  expect(() =>
    createDialectTransport({
      provider: 'claude-cli',
      model: 'fictional',
      tokenBudget: { answerTokens: 1, reasoningTokens: 1 },
    }),
  ).toThrow(/tokenBudget/);
});

it('returns cumulative usage, priced cost, request count and retry reason', async () => {
  const f = fixture('openai');
  const result = await createOpenAiJudge({
    model: 'fictional',
    env,
    fetch: async (url, init) => {
      const r = await f.fetch(url, init);
      const p = (await r.json()) as Record<string, unknown>;
      if (f.bodies.length === 2) p.usage = { prompt_tokens: 2, completion_tokens: 4 };
      return new Response(JSON.stringify(p));
    },
    metering: { costOfUsage: (u) => (u.output ?? 0) / 1000000, maxCostUsd: 0.1, maxRetryCostUsd: 0.04 },
  }).judge(request);
  expect(result.requestCount).toBe(2);
  expect(result.reaskReason).toBe('reasoning-budget-exhausted');
  expect(result.costUsd).toBeCloseTo(0.008196);
  expect(result.usage).toEqual({ input: 12, output: 8196 });
});
it('does not send a recovery outside the caller spend cap', async () => {
  const f = fixture('google');
  await expect(
    createDialectTransport({
      provider: 'google',
      model: 'fictional',
      env,
      fetch: f.fetch,
      metering: { costOfUsage: (u) => (u.output ?? 0) / 1000000, maxCostUsd: 0.005, maxRetryCostUsd: 0.004 },
    }).complete({ system: 'Assess.', user: 'Hello.' }),
  ).rejects.toMatchObject({
    code: 'reasoning-budget-exhausted',
    requestCount: 1,
    costUsd: 0.004092,
    recovery: { retrySkipped: 'spend-cap' },
  });
  expect(f.bodies).toHaveLength(1);
});
it('retains the first paid receipt when recovery has a transport failure', async () => {
  let count = 0;
  await expect(
    createOpenAiJudge({
      model: 'fictional',
      env,
      maxRetries: 0,
      fetch: async () => {
        if (count++) throw Error('offline');
        return new Response(JSON.stringify(empty.openai));
      },
    }).judge(request),
  ).rejects.toMatchObject({
    code: 'reasoning-budget-exhausted',
    requestCount: 2,
    recovery: { attempts: [{ usage: { output: 8192 } }] },
  });
});
it('lowers an explicitly configured numeric thinking budget on recovery', async () => {
  const f = fixture('google');
  await createGoogleJudge({
    model: 'fictional',
    env,
    fetch: f.fetch,
    tokenBudget: { answerTokens: 1024, reasoningTokens: 8192, googleThinkingBudget: true },
  }).judge(request);
  expect(f.bodies[1]?.generationConfig.thinkingConfig.thinkingBudget).toBeLessThan(8192);
});
it('recovers the later Gemini thinking exhaustion with a short partial answer', async () => {
  let calls = 0;
  const result = await createGoogleJudge({
    model: 'fictional',
    env,
    reasoning: 'medium',
    fetch: async () =>
      new Response(
        JSON.stringify(
          calls++
            ? ok.google
            : {
                candidates: [{ content: { parts: [{ text: '{"checks":[' }] }, finishReason: 'MAX_TOKENS' }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 318, thoughtsTokenCount: 7860 },
              },
        ),
      ),
  }).judge(request);
  expect(result.answer.outcome).toBe('pass');
  expect(calls).toBe(2);
});

it('counts physical HTTP submissions before a recovery and marks missing usage', async () => {
  let calls = 0;
  const result = await createOpenAiJudge({
    model: 'fictional',
    env,
    sleep: async () => {},
    metering: { costOfUsage: () => 0.01 },
    fetch: async () => {
      calls++;
      if (calls === 1) return new Response('{}', { status: 503 });
      return new Response(
        JSON.stringify(
          calls === 2 ? empty.openai : { ...ok.openai, usage: { prompt_tokens: 1, completion_tokens: 2 } },
        ),
      );
    },
  }).judge(request);
  expect(calls).toBe(3);
  expect(result.requestCount).toBe(3);
  expect(result.recovery).toMatchObject({ usageComplete: false, costComplete: false });
});
it('never hides extra HTTP retries inside the single recovery reservation', async () => {
  let calls = 0;
  await expect(
    createOpenAiJudge({
      model: 'fictional',
      env,
      sleep: async () => {},
      retry: { maxAttempts: 4 },
      fetch: async () => {
        calls++;
        return calls === 1 ? new Response(JSON.stringify(empty.openai)) : new Response('{}', { status: 503 });
      },
    }).judge(request),
  ).rejects.toMatchObject({ requestCount: 2, code: 'reasoning-budget-exhausted' });
  expect(calls).toBe(2);
});
it('denies recovery when an earlier HTTP submission has unknown billed usage', async () => {
  let calls = 0;
  await expect(
    createOpenAiJudge({
      model: 'fictional',
      env,
      sleep: async () => {},
      metering: { costOfUsage: () => 0.01, maxCostUsd: 1, maxRetryCostUsd: 0.1 },
      fetch: async () => {
        calls++;
        return calls === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(empty.openai));
      },
    }).judge(request),
  ).rejects.toMatchObject({ requestCount: 2, recovery: { retrySkipped: 'spend-cap' } });
  expect(calls).toBe(2);
});

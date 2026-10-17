import { type AgentAdapter, type Message, type Observed, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { specOf } from '../../core/test/runner/support';
import { UNRECORDED_RESULT } from '../src/anthropic/common';
import { anthropicAdapter } from '../src/anthropic/index';
import { crewaiAdapter } from '../src/crewai/index';
import { functionAdapter } from '../src/function/index';
import { googleAdapter } from '../src/google/index';
import { httpAdapter } from '../src/http/index';
import { langgraphAdapter } from '../src/langgraph/index';
import { litellmAdapter } from '../src/litellm/index';
import { openaiAgentsAdapter } from '../src/openai-agents/index';
import { pydanticAiAdapter } from '../src/pydantic-ai/index';
import { vercelAiAdapter } from '../src/vercel-ai/index';
import { fakePydanticBridge } from './fixtures/frameworks/python';
import { acmeModel, acmeVercelTools, fakeGenerateText } from './fixtures/frameworks/vercel-ai';
import { ACME_TOOL_NAMES } from './fixtures/sdk/acme-model';
import { acmeTools } from './fixtures/sdk/acme-tools';
import { recordedAnthropic } from './fixtures/sdk/anthropic';
import { recordedGoogle } from './fixtures/sdk/google';
import { acmeAgent } from './fixtures/sdk/openai-agents';

/**
 * Blast radius of PR 422 through the runner, not the renderers alone: a mode T run builds the canonical
 * prefix of block 2 (block 1's user message and a canonical assistant message holding the two calls block
 * 1 expects, with no result since the spec's world forces none), each adapter opens a session on it and
 * sends block 2. The request each adapter sends must carry the unrecorded note once per call, and never a
 * null result.
 */
const SECOND = 'And the price?';
const spec = specOf({
  id: 'blast-unrecorded-runner',
  version: '1',
  blocks: [
    {
      user: 'Is there fiber at 3 Orchard Way?',
      expect: {
        tools: [
          { label: 'coverage.check', input: { address: { regex: '^3 Orchard' } } },
          { label: 'catalog.search', input: { category: 'home' } },
        ],
      },
    },
    { user: SECOND },
  ],
});

const NOTE = JSON.stringify(UNRECORDED_RESULT).slice(1, -1);
const count = (wire: string, needle: string) => wire.split(needle).length - 1;

/** The first request that carries block 2's user text, as JSON. */
function blockTwo(requests: readonly unknown[]): string {
  const wire = requests.map((request) => JSON.stringify(request)).find((text) => text.includes(SECOND));
  if (wire === undefined) throw new Error('no request carried block 2');
  return wire;
}

async function runT(adapter: AgentAdapter): Promise<void> {
  const result = await runSpec(spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: [],
    mode: 'T',
    repeat: 0,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe('failed');
}

const ok = { role: 'assistant', content: 'ok' } as const;

/** Each adapter that sends the history to a model, with a transport that keeps every request it sends. */
const senders: Record<string, () => { adapter: AgentAdapter; requests: () => readonly unknown[] }> = {
  anthropic: () => {
    const answer = {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const client = recordedAnthropic([answer, answer, answer, answer]);
    return {
      adapter: anthropicAdapter({ client, model: 'claude-fake', tools: () => acmeTools().tools }),
      requests: () => client.requests,
    };
  },
  google: () => {
    const answer = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    };
    const client = recordedGoogle([answer, answer, answer, answer]);
    return {
      adapter: googleAdapter({ client, model: 'gemini-fake', tools: () => acmeTools().tools }),
      requests: () => client.requests,
    };
  },
  http: () => {
    const bodies: unknown[] = [];
    const fetchFn = async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: ok }] }));
    };
    return {
      adapter: httpAdapter({ url: 'http://agent.test/chat', fetch: fetchFn as never }),
      requests: () => bodies,
    };
  },
  litellm: () => {
    const bodies: unknown[] = [];
    const client = {
      chat: {
        completions: {
          async create(body: unknown) {
            bodies.push(structuredClone(body));
            return {
              model: 'fake/model',
              choices: [{ message: ok, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
    };
    return {
      adapter: litellmAdapter({ client: client as never, model: 'fake', tools: () => acmeTools().tools }),
      requests: () => bodies,
    };
  },
  langgraph: () => {
    // The Acme fake graph reads every tool message as JSON, so a plain graph that answers 'ok' records the input.
    const inputs: unknown[] = [];
    const graph = {
      async invoke(input: { messages: unknown[] }) {
        inputs.push(structuredClone(input.messages));
        return { messages: [...input.messages, { type: 'ai', content: 'ok' }] };
      },
    };
    return {
      adapter: langgraphAdapter({ graph: graph as never, toolLabels: ACME_TOOL_NAMES }),
      requests: () => inputs,
    };
  },
  'openai-agents': () => {
    // The Acme fake runner reads every call result as JSON, so a plain runner that answers nothing records the input.
    const inputs: unknown[] = [];
    const runner = {
      async run(_agent: unknown, input: unknown[]) {
        inputs.push(structuredClone(input));
        return { newItems: [] };
      },
    };
    return {
      adapter: openaiAgentsAdapter({ runner, agent: () => acmeAgent(), toolLabels: ACME_TOOL_NAMES }),
      requests: () => inputs,
    };
  },
  'pydantic-ai': () => {
    const exec = fakePydanticBridge();
    return {
      adapter: pydanticAiAdapter({ agent: 'acme.agent:sales', exec, toolLabels: ACME_TOOL_NAMES }),
      requests: () => exec.requests.map((request) => JSON.parse(request.input)),
    };
  },
  'vercel-ai': () => {
    const generateText = fakeGenerateText();
    return {
      adapter: vercelAiAdapter({
        generateText,
        model: acmeModel(),
        tools: () => acmeVercelTools(),
        toolLabels: ACME_TOOL_NAMES,
      }),
      requests: () => generateText.calls.map((call) => call.messages),
    };
  },
};

describe('PR 422 blast radius: a mode T run sends an unrecorded canonical call with the note', () => {
  it('covers every adapter that declares seedPrefix and sends the history to a model', () => {
    expect(Object.keys(senders).sort()).toEqual(
      [
        'anthropic',
        'google',
        'http',
        'langgraph',
        'litellm',
        'openai-agents',
        'pydantic-ai',
        'vercel-ai',
      ].sort(),
    );
    for (const [name, make] of Object.entries(senders)) {
      expect(make().adapter.capabilities().seedPrefix, name).toBe(true);
    }
  });

  for (const [name, make] of Object.entries(senders)) {
    it(`${name}: block 2's request carries the note for each of the two calls, never null for them`, async () => {
      const { adapter, requests } = make();
      await runT(adapter);
      const wire = blockTwo(requests());
      expect(count(wire, NOTE)).toBe(2);
      // Block 1's request had no prefix call, so the note is nowhere else.
      const before = requests()
        .map((request) => JSON.stringify(request))
        .filter((text) => !text.includes(SECOND));
      expect(before.length).toBeGreaterThan(0);
      for (const text of before) expect(text).not.toContain(NOTE);
    });
  }

  it('function: hands the call to the agent as the canonical prefix holds it, with no note and no output', async () => {
    const seen: Message[][] = [];
    const adapter = functionAdapter({
      respond: (messages): Observed => {
        seen.push(structuredClone(messages) as Message[]);
        return {
          segments: [{ type: 'text', text: 'ok' }],
          text: 'ok',
          toolCalls: [],
          cost: {},
          latencyMs: 0,
        };
      },
    });
    await runT(adapter);
    const second = seen.find((history) => history.some((message) => message.content === SECOND));
    const calls = (second ?? []).flatMap((message) => message.tool_calls ?? []);
    expect(calls).toEqual([
      { label: 'coverage.check', input: {} },
      { label: 'catalog.search', input: { category: 'home' } },
    ]);
    expect(JSON.stringify(second)).not.toContain(NOTE);
  });

  it('crewai: the history JSON it hands the crew holds the call with no output key, never null', async () => {
    const inputs: Record<string, string>[] = [];
    const adapter = crewaiAdapter({
      transport: {
        kind: 'process',
        reportsTools: false,
        kickoff: async (sent) => {
          inputs.push(sent);
          return { raw: 'ok' };
        },
      },
      toolLabels: ACME_TOOL_NAMES,
    });
    await runT(adapter);
    const second = inputs.find((sent) => sent.message === SECOND);
    if (!second) throw new Error('no kickoff for block 2');
    const calls = (JSON.parse(second.messages ?? '[]') as Message[]).flatMap(
      (message) => message.tool_calls ?? [],
    );
    expect(calls).toEqual([
      { label: 'coverage.check', input: {} },
      { label: 'catalog.search', input: { category: 'home' } },
    ]);
    expect(second.messages).not.toContain('null');
  });
});

describe('PR 422 blast radius: mode F, an http endpoint that answers a tool_call with no tool_result', () => {
  it('the next request of the run carries the note where it carried null', async () => {
    const bodies: { messages: { role: string; content: unknown }[] }[] = [];
    const answers: unknown[] = [
      {
        segments: [
          { type: 'tool_call', id: 'lone-1', label: 'coverage.check', input: { address: '3 Orchard Way' } },
          { type: 'text', text: 'Checking.' },
        ],
        text: 'Checking.',
        toolCalls: [{ id: 'lone-1', label: 'coverage.check', input: { address: '3 Orchard Way' } }],
        cost: {},
        latencyMs: 0,
      },
      { segments: [{ type: 'text', text: 'ok' }], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
    ];
    const fetchFn = async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(answers[bodies.length - 1]));
    };
    const adapter = httpAdapter({ url: 'http://agent.test/turn', fetch: fetchFn as never });
    const result = await runSpec(
      specOf({ id: 'lone-call', version: '1', blocks: [{ user: 'q1' }, { user: 'q2' }] }),
      {
        adapter,
        driver: createScriptedDriver(),
        checks: [],
        mode: 'F',
        repeat: 0,
      },
    );
    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(2);
    const tool = bodies[1]?.messages.find((message) => message.role === 'tool');
    expect(tool?.content).toBe(JSON.stringify(UNRECORDED_RESULT));
    expect(JSON.stringify(bodies[0])).not.toContain(NOTE);
  });
});

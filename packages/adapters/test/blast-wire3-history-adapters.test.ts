import {
  type AgentAdapter,
  type Message,
  type Observed,
  runSpec,
  type Session,
  type Spec,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import type { AnthropicClientLike, AnthropicCreateParams } from '../src/anthropic/index';
import { anthropicAdapter } from '../src/anthropic/index';
import { crewaiAdapter, crewaiProcess } from '../src/crewai/index';
import { type GoogleGenerateParams, googleAdapter } from '../src/google/index';
import { type HttpTurnRequest, httpAdapter } from '../src/http/index';
import { langgraphAdapter } from '../src/langgraph/index';
import { type ChatCompletionParams, litellmAdapter } from '../src/litellm/index';
import { type AgentInputItemLike, openaiAgentsAdapter } from '../src/openai-agents/index';
import { pydanticAiAdapter } from '../src/pydantic-ai/index';
import type { ExecRequest } from '../src/shared/bridge';
import { type ModelMessageLike, vercelAiAdapter } from '../src/vercel-ai/index';
import { acmeGiven, sendUser } from './contract';
import { WIRES } from './history-wires';

// Fictional data only. The blast radius of the tool history compiler (PR 432) through each adapter's own
// send path, not only its serializer: what the client, the endpoint, the runner or the bridge receives.

/** A history the wires refuse when rendered naively: one hazard per message. */
const hazards: Message[] = [
  { role: 'system', content: 'You are the Acme sales assistant.' },
  { role: 'user', content: 'Is fiber available at 3 Orchard Way?' },
  {
    role: 'assistant',
    content: 'Yes, fiber is available.',
    tool_calls: [
      // Two parallel calls of one turn that the Acme agent numbered alike.
      { id: 'call-1', label: 'coverage.check', input: { address: '3 Orchard Way' }, output: { found: true } },
      {
        id: 'call-1',
        label: 'catalog.search',
        input: { category: 'fiber' },
        output: { plans: ['fiber-300'] },
      },
    ],
  },
  { role: 'tool', content: 'a free tool note, answering no call' },
  { role: 'user', content: 'And at 4 Orchard Way?' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      // An error, two ids that cleaning can make equal, a call with no result, and a call with no id.
      { id: 'a.b', label: 'coverage.check', input: { address: '4 Orchard Way' }, error: 'address unknown' },
      { id: 'a_b', label: 'coverage.check', input: { address: '4 Orchard Way, Acmeville' } },
      { label: 'catalog.search' },
    ],
  },
  { role: 'assistant', content: 'I could not find that address.' },
  { role: 'user', content: 'Thanks.' },
  {
    role: 'assistant',
    content: 'Anything else?',
    tool_calls: [
      { id: 'call-1', label: 'notify_sales', input: { topic: 'fiber' }, output: { ref: 'LD-4471' } },
    ],
  },
];
const HAZARD_CALLS = 6;
const NOTE = 'a free tool note, answering no call';
const NEXT = 'Is there a cheaper plan?';

/** The pairing a wire enforces, read off what the adapter actually sent. */
function problems(wire: keyof typeof WIRES, sent: unknown, calls: number, distinct = true): string[] {
  const turns = WIRES[wire]?.turns(sent);
  if (turns === undefined) return [`no wire ${wire}`];
  if (typeof turns === 'string') return [turns];
  const found: string[] = [];
  let seen = 0;
  turns.forEach((turn, at) => {
    seen += turn.calls.length;
    if (turn.names && JSON.stringify(turn.names[0]) !== JSON.stringify(turn.names[1]))
      found.push(`turn ${at}: responses ${turn.names[1]} do not answer calls ${turn.names[0]}`);
    if (JSON.stringify(turn.calls) !== JSON.stringify(turn.results))
      found.push(`turn ${at}: results ${turn.results} do not answer calls ${turn.calls}`);
    const ids = turn.calls.filter((id) => id !== undefined);
    if (distinct && new Set(ids).size !== ids.length) found.push(`turn ${at}: a call id repeats (${ids})`);
    if (ids.some((id) => id === '')) found.push(`turn ${at}: an empty call id`);
  });
  if (seen !== calls) found.push(`${seen} calls on the wire, ${calls} in the history`);
  return found;
}

/** Sends one user turn after the hazard prefix, the way the runner does. */
async function sendAfterHazards(adapter: AgentAdapter, name: string): Promise<Observed> {
  const session: Session = await adapter.open(acmeGiven({ adapter: name }, {}, structuredClone(hazards)));
  return sendUser(adapter, session, NEXT, 0);
}

const text = (value: unknown) => JSON.stringify(value);

function anthropicCapture(): AnthropicClientLike & { requests: AnthropicCreateParams[] } {
  const requests: AnthropicCreateParams[] = [];
  return {
    requests,
    messages: {
      async create(body) {
        requests.push(structuredClone(body));
        return {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as never;
      },
    },
  };
}

function chatCompletion(content = 'ok') {
  return {
    id: 'chatcmpl-1',
    model: 'acme-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}

/** An http endpoint that records each request body and answers what `answer` returns for it. */
function httpCapture(answer: (body: HttpTurnRequest, index: number) => unknown = () => chatCompletion()) {
  const bodies: HttpTurnRequest[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as HttpTurnRequest;
    bodies.push(body);
    return new Response(JSON.stringify(answer(body, bodies.length - 1)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { bodies, fetch };
}

describe('each adapter that sends history to a model sends the compiled, paired history', () => {
  it('anthropic: the Messages request pairs every tool_use with its tool_result, distinct ids per turn', async () => {
    const client = anthropicCapture();
    await sendAfterHazards(anthropicAdapter({ client, model: 'claude-acme' }), 'anthropic');
    const request = client.requests[0] as AnthropicCreateParams;
    expect(problems('anthropic', { messages: request.messages }, HAZARD_CALLS)).toEqual([]);
    // The system message of the history goes to the system field, the free note as user text.
    expect(JSON.stringify(request.system)).toContain('You are the Acme sales assistant.');
    expect(JSON.stringify(request.messages)).toContain(NOTE);
  });

  it('http: the request body carries Chat messages, paired, and the free note as user text', async () => {
    const endpoint = httpCapture();
    await sendAfterHazards(httpAdapter({ url: 'http://agent.test/chat', fetch: endpoint.fetch }), 'http');
    const messages = endpoint.bodies[0]?.messages ?? [];
    expect(problems('chat', messages, HAZARD_CALLS)).toEqual([]);
    expect(messages.filter((message) => message.content === NOTE).map((message) => message.role)).toEqual([
      'user',
    ]);
    expect(messages.at(-1)).toEqual({ role: 'user', content: NEXT });
  });

  it('litellm: the completion request is paired after the adapter renames the calls for the wire', async () => {
    const requests: ChatCompletionParams[] = [];
    const client = {
      chat: {
        completions: {
          async create(body: ChatCompletionParams) {
            requests.push(structuredClone(body));
            return chatCompletion() as never;
          },
        },
      },
    };
    await sendAfterHazards(
      litellmAdapter({ client, model: 'acme-model', system: 'Acme system prompt.' }),
      'litellm',
    );
    const messages = requests[0]?.messages ?? [];
    expect(problems('chat', messages, HAZARD_CALLS)).toEqual([]);
    expect(messages.filter((message) => message.content === NOTE).map((message) => message.role)).toEqual([
      'user',
    ]);
    // Function names are the wire's: no dot.
    const names = messages.flatMap((message) => message.tool_calls ?? []).map((call) => call.function.name);
    expect(names.length).toBe(HAZARD_CALLS);
    expect(names.some((name) => name.includes('.'))).toBe(false);
  });

  it('openai-agents: the runner input pairs each function_call with its result, distinct call ids per run', async () => {
    const inputs: AgentInputItemLike[][] = [];
    const runner = {
      async run(_agent: unknown, input: AgentInputItemLike[]) {
        inputs.push(structuredClone(input));
        return {
          newItems: [
            {
              type: 'message_output_item',
              agent: { name: 'Acme sales' },
              rawItem: {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'ok', annotations: [] }],
              },
            },
          ],
          rawResponses: [{ usage: { inputTokens: 1, outputTokens: 1 } }],
          inputGuardrailResults: [],
          outputGuardrailResults: [],
          lastAgent: { name: 'Acme sales' },
        } as never;
      },
    };
    await sendAfterHazards(openaiAgentsAdapter({ runner, agent: { name: 'Acme sales' } }), 'openai-agents');
    expect(problems('responses', inputs[0], HAZARD_CALLS)).toEqual([]);
  });

  it('langgraph: the graph receives assistant tool_calls each answered by its tool message', async () => {
    const invoked: unknown[][] = [];
    const graph = {
      async invoke(input: { messages: unknown[] }) {
        invoked.push(structuredClone(input.messages));
        return { messages: [...input.messages, { type: 'ai', content: 'ok' }] };
      },
    };
    await sendAfterHazards(langgraphAdapter({ graph }), 'langgraph');
    expect(problems('langgraph', invoked[0], HAZARD_CALLS)).toEqual([]);
  });

  it('pydantic-ai: the bridge input holds a message_history of paired tool-call and tool-return parts', async () => {
    const requests: ExecRequest[] = [];
    const exec = async (request: ExecRequest) => {
      requests.push(request);
      const reply = [{ kind: 'response', parts: [{ part_kind: 'text', content: 'ok' }] }];
      return { stdout: `driftbench-result ${JSON.stringify(reply)}\n`, stderr: '', exitCode: 0 };
    };
    await sendAfterHazards(pydanticAiAdapter({ agent: 'acme.agent:sales', exec }), 'pydantic-ai');
    const input = JSON.parse(requests[0]?.input ?? '{}') as { message_history: unknown; user_prompt: string };
    expect(input.user_prompt).toBe(NEXT);
    expect(problems('pydantic', input.message_history, HAZARD_CALLS)).toEqual([]);
  });

  it('vercel-ai: generateText receives tool-call parts each answered by a tool-result part', async () => {
    const sent: ModelMessageLike[][] = [];
    const generateText = async (options: { messages: ModelMessageLike[] }) => {
      sent.push(structuredClone(options.messages));
      return { steps: [{ content: [{ type: 'text', text: 'ok' }], finishReason: 'stop' }] };
    };
    const model = { modelId: 'acme', doGenerate: async () => ({}) };
    await sendAfterHazards(vercelAiAdapter({ generateText, model }), 'vercel-ai');
    expect(problems('vercel', sent[0], HAZARD_CALLS)).toEqual([]);
  });

  it('google: each functionResponse answers its functionCall by name and order', async () => {
    const requests: GoogleGenerateParams[] = [];
    const client = {
      models: {
        async generateContent(params: GoogleGenerateParams) {
          requests.push(structuredClone(params));
          return {
            candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          };
        },
      },
    };
    await sendAfterHazards(googleAdapter({ client, model: 'gemini-acme' }), 'google');
    // Pairing by name and order; ids are checked in the next test.
    expect(problems('google', { contents: requests[0]?.contents }, HAZARD_CALLS, false)).toEqual([]);
  });

  it('google: the calls of one turn that carry ids carry distinct ids, as docs/adapters/index.md states', async () => {
    const requests: GoogleGenerateParams[] = [];
    const client = {
      models: {
        async generateContent(params: GoogleGenerateParams) {
          requests.push(structuredClone(params));
          return {
            candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          };
        },
      },
    };
    await sendAfterHazards(googleAdapter({ client, model: 'gemini-acme' }), 'google');
    const turns = (requests[0]?.contents ?? [])
      .filter((content) => content.role === 'model')
      .map((content) =>
        (content.parts ?? []).flatMap((part) => (part.functionCall?.id ? [part.functionCall.id] : [])),
      )
      .filter((ids) => ids.length > 0);
    expect(turns.length).toBeGreaterThan(0);
    for (const ids of turns) expect(new Set(ids).size, `ids ${ids}`).toBe(ids.length);
  });
});

/**
 * A spec of the Acme agent whose first block expects two coverage checks and one catalog search. A forced
 * tool result (`world.tools`) makes the block not_run on an adapter without toolStubs (docs/adapters/index.md),
 * so a spec for such an adapter sets `forced` to false.
 */
function toolSpec(id: string, forced = true): Spec {
  const loaded = validateSpec({
    id,
    ...(forced
      ? { given: { world: { tools: { 'catalog.search': { result: { plans: ['fiber-300'] } } } } } }
      : {}),
    blocks: [
      {
        user: 'Is fiber available at 3 and 4 Orchard Way?',
        expect: {
          tools: [
            { label: 'coverage.check', count: 2 },
            { label: 'catalog.search', count: 1 },
          ],
        },
      },
      { user: 'And the price?' },
    ],
  });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

/** A crew that answers every kickoff with one line of text; on its first kickoff it reports one tool use. */
function textCrew() {
  const requests: ExecRequest[] = [];
  const exec = async (request: ExecRequest) => {
    requests.push(request);
    const result = {
      raw: 'From 25 a month.',
      tasks: [{ name: 'answer', agent: 'Acme sales', raw: 'ok' }],
      tools:
        requests.length === 1
          ? [{ tool: 'coverage.check', input: { address: '3 Orchard Way' }, output: '{"found":true}' }]
          : [],
    };
    return { stdout: `driftbench-result ${JSON.stringify(result)}\n`, stderr: '', exitCode: 0 };
  };
  return { requests, exec };
}

describe('the runner hands each adapter a history the compiler pairs', () => {
  it('mode T: the canonical prefix of block 1 (calls with no id, one with no result) goes out paired on Anthropic', async () => {
    const client = anthropicCapture();
    const result = await runSpec(toolSpec('blast-wire3-mode-t'), {
      adapter: anthropicAdapter({ client, model: 'claude-acme' }),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'T',
      repeat: 0,
    });
    expect(result.error).toBeUndefined();
    const second = client.requests[1] as AnthropicCreateParams;
    expect(problems('anthropic', { messages: second.messages }, 3)).toEqual([]);
    const ids = second.messages.flatMap((message) =>
      (Array.isArray(message.content) ? message.content : []).flatMap((block) =>
        block.type === 'tool_use' ? [block.id] : [],
      ),
    );
    expect(ids).toEqual(['toolu_h1', 'toolu_h2', 'toolu_h3']);
  });

  it('mode F: parallel calls an endpoint numbered alike, one without its result, reach the next block paired', async () => {
    const observed = (blockIndex: number) =>
      blockIndex === 0
        ? {
            segments: [
              {
                type: 'tool_call',
                id: 'call-1',
                label: 'coverage.check',
                input: { address: '3 Orchard Way' },
              },
              {
                type: 'tool_call',
                id: 'call-1',
                label: 'coverage.check',
                input: { address: '4 Orchard Way' },
              },
              { type: 'tool_result', id: 'call-1', label: 'coverage.check', output: { found: true } },
              { type: 'tool_call', id: 'call-2', label: 'catalog.search', input: { category: 'fiber' } },
              { type: 'text', text: 'Both are covered.' },
            ],
          }
        : { segments: [{ type: 'text', text: 'From 25 a month.' }] };
    const endpoint = httpCapture((body) => observed(body.turn));
    const result = await runSpec(toolSpec('blast-wire3-mode-f', false), {
      adapter: httpAdapter({ url: 'http://agent.test/turn', fetch: endpoint.fetch }),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(result.error).toBeUndefined();
    const second = endpoint.bodies[1]?.messages ?? [];
    expect(problems('chat', second, 3)).toEqual([]);
    expect(text(second)).toContain('Both are covered.');
  });

  it('crewai, mode F: the crew runs a spec whose earlier block called tools', async () => {
    const { exec, requests } = textCrew();
    const result = await runSpec(toolSpec('blast-wire3-crew-f', false), {
      adapter: crewaiAdapter({ transport: crewaiProcess({ crew: 'acme.crew:build', exec }) }),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(result.error).toBeUndefined();
    expect(result.blocks).toHaveLength(2);
    expect(requests).toHaveLength(2);
    // Block 1's history held the crew's own call of block 0; the refusal is for a Given prefix only.
    const inputs = JSON.parse(requests[1]?.input ?? '{}') as { inputs: { messages: string } };
    expect(inputs.inputs.messages).toContain('coverage.check');
  });

  // BUG: in mode T every block after one that expects a tool opens with a canonical prefix holding those
  // calls, and crewai's new refusal fails the run, where mode F of the same spec runs; reported to lead.
  it.fails('crewai, mode T: the crew runs the same spec teacher-forced, as it does in mode F', async () => {
    const { exec, requests } = textCrew();
    const result = await runSpec(toolSpec('blast-wire3-crew-t'), {
      adapter: crewaiAdapter({ transport: crewaiProcess({ crew: 'acme.crew:build', exec }) }),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'T',
      repeat: 0,
    });
    expect(result.error).toBeUndefined();
    expect(result.blocks).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });
});

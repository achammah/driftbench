import {
  AdapterTransportError,
  AgentFailure,
  type Message,
  type Observed,
  runSpec,
  type Session,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { type AcmeStore, createAcmeAgent, createStore } from '../../../examples/acme/src/index';
import { specOf } from '../../core/test/runner/support';
import { functionAdapter } from '../src/function/index';
import {
  acmeGiven,
  adapterContract,
  COVERAGE_QUESTION,
  converse,
  expectWholeObserved,
  sendUser,
  UPGRADE_CONVERSATION,
  UPGRADE_PAYLOAD,
  userTurn,
} from './contract';

type AcmeSession = { store: AcmeStore; agent: ReturnType<typeof createAcmeAgent> };

/** The Acme agent behind the function adapter, with a fresh store for each session. */
function acmeAdapter() {
  return functionAdapter<AcmeSession>({
    create: () => {
      const store = createStore();
      return { store, agent: createAcmeAgent(store) };
    },
    respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
    payloads: (session) => session.store.payloads,
    deterministic: true,
  });
}

adapterContract('function', acmeAdapter, {
  brokenTransport: () =>
    functionAdapter({
      respond: () => {
        throw new AdapterTransportError('the service behind the agent refused the connection');
      },
    }),
  released: (session: Session) => {
    const state = session.state as { closed?: boolean; agent?: unknown };
    return state.closed === true && state.agent === undefined;
  },
});

const target = { adapter: 'function', agent: 'acme-sales' };
const reply = (text: string): Observed => ({
  segments: [{ type: 'text', text }],
  text,
  toolCalls: [],
  cost: { usd: 0 },
  latencyMs: 0,
});

describe('function adapter', () => {
  it.each(['F', 'T'] as const)('rejects an accessor in a runner prefix in mode %s', async (mode) => {
    const spec = specOf({ id: 'accessor-prefix', blocks: [{ user: 'hello' }] });
    const block = spec.blocks[0];
    if (!block) throw new Error('missing fixture block');
    block.given = {
      prefix: [
        {
          role: 'user',
          get content() {
            return 'prefix';
          },
        },
      ],
    };
    const result = await runSpec(spec, {
      adapter: functionAdapter({ respond: () => reply('ok') }),
      driver: createScriptedDriver(),
      checks: [],
      mode,
      repeat: 0,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/content.*accessor/);
  });

  it('rejects the accessor-setter history bypass at open before creating the agent', async () => {
    let text = 'before';
    let created = false;
    const message: Message = {
      role: 'user',
      get content() {
        return text;
      },
      set content(value) {
        text = value;
      },
    };
    const adapter = functionAdapter({
      create: () => {
        created = true;
      },
      respond: () => reply('ok'),
    });
    await expect(adapter.open({ ...acmeGiven(target), prefix: [message] })).rejects.toThrow(
      /content.*accessor/,
    );
    expect(created).toBe(false);
    expect(text).toBe('before');
  });

  it.each(['F', 'T', 'P'] as const)(
    'records a tool call without output and completes in mode %s',
    async (mode) => {
      const spec = specOf({ id: 'no-output-call', blocks: [{ user: 'one' }, { user: 'two' }] });
      const histories: Message[][] = [];
      const result = await runSpec(spec, {
        adapter: functionAdapter({
          respond: (messages) => {
            histories.push(messages);
            return { ...reply('ok'), toolCalls: [{ label: 'lookup', input: { q: 1 } }] };
          },
        }),
        driver: createScriptedDriver(),
        checks: [],
        mode,
        repeat: 0,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe('completed');
      const recorded = histories.at(-1)?.find((message) => message.tool_calls)?.tool_calls?.[0];
      if (mode !== 'T') expect(recorded).toEqual({ label: 'lookup', input: { q: 1 } });
      if (recorded) expect(Object.hasOwn(recorded, 'output')).toBe(false);
    },
  );

  it('rejects a Proxy message at open before creating the agent', async () => {
    let created = false;
    const live = [{ label: 'lookup', input: { q: 'before' } }];
    const message = new Proxy({ role: 'assistant', content: 'x' } as Message, {
      get: (target, key, receiver) => (key === 'tool_calls' ? live : Reflect.get(target, key, receiver)),
    });
    const adapter = functionAdapter({
      create: () => {
        created = true;
      },
      respond: () => reply('ok'),
    });
    await expect(adapter.open({ ...acmeGiven(target), prefix: [message] })).rejects.toThrow(
      /message: Proxy object/,
    );
    expect(created).toBe(false);
  });

  it.each(['F', 'T', 'P'] as const)(
    'shares frozen messages in fresh callback arrays in mode %s',
    async (mode) => {
      const seen: Message[][] = [];
      const adapter = functionAdapter({
        respond: (messages) => {
          const first = messages[0] as Message;
          expect(() => {
            first.content = 'changed';
          }).toThrow(TypeError);
          const input = first.tool_calls?.[0]?.input as {
            parts: { text: string }[];
            metadata: { tag: string };
          };
          expect(() => {
            (input.parts[0] as { text: string }).text = 'changed';
          }).toThrow(TypeError);
          expect(() => {
            input.metadata.tag = 'changed';
          }).toThrow(TypeError);
          expect(() => {
            first.tool_calls?.push({ label: 'injected' });
          }).toThrow(TypeError);
          for (const message of messages) {
            expect(Object.isFrozen(message)).toBe(true);
            if (message.tool_calls) {
              expect(Object.isFrozen(message.tool_calls)).toBe(true);
              expect(Object.isFrozen(message.tool_calls[0]?.input)).toBe(true);
            }
          }
          seen.push(messages);
          return reply('ok');
        },
      });
      const spec = specOf({
        id: 'readonly-history',
        blocks: [
          {
            given: {
              prefix: [
                {
                  role: 'assistant',
                  content: 'prefix',
                  tool_calls: [
                    {
                      label: 'lookup',
                      input: { parts: [{ text: 'original' }], metadata: { tag: 'original' } },
                      // A prefix call carries its result: one without is a Given error, and the block is not run.
                      output: { found: true },
                    },
                  ],
                },
              ],
            },
            user: 'one',
          },
          { user: 'two' },
          { user: 'three' },
        ],
      });
      const result = await runSpec(spec, {
        adapter,
        driver: createScriptedDriver(),
        checks: [],
        mode,
        repeat: 0,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe('completed');
      expect(seen).toHaveLength(3);
      expect(seen[0]).not.toBe(seen[1]);
      if (mode !== 'T') expect(seen[0]?.[0]).toBe(seen[1]?.[0]);
      expect(seen[1]?.[0]).toBe(seen[2]?.[0]);
      expect(seen[0]).toHaveLength(2);
      expect(seen[1]).toHaveLength(4);
      const copied = structuredClone(seen[0]?.[0] as Message);
      copied.content = 'private';
      expect(seen[0]?.[0]?.content).toBe('prefix');
      seen[0]?.push(copied);
      expect(seen[1]).toHaveLength(4);
    },
  );

  it('reports an uncaught history write as an agent failure with the read-only field', async () => {
    const adapter = functionAdapter({
      respond: (messages) => {
        (messages[0] as Message).content = 'changed';
        return reply('never');
      },
    });
    const result = await runSpec(specOf({ id: 'history-write', blocks: [{ user: 'hello' }] }), {
      adapter,
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/AgentFailure.*read only property 'content'/);
  });

  it('freezes ordinary caller messages at open and send, including replaced entries', async () => {
    const prefix: Message[] = [
      { role: 'user', content: 'first', tool_calls: [{ label: 'lookup', input: { parts: ['original'] } }] },
    ];
    const given = { ...acmeGiven(target), prefix };
    const adapter = functionAdapter({
      respond: (messages) => {
        expect(() => {
          (messages[0] as Message).content = 'changed';
        }).toThrow(TypeError);
        expect(() => {
          (messages.at(-1) as Message).content = 'changed';
        }).toThrow(TypeError);
        return reply('ok');
      },
    });
    const session = await adapter.open(given);
    expect(session.history[0]).toBe(prefix[0]);
    expect(() => {
      (prefix[0] as Message).content = 'changed';
    }).toThrow(TypeError);
    session.history.push({ role: 'user', content: 'new' });
    await adapter.send(session, userTurn(0, 'new', given));
    session.history[0] = { role: 'user', content: 'replacement' };
    await adapter.send(session, userTurn(1, 'new', given));
    expect(() => {
      (session.history[0] as Message).content = 'changed';
    }).toThrow(TypeError);
  });

  it('shares one deeply frozen message across sessions without sharing their arrays', async () => {
    const message: Message = {
      role: 'user',
      content: 'shared',
      tool_calls: [{ label: 'lookup', input: { tag: 'original' } }],
    };
    const adapter = functionAdapter({ respond: () => reply('ok') });
    const first = await adapter.open({ ...acmeGiven(target), prefix: [message] });
    const second = await adapter.open({ ...acmeGiven(target), prefix: [message] });
    expect(first.history).not.toBe(second.history);
    expect(first.history[0]).toBe(message);
    expect(second.history[0]).toBe(message);
    expect(Object.isFrozen(message.tool_calls?.[0]?.input)).toBe(true);
    first.history.push({ role: 'user', content: 'private' });
    expect(second.history).toHaveLength(1);
    await adapter.close(first);
    await adapter.close(second);
  });

  it('an agent that calls a tool through context.callTool: a denied tool never runs', async () => {
    let ran = 0;
    const adapter = functionAdapter({
      toolPolicy: [{ pattern: 'order.create', action: 'deny' }],
      respond: async (_messages, _world, _vars, _session, context) => {
        let error: string | undefined;
        try {
          await context.callTool('order.create', () => {
            ran += 1;
            return { ok: true };
          });
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
        }
        return { ...reply(error ?? 'ran'), toolCalls: [{ label: 'order.create', input: {}, error }] };
      },
    });
    const session = await adapter.open(acmeGiven(target));
    const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
    expect(ran, 'the denied tool was not called').toBe(0);
    expect(observed.text).toBe('denied by tool policy rule order.create');
  });

  it('wraps a plain (messages, world, vars) function such as createAcmeAgent().respond', async () => {
    const adapter = functionAdapter({ respond: createAcmeAgent().respond });
    expect(adapter.capabilities()).toEqual({
      variants: false,
      seedPrefix: true,
      toolStubs: true,
      trace: false,
      sandbox: false,
      endState: false,
      deterministic: false,
    });
    const session = await adapter.open(acmeGiven(target));
    const observed = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(adapter.endState).toBeDefined();
    await expect(adapter.endState?.(session, 'tool:order.create')).rejects.toThrow(/no payload log/);
  });

  it('hands the agent the history as the runner left it, the block world and vars, and its session state', async () => {
    const seen: { messages: Message[]; world: WorldState; vars: Record<string, unknown>; state: string }[] =
      [];
    const adapter = functionAdapter<string>({
      create: (given) => `state of ${given.hash}`,
      respond: (messages, world, vars, state) => {
        seen.push({ messages, world, vars, state });
        return reply('ok');
      },
    });
    const prefix: Message[] = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'earlier reply' },
    ];
    const start = acmeGiven(target, {}, prefix);
    const session = await adapter.open(start);
    // The runner appends a burst's messages before send; the adapter adds nothing of its own.
    session.history.push({ role: 'user', content: 'one' }, { role: 'user', content: 'two' });
    const blockGiven = acmeGiven(target, { fixtures: { clock: '2026-01-15T10:00:00Z' } });
    await adapter.send(session, { index: 3, stimulus: { burst: ['one', 'two'] }, given: blockGiven });
    expect(seen[0]?.messages).toEqual([
      ...prefix,
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
    ]);
    expect(seen[0]?.world).toEqual(blockGiven.world);
    expect(seen[0]?.vars).toEqual(blockGiven.vars);
    expect(seen[0]?.state).toBe(`state of ${start.hash}`);
  });

  it('keeps array edits and world edits private to the callback', async () => {
    const adapter = functionAdapter({
      respond: (messages, world, vars, _state, context) => {
        vars.channel = 'changed';
        context.target.agent = 'changed';
        messages.push({ role: 'user', content: 'injected' });
        world.tools = { 'coverage.check': { error: 'mutated' } };
        return reply('ok');
      },
    });
    const start = acmeGiven(target, {}, [{ role: 'user', content: 'first' }]);
    const session = await adapter.open(start);
    await sendUser(adapter, session, 'second', 0, start);
    expect(session.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ]);
    expect(start.world).toEqual({});
    expect(start.vars.channel).toBe('chat');
    expect(start.target.agent).toBe('acme-sales');
  });

  it('turns an agent error into AgentFailure and passes the contract errors through', async () => {
    const failing = (error: unknown) =>
      functionAdapter({
        respond: () => {
          throw error;
        },
      });
    const start = acmeGiven(target);
    const plain = failing(new Error('the model refused'));
    const session = await plain.open(start);
    const failure = await plain.send(session, userTurn(0, 'hello', start)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentFailure);
    expect((failure as Error).message).toContain('the model refused');

    const transport = failing(new AdapterTransportError('down'));
    await expect(
      transport.send(await transport.open(start), userTurn(0, 'hello', start)),
    ).rejects.toBeInstanceOf(AdapterTransportError);
    const agent = failing(new AgentFailure('gave up'));
    await expect(agent.send(await agent.open(start), userTurn(0, 'hello', start))).rejects.toBeInstanceOf(
      AgentFailure,
    );
  });

  it('fails the block with the first issues when the agent returns an invalid Observed', async () => {
    const adapter = functionAdapter({
      respond: () =>
        ({ segments: [{ type: 'text' }], text: 'x', toolCalls: [], latencyMs: 0 }) as unknown as Observed,
    });
    const start = acmeGiven(target);
    const failure = await adapter
      .send(await adapter.open(start), userTurn(0, 'hi', start))
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AgentFailure);
    expect((failure as Error).message).toMatch(/invalid Observed: .*segments\.0\.text/);
    expect((failure as Error).message).toMatch(/cost/);
  });

  it('keeps each session to its own state: an order in one session is not the end state of another', async () => {
    const adapter = acmeAdapter();
    const ordering = await adapter.open(acmeGiven(target));
    const idle = await adapter.open(acmeGiven(target));
    for (const [index, text] of UPGRADE_CONVERSATION.entries())
      await converse(adapter, ordering, text, index);
    expect(await adapter.endState?.(ordering, 'tool:order.create')).toEqual(UPGRADE_PAYLOAD);
    expect(await adapter.endState?.(idle, 'tool:order.create')).toBeUndefined();
  });

  it('refuses an end-state source that is not tool:<label>', async () => {
    const adapter = acmeAdapter();
    const session = await adapter.open(acmeGiven(target));
    await expect(adapter.endState?.(session, 'store:orders')).rejects.toThrow(/tool:<label>/);
  });

  it('reports a creation failure as AgentFailure and declares determinism and its version as given', async () => {
    const adapter = functionAdapter({
      create: () => {
        throw new Error('no store');
      },
      respond: () => reply('never'),
      deterministic: true,
      version: '2026.1',
    });
    expect(adapter.capabilities().deterministic).toBe(true);
    expect(adapter.version).toBe('2026.1');
    await expect(adapter.open(acmeGiven(target))).rejects.toBeInstanceOf(AgentFailure);
  });

  it('refuses a session another adapter opened', async () => {
    const adapter = acmeAdapter();
    const session = await adapter.open(acmeGiven(target));
    const foreign = { ...session, adapter: 'http' };
    await expect(adapter.send(foreign, userTurn(0, 'hi', session.given))).rejects.toThrow(/not opened by/);
  });
});

describe('the contract checks on an Observed', () => {
  /** The Acme agent's answer to the coverage question: two tool calls, each with its result, then the reply. */
  const whole = () => createAcmeAgent().respond([{ role: 'user', content: COVERAGE_QUESTION }]);
  const breaks = (mutate: (observed: Observed) => unknown) => async () => {
    const observed = await whole();
    expect(() => expectWholeObserved(observed)).not.toThrow();
    mutate(observed);
    expect(() => expectWholeObserved(observed)).toThrow();
  };

  it(
    'fail when a tool result is missing',
    breaks((o) => o.segments.splice(1, 1)),
  );
  it(
    'fail when a tool result comes before its call',
    breaks((o) => o.segments.reverse()),
  );
  it(
    'fail when toolCalls misses a call',
    breaks((o) => o.toolCalls.pop()),
  );
  it(
    'fail when toolCalls and the tool result disagree on the output',
    breaks((o) => {
      const call = o.toolCalls[0];
      if (call) call.output = { found: false };
    }),
  );
  it(
    'fail when an error stays out of the tool result',
    breaks((o) => {
      const call = o.toolCalls[0];
      if (call) call.error = 'timeout';
    }),
  );
  it(
    'fail when text is not the text segments joined',
    breaks((o) => o.segments.push({ type: 'text', text: 'A second message.' })),
  );
  it(
    'fail when latency is missing',
    breaks((o) => {
      (o as { latencyMs?: number }).latencyMs = undefined;
    }),
  );
});

describe('function adapter end states', () => {
  it('lists every payload in order for source *, and the last one of a tool for tool:<label>', async () => {
    const log = [
      { tool: 'notify_sales', input: { reason: 'callback' } },
      { tool: 'order.create', input: { plan_id: 'mobile-m' } },
      { tool: 'order.create', input: { plan_id: 'mobile-l' } },
    ];
    const adapter = functionAdapter({ respond: () => reply('ok'), payloads: () => log });
    const session = await adapter.open(acmeGiven(target));
    const all = (await adapter.endState?.(session, '*')) as typeof log;
    expect(all).toEqual(log);
    expect(await adapter.endState?.(session, 'tool:order.create')).toEqual({ plan_id: 'mobile-l' });
    const first = all[0]?.input as { reason: string };
    first.reason = 'changed';
    expect(log[0]?.input, 'the payloads are copies').toEqual({ reason: 'callback' });
  });
});

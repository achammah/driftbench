import { type AdapterCapabilities, type AgentAdapter, capabilityGap } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { describe, expect, it } from 'vitest';
import {
  anthropicAdapter,
  claudeCodeLiveAdapter,
  crewaiAdapter,
  functionAdapter,
  googleAdapter,
  httpAdapter,
  langgraphAdapter,
  litellmAdapter,
  nexusAdapter,
  openaiAgentsAdapter,
  processAdapter,
  pydanticAiAdapter,
  replayAdapter,
  vercelAiAdapter,
} from '../src/index';

/**
 * Blast-radius audit (PR 428): the capability check turns a layer an adapter cannot apply into not_run. It
 * reads each adapter's declared seedPrefix and toolStubs, so this pins what every adapter under
 * packages/adapters/src declares, and what the check then decides for a written prefix, the canonical
 * history of mode T and a forced tool result. The options only build the adapter: nothing is sent.
 */
const unused = {} as never;
const ADAPTERS: Record<string, () => AgentAdapter> = {
  anthropic: () => anthropicAdapter({ client: unused, model: 'm' }),
  'claude-code (live)': () =>
    claudeCodeLiveAdapter({ command: 'true', estateRoot: '.', provider: localProvider() }),
  'claude-code (replay)': () => replayAdapter({ session: { blocks: [] } as never }),
  crewai: () => crewaiAdapter({ transport: unused }),
  function: () =>
    functionAdapter({ respond: () => ({ segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 }) }),
  google: () => googleAdapter({ client: unused, model: 'm' }),
  http: () => httpAdapter({ url: 'http://127.0.0.1:9/never' }),
  'http (toolStubs)': () =>
    httpAdapter({ url: 'http://127.0.0.1:9/never', capabilities: { toolStubs: true } }),
  langgraph: () => langgraphAdapter({ graph: unused }),
  litellm: () => litellmAdapter({ client: unused, model: 'm' }),
  nexus: () =>
    nexusAdapter({ env: { NEXUS_API_KEY: 'not-a-real-key' }, fetch: async () => new Response('{}') }),
  'openai-agents': () => openaiAgentsAdapter({ runner: unused, agent: unused }),
  process: () => processAdapter({ command: 'true', provider: localProvider() }),
  'pydantic-ai': () => pydanticAiAdapter({ agent: 'acme.agent:sales' }),
  'vercel-ai': () => vercelAiAdapter({ generateText: unused, model: unused }),
};

/** What each adapter declares: [seedPrefix, toolStubs]. */
const DECLARED: Record<string, [boolean, boolean]> = {
  anthropic: [true, true],
  'claude-code (live)': [false, false],
  'claude-code (replay)': [true, false],
  crewai: [true, false],
  function: [true, true],
  google: [true, true],
  http: [true, false],
  'http (toolStubs)': [true, true],
  langgraph: [true, false],
  litellm: [true, true],
  nexus: [false, false],
  'openai-agents': [true, false],
  process: [true, false],
  'pydantic-ai': [true, false],
  'vercel-ai': [true, true],
};

describe('blast radius: the capability check over every adapter', () => {
  const declared = Object.fromEntries(
    Object.entries(ADAPTERS).map(([name, make]) => [name, make().capabilities()]),
  ) as Record<string, AdapterCapabilities>;

  it('every adapter declares seedPrefix and toolStubs as booleans, as pinned here', () => {
    expect(Object.keys(declared).sort()).toEqual(Object.keys(DECLARED).sort());
    for (const [name, capabilities] of Object.entries(declared)) {
      expect([capabilities.seedPrefix, capabilities.toolStubs], name).toEqual(DECLARED[name]);
    }
  });

  it('a written prefix and the canonical history are not_run exactly where seedPrefix is false', () => {
    for (const [name, capabilities] of Object.entries(declared)) {
      for (const prefix of ['authored', 'canonical'] as const) {
        const gap = capabilityGap(name, capabilities, { prefix, world: {} });
        expect(gap === undefined, `${name} ${prefix}`).toBe(capabilities.seedPrefix);
        if (gap) expect(gap).toMatchObject({ kind: 'unsupported', layer: '1 history', check: 'capability' });
      }
    }
  });

  it('a forced tool result is not_run exactly where toolStubs is false; no layer, no gap', () => {
    const forced = { tools: { lookup: { error: 'timeout' } } };
    for (const [name, capabilities] of Object.entries(declared)) {
      const gap = capabilityGap(name, capabilities, { world: forced });
      expect(gap === undefined, name).toBe(capabilities.toolStubs);
      if (gap) expect(gap.got).toBe(`${name} declares toolStubs false: the agent would never see it`);
      expect(capabilityGap(name, capabilities, { world: {} }), name).toBeUndefined();
    }
  });
});

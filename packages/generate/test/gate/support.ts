import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks, type ToolReplayer } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type BlockSpec,
  contentHash,
  type Message,
  type Observed,
  type Spec,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import {
  type Candidate,
  type FaultDef,
  GATE_DEFAULTS,
  type GateInput,
  type GateOptions,
  runGate,
} from '../../src/gate';

/**
 * A toy shop agent for the gate tests: deterministic, in process. "order the red one" orders sku-7,
 * "order the blue one" sku-9; the order goes through the tool order.create and its stage becomes
 * ordered. "hello" greets at stage start; anything else gets "Sorry?" at stage start. Fictional data only.
 */
export const SKUS: Record<string, string> = { red: 'sku-7', blue: 'sku-9' };

export type ShopBehaviour = {
  /** Changes the sku the agent orders. */
  sku?: (sku: string) => string;
  /** Leaves out the order.create call (the reply still says it ordered). */
  dropCall?: boolean;
  /** Replaces the reply. */
  reply?: (text: string) => string;
  /** A stage per call, for a flaky agent. */
  stage?: (call: number, stage: string) => string;
};

export function shopRespond(messages: Message[], behaviour: ShopBehaviour, call: number): Observed {
  const text = messages.at(-1)?.content ?? '';
  const colour = /order the (\w+) one/i.exec(text)?.[1]?.toLowerCase();
  let reply = 'Sorry?';
  let stage = 'start';
  const toolCalls: Observed['toolCalls'] = [];
  const segments: Observed['segments'] = [];
  if (colour && SKUS[colour]) {
    const sku = behaviour.sku ? behaviour.sku(SKUS[colour] as string) : (SKUS[colour] as string);
    if (!behaviour.dropCall) {
      const output = { order_id: 'ord-1', sku };
      segments.push({ type: 'tool_call', id: 'call-1', label: 'order.create', input: { sku } });
      segments.push({ type: 'tool_result', id: 'call-1', label: 'order.create', output });
      toolCalls.push({ id: 'call-1', label: 'order.create', input: { sku }, output });
    }
    reply = `Ordered the ${colour} one. Your order id is ord-1.`;
    stage = 'ordered';
  } else if (/hello/i.test(text)) {
    reply = 'Hi. What would you like to order today?';
  }
  if (behaviour.reply) reply = behaviour.reply(reply);
  if (behaviour.stage) stage = behaviour.stage(call, stage);
  segments.push({ type: 'text', text: reply });
  return {
    segments,
    text: reply,
    toolCalls,
    runtime: { stages: [{ name: stage }] },
    cost: { usd: 0 },
    latencyMs: 0,
  };
}

/**
 * The shop's `order.create` as a replayer for the value check: it takes a known sku and echoes it, and refuses any
 * other. A wrong sku is then a fail of the tools check, not an undecided value.
 */
export function shopReplayer(): ToolReplayer {
  const known = new Set(Object.values(SKUS));
  return {
    declaration: (tool) => (tool === 'order.create' ? { resolved: ['sku'], distractors: true } : undefined),
    call: (_tool, input) =>
      typeof input.sku === 'string' && known.has(input.sku)
        ? { ok: true, output: { order_id: 'ord-1', sku: input.sku } }
        : { ok: false, error: `unknown sku: ${String(input.sku)}` },
  };
}

/** The checks of the gate tests: the defaults, with the shop's tool replayed by the value check. */
export function shopChecks() {
  return defaultChecks({ valueCheck: { services: { replayer: shopReplayer() } } });
}

/** The shop agent behind the function adapter, with its payload log as the end-state source. */
export function shopAdapter(behaviour: ShopBehaviour = {}): AgentAdapter {
  let calls = 0;
  type Session = { payloads: { tool: string; input: unknown }[] };
  return functionAdapter<Session>({
    create: () => ({ payloads: [] }),
    respond: (messages, _world, _vars, session) => {
      const observed = shopRespond(messages, behaviour, calls++);
      for (const call of observed.toolCalls) session.payloads.push({ tool: call.label, input: call.input });
      return observed;
    },
    payloads: (session) => session.payloads,
    deterministic: true,
  });
}

/** A fault on the shop agent. */
export function shopFault(
  id: string,
  kind: FaultDef['kind'],
  klass: FaultDef['class'],
  affects: FaultDef['affects'],
  behaviour: ShopBehaviour,
): { def: FaultDef; adapter: AgentAdapter } {
  const def: FaultDef = {
    id,
    kind,
    class: klass,
    target: 'function:shop',
    affects,
    description: `test fault ${id}`,
    agent: {
      kind: 'function',
      create: () => {
        const payloads: { tool: string; input: unknown }[] = [];
        let calls = 0;
        return {
          respond: async (messages) => {
            const observed = shopRespond(messages, behaviour, calls++);
            for (const call of observed.toolCalls) payloads.push({ tool: call.label, input: call.input });
            return observed;
          },
          payloads: () => payloads,
        };
      },
    },
  };
  return { def, adapter: shopAdapter(behaviour) };
}

/** The standard fault set of the tests: a wrong sku, a dropped call, a wrong-language reply, a control. */
export function shopFaults() {
  return [
    shopFault('wrong-sku', 'drift', 'X1_local', ['tools', 'end_state'], { sku: (sku) => `${sku}-x` }),
    shopFault('drops-call', 'drift', 'X5_tool', ['tools', 'end_state'], { dropCall: true }),
    shopFault('french', 'drift', 'X4_format', ['text', 'lang'], {
      reply: () => 'Bonjour, voici votre commande, merci beaucoup et bonne journée à vous.',
    }),
    shopFault('noop', 'drift', 'X3_flow', ['stage'], {}),
    shopFault('control', 'control', 'control', [], {}),
  ];
}

/** A valid spec from a partial one: id, blocks and the rest; the loader's defaults applied. */
export function makeSpec(partial: Partial<Spec> & { id: string; blocks: BlockSpec[] }): Spec {
  const result = validateSpec({ kind: 'conversation', ...partial });
  if (!result.ok) throw new Error(`invalid test spec ${partial.id}: ${JSON.stringify(result.errors)}`);
  return result.spec;
}

export function candidate(spec: Spec, path = `${spec.id}.yaml`): Candidate {
  return { spec, hash: contentHash(spec), path };
}

/** A generated spec's metadata: seeder, family and one cell per block. */
export function generated(
  seeder: string,
  blocks: { block: string; cell: Record<string, string> }[],
  extra: Record<string, unknown> = {},
): Spec['metadata'] {
  return {
    generated: {
      by: 'test generator',
      seeder,
      seed: 1,
      map: { path: 'map.yaml', hash: 'map-hash-1' },
      cell: {},
      blocks: blocks.map((entry) => ({
        block: entry.block,
        seeder,
        cell: { spec: 'metadata.generated.cell', ...entry.cell },
      })),
      ...extra,
    },
  };
}

export const OPTIONS: GateOptions = {
  ...GATE_DEFAULTS,
  k: 3,
  date: '2026-10-11',
  wording: {
    dimensions: [...GATE_DEFAULTS.wording.dimensions],
    deviations: [...GATE_DEFAULTS.wording.deviations],
  },
};

export async function gate(
  specs: Spec[],
  overrides: Partial<Omit<GateInput, 'candidates' | 'options'>> & { options?: Partial<GateOptions> } = {},
) {
  const { options, ...rest } = overrides;
  return runGate({
    candidates: specs.map((spec) => candidate(spec)),
    targetOf: () => 'function:shop',
    references: new Map([['function:shop', shopAdapter()]]),
    faults: shopFaults(),
    run: { checks: shopChecks(), driver: createScriptedDriver },
    ...rest,
    options: { ...OPTIONS, ...(options ?? {}) },
  });
}

/** The block that orders the red one, expecting sku-7 through order.create at stage ordered. */
export function orderBlock(id = 'order'): BlockSpec {
  return {
    id,
    when: { user: 'Please order the red one.' },
    expect: { stage: 'ordered', tools: [{ label: 'order.create', count: 1, input: { sku: 'sku-7' } }] },
  };
}

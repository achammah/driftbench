import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { type BlocksProduct, maybe, need } from './product';

/**
 * The scenario harness of the blocks bank: seeded draws, a fictional bike rental shop (Larkspur Cycles: no
 * real company, person or address), a builder for what the agent observably did, and a scripted agent behind
 * the product's own function adapter. Every item builds its scenario here and runs it through the product's
 * runner, loader and checks, so a defect of the harness shows in many items at once.
 */

export type Rng = () => number;

/** A generator for one purpose of one seed: the seed mixed with the tag's hash. */
export function rngFor(seed: number, tag: string): Rng {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return mulberry32((Math.imul(seed >>> 0, 0x9e3779b1) ^ hash) >>> 0);
}

export function between(rng: Rng, low: number, high: number): number {
  return low + Math.floor(rng() * (high - low + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: no item to draw from');
  return items[Math.floor(rng() * items.length)] as T;
}

export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [out[index], out[other]] = [out[other] as T, out[index] as T];
  }
  return out;
}

/** The fictional shop every scenario plays in. */
export const SHOP = {
  customers: ['Ilse Varga', 'Tomas Brell', 'Oona Petrak', 'Rafe Lindqvist', 'Mila Ostrova', 'Pell Arden'],
  bikes: ['Fern 3', 'Kestrel XL', 'Moss Cargo', 'Tern Light', 'Alder Road', 'Quill City'],
  tools: ['bikes.lookup', 'booking.create', 'booking.cancel', 'customer.find', 'payment.charge'],
  stages: ['greet', 'offer', 'confirm', 'pay', 'done'],
} as const;

/** A code unique to a seed, a tag and a position: what a reply must say to pass its `must`. */
export function code(seed: number, tag: string, index: number): string {
  const rng = rngFor(seed, `${tag}#code#${index}`);
  return `LK-${between(rng, 1000, 9999)}-${String.fromCharCode(65 + between(rng, 0, 25))}${index}`;
}

export type RawSpec = Record<string, unknown> & { id: string; blocks: Record<string, unknown>[] };

export type Call = { label: string; input?: Record<string, unknown>; output?: unknown; error?: string };

/** What the agent observably did in one block: its text, its tool calls with their results, its stage. */
export function observed(text: string, calls: readonly Call[] = [], stage?: string): Record<string, unknown> {
  const segments: Record<string, unknown>[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  calls.forEach((call, index) => {
    const id = `call-${index}`;
    segments.push({ type: 'tool_call', id, label: call.label, input: call.input ?? {} });
    if (call.error !== undefined) {
      segments.push({ type: 'tool_result', id, label: call.label, output: null, error: call.error });
      toolCalls.push({ id, label: call.label, input: call.input ?? {}, error: call.error });
    } else {
      segments.push({ type: 'tool_result', id, label: call.label, output: call.output ?? { ok: true } });
      toolCalls.push({ id, label: call.label, input: call.input ?? {}, output: call.output ?? { ok: true } });
    }
  });
  segments.push({ type: 'text', text });
  return {
    segments,
    text,
    toolCalls,
    ...(stage ? { runtime: { stages: [{ name: stage }] } } : {}),
    cost: { usd: 0 },
    latencyMs: 0,
  };
}

/** One message the agent received, as the adapter handed it over. */
export type Seen = {
  role: string;
  content: string;
  tool_calls?: { id?: string; label: string; input?: unknown; output?: unknown; error?: unknown }[];
};

/** What one block of the agent sees: the history, the world, the vars and the text of the current user turn. */
export type Turn = {
  messages: readonly Seen[];
  world: Record<string, unknown>;
  vars: Record<string, unknown>;
  user: string;
};

export type Behaviour = (turn: Turn) => Record<string, unknown>;

/** The text of the user turn the history ends with: the user messages after the last other message. */
export function lastUser(messages: readonly Seen[]): string {
  const texts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') break;
    texts.unshift(message.content);
  }
  return texts.join('\n');
}

export type AgentLog = { turns: Turn[] };

export type Capabilities = { seedPrefix?: boolean; toolStubs?: boolean };

/**
 * A scripted agent behind the product's function adapter. `behave` answers each turn; every turn it saw is
 * logged, so an item can compare what reached the agent with what the spec wrote. `capabilities` turns a
 * capability off, as an adapter that cannot seed a prefix or stub a tool would declare it.
 */
export function scriptedAdapter(
  product: BlocksProduct,
  behave: Behaviour,
  options: { capabilities?: Capabilities; log?: AgentLog; version?: string } = {},
): Record<string, unknown> {
  const functionAdapter = need<(options: Record<string, unknown>) => Record<string, unknown>>(
    product.adapters,
    'adapters',
    'functionAdapter',
  );
  type State = { payloads: { tool: string; input: unknown }[] };
  const adapter = functionAdapter({
    create: (): State => ({ payloads: [] }),
    // Every successful call is a payload, so `end_state` reads `tool:<label>` from what the agent did.
    payloads: (state: State) => state.payloads,
    respond: (
      messages: Seen[],
      world: Record<string, unknown>,
      vars: Record<string, unknown>,
      state: State,
    ) => {
      const turn: Turn = {
        messages: structuredClone(messages),
        world: structuredClone(world),
        vars: structuredClone(vars),
        user: lastUser(messages),
      };
      options.log?.turns.push(turn);
      const reply = behave(turn);
      for (const call of (reply.toolCalls ?? []) as { label: string; input: unknown; error?: unknown }[])
        if (call.error === undefined) state.payloads.push({ tool: call.label, input: call.input });
      return reply;
    },
    deterministic: true,
    version: options.version ?? 'blocks-bank',
  });
  const off = options.capabilities;
  if (!off) return adapter;
  const base = adapter.capabilities as () => Record<string, boolean>;
  return {
    ...adapter,
    capabilities: () => ({
      ...base(),
      ...(off.seedPrefix === false ? { seedPrefix: false } : {}),
      ...(off.toolStubs === false ? { toolStubs: false } : {}),
    }),
  };
}

/** The behaviour keyed by the user text: each block's text names its own reply. Unknown text throws. */
export function byText(replies: ReadonlyMap<string, (turn: Turn) => Record<string, unknown>>): Behaviour {
  return (turn) => {
    for (const [key, reply] of replies) if (turn.user.includes(key)) return reply(turn);
    throw new Error(`the scripted agent has no reply for "${turn.user.slice(0, 80)}"`);
  };
}

export type Loaded = Record<string, unknown>;

/**
 * The product's documented start for a caller that loads specs itself: the shipped objects join the object
 * registry (the command line does the same at its start). Absent on a product without objects.
 */
export function initialize(product: BlocksProduct): void {
  maybe<() => void>(product.checks, 'initializeShippedObjects')?.();
}

/** A raw spec through the product's loader; a refusal throws with the loader's first issues. */
/**
 * The same spec with the keys of every object in a seeded order: a product must read a spec by its keys, never
 * by their order or by the bytes of its serialisation. Arrays keep their order.
 */
export function shuffleKeys<T>(value: T, rng: Rng): T {
  if (Array.isArray(value)) return value.map((each) => shuffleKeys(each, rng)) as T;
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [entries[index], entries[other]] = [
      entries[other] as [string, unknown],
      entries[index] as [string, unknown],
    ];
  }
  return Object.fromEntries(entries.map(([key, each]) => [key, shuffleKeys(each, rng)])) as T;
}

/**
 * JSON with the keys of every object sorted, arrays in order: two values that hold the same keys and values
 * compare equal, whatever order their keys came in. The bank shuffles spec keys, so a check of a value the
 * product hands on compares it this way (no doc fixes the key order of what reaches the agent).
 */
export function canonical(value: unknown): string {
  const sort = (each: unknown): unknown =>
    Array.isArray(each)
      ? each.map(sort)
      : each !== null && typeof each === 'object'
        ? Object.fromEntries(
            Object.keys(each as Record<string, unknown>)
              .sort()
              .map((key) => [key, sort((each as Record<string, unknown>)[key])]),
          )
        : each;
  return JSON.stringify(sort(value)) ?? 'undefined';
}

const shaken = <T>(raw: T): T =>
  shuffleKeys(raw, rngFor(0, `keys#${String((raw as { id?: unknown })?.id ?? '')}`));

export function load(product: BlocksProduct, raw: RawSpec): Loaded {
  initialize(product);
  const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
    product.core,
    'core',
    'validateSpec',
  );
  const result = validateSpec(shaken(raw), `blocks:${raw.id}`);
  if (result.ok !== true) {
    const errors = (result.errors as { path: string; code?: string; message: string }[])
      .slice(0, 3)
      .map((issue) => `${issue.path}: ${issue.code ?? ''} ${issue.message}`);
    throw new Error(`the loader refuses ${raw.id}: ${errors.join('; ')}`);
  }
  return result.spec as Loaded;
}

/** The loader's answer without throwing: ok, or the codes of its errors. */
export function loadIssues(product: BlocksProduct, raw: unknown): { ok: boolean; codes: string[] } {
  initialize(product);
  const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
    product.core,
    'core',
    'validateSpec',
  );
  const result = validateSpec(shaken(raw), 'blocks:issues');
  if (result.ok === true) return { ok: true, codes: [] };
  return { ok: false, codes: (result.errors as { code?: string }[]).map((issue) => issue.code ?? '') };
}

export type BlockRecord = {
  index: number;
  blockId?: string;
  pass: boolean;
  status?: string;
  notRun?: { kind: string; layer: string; check: string; expected: string; got: string };
  blocked?: { by: string; root: string };
  givenHash: string;
  verdicts: { id: string; outcome: string; gating: boolean; by?: Record<string, unknown> }[];
  observed: Record<string, unknown>;
};

export type RunRecord = {
  runId?: string;
  specId: string;
  specHash: string;
  mode: string;
  repeat: number;
  status: string;
  target: Record<string, unknown>;
  blocks: BlockRecord[];
  endState?: { match: boolean };
  [key: string]: unknown;
};

/** One run of a raw spec on an adapter, through the product's runner, scripted driver and default checks. */
export async function run(
  product: BlocksProduct,
  raw: RawSpec,
  adapter: Record<string, unknown>,
  options: {
    mode?: 'F' | 'T';
    repeat?: number;
    store?: unknown;
    campaignId?: string;
    target?: Record<string, unknown>;
    cache?: unknown;
    /** A user driver in place of the scripted one: a simulated user, for instance. */
    driver?: unknown;
  } = {},
): Promise<RunRecord> {
  const spec = load(product, raw);
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    product.core,
    'core',
    'runSpec',
  );
  const createScriptedDriver = need<() => unknown>(product.users, 'users', 'createScriptedDriver');
  const defaultChecks = need<() => unknown>(product.checks, 'checks', 'defaultChecks');
  const defaultReaders = need<() => unknown>(product.artifacts, 'artifacts', 'defaultReaders');
  return runSpec(spec, {
    adapter,
    driver: options.driver ?? createScriptedDriver(),
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    mode: options.mode ?? 'F',
    repeat: options.repeat ?? 0,
    ...(options.store ? { store: options.store, campaignId: options.campaignId ?? 'blocks' } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
  });
}

/** The verdict of a block by the product's own reader. */
export function statusOf(product: BlocksProduct, block: BlockRecord): string {
  return need<(block: BlockRecord) => string>(product.core, 'core', 'blockStatus')(block);
}

/** The verdict of a run by the product's own reader. */
export function outcomeOf(product: BlocksProduct, record: RunRecord): string {
  return need<(run: RunRecord) => string>(product.core, 'core', 'runOutcome')(record);
}

/** A short list for an item's detail. */
export function list(values: readonly unknown[], max = 8): string {
  const shown = values
    .slice(0, max)
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)));
  return values.length > max ? `${shown.join(', ')} (${values.length - max} more)` : shown.join(', ');
}

import {
  type AgentLog,
  type BlockRecord,
  between,
  type Call,
  type Capabilities,
  canonical,
  initialize,
  type Loaded,
  lastUser,
  list,
  load,
  observed,
  type RawSpec,
  type Rng,
  type RunRecord,
  rngFor,
  type Seen,
  scriptedAdapter,
  shuffled,
  type Turn,
} from '../blocks/harness';
import { type BlocksProduct, need } from '../blocks/product';
import {
  type BankItem,
  expectAll,
  fail,
  type ItemContext,
  type ItemResult,
  PASS,
  type Tier,
} from '../blocks/types';
import { CAUSES, type CauseKey } from './causes';

export type {
  AgentLog,
  BankItem,
  BlockRecord,
  Call,
  ItemContext,
  ItemResult,
  Loaded,
  RawSpec,
  Rng,
  RunRecord,
  Seen,
  Tier,
  Turn,
};
export { between, expectAll, fail, list, PASS };

/**
 * The scenario kit of the breaker bank (breaker-items.md): seeded words, a spec of blocks whose replies a scripted
 * agent plays by user word, runs in the three modes through the product's own runner, and readers of the record.
 * Every name the product reads is a seeded word of letters: nothing it sees says what an item expects.
 */

const LETTERS = 'abcdefghjkmnpqrstuvwxyz';

/** A seeded word of letters only: no digit can read as a number or an identifier, no name tells the truth. */
export function word(seed: number, tag: string, length = 7): string {
  const rng = rngFor(seed, `bk:${tag}`);
  let out = '';
  for (let index = 0; index < length; index += 1) out += LETTERS[Math.floor(rng() * LETTERS.length)];
  return out;
}

/** The same value with the keys of every object in a seeded random order. */
export function scramble<T>(rng: Rng, value: T): T {
  if (Array.isArray(value)) return value.map((entry) => scramble(rng, entry)) as T;
  if (value !== null && typeof value === 'object') {
    const entries = shuffled(rng, Object.entries(value as Record<string, unknown>));
    return Object.fromEntries(entries.map(([key, entry]) => [key, scramble(rng, entry)])) as T;
  }
  return value;
}

export const times = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, i) => make(i));

export const call = (
  label: string,
  input: Record<string, unknown> = {},
  extra: Partial<Call> = {},
): Call => ({
  label,
  input,
  ...extra,
});

/** What the agent does in one block. */
export type Plan = {
  text: string;
  calls?: Call[];
  stage?: string;
  /** Fields that replace fields of the Observed the agent returns (`cost`, `latencyMs`, `executions`). */
  extra?: Record<string, unknown>;
  /** Builds the whole Observed from the turn handed to the agent. */
  reply?: (turn: Turn) => Record<string, unknown>;
};

export type BlockDef = {
  expect?: Record<string, unknown>;
  given?: Record<string, unknown>;
  plan: Plan;
  /** Send the block as a burst of two messages. */
  burst?: boolean;
  /** Extra keys of the block itself (`parent`, for instance). */
  extra?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  /** The words the user writes, built around the block's marker word (the agent finds its plan by the marker). */
  say?: (marker: string) => string | [string, string];
};

export type Scenario = {
  raw: RawSpec;
  /** The first user message of each block. */
  users: string[];
  /** The second message of a burst block. */
  seconds: string[];
  ids: string[];
  plans: Map<string, Plan>;
};

export function scenario(
  seed: number,
  tag: string,
  defs: readonly BlockDef[],
  spec: Record<string, unknown> = {},
): Scenario {
  const users: string[] = [];
  const seconds: string[] = [];
  const ids: string[] = [];
  const plans = new Map<string, Plan>();
  const blocks = defs.map((def, index) => {
    const user = word(seed, `${tag}:user:${index}`, 9);
    const second = word(seed, `${tag}:user2:${index}`, 9);
    const id = word(seed, `${tag}:block:${index}`, 6);
    users.push(user);
    seconds.push(second);
    ids.push(id);
    plans.set(user, def.plan);
    const said = def.say?.(user);
    return {
      id,
      ...(Array.isArray(said)
        ? { burst: said }
        : said !== undefined
          ? { user: said }
          : def.burst
            ? { burst: [user, second] }
            : { user }),
      ...(def.given ? { given: def.given } : {}),
      ...(def.expect ? { expect: def.expect } : {}),
      ...(def.budget ? { budget: def.budget } : {}),
      ...(def.extra ?? {}),
    };
  });
  const raw: RawSpec = { id: word(seed, `${tag}:spec`, 8), ...spec, blocks };
  return { raw, users, seconds, ids, plans };
}

/** The agent: finds the plan by the user word the turn carries and returns what the plan says. */
export function behaviour(sc: Scenario, rng: Rng) {
  return (turn: Turn): Record<string, unknown> => {
    for (const [key, plan] of sc.plans) {
      if (turn.user.includes(key)) {
        if (plan.reply) return plan.reply(turn);
        const calls = plan.calls?.map((each) => scramble(rng, each));
        return { ...observed(plan.text, calls ?? [], plan.stage), ...(plan.extra ?? {}) };
      }
    }
    throw new Error('the scripted agent was sent a turn it has no reply for');
  };
}

export type Played = { rec: RunRecord; log: AgentLog; spec: Loaded };

export type RunOptions = {
  mode?: 'F' | 'T' | 'P';
  repeat?: number;
  driver?: unknown;
  perturbationId?: string;
  reference?: unknown;
  consequential?: (label: string) => boolean;
  cache?: unknown;
};

/** One run of a loaded spec through the product's runner, scripted driver and default checks. */
export async function runLoaded(
  product: BlocksProduct,
  spec: Loaded,
  adapter: Record<string, unknown>,
  options: RunOptions = {},
): Promise<RunRecord> {
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
    ...(options.perturbationId ? { perturbationId: options.perturbationId } : {}),
    ...(options.reference ? { reference: options.reference } : {}),
    ...(options.consequential ? { consequential: options.consequential } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
  });
}

/** The scripted driver with one of the spec's perturbations injected (the injecting driver of the core package). */
export function injecting(product: BlocksProduct, perturbationId: string): unknown {
  const injectingDriver = need<(base: unknown, id: string) => unknown>(
    product.core,
    'core',
    'injectingDriver',
  );
  const createScriptedDriver = need<() => unknown>(product.users, 'users', 'createScriptedDriver');
  return injectingDriver(createScriptedDriver(), perturbationId);
}

export async function play(
  ctx: ItemContext,
  sc: Scenario,
  options: RunOptions & { capabilities?: Capabilities } = {},
): Promise<Played> {
  const log: AgentLog = { turns: [] };
  const rng = rngFor(ctx.seed, `bk:${sc.raw.id}:agent`);
  const adapter = scriptedAdapter(ctx.product, behaviour(sc, rng), {
    log,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });
  const spec = load(ctx.product, sc.raw);
  const rec = await runLoaded(ctx.product, spec, adapter, options);
  return { rec, log, spec };
}

/** A P run: the spec's perturbation `id` injected by the injecting driver. */
export async function playP(
  ctx: ItemContext,
  sc: Scenario,
  perturbationId: string,
  options: RunOptions & { capabilities?: Capabilities } = {},
): Promise<Played> {
  return play(ctx, sc, {
    ...options,
    mode: options.mode ?? 'P',
    driver: injecting(ctx.product, perturbationId),
    perturbationId,
  });
}

/** An agent whose `respond` is handed the live arguments the runner passes, beside a clone taken on entry. */
export function liveAgent(
  product: BlocksProduct,
  respond: (
    turn: Turn,
    live: { messages: Seen[]; world: Record<string, unknown>; vars: Record<string, unknown> },
  ) => Record<string, unknown>,
  log: AgentLog = { turns: [] },
): Record<string, unknown> {
  const functionAdapter = need<(options: Record<string, unknown>) => Record<string, unknown>>(
    product.adapters,
    'adapters',
    'functionAdapter',
  );
  type State = { payloads: { tool: string; input: unknown }[] };
  return functionAdapter({
    create: (): State => ({ payloads: [] }),
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
      log.turns.push(turn);
      const reply = respond(turn, { messages, world, vars });
      for (const each of (reply.toolCalls ?? []) as { label: string; input: unknown; error?: unknown }[])
        if (each.error === undefined) state.payloads.push({ tool: each.label, input: each.input });
      return reply;
    },
    deterministic: true,
    version: 'blocks-breaker',
  });
}

/** An Observed whose segments come in the order given: text, call (with its result) or card parts. */
export function observedParts(
  parts: readonly ({ text: string } | { call: Call })[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const segments: Record<string, unknown>[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  const texts: string[] = [];
  let index = 0;
  for (const part of parts) {
    if ('text' in part) {
      segments.push({ type: 'text', text: part.text });
      texts.push(part.text);
    } else {
      const id = `call-${index}`;
      index += 1;
      segments.push({ type: 'tool_call', id, label: part.call.label, input: part.call.input ?? {} });
      segments.push({
        type: 'tool_result',
        id,
        label: part.call.label,
        output: part.call.output ?? { ok: true },
      });
      toolCalls.push({
        id,
        label: part.call.label,
        input: part.call.input ?? {},
        output: part.call.output ?? { ok: true },
      });
    }
  }
  return { segments, text: texts.join('\n'), toolCalls, cost: { usd: 0 }, latencyMs: 0, ...extra };
}

export const verdictOf = (block: BlockRecord | undefined, id: string) =>
  block?.verdicts.find((verdict) => verdict.id === id);
export const outcomeOfId = (block: BlockRecord | undefined, id: string) =>
  verdictOf(block, id)?.outcome ?? 'absent';
export const failingIds = (block: BlockRecord | undefined) =>
  (block?.verdicts ?? []).filter((verdict) => verdict.outcome === 'fail').map((verdict) => verdict.id);
export const idsOf = (block: BlockRecord | undefined) => (block?.verdicts ?? []).map((verdict) => verdict.id);

export const runOutcome = (product: BlocksProduct, rec: RunRecord): string =>
  need<(run: RunRecord) => string>(product.core, 'core', 'runOutcome')(rec);
export const blockStatus = (product: BlocksProduct, block: BlockRecord): string =>
  need<(block: BlockRecord) => string>(product.core, 'core', 'blockStatus')(block);

/** The turns' messages as `role:content` lines, for a comparison that reads well in a detail. */
export const lines = (messages: readonly Seen[]): string[] =>
  messages.map((message) => `${message.role}:${message.content}`);

export const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

export const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

/** What the documentation says, what the product answered. */
export function say(doc: string, should: string, got: string): string {
  return `${should} (${doc}); the product answered: ${got}`;
}

type Check = (ctx: ItemContext) => Promise<ItemResult>;

/** An item of the breaker bank: its cause, tier, level and contract come from the cause key. */
export function item(
  family: string,
  id: string,
  tier: Tier,
  level: number,
  component: string,
  cause: CauseKey,
  title: string,
  check: Check,
): BankItem {
  const entry = CAUSES[cause];
  return {
    id,
    family,
    tier,
    level,
    component,
    title,
    cause: entry.text,
    contract: entry.contract,
    check: async (ctx) => {
      try {
        return await check(ctx);
      } catch (error) {
        // A loader that refuses a documented spec is a product answer, not a setup error of the item.
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('the loader refuses'))
          return fail(say('the shipped docs', 'a spec the docs define loads', message.slice(0, 220)));
        if (message.startsWith('the product has no export'))
          return fail(say('the shipped docs', 'the capability the docs define is exported', message));
        throw error;
      }
    },
  };
}

export const codeOf = (seed: number, tag: string, index: number) => word(seed, `${tag}:code:${index}`, 8);

/** n blocks whose replies carry their own code, each expecting it; `calls` adds tool calls to chosen blocks. */
export function blocks(
  seed: number,
  tag: string,
  n: number,
  calls: Record<number, ReturnType<typeof call>[]> = {},
  more: Record<number, Partial<BlockDef>> = {},
): BlockDef[] {
  return times(n, (i) => {
    const code = codeOf(seed, tag, i);
    const extra = more[i] ?? {};
    return {
      plan: { text: `Yes, ${code}.`, calls: calls[i] ?? [], ...(extra.plan ?? {}) },
      expect: { must: [code], ...(extra.expect ?? {}) },
      ...(extra.given ? { given: extra.given } : {}),
      ...(extra.burst ? { burst: extra.burst } : {}),
      ...(extra.extra ? { extra: extra.extra } : {}),
    };
  });
}

/**
 * A baseline run every item that reads only the loader or the lint also makes: two blocks, one that meets its
 * expectation and one that does not, must read pass then fail. A product that runs nothing, passes everything,
 * fails everything or blocks everything fails every item through it: an item no cheating product can fail
 * measures nothing (docs/validators.md section 13).
 */
export async function anchor(ctx: ItemContext): Promise<ItemResult> {
  const defs = blocks(ctx.seed, 'bk.anchor', 2);
  (defs[1] as BlockDef).plan = { text: 'Let me look.' };
  const { rec } = await play(ctx, scenario(ctx.seed, 'bk.anchor', defs), { mode: 'F' });
  const statuses = rec.blocks.map((block) => blockStatus(ctx.product, block));
  return statuses.length === 2 &&
    statuses[0] === 'pass' &&
    statuses[1] === 'fail' &&
    runOutcome(ctx.product, rec) === 'fail'
    ? PASS
    : fail(
        say(
          'docs/running.md "One block"',
          'a block that meets its expectation passes and one that does not fails',
          `statuses ${show(statuses)}`,
        ),
      );
}

/** The check with the baseline run first (see `anchor`). */
export function withAnchor(
  check: (ctx: ItemContext) => Promise<ItemResult>,
): (ctx: ItemContext) => Promise<ItemResult> {
  return async (ctx) => {
    const base = await anchor(ctx);
    return base.pass ? check(ctx) : base;
  };
}

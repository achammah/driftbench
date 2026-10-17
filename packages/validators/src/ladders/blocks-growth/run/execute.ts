import { type Behaviour, load, observed, scriptedAdapter } from '../../blocks/harness';
import { type BlocksProduct, need } from '../../blocks/product';
import type { Call, ItemContext, RunRecord, Scenario } from './kit';

/**
 * The runner of the growth items that watch a run from outside: the agent counts the calls it gets, throws the errors a
 * plan names on the attempts it names, and the run's events, waits and turns are kept for the item to read.
 */

export type Fault = (attempt: number) => Error | null;

export type Exec = {
  rec: RunRecord;
  /** Calls the agent received per user marker. */
  calls: Map<string, number>;
  /** Every turn the agent was handed, in order, with the number of history messages it held. */
  turns: { marker: string; history: number; text: string[] }[];
  events: Record<string, unknown>[];
  waits: number[];
};

export type Options = {
  retry?: Record<string, unknown>;
  cache?: unknown;
  maxSteps?: number;
  mode?: 'F' | 'T' | 'P';
  driver?: unknown;
  perturbationId?: string;
  onEvent?: (event: Record<string, unknown>) => void;
  repeat?: number;
  version?: string;
  /** Fields merged into the Observed the agent returns for a block (by spec block index). */
  merge?: Record<number, Record<string, unknown>>;
  wrapAdapter?: (adapter: Record<string, unknown>) => Record<string, unknown>;
};

export async function exec(
  ctx: ItemContext,
  sc: Scenario,
  faults: Record<number, Fault>,
  options: Options = {},
): Promise<Exec> {
  const calls = new Map<string, number>();
  const turns: Exec['turns'] = [];
  const waits: number[] = [];
  const events: Record<string, unknown>[] = [];
  const behave: Behaviour = (turn) => {
    const marker = [...sc.plans.keys()].find((key) => turn.user.includes(key));
    if (marker === undefined) throw new Error('the scripted agent was sent a turn it has no reply for');
    const index = sc.users.indexOf(marker);
    const attempt = (calls.get(marker) ?? 0) + 1;
    calls.set(marker, attempt);
    turns.push({
      marker,
      history: turn.messages.length,
      text: turn.messages.map((message) => `${message.role}:${message.content}`),
    });
    const error = faults[index]?.(attempt);
    if (error) throw error;
    const plan = sc.plans.get(marker) as { text: string; calls?: Call[] };
    return { ...observed(plan.text, plan.calls ?? []), ...(options.merge?.[index] ?? {}) };
  };
  const adapter = options.wrapAdapter
    ? options.wrapAdapter(
        scriptedAdapter(ctx.product, behave, options.version ? { version: options.version } : {}),
      )
    : scriptedAdapter(ctx.product, behave, options.version ? { version: options.version } : {});
  const spec = load(ctx.product, sc.raw);
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    ctx.product.core,
    'core',
    'runSpec',
  );
  const createScriptedDriver = need<() => unknown>(ctx.product.users, 'users', 'createScriptedDriver');
  const defaultChecks = need<() => unknown>(ctx.product.checks, 'checks', 'defaultChecks');
  const defaultReaders = need<() => unknown>(ctx.product.artifacts, 'artifacts', 'defaultReaders');
  const rec = await runSpec(spec, {
    adapter,
    driver: options.driver ?? createScriptedDriver(),
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    mode: options.mode ?? 'F',
    repeat: options.repeat ?? 0,
    ...(options.perturbationId ? { perturbationId: options.perturbationId } : {}),
    retry: { sleep: async (ms: number) => void waits.push(ms), random: () => 0.5, ...(options.retry ?? {}) },
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
    onEvent: (event: Record<string, unknown>) => {
      events.push(event);
      options.onEvent?.(event);
    },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
  });
  return { rec, calls, turns, events, waits };
}

/** A transport error of the core package with an HTTP status (or none), as an SDK would throw it. */
export function transport(
  product: BlocksProduct,
  message: string,
  status?: number,
  extra: Record<string, unknown> = {},
): Error {
  const Cls = need<new (message: string) => Error>(product.core, 'core', 'AdapterTransportError');
  const error = new Cls(message);
  return Object.assign(error, status === undefined ? {} : { status }, extra);
}

export const failOn =
  (times: number, make: () => Error): Fault =>
  (attempt) =>
    attempt <= times ? make() : null;

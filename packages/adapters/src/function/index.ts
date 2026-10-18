import { randomUUID } from 'node:crypto';
import {
  type AdapterCapabilities,
  type AgentAdapter,
  copyHistory,
  decideToolRule,
  deniesCall,
  type Message,
  type Observed,
  type ResolvedGiven,
  type Session,
  type TargetRef,
  type ToolRule,
  type Turn,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { asAgentError, parseObserved, readSource, type ToolPayload } from '../shared';

export type { ToolPayload } from '../shared';

/**
 * The function adapter: an agent that is an async function in the same process. No network, no key.
 *
 * Each block calls the function with the session history as it is (the runner has appended the block's
 * user messages, so it ends with the current user turn), the block's world and vars, and the session's own
 * state when `create` builds one. The function returns an Observed, which the adapter validates. The
 * history belongs to the runner: the adapter reads it and never appends to it. Each callback gets a fresh
 * array of the same deeply frozen messages. Copy a message before editing it; a write throws in strict
 * mode. World, vars and context.target remain copies; state remains the agent's own session state.
 */

export const FUNCTION_ADAPTER_VERSION = '0.1.0';

/** What the agent function is told besides the conversation: its target, and the prompt it runs with. */
export type AgentContext = {
  /** Runs a tool the agent calls. A tool the adapter's tool policy denies is refused first: the run function never runs, and the call rejects with the reason. */
  callTool: <T>(label: string, run: () => T | Promise<T>) => Promise<T>;
  target: TargetRef;
  /** `target.prompt.text`: the prompt version `campaign run --prompt` restored from the store. */
  prompt?: string;
};

/** The agent. Messages are shared and deeply frozen; the array is private. `state` is what `create` built. */
export type AgentFunction<S = undefined> = (
  messages: Message[],
  world: WorldState,
  vars: Record<string, unknown>,
  state: S,
  context: AgentContext,
) => Promise<Observed> | Observed;

export type FunctionAdapterOptions<S = undefined> = {
  /** A tool policy that the agent's context.callTool applies before each call. Absent: every call runs. */
  toolPolicy?: readonly ToolRule[];
  /** The agent, called once per block. `createAcmeAgent().respond` fits as it is. */
  respond: AgentFunction<S>;
  /** Builds per-session state, such as a fresh store, so nothing leaks between conversations. */
  create?: (given: ResolvedGiven) => S | Promise<S>;
  /** The payload log of the side-effecting tools, oldest first. Enables `endState` for `tool:<label>` and `*`. */
  payloads?: (state: S) => readonly ToolPayload[];
  /** Exports mutable agent state as seedable world and variables for parent blocks. `create` restores it from Given. */
  snapshotGiven?: (
    state: S,
  ) =>
    | { world: WorldState; vars: Record<string, unknown> }
    | Promise<{ world: WorldState; vars: Record<string, unknown> }>;
  /** True when the same input gives the same output. Default false. */
  deterministic?: boolean;
  /** The version the runner's cache key carries. Change it when the agent changes. Default the adapter's. */
  version?: string;
};

type FunctionState<S> = { readonly kind: 'function'; agent: S; closed: boolean };

export function functionAdapter<S = undefined>(options: FunctionAdapterOptions<S>): AgentAdapter {
  const id = 'function';
  const snapshotGiven = options.snapshotGiven;
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    toolStubs: true,
    trace: false,
    sandbox: false,
    endState: options.payloads !== undefined,
    deterministic: options.deterministic ?? false,
  };

  function own(session: Session): FunctionState<S> {
    const state = session.state as FunctionState<S> | undefined;
    if (session.adapter !== id || state?.kind !== 'function') {
      throw new Error(`session ${session.id} was not opened by the function adapter`);
    }
    if (state.closed) throw new Error(`session ${session.id} is closed`);
    return state;
  }

  return {
    id,
    version: options.version ?? FUNCTION_ADAPTER_VERSION,
    capabilities: () => ({ ...capabilities }),

    async open(given) {
      const history = copyHistory(given.prefix);
      let agent: S;
      try {
        agent = options.create ? await options.create(given) : (undefined as S);
      } catch (cause) {
        throw asAgentError(cause, 'the agent failed to start');
      }
      const state: FunctionState<S> = { kind: 'function', agent, closed: false };
      return {
        id: randomUUID(),
        adapter: id,
        target: given.target,
        given,
        history,
        state,
      };
    },

    async send(session, turn: Turn) {
      const state = own(session);
      let observed: Observed;
      try {
        observed = await options.respond(
          copyHistory(session.history),
          structuredClone(turn.given.world),
          structuredClone(turn.given.vars),
          state.agent,
          {
            callTool: async (label, run) => {
              const rule = options.toolPolicy ? decideToolRule(options.toolPolicy, label) : undefined;
              if (deniesCall(rule)) {
                throw new Error(
                  rule?.action === 'ask'
                    ? `tool policy rule ${rule.pattern} asks, and no approver answers, so the call is denied`
                    : `denied by tool policy rule ${rule?.pattern ?? ''}`,
                );
              }
              return run();
            },
            target: structuredClone(session.target),
            ...(session.target.prompt === undefined ? {} : { prompt: session.target.prompt.text }),
          },
        );
      } catch (cause) {
        throw asAgentError(cause, `the agent failed on block ${turn.index}`);
      }
      return parseObserved(observed, 'the agent');
    },

    async endState(session, source) {
      const state = own(session);
      const read = readSource(source, id);
      if (!options.payloads) throw new Error('the function adapter was given no payload log to read');
      const log = options.payloads(state.agent).map(
        (entry): ToolPayload => ({
          tool: entry.tool,
          input: structuredClone(entry.input),
        }),
      );
      if ('all' in read) return log;
      return log.reverse().find((entry) => entry.tool === read.tool)?.input;
    },

    ...(snapshotGiven
      ? {
          async snapshotGiven(session: Session) {
            return structuredClone(await snapshotGiven(own(session).agent));
          },
        }
      : {}),

    async close(session) {
      const state = session.state as FunctionState<S> | undefined;
      if (state?.kind !== 'function') return;
      state.closed = true;
      state.agent = undefined as S;
    },
  };
}

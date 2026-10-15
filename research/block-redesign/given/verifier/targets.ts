import type { WorldState } from '@agent-nexus/driftbench-core';
import { callTool, createStore, isToolLabel, type ToolOutcome } from '../../../../examples/acme/src/index';

/**
 * What the verifier knows about a run target: the capabilities its adapter declares (copied from the
 * adapter source at origin/main a7c3280c2, line cited), the tools the agent has, and, when the target's own
 * tools can be called offline, a runner for `history_matches_world`.
 */
export type TargetProfile = {
  id: string;
  /** Where the capabilities were read. */
  source: string;
  caps: { seedPrefix: boolean; toolStubs: boolean; sandbox: boolean; storeReachesAgent: boolean; states: boolean };
  /** The agent's tool labels; undefined when the set is open or unknown (no `tool_known` then). */
  tools?: ReadonlySet<string>;
  /** Runs one tool against a world without committing anything; undefined when no offline runner exists. */
  runTool?: (label: string, input: unknown, world: WorldState) => ToolOutcome;
};

const ACME_LABELS = new Set(['catalog.search', 'coverage.check', 'port.check', 'order.create', 'notify_sales']);

/** Claude Code built-in tool names an estate spec may name; mcp__* tools are open and always accepted. */
const CLAUDE_CODE_TOOLS = new Set([
  'Agent', 'Task', 'Bash', 'BashOutput', 'KillShell', 'Edit', 'MultiEdit', 'Write', 'Read', 'Glob', 'Grep',
  'LS', 'NotebookEdit', 'NotebookRead', 'TodoWrite', 'WebFetch', 'WebSearch', 'Skill', 'SlashCommand',
  'ExitPlanMode', 'AskUserQuestion', 'Monitor', 'ToolSearch',
]);

function acmeRunTool(label: string, input: unknown, world: WorldState): ToolOutcome {
  if (!isToolLabel(label)) return { ok: false, error: `unknown tool ${label}` };
  const forced = world.tools?.[label];
  if (forced?.error !== undefined) return { ok: false, error: forced.error };
  if (forced?.result !== undefined) return { ok: true, output: forced.result };
  return callTool(label, (input ?? {}) as Record<string, unknown>, {
    store: createStore(),
    seed: world.store,
    commit: false,
  });
}

export const PROFILES: Record<string, TargetProfile> = {
  'function:acme-sales': {
    id: 'function:acme-sales',
    source: 'packages/adapters/src/function/index.ts:71 (seedPrefix true, toolStubs true, sandbox false); the whole Given reaches user code',
    caps: { seedPrefix: true, toolStubs: true, sandbox: false, storeReachesAgent: true, states: false },
    tools: ACME_LABELS,
    runTool: acmeRunTool,
  },
  'process:acme-ops': {
    id: 'process:acme-ops',
    source: 'packages/adapters/src/process/index.ts:99 (seedPrefix false, toolStubs false, sandbox true)',
    caps: { seedPrefix: false, toolStubs: false, sandbox: true, storeReachesAgent: false, states: false },
  },
  'claude-code:': {
    id: 'claude-code:',
    source: 'packages/adapters/src/claude-code/live/adapter.ts:204 (seedPrefix false, toolStubs false); seeds world.workspace (:234); session_state via the state library (live/states.ts:220)',
    caps: { seedPrefix: false, toolStubs: false, sandbox: true, storeReachesAgent: false, states: true },
    tools: CLAUDE_CODE_TOOLS,
  },
  'http:echo': {
    id: 'http:echo',
    source: 'packages/adapters/src/http/index.ts:93 (seedPrefix true, toolStubs as configured, default false)',
    caps: { seedPrefix: true, toolStubs: false, sandbox: false, storeReachesAgent: false, states: false },
  },
};

/** The run target of a spec, per the pre-registration: its own target, else function:acme-sales under examples/acme/. */
export function runTargetOf(spec: { target?: { adapter: string; agent?: string } }, path: string): string | undefined {
  if (spec.target) return `${spec.target.adapter}:${spec.target.agent ?? ''}`;
  if (path.startsWith('examples/acme/')) return 'function:acme-sales';
  return undefined;
}

export function isToolOfTarget(profile: TargetProfile, label: string): boolean | undefined {
  if (!profile.tools) return undefined;
  if (profile.id === 'claude-code:' && label.startsWith('mcp__')) return true;
  return profile.tools.has(label);
}

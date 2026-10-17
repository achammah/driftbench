import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AgentLog,
  type Call,
  type Capabilities,
  lastUser,
  observed,
  type Rng,
  rngFor,
  type Seen,
  scriptedAdapter,
} from './harness';
import { type BlocksProduct, need } from './product';

/**
 * The two kinds of planted agent (the approved design): NORMAL, a sectioned prompt plus tools, where a scripted
 * fake replies and calls tools; CODE, a sectioned prompt plus a sandbox workspace, where a scripted fake writes
 * files, runs commands and exits behind the product's process adapter and a local sandbox. Both play an action
 * plan keyed by a neutral marker the block's instruction holds. The plan is behaviour only: the truth (each
 * block's verdict, cause, parent, blamed section, fix) stays in the item's memory and never reaches a file, a
 * spec, an id or the agent.
 */

export const KINDS = ['normal', 'code'] as const;
export type Kind = (typeof KINDS)[number];

/** A neutral token: what a block, a spec or a file is called. It carries no truth: a hash of the seed and a tag. */
export function token(seed: number, tag: string, length = 6): string {
  const rng = rngFor(seed, `token:${tag}`);
  let out = '';
  for (let i = 0; i < length; i += 1) out += 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rng() * 31)];
  return out;
}

/** A file the code agent writes: its path relative to the workspace, its format and its content. */
export type FileAction = {
  path: string;
  /** `bytes`: `data` is the base64 of the exact bytes to write. */
  format: 'csv' | 'json' | 'txt' | 'xlsx' | 'docx' | 'pdf' | 'bytes';
  data: unknown;
};

/** What the agent does on one block. NORMAL reads `reply` and `calls`; CODE reads every field but `calls`. */
export type Action = {
  reply: string;
  calls?: Call[];
  files?: FileAction[];
  commands?: { command: string; exitCode: number }[];
  exit?: number;
  stderr?: string;
  stage?: string;
  /** CODE: paths the agent deletes, relative to the workspace. */
  deletes?: string[];
  /** CODE: symbolic links the agent makes, `path` pointing at `target` (relative to the link's folder or absolute). */
  links?: { path: string; target: string }[];
};

/** How many code agents this process planted: each gets its own folder of the scratch space. */
let agents = 0;

export const CODE_AGENT = fileURLToPath(new URL('./agents/code-agent.mjs', import.meta.url));

/** One turn that reached the agent: its marker, the history it read and (CODE) the workspace files it saw. */
/** What reached the agent on one turn; `digests` maps each workspace file it saw to the sha256 of its bytes. */
export type Delivery = {
  marker: string | undefined;
  history: Seen[];
  files?: string[];
  digests?: Record<string, string>;
};

export type Planted = {
  adapter: Record<string, unknown>;
  /** The turns that reached the agent, in order: its marker and the history it read. */
  delivered(): Delivery[];
};

/**
 * The adapter of a planted agent of `kind` playing `actions` (marker to action). NORMAL runs in this process;
 * CODE runs as `node code-agent.mjs` in a local sandbox under `scratch`, its plan and log beside the sandboxes,
 * never inside a workspace.
 */
export function plantedAgent(
  product: BlocksProduct,
  kind: Kind,
  actions: ReadonlyMap<string, Action>,
  options: {
    scratch: string;
    capabilities?: Capabilities;
    /** A noisy agent: each turn breaks with probability `rate`; the markers it broke are pushed to `broken`. */
    noisy?: { rate: number; rng: Rng; broken?: string[] };
    keep?: boolean;
    /** CODE: the process adapter's export bound for a parent's workspace, in bytes. */
    exportMaxBytes?: number;
    /** CODE: the adapter without its snapshotGiven hook, as an adapter with a sandbox and no export would be. */
    noSnapshot?: boolean;
  },
): Planted {
  const pick = (text: string) => {
    for (const [marker, action] of actions) if (text.includes(marker)) return { marker, action };
    return undefined;
  };
  if (kind === 'normal') {
    const log: AgentLog = { turns: [] };
    const adapter = scriptedAdapter(
      product,
      (turn) => {
        const found = pick(turn.user);
        if (!found) throw new Error('the planted agent has no action for this turn');
        const action = noisy(found.action, options.noisy, found.marker);
        return observed(action.reply, action.calls ?? [], action.stage);
      },
      { log, ...(options.capabilities ? { capabilities: options.capabilities } : {}) },
    );
    return {
      adapter,
      delivered: () =>
        log.turns.map((turn) => ({ marker: pick(turn.user)?.marker, history: [...turn.messages] })),
    };
  }
  agents += 1;
  const folder = join(options.scratch, `agent-${agents}`);
  mkdirSync(join(folder, 'boxes'), { recursive: true });
  const planPath = join(folder, 'plan.json');
  const logPath = join(folder, 'delivered.jsonl');
  const markers: Record<string, unknown> = {};
  for (const [marker, action] of actions) {
    const played = noisy(action, options.noisy, marker);
    markers[marker] = {
      reply: played.reply,
      files: played.files ?? [],
      deletes: played.deletes ?? [],
      links: played.links ?? [],
      commands: played.commands ?? [],
      exit: played.exit ?? 0,
      ...(played.stderr ? { stderr: played.stderr } : {}),
      runtime: played.stage ? [{ type: 'stage', name: played.stage }] : [],
    };
  }
  writeFileSync(planPath, JSON.stringify({ markers }));
  const processAdapter = need<(options: Record<string, unknown>) => Record<string, unknown>>(
    product.adapters,
    'adapters',
    'processAdapter',
  );
  const localProvider = need<(options: Record<string, unknown>) => unknown>(
    product.sandbox,
    'sandbox',
    'localProvider',
  );
  const adapter = processAdapter({
    command: process.execPath,
    args: [CODE_AGENT],
    provider: localProvider({ dir: join(folder, 'boxes') }),
    env: { BLOCKS_AGENT_PLAN: planPath, BLOCKS_AGENT_LOG: logPath },
    deterministic: true,
    timeoutMs: 60_000,
    ...(options.keep ? { keep: true } : {}),
    ...(options.exportMaxBytes !== undefined ? { exportMaxBytes: options.exportMaxBytes } : {}),
  });
  if (options.noSnapshot) delete adapter.snapshotGiven;
  const off = options.capabilities;
  const base = adapter.capabilities as () => Record<string, boolean>;
  const shaped = off
    ? {
        ...adapter,
        capabilities: () => ({
          ...base(),
          ...(off.seedPrefix === false ? { seedPrefix: false } : {}),
          ...(off.toolStubs === false ? { toolStubs: false } : {}),
        }),
      }
    : adapter;
  return {
    adapter: shaped,
    delivered: () =>
      existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line) => {
              const entry = JSON.parse(line) as {
                marker?: string;
                history?: Seen[];
                files?: string[];
                digests?: Record<string, string>;
              };
              return {
                marker: entry.marker,
                history: entry.history ?? [],
                files: entry.files ?? [],
                digests: entry.digests ?? {},
              };
            })
        : [],
  };
}

/** A noisy agent: with probability `rate` a passing action drops its last word of the reply and its first file. */
function noisy(
  action: Action,
  noise: { rate: number; rng: Rng; broken?: string[] } | undefined,
  marker: string,
): Action {
  if (!noise || noise.rng() >= noise.rate) return action;
  noise.broken?.push(marker);
  return { ...action, reply: action.reply.replace(/\S+$/, ''), files: (action.files ?? []).slice(1) };
}

/** The marker of the turn a history ends with. */
export function markerOf(messages: readonly Seen[], markers: Iterable<string>): string | undefined {
  const text = lastUser(messages);
  for (const marker of markers) if (text.includes(marker)) return marker;
  return undefined;
}

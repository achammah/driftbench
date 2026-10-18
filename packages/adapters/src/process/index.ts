import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import {
  type AdapterCapabilities,
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  type ArtifactRef,
  canonicalJson,
  copyHistory,
  type ExecutionRecord,
  type Observed,
  type ResolvedGiven,
  type Sandbox,
  type SandboxProvider,
  type Session,
  type Stimulus,
  type Turn,
  type WorkspaceSnapshot,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { parseCommands, parseRuntime } from './protocol';
import { shellLine, shellQuote } from './shell';

/**
 * The process adapter: runs a code agent as a command in a sandbox, one process per block. The agent's
 * working folder is the workspace, seeded from `given.world.workspace`. The stimulus reaches it on stdin
 * (or in a file), its stdout is the reply, and the block returns an ordinary Observed: the workspace diff
 * between the snapshots before and after, every created or changed file as an artifact, the commands the
 * agent reports as execution records (role `command`) followed by one record for the agent process itself
 * (role `agent`, always the last), the skills, guards and stages it reports, and the sandbox it ran in. A
 * non-zero exit is a fact in the agent record, not an AgentFailure. The same checks read it as any other
 * block. The runner owns the session history; the adapter only hands it to the agent as a file.
 */

/** Files the adapter keeps at the workspace root. They never appear in a diff or in the artifacts. */
export const processProtocolFiles = {
  /** The agent appends one JSON line per command it ran. Optional. */
  commands: 'driftbench-commands.jsonl',
  /** The agent appends one JSON line per skill, guard or stage. Optional. */
  runtime: 'driftbench-runtime.jsonl',
  /** The adapter writes the session history, as a JSON array ending with the current user turn, before each block. */
  history: 'driftbench-history.json',
  /** The adapter writes the stimulus here in file mode. */
  stimulus: 'driftbench-stimulus.txt',
  /** The adapter writes `target.prompt.text` here before each block, when the target has a prompt. */
  prompt: 'driftbench-prompt.txt',
} as const;

const CONTROL_FILES: readonly string[] = Object.values(processProtocolFiles);

/** Replaced in `args` by the stimulus file path in file mode. */
export const STIMULUS_FILE_PLACEHOLDER = '{stimulus_file}';

export type ProcessAdapterOptions = {
  /** The agent command: a binary on the PATH of the sandbox, or a path to one. */
  command: string;
  /** Its arguments. In file mode `{stimulus_file}` is replaced by the stimulus file path, else that path is appended. */
  args?: string[];
  /** Where sandboxes come from: localProvider() or dockerProvider({ image }) from @agent-nexus/driftbench-sandbox. */
  provider: SandboxProvider;
  /** Leaves each sandbox on disk after close, for inspection. */
  keep?: boolean;
  /** The most bytes a parent block's workspace export may hold, all files together. Default 50 MB. */
  exportMaxBytes?: number;
  /** The docker image, when it differs from the provider's. */
  image?: string;
  /** How the stimulus text reaches the agent: on stdin (default), or in a file named on the command line. */
  stimulus?: 'stdin' | 'file';
  /**
   * Variables for the agent process, such as its API key. The evaluator's own variables do not pass: a
   * local sandbox passes PATH, HOME, the user, the temp folder, the terminal and the locale; docker none.
   */
  env?: Record<string, string>;
  /** Kills the agent after this long. A block's latency budget lowers it. Default 10 minutes. */
  timeoutMs?: number;
  /** True when the agent gives the same output for the same input. Default false. */
  deterministic?: boolean;
};

/** A process adapter always reads produced files, for the artifact checks. */
export type ProcessAdapter = AgentAdapter & Required<Pick<AgentAdapter, 'readArtifact' | 'snapshotGiven'>>;

type Workspace = NonNullable<WorldState['workspace']>;

type ProcessState = {
  sandbox: Sandbox;
  /** The workspace of the Given last written into the sandbox. */
  seeded: Workspace | undefined;
  /** The world and variables of the last block sent, which a parent block's export carries on. */
  world: WorldState;
  vars: Record<string, unknown>;
  closed: boolean;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
/** The most bytes a parent block's exported workspace may hold by default, all files together. */
const EXPORT_MAX_BYTES = 50 * 1024 * 1024;
/** A protocol file larger than this is skipped and named in raw. */
const PROTOCOL_MAX_BYTES = 10 * 1024 * 1024;
/** How many protocol errors raw keeps. */
const MAX_PROTOCOL_ERRORS = 20;

export function processAdapter(options: ProcessAdapterOptions): ProcessAdapter {
  const mode = options.stimulus ?? 'stdin';
  const capabilities: AdapterCapabilities = {
    variants: false,
    // The agent receives the session history, the prefix included, in driftbench-history.json.
    seedPrefix: true,
    toolStubs: false,
    trace: false,
    sandbox: true,
    endState: false,
    deterministic: options.deterministic ?? false,
  };

  return {
    id: 'process',
    // The command is configuration, not the target name. Preserve argument boundaries in its identity.
    version: '0.1.0',
    cacheIdentity: createHash('sha256')
      .update(canonicalJson({ command: options.command, args: options.args ?? [] }))
      .digest('hex'),
    capabilities: () => ({ ...capabilities }),

    async open(given: ResolvedGiven): Promise<Session> {
      const history = copyHistory(given.prefix);
      const sandbox = await options.provider
        .create({
          ...(options.keep === undefined ? {} : { keep: options.keep }),
          ...(options.image === undefined ? {} : { image: options.image }),
        })
        .catch((error: unknown) => {
          throw new AdapterTransportError(
            `the ${options.provider.kind} sandbox could not be created: ${messageOf(error)}`,
            { cause: error },
          );
        });
      const workspace = given.world.workspace;
      try {
        if (workspace !== undefined) await sandbox.seed(workspace);
        await ensureCommand(sandbox, options.command);
      } catch (error) {
        await sandbox.destroy().catch(() => undefined);
        throw error;
      }
      const state: ProcessState = {
        sandbox,
        seeded: workspace,
        world: given.world,
        vars: given.vars,
        closed: false,
      };
      return {
        id: randomUUID(),
        adapter: 'process',
        target: given.target,
        given,
        // A fresh array of the runner's shared, deeply frozen messages.
        history,
        state,
      };
    },

    async send(session: Session, turn: Turn): Promise<Observed> {
      const history = copyHistory(session.history);
      const state = stateOf(session);
      if (state.closed) throw new Error('the process session is closed');
      const { sandbox } = state;
      const text = stimulusText(turn.stimulus);
      state.world = turn.given.world;
      state.vars = turn.given.vars;

      // The world of this block: a perturbation or a teacher-forced Given can add or change seeded files.
      const workspace = turn.given.world.workspace;
      if (workspace !== undefined) {
        const delta = workspaceDelta(state.seeded, workspace);
        if (delta !== undefined) await seedOrFail(sandbox, delta);
        state.seeded = workspace;
      }
      const control: Record<string, string> = {
        [processProtocolFiles.history]: `${JSON.stringify(history, null, 2)}\n`,
      };
      if (mode === 'file') control[processProtocolFiles.stimulus] = text;
      const prompt = session.target.prompt?.text;
      if (prompt !== undefined) control[processProtocolFiles.prompt] = prompt;
      await seedOrFail(sandbox, { files: control });

      const before = await sandbox.snapshot().catch((error: unknown) => {
        throw new Error(`the seeded workspace cannot be snapshotted: ${messageOf(error)}`, { cause: error });
      });

      const commandLine = shellLine([options.command, ...argsFor(options.args ?? [], mode)]);
      // Each block starts with no protocol file, so what the agent writes belongs to this block.
      const clear = shellLine(['rm', '-f', processProtocolFiles.commands, processProtocolFiles.runtime]);
      const budget = turn.budget?.latencyMs;
      const timeoutMs = Math.min(
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        budget !== undefined && budget > 0 ? budget : Number.POSITIVE_INFINITY,
      );
      const run = await sandbox
        .exec(`${clear} && exec ${commandLine}`, {
          env: { ...options.env, ...agentVariables(sandbox.root, turn.index, mode, prompt !== undefined) },
          stdin: mode === 'stdin' ? text : '',
          timeoutMs,
        })
        .catch((error: unknown) => {
          throw new AdapterTransportError(`the agent could not be started: ${messageOf(error)}`, {
            cause: error,
          });
        });

      const after = await sandbox.snapshot().catch((error: unknown) => {
        if (nameOf(error) === 'SandboxLimitError') {
          throw new AgentFailure(`the agent left a workspace past its bounds: ${messageOf(error)}`, {
            cause: error,
          });
        }
        throw new AdapterTransportError(`the workspace cannot be snapshotted: ${messageOf(error)}`, {
          cause: error,
        });
      });
      const workspaceDiff = sandbox.diff(withoutControl(before), withoutControl(after));
      const artifacts: ArtifactRef[] = [...workspaceDiff.created, ...workspaceDiff.changed]
        .sort(compare)
        .map((path) => ({ path, ...after.files[path] }));

      const errors: string[] = [];
      const reported = await readProtocol(
        sandbox,
        after,
        processProtocolFiles.commands,
        errors,
        parseCommands,
      );
      const runtime = await readProtocol(sandbox, after, processProtocolFiles.runtime, errors, parseRuntime);

      const agentRecord: ExecutionRecord = {
        command: commandLine,
        role: 'agent',
        exitCode: run.exitCode,
        stderr: run.stderr ?? '',
        ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
        ...(run.latencyMs === undefined ? {} : { latencyMs: run.latencyMs }),
        ...(run.truncated ? { truncated: true } : {}),
      };
      // The reply is stdout, without the final line break a command line prints.
      const reply = (run.stdout ?? '').replace(/\r?\n$/, '');
      const observed: Observed = {
        segments: reply === '' ? [] : [{ type: 'text', text: reply }],
        text: reply,
        toolCalls: [],
        artifacts,
        workspaceDiff,
        executions: [...(reported ?? []), agentRecord],
        // A kept sandbox names its folder on this machine, for inspection; a removed one names none.
        sandbox: {
          kind: sandbox.kind,
          isolation: sandbox.isolation,
          ...(options.keep ? { root: folderOf(sandbox) } : {}),
        },
        cost: {},
        latencyMs: run.latencyMs ?? 0,
      };
      if (runtime !== undefined) observed.runtime = runtime;
      if (errors.length > 0) observed.raw = { protocolErrors: errors.slice(0, MAX_PROTOCOL_ERRORS) };
      return observed;
    },

    /** Reads a file the agent left in the workspace through the sandbox's bounded read (100 MB). */
    async readArtifact(session: Session, path: string): Promise<Uint8Array> {
      const state = stateOf(session);
      if (state.closed) throw new Error('the process session is closed');
      return state.sandbox.readFile(path);
    },

    /**
     * The end state of a parent block: its world and variables, the workspace replaced by the files the agent
     * left, byte for byte. UTF-8 text goes in `files`, any other file (an xlsx, a pdf, an image) in `binary`
     * as base64. The protocol files stay out. A workspace past `exportMaxBytes` fails the export, and the
     * runner marks the children not run with the reason.
     */
    async snapshotGiven(session: Session) {
      const state = stateOf(session);
      if (state.closed) throw new Error('the process session is closed');
      const snapshot = withoutControl(await state.sandbox.snapshot());
      const paths = Object.keys(snapshot.files).sort(compare);
      const total = paths.reduce((sum, path) => sum + (snapshot.files[path]?.bytes ?? 0), 0);
      const bound = options.exportMaxBytes ?? EXPORT_MAX_BYTES;
      if (total > bound) {
        throw new Error(`the workspace holds ${total} bytes, more than the export bound of ${bound}`);
      }
      // Fatal and BOM-keeping: a file read as text writes back the very bytes it was read from.
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
      const files: Record<string, string> = {};
      const binary: Record<string, string> = {};
      for (const path of paths) {
        const bytes = await state.sandbox.readFile(path, bound);
        try {
          files[path] = decoder.decode(bytes);
        } catch {
          binary[path] = Buffer.from(bytes).toString('base64');
        }
      }
      const { workspace: _seeded, ...world } = state.world;
      const workspace = {
        ...(Object.keys(files).length === 0 ? {} : { files }),
        ...(Object.keys(binary).length === 0 ? {} : { binary }),
      };
      return {
        world: structuredClone({ ...world, ...(paths.length === 0 ? {} : { workspace }) }),
        vars: structuredClone(state.vars),
      };
    },

    /** Removes the sandbox, unless the adapter keeps it. Safe to call twice. */
    async close(session: Session): Promise<void> {
      const state = session.state as ProcessState | undefined;
      if (state === undefined || state.closed) return;
      await state.sandbox.destroy();
      state.closed = true;
    },
  };
}

function stateOf(session: Session): ProcessState {
  const state = session.state as Partial<ProcessState> | undefined;
  if (state?.sandbox === undefined) throw new Error('the session was not opened by the process adapter');
  return state as ProcessState;
}

/** Fails the open with a transport error when the agent command is not there to run. */
async function ensureCommand(sandbox: Sandbox, command: string): Promise<void> {
  const quoted = shellQuote(command);
  // `command -v` vouches for a path without checking it runs, in some shells; a path is tested directly.
  const probe = command.includes('/') ? `test -f ${quoted} && test -x ${quoted}` : `command -v ${quoted}`;
  const found = await sandbox.exec(probe, { timeoutMs: 30_000 }).catch((error: unknown) => {
    throw new AdapterTransportError(`the ${sandbox.kind} sandbox cannot run commands: ${messageOf(error)}`, {
      cause: error,
    });
  });
  if (found.exitCode !== 0) {
    throw new AdapterTransportError(
      `the agent command ${command} is not found in the ${sandbox.kind} sandbox`,
    );
  }
}

/** Seeds files between blocks. A path the agent blocked (a planted link, a folder in the way) fails the agent. */
async function seedOrFail(sandbox: Sandbox, workspace: Workspace): Promise<void> {
  try {
    await sandbox.seed(workspace);
  } catch (error) {
    if (nameOf(error) === 'SandboxPathError') {
      throw new AgentFailure(
        `the agent left the workspace in a state it cannot be written: ${messageOf(error)}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

function stimulusText(stimulus: Stimulus): string {
  if ('user' in stimulus) return stimulus.user;
  if ('burst' in stimulus) return stimulus.burst.join('\n\n');
  return stimulus.injection.user;
}

function argsFor(args: readonly string[], mode: 'stdin' | 'file'): string[] {
  if (mode === 'stdin') return [...args];
  const file = processProtocolFiles.stimulus;
  if (!args.some((arg) => arg.includes(STIMULUS_FILE_PLACEHOLDER))) return [...args, file];
  return args.map((arg) => arg.split(STIMULUS_FILE_PLACEHOLDER).join(file));
}

/** Paths as the agent sees them, so it never has to hard-code a file name. */
function agentVariables(
  root: string,
  index: number,
  mode: 'stdin' | 'file',
  prompt: boolean,
): Record<string, string> {
  const variables: Record<string, string> = {
    DRIFTBENCH_WORKSPACE: root,
    DRIFTBENCH_BLOCK: String(index),
    DRIFTBENCH_HISTORY_FILE: posix.join(root, processProtocolFiles.history),
    DRIFTBENCH_COMMANDS_FILE: posix.join(root, processProtocolFiles.commands),
    DRIFTBENCH_RUNTIME_FILE: posix.join(root, processProtocolFiles.runtime),
  };
  if (mode === 'file') variables.DRIFTBENCH_STIMULUS_FILE = posix.join(root, processProtocolFiles.stimulus);
  if (prompt) variables.DRIFTBENCH_PROMPT_FILE = posix.join(root, processProtocolFiles.prompt);
  return variables;
}

/** What a new Given adds or changes against the one already seeded. Files the agent changed since stay. */
function workspaceDelta(seeded: Workspace | undefined, next: Workspace): Workspace | undefined {
  if (seeded !== undefined && canonicalJson(seeded) === canonicalJson(next)) return undefined;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(next.files ?? {})) {
    const known = seeded?.files !== undefined && Object.hasOwn(seeded.files, path);
    if (!known || seeded?.files?.[path] !== content) files[path] = content;
  }
  const binary: Record<string, string> = {};
  for (const [path, content] of Object.entries(next.binary ?? {})) {
    if (seeded?.binary?.[path] !== content) binary[path] = content;
  }
  const from = next.from !== undefined && next.from !== seeded?.from ? next.from : undefined;
  if (from === undefined && Object.keys(files).length === 0 && Object.keys(binary).length === 0)
    return undefined;
  return {
    ...(from === undefined ? {} : { from }),
    ...(Object.keys(files).length === 0 ? {} : { files }),
    ...(Object.keys(binary).length === 0 ? {} : { binary }),
  };
}

function withoutControl(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const files = Object.entries(snapshot.files).filter(([path]) => !CONTROL_FILES.includes(path));
  return { takenAt: snapshot.takenAt, files: Object.fromEntries(files) };
}

/** Reads one protocol file the agent wrote this block. Undefined when it wrote none. */
async function readProtocol<T>(
  sandbox: Sandbox,
  after: WorkspaceSnapshot,
  file: string,
  errors: string[],
  parse: (text: string, file: string) => { value: T; errors: string[] },
): Promise<T | undefined> {
  if (!Object.hasOwn(after.files, file)) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = await sandbox.readFile(file, PROTOCOL_MAX_BYTES);
  } catch (error) {
    errors.push(`${file}: skipped, ${messageOf(error)}`);
    return undefined;
  }
  const parsed = parse(Buffer.from(bytes).toString('utf8'), file);
  errors.push(...parsed.errors);
  return parsed.value;
}

/** The folder on this machine, for a kept sandbox: a sandbox from @agent-nexus/driftbench-sandbox names it. */
function folderOf(sandbox: Sandbox): string {
  const folder = (sandbox as { folder?: unknown }).folder;
  return typeof folder === 'string' ? folder : sandbox.root;
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nameOf(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

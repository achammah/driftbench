import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
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
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { reapFolder } from '@agent-nexus/driftbench-sandbox';
import { shellLine, shellQuote } from '../../process/shell';
import { isRecord, parseJsonl } from '../format';
import { mapSession } from '../session';
import {
  applySessionOps,
  type LiveOp,
  opsForTurn,
  projectFolderName,
  readSessionRecords,
  type SessionFile,
  type StateLibrary,
  sessionFileText,
} from './states';
import { hookDecisions, isOverloaded, normaliseStream, type ParsedStream, parseStream } from './stream';

export const CLAUDE_CODE_LIVE_VERSION = '0.1.0';

/**
 * The live runner: runs the runtime's headless command in a sandbox that holds a copy of the estate and the
 * seeded workspace, one process per turn, and maps the streamed transcript into one Observed per turn with
 * the session adapter.
 *
 * The command line, checked against the runtime (2.1.296) in the first real run, 2026-10-12:
 *   `<command> [args] [--allowed-tools ...] -p <ask> --output-format stream-json --verbose
 *    --include-hook-events --setting-sources project,local --strict-mcp-config [--resume <session id>]`
 * `--setting-sources project,local` keeps the evaluator's own user settings, hooks and user CLAUDE.md out
 * of the run (only the copy's CLAUDE.md loaded); `--strict-mcp-config` keeps the evaluator's MCP servers out.
 * Resuming keeps the session id and appends to the same session file.
 * The ask is the turn's user message and nothing else: no spec id, test type or atom reaches the agent, in
 * the prompt or anywhere in its folder (the estate copy holds the estate's own files only). A queued message
 * switches the turn to `--input-format stream-json`, with the ask and the queued messages on the input.
 *
 * Turn after turn the run resumes the session the runtime named. The session state and the estate
 * deviations are operations on what the runtime finds (see `states.ts`), applied before the turn.
 *
 * Guards come from the stream's hook events (`hook_response`, `permission_denied`; see `hookDecisions`),
 * named by the copy's settings, and from what the estate's own hooks write when they write it, at paths the
 * process receives in its environment, outside the project folder: `HOOK_DECISION_LOG` (one row
 * `{ at, event, check, verdict }` per verdict) and `STEP_FEED` (one row `{ at, step }` per stage). The rows a
 * turn adds become its guards and stages.
 *
 * The login: with `config: 'host'` (the default) the runtime uses the evaluator's config folder
 * (`CLAUDE_CONFIG_DIR` of `env`, else `~/.claude`), where a subscription login lives; a run with its own
 * config folder is not logged in (seen in the first real run). Session files go to
 * `<config>/projects/<the folder, non-alphanumerics replaced by ->/<id>.jsonl`; the runner removes that
 * project folder at close, as it is the sandbox's own. `config: 'isolated'` gives the run a config folder of
 * its own, for stand-ins and for runs whose credentials come in `env`.
 *
 * Cost comes from the stream's result record (`total_cost_usd`), tokens from it or from the messages.
 * An overloaded or rate-limited run is retried up to `retries.max` times; past that the turn fails as a
 * transport error.
 */

type Workspace = NonNullable<WorldState['workspace']>;

export type ClaudeCodeLiveOptions = {
  /** The runtime's headless binary, or a path to a stand-in that speaks the same stream. */
  command: string;
  /** Arguments put before the runner's own, such as a model or a permission mode. */
  args?: readonly string[];
  /** The estate root: the folder holding the standing instructions and the runtime's settings folder. */
  estateRoot: string;
  /** What of the estate root is copied. Default: CLAUDE.md, CLAUDE.local.md, .claude and .mcp.json, those present. */
  estateFiles?: readonly string[];
  /** A workspace seed written before the Given's own workspace. */
  workspace?: Workspace;
  /** The operations of a spec that names no session state. Default: a fresh session. */
  sessionState?: readonly LiveOp[];
  /** Operations by `vars.session_state` and `vars.event`. */
  library?: StateLibrary;
  /** More operations before a turn, chosen by the caller. */
  ops?: (turn: Turn) => readonly LiveOp[];
  /** Where sandboxes come from: `localProvider()` of @agent-nexus/driftbench-sandbox. */
  provider: SandboxProvider;
  /** The estate map hashes this copy answers to; a spec pinned to another (`vars.estate.map_hash`) fails. */
  pins?: readonly string[];
  /** Variables of the runtime's process, such as its credentials. Never written to the trace. */
  env?: Record<string, string>;
  /** Kills a turn after this long. A block's latency budget lowers it. Default 15 minutes. */
  timeoutMs?: number;
  retries?: { max?: number; backoffMs?: number };
  /** Leaves the sandbox and the run's state folder on disk after close, for inspection. */
  keep?: boolean;
  /** The parent folder of the run's state folder. Default: the system temp folder. */
  stateDir?: string;
  /** Whose config folder the runtime uses: the evaluator's (default, where the login lives) or the run's own. */
  config?: 'host' | 'isolated';
  /**
   * Passes the tools the copy's settings allow, and Skill, as `--allowed-tools`. A headless run in a folder
   * never trusted interactively ignores the estate's allow list (seen in the first real run); this restores it.
   */
  trustEstate?: boolean;
  /** Tools the runtime must refuse, passed as `--disallowed-tools` (a secrets folder, a network tool). */
  disallowedTools?: readonly string[];
  /**
   * The lock (macOS): the runtime, its hooks and every command the agent runs are children of
   * `sandbox-exec` with a profile that refuses writes to `denyWrite` and reads and writes of `deny`. By
   * default it refuses writes to the owner's own configuration under `~/.claude` (OWNER_CONFIG_ENTRIES), with
   * the home folder read from `env.HOME`. `false` runs without it. Elsewhere it is not applied, and the trace
   * says so.
   */
  lock?: false | { denyWrite?: readonly string[]; deny?: readonly string[] };
};

/**
 * The owner's configuration inside ~/.claude: what an agent under test must never change (seen on the Cue
 * bench: an agent tried to edit ~/.claude/settings.json). The runtime's own state there (projects, sessions,
 * shell snapshots, telemetry) stays writable, so a run still works.
 */
export const OWNER_CONFIG_ENTRIES = [
  'settings.json',
  'settings.local.json',
  'CLAUDE.md',
  'agents',
  'skills',
  'hooks',
  'commands',
  'output-styles',
  'keybindings.json',
] as const;

/** The flags the runner adds after the headless shape. */
export const RUNTIME_FLAGS = [
  '--include-hook-events',
  '--setting-sources',
  'project,local',
  '--strict-mcp-config',
] as const;

export const DEFAULT_ESTATE_FILES = ['CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json'] as const;

/**
 * True for a file the runtime loads into its context by itself: a CLAUDE.md or CLAUDE.local.md, at the root
 * or in a folder (loaded when the agent works there). No Read call ever shows it, so a test never expects one.
 */
export function loadedByRuntime(path: string): boolean {
  return /(^|\/)CLAUDE(\.local)?\.md$/.test(path.replace(/^\.?\/+/, ''));
}

type LiveState = {
  sandbox: Sandbox;
  /** Outside the project folder: the runtime's config folder, the hook logs, the helper registry. */
  stateFolder: string;
  configDir: string;
  /** The copy's `.claude/settings.json`, parsed, to name the hooks of the stream. */
  settings: unknown;
  decisions: string;
  steps: string;
  helpers: string;
  rateWave: string;
  resumeId?: string;
  applied: Set<string>;
  seeded: Workspace | undefined;
  /** Processes the runner started for running helpers, killed at close. */
  pids: number[];
  helperCount: number;
  closed: boolean;
  pin: string;
};

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 5000;

export function claudeCodeLiveAdapter(options: ClaudeCodeLiveOptions): AgentAdapter {
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: false,
    toolStubs: false,
    trace: false,
    sandbox: true,
    endState: false,
    deterministic: false,
  };
  const maxRetries = options.retries?.max ?? DEFAULT_RETRIES;
  const backoffMs = options.retries?.backoffMs ?? DEFAULT_BACKOFF_MS;

  return {
    id: 'claude-code',
    version: CLAUDE_CODE_LIVE_VERSION,
    capabilities: () => ({ ...capabilities }),

    async open(given: ResolvedGiven): Promise<Session> {
      const history = copyHistory(given.prefix);
      const pin = pinOf(given, options.pins);
      const sandbox = await options.provider
        .create({ ...(options.keep === undefined ? {} : { keep: options.keep }) })
        .catch((error: unknown) => {
          throw new AdapterTransportError(
            `the ${options.provider.kind} sandbox could not be created: ${messageOf(error)}`,
            { cause: error },
          );
        });
      let stateFolder: string | undefined;
      try {
        await copyEstate(options.estateRoot, options.estateFiles ?? DEFAULT_ESTATE_FILES, folderOf(sandbox));
        if (options.workspace !== undefined) await sandbox.seed(options.workspace);
        if (given.world.workspace !== undefined) await sandbox.seed(given.world.workspace);
        await ensureCommand(sandbox, options.command);
        const parent = options.stateDir ?? tmpdir();
        await mkdir(parent, { recursive: true });
        stateFolder = await mkdtemp(join(parent, 'live-state-'));
        if (options.config === 'isolated') await mkdir(join(stateFolder, 'config'), { recursive: true });
      } catch (error) {
        await sandbox.destroy().catch(() => undefined);
        if (stateFolder !== undefined) await rm(stateFolder, { recursive: true, force: true });
        throw error;
      }
      const state: LiveState = {
        sandbox,
        stateFolder,
        configDir:
          options.config === 'isolated'
            ? join(stateFolder, 'config')
            : (options.env?.CLAUDE_CONFIG_DIR ?? join(options.env?.HOME ?? homedir(), '.claude')),
        settings: await readJson(join(folderOf(sandbox), '.claude', 'settings.json')).catch(() => undefined),
        decisions: join(stateFolder, 'decisions.jsonl'),
        steps: join(stateFolder, 'steps.jsonl'),
        helpers: join(stateFolder, 'helpers.json'),
        rateWave: join(stateFolder, 'rate-wave'),
        applied: new Set(),
        seeded: given.world.workspace,
        pids: [],
        helperCount: 0,
        closed: false,
        pin,
      };
      return {
        id: randomUUID(),
        adapter: 'claude-code',
        target: given.target,
        given,
        history,
        state,
      };
    },

    async send(session: Session, turn: Turn): Promise<Observed> {
      copyHistory(session.history);
      const state = stateOf(session);
      if (state.closed) throw new Error('the live session is closed');
      const { sandbox } = state;
      const ask = askOf(turn.stimulus);
      const cwd = sandbox.root;

      let ops: LiveOp[];
      try {
        ops = [
          ...opsForTurn(options.library, turn.given.vars, turn.index, state.applied, options.sessionState),
          ...(options.ops?.(turn) ?? []),
        ];
      } catch (error) {
        throw new AgentFailure(messageOf(error), { cause: error });
      }
      const at = new Date().toISOString();
      const notes = await applyOps(state, ops, cwd, at);

      // The world of this block: a perturbation can add or change seeded files.
      const workspace = turn.given.world.workspace;
      if (workspace !== undefined) {
        const delta = workspaceDelta(state.seeded, workspace);
        if (delta !== undefined) await sandbox.seed(delta);
        state.seeded = workspace;
      }

      const before = await sandbox.snapshot();
      const decisionsBefore = await lineCount(state.decisions);
      const stepsBefore = await lineCount(state.steps);
      const queued = ops.flatMap((op) => (op.op === 'queue' ? [op.message] : []));
      const allowed = options.trustEstate ? allowedTools(state.settings) : [];
      const profile = lockProfile(options);
      const words = [
        ...(profile === undefined ? [] : ['/usr/bin/sandbox-exec', '-p', profile]),
        options.command,
        ...(options.args ?? []),
        ...(allowed.length > 0 ? ['--allowed-tools', ...allowed] : []),
        ...(options.disallowedTools?.length ? ['--disallowed-tools', ...options.disallowedTools] : []),
        '-p',
        ...(queued.length > 0 ? ['--input-format', 'stream-json'] : [ask]),
        '--output-format',
        'stream-json',
        '--verbose',
        ...RUNTIME_FLAGS,
        ...(state.resumeId === undefined ? [] : ['--resume', state.resumeId]),
      ];
      const commandLine = shellLine(words);
      const stdin =
        queued.length > 0
          ? [ask, ...queued]
              .map((text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }))
              .join('\n')
              .concat('\n')
          : '';
      const env: Record<string, string> = {
        ...options.env,
        ...(options.config === 'isolated' ? { CLAUDE_CONFIG_DIR: state.configDir } : {}),
        HOOK_DECISION_LOG: state.decisions,
        STEP_FEED: state.steps,
        HELPER_REGISTRY: state.helpers,
        RATE_WAVE_FILE: state.rateWave,
      };
      const budget = turn.budget?.latencyMs;
      const timeoutMs = Math.min(
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        budget !== undefined && budget > 0 ? budget : Number.POSITIVE_INFINITY,
      );

      const startedAt = new Date().toISOString();
      const attempts: Array<{ exitCode: number; overloaded: boolean }> = [];
      let run: ExecutionRecord;
      let parsed: ParsedStream;
      for (;;) {
        run = await sandbox.exec(commandLine, { env, stdin, timeoutMs }).catch((error: unknown) => {
          throw new AdapterTransportError(`the runtime could not be started: ${messageOf(error)}`, {
            cause: error,
          });
        });
        parsed = parseStream(run.stdout ?? '');
        const overloaded = isOverloaded(parsed, run.exitCode, run.stderr ?? '');
        attempts.push({ exitCode: run.exitCode, overloaded });
        if (!overloaded) break;
        if (attempts.length > maxRetries) {
          throw new AdapterTransportError(
            `the provider stayed overloaded through ${attempts.length} attempts of this turn`,
          );
        }
        await sleep(backoffMs * attempts.length);
      }
      if (parsed.lines.length === 0 && run.exitCode !== 0) {
        throw new AgentFailure(
          `the runtime exited ${run.exitCode} without a stream: ${(run.stderr ?? '').slice(0, 400)}`,
        );
      }

      const after = await sandbox.snapshot();
      const fullDiff = sandbox.diff(before, after);

      const logged = await linesAfter(state.decisions, decisionsBefore);
      const hooked = hookDecisions(parsed, state.settings, startedAt).map((row) => JSON.stringify(row));
      const decisions =
        logged === undefined && hooked.length === 0
          ? undefined
          : [logged ?? '', ...hooked].filter((text) => text !== '').join('\n');
      const steps = await linesAfter(state.steps, stepsBefore);
      const transcript = normaliseStream({ parsed, ask, startedAt, cwd, queued });
      const mapped = mapSession({
        transcript: parseJsonl(transcript.join('\n')),
        ...(decisions === undefined ? {} : { decisions: parseJsonl(decisions) }),
        ...(steps === undefined ? {} : { steps: parseJsonl(steps) }),
      });
      const block = mapped.blocks[0];
      if (!block) throw new AgentFailure('the turn mapped to no block');
      const { diff: workspaceDiff, runtimeWrites } = agentDiff(
        fullDiff,
        block.observed.toolCalls,
        cwd,
        options.estateFiles ?? DEFAULT_ESTATE_FILES,
      );
      const artifacts: ArtifactRef[] = [...workspaceDiff.created, ...workspaceDiff.changed]
        .sort()
        .map((path) => ({ path, ...after.files[path] }) as ArtifactRef);

      if (mapped.blocks.length > 1) {
        throw new AgentFailure(`the turn mapped to ${mapped.blocks.length} blocks; one is expected`);
      }
      if (parsed.sessionId !== undefined) state.resumeId = parsed.sessionId;
      // A compaction the runner planted in the session file before the turn: the runtime does not stream a
      // boundary it found in the file it resumed (seen on the Cue bench), so the trace marks it at the turn's
      // start, where a hazard check reads it.
      const planted = notes.includes('compact: a compaction boundary and its summary were appended')
        ? ops
            .filter((op) => op.op === 'compact')
            .slice(-1)
            .map((op) => ({
              kind: 'compaction' as const,
              line: 0,
              afterToolCalls: 0,
              planted: true,
              at: startedAt,
              ...(op.op === 'compact' && op.trigger !== undefined ? { trigger: op.trigger } : {}),
              ...(op.op === 'compact' && op.preTokens !== undefined ? { preTokens: op.preTokens } : {}),
            }))
        : [];
      const findings = outsideWrites(block.observed.toolCalls, cwd);
      if (findings.length > 0) {
        const runtime = block.observed.runtime ?? {};
        block.observed.runtime = {
          ...runtime,
          guards: [
            ...(runtime.guards ?? []),
            ...findings.map((finding) => ({
              name: 'outside-write',
              verdict: finding.refused ? 'deny' : 'allow',
              at: startedAt,
            })),
          ],
        };
      }

      const agentRecord: ExecutionRecord = {
        command: commandLine,
        role: 'agent',
        exitCode: run.exitCode,
        stderr: run.stderr ?? '',
        startedAt,
        ...(run.latencyMs === undefined ? {} : { latencyMs: run.latencyMs }),
        ...(run.truncated ? { truncated: true } : {}),
      };
      const tokens = block.observed.cost;
      const result = parsed.result;
      const runtime = block.observed.runtime ?? {};
      const observed: Observed = {
        ...block.observed,
        // What the runtime offered the agent, from the init record: a denied tool is absent.
        ...(parsed.tools === undefined ? {} : { runtime: { ...runtime, offered: parsed.tools } }),
        artifacts,
        workspaceDiff,
        executions: [...(block.observed.executions ?? []), agentRecord],
        sandbox: {
          kind: sandbox.kind,
          isolation: sandbox.isolation,
          ...(options.keep ? { root: folderOf(sandbox) } : {}),
        },
        cost: {
          ...(result?.costUsd === undefined ? {} : { usd: result.costUsd }),
          ...(tokens.inputTokens !== undefined
            ? { inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens ?? 0 }
            : result?.usage
              ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
              : {}),
        },
        latencyMs: Math.max(0, Date.now() - Date.parse(startedAt)),
        raw: {
          ...(isRecord(block.observed.raw) ? block.observed.raw : {}),
          markers: [...planted, ...markersOf(block.observed.raw)],
          live: {
            sessionId: parsed.sessionId ?? null,
            ...(parsed.tools === undefined ? {} : { tools: parsed.tools }),
            pin: state.pin,
            attempts,
            ops: ops.map((op) => op.op),
            notes,
            queued,
            ...(result === undefined ? {} : { result }),
            issues: [...parsed.issues, ...mapped.meta.issues],
            runtimeWrites,
            findings,
            lock: profile === undefined ? 'none' : 'sandbox-exec',
            decisions: decisions !== undefined,
            steps: steps !== undefined,
          },
        },
      };
      return observed;
    },

    async readArtifact(session: Session, path: string): Promise<Uint8Array> {
      const state = stateOf(session);
      if (state.closed) throw new Error('the live session is closed');
      return state.sandbox.readFile(path);
    },

    /** Removes the sandbox and the state folder unless kept, and stops the helpers the runner started. */
    async close(session: Session): Promise<void> {
      const state = session.state as LiveState | undefined;
      if (state === undefined || state.closed) return;
      state.closed = true;
      for (const pid of state.pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      const project = join(state.configDir, 'projects', projectFolderName(state.sandbox.root));
      // A daemon an estate guard starts can leave the run's process group and keep running from the copy
      // or with the run's home: what still names or stands in either folder ends now, kept or not.
      await reapFolder([state.sandbox.root, state.stateFolder]);
      await state.sandbox.destroy();
      if (options.keep) return;
      await rm(state.stateFolder, { recursive: true, force: true });
      // The runtime's project folder of this sandbox: its name holds the sandbox's own unique folder name.
      const own = state.sandbox.root.split('/').at(-1) ?? '';
      if (options.config !== 'isolated' && own.length >= 8 && project.endsWith(projectFolderName(own))) {
        await rm(project, { recursive: true, force: true });
      }
    },
  };

  async function applyOps(
    state: LiveState,
    ops: readonly LiveOp[],
    cwd: string,
    at: string,
  ): Promise<string[]> {
    const touchesFile = ops.some(
      (op) => op.op === 'resume' || op.op === 'compact' || op.op === 'restart' || op.op === 'helper',
    );
    const notes: string[] = [];
    if (touchesFile) {
      const current = await currentSessionFile(state);
      const applied = applySessionOps(current, ops, {
        newId: () => randomUUID(),
        cwd,
        at,
        helperId: () => `helper-${++state.helperCount}`,
      });
      notes.push(...applied.notes);
      if (applied.file) {
        const folder = join(state.configDir, 'projects', projectFolderName(cwd));
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, `${applied.file.id}.jsonl`), sessionFileText(applied.file));
        state.resumeId = applied.file.id;
      }
    }
    for (const op of ops) {
      if (op.op === 'plant') {
        await insideCopy(folderOf(state.sandbox), op.path);
        await state.sandbox.seed({ files: { [op.path]: op.content } });
        notes.push(`plant: ${op.path}`);
      } else if (op.op === 'helper') {
        const pid = op.alive ? startHelper() : goneProcess();
        if (op.alive) state.pids.push(pid);
        const registry = await readJson(state.helpers);
        const list = Array.isArray(registry) ? registry : [];
        list.push({ id: `helper-${state.helperCount}`, pid, description: op.description, at });
        await writeFile(state.helpers, `${JSON.stringify(list, null, 2)}\n`);
      } else if (op.op === 'rate_wave') {
        await writeFile(state.rateWave, `${Math.max(0, Math.floor(op.overloads))}\n`);
        notes.push(`rate_wave: ${op.overloads} overloaded answers armed`);
      } else if (op.op === 'queue') {
        notes.push('queue: a message waits on the input');
      }
    }
    return notes;
  }
}

/** The session file the next turn would resume, read back from the runtime's folder. */
async function currentSessionFile(state: LiveState): Promise<SessionFile | undefined> {
  if (state.resumeId === undefined) return undefined;
  const projects = join(state.configDir, 'projects');
  const folders = await readdir(projects).catch(() => [] as string[]);
  for (const folder of folders) {
    const text = await readFile(join(projects, folder, `${state.resumeId}.jsonl`), 'utf8').catch(
      () => undefined,
    );
    if (text !== undefined) return { id: state.resumeId, records: readSessionRecords(text) };
  }
  return { id: state.resumeId, records: [] };
}

/** The pin a spec names, checked against the hashes the copy answers to. A short hash matches its prefix. */
function pinOf(given: ResolvedGiven, pins: readonly string[] | undefined): string {
  const estate = isRecord(given.vars.estate) ? given.vars.estate : undefined;
  const named = typeof estate?.map_hash === 'string' ? estate.map_hash : undefined;
  if (pins === undefined || pins.length === 0) return named === undefined ? 'unpinned' : `unchecked ${named}`;
  if (named === undefined) return 'unpinned';
  const match = pins.find((pin) => pin.startsWith(named) || named.startsWith(pin));
  if (match === undefined) {
    throw new AgentFailure(
      `the spec was generated from the estate map ${named.slice(0, 12)}, and this copy answers to ${pins
        .map((pin) => pin.slice(0, 12))
        .join(', ')}`,
    );
  }
  return match;
}

/**
 * Copies the estate's own files into the project folder, modes kept (guard scripts stay runnable): the
 * names given, a folder whole or one file each (the runner passes the estate's file list, so ignored
 * folders stay out). Symbolic
 * links are followed: the copy holds real files and never a link, so nothing the runner or the agent writes
 * in the copy reaches the estate it came from. A link left in the copy refuses the open.
 */
async function copyEstate(root: string, names: readonly string[], folder: string): Promise<void> {
  const info = await stat(root).catch(() => undefined);
  if (!info?.isDirectory()) throw new AgentFailure(`the estate root ${root} is not a folder`);
  let copied = 0;
  // Sixteen copies at a time: an estate of thousands of small files is bound by the file system's latency.
  await eachLimited(names, 16, async (name) => {
    const source = join(root, name);
    if ((await stat(source).catch(() => undefined)) === undefined) return;
    // A copy-on-write clone where the file system has one, else a plain copy; never a hard link.
    await mkdir(dirname(join(folder, name)), { recursive: true });
    await cp(source, join(folder, name), {
      recursive: true,
      dereference: true,
      mode: constants.COPYFILE_FICLONE,
    });
    copied += 1;
  });
  if (copied === 0) throw new AgentFailure(`the estate root ${root} holds none of ${names.join(', ')}`);
  const left = await linksUnder(folder);
  if (left.length > 0) throw new AgentFailure(`the estate copy holds symbolic links: ${left.join(', ')}`);
}

/** Runs `work` on every item, at most `limit` at a time. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await work(item);
    }
  });
  await Promise.all(lanes);
}

async function linksUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if ((await lstat(full)).isSymbolicLink()) out.push(relative(dir, full));
      else if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dir);
  return out.sort();
}

/**
 * Refuses a write into the copy whose real path leaves it: a link on the way (the file, or a folder above
 * it) that leads out names where it leads.
 */
async function insideCopy(root: string, file: string): Promise<void> {
  const base = await realpath(root);
  const path = join(root, file);
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    let folder = dirname(path);
    let tail = file.split('/').at(-1) ?? '';
    for (;;) {
      const found = await realpath(folder).catch(() => undefined);
      if (found !== undefined) {
        real = join(found, tail);
        break;
      }
      tail = join(folder.split('/').at(-1) ?? '', tail);
      folder = dirname(folder);
    }
  }
  if (real !== base && !real.startsWith(`${base}${sep}`)) {
    throw new AgentFailure(`${file} resolves to ${real}, outside the copy ${base}; refused`);
  }
}

/** Fails the open with a transport error when the command is not there to run. */
async function ensureCommand(sandbox: Sandbox, command: string): Promise<void> {
  const quoted = shellQuote(command);
  const probe = command.includes('/') ? `test -f ${quoted} && test -x ${quoted}` : `command -v ${quoted}`;
  const found = await sandbox.exec(probe, { timeoutMs: 30_000 });
  if (found.exitCode !== 0) {
    throw new AdapterTransportError(
      `the runtime command ${command} is not found in the ${sandbox.kind} sandbox`,
    );
  }
}

/** A process that keeps running until the session closes: a helper still at work. */
function startHelper(): number {
  const child = spawn('sleep', ['3600'], { detached: true, stdio: 'ignore' });
  child.unref();
  if (child.pid === undefined) throw new Error('a running helper could not be started');
  return child.pid;
}

/** The id of a process that has already exited: a helper whose process is gone. */
function goneProcess(): number {
  const done = spawnSync('true');
  return done.pid;
}

function askOf(stimulus: Stimulus): string {
  if ('user' in stimulus) return stimulus.user;
  if ('burst' in stimulus) return stimulus.burst.join('\n\n');
  return stimulus.injection.user;
}

function workspaceDelta(seeded: Workspace | undefined, next: Workspace): Workspace | undefined {
  if (seeded !== undefined && canonicalJson(seeded) === canonicalJson(next)) return undefined;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(next.files ?? {})) {
    if (seeded?.files?.[path] !== content) files[path] = content;
  }
  const binary: Record<string, string> = {};
  for (const [path, content] of Object.entries(next.binary ?? {})) {
    if (seeded?.binary?.[path] !== content) binary[path] = content;
  }
  if (Object.keys(files).length === 0 && Object.keys(binary).length === 0) return undefined;
  return {
    ...(Object.keys(files).length === 0 ? {} : { files }),
    ...(Object.keys(binary).length === 0 ? {} : { binary }),
  };
}

async function lineCount(path: string): Promise<number> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? 0 : text.split('\n').filter((line) => line.trim() !== '').length;
}

/** The non-blank lines after the first `skip`, or undefined when the file does not exist. */
async function linesAfter(path: string, skip: number): Promise<string | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(skip)
    .join('\n');
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : JSON.parse(text);
}

function stateOf(session: Session): LiveState {
  const state = session.state as Partial<LiveState> | undefined;
  if (state?.sandbox === undefined) throw new Error('the session was not opened by the live adapter');
  return state as LiveState;
}

function folderOf(sandbox: Sandbox): string {
  const folder = (sandbox as { folder?: unknown }).folder;
  return typeof folder === 'string' ? folder : sandbox.root;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The tools the settings allow, and Skill, for `--allowed-tools`. */
function allowedTools(settings: unknown): string[] {
  const permissions = isRecord(settings) && isRecord(settings.permissions) ? settings.permissions : {};
  const allow = Array.isArray(permissions.allow)
    ? permissions.allow.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return allow.includes('Skill') ? allow : [...allow, 'Skill'];
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * The diff the agent made. An estate's hooks write their own state into the estate folder (caches, logs,
 * locks; seen on a real estate): a path inside the estate's own files that no write tool of the block
 * targeted is the runtime's, left out of the diff and kept in `runtimeWrites`. A path outside the estate
 * files, or one the agent's Write or Edit named, stays. A change the agent makes there through a shell
 * command is therefore not counted; the trace keeps it in `runtimeWrites`.
 */
function agentDiff(
  diff: { created: string[]; changed: string[]; deleted: string[] },
  calls: readonly { label: string; input: unknown }[],
  cwd: string,
  estateFiles: readonly string[],
): { diff: { created: string[]; changed: string[]; deleted: string[] }; runtimeWrites: string[] } {
  const roots = [cwd, cwd.startsWith('/private/') ? cwd.slice('/private'.length) : `/private${cwd}`];
  const named = new Set<string>();
  for (const call of calls) {
    if (!WRITE_TOOLS.has(call.label) || !isRecord(call.input)) continue;
    const path = call.input.file_path ?? call.input.notebook_path;
    if (typeof path !== 'string') continue;
    const root = roots.find((candidate) => path.startsWith(`${candidate}/`));
    named.add(root === undefined ? path : path.slice(root.length + 1));
  }
  // The estate's folders: the top of every listed path. A runner may list the estate file by file, and a hook
  // creates new files beside them (seen on the Cue bench: .claude/hooks/watchers/state/sweeper.log).
  const tops = new Set(estateFiles.map((name) => name.split('/')[0] ?? name));
  const estate = (path: string) => [...tops].some((name) => path === name || path.startsWith(`${name}/`));
  const runtimeWrites: string[] = [];
  const keep = (paths: string[]) =>
    paths.filter((path) => {
      if (!estate(path) || named.has(path)) return true;
      runtimeWrites.push(path);
      return false;
    });
  const out = { created: keep(diff.created), changed: keep(diff.changed), deleted: keep(diff.deleted) };
  return { diff: out, runtimeWrites: runtimeWrites.sort() };
}

/** The sandbox profile of the lock, or undefined when the lock is off or not available here. */
function lockProfile(options: ClaudeCodeLiveOptions): string | undefined {
  if (options.lock === false || process.platform !== 'darwin') return undefined;
  const home = options.env?.HOME ?? homedir();
  const denyWrite =
    options.lock?.denyWrite ?? OWNER_CONFIG_ENTRIES.map((entry) => join(home, '.claude', entry));
  const deny = options.lock?.deny ?? [];
  // The sandbox matches resolved paths: /var is /private/var on macOS, and a home may be a link.
  const quote = (path: string) => `(subpath ${JSON.stringify(resolvedPath(path))})`;
  const lines = ['(version 1)', '(allow default)'];
  if (deny.length > 0) lines.push(`(deny file-read* file-write* ${deny.map(quote).join(' ')})`);
  if (denyWrite.length > 0) lines.push(`(deny file-write* ${denyWrite.map(quote).join(' ')})`);
  return lines.join('\n');
}

export type OutsideWrite = { kind: 'write_outside_project'; tool: string; path: string; refused: boolean };

/** Write tool calls aimed outside the project folder, and whether the write failed. */
function outsideWrites(
  calls: readonly { label: string; input: unknown; error?: string }[],
  cwd: string,
): OutsideWrite[] {
  const roots = [cwd, cwd.startsWith('/private/') ? cwd.slice('/private'.length) : `/private${cwd}`];
  const out: OutsideWrite[] = [];
  for (const call of calls) {
    if (!WRITE_TOOLS.has(call.label) || !isRecord(call.input)) continue;
    const path = call.input.file_path ?? call.input.notebook_path;
    if (typeof path !== 'string' || !path.startsWith('/')) continue;
    if (roots.some((root) => path === root || path.startsWith(`${root}/`))) continue;
    out.push({ kind: 'write_outside_project', tool: call.label, path, refused: call.error !== undefined });
  }
  return out;
}

/** A path with its longest existing prefix resolved, the rest kept as written. */
function resolvedPath(path: string): string {
  let head = path;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail.reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return path;
      tail.push(head.slice(parent.length + 1));
      head = parent;
    }
  }
}

function markersOf(raw: unknown): unknown[] {
  return isRecord(raw) && Array.isArray(raw.markers) ? raw.markers : [];
}

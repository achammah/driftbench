import { isRecord, type JsonlLine, parseJsonl, stringField } from '../format';

/**
 * The headless stream, as this runner reads it, checked against the runtime (2.1.296) in the first real run,
 * 2026-10-12.
 *
 * `<runtime> -p <prompt> --output-format stream-json --verbose` prints one JSON record per line:
 * - `system` with `subtype: init`: `session_id`, `cwd`, `model`, `tools` (the tools offered; a tool a
 *   setting denies is absent), `memory_paths`, `skills`. It is not the first line: with
 *   `--include-hook-events` the UserPromptSubmit hook records come before it.
 * - `assistant`: `message` as in the session file (text, tool_use and thinking blocks, `id`, `usage`), with
 *   `timestamp`, `uuid`, `parent_tool_use_id`.
 * - `user`: `message.content` with `tool_result` blocks, `timestamp`, and the structured result as
 *   `tool_use_result` (the session file says `toolUseResult`).
 * - other `system` records: `hook_started`, `hook_response` (`hook_name`, `hook_event`, `exit_code`,
 *   `outcome`, `stdout`, `stderr`), `permission_denied` (`tool_name`), `thinking_tokens`; none has a
 *   timestamp. A `rate_limit_event` record carries the provider's rate state.
 * - `result`: closes the stream. `subtype` (`success`, `error_max_turns`, ...), `is_error`, `result` (the
 *   final text; absent when the turns ran out), `num_turns`, `duration_ms`, `total_cost_usd`, `usage`,
 *   `permission_denials`. A run ending on an error exits 1 with its stream intact.
 * Records a helper writes carry `parent_tool_use_id` (the id of the Agent call that started it); they are
 * the helper's acts, not the agent's.
 *
 * The runner turns one stream into session-file records (see `../format.ts`) so the session adapter maps
 * it into one block: a typed user record with the ask opens the block, the stream's records follow.
 */

export type StreamResult = {
  subtype?: string;
  isError: boolean;
  text?: string;
  numTurns?: number;
  durationMs?: number;
  costUsd?: number;
  usage?: { inputTokens: number; outputTokens: number };
};

export type ParsedStream = {
  /** The session id the runtime gave the run, from the init record or any record carrying one. */
  sessionId?: string;
  model?: string;
  /** The tools the runtime offered the agent, from the init record. A tool a setting denies is not offered. */
  tools?: string[];
  /** The closing result record, when the stream has one. */
  result?: StreamResult;
  /** Records in order, as parsed. */
  lines: JsonlLine[];
  /** What the reader noticed: lines that are not JSON, a stream with no init or no result. */
  issues: string[];
};

export function parseStream(text: string): ParsedStream {
  const lines = parseJsonl(text);
  const out: ParsedStream = { lines, issues: [] };
  let init = false;
  for (const entry of lines) {
    if (!entry.ok) {
      out.issues.push(`stream line ${entry.line} is not JSON: ${entry.error}`);
      continue;
    }
    const record = entry.value;
    if (!isRecord(record)) continue;
    const sessionId = stringField(record, 'session_id');
    if (sessionId !== undefined) out.sessionId ??= sessionId;
    const type = stringField(record, 'type');
    if (type === 'system' && stringField(record, 'subtype') === 'init') {
      init = true;
      const model = stringField(record, 'model');
      if (model !== undefined) out.model = model;
      if (Array.isArray(record.tools))
        out.tools = record.tools.filter((tool): tool is string => typeof tool === 'string');
    }
    if (type === 'result') out.result = resultOf(record);
  }
  if (lines.length > 0 && !init) out.issues.push('the stream has no init record');
  if (lines.length > 0 && out.result === undefined) out.issues.push('the stream has no result record');
  return out;
}

function resultOf(record: Record<string, unknown>): StreamResult {
  const usage = isRecord(record.usage) ? record.usage : undefined;
  const subtype = stringField(record, 'subtype');
  const text = stringField(record, 'result');
  return {
    ...(subtype === undefined ? {} : { subtype }),
    isError: record.is_error === true || (subtype !== undefined && subtype !== 'success'),
    ...(text === undefined ? {} : { text }),
    ...(typeof record.num_turns === 'number' ? { numTurns: record.num_turns } : {}),
    ...(typeof record.duration_ms === 'number' ? { durationMs: record.duration_ms } : {}),
    ...(typeof record.total_cost_usd === 'number' && record.total_cost_usd >= 0
      ? { costUsd: record.total_cost_usd }
      : {}),
    ...(usage
      ? {
          usage: {
            inputTokens:
              count(usage.input_tokens) +
              count(usage.cache_creation_input_tokens) +
              count(usage.cache_read_input_tokens),
            outputTokens: count(usage.output_tokens),
          },
        }
      : {}),
  };
}

const OVERLOADED = /overloaded|\b529\b|rate[ _-]?limit|\b429\b/i;

/**
 * True when a run ended on the provider's overload or rate limit, or on an API it could not reach, rather
 * than on the agent: the result record is an error whose text names it, or its text is an `API Error:` that
 * names one, or the run failed with no result and its error output names it.
 */
const UNREACHABLE =
  /can't reach the API|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|connection error/i;

export function isOverloaded(parsed: ParsedStream, exitCode: number, stderr: string): boolean {
  // An API the runtime could not reach ends the run with subtype success and the error as the text (seen on
  // the Cue bench in a network outage): the turn never reached the agent.
  const text = parsed.result?.text ?? '';
  if (/^API Error:/.test(text) && (UNREACHABLE.test(text) || OVERLOADED.test(text))) return true;
  // A subscription limit ends the run the same way: the notice is the text (seen on the Cue bench).
  if (/^you've hit your (session|usage|weekly|daily) limit/i.test(text)) return true;
  if (parsed.result?.isError)
    return OVERLOADED.test(`${parsed.result.text ?? ''} ${parsed.result.subtype ?? ''}`);
  if (parsed.result === undefined && exitCode !== 0) return OVERLOADED.test(stderr);
  return false;
}

export type NormaliseInput = {
  parsed: ParsedStream;
  /** The ask, as the runtime received it: the typed user record that opens the block. */
  ask: string;
  /** When the turn started; the opening record's timestamp, so every guard and step row of the turn falls in it. */
  startedAt: string;
  cwd: string;
  /** Messages queued while the reply ran: kept as injected records, never as a new turn. */
  queued?: readonly string[];
};

/**
 * Session-file records for one turn: the typed ask, then the stream's records. The init and result records
 * are kept as system records (they open and close the run); a helper's records are marked as sidechain; a
 * typed user record inside the stream (a queued message the runtime echoed) is marked injected, so the turn
 * stays one block. Every record carries the session id and the folder, as the session file does.
 */
export function normaliseStream(input: NormaliseInput): string[] {
  const sessionId = input.parsed.sessionId ?? 'unknown-session';
  const common = { sessionId, cwd: input.cwd };
  const records: unknown[] = [
    {
      ...common,
      type: 'user',
      timestamp: input.startedAt,
      message: { role: 'user', content: input.ask },
    },
  ];
  for (const message of input.queued ?? []) {
    records.push({
      ...common,
      type: 'user',
      isMeta: true,
      queued: true,
      timestamp: input.startedAt,
      message: { role: 'user', content: message },
    });
  }
  for (const entry of input.parsed.lines) {
    if (!entry.ok) continue;
    const record = entry.value;
    if (!isRecord(record)) continue;
    const type = stringField(record, 'type');
    const base: Record<string, unknown> = { ...common, ...record };
    delete base.session_id;
    // The stream names the structured tool result `tool_use_result`; the session file `toolUseResult`.
    if (base.tool_use_result !== undefined && base.toolUseResult === undefined) {
      base.toolUseResult = base.tool_use_result;
      delete base.tool_use_result;
    }
    const helper = typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id !== '';
    if (helper) base.isSidechain = true;
    if (type === 'system' || type === 'result') {
      records.push({ ...base, type: 'system', subtype: type === 'result' ? 'result' : base.subtype });
      continue;
    }
    if (type === 'user' && !helper && typedText(record)) {
      records.push({ ...base, isMeta: true, echoed: true });
      continue;
    }
    records.push(base);
  }
  return records.map((record) => JSON.stringify(record));
}

/** True when a stream user record is a typed message rather than tool results. */
function typedText(record: Record<string, unknown>): boolean {
  const message = isRecord(record.message) ? record.message : undefined;
  const content = message?.content;
  if (typeof content === 'string') return true;
  return Array.isArray(content) && !content.some((part) => isRecord(part) && part.type === 'tool_result');
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** One guard row, in the shape of a decision-log row. */
export type HookRow = {
  at: string;
  event: string;
  check: string;
  verdict: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outcome?: string;
};

/**
 * Guard rows from the stream itself, seen in the first real run with `--include-hook-events`:
 * - a `hook_response` system record (`hook_name` is `<event>:<matcher>` or `<event>`, `exit_code`, `stdout`)
 *   gives a row; the verdict is the `permissionDecision` or `decision` a JSON stdout names, else deny for
 *   exit code 2, allow for 0, warn for another exit code (the runtime goes on and shows the message), and error
 *   for a hook that did not finish (its outcome cancelled or timed out) or reports no exit code;
 * - a `permission_denied` system record gives `permission:<tool>` with verdict deny.
 * The record names no command, so the row is named by the script of the hook the estate's settings put under
 * that event and matcher (`block-force-push.sh`); several commands under one matcher name the responses in
 * turn; `<event>:<matcher>` names it when the settings hold none. Hook records carry no time; every row takes the turn's start, so it falls in the turn.
 */
export function hookDecisions(parsed: ParsedStream, settings: unknown, at: string): HookRow[] {
  const rows: HookRow[] = [];
  const started = new Map<string, Record<string, unknown>>();
  const seen = new Map<string, number>();
  for (const entry of parsed.lines) {
    if (!entry.ok || !isRecord(entry.value)) continue;
    const record = entry.value;
    if (stringField(record, 'type') !== 'system') continue;
    const subtype = stringField(record, 'subtype');
    if (subtype === 'permission_denied') {
      const tool = stringField(record, 'tool_name') ?? 'unknown';
      rows.push({ at, event: 'PermissionRequest', check: `permission:${tool}`, verdict: 'deny' });
      continue;
    }
    if (subtype === 'hook_started') {
      const id = stringField(record, 'hook_id');
      if (id !== undefined) started.set(id, record);
      continue;
    }
    if (subtype !== 'hook_response') continue;
    const id = stringField(record, 'hook_id');
    if (id !== undefined) started.delete(id);
    const { event, check } = named(record, settings, seen);
    const stdout = stringField(record, 'stdout');
    const stderr = stringField(record, 'stderr');
    const outcome = stringField(record, 'outcome');
    rows.push({
      at,
      event,
      check,
      verdict: verdictOf(record),
      ...(stdout === undefined ? {} : { stdout }),
      ...(stderr === undefined ? {} : { stderr }),
      ...(typeof record.exit_code === 'number' ? { exitCode: record.exit_code } : {}),
      ...(outcome === undefined ? {} : { outcome }),
    });
  }
  // A hook that started and never answered: it ran past its time or was stopped.
  for (const record of started.values()) {
    const { event, check } = named(record, settings, seen);
    rows.push({ at, event, check, verdict: 'error', outcome: 'no_response' });
  }
  return rows;
}

/** The event of a hook record and the guard it names: the script of the one hook the settings put there. */
function named(
  record: Record<string, unknown>,
  settings: unknown,
  seen: Map<string, number>,
): { event: string; check: string } {
  const name = stringField(record, 'hook_name') ?? stringField(record, 'hook_event') ?? 'hook';
  const event = stringField(record, 'hook_event') ?? name.split(':')[0] ?? name;
  const matcher = name.includes(':') ? name.slice(name.indexOf(':') + 1) : undefined;
  const scripts = scriptsOf(settings, event, matcher);
  // A matcher holding several commands: the responses take the commands in turn. Each command of the group
  // runs once per event, so the counts per command hold; which verdict belongs to which command is as good
  // as the order the responses arrive in.
  const turn = seen.get(name) ?? 0;
  seen.set(name, turn + 1);
  return { event, check: scripts.length === 0 ? name : (scripts[turn % scripts.length] ?? name) };
}

function verdictOf(record: Record<string, unknown>): string {
  const stdout = stringField(record, 'stdout') ?? '';
  if (stdout.trim().startsWith('{')) {
    try {
      const output: unknown = JSON.parse(stdout);
      if (isRecord(output)) {
        const specific = isRecord(output.hookSpecificOutput) ? output.hookSpecificOutput : {};
        const decision = stringField(specific, 'permissionDecision') ?? stringField(output, 'decision');
        if (decision !== undefined) return decision === 'block' ? 'deny' : decision;
      }
    } catch {
      // Not JSON after all: the exit code decides.
    }
  }
  const code = record.exit_code;
  if (code === 2) return 'deny';
  if (code === 0) return 'allow';
  // A hook that did not finish gave no verdict; one that ended with another code warned (docs/estate.md, unit runs).
  const unfinished = /^(cancelled|canceled|no_response|timeout|timed_out)$/i.test(
    stringField(record, 'outcome') ?? '',
  );
  return typeof code === 'number' && !unfinished ? 'warn' : 'error';
}

/**
 * Whether a settings matcher covers a hook name's suffix. The runtime names a hook by the tool it ran for
 * (`PreToolUse:Edit` under the matcher `Edit|Write`, seen live), so the matcher is read as the runtime reads
 * it, a pattern over the tool name, and the suffix may also be the matcher itself.
 */
function matches(own: string | undefined, suffix: string | undefined): boolean {
  if (own === undefined || suffix === undefined) return own === suffix;
  if (own === suffix) return true;
  try {
    return new RegExp(`^(?:${own})$`).test(suffix);
  } catch {
    return false;
  }
}

/** The script names of the command hooks the settings put under the event and matcher, in order. */
function scriptsOf(settings: unknown, event: string, matcher: string | undefined): string[] {
  const hooks = isRecord(settings) && isRecord(settings.hooks) ? settings.hooks : undefined;
  const groups = hooks?.[event];
  if (!Array.isArray(groups)) return [];
  const commands: string[] = [];
  for (const group of groups) {
    if (!isRecord(group)) continue;
    const own = typeof group.matcher === 'string' && group.matcher !== '' ? group.matcher : undefined;
    if (!matches(own, matcher)) continue;
    for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
      if (isRecord(hook) && typeof hook.command === 'string') commands.push(hook.command);
    }
  }
  return commands.map((command) => {
    const words = command.split(/\s+/).map((word) => word.replace(/["']/g, ''));
    const script = [...words].reverse().find((word) => /\.[A-Za-z0-9]+$/.test(word)) ?? words.at(-1);
    return script?.split('/').at(-1) ?? command;
  });
}

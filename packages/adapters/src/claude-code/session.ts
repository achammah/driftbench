import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  ExecutionRecord,
  Observed,
  RuntimeTrace,
  Segment,
  Stimulus,
  ToolCall,
  WorkspaceDiff,
} from '@agent-nexus/driftbench-core';
import { globMatches, ObservedReplyAct } from '@agent-nexus/driftbench-core';
import {
  type DecisionRow,
  decisionRow,
  isRecord,
  type JsonlLine,
  parseJsonl,
  type StepRow,
  stepRow,
  stringField,
} from './format';

/**
 * Maps a Claude Code session (the transcript, and optionally a guard decision log and a step feed) onto
 * the generic trace: one block per user turn, each with its stimulus and an Observed. See `format.ts` for
 * the format.
 *
 * - A block runs from one typed user message to the next. Tool results, injected messages and the summary
 *   after a compaction belong to the block they arrive in.
 * - `tool_use` gives a ToolCall and a `tool_call` segment with the full input (the Agent call keeps its
 *   whole brief); its `tool_result` gives the call's output or error and a `tool_result` segment.
 * - Skill calls give `runtime.skills` (`input.skill`). Bash calls give an ExecutionRecord: the command, and
 *   the exit code from the structured result when it has one, else `Exit code N` at the start of an error
 *   result, else 1 for an error and 0 for a success.
 * - Assistant text gives `text` segments; `text` is the block's text blocks joined by a blank line.
 * - An assistant record may carry `replyAct` from an adapter or declared judge. Its message-content index
 *   maps to a nonblank observed text segment; the original record stays in `raw.kept`. Absent, invalid,
 *   sidechain or superseded evidence never supplies a reply classification.
 * - Decision-log rows give `runtime.guards` (name: check, verdict) and step-feed rows `runtime.stages`, each
 *   in the block whose time window holds its `at`: from the block's user message to the next one. A row
 *   earlier than the first block goes to the first block.
 * - Read paths stay in the Read calls' input, so ordered checks see a read before a write. The workspace
 *   diff comes from Write, Edit, MultiEdit and NotebookEdit targets that succeeded, relative to the session
 *   folder: an edit changes a file; a write creates it when the runtime says so (`type: create`) or when the
 *   session never saw the path before, and changes it otherwise. With a before and after tree the last
 *   block's diff is the diff of the trees, which also sees deletions.
 * - A compaction boundary is a marker in the block's `raw.markers`, with the number of tool calls before it.
 * - A `system` record with `subtype: init` names the tools the runtime offered (`tools`). They become
 *   `runtime.offered` of the block it falls in and of every later block, until the next init record. A block
 *   before any init record has no `offered` at all, never an empty list, so a check of offered tools is
 *   inconclusive there.
 * - Every record the mapping does not use (thinking, snapshots, helper records, unknown types, lines that
 *   are not JSON) is kept in `raw.kept` of its block, or in `meta.preamble` before the first turn.
 */

export type Marker = {
  kind: 'compaction' | 'compact_summary';
  line: number;
  at?: string;
  /** How many tool calls of the block came before the marker. */
  afterToolCalls: number;
  trigger?: string;
  preTokens?: number;
};

/** A record, or a piece of one, that the mapping keeps without mapping it. */
export type KeptRecord = { line: number; reason: string; record: unknown };

export type ReplayRaw = {
  runtime: 'claude-code';
  lines: { first: number; last: number };
  markers: Marker[];
  kept: KeptRecord[];
};

export type ReplayBlock = { stimulus: Stimulus; observed: Observed };

export type BlockMeta = {
  index: number;
  startLine: number;
  endLine: number;
  at?: string;
  markers: Marker[];
  /** Paths read and written in the block, in order, as the calls named them. */
  reads: string[];
  writes: string[];
};

export type SessionMeta = {
  file?: string;
  sessionId?: string;
  cwd?: string;
  version?: string;
  /** Non-blank lines of the transcript. */
  records: number;
  blocks: BlockMeta[];
  /** Records before the first user turn. */
  preamble: KeptRecord[];
  summaries: string[];
  /** Decision-log and step-feed rows no block could take, with the reason. */
  unplaced: {
    guards: Array<{ row: unknown; reason: string }>;
    stages: Array<{ row: unknown; reason: string }>;
  };
  /** What the reader noticed: rows of other sessions, calls with no result, lines that are not JSON. */
  issues: string[];
  /** The diff of the before and after trees, when both were given. */
  workspaceDiff?: WorkspaceDiff;
  /** Whether a decision log and a step feed were given; without one the trace has no guards or stages. */
  decisions: boolean;
  steps: boolean;
};

export type ReplaySession = { blocks: ReplayBlock[]; meta: SessionMeta };

export type Tree = Readonly<Record<string, string>>;

export type SessionInput = {
  transcript: JsonlLine[];
  decisions?: JsonlLine[];
  steps?: JsonlLine[];
  trees?: { before: Tree; after: Tree };
  file?: string;
  /** Paths or globs the spec names: a successful Read of a matching file is a reference too. */
  references?: readonly string[];
};

export type SessionPaths = {
  transcript: string;
  decisions?: string;
  steps?: string;
  /** Folders whose files are hashed into the before and after trees. */
  before?: string;
  after?: string;
  /** Paths or globs the spec names, mapped to references beside the skill folders. */
  references?: readonly string[];
};

/** Reads a session from its files and maps it. */
export async function readSession(paths: SessionPaths): Promise<ReplaySession> {
  const lines = async (path: string) => parseJsonl(await readFile(path, 'utf8'));
  const trees =
    paths.before !== undefined && paths.after !== undefined
      ? { before: await treeOf(paths.before), after: await treeOf(paths.after) }
      : undefined;
  if ((paths.before === undefined) !== (paths.after === undefined)) {
    throw new Error('readSession: a before tree needs an after tree, and the other way round');
  }
  return mapSession({
    transcript: await lines(paths.transcript),
    ...(paths.decisions === undefined ? {} : { decisions: await lines(paths.decisions) }),
    ...(paths.steps === undefined ? {} : { steps: await lines(paths.steps) }),
    ...(trees ? { trees } : {}),
    ...(paths.references === undefined ? {} : { references: paths.references }),
    file: paths.transcript,
  });
}

/** The files under a folder, by path relative to it, with the SHA-256 of their content. Skips .git and node_modules. */
export async function treeOf(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        out[relative(dir, full).split('\\').join('/')] = createHash('sha256')
          .update(await readFile(full))
          .digest('hex');
      }
    }
  };
  await walk(dir);
  return out;
}

/** The diff between two trees: created, changed and deleted paths, sorted. */
export function diffTrees(before: Tree, after: Tree): WorkspaceDiff {
  const created: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const [path, hash] of Object.entries(after)) {
    if (!Object.hasOwn(before, path)) created.push(path);
    else if (before[path] !== hash) changed.push(path);
  }
  for (const path of Object.keys(before)) if (!Object.hasOwn(after, path)) deleted.push(path);
  return { created: created.sort(), changed: changed.sort(), deleted: deleted.sort() };
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
/** A file inside a skill folder: a `skills/<name>/` segment anywhere in its path. */
const SKILL_FILE = /(^|\/)skills\/[^/]+\//;
const OUTPUT_LIMIT = 4000;

type PendingCall = { call: ToolCall; at?: string; line: number };

class BlockBuilder {
  /** The tools the runtime offered in this block, from the last init record; undefined when none was seen. */
  offered?: string[];
  /** The stop reason of the last model message in the block, as the transcript records it. */
  finishReason?: string;
  replyAct?: ObservedReplyAct;
  readonly segments: Segment[] = [];
  readonly texts: string[] = [];
  readonly toolCalls: ToolCall[] = [];
  readonly executions: ExecutionRecord[] = [];
  readonly skills: NonNullable<RuntimeTrace['skills']> = [];
  readonly guards: NonNullable<RuntimeTrace['guards']> = [];
  readonly stages: NonNullable<RuntimeTrace['stages']> = [];
  readonly references: NonNullable<RuntimeTrace['references']> = [];
  readonly subagents: NonNullable<RuntimeTrace['subagents']> = [];
  readonly markers: Marker[] = [];
  readonly kept: KeptRecord[] = [];
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly created: string[] = [];
  readonly changed: string[] = [];
  readonly usage = new Map<string, { input: number; output: number }>();
  firstAt?: string;
  lastAt?: string;
  endLine: number;

  constructor(
    readonly index: number,
    readonly stimulus: Stimulus,
    readonly startLine: number,
    readonly at: string | undefined,
  ) {
    this.endLine = startLine;
    this.firstAt = at;
    this.lastAt = at;
  }

  touch(line: number, at: string | undefined): void {
    this.endLine = line;
    if (at !== undefined && !Number.isNaN(Date.parse(at))) {
      this.firstAt ??= at;
      this.lastAt = at;
    }
  }
}

/** Maps parsed session files onto blocks. Pure: the same input gives the same output. */
export function mapSession(input: SessionInput): ReplaySession {
  assertTranscript(input);
  const meta: SessionMeta = {
    ...(input.file === undefined ? {} : { file: input.file }),
    records: input.transcript.length,
    blocks: [],
    preamble: [],
    summaries: [],
    unplaced: { guards: [], stages: [] },
    issues: [],
    decisions: input.decisions !== undefined,
    steps: input.steps !== undefined,
  };
  const builders: BlockBuilder[] = [];
  const pending = new Map<string, PendingCall>();
  /** Paths the session has seen exist: read, edited or written. */
  const known = new Set<string>();
  let anonymous = 0;
  /** The tools offered from the last init record on; undefined until one is seen. */
  let offered: string[] | undefined;

  const current = () => builders.at(-1);
  const keep = (line: number, reason: string, record: unknown) => {
    const block = current();
    if (block) block.kept.push({ line, reason, record });
    else meta.preamble.push({ line, reason, record });
  };
  const rel = (path: string) => relativeTo(meta.cwd, path);
  const named = input.references ?? [];
  /** A file under a skill folder, or a path the spec names, is a reference. */
  const isReference = (path: string) =>
    SKILL_FILE.test(path) || named.some((pattern) => globMatches(pattern, path));

  for (const entry of input.transcript) {
    if (!entry.ok) {
      meta.issues.push(`line ${entry.line} is not JSON: ${entry.error}`);
      keep(entry.line, `not JSON: ${entry.error}`, entry.text);
      continue;
    }
    const record = entry.value;
    const line = entry.line;
    if (!isRecord(record)) {
      keep(line, 'not an object', record);
      continue;
    }
    meta.sessionId ??= stringField(record, 'sessionId');
    meta.cwd ??= stringField(record, 'cwd');
    meta.version ??= stringField(record, 'version');
    const type = stringField(record, 'type');
    const at = stringField(record, 'timestamp');

    if (record.isSidechain === true) {
      keep(line, 'a helper record (sidechain)', record);
      current()?.touch(line, undefined);
      continue;
    }
    if (type === 'summary') {
      const summary = stringField(record, 'summary');
      if (summary !== undefined) meta.summaries.push(summary);
      else keep(line, 'a summary with no text', record);
      continue;
    }
    if (type === 'system') {
      const block = current();
      if (stringField(record, 'subtype') === 'init' && Array.isArray(record.tools)) {
        // The runtime's init record names the tools it offered: a tool a setting denies is not offered.
        offered = record.tools.filter((tool): tool is string => typeof tool === 'string');
        if (block) {
          block.offered = offered;
          block.touch(line, at);
        }
        keep(line, 'the init record (its tools are the offered tools)', record);
      } else if (stringField(record, 'subtype') === 'compact_boundary') {
        const data = isRecord(record.compactMetadata) ? record.compactMetadata : {};
        const marker: Marker = {
          kind: 'compaction',
          line,
          ...(at === undefined ? {} : { at }),
          afterToolCalls: block?.toolCalls.length ?? 0,
          ...(typeof data.trigger === 'string' ? { trigger: data.trigger } : {}),
          ...(typeof data.preTokens === 'number' ? { preTokens: data.preTokens } : {}),
        };
        if (block) {
          block.markers.push(marker);
          block.touch(line, at);
        } else meta.preamble.push({ line, reason: 'a compaction before the first turn', record });
      } else {
        keep(line, 'a system record', record);
        block?.touch(line, at);
      }
      continue;
    }
    if (type === 'user') {
      const message = isRecord(record.message) ? record.message : undefined;
      const content = message?.content;
      if (record.isCompactSummary === true) {
        const block = current();
        if (block) {
          block.markers.push({
            kind: 'compact_summary',
            line,
            ...(at === undefined ? {} : { at }),
            afterToolCalls: block.toolCalls.length,
          });
          block.kept.push({ line, reason: 'the summary after a compaction', record });
          block.touch(line, at);
        } else meta.preamble.push({ line, reason: 'a compaction summary before the first turn', record });
        continue;
      }
      if (record.isMeta === true) {
        keep(line, 'a message the runtime injected (isMeta)', record);
        current()?.touch(line, at);
        continue;
      }
      const results = Array.isArray(content)
        ? content.filter((part) => isRecord(part) && part.type === 'tool_result')
        : [];
      if (results.length > 0 && Array.isArray(content)) {
        const block = current();
        if (!block) {
          meta.preamble.push({ line, reason: 'a tool result before the first turn', record });
          continue;
        }
        block.touch(line, at);
        for (const part of content) {
          if (!isRecord(part) || part.type !== 'tool_result') {
            block.kept.push({ line, reason: 'a block beside tool results', record: part });
            continue;
          }
          applyResult(block, part, record, line, at);
        }
        continue;
      }
      const text = userText(content);
      if (text === undefined) {
        keep(line, 'a user record with no text', record);
        continue;
      }
      const block = new BlockBuilder(builders.length, { user: text }, line, at);
      if (offered !== undefined) block.offered = offered;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!isRecord(part) || part.type !== 'text') {
            block.kept.push({ line, reason: 'a non-text block in the user message', record: part });
          }
        }
      }
      builders.push(block);
      continue;
    }
    if (type === 'assistant') {
      const block = current();
      if (!block) {
        meta.preamble.push({ line, reason: 'an assistant record before the first turn', record });
        continue;
      }
      block.touch(line, at);
      const message = isRecord(record.message) ? record.message : {};
      if (typeof message.stop_reason === 'string') block.finishReason = message.stop_reason;
      const usage = isRecord(message.usage) ? message.usage : undefined;
      if (usage) {
        const id = typeof message.id === 'string' ? message.id : `anonymous-${anonymous++}`;
        block.usage.set(id, {
          input:
            num(usage.input_tokens) +
            num(usage.cache_creation_input_tokens) +
            num(usage.cache_read_input_tokens),
          output: num(usage.output_tokens),
        });
      }
      const content = Array.isArray(message.content)
        ? message.content
        : typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : [];
      const textSegments = new Map<number, number>();
      // A later unclassified reply cannot inherit the classification of an earlier text.
      if (record.replyAct !== undefined || content.some((part) => isRecord(part) && part.type === 'text'))
        block.replyAct = undefined;
      for (const [contentIndex, part] of content.entries()) {
        if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
          if (part.text.trim() !== '') textSegments.set(contentIndex, block.segments.length);
          block.segments.push({ type: 'text', text: part.text });
          block.texts.push(part.text);
        } else if (isRecord(part) && part.type === 'tool_use' && typeof part.name === 'string' && part.name) {
          applyCall(block, part, line, at);
        } else {
          block.kept.push({
            line,
            reason:
              isRecord(part) && typeof part.type === 'string' ? `a ${part.type} block` : 'an unknown block',
            record: part,
          });
        }
      }
      if (record.replyAct !== undefined) {
        // The runtime's index is local to message.content. Thinking and tool blocks do not become text
        // segments, while earlier messages may already have added segments to this observed block.
        block.kept.push({ line, reason: 'the runtime reply act evidence', record });
        const parsed = ObservedReplyAct.safeParse(record.replyAct);
        const index = parsed.success ? textSegments.get(parsed.data.evidence.index) : undefined;
        if (!parsed.success || index === undefined) {
          meta.issues.push(`line ${line}: invalid reply act evidence or no referenced text segment`);
        } else {
          block.replyAct = {
            ...parsed.data,
            evidence: { ...parsed.data.evidence, index },
          };
        }
      }
      continue;
    }
    keep(line, `a record of type ${type ?? '(none)'}`, record);
  }

  function applyCall(block: BlockBuilder, part: Record<string, unknown>, line: number, at?: string): void {
    const label = part.name as string;
    const id = typeof part.id === 'string' ? part.id : undefined;
    const input = part.input;
    const call: ToolCall = {
      ...(id === undefined ? {} : { id }),
      label,
      input,
      ...(at === undefined ? {} : { startedAt: at }),
    };
    block.toolCalls.push(call);
    block.segments.push({ type: 'tool_call', ...(id === undefined ? {} : { id }), label, input });
    const fields = isRecord(input) ? input : {};
    if (label === 'Skill') {
      const name =
        stringField(fields, 'skill') ?? stringField(fields, 'name') ?? stringField(fields, 'command');
      if (name !== undefined) block.skills.push({ name, ...(at === undefined ? {} : { at }) });
      else meta.issues.push(`line ${line}: a Skill call with no skill name`);
    }
    const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path');
    if (label === 'Read' && path !== undefined) block.reads.push(path);
    if (WRITE_TOOLS.has(label) && path !== undefined) block.writes.push(path);
    if (id !== undefined) pending.set(id, { call, ...(at === undefined ? {} : { at }), line });
    else meta.issues.push(`line ${line}: a ${label} call with no id; its result cannot be matched`);
    if (AGENT_TOOLS.has(label) && !isRecord(input)) {
      meta.issues.push(`line ${line}: an ${label} call whose brief is not an object`);
    }
    if (AGENT_TOOLS.has(label)) {
      const model = stringField(fields, 'model');
      block.subagents.push({
        name: stringField(fields, 'subagent_type') ?? 'general-purpose',
        ...(model === undefined ? {} : { model }),
        ...(at === undefined ? {} : { at }),
      });
    }
  }

  function applyResult(
    block: BlockBuilder,
    part: Record<string, unknown>,
    record: Record<string, unknown>,
    line: number,
    at?: string,
  ): void {
    const id = typeof part.tool_use_id === 'string' ? part.tool_use_id : undefined;
    const open = id === undefined ? undefined : pending.get(id);
    if (!open || id === undefined) {
      block.kept.push({ line, reason: 'a tool result with no matching call', record: part });
      meta.issues.push(`line ${line}: a tool result for ${id ?? '(no id)'} with no matching call`);
      return;
    }
    pending.delete(id);
    const { call } = open;
    const isError = part.is_error === true;
    const output = part.content;
    const text = resultText(output);
    if (isError) call.error = text;
    else call.output = output;
    const latency = elapsed(open.at, at);
    if (latency !== undefined) call.latencyMs = latency;
    block.segments.push({
      type: 'tool_result',
      id,
      label: call.label,
      output,
      ...(isError ? { error: text } : {}),
    });
    const structured = isRecord(record.toolUseResult) ? record.toolUseResult : undefined;
    const fields = isRecord(call.input) ? call.input : {};

    if (call.label === 'Bash') {
      const command = stringField(fields, 'command') ?? '';
      const stdout = typeof structured?.stdout === 'string' ? structured.stdout : text;
      const stderr = typeof structured?.stderr === 'string' ? structured.stderr : undefined;
      const truncated = stdout.length > OUTPUT_LIMIT || (stderr?.length ?? 0) > OUTPUT_LIMIT;
      block.executions.push({
        command,
        role: 'command',
        exitCode: exitCodeOf(structured, isError, text),
        stdout: stdout.slice(0, OUTPUT_LIMIT),
        ...(stderr === undefined ? {} : { stderr: stderr.slice(0, OUTPUT_LIMIT) }),
        ...(open.at === undefined ? {} : { startedAt: open.at }),
        ...(latency === undefined ? {} : { latencyMs: latency }),
        ...(truncated ? { truncated: true } : {}),
      });
    }
    const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path');
    if (path === undefined || isError) return;
    if (call.label === 'Read') {
      known.add(path);
      const read = rel(path);
      if (isReference(read))
        block.references.push({ path: read, ...(open.at === undefined ? {} : { at: open.at }) });
      return;
    }
    if (!WRITE_TOOLS.has(call.label)) return;
    const relativePath = rel(path);
    const kind = structured?.type;
    const createdNow =
      call.label === 'Write' && (kind === 'create' || (kind !== 'update' && !known.has(path)));
    known.add(path);
    if (createdNow) {
      if (!block.created.includes(relativePath)) block.created.push(relativePath);
      const at = block.changed.indexOf(relativePath);
      if (at >= 0) block.changed.splice(at, 1);
    } else if (!block.created.includes(relativePath) && !block.changed.includes(relativePath)) {
      block.changed.push(relativePath);
    }
  }

  for (const open of pending.values()) {
    const name = open.call.id === undefined ? '' : ` ${open.call.id}`;
    meta.issues.push(`line ${open.line}: the ${open.call.label} call${name} has no result`);
  }

  placeRows(input, meta, builders);

  const treeDiff = input.trees ? diffTrees(input.trees.before, input.trees.after) : undefined;
  if (treeDiff) meta.workspaceDiff = treeDiff;

  const blocks = builders.map((block, index): ReplayBlock => {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const usage of block.usage.values()) {
      inputTokens += usage.input;
      outputTokens += usage.output;
    }
    const runtime: RuntimeTrace = {
      skills: block.skills,
      references: block.references,
      subagents: block.subagents,
      ...(meta.decisions ? { guards: block.guards } : {}),
      ...(meta.steps ? { stages: block.stages } : {}),
      // Absent, never empty, when no init record named the offered tools: the check is then inconclusive.
      ...(block.offered === undefined ? {} : { offered: [...block.offered] }),
      ...(block.finishReason === undefined ? {} : { finishReason: block.finishReason }),
    };
    const diff =
      treeDiff && index === builders.length - 1
        ? treeDiff
        : { created: block.created, changed: block.changed, deleted: [] };
    const raw: ReplayRaw = {
      runtime: 'claude-code',
      lines: { first: block.startLine, last: block.endLine },
      markers: block.markers,
      kept: block.kept,
    };
    meta.blocks.push({
      index,
      startLine: block.startLine,
      endLine: block.endLine,
      ...(block.at === undefined ? {} : { at: block.at }),
      markers: block.markers,
      reads: block.reads,
      writes: block.writes,
    });
    const observed: Observed = {
      segments: block.segments,
      text: block.texts.join('\n\n'),
      toolCalls: block.toolCalls,
      runtime,
      ...(block.replyAct === undefined ? {} : { replyAct: block.replyAct }),
      workspaceDiff: diff,
      executions: block.executions,
      cost: {
        ...(block.usage.size > 0 ? { inputTokens, outputTokens } : {}),
      },
      latencyMs: elapsed(block.firstAt, block.lastAt) ?? 0,
      raw,
    };
    return { stimulus: block.stimulus, observed };
  });
  return { blocks, meta };
}

/** Puts decision-log rows into `runtime.guards` and step-feed rows into `runtime.stages`, by time window. */
function placeRows(input: SessionInput, meta: SessionMeta, builders: BlockBuilder[]): void {
  const starts = builders.map((block) => (block.at === undefined ? Number.NaN : Date.parse(block.at)));
  const blockAt = (at: string): { block: BlockBuilder; carried?: true } | string => {
    if (builders.length === 0) return 'the session has no user turn';
    const time = Date.parse(at);
    let found: BlockBuilder | undefined;
    builders.forEach((block, index) => {
      const start = starts[index] ?? Number.NaN;
      if (!Number.isNaN(start) && start <= time) found = block;
    });
    if (found) return { block: found };
    if (starts.every((start) => Number.isNaN(start))) return 'the transcript has no timestamps';
    return { block: builders[0] as BlockBuilder, carried: true };
  };
  let otherSession = 0;
  const guards: Array<{ row: DecisionRow; block: BlockBuilder }> = [];
  for (const entry of input.decisions ?? []) {
    const row = entry.ok ? decisionRow(entry.value) : `line ${entry.line} is not JSON: ${entry.error}`;
    if (typeof row === 'string') {
      meta.unplaced.guards.push({ row: entry.ok ? entry.value : entry.text, reason: row });
      continue;
    }
    if (row.session !== undefined && meta.sessionId !== undefined && row.session !== meta.sessionId) {
      otherSession += 1;
      continue;
    }
    const placement = blockAt(row.at);
    if (typeof placement === 'string') meta.unplaced.guards.push({ row, reason: placement });
    else guards.push({ row, block: placement.block });
  }
  if (otherSession > 0) {
    meta.issues.push(`${otherSession} decision-log rows belong to another session and were left out`);
  }
  for (const { row, block } of sortByAt(guards)) {
    block.guards.push({
      name: row.check,
      verdict: row.verdict,
      at: row.at,
      ...(row.stdout === undefined ? {} : { stdout: row.stdout }),
      ...(row.stderr === undefined ? {} : { stderr: row.stderr }),
      ...(row.exitCode === undefined ? {} : { exitCode: row.exitCode }),
      ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
    });
  }
  const stages: Array<{ row: StepRow; block: BlockBuilder; carried?: true }> = [];
  for (const entry of input.steps ?? []) {
    const row = entry.ok ? stepRow(entry.value) : `line ${entry.line} is not JSON: ${entry.error}`;
    if (typeof row === 'string') {
      meta.unplaced.stages.push({ row: entry.ok ? entry.value : entry.text, reason: row });
      continue;
    }
    const placement = blockAt(row.at);
    if (typeof placement === 'string') meta.unplaced.stages.push({ row, reason: placement });
    else stages.push({ row, ...placement });
  }
  for (const { row, block, carried } of sortByAt(stages)) {
    block.stages.push({ name: row.step, at: row.at, ...(carried ? { carried } : {}) });
  }
}

function sortByAt<T extends { row: { at: string } }>(rows: T[]): T[] {
  return rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => Date.parse(a.row.row.at) - Date.parse(b.row.row.at) || a.order - b.order)
    .map((entry) => entry.row);
}

/** The text of a typed user message: a string, or its text blocks joined. Undefined when it has none. */
function userText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === 'text')
    .map((part) => (typeof part.text === 'string' ? part.text : ''));
  return texts.length > 0 ? texts.join('\n') : undefined;
}

/** A tool result's content as text: the string, or the text blocks joined. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === 'text')
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return content === undefined ? '' : JSON.stringify(content);
}

/** The exit code of a Bash result: structured when the runtime gives one, else read from the error text. */
function exitCodeOf(structured: Record<string, unknown> | undefined, isError: boolean, text: string): number {
  for (const key of ['exitCode', 'exit_code', 'returnCode']) {
    const value = structured?.[key];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  if (!isError) return 0;
  const match = /^Exit code (-?\d+)/m.exec(text);
  return match ? Number(match[1]) : 1;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function elapsed(from: string | undefined, to: string | undefined): number | undefined {
  if (from === undefined || to === undefined) return undefined;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** A path relative to the session folder when it lies inside it; the path as written otherwise. */
function relativeTo(cwd: string | undefined, path: string): string {
  if (cwd === undefined) return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/** Thrown when a file is not a Claude Code transcript, so a corpus in another shape never reads as empty sessions. */
export class NotATranscriptError extends Error {
  override name = 'NotATranscriptError';
}

const TRANSCRIPT_TYPES = new Set(['user', 'assistant']);

/**
 * A transcript holds at least one record of type user or assistant. A file with none (another JSONL shape,
 * only lines that are not JSON, or nothing at all) is refused with what its first line holds.
 */
function assertTranscript(input: SessionInput): void {
  const where = input.file === undefined ? 'the transcript' : input.file;
  const parsed = input.transcript.filter((entry) => entry.ok);
  const typed = parsed.some(
    (entry) => entry.ok && isRecord(entry.value) && TRANSCRIPT_TYPES.has(String(entry.value.type)),
  );
  if (typed) return;
  if (input.transcript.length === 0) {
    throw new NotATranscriptError(`${where} is not a Claude Code transcript: it holds no record`);
  }
  const first = input.transcript[0];
  const shape =
    first === undefined || !first.ok
      ? `line ${first?.line ?? 1} is not JSON`
      : isRecord(first.value)
        ? `line ${first.line} has the keys ${Object.keys(first.value).slice(0, 6).join(', ') || '(none)'}`
        : `line ${first.line} is not an object`;
  throw new NotATranscriptError(
    `${where} is not a Claude Code transcript: no record has type user or assistant (${shape})`,
  );
}

#!/usr/bin/env node
// @driftbench-stand-in: a fake headless runtime. No model call, no cost.
/**
 * A FAKE headless runtime for the live runner's tests and proofs. It speaks the stream the live runner reads
 * (`-p <ask> --output-format stream-json --verbose [--resume <id>]`, or the ask on the input with
 * `--input-format stream-json`). By default it derives its actions from the estate in its working folder.
 * It calls no model and costs nothing. Fixture data is fictional.
 *
 * - `FAKE_MANIFEST` explicitly opts into recorded playback for protocol tests. Its paths are relative to
 *   the manifest. The legacy protocol manifest retains two quote-based alternatives for its CLI proof;
 *   they are unreachable without explicit recording opt-in.
 * - A stream file holds stream records (`{{cwd}}` and `{{session_id}}` are filled in) and directives the fake
 *   performs instead of printing: `{"fake":"decision", event, check, verdict}` appends a guard row to
 *   `HOOK_DECISION_LOG`, `{"fake":"step", step}` a step row to `STEP_FEED`, `{"fake":"write", path, content}`
 *   and `{"fake":"edit", path, old, new}` change the workspace, `{"fake":"delete", path}` removes a file.
 * - The init and result records are written by the fake; the result's cost is 0.
 * - `RATE_WAVE_FILE` holding n > 0: the run answers overloaded and counts n down.
 * - `--resume <id>` reads `<config>/projects/<folder>/<id>.jsonl`, where the config folder is
 *   `CLAUDE_CONFIG_DIR` or `~/.claude` as for the runtime; a missing file fails the run as
 *   the runtime does. Every turn is appended to that file.
 * - `FAKE_CALLS` (tests only): one JSON line per call, with what the fake saw.
 */
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { planStream } from './agent.mjs';

const args = process.argv.slice(2);
const cwd = process.cwd();
const env = process.env;

const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const streamInput = flag('--input-format') === 'stream-json';
const resume = flag('--resume');
// The run's permissions, as the runtime takes them: a mode, and rules that each argument after the flag names.
const permissionMode = flag('--permission-mode');
const rulesAfter = (...names) => {
  const at = args.findIndex((arg) => names.includes(arg));
  if (at < 0) return [];
  const rules = [];
  for (const arg of args.slice(at + 1)) {
    if (arg.startsWith('-')) break;
    rules.push(...arg.split(/[,\s]+(?![^(]*\))/).filter(Boolean));
  }
  return rules;
};
const allowedTools = rulesAfter('--allowed-tools', '--allowedTools');
const disallowedTools = rulesAfter('--disallowed-tools', '--disallowedTools');

let ask = '';
const queued = [];
if (streamInput) {
  const lines = readFileSync(0, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  const texts = lines.map((line) => JSON.parse(line).message.content);
  ask = texts[0] ?? '';
  queued.push(...texts.slice(1));
} else {
  ask = flag('-p') ?? '';
}

const print = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);

// A wave of overloaded answers, counted down in the file the runner armed.
if (env.RATE_WAVE_FILE && existsSync(env.RATE_WAVE_FILE)) {
  const left = Number.parseInt(readFileSync(env.RATE_WAVE_FILE, 'utf8'), 10);
  if (left > 0) {
    writeFileSync(env.RATE_WAVE_FILE, `${left - 1}\n`);
    log({ overloaded: true, left: left - 1 });
    print({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      session_id: resume ?? 'none',
    });
    process.exit(1);
  }
}

const projectFolder = cwd.replace(/[^A-Za-z0-9]/g, '-');
const sessionId = resume ?? randomUUID();
let sessionPath;
const previous = [];
let torn = false;
// As the runtime does: the config folder is CLAUDE_CONFIG_DIR, else .claude in the home folder.
const configDir = env.CLAUDE_CONFIG_DIR ?? (env.HOME ? join(env.HOME, '.claude') : undefined);
if (configDir) {
  sessionPath = join(configDir, 'projects', projectFolder, `${sessionId}.jsonl`);
}
if (resume !== undefined) {
  const found = findSession(resume);
  if (found === undefined) {
    process.stderr.write(`No conversation found with session ID: ${resume}\n`);
    log({ resume, found: false });
    process.exit(1);
  }
  sessionPath = found;
  for (const line of readFileSync(found, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      previous.push(JSON.parse(line));
    } catch {
      torn = true;
    }
  }
}

const helpers = readHelpers();
const manifestPath = env.FAKE_MANIFEST;
const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
const entry = manifest?.asks.find((candidate) => candidate.ask === ask);
let streamFile = entry?.stream ?? manifest?.default;
let played = manifest ? (entry ? 'recorded' : 'default') : 'estate';
// Legacy protocol cases only. Default estate execution never reads a manifest or selects a recording.
for (const rule of entry?.unless ?? []) {
  const text = readText(join(cwd, rule.file));
  if (text === undefined || !text.includes(rule.quote)) {
    streamFile = rule.stream;
    played = `unless ${rule.file}`;
    break;
  }
}

log({
  argv: args,
  configDir: env.CLAUDE_CONFIG_DIR ?? null,
  ask,
  queued,
  resume: resume ?? null,
  found: resume === undefined ? null : true,
  records: previous.length,
  torn,
  compacted: previous.some((record) => record.type === 'system' && record.subtype === 'compact_boundary'),
  pendingHelpers: previous.filter((record) => record.isSidechain === true).length,
  helpers,
  played,
  stream: streamFile,
  estate: existsSync(join(cwd, 'CLAUDE.md')),
});

const base = Date.now();
let tick = 0;
const stamp = () => new Date(base + 10 * tick++).toISOString();
const fill = (text) =>
  text
    .split('{{cwd}}')
    .join(cwd)
    .split('{{session_id}}')
    .join(sessionId)
    .split('{{home}}')
    .join(env.HOME ?? '');

print({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  cwd,
  model: 'fake-model',
  tools: offeredTools(),
  timestamp: stamp(),
});
const written = [
  { type: 'user', sessionId, cwd, timestamp: stamp(), message: { role: 'user', content: ask } },
];
let lastText = '';
let turns = 0;
const usage = { input_tokens: 0, output_tokens: 0 };
const records = manifestPath
  ? readFileSync(resolve(dirname(manifestPath), streamFile), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(fill(line)))
  : planStream({
      ask,
      cwd,
      sessionId,
      env,
      compacted: previous.some((record) => record.type === 'system' && record.subtype === 'compact_boundary'),
      permissionMode,
      allowedTools,
      disallowedTools,
    }).records;
for (const record of records) {
  if (record.fake === 'decision') {
    if (env.HOOK_DECISION_LOG) {
      const { event, check, verdict } = record;
      appendFileSync(
        env.HOOK_DECISION_LOG,
        `${JSON.stringify({ at: stamp(), event, check, verdict, session: sessionId })}\n`,
      );
    }
    continue;
  }
  if (record.fake === 'step') {
    if (env.STEP_FEED)
      appendFileSync(env.STEP_FEED, `${JSON.stringify({ at: stamp(), step: record.step })}\n`);
    continue;
  }
  if (record.fake === 'write') {
    mkdirSync(dirname(join(cwd, record.path)), { recursive: true });
    writeFileSync(join(cwd, record.path), record.content);
    continue;
  }
  if (record.fake === 'delete') {
    rmSync(join(cwd, record.path), { force: true });
    continue;
  }
  if (record.fake === 'move') {
    mkdirSync(dirname(join(cwd, record.to)), { recursive: true });
    renameSync(join(cwd, record.from), join(cwd, record.to));
    continue;
  }
  if (record.fake === 'write_abs') {
    // A write outside the project, as the runtime's Write tool would make it; its result is what happened.
    let result;
    try {
      writeFileSync(record.path, record.content);
      result = {
        type: 'tool_result',
        tool_use_id: record.tool_use_id,
        content: `File written: ${record.path}`,
      };
    } catch (error) {
      result = {
        type: 'tool_result',
        tool_use_id: record.tool_use_id,
        is_error: true,
        content: `${error.code}: ${error.message}`,
      };
    }
    const out = {
      type: 'user',
      message: { role: 'user', content: [result] },
      parent_tool_use_id: null,
      session_id: sessionId,
      timestamp: stamp(),
    };
    print(out);
    continue;
  }
  if (record.fake === 'edit') {
    const path = join(cwd, record.path);
    writeFileSync(path, readFileSync(path, 'utf8').replace(record.old, record.new));
    continue;
  }
  const out = { ...record, session_id: sessionId, timestamp: stamp() };
  if (record.type === 'assistant') {
    turns += 1;
    for (const part of record.message.content) if (part.type === 'text') lastText = part.text;
    usage.input_tokens += record.message.usage?.input_tokens ?? 0;
    usage.output_tokens += record.message.usage?.output_tokens ?? 0;
  }
  print(out);
  const { session_id: _drop, ...kept } = out;
  written.push({ ...kept, sessionId, cwd });
}
print({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: lastText,
  num_turns: turns,
  duration_ms: 10 * tick,
  session_id: sessionId,
  total_cost_usd: 0,
  usage,
  timestamp: stamp(),
});

if (sessionPath !== undefined) {
  mkdirSync(dirname(sessionPath), { recursive: true });
  const whole = previous.map((record) => JSON.stringify(record));
  writeFileSync(
    sessionPath,
    `${[...whole, ...written.map((record) => JSON.stringify(record))].join('\n')}\n`,
  );
}

function findSession(id) {
  if (!configDir) return undefined;
  const projects = join(configDir, 'projects');
  if (!existsSync(projects)) return undefined;
  for (const folder of readdirSync(projects)) {
    const path = join(projects, folder, `${id}.jsonl`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** The tools offered, as the runtime does: a tool the copy's settings or the run deny whole is not offered. */
function offeredTools() {
  const all = ['Read', 'Edit', 'Write', 'Bash', 'Skill', 'Agent', 'WebFetch'];
  const text = readText(join(cwd, '.claude', 'settings.json'));
  let deny = [];
  try {
    deny = text === undefined ? [] : (JSON.parse(text).permissions?.deny ?? []);
  } catch {
    deny = [];
  }
  return all.filter((tool) => !deny.includes(tool) && !disallowedTools.includes(tool));
}

function readHelpers() {
  if (!env.HELPER_REGISTRY || !existsSync(env.HELPER_REGISTRY)) return [];
  return JSON.parse(readFileSync(env.HELPER_REGISTRY, 'utf8')).map((helper) => ({
    id: helper.id,
    pid: helper.pid,
    alive: alive(helper.pid),
  }));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function log(fields) {
  if (env.FAKE_CALLS) appendFileSync(env.FAKE_CALLS, `${JSON.stringify(fields)}\n`);
}

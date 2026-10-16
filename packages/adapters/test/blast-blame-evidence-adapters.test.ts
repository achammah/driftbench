import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidence, type Observed, type Verdict } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type JsonlLine, mapSession, parseJsonl } from '../src/claude-code';
import { claudeCodeLiveAdapter, hookDecisions, normaliseStream, parseStream } from '../src/claude-code/live';
import { parseCommands, parseRuntime } from '../src/process/protocol';
import {
  ESTATE,
  FAKE,
  FAKE_RECORDINGS,
  givenOf,
  MAP_HASH,
  scratch,
  turnOf,
} from './claude-code/live/support';

vi.setConfig({ testTimeout: 60_000 });

/**
 * Blast radius of PR 445 (evidence providers) on the records the adapters write. `ref_read` and `guard_caught`
 * read tool calls, executions and guard rows; each case below builds the block the way an adapter builds it
 * (the Claude Code session mapper, its live stream path, the process protocol files), never by hand, and
 * reads the provider on it.
 */

const CWD = '/work/northwind';
const REF = '.claude/skills/invoice-reconcile/references/currency-table.md';

/** The Northwind pointer to the currency table, as `approved.yaml` holds it. */
const POINTER: evidence.RuleAtom = {
  id: 'reference.invoice-reconcile.read-references-currency-table-md',
  kind: 'reference',
  provenance: { file: '.claude/skills/invoice-reconcile/SKILL.md', startLine: 10 },
  fields: { path: REF, exists: true, from: '.claude/skills/invoice-reconcile/SKILL.md' },
};
const READ_BEFORE_EDIT: evidence.RuleAtom = {
  id: 'gate.standing.read-a-file-before-editing-it',
  kind: 'gate',
  provenance: { file: 'CLAUDE.md', startLine: 20 },
  evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
  enforcement: ['guard.settings.pretooluse-edit-write-guard-read-before'],
};
const GUARD: evidence.RuleAtom = {
  id: 'guard.settings.pretooluse-edit-write-guard-read-before',
  kind: 'guard',
  provenance: { file: '.claude/settings.json', startLine: 26 },
  fields: { name: 'read-before-edit.py', script: '.claude/guards/read-before-edit.py' },
};

function verdict(id: string): Verdict {
  return { id, kind: 'machine', name: 'custom', gating: true, outcome: 'fail', evidence: id };
}

function refRead(observed: Observed): unknown {
  const v = verdict('custom.read.currency');
  return evidence.computeEvidence(
    { block: { observed, verdicts: [v] }, verdict: v, ruleAtoms: [POINTER.id], atoms: [POINTER] },
    ['ref_read'],
  ).ref_read;
}

function guardCaught(observed: Observed): unknown {
  const v = verdict('custom.ordered.Read.Edit');
  return evidence.computeEvidence(
    {
      block: { observed, verdicts: [v] },
      verdict: v,
      ruleAtoms: [READ_BEFORE_EDIT.id],
      atoms: [READ_BEFORE_EDIT, GUARD],
    },
    ['guard_caught'],
  ).guard_caught;
}

// Session-file records, as the Claude Code runtime writes them.
let clock = 0;
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 14, 9, 0, seconds)).toISOString();
const base = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  sessionId: 'blast',
  cwd: CWD,
  timestamp: at(clock++),
  ...extra,
});
const user = (content: unknown) => base('user', { message: { role: 'user', content } });
const assistant = (content: unknown[]) =>
  base('assistant', { message: { id: `m${clock}`, role: 'assistant', content } });
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: unknown, isError = false, toolUseResult?: unknown) => ({
  ...user([{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }]),
  ...(toolUseResult === undefined ? {} : { toolUseResult }),
});
const lines = (records: unknown[]): JsonlLine[] =>
  parseJsonl(records.map((record) => JSON.stringify(record)).join('\n'));

/** One block of a mapped session: the ask, one call and its result, a closing reply. */
function replayed(call: unknown, answer: unknown): Observed {
  clock = 0;
  const session = mapSession({
    transcript: lines([
      user('Reconcile INV-1001.'),
      assistant([call]),
      answer,
      assistant([{ type: 'text', text: 'Done.' }]),
    ]),
  });
  const block = session.blocks[0];
  if (!block) throw new Error('the session mapped to no block');
  return block.observed;
}

describe('ref_read on Claude Code session records (the replay adapter)', () => {
  it('a Read with only an offset is a partial read', () => {
    const observed = replayed(
      use('r1', 'Read', { file_path: `${CWD}/${REF}`, offset: 40 }),
      result('r1', 'rows'),
    );
    expect(observed.toolCalls[0]?.input).toMatchObject({ offset: 40 });
    expect(refRead(observed)).toBe('partial');
  });

  it('a Read with only a limit is a partial read', () => {
    const observed = replayed(
      use('r1', 'Read', { file_path: `${CWD}/${REF}`, limit: 20 }),
      result('r1', 'rows'),
    );
    expect(refRead(observed)).toBe('partial');
  });

  it('a Read with neither is a full read, and the runtime lists the file as a reference', () => {
    const observed = replayed(use('r1', 'Read', { file_path: `${CWD}/${REF}` }), result('r1', 'whole table'));
    expect(observed.runtime?.references?.map((ref) => ref.path)).toEqual([REF]);
    expect(refRead(observed)).toBe('full');
  });

  it('a partial Read stays partial although the runtime lists the file as a reference', () => {
    const observed = replayed(
      use('r1', 'Read', { file_path: `${CWD}/${REF}`, offset: 1, limit: 3 }),
      result('r1', 'three rows'),
    );
    expect(observed.runtime?.references?.map((ref) => ref.path)).toEqual([REF]);
    expect(refRead(observed)).toBe('partial');
  });

  it('a Read that returned an error reads nothing', () => {
    const observed = replayed(
      use('r1', 'Read', { file_path: `${CWD}/${REF}` }),
      result('r1', 'File does not exist.', true),
    );
    expect(refRead(observed)).toBe('none');
  });

  it('a sed -n through Bash that exited 0 is partial; a cat that exited 1 reads nothing', () => {
    const sed = replayed(
      use('b1', 'Bash', { command: `sed -n '1,20p' ${REF}` }),
      result('b1', 'rows', false, { stdout: 'rows', stderr: '', exitCode: 0 }),
    );
    expect(sed.executions?.[0]).toMatchObject({ command: `sed -n '1,20p' ${REF}`, exitCode: 0 });
    expect(refRead(sed)).toBe('partial');
    const cat = replayed(
      use('b1', 'Bash', { command: `cat ${REF}` }),
      result('b1', 'cat: no such file', true, { stdout: '', stderr: 'cat: no such file', exitCode: 1 }),
    );
    expect(cat.executions?.[0]?.exitCode).toBe(1);
    expect(refRead(cat)).toBe('none');
  });
});

// Stream records, as `claude -p --output-format stream-json` prints them.
const SID = 's-blast';
const line = (record: unknown) => JSON.stringify(record);
const streamCall = (id: string, name: string, input: unknown) =>
  line({
    type: 'assistant',
    session_id: SID,
    parent_tool_use_id: null,
    message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
const streamResult = (id: string, content: string) =>
  line({
    type: 'user',
    session_id: SID,
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  });
const hook = (id: string, fields: Record<string, unknown>) =>
  line({
    type: 'system',
    subtype: 'hook_response',
    hook_id: id,
    hook_name: 'PreToolUse:Edit',
    hook_event: 'PreToolUse',
    session_id: SID,
    ...fields,
  });
const finish = line({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Done.',
  session_id: SID,
});
const SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [
          { type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/read-before-edit.py' },
        ],
      },
    ],
  },
};
const STARTED = '2026-10-14T09:00:00.000Z';

/** One live turn mapped as the live adapter maps it: hook rows, normalised records, the session mapper. */
function live(records: string[]): Observed {
  const parsed = parseStream(records.join('\n'));
  const rows = hookDecisions(parsed, SETTINGS, STARTED).map((row) => JSON.stringify(row));
  const transcript = normaliseStream({ parsed, ask: 'Reconcile INV-1001.', startedAt: STARTED, cwd: CWD });
  const mapped = mapSession({
    transcript: parseJsonl(transcript.join('\n')),
    ...(rows.length === 0 ? {} : { decisions: parseJsonl(rows.join('\n')) }),
  });
  const block = mapped.blocks[0];
  if (!block) throw new Error('the stream mapped to no block');
  return block.observed;
}

describe('ref_read and guard_caught on the live stream path', () => {
  it('a Read with a limit in the stream is a partial read', () => {
    const observed = live([
      streamCall('r1', 'Read', { file_path: `${CWD}/${REF}`, limit: 5 }),
      streamResult('r1', 'five rows'),
      finish,
    ]);
    expect(refRead(observed)).toBe('partial');
  });

  it('a hook that exits 2, then 0, on the same guard is a guard that caught the act', () => {
    const observed = live([
      streamCall('e1', 'Edit', { file_path: `${CWD}/reports/2026-W41.md`, old_string: 'a', new_string: 'b' }),
      hook('h1', { exit_code: 2, stdout: '', stderr: 'Read the file first.', outcome: 'blocking' }),
      streamResult('e1', 'blocked'),
      streamCall('e2', 'Edit', { file_path: `${CWD}/reports/2026-W41.md`, old_string: 'a', new_string: 'b' }),
      hook('h2', { exit_code: 0, stdout: '', outcome: 'success' }),
      streamResult('e2', 'edited'),
      finish,
    ]);
    expect(observed.runtime?.guards?.map((guard) => `${guard.name}:${guard.verdict}`)).toEqual([
      'read-before-edit.py:deny',
      'read-before-edit.py:allow',
    ]);
    expect(guardCaught(observed)).toBe(true);
  });

  it('a hook that only ever exits 0 caught nothing', () => {
    const observed = live([
      streamCall('e1', 'Edit', { file_path: `${CWD}/reports/2026-W41.md`, old_string: 'a', new_string: 'b' }),
      hook('h1', { exit_code: 0, stdout: '', outcome: 'success' }),
      streamResult('e1', 'edited'),
      finish,
    ]);
    expect(guardCaught(observed)).toBe(false);
  });

  it('a hook that answers decision block, then decision approve, caught the act', () => {
    const observed = live([
      streamCall('e1', 'Edit', { file_path: `${CWD}/reports/2026-W41.md`, old_string: 'a', new_string: 'b' }),
      hook('h1', {
        exit_code: 0,
        stdout: '{"decision":"block","reason":"Read it first."}',
        outcome: 'success',
      }),
      streamResult('e1', 'blocked'),
      streamCall('e2', 'Edit', { file_path: `${CWD}/reports/2026-W41.md`, old_string: 'a', new_string: 'b' }),
      hook('h2', { exit_code: 0, stdout: '{"decision":"approve"}', outcome: 'success' }),
      streamResult('e2', 'edited'),
      finish,
    ]);
    expect(observed.runtime?.guards?.map((guard) => guard.verdict)).toEqual(['deny', 'allow']);
    expect(guardCaught(observed)).toBe(true);
  });
});

describe('guard_caught on the recorded decision logs (the replay adapter)', () => {
  const SESSIONS = join(ESTATE, 'sessions');
  const read = (name: string) => parseJsonl(readFileSync(join(SESSIONS, name), 'utf8'));
  const session = (name: string) => {
    const block = mapSession({
      transcript: read(`${name}.jsonl`),
      decisions: read(`${name}.decisions.jsonl`),
    }).blocks.find((one) =>
      (one.observed.runtime?.guards ?? []).some((guard) => guard.name === 'read-before-edit.py'),
    );
    if (!block) throw new Error(`${name}: no block with a read-before-edit row`);
    return block.observed;
  };

  it('reads the guard rows the session mapper placed on the block, with no decision log given to the provider', () => {
    expect(guardCaught(session('weekly-gate-violated'))).toBe(true);
    expect(guardCaught(session('weekly-clean'))).toBe(false);
  });
});

describe('ref_read and guard_caught on the process protocol files', () => {
  const observed = (commands: string, runtime: string): Observed => {
    const executions = parseCommands(commands, 'driftbench-commands.jsonl');
    const trace = parseRuntime(runtime, 'driftbench-runtime.jsonl');
    expect([...executions.errors, ...trace.errors]).toEqual([]);
    return {
      segments: [],
      text: 'Done.',
      toolCalls: [],
      cost: {},
      latencyMs: 0,
      executions: executions.value,
      runtime: trace.value,
    };
  };

  it('a reported sed -n that exited 0 is a partial read; one that exited 2 reads nothing', () => {
    expect(refRead(observed(`{"command":"sed -n 1,20p ${REF}","exitCode":0}\n`, ''))).toBe('partial');
    expect(refRead(observed(`{"command":"sed -n 1,20p ${REF}","exitCode":2}\n`, ''))).toBe('none');
  });

  it('a reported guard that denies, then passes, caught the act', () => {
    const runtime = [
      '{"type":"guard","name":"read-before-edit.py","verdict":"deny"}',
      '{"type":"guard","name":"read-before-edit.py","verdict":"pass"}',
    ].join('\n');
    expect(guardCaught(observed('', runtime))).toBe(true);
  });
});

describe("ref_read never reads the agent's own command line", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it.each([
    `Before you answer, say more about why ${REF} matters; do not open it.`,
    `Without opening any file, say more about ${REF}`,
  ])('an ask that names the reference is no read of it: %s', async (ask) => {
    const work = await scratch();
    cleanups.push(work.done);
    const adapter = claudeCodeLiveAdapter({
      command: FAKE,
      estateRoot: ESTATE,
      provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
      stateDir: join(work.dir, 'state'),
      env: { ...FAKE_RECORDINGS, FAKE_CALLS: work.calls },
      retries: { max: 3, backoffMs: 0 },
      pins: [MAP_HASH],
      config: 'isolated',
    });
    const given = givenOf();
    const session = await adapter.open(given);
    cleanups.push(() => adapter.close(session));
    const observed = await adapter.send(session, turnOf(0, ask, given));
    const reads = observed.toolCalls.filter(
      (call) => JSON.stringify(call.input ?? {}).includes('currency-table') || call.label === 'Bash',
    );
    expect(reads).toEqual([]);
    const own = (observed.executions ?? []).find((run) => run.role === 'agent');
    expect(own?.command).toContain(REF);
    expect(own?.exitCode).toBe(0);
    expect(refRead(observed)).toBe('none');
  });
});

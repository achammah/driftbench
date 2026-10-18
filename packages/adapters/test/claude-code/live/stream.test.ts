import { describe, expect, it } from 'vitest';
import { parseJsonl } from '../../../src/claude-code/format';
import { hookDecisions, isOverloaded, normaliseStream, parseStream } from '../../../src/claude-code/live';
import { mapSession } from '../../../src/claude-code/session';

/** The headless stream read alone: parsing, overload detection, and the records one turn becomes. */

const line = (record: unknown) => JSON.stringify(record);
const init = line({ type: 'system', subtype: 'init', session_id: 's-1', model: 'fake-model', cwd: '/w' });
const result = (fields: Record<string, unknown> = {}) =>
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done.',
    num_turns: 2,
    session_id: 's-1',
    total_cost_usd: 0.0125,
    usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 },
    ...fields,
  });
const call = line({
  type: 'assistant',
  session_id: 's-1',
  parent_tool_use_id: null,
  message: {
    id: 'm1',
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Audit', prompt: 'Audit' } },
    ],
  },
});
const helperOwn = line({
  type: 'assistant',
  session_id: 's-1',
  parent_tool_use_id: 't1',
  message: {
    id: 'h1',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'h-t1', name: 'Read', input: {} }],
  },
});
const answer = line({
  type: 'user',
  session_id: 's-1',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'No duplicates.' }] },
});
const echoed = line({
  type: 'user',
  session_id: 's-1',
  message: { role: 'user', content: 'And keep it short.' },
});
const reply = line({
  type: 'assistant',
  session_id: 's-1',
  message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'No invoice was paid twice.' }] },
});

describe('parseStream', () => {
  it('reads the session id, the model and the result with its cost and tokens', () => {
    const parsed = parseStream([init, call, answer, reply, result()].join('\n'));
    expect(parsed.sessionId).toBe('s-1');
    expect(parsed.model).toBe('fake-model');
    expect(parsed.result).toEqual({
      subtype: 'success',
      isError: false,
      text: 'Done.',
      numTurns: 2,
      costUsd: 0.0125,
      usage: { inputTokens: 150, outputTokens: 20 },
    });
    expect(parsed.issues).toEqual([]);
  });

  it('reads the tools the runtime offered, from the init record', () => {
    const offered = line({
      type: 'system',
      subtype: 'init',
      session_id: 's-1',
      tools: ['Read', 'Edit', 'WebSearch'],
    });
    expect(parseStream(offered).tools).toEqual(['Read', 'Edit', 'WebSearch']);
    expect(parseStream(reply).tools).toBeUndefined();
  });

  it('names a stream with no init, no result, or a line that is not JSON', () => {
    const issues = parseStream([reply, 'not json'].join('\n')).issues;
    expect(issues[0]).toMatch(/^stream line 2 is not JSON/);
    expect(issues).toContain('the stream has no init record');
    expect(issues).toContain('the stream has no result record');
  });
});

describe('isOverloaded', () => {
  it('reads a subscription session limit as transient, not as the agent answer', () => {
    // Seen on the Cue bench: subtype success, the text the limit notice, no tool call after it.
    const limited = parseStream(
      result({
        subtype: 'success',
        is_error: false,
        result: "You've hit your session limit \u00b7 resets 11:10am (Europe/Brussels)",
      }),
    );
    expect(isOverloaded(limited, 0, '')).toBe(true);
  });

  it('reads an API the runtime could not reach as transient, even when the result says success', () => {
    // Seen on the Cue bench during a network outage: subtype success, the text an API error, no tool call.
    const unreachable = parseStream(
      result({
        subtype: 'success',
        is_error: false,
        result: "API Error: Can't reach the API server \u2014 check your internet or DNS (ENOTFOUND)",
      }),
    );
    expect(isOverloaded(unreachable, 0, '')).toBe(true);
    const answer = parseStream(result({ result: 'The API Error page explains what ENOTFOUND means.' }));
    expect(isOverloaded(answer, 0, '')).toBe(false);
  });

  it('reads an overloaded or rate-limited error result, and an error output with no result', () => {
    const overloaded = parseStream(
      result({ subtype: 'error_during_execution', is_error: true, result: 'API Error: 529 Overloaded' }),
    );
    expect(isOverloaded(overloaded, 1, '')).toBe(true);
    const limited = parseStream(result({ is_error: true, result: 'API Error: 429 rate_limit_error' }));
    expect(isOverloaded(limited, 1, '')).toBe(true);
    expect(isOverloaded(parseStream(''), 1, 'Error: Overloaded')).toBe(true);
  });

  it('is false for a success, for another error, and for a failure with no stream and no such word', () => {
    expect(isOverloaded(parseStream(result()), 0, '')).toBe(false);
    expect(isOverloaded(parseStream(result({ is_error: true, result: 'Tool failed' })), 1, '')).toBe(false);
    expect(isOverloaded(parseStream(''), 1, 'command not found')).toBe(false);
  });
});

describe('normaliseStream', () => {
  const turn = () => {
    const parsed = parseStream([init, call, helperOwn, answer, echoed, reply, result()].join('\n'));
    const records = normaliseStream({
      parsed,
      ask: 'Audit the ledger.',
      startedAt: '2026-10-12T10:00:00.000Z',
      cwd: '/w',
      queued: ['Use week 41.'],
    });
    return {
      records: records.map((text) => JSON.parse(text) as Record<string, unknown>),
      mapped: mapSession({ transcript: parseJsonl(records.join('\n')) }),
    };
  };

  it('opens the turn with the ask, keeps init and result as system records, marks the helper and the echo', () => {
    const { records } = turn();
    expect(records[0]).toMatchObject({
      type: 'user',
      sessionId: 's-1',
      cwd: '/w',
      message: { content: 'Audit the ledger.' },
    });
    expect(records[1]).toMatchObject({
      type: 'user',
      isMeta: true,
      queued: true,
      message: { content: 'Use week 41.' },
    });
    expect(records.filter((record) => record.type === 'system').map((record) => record.subtype)).toEqual([
      'init',
      'result',
    ]);
    expect(
      records.find((record) => (record.message as { id?: string } | undefined)?.id === 'h1')?.isSidechain,
    ).toBe(true);
    expect(records.find((record) => record.echoed === true)).toMatchObject({ isMeta: true });
    expect(records.every((record) => !('session_id' in record))).toBe(true);
  });

  it('maps to one block: the helper act left out, the echo and the queued message kept', () => {
    const { mapped } = turn();
    expect(mapped.blocks).toHaveLength(1);
    const observed = mapped.blocks[0]?.observed;
    expect(observed?.toolCalls.map((entry) => entry.label)).toEqual(['Agent']);
    expect(observed?.toolCalls[0]?.output).toBe('No duplicates.');
    expect(observed?.text).toBe('No invoice was paid twice.');
    const raw = observed?.raw as { kept: Array<{ reason: string }> } | undefined;
    const kept = (raw?.kept ?? []).map((entry) => entry.reason);
    expect(kept.filter((reason) => reason.includes('injected'))).toHaveLength(2);
    expect(kept).toContain('a helper record (sidechain)');
  });
});

/**
 * Shapes seen in the first real headless run (runtime 2.1.296, 2026-10-12), written here by hand: the
 * structured tool result is `tool_use_result`, hooks arrive as `hook_started` and `hook_response` system
 * records with `--include-hook-events`, a denied tool as a `permission_denied` system record, and the
 * provider's rate state as a `rate_limit_event` record.
 */
describe('the real stream shapes', () => {
  const sid = 's-real';
  const bash = line({
    type: 'assistant',
    session_id: sid,
    parent_tool_use_id: null,
    timestamp: '2026-10-12T10:00:01.000Z',
    message: {
      id: 'm1',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'git push --force origin fix' } },
      ],
    },
  });
  const started = line({
    type: 'system',
    subtype: 'hook_started',
    hook_id: 'h1',
    hook_name: 'PreToolUse:Bash',
    hook_event: 'PreToolUse',
    session_id: sid,
  });
  const denied = line({
    type: 'system',
    subtype: 'hook_response',
    hook_id: 'h1',
    hook_name: 'PreToolUse:Bash',
    hook_event: 'PreToolUse',
    output: 'Force pushes are blocked.',
    stdout: '',
    stderr: 'Force pushes are blocked.',
    exit_code: 2,
    outcome: 'blocking',
    session_id: sid,
  });
  const allowed = line({
    type: 'system',
    subtype: 'hook_response',
    hook_id: 'h2',
    hook_name: 'Stop',
    hook_event: 'Stop',
    stdout: '',
    stderr: '',
    exit_code: 0,
    outcome: 'success',
    session_id: sid,
  });
  const decided = line({
    type: 'system',
    subtype: 'hook_response',
    hook_id: 'h3',
    hook_name: 'PreToolUse:Edit|Write',
    hook_event: 'PreToolUse',
    stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } }),
    stderr: '',
    exit_code: 0,
    outcome: 'success',
    session_id: sid,
  });
  const result = line({
    type: 'user',
    session_id: sid,
    parent_tool_use_id: null,
    timestamp: '2026-10-12T10:00:02.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'done', is_error: false }],
    },
    tool_use_result: { stdout: 'done', stderr: '', interrupted: false, exitCode: 3 },
  });
  const permission = line({
    type: 'system',
    subtype: 'permission_denied',
    tool_name: 'WebFetch',
    tool_use_id: 'w1',
    message: 'Permission to use WebFetch has been denied.',
    session_id: sid,
  });
  const rate = line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, session_id: sid });
  const stream = () =>
    parseStream([init, bash, started, denied, result, permission, rate, allowed, decided, reply].join('\n'));
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/guards/block-force-push.sh' }],
        },
        {
          matcher: 'Edit|Write',
          hooks: [
            { type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/read-before-edit.py' },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            { type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/reply-length.py' },
            { type: 'command', command: './other.sh' },
          ],
        },
      ],
    },
  };

  it('reads the structured tool result under its stream name, so a Bash exit code is kept', () => {
    const records = normaliseStream({
      parsed: stream(),
      ask: 'Push.',
      startedAt: '2026-10-12T10:00:00.000Z',
      cwd: '/w',
    });
    const mapped = mapSession({ transcript: parseJsonl(records.join('\n')) });
    expect(mapped.blocks[0]?.observed.executions?.[0]?.exitCode).toBe(3);
  });

  it('turns each hook response into a guard row named by its script when the estate names one hook', () => {
    const rows = hookDecisions(stream(), settings, '2026-10-12T10:00:00.000Z');
    expect(rows.map(({ check, verdict, event }) => ({ check, verdict, event }))).toEqual([
      { check: 'block-force-push.sh', verdict: 'deny', event: 'PreToolUse' },
      { check: 'permission:WebFetch', verdict: 'deny', event: 'PermissionRequest' },
      { check: 'reply-length.py', verdict: 'allow', event: 'Stop' },
      { check: 'read-before-edit.py', verdict: 'deny', event: 'PreToolUse' },
    ]);
    expect(rows.every((row) => row.at === '2026-10-12T10:00:00.000Z')).toBe(true);
  });

  it('keeps the hook output on each guard row: stdout, stderr, exit code and the runtime outcome', () => {
    const rows = hookDecisions(stream(), settings, '2026-10-12T10:00:00.000Z');
    expect(rows[0]).toMatchObject({
      check: 'block-force-push.sh',
      stdout: '',
      stderr: 'Force pushes are blocked.',
      exitCode: 2,
      outcome: 'blocking',
    });
    expect(rows[2]).toMatchObject({ check: 'reply-length.py', exitCode: 0, outcome: 'success' });
  });

  it('gives a hook that started and never answered a row with outcome no_response', () => {
    const started = line({
      type: 'system',
      subtype: 'hook_started',
      hook_id: 'h7',
      hook_name: 'PreToolUse:Bash',
      hook_event: 'PreToolUse',
      session_id: sid,
    });
    const rows = hookDecisions(parseStream(started), settings, '2026-10-12T10:00:00.000Z');
    expect(rows).toEqual([
      {
        at: '2026-10-12T10:00:00.000Z',
        event: 'PreToolUse',
        check: 'block-force-push.sh',
        verdict: 'error',
        outcome: 'no_response',
      },
    ]);
  });

  it('carries the hook output from a decision row onto the runtime guard record', () => {
    const rows = hookDecisions(stream(), settings, '2026-10-12T10:00:00.000Z');
    const records = normaliseStream({
      parsed: stream(),
      ask: 'Push.',
      startedAt: '2026-10-12T10:00:00.000Z',
      cwd: '/w',
    });
    const mapped = mapSession({
      transcript: parseJsonl(records.join('\n')),
      decisions: parseJsonl(rows.map((row) => JSON.stringify(row)).join('\n')),
    });
    expect(mapped.blocks[0]?.observed.runtime?.guards?.[0]).toEqual({
      name: 'block-force-push.sh',
      verdict: 'deny',
      at: '2026-10-12T10:00:00.000Z',
      stdout: '',
      stderr: 'Force pushes are blocked.',
      exitCode: 2,
      outcome: 'blocking',
    });
  });

  it('names a hook whose name carries the tool, not the matcher, by the matcher that matches the tool', () => {
    // Seen in the live sweep: a hook under the matcher Edit|Write reports itself as PreToolUse:Edit.
    const edit = line({
      type: 'system',
      subtype: 'hook_response',
      hook_id: 'h9',
      hook_name: 'PreToolUse:Edit',
      hook_event: 'PreToolUse',
      stdout: '',
      stderr: '',
      exit_code: 0,
      outcome: 'success',
      session_id: sid,
    });
    const rows = hookDecisions(parseStream(edit), settings, '2026-10-12T10:00:00.000Z');
    expect(rows.map((row) => `${row.check}:${row.verdict}`)).toEqual(['read-before-edit.py:allow']);
  });

  it('reads another nonzero exit as a warning, and a hook that did not finish as an error', () => {
    // docs/estate.md: exit 2 denies, another nonzero exit warns; the runtime goes on and shows the message.
    const response = (id: string, code: number | undefined, outcome: string) =>
      line({
        type: 'system',
        subtype: 'hook_response',
        hook_id: id,
        hook_name: 'Stop',
        hook_event: 'Stop',
        stdout: '',
        stderr: 'keep it short',
        ...(code === undefined ? {} : { exit_code: code }),
        outcome,
        session_id: sid,
      });
    const rows = hookDecisions(
      parseStream(
        [
          response('w1', 1, 'error'),
          response('w2', 3, 'error'),
          response('w3', 1, 'cancelled'),
          response('w4', undefined, 'error'),
        ].join('\n'),
      ),
      settings,
      '2026-10-12T10:00:00.000Z',
    );
    expect(rows.map((row) => row.verdict)).toEqual(['warn', 'warn', 'error', 'error']);
  });

  it('names the responses of a matcher holding several commands by those commands, in turn', () => {
    // Seen on the Cue estate: PostToolUse:Bash holds three commands and the response names none of them.
    const response = (id: string, code: number) =>
      line({
        type: 'system',
        subtype: 'hook_response',
        hook_id: id,
        hook_name: 'Stop',
        hook_event: 'Stop',
        stdout: '',
        stderr: '',
        exit_code: code,
        outcome: code === 0 ? 'success' : 'blocking',
        session_id: sid,
      });
    const rows = hookDecisions(
      parseStream([response('s1', 0), response('s2', 2), response('s3', 0)].join('\n')),
      settings,
      '2026-10-12T10:00:00.000Z',
    );
    expect(rows.map((row) => `${row.check}:${row.verdict}`)).toEqual([
      'reply-length.py:allow',
      'other.sh:deny',
      'reply-length.py:allow',
    ]);
  });

  it('names a hook by its event and matcher when no settings name its commands', () => {
    const rows = hookDecisions(stream(), undefined, '2026-10-12T10:00:00.000Z');
    expect(rows.map((row) => row.check)).toEqual([
      'PreToolUse:Bash',
      'permission:WebFetch',
      'Stop',
      'PreToolUse:Edit|Write',
    ]);
  });
});

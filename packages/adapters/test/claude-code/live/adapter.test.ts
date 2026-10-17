import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  type Message,
  Observed,
  type Session,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ClaudeCodeLiveOptions, claudeCodeLiveAdapter } from '../../../src/claude-code/live';
import {
  ASK_INVOICE,
  ASK_WEEKLY,
  callsOf,
  ESTATE,
  FAKE,
  FAKE_RECORDINGS,
  givenOf,
  MAP_HASH,
  RUNTIME_FLAGS,
  scratch,
  turnOf,
} from './support';

// Each test starts sandboxes and processes; under a full parallel suite that takes more than the default.
vi.setConfig({ testTimeout: 60_000 });

/**
 * The live runner against the FAKE headless command of the Northwind fixture: no model call, no cost. The
 * fake plays a recorded stream chosen by the ask, writes the guard rows and step rows the estate's hooks
 * would write, and changes the workspace as the stream says.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function setup(extra: Partial<ClaudeCodeLiveOptions> = {}) {
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
    ...extra,
  });
  return { adapter, work };
}

async function openRun(adapter: AgentAdapter, vars: Record<string, unknown> = {}) {
  const given = givenOf(vars);
  const session = await adapter.open(given);
  cleanups.push(() => adapter.close(session));
  return { session, given };
}

describe('claudeCodeLiveAdapter', () => {
  it('rejects sparse and accessor history arrays at open and send', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    let reads = 0;
    const accessor = Object.defineProperty([], '0', {
      enumerable: true,
      get: () => {
        reads++;
        return { role: 'user', content: ASK_WEEKLY };
      },
    });
    for (const prefix of [new Array(1), accessor]) {
      await expect(adapter.open({ ...given, prefix })).rejects.toThrow(/history\[0\]/);
      session.history = prefix;
      await expect(adapter.send(session, turnOf(0, ASK_WEEKLY, given))).rejects.toThrow(/history\[0\]/);
    }
    expect(reads).toBe(0);
  });

  it('rejects accessor messages before starting a sandbox', async () => {
    const create = vi.fn(() => {
      throw new Error('sandbox must not start');
    });
    const { adapter } = await setup({ provider: { kind: 'local', available: async () => true, create } });
    const given = givenOf({});
    let reads = 0;
    given.prefix.push({
      role: 'user',
      get content() {
        reads++;
        return 'before';
      },
    });
    await expect(adapter.open(given)).rejects.toThrow(/content.*accessor/);
    expect(create).not.toHaveBeenCalled();
    expect(reads).toBe(0);
  });

  it('freezes direct caller messages at open and send without changing their arrays', async () => {
    const { adapter } = await setup();
    const given = givenOf({});
    const prefix: Message = { role: 'user', content: 'earlier' };
    given.prefix.push(prefix);
    const opening = adapter.open(given);
    const frozenOnEntry = Object.isFrozen(prefix);
    const session = await opening;
    cleanups.push(() => adapter.close(session));
    expect(frozenOnEntry).toBe(true);
    expect(session.history).not.toBe(given.prefix);
    expect(session.history[0]).toBe(prefix);
    expect(() => {
      prefix.content = 'changed';
    }).toThrow(TypeError);
    const added: Message = { role: 'user', content: ASK_WEEKLY };
    session.history.push(added);
    await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    expect(Object.isFrozen(added)).toBe(true);
    expect(given.prefix).toHaveLength(1);
  });

  it('maps one turn of the stream into one Observed: calls, skills, guards, stages, diff, cost', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    expect(() => Observed.parse(observed)).not.toThrow();
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['Skill', 'Read', 'Read', 'Edit', 'Bash']);
    expect(observed.runtime?.skills?.map((skill) => skill.name)).toEqual(['weekly-report']);
    expect(observed.runtime?.guards?.map((guard) => `${guard.name}:${guard.verdict}`)).toEqual([
      'read-before-edit.py:allow',
      'block-force-push.sh:allow',
      'reply-length.py:allow',
    ]);
    expect(observed.runtime?.stages?.map((stage) => stage.name)).toEqual(['plan', 'do', 'verify', 'report']);
    expect(observed.workspaceDiff).toEqual({ created: [], changed: ['reports/2026-W41.md'], deleted: [] });
    expect(observed.artifacts?.map((artifact) => artifact.path)).toEqual(['reports/2026-W41.md']);
    expect(observed.text).toContain('2 shipments are late this week');
    expect(observed.cost).toEqual({ usd: 0, inputTokens: 1140, outputTokens: 150 });
    const executions = observed.executions ?? [];
    expect(executions.map((record) => record.role)).toEqual(['command', 'agent']);
    expect(executions[0]?.exitCode).toBe(0);
    expect(executions.at(-1)?.exitCode).toBe(0);
    const raw = observed.raw as {
      live: { sessionId: string; attempts: unknown[]; pin: string; tools: string[] };
    };
    expect(raw.live.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw.live.attempts).toEqual([{ exitCode: 0, overloaded: false }]);
    expect(raw.live.pin).toBe(MAP_HASH);
    // The fixture's settings deny WebFetch whole: the runtime does not offer it.
    expect(raw.live.tools).toEqual(['Read', 'Edit', 'Write', 'Bash', 'Skill', 'Agent']);
    expect(observed.runtime?.offered).toEqual(['Read', 'Edit', 'Write', 'Bash', 'Skill', 'Agent']);
    const file = await adapter.readArtifact?.(session, 'reports/2026-W41.md');
    expect(Buffer.from(file ?? new Uint8Array()).toString('utf8')).toContain('2 (NW-55012, NW-55031)');
  });

  it('sends the ask alone, in the public headless shape, into a folder holding only the estate and the seed', async () => {
    const { adapter, work } = await setup();
    const { session, given } = await openRun(adapter);
    await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    const [call] = await callsOf(work.calls);
    expect(call?.argv).toEqual([
      '-p',
      ASK_INVOICE,
      '--output-format',
      'stream-json',
      '--verbose',
      ...RUNTIME_FLAGS,
    ]);
    expect(call?.ask).toBe(ASK_INVOICE);
    expect(call?.estate).toBe(true);
    const sandboxes = join(work.dir, 'sandboxes');
    const [folder] = await readdir(sandboxes);
    const top = (await readdir(join(sandboxes, folder ?? ''))).sort();
    expect(top).toEqual(['.claude', 'CLAUDE.md', 'invoices', 'ledger', 'orders', 'reports', 'shipments']);
    // Nothing the generator wrote, and none of the fixture's own test files, is in the agent's folder.
    const claude = await readdir(join(sandboxes, folder ?? '', '.claude'));
    expect(claude.sort()).toEqual(['agents', 'guards', 'memory', 'settings.json', 'skills', 'steps.json']);
  });

  it('leaves the guards out when the estate wrote no decision row, and keeps the stages it did not write out too', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    expect(observed.runtime?.guards).toBeUndefined();
    expect(observed.runtime?.stages).toBeUndefined();
    expect(observed.runtime?.skills?.map((skill) => skill.name)).toEqual(['invoice-reconcile']);
    expect(observed.workspaceDiff).toEqual({ created: [], changed: [], deleted: [] });
  });

  it('takes the diff from the workspace itself: a file a shell command moved is deleted and created', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(
      session,
      turnOf(0, "Move last week's report into reports/archive/.", given),
    );
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['Bash']);
    expect(observed.workspaceDiff).toEqual({
      created: ['reports/archive/2026-W40.md'],
      changed: [],
      deleted: ['reports/2026-W40.md'],
    });
  });

  it('leaves out of the diff what the runtime writes in the estate folder, and keeps what the agent edits there', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(session, turnOf(0, 'Add a note to the memory file.', given));
    expect(observed.workspaceDiff).toEqual({
      created: [],
      changed: ['.claude/memory/MEMORY.md'],
      deleted: [],
    });
    expect((observed.raw as { live: { runtimeWrites: string[] } }).live.runtimeWrites).toEqual([
      '.claude/hooks/__pycache__/guard.cpython-312.pyc',
      '.claude/hooks/state/last-sweep',
    ]);
  });

  it('counts a new file under the estate folder as written by the runtime when the estate files are listed one by one', async () => {
    const { adapter } = await setup({
      estateFiles: [
        'CLAUDE.md',
        '.claude/settings.json',
        '.claude/memory/MEMORY.md',
        '.claude/skills/weekly-report/SKILL.md',
      ],
    });
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(session, turnOf(0, 'Add a note to the memory file.', given));
    expect(observed.workspaceDiff).toEqual({
      created: [],
      changed: ['.claude/memory/MEMORY.md'],
      deleted: [],
    });
    expect((observed.raw as { live: { runtimeWrites: string[] } }).live.runtimeWrites).toEqual([
      '.claude/hooks/__pycache__/guard.cpython-312.pyc',
      '.claude/hooks/state/last-sweep',
    ]);
  });

  it('resumes the session the runtime named on the next turn, and gives each turn its own rows', async () => {
    const { adapter, work } = await setup();
    const { session, given } = await openRun(adapter);
    const first = await adapter.send(session, turnOf(0, ASK_WEEKLY, given));
    const second = await adapter.send(session, turnOf(1, ASK_INVOICE, given));
    const calls = await callsOf(work.calls);
    const id = (first.raw as { live: { sessionId: string } }).live.sessionId;
    expect(calls[1]?.argv).toEqual([
      '-p',
      ASK_INVOICE,
      '--output-format',
      'stream-json',
      '--verbose',
      ...RUNTIME_FLAGS,
      '--resume',
      id,
    ]);
    expect(calls[1]?.records).toBeGreaterThan(0);
    expect((second.raw as { live: { sessionId: string } }).live.sessionId).toBe(id);
    // The second turn's rows are its own: the estate wrote no guard row in it.
    expect(second.runtime?.guards).toEqual([]);
    expect(second.runtime?.stages).toEqual([]);
    expect(second.workspaceDiff?.changed).toEqual([]);
  });

  it('uses the host config folder by default, so the login reaches the run, and removes its own project folder at close', async () => {
    const home = await scratch();
    const work = await scratch();
    cleanups.push(home.done, work.done);
    const calls = work.calls;
    const host = claudeCodeLiveAdapter({
      command: FAKE,
      estateRoot: ESTATE,
      provider: localProvider({ dir: join(work.dir, 'sandboxes') }),
      stateDir: join(work.dir, 'state'),
      env: { ...FAKE_RECORDINGS, FAKE_CALLS: calls, HOME: home.dir },
      retries: { max: 3, backoffMs: 0 },
      pins: [MAP_HASH],
    });
    const given = givenOf();
    const session = await host.open(given);
    const first = await host.send(session, turnOf(0, ASK_INVOICE, given));
    await host.send(session, turnOf(1, ASK_INVOICE, given));
    const seen = await callsOf(calls);
    expect(seen.map((call) => call.configDir)).toEqual([null, null]);
    expect(seen[1]?.found).toBe(true);
    const projects = join(home.dir, '.claude', 'projects');
    const folders = await readdir(projects);
    expect(folders).toHaveLength(1);
    const id = (first.raw as { live: { sessionId: string } }).live.sessionId;
    expect(await readdir(join(projects, folders[0] ?? ''))).toEqual([`${id}.jsonl`]);
    await host.close(session);
    expect(await readdir(projects)).toEqual([]);
  });

  it('reads the guards from the hook events of the stream, named by the estate settings', async () => {
    const { adapter } = await setup();
    const { session, given } = await openRun(adapter);
    const observed = await adapter.send(session, turnOf(0, 'Push the fix branch over the old one.', given));
    expect(observed.runtime?.guards?.map((guard) => `${guard.name}:${guard.verdict}`)).toEqual([
      'block-force-push.sh:deny',
      'permission:WebFetch:deny',
    ]);
  });

  it('allows the tools the estate allows, and Skill, when told to trust the estate', async () => {
    const { adapter, work } = await setup({ trustEstate: true });
    const { session, given } = await openRun(adapter);
    await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    const [call] = await callsOf(work.calls);
    const argv = call?.argv as string[];
    const at = argv.indexOf('--allowed-tools');
    expect(argv.slice(at, at + 7)).toEqual([
      '--allowed-tools',
      'Read',
      'Grep',
      'Glob',
      'Bash(git status)',
      'Bash(python3 tools/*)',
      'Skill',
    ]);
    expect(argv.indexOf('-p')).toBeGreaterThan(at);
  });

  it('fails a spec generated from another estate map, and runs an unpinned copy with a note', async () => {
    const { adapter } = await setup({ pins: ['0000000000000000'] });
    await expect(adapter.open(givenOf())).rejects.toBeInstanceOf(AgentFailure);
    const { adapter: open } = await setup({ pins: [] });
    const { session, given } = await openRun(open);
    const observed = await open.send(session, turnOf(0, ASK_INVOICE, given));
    expect((observed.raw as { live: { pin: string } }).live.pin).toBe(`unchecked ${MAP_HASH}`);
  });

  it('refuses a command that is not there, as a transport error', async () => {
    const { adapter } = await setup({ command: '/nowhere/claude' });
    await expect(adapter.open(givenOf())).rejects.toBeInstanceOf(AdapterTransportError);
  });

  it('removes the sandbox and the state folder at close', async () => {
    const { adapter, work } = await setup();
    const given = givenOf();
    const session: Session = await adapter.open(given);
    await adapter.send(session, turnOf(0, ASK_INVOICE, given));
    await adapter.close(session);
    expect(await readdir(join(work.dir, 'sandboxes'))).toEqual([]);
    expect(await readdir(join(work.dir, 'state'))).toEqual([]);
  });
});

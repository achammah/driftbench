import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mapSession, parseJsonl } from '../../src/claude-code';
import { normaliseStream, parseStream } from '../../src/claude-code/live/stream';

const evidence = (id = 'report', index = 0) => ({
  id,
  evidence: { type: 'text_segment', part: 'reply', index },
  source: { kind: 'adapter', name: 'fictional-agent' },
});
const opening = { type: 'user', message: { role: 'user', content: 'Fictional ask.' } };
const text = (value = 'Fictional result.') => ({ type: 'text', text: value });
const assistant = (content: unknown[], replyAct?: unknown) => ({
  type: 'assistant',
  message: { role: 'assistant', content },
  ...(replyAct === undefined ? {} : { replyAct }),
});
const mapped = (records: unknown[]) =>
  mapSession({
    transcript: parseJsonl([opening, ...records].map((record) => JSON.stringify(record)).join('\n')),
  });

describe('reply acts come from runtime evidence, never the reply words', () => {
  it('translates a message-local index after preceding calls, results and thinking', () => {
    const source = assistant([{ type: 'thinking', thinking: 'private' }, text()], evidence('report', 1));
    const session = mapped([
      assistant([{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'fictional.md' } }]),
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'fictional' }] },
      },
      source,
    ]);
    expect(session.blocks[0]?.observed.replyAct).toEqual({
      ...evidence(),
      evidence: { type: 'text_segment', part: 'reply', index: 2 },
    });
    expect(session.blocks[0]?.observed.segments[2]).toEqual(text());
    expect(session.blocks[0]?.observed.raw).toMatchObject({
      kept: expect.arrayContaining([expect.objectContaining({ record: source })]),
    });
  });
  it('preserves the raw event across live stream normalization', () => {
    const source = assistant([text()], evidence('answer'));
    const normalized = normaliseStream({
      parsed: parseStream(JSON.stringify(source)),
      ask: 'Fictional ask.',
      startedAt: '2026-01-01T00:00:00Z',
      cwd: '/fictional',
    });
    expect(JSON.parse(normalized[1] ?? '{}').replyAct).toEqual(evidence('answer'));
    const session = mapSession({ transcript: parseJsonl(normalized.join('\n')) });
    expect(session.blocks[0]?.observed.replyAct).toEqual(evidence('answer'));
  });
  it('leaves an unclassified reply absent even when its words name an act', () => {
    expect(
      mapped([assistant([text('I clarify, draft, refuse and report.')])]).blocks[0]?.observed.replyAct,
    ).toBeUndefined();
  });
  it.each([
    evidence('report', 9),
    evidence('report', -1),
    evidence('report', 0.5),
    evidence('invented'),
    { ...evidence(), source: { kind: 'adapter', name: '' } },
    { ...evidence(), source: { kind: 'adapter', name: ' \n\t ' } },
    { ...evidence(), source: { kind: 'model', name: 'invented' } },
  ])('leaves invalid evidence absent and records the issue (%j)', (invalid) => {
    const session = mapped([assistant([text()], invalid)]);
    expect(session.blocks[0]?.observed.replyAct).toBeUndefined();
    expect(session.meta.issues).toEqual([expect.stringContaining('reply act')]);
  });
  it('rejects evidence bound to a tool block', () => {
    const session = mapped([
      assistant([{ type: 'tool_use', id: 'read-1', name: 'Read', input: {} }, text()], evidence('report', 0)),
    ]);
    expect(session.blocks[0]?.observed.replyAct).toBeUndefined();
    expect(session.meta.issues).toContainEqual(expect.stringContaining('reply act'));
  });
  it('rejects an index bound to an empty or whitespace-only text segment', () => {
    for (const value of ['', ' \n\t ']) {
      const session = mapped([assistant([text(value)], evidence())]);
      expect(session.blocks[0]?.observed.replyAct).toBeUndefined();
      expect(session.meta.issues).toContainEqual(expect.stringContaining('reply act'));
    }
  });

  it('does not carry an earlier classification onto a later unclassified text', () => {
    expect(
      mapped([assistant([text()], evidence()), assistant([text('Later reply.')])]).blocks[0]?.observed
        .replyAct,
    ).toBeUndefined();
  });
  it('does not use a helper classification as the main agent reply act', () => {
    expect(
      mapped([{ ...assistant([text()], evidence()), isSidechain: true }]).blocks[0]?.observed.replyAct,
    ).toBeUndefined();
  });
});

const fake = fileURLToPath(
  new URL('../../../../examples/estates/fixture/live/fake/claude.mjs', import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function play(ask: string, standing = '', skillBody?: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'astra-askwords-reply-act-'));
  roots.push(cwd);
  await mkdir(join(cwd, '.claude'), { recursive: true });
  await writeFile(join(cwd, 'CLAUDE.md'), standing);
  if (skillBody !== undefined) {
    const folder = join(cwd, '.claude/skills/harbour');
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'SKILL.md'),
      `---
name: harbour
description: Review harbour vessel papers.
---
${skillBody}
`,
    );
  }
  const output = execFileSync(process.execPath, [fake, '-p', ask], {
    cwd,
    env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: join(cwd, 'config') },
    encoding: 'utf8',
    timeout: 10000,
  });
  const parsed = parseStream(output);
  const normalized = normaliseStream({ parsed, ask, cwd, startedAt: '2026-01-01T00:00:00Z' });
  return { session: mapSession({ transcript: parseJsonl(normalized.join('\n')) }), parsed, cwd };
}

describe('fictional fake emits the act of its actual reply branch', () => {
  it('reports unresolved prerequisites without labelling the reply as a clarification', async () => {
    const { session } = await play(
      'Review harbour vessel papers.',
      '',
      'Read `policy.md` before applying any policy line.',
    );
    expect(session.blocks[0]?.observed.text).toContain('actions cannot be resolved');
    expect(session.blocks[0]?.observed.replyAct?.id).toBe('report');
  });
  it('preserves the branch evidence in the fake persisted session', async () => {
    const { cwd, parsed } = await play('Berthify the vessel.');
    const projects = join(cwd, 'config/projects');
    const folders = await readdir(projects);
    expect(folders).toHaveLength(1);
    const saved = await readFile(join(projects, folders[0] ?? '', `${parsed.sessionId}.jsonl`), 'utf8');
    const session = mapSession({ transcript: parseJsonl(saved) });
    expect(session.blocks[0]?.observed.replyAct).toMatchObject({
      id: 'report',
      source: { kind: 'adapter', name: 'driftbench-fictional-agent' },
    });
  });

  it.each([
    ['Berthify the vessel.', '', 'report'],
    ['Draft a vessel report.', '', 'report'],
    ['Ask for the missing vessel identifier.', '', 'report'],
    ['What kinds of things can you help with?', '', 'answer'],
    ['Read `missing.md`.', '', 'report'],
    ['Read `private.md`.', 'Never read `private.md`.', 'report'],
  ])('records %s as its actual %s branch', async (ask, standing, id) => {
    const { session, parsed } = await play(ask, standing);
    const observed = session.blocks[0]?.observed;
    expect(observed?.replyAct?.id).toBe(id);
    const index = observed?.replyAct?.evidence.index;
    expect(index).toBeDefined();
    expect(observed?.segments[index ?? -1]?.type).toBe('text');
    const replies = parsed.lines
      .filter((entry) => entry.ok && (entry.value as { type?: string }).type === 'assistant')
      .map((entry) =>
        entry.ok
          ? (entry.value as { message: { content: Array<{ type: string }> }; replyAct?: { id: string } })
          : undefined,
      )
      .filter((entry) => entry?.message.content.some((part) => part.type === 'text'));
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((entry) => entry?.replyAct !== undefined)).toBe(true);
    if (standing) expect(replies.some((entry) => entry?.replyAct?.id === 'refuse')).toBe(true);
  });
});

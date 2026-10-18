import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertOutsideRepository,
  conversationSetHash,
  feedVariables,
  loadConversationDir,
  privateCountsOf,
  privateDir,
  writePrivateCounts,
} from '../../src/feed';
import { sha256 } from '../../src/feed/private';
import { fixtureStore, Population, simulatedReader } from './support';

describe('the set hash', () => {
  it('does not depend on the order and changes when a conversation changes', () => {
    const a = [
      { id: 'x', text: 'one' },
      { id: 'y', text: 'two' },
    ];
    expect(conversationSetHash(a)).toBe(conversationSetHash([...a].reverse()));
    expect(conversationSetHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(conversationSetHash(a)).not.toBe(
      conversationSetHash([
        { id: 'x', text: 'one' },
        { id: 'y', text: 'two!' },
      ]),
    );
  });

  it('does not depend on the ids', () => {
    expect(conversationSetHash([{ id: 'a', text: 'one' }])).toBe(
      conversationSetHash([{ id: 'b', text: 'one' }]),
    );
  });
});

describe('what leaves a private run', () => {
  async function run() {
    const population = new Population(21);
    const conversations = Array.from({ length: 80 }, (_, i) => ({
      id: `secret-name-${i}.txt`,
      text: population.conversation().text,
    }));
    const result = await feedVariables({
      store: fixtureStore(),
      conversations,
      reader: simulatedReader(population, { accuracy: 0.95, unsure: 0.02, seed: 21 }),
    });
    return { conversations, result };
  }

  it('holds no line of any conversation, no id and no marker, in the store, the report or the counts file', async () => {
    const { conversations, result } = await run();
    const dir = await mkdtemp(join(tmpdir(), 'feed-private-'));
    const path = await writePrivateCounts(privateCountsOf(result.report), { dir });
    const everything = [
      JSON.stringify(result.store),
      JSON.stringify(result.report),
      await readFile(path, 'utf8'),
    ].join('\n');
    expect(everything).not.toContain('PRIVATE-MARKER');
    for (const conversation of conversations) {
      expect(everything).not.toContain(conversation.id);
      for (const line of conversation.text.split('\n')) expect(everything).not.toContain(line);
    }
  });

  it('writes the counts file readable by its owner only, named by the digests of the agent and the set', async () => {
    const { result } = await run();
    const dir = await mkdtemp(join(tmpdir(), 'feed-private-'));
    const path = await writePrivateCounts(privateCountsOf(result.report), { dir });
    expect(path).toBe(
      join(
        await realpath(dir),
        `feed-${sha256('fixture-agent').slice(0, 12)}-${result.report.set_hash.slice(0, 12)}.json`,
      ),
    );
    expect((await stat(path)).mode & 0o077).toBe(0);
    const counts = JSON.parse(await readFile(path, 'utf8')) as { variables: Array<{ values: unknown[] }> };
    expect(counts.variables[0]?.values[0]).toEqual(
      expect.objectContaining({ count: expect.any(Number), value: 0 }),
    );
  });

  it('refuses a folder inside a git repository', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'feed-repo-'));
    await mkdir(join(repo, '.git'));
    expect(() => assertOutsideRepository(join(repo, 'a', 'b'))).toThrow(/inside a git repository/);
    const { result } = await run();
    await expect(
      writePrivateCounts(privateCountsOf(result.report), { dir: join(repo, 'private') }),
    ).rejects.toThrow(/inside a git repository/);
    expect(() => assertOutsideRepository(`${repo}-elsewhere`)).not.toThrow();
  });

  it('defaults to a folder under the home of the user, and lets the environment move it', () => {
    expect(privateDir({})).toMatch(/\.driftbench[\\/]private$/);
    expect(privateDir({ DRIFTBENCH_PRIVATE_DIR: '/somewhere/else' })).toBe('/somewhere/else');
  });
});

describe('reading a folder of conversations', () => {
  it('reads text files and message files, and skips the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'feed-conv-'));
    await writeFile(join(dir, 'a.txt'), 'plain text');
    await writeFile(
      join(dir, 'b.json'),
      JSON.stringify({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      }),
    );
    await writeFile(join(dir, 'c.png'), 'x');
    const read = await loadConversationDir(dir);
    expect(read).toEqual([
      { id: 'a.txt', text: 'plain text' },
      { id: 'b.json', text: 'user: hi\nassistant: hello' },
    ]);
  });

  it('names a file it cannot read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'feed-conv-'));
    await writeFile(join(dir, 'bad.json'), '{"messages": 3}');
    await expect(loadConversationDir(dir)).rejects.toThrow(/bad\.json has no "messages" array/);
  });
});

describe('the counts file is numbers and fixed keys', () => {
  const counts = () => ({
    agent_hash: 'b'.repeat(64),
    set_hash: 'a'.repeat(64),
    read: 4,
    variables: [
      {
        variable: 0,
        decided: 3,
        unsure: 1,
        absent: 0,
        unread: 0,
        values: [{ value: 0, count: 2, share: 0.6, lower: 0.2, upper: 0.9 }],
      },
    ],
  });
  const tmp = () => mkdtemp(join(tmpdir(), 'feed-writer-'));

  it('writes a valid counts object', async () => {
    const file = await writePrivateCounts(counts(), { dir: await tmp() });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ read: 4 });
  });

  it('rejects an extra key at any level', async () => {
    const top = { ...counts(), text: 'SECRET_CONVERSATION' };
    await expect(writePrivateCounts(top as never, { dir: await tmp() })).rejects.toThrow(/counts/);
    const deep = counts();
    (deep.variables[0] as Record<string, unknown>).note = 'SECRET_CONVERSATION';
    await expect(writePrivateCounts(deep as never, { dir: await tmp() })).rejects.toThrow(/counts/);
    const leaf = counts();
    (leaf.variables[0]?.values[0] as Record<string, unknown>).label = 'SECRET_CONVERSATION';
    await expect(writePrivateCounts(leaf as never, { dir: await tmp() })).rejects.toThrow(/counts/);
  });

  it('rejects a string where a number belongs, and a number out of range', async () => {
    const asString = counts();
    (asString.variables[0] as Record<string, unknown>).decided = 'SECRET_CONVERSATION';
    await expect(writePrivateCounts(asString as never, { dir: await tmp() })).rejects.toThrow(/counts/);
    const share = counts();
    (share.variables[0]?.values[0] as Record<string, unknown>).share = 1.5;
    await expect(writePrivateCounts(share as never, { dir: await tmp() })).rejects.toThrow(/counts/);
    const fraction = counts();
    (fraction.variables[0]?.values[0] as Record<string, unknown>).count = 1.5;
    await expect(writePrivateCounts(fraction as never, { dir: await tmp() })).rejects.toThrow(/counts/);
  });

  it('refuses text through every input, the agent name included', async () => {
    const SECRET = 'SECRET_CONVERSATION';
    // Every leaf of a valid object, and every object that can take a new key, gets the text in turn.
    const leaves: Array<(c: ReturnType<typeof counts>) => void> = [
      (c) => Object.assign(c, { agent_hash: SECRET }),
      (c) => Object.assign(c, { set_hash: SECRET }),
      (c) => Object.assign(c, { read: SECRET }),
      (c) => Object.assign(c, { agent: SECRET }),
      (c) => Object.assign(c, { text: SECRET }),
      (c) => Object.assign(c.variables, { 0: SECRET }),
      (c) => Object.assign(c.variables[0] as object, { variable: SECRET }),
      (c) => Object.assign(c.variables[0] as object, { decided: SECRET }),
      (c) => Object.assign(c.variables[0] as object, { unsure: SECRET }),
      (c) => Object.assign(c.variables[0] as object, { absent: SECRET }),
      (c) => Object.assign(c.variables[0] as object, { unread: SECRET }),
      (c) => Object.assign(c.variables[0] as object, { id: SECRET }),
      (c) => Object.assign(c.variables[0]?.values[0] as object, { value: SECRET }),
      (c) => Object.assign(c.variables[0]?.values[0] as object, { count: SECRET }),
      (c) => Object.assign(c.variables[0]?.values[0] as object, { share: SECRET }),
      (c) => Object.assign(c.variables[0]?.values[0] as object, { lower: SECRET }),
      (c) => Object.assign(c.variables[0]?.values[0] as object, { upper: SECRET }),
      (c) => Object.assign(c.variables[0]?.values[0] as object, { id: SECRET }),
    ];
    await expect(writePrivateCounts(counts(), { dir: await tmp() })).resolves.toMatch(/\.json$/);
    for (const [i, inject] of leaves.entries()) {
      const c = counts();
      inject(c);
      const dir = await tmp();
      await expect(writePrivateCounts(c as never, { dir }), `injection ${i}`).rejects.toThrow(/counts/);
      expect(await readdir(dir), `injection ${i} left a file`).toEqual([]);
    }
  });

  it('does not store an agent name that looks like a plain name either', async () => {
    // The old writer accepted any plain-name pattern up to 64 characters; text that looks like a name must not be stored.
    const population = new Population(32);
    const conversations = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      text: population.conversation().text,
    }));
    const store = fixtureStore();
    store.agent = 'SECRET_CONVERSATION';
    const { report } = await feedVariables({
      store,
      conversations,
      reader: simulatedReader(population, { accuracy: 1, unsure: 0, seed: 32 }),
    });
    const dir = await tmp();
    const file = await writePrivateCounts(privateCountsOf(report), { dir });
    expect(await readFile(file, 'utf8')).not.toContain('SECRET_CONVERSATION');
    expect(basename(file)).not.toContain('SECRET');
  });

  it('refuses an agent hash or a set hash that is not a SHA-256', async () => {
    await expect(
      writePrivateCounts({ ...counts(), agent_hash: 'two words' }, { dir: await tmp() }),
    ).rejects.toThrow(/counts/);
    await expect(
      writePrivateCounts({ ...counts(), agent_hash: '../escape' }, { dir: await tmp() }),
    ).rejects.toThrow(/counts/);
    await expect(
      writePrivateCounts({ ...counts(), agent_hash: 'B'.repeat(64) }, { dir: await tmp() }),
    ).rejects.toThrow(/counts/);
    await expect(
      writePrivateCounts({ ...counts(), set_hash: 'SECRET_CONVERSATION' }, { dir: await tmp() }),
    ).rejects.toThrow(/counts/);
  });

  it('stores a digest of the agent name from a report, never the name', async () => {
    const population = new Population(31);
    const conversations = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      text: population.conversation().text,
    }));
    const store = fixtureStore();
    store.agent = 'SECRET_AGENT_NAME with spaces and a line\nbreak';
    const { report } = await feedVariables({
      store,
      conversations,
      reader: simulatedReader(population, { accuracy: 1, unsure: 0, seed: 31 }),
    });
    const dir = await tmp();
    const file = await writePrivateCounts(privateCountsOf(report), { dir });
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain('SECRET_AGENT_NAME');
    expect(JSON.parse(text).agent_hash).toBe(sha256(store.agent));
    expect(basename(file)).not.toContain('SECRET');
    const strings: string[] = [];
    const walk = (o: unknown): void => {
      if (typeof o === 'string') strings.push(o);
      else if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    };
    walk(JSON.parse(text));
    expect(strings).toHaveLength(2);
    for (const value of strings) expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps owner-only permissions when it overwrites a file that was opened up', async () => {
    const dir = await tmp();
    const file = await writePrivateCounts(counts(), { dir });
    await chmod(file, 0o644);
    await writePrivateCounts({ ...counts(), read: 9 }, { dir });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8')).read).toBe(9);
  });

  it('refuses a folder that is a symlink into a git repository', async () => {
    const root = await tmp();
    const repo = join(root, 'repo');
    await mkdir(join(repo, 'inner'), { recursive: true });
    await mkdir(join(repo, '.git'));
    const alias = join(root, 'alias');
    await symlink(join(repo, 'inner'), alias);
    await expect(writePrivateCounts(counts(), { dir: alias })).rejects.toThrow(/inside a git repository/);
    await expect(writePrivateCounts(counts(), { dir: join(alias, 'deeper') })).rejects.toThrow(
      /inside a git repository/,
    );
    expect(() => assertOutsideRepository(alias)).toThrow(/inside a git repository/);
  });

  it('refuses a counts file that is a symlink, and leaves its target untouched', async () => {
    const root = await tmp();
    const repo = join(root, 'repo');
    await mkdir(repo);
    await mkdir(join(repo, '.git'));
    const target = join(repo, 'victim.json');
    await writeFile(target, 'KEEP');
    const dir = join(root, 'private');
    await mkdir(dir);
    const name = `feed-${'b'.repeat(12)}-${'a'.repeat(12)}.json`;
    await symlink(target, join(dir, name));
    await expect(writePrivateCounts(counts(), { dir })).rejects.toThrow(/symlink/);
    expect(await readFile(target, 'utf8')).toBe('KEEP');
  });
});

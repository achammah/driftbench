import { createHash, randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { z } from 'zod';

/** One past conversation, as plain text. The id names it for the person who owns the set and is never stored. */
export type Conversation = { id: string; text: string };

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * A SHA-256 of the set: the hashes of the conversations, sorted and joined. It does not depend on the order
 * of the set and it changes when one conversation changes. The set itself never enters a store or a report.
 */
export function conversationSetHash(conversations: readonly Conversation[]): string {
  return sha256(
    conversations
      .map((conversation) => sha256(conversation.text))
      .sort()
      .join('\n'),
  );
}

/** Where private counts live: DRIFTBENCH_PRIVATE_DIR, else ~/.driftbench/private. */
export function privateDir(env: Record<string, string | undefined> = process.env): string {
  return env.DRIFTBENCH_PRIVATE_DIR?.trim() || join(homedir(), '.driftbench', 'private');
}

/** The real path of `path`: symlinks followed as far as the path exists, the rest appended as written. */
function realPathOf(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

/**
 * Throws when `path` is, or sits under, a git work tree. The check runs on the real path: a symlink that points
 * into a repository is inside it, wherever the link itself stands. Private counts never go where a commit can take them.
 */
export function assertOutsideRepository(path: string): void {
  let dir = realPathOf(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      throw new Error(`${path} is inside a git repository (${dir}): private counts stay outside it`);
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

const Count = z.number().int().min(0);
const Fraction = z.number().min(0).max(1).nullable();

/**
 * Counts only, and numbers only: a variable and a value are named by their position in the store, never by a
 * string. The two strings are SHA-256 digests, of the agent name and of the set: no string the caller wrote is
 * stored. Anything else is refused, so no text can ride in a counts file whatever the caller passes.
 */
const PrivateCountsSchema = z.strictObject({
  agent_hash: z.string().regex(/^[0-9a-f]{64}$/),
  set_hash: z.string().regex(/^[0-9a-f]{64}$/),
  read: Count,
  variables: z.array(
    z.strictObject({
      variable: Count,
      decided: Count,
      unsure: Count,
      absent: Count,
      unread: Count,
      values: z.array(
        z.strictObject({ value: Count, count: Count, share: Fraction, lower: Fraction, upper: Fraction }),
      ),
    }),
  ),
});

export type PrivateCounts = z.infer<typeof PrivateCountsSchema>;

/**
 * Writes the counts of a feed to `<dir>/feed-<first 12 characters of the agent hash>-<first 12 of the set hash>.json`, owner-only (0600) on
 * every write. The folder defaults to privateDir(); its real path must be outside any git repository, and the
 * file must not be a symlink. The file is written beside its final name and renamed over it, so an existing
 * file keeps no older mode and a link is replaced, never followed. Returns the path written.
 */
export async function writePrivateCounts(
  counts: PrivateCounts,
  options: { dir?: string; env?: Record<string, string | undefined> } = {},
): Promise<string> {
  const parsed = PrivateCountsSchema.safeParse(counts);
  if (!parsed.success) {
    // Only the places of the problems: an issue must never echo the value it refused.
    throw new Error(
      `invalid counts: ${parsed.error.issues.map((issue) => issue.path.join('.') || '(top)').join(', ')}`,
    );
  }
  const requested = resolve(options.dir ?? privateDir(options.env));
  assertOutsideRepository(requested);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const dir = await realpath(requested);
  assertOutsideRepository(dir);
  const path = join(
    dir,
    `feed-${parsed.data.agent_hash.slice(0, 12)}-${parsed.data.set_hash.slice(0, 12)}.json`,
  );
  const existing = await lstat(path).catch(() => undefined);
  if (existing?.isSymbolicLink())
    throw new Error(`${path} is a symlink: private counts are not written through a link`);
  if (existing !== undefined && !existing.isFile()) throw new Error(`${path} is not a regular file`);
  const scratch = join(dir, `.feed-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(scratch, `${JSON.stringify(parsed.data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(scratch, 0o600);
    await rename(scratch, path);
  } catch (cause) {
    await rm(scratch, { force: true });
    throw cause;
  }
  return path;
}

/**
 * Reads a folder of conversations: each `.txt` or `.md` file is one conversation; each `.json` file holds
 * `{ "messages": [{ "role": "...", "content": "..." }] }` and becomes `role: content` lines. Other files are
 * skipped. The folder is the owner's; nothing is copied.
 */
export async function loadConversationDir(dir: string): Promise<Conversation[]> {
  const names = (await readdir(dir)).sort();
  const out: Conversation[] = [];
  for (const name of names) {
    const extension = extname(name).toLowerCase();
    if (extension !== '.txt' && extension !== '.md' && extension !== '.json') continue;
    const raw = await readFile(join(dir, name), 'utf8');
    out.push({ id: name, text: extension === '.json' ? fromMessages(raw, name) : raw });
  }
  return out;
}

function fromMessages(raw: string, name: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  const messages =
    typeof parsed === 'object' && parsed !== null ? (parsed as { messages?: unknown }).messages : undefined;
  if (!Array.isArray(messages)) throw new Error(`${name} has no "messages" array`);
  return messages
    .map((message) => {
      const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
      if (typeof role !== 'string' || typeof content !== 'string') {
        throw new Error(`${name} has a message without a text role and content`);
      }
      return `${role}: ${content}`;
    })
    .join('\n');
}

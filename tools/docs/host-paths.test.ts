// No tracked text file names the operator: no home folder with a user name, no operator user name or
// email domain in any form. A path is written repo-relative, or with a placeholder: <repo> for the clone
// root, <home> for a home folder, <scratchpad> for a session scratch folder. An address is fictional, on
// example.com.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Account names that identify no person: generic CI and fixture accounts, and spelled-out placeholders. */
const PLACEHOLDER_USERS = new Set([
  'runner', // the GitHub-hosted runner account, in recorded CI logs
  'agent', // the estate fixture account
  'zzzz', // an already-masked name quoted from a public dataset
  'user',
  'username',
  'name',
  'you',
  'example',
]);

/**
 * The operator, by sha256 of the lowercase text, so this file does not name them. A word matches one
 * alphanumeric run of its length anywhere: the user name, and the two labels unique to the operator email
 * domain. An email domain matches `<label>.<label>` right after `@` or `_`, as in an address or its local
 * part.
 */
type Words = Map<number, Set<string>>;
const OPERATOR_WORDS: Words = new Map([
  [5, new Set(['4e15cc6cf3eb8fa939486b0bc84c30968f0264ae8ac32d4d762be58f67d75990'])],
  [14, new Set(['ed816cd62ad06fb536f2b236558051f90f2ee918a531508c9b0f87fa8d975bfe'])],
  [8, new Set(['5c5ee7d38a520ed93633305b325511899fb1179ab57010cecd5c303a84df922e'])],
]);
const OPERATOR_EMAIL_DOMAINS = new Set(['98d84332511a5a46d908d401562ad2f6fd30c69a88cbe2291aef14acdd6fe421']);

const NAME = '([A-Za-z0-9][A-Za-z0-9._-]*)';
const PATTERNS = [
  // /Users/<name>/ or /home/<name>/, not inside a URL path; JSON-escaped slashes are unescaped first.
  new RegExp(`(?<![A-Za-z0-9._-])/(?:Users|home)/${NAME}/`, 'g'),
  // C:\Users\<name>\, with single or escaped backslashes.
  new RegExp(`[A-Za-z]:(?:\\\\)+Users(?:\\\\)+${NAME}(?:\\\\)+`, 'g'),
  // A home folder flattened into one segment, as a Claude Code project folder is: /-Users-<name>-…
  new RegExp(`/-(?:Users|home)-${NAME.replace('._-', '._')}-`, 'g'),
];

/** The account names a text exposes, placeholders excluded. */
function hostUsers(text: string): string[] {
  const flat = text.replaceAll('\\/', '/');
  const users: string[] = [];
  for (const pattern of PATTERNS)
    for (const [, user = ''] of flat.matchAll(pattern))
      if (!PLACEHOLDER_USERS.has(user.toLowerCase())) users.push(user);
  return users;
}

const ALNUM = new Uint8Array(256);
for (const [from, to] of [
  [48, 57],
  [65, 90],
  [97, 122],
] as const)
  for (let code = from; code <= to; code++) ALNUM[code] = 1;
const AT = 64;
const UNDERSCORE = 95;
const DOT = 46;

/**
 * How many times a text names the operator, one pass over its bytes. Only a run of a listed length, or a
 * run between `@`/`_` and `.`, is decoded and hashed; `cache` keeps each distinct run's verdict.
 */
function operatorMentions(
  text: Buffer,
  words: Words = OPERATOR_WORDS,
  domains = OPERATOR_EMAIL_DOMAINS,
  cache = new Map<string, boolean>(),
): number {
  const runEnd = (from: number) => {
    let end = from;
    while (end < text.length && ALNUM[text[end] as number]) end++;
    return end;
  };
  const lower = (from: number, to: number) => text.toString('latin1', from, to).toLowerCase();
  let mentions = 0;
  let index = 0;
  while (index < text.length) {
    if (!ALNUM[text[index] as number]) {
      index++;
      continue;
    }
    const end = runEnd(index);
    const hashes = words.get(end - index);
    if (hashes) {
      const run = lower(index, end);
      let verdict = cache.get(run);
      if (verdict === undefined) {
        verdict = hashes.has(sha256(run));
        cache.set(run, verdict);
      }
      if (verdict) mentions++;
    }
    const before = text[index - 1];
    if ((before === AT || before === UNDERSCORE) && text[end] === DOT && end - index <= 32) {
      const next = runEnd(end + 1);
      if (next > end + 1 && domains.has(sha256(`${lower(index, end)}.${lower(end + 1, next)}`))) mentions++;
    }
    index = end;
  }
  return mentions;
}

/** Tracked text files, as git sees them. */
function trackedText(): string[] {
  const result = spawnSync('git', ['grep', '-lIz', '-e', '.', '--', '.'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  if (result.status !== 0 && result.status !== 1) throw new Error(`git grep failed: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean);
}

describe('host paths', () => {
  it('finds a home folder with a user name in every spelling', () => {
    const who = ['jane', 'doe'].join('');
    expect(hostUsers(`cwd /Users/${who}/src/app`)).toEqual([who]);
    expect(hostUsers(`{"p":"\\/home\\/${who}\\/x"}`)).toEqual([who]);
    expect(hostUsers(`C:\\Users\\${who}\\repo`)).toEqual([who]);
    expect(hostUsers(`C:\\\\Users\\\\${who}\\\\repo`)).toEqual([who]);
    expect(hostUsers(`/tmp/claude-501/-Users-${who}-Documents-x/s`)).toEqual([who]);
  });

  it('allows placeholders, generic accounts and URL paths', () => {
    expect(hostUsers('<home>/.local/bin/claude and <repo>/node_modules')).toEqual([]);
    expect(hostUsers('/Users/<user>/x and /home/$USER/x and ~/x')).toEqual([]);
    expect(hostUsers('/home/runner/work/driftbench and /home/agent/.claude')).toEqual([]);
    expect(hostUsers('https://example.com/home/docs/page')).toEqual([]);
  });
});

describe('operator identity', () => {
  const who = ['jane', 'doe'].join('');
  const domain = ['corp', 'test'].join('.');
  const words: Words = new Map([[who.length, new Set([sha256(who)])]]);
  const domains = new Set([sha256(domain)]);
  const count = (text: string) => operatorMentions(Buffer.from(text), words, domains);

  it('finds the user name in any form and the email domain after @ or _', () => {
    expect(count(`${who}`)).toBe(1);
    expect(count(`Doc-${who.toUpperCase()}-x and /tmp/-Users-${who}-y`)).toBe(2);
    expect(count(`(${who}_${domain}@...)`)).toBe(2);
    expect(count(`mail ops@${domain} now`)).toBe(1);
    expect(count(`x_${domain.toUpperCase()}`)).toBe(1);
  });

  it('ignores longer words, other domains and the domain as a host name', () => {
    expect(count(`${who}s ${who}2 pre${who}`)).toBe(0);
    expect(count('person1@example.com ops@example.com')).toBe(0);
    expect(count(`https://${domain}/x and api.${domain}`)).toBe(0);
  });

  it('no tracked text file has a home-folder path or names the operator', { timeout: 300_000 }, () => {
    const found: string[] = [];
    const cache = new Map<string, boolean>();
    for (const file of trackedText()) {
      const bytes = readFileSync(join(root, file));
      const users =
        bytes.includes('Users') || bytes.includes('home') ? hostUsers(bytes.toString('utf8')) : [];
      if (users.length) found.push(`${file}: ${users.length} home-folder path(s)`);
      const mentions = operatorMentions(bytes, OPERATOR_WORDS, OPERATOR_EMAIL_DOMAINS, cache);
      if (mentions) found.push(`${file}: ${mentions} operator mention(s)`);
    }
    expect(found).toEqual([]);
  });
});

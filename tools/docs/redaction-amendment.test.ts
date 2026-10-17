// tools/docs/redaction-amendment.json records a redaction of hash-bound files: each file's old and new
// sha256, and the rule applied. These tests prove the record: every new digest is its file's digest, and
// every old file is the new file with only the placeholders and the re-recorded digests reverted.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

type Entry = {
  role: 'scrubbed' | 're-recorded';
  old_sha256: string;
  new_sha256: string;
  old_blob: string;
  rules?: Record<string, number>;
};
type Composite = { file: string; covers: string[]; old_sha256: string; new_sha256: string };
const amendment = JSON.parse(readFileSync(join(root, 'tools/docs/redaction-amendment.json'), 'utf8')) as {
  files: Record<string, Entry>;
  composites: Composite[];
  digest_map_old_to_new: Record<string, string>;
};

/**
 * What each placeholder replaced, as a pattern that names nobody: the old text at a placeholder's
 * position must match it. An email replacement keeps the length of what it replaced.
 */
const NAME = '[A-Za-z0-9._-]+';
const FRAGMENT = '[a-z0-9]+_[a-z0-9]+\\.[a-z0-9]+';
const PLACEHOLDERS: Record<string, RegExp> = {
  '<scratchpad>': new RegExp(
    `(?:/private)?/tmp/claude-\\d+/-Users-${NAME}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/scratchpad`,
    'y',
  ),
  '<repo>': new RegExp(`/Users/${NAME}/Documents/GitHub/driftbench`, 'y'),
  '<home>': new RegExp(`/Users/${NAME}(?=/)`, 'y'),
  'person1@example.com': new RegExp(`${FRAGMENT}@\\.\\.\\.`, 'y'),
  'person@example.com': new RegExp(`${FRAGMENT}\\.\\.\\.`, 'y'),
  'ops@example.com': new RegExp(`${FRAGMENT}(?![A-Za-z0-9.@])`, 'y'),
};
const SAME_LENGTH = new Set(['person1@example.com', 'person@example.com', 'ops@example.com']);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN = new RegExp(
  `${Object.keys(PLACEHOLDERS).map(escapeRegExp).join('|')}|(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])`,
  'g',
);

const newToOld = new Map(Object.entries(amendment.digest_map_old_to_new).map(([from, to]) => [to, from]));

/** Undo the redaction: null when the old text is not the new text with only the listed changes reverted. */
function provesRevert(newText: string, oldText: string, scrubbed: boolean): string | null {
  let at = 0;
  let last = 0;
  for (const match of newText.matchAll(TOKEN)) {
    const literal = newText.slice(last, match.index);
    if (!oldText.startsWith(literal, at)) return `text differs before offset ${match.index}`;
    at += literal.length;
    const token = match[0];
    const pattern = PLACEHOLDERS[token];
    if (pattern) {
      if (!scrubbed) return `placeholder ${token} in a re-recorded file`;
      pattern.lastIndex = at;
      const original = pattern.exec(oldText);
      if (!original) return `no original for ${token} at offset ${match.index}`;
      if (SAME_LENGTH.has(token) && original[0].length !== token.length)
        return `length changed at ${match.index}`;
      at += original[0].length;
    } else {
      const expected = newToOld.get(token) ?? token;
      if (!oldText.startsWith(expected, at)) return `digest differs at offset ${match.index}`;
      at += expected.length;
    }
    last = (match.index ?? 0) + token.length;
  }
  if (oldText.slice(at) !== newText.slice(last)) return 'text differs after the last change';
  return null;
}

/** The old bytes from history, or undefined in a shallow clone that lacks them. */
function oldBlob(id: string): Buffer | undefined {
  const result = spawnSync('git', ['cat-file', 'blob', id], { cwd: root, maxBuffer: 1 << 27 });
  if (result.status === 0) return result.stdout;
  const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' });
  if (shallow.stdout.trim() === 'true') return undefined;
  throw new Error(`blob ${id} is missing from a full clone`);
}

describe('redaction amendment', () => {
  const entries = Object.entries(amendment.files);

  it('lists every file with a placeholder rule or a re-recorded digest', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [, entry] of entries) {
      expect(entry.role === 'scrubbed' ? Object.keys(entry.rules ?? {}).length : 1).toBeGreaterThan(0);
      expect(amendment.digest_map_old_to_new[entry.old_sha256]).toBe(entry.new_sha256);
    }
  });

  it('records each file at its current digest', () => {
    const wrong = entries.filter(
      ([file, entry]) => sha256(readFileSync(join(root, file))) !== entry.new_sha256,
    );
    expect(wrong.map(([file]) => file)).toEqual([]);
  });

  it('records each composite digest over the files it covers', () => {
    for (const composite of amendment.composites) {
      const joined = Buffer.concat(composite.covers.map((file) => readFileSync(join(root, file))));
      expect(sha256(joined)).toBe(composite.new_sha256);
      expect(readFileSync(join(root, composite.file), 'utf8')).toContain(composite.new_sha256);
    }
  });

  it('changes nothing but the placeholders and the digests', { timeout: 300_000 }, () => {
    const failures: string[] = [];
    let compared = 0;
    for (const [file, entry] of entries) {
      const old = oldBlob(entry.old_blob);
      if (!old) continue;
      compared++;
      if (sha256(old) !== entry.old_sha256) failures.push(`${file}: old blob is not the old digest`);
      const reason = provesRevert(
        readFileSync(join(root, file), 'latin1'),
        old.toString('latin1'),
        entry.role === 'scrubbed',
      );
      if (reason) failures.push(`${file}: ${reason}`);
    }
    expect(failures).toEqual([]);
    const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (shallow.stdout.trim() !== 'true') expect(compared).toBe(entries.length);
  });

  it('leaves no old digest anywhere but in this record', () => {
    const olds = Object.keys(amendment.digest_map_old_to_new);
    const result = spawnSync('git', ['grep', '-lF', ...olds.flatMap((digest) => ['-e', digest]), '--', '.'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.status !== 0 && result.status !== 1) throw new Error(`git grep failed: ${result.stderr}`);
    const holders = result.stdout
      .split('\n')
      .filter((file) => file && file !== 'tools/docs/redaction-amendment.json');
    expect(holders).toEqual([]);
  });

  it('the revert check fails on any other change', () => {
    const home = ['', 'Users', 'x'].join('/');
    const old = `a ${home}/Documents/GitHub/driftbench/b abcde_fgh.ijklm@... c`;
    const good = 'a <repo>/b person1@example.com c';
    expect(provesRevert(good, old, true)).toBeNull();
    expect(provesRevert('a <repo>/b person1@example.com C', old, true)).not.toBeNull();
    expect(provesRevert('a <repo>/c person1@example.com c', old, true)).not.toBeNull();
    expect(provesRevert(good, old, false)).not.toBeNull();
    expect(
      provesRevert('a <home>/b abcde_fgh.ijklm@... c', `a ${home}/b abcde_fgh.ijklm@... c`, true),
    ).toBeNull();
  });
});

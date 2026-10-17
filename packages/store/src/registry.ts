import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { canonicalJson } from '@agent-nexus/driftbench-core';
import { StoreError } from './errors';

/**
 * The content-addressed registry: named, numbered, immutable versions of a set of files. A dataset
 * is a folder of spec files; a prompt is one file or a folder. Each file is kept once, by its SHA-256;
 * a version is the sorted list of its paths and file hashes, and its own hash is the SHA-256 of that
 * list's canonical JSON. Pushing content a name already holds gives back that version.
 */

/**
 * What a version holds: a dataset, a prompt, or one object of the framework, `object.<kind>` with the object
 * kind's `/` written as `.`, such as `object.policy.blame` or `object.persona`. Object kinds are open (a
 * plugin adds kinds), so they are checked by their form, not listed.
 */
export type RegistryKind = 'dataset' | 'prompt' | `object.${string}`;
/** The fixed kinds. Object kinds are `object.<kind>`: see `objectRegistryKind` and `isRegistryKind`. */
export const REGISTRY_KINDS: readonly RegistryKind[] = ['dataset', 'prompt'];

/** The object kind grammar of core's `ObjectKind`: lower case, one optional `/` group. */
const OBJECT_KIND = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?$/;
const OBJECT_REGISTRY_KIND = /^object\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/;

/** True for `dataset`, `prompt` and `object.<kind>` with a well formed object kind. */
export function isRegistryKind(kind: unknown): kind is RegistryKind {
  return (
    typeof kind === 'string' &&
    (REGISTRY_KINDS.includes(kind as RegistryKind) || OBJECT_REGISTRY_KIND.test(kind))
  );
}

/** The registry kind of an object kind: `policy/blame` gives `object.policy.blame`. */
export function objectRegistryKind(kind: string): RegistryKind {
  if (!OBJECT_KIND.test(kind)) {
    throw new StoreError(
      'INVALID_RECORD',
      `"${kind}" is not an object kind, such as policy/blame or persona`,
    );
  }
  return `object.${kind.replaceAll('/', '.')}`;
}

/** One file of a version: a path relative to the version's root, with `/` separators. */
export type RegistryFile = { path: string; bytes: Uint8Array };

export type RegistryEntry = { path: string; sha256: string; size: number };

export type RegistryVersion = {
  kind: RegistryKind;
  name: string;
  /** 1, 2, 3: the order versions of one name were pushed in. */
  version: number;
  /** The SHA-256 of the canonical JSON of `files`. */
  hash: string;
  files: RegistryEntry[];
  /** Where the files were read from, when the push said so. */
  source?: string;
  /** True when the version is one file, restored to a file path rather than into a folder. */
  single?: boolean;
  note?: string;
  createdAt: string;
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function checkName(name: string): void {
  if (!NAME.test(name)) {
    throw new StoreError(
      'INVALID_RECORD',
      `"${name}" is not a registry name: use letters, digits, dots, underscores and hyphens`,
    );
  }
}

/** The entries of a set of files, sorted by path, after checking every path. */
export function entriesOf(files: readonly RegistryFile[]): RegistryEntry[] {
  if (files.length === 0) throw new StoreError('INVALID_RECORD', 'a version needs at least one file');
  const seen = new Set<string>();
  const entries = files.map((file) => {
    checkPath(file.path);
    if (seen.has(file.path)) throw new StoreError('INVALID_RECORD', `the version names ${file.path} twice`);
    seen.add(file.path);
    return { path: file.path, sha256: sha256(file.bytes), size: file.bytes.byteLength };
  });
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function versionHash(entries: readonly RegistryEntry[]): string {
  return createHash('sha256').update(canonicalJson(entries)).digest('hex');
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** True when `path` is a relative path inside a version: / between folder names, no empty part, . or .. */
export function isVersionPath(path: string): boolean {
  const parts = path.split('/');
  return !(
    path === '' ||
    path.includes('\\') ||
    path.startsWith('/') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  );
}

export function checkPath(path: string): void {
  if (!isVersionPath(path)) {
    throw new StoreError(
      'INVALID_RECORD',
      `"${path}" is not a relative path inside the version: use / between folder names, no . or ..`,
    );
  }
}

/** `name`, `name@3`, `name@latest` or `name@<hash prefix>`. */
export function parseVersionRef(text: string): { name: string; ref?: string } {
  const at = text.lastIndexOf('@');
  if (at <= 0) return { name: text };
  return { name: text.slice(0, at), ref: text.slice(at + 1) };
}

/**
 * Reads a file, or every file under a folder in path order. Generated `.seed-*` folders retain their
 * contents, including hidden fixtures. Other dot entries, `.git` and `node_modules` are skipped.
 */
export async function readTree(path: string): Promise<{ files: RegistryFile[]; single: boolean }> {
  const info = await stat(path);
  if (info.isFile()) {
    return { files: [{ path: basename(path), bytes: new Uint8Array(await readFile(path)) }], single: true };
  }
  const files: RegistryFile[] = [];
  const walk = async (folder: string, inSeed = false): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const seed = inSeed || (entry.isDirectory() && entry.name.startsWith('.seed-'));
      if (entry.name.startsWith('.') && !seed) continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) await walk(full, seed);
      else if (entry.isFile()) {
        files.push({
          path: relative(path, full).split(sep).join('/'),
          bytes: new Uint8Array(await readFile(full)),
        });
      }
    }
  };
  await walk(path);
  return { files, single: false };
}

export type RestoreReport = {
  written: number;
  unchanged: number;
  /** Files on disk that differ from the version. Nothing is written while any is left without force. */
  conflicts: string[];
  /** Files in the target folder that the version does not hold. They are left as they are. */
  extra: string[];
};

/**
 * Writes the files of a version, byte for byte, into a folder, or to one file path for a version
 * of one file. A file already there with the same bytes is left; one with other bytes is a conflict,
 * and while any conflict is left without `force`, nothing is written.
 */
export async function restoreFiles(
  files: readonly RegistryFile[],
  target: string,
  options: { single: boolean; force?: boolean },
): Promise<RestoreReport> {
  const placed = files.map((file) => ({
    file,
    to: options.single && files.length === 1 ? target : join(target, ...file.path.split('/')),
  }));
  const pending: typeof placed = [];
  const conflicts: string[] = [];
  let unchanged = 0;
  for (const item of placed) {
    const current = await readFile(item.to).catch(() => undefined);
    if (current === undefined) pending.push(item);
    else if (Buffer.compare(current, item.file.bytes) === 0) unchanged += 1;
    else {
      conflicts.push(item.file.path);
      pending.push(item);
    }
  }
  const extra = options.single ? [] : await extraFiles(target, new Set(files.map((file) => file.path)));
  if (conflicts.length > 0 && options.force !== true) return { written: 0, unchanged, conflicts, extra };
  for (const item of pending) {
    await mkdir(dirname(item.to), { recursive: true });
    await writeFile(item.to, item.file.bytes);
  }
  return { written: pending.length, unchanged, conflicts: [], extra };
}

async function extraFiles(target: string, kept: ReadonlySet<string>): Promise<string[]> {
  const exists = await stat(target).catch(() => undefined);
  if (!exists?.isDirectory()) return [];
  const { files } = await readTree(target);
  return files.map((file) => file.path).filter((path) => !kept.has(path));
}

export type FileChange = {
  path: string;
  status: 'added' | 'removed' | 'changed';
  /** For a changed file: hunks of a line diff for text, one summary line for binary bytes. */
  lines?: string[];
};

/** The changes from one set of files to another, by path. Equal files are left out. */
export function diffFiles(before: readonly RegistryFile[], after: readonly RegistryFile[]): FileChange[] {
  const old = new Map(before.map((file) => [file.path, file.bytes]));
  const now = new Map(after.map((file) => [file.path, file.bytes]));
  const paths = [...new Set([...old.keys(), ...now.keys()])].sort();
  const changes: FileChange[] = [];
  for (const path of paths) {
    const a = old.get(path);
    const b = now.get(path);
    if (a === undefined) changes.push({ path, status: 'added' });
    else if (b === undefined) changes.push({ path, status: 'removed' });
    else if (Buffer.compare(a, b) !== 0) changes.push({ path, status: 'changed', lines: lineDiff(a, b) });
  }
  return changes;
}

const CONTEXT = 1;
const MAX_CELLS = 4_000_000;

function lineDiff(a: Uint8Array, b: Uint8Array): string[] {
  const left = asText(a);
  const right = asText(b);
  if (left === undefined || right === undefined) {
    return [`binary: ${a.byteLength} bytes before, ${b.byteLength} after`];
  }
  const x = splitLines(left);
  const y = splitLines(right);
  if (x.length * y.length > MAX_CELLS)
    return [`${x.length} lines before, ${y.length} after: too long to compare`];
  // Longest common subsequence, in a flat table: at(i, j) is the length for x[i..] and y[j..].
  const width = y.length + 1;
  const table = new Int32Array((x.length + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = x[i] === y[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  type Op = { kind: ' ' | '-' | '+'; text: string; line: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push({ kind: ' ', text: x[i] ?? '', line: i + 1 });
      i += 1;
      j += 1;
    } else if (i < x.length && (j >= y.length || at(i + 1, j) >= at(i, j + 1))) {
      ops.push({ kind: '-', text: x[i] ?? '', line: i + 1 });
      i += 1;
    } else {
      ops.push({ kind: '+', text: y[j] ?? '', line: i + 1 });
      j += 1;
    }
  }
  const lines: string[] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index]?.kind === ' ') {
      index += 1;
      continue;
    }
    let start = Math.max(0, index - CONTEXT);
    while (start > 0 && ops[start - 1]?.kind !== ' ') start -= 1;
    let end = index;
    // Extend the hunk while changes follow within twice the context.
    while (end < ops.length) {
      let next = end;
      while (next < ops.length && ops[next]?.kind !== ' ') next += 1;
      let gap = next;
      while (gap < ops.length && ops[gap]?.kind === ' ') gap += 1;
      if (gap < ops.length && gap - next <= CONTEXT * 2) end = gap;
      else {
        end = Math.min(ops.length, next + CONTEXT);
        break;
      }
    }
    lines.push(`@@ line ${ops[start]?.line ?? 1} @@`);
    for (const op of ops.slice(start, end)) lines.push(`${op.kind}${op.text}`);
    index = end;
  }
  return lines;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function asText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** True when a value has the shape of a version record. Its hash is checked apart, with `versionHash`. */
export function isVersionRecord(value: unknown): value is RegistryVersion {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const files = record.files;
  return (
    isRegistryKind(record.kind) &&
    typeof record.name === 'string' &&
    Number.isInteger(record.version) &&
    (record.version as number) >= 1 &&
    typeof record.hash === 'string' &&
    typeof record.createdAt === 'string' &&
    Array.isArray(files) &&
    files.every(
      (file) =>
        file !== null &&
        typeof file === 'object' &&
        typeof file.path === 'string' &&
        typeof file.sha256 === 'string' &&
        Number.isInteger(file.size),
    )
  );
}

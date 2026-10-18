import { createHash } from 'node:crypto';
import { parse } from 'yaml';

/**
 * The places a `structure` provenance entry names, and the hash of what each holds. A JSON or YAML file is
 * read as data and a pointer (RFC 6901) names one value of it; any other file is read as lines. The hash of a
 * value is the SHA-256 of its canonical JSON (keys sorted, no white space), so a reformatted file or another
 * order of keys is the same value; the hash of lines is the SHA-256 of the lines joined by a line feed, so a
 * changed line is found out. The store checks only the shape of an entry; `verifyVariableQuotes` in the
 * generate package reads the file and calls `resolveStructure`.
 */

export type StructureTarget = { pointer: string } | { lines: { start: number; end: number } };
export type StructureResolved = { ok: true; hash: string } | { ok: false; message: string };

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** `~` is `~0` and `/` is `~1` inside a pointer step. */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** The pointer of a path of keys and indexes from the root. The root is the empty pointer. */
export function pointerOfPath(path: ReadonlyArray<string | number>): string {
  return path.map((step) => `/${escapePointerToken(String(step))}`).join('');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function step(value: unknown, token: string): { found: true; value: unknown } | { found: false } {
  if (Array.isArray(value)) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return { found: false };
    const index = Number(token);
    return index < value.length ? { found: true, value: value[index] } : { found: false };
  }
  if (value !== null && typeof value === 'object' && Object.hasOwn(value, token)) {
    return { found: true, value: (value as Record<string, unknown>)[token] };
  }
  return { found: false };
}

/** The hash of the place `target` names in `text`, or why it names none. */
export function resolveStructure(text: string, target: StructureTarget): StructureResolved {
  if ('pointer' in target) {
    let value: unknown;
    try {
      value = parse(text);
    } catch (cause) {
      const reason = cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
      return {
        ok: false,
        message: `the file is not valid JSON or YAML, so ${target.pointer || 'the root'} names nothing: ${reason}`,
      };
    }
    for (const raw of target.pointer === '' ? [] : target.pointer.slice(1).split('/')) {
      const found = step(value, raw.replace(/~1/g, '/').replace(/~0/g, '~'));
      if (!found.found)
        return { ok: false, message: `the pointer ${target.pointer} does not resolve in the file` };
      value = found.value;
    }
    return { ok: true, hash: sha256(canonicalJson(value)) };
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const { start, end } = target.lines;
  if (start < 1 || end < start || end > lines.length) {
    return { ok: false, message: `lines ${start} to ${end} are not in the file, which has ${lines.length}` };
  }
  return { ok: true, hash: sha256(lines.slice(start - 1, end).join('\n')) };
}

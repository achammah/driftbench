import { createHash } from 'node:crypto';

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** The first `length` base32 (Crockford, lower case) characters of the SHA-256 of a text. */
export function base32Id(text: string, length = 10): string {
  const digest = createHash('sha256').update(text).digest();
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= length) break;
  }
  return out;
}

/** JSON with sorted keys at every depth, two-space indentation and a final newline. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sort((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Compact canonical JSON (sorted keys, no spaces): the form that is hashed. */
export function canonicalCompact(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sort((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

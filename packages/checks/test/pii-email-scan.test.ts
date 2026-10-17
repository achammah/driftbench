import { describe, expect, it } from 'vitest';
import { scanPii } from '../src/support/pii';

// The scan reads emails in one pass over the at signs. This is the pattern the first version used, kept as the
// oracle: both must find the same addresses at the same offsets.
const ORACLE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const oracle = (text: string) =>
  [...text.matchAll(ORACLE)]
    .map((m) => ({ value: m[0], offset: m.index }))
    .filter((m) => !m.value.endsWith('.example.org'));

function emails(text: string) {
  return scanPii(text, { reservedDomains: 'include' })
    .filter((f) => f.kind === 'email')
    .map((f) => ({ value: f.value, offset: f.offset }));
}

describe('the email scan', () => {
  it('finds what the pattern finds, on random text of the characters that matter', () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    const alphabet = ['a', 'b', 'Z', '1', '9', '.', '.', '-', '_', '%', '+', '@', '@', ' ', 'com', 'x1'];
    for (let round = 0; round < 3000; round++) {
      let text = '';
      for (let i = next() % 24; i > 0; i--) text += alphabet[next() % alphabet.length];
      const expected = oracle(text).filter((m) => m.value.toLowerCase() !== 'git@github.com');
      expect(emails(text), JSON.stringify(text)).toEqual(expected);
    }
  });

  it('reads long text without an address in time linear in its length', () => {
    for (const unit of ['a', 'a.', '1', 'a@', 'ab-']) {
      const started = performance.now();
      expect(emails(unit.repeat(Math.ceil(80_000 / unit.length)))).toEqual([]);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});

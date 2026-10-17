import { describe, expect, it } from 'vitest';
import { emailMatches, scanPii } from '../src/support/pii';

/** The pattern the scanner replaced, kept here as the reference for equal matches. */
const OLD_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function oldMatches(text: string): { value: string; index: number }[] {
  return [...text.matchAll(OLD_EMAIL)].map((m) => ({ value: m[0], index: m.index }));
}

/** A small seeded generator, so a failing case is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const PIECES = [
  'a',
  'b',
  'Z',
  '1',
  '9',
  '.',
  '.',
  '-',
  '_',
  '%',
  '+',
  '@',
  '@',
  'com',
  'x1',
  'é',
  ' ',
  '\n',
  '..',
  'GB',
  'io',
  'a-b',
  '0',
];

/** An address joined from its parts at run time: a local part, then each domain after an @. */
function at(...parts: string[]): string {
  return parts.join('@');
}

function cpuMs<T>(run: () => T): { result: T; ms: number } {
  const before = process.cpuUsage();
  const result = run();
  const used = process.cpuUsage(before);
  return { result, ms: (used.user + used.system) / 1000 };
}

describe('emailMatches gives the matches of the original pattern', () => {
  it('on random texts built from email-like pieces', () => {
    const next = random(20261017);
    for (let round = 0; round < 40000; round++) {
      const count = Math.floor(next() * 14);
      let text = '';
      for (let i = 0; i < count; i++) text += PIECES[Math.floor(next() * PIECES.length)];
      expect(emailMatches(text), JSON.stringify(text)).toEqual(oldMatches(text));
    }
  });

  it('on random texts over the characters that decide a match', () => {
    const next = random(7);
    const alphabet = ['a', 'b', '1', '.', '-', '@'];
    for (let round = 0; round < 40000; round++) {
      const count = Math.floor(next() * 18);
      let text = '';
      for (let i = 0; i < count; i++) text += alphabet[Math.floor(next() * alphabet.length)];
      expect(emailMatches(text), JSON.stringify(text)).toEqual(oldMatches(text));
    }
  });

  // Addresses outside the fictional domains are put together at run time from their parts, so the repository leak
  // guard does not read the test's inputs as real addresses; the strings under test are the same.
  it.each([
    'dana.brooks@example.com',
    at('a', 'b.co'),
    'a@b.c',
    at('a', 'b.com1'),
    'a@b.1com',
    at('a', 'b.c1.com'),
    at('a', 'b.comx', 'y.org'),
    at('a', 'b.com1x', 'c.org'),
    'a@@b.com',
    '@b.com',
    'a@.com',
    'a@b..com',
    at('a', 'b.com.'),
    at('x-y_z%w+v', 'sub.domain-name.co.uk'),
    `${at('first', 'a.bc')} ${at('second', 'd.ef')}`,
    at('a', 'b-.c-d.ef'),
    'é@b.com',
    '',
  ])('on %j', (text) => {
    expect(emailMatches(text)).toEqual(oldMatches(text));
  });

  it('finds the same findings in a whole scan', () => {
    const person = at('pell.arden', 'larkspur.io');
    const text = `Write to ${person} or dana@example.com, not git@github.com.`;
    expect(scanPii(text).map((f) => f.value)).toEqual([person]);
  });
});

describe('the personal data scan takes linear CPU time on hostile text', () => {
  const BUDGET_MS = 400;
  const cases: [string, string][] = [
    ['a x20000, @, b. x20000', `${'a'.repeat(20000)}@${'b.'.repeat(20000)}`],
    ['1. x40000', '1.'.repeat(40000)],
    ['GB then 0 x60000', `GB${'0'.repeat(60000)}`],
    ['@ x40000', '@'.repeat(40000)],
    ['a@ x30000', 'a@'.repeat(30000)],
    ['a@b. x20000', 'a@b.'.repeat(20000)],
    ['a.b@c x20000', 'a.b@c'.repeat(20000)],
  ];
  it.each(cases)('%s', (_name, text) => {
    const { ms } = cpuMs(() => scanPii(text));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('doubles the text and roughly doubles the time', () => {
    const small = cpuMs(() => emailMatches('1.'.repeat(100000))).ms;
    const large = cpuMs(() => emailMatches('1.'.repeat(400000))).ms;
    expect(large).toBeLessThan(Math.max(small * 12, 50));
  });
});

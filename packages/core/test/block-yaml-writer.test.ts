import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { stringifyBlockYaml } from '../src/spec/block-yaml';

const reference = (value: unknown) => stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });

const strings = [
  'hello',
  'Hello world.',
  'true',
  'False',
  'null',
  'NULL',
  'Nullable',
  '~',
  '1',
  '-3',
  '+4',
  '1.5',
  '1e3',
  '.5',
  '.inf',
  '0x1f',
  '0o17',
  '12abc',
  'a: b',
  'a:b',
  'a:',
  'a # b',
  'a#b',
  '#a',
  ' lead',
  'trail ',
  '- a',
  '-a',
  '-',
  '?',
  '? a',
  '*a',
  '&a',
  '!a',
  '|a',
  '>a',
  '%a',
  '@a',
  '`a',
  '[a]',
  '{a}',
  'a, b',
  ',a',
  '"quoted"',
  "it's",
  'say "hi"',
  `both ' and "`,
  'a\\b',
  'tab\there',
  '',
  '---',
  '...',
  '--- x',
  'é à ü',
  '😃 ok',
  'a b',
  'hello\nworld',
  '\nfirst',
  'ctrl\u0001',
  'line sep',
  '**/.claude/skills/x/*.md',
  'Read `policy.md` first, then edit.',
  'ordered_pair: Read references/rules-1.md before you change any record',
];

const numbers = [
  0,
  1,
  -1,
  42,
  0.5,
  -2.25,
  1e21,
  1e-7,
  123456789012,
  Number.MAX_SAFE_INTEGER,
  -0,
  Number.NaN,
  Infinity,
];

describe('stringifyBlockYaml', () => {
  it.each(strings)('writes the string %j as the library does', (value) => {
    for (const shape of [
      { key: value },
      { list: [value, 'other'] },
      [value],
      [{ first: value, second: { deep: [value, { again: value }] } }],
      [[value, [value]]],
    ]) {
      const text = stringifyBlockYaml(shape);
      expect(text).toBe(reference(shape));
      expect(parse(text)).toEqual(shape);
    }
  });

  it.each(numbers)('writes the number %s as the library does', (value) => {
    const shape = { count: value, list: [value] };
    expect(stringifyBlockYaml(shape)).toBe(reference(shape));
  });

  it('writes keys that are plain, reserved, odd or long as the library does', () => {
    for (const key of [
      'name',
      'a.b',
      'a-b',
      '_x',
      'true',
      'null',
      'Null',
      '1',
      '1e3',
      'a b',
      'a:b',
      '',
      'é',
      '__proto__',
      'x'.repeat(2000),
    ]) {
      const shape = Object.defineProperty({}, key, { value: { v: 1 }, enumerable: true });
      expect(stringifyBlockYaml(shape)).toBe(reference(shape));
    }
  });

  it('writes containers, empty ones, missing values and non-plain objects as the library does', () => {
    const shapes: unknown[] = [
      {},
      [],
      { a: {}, b: [], c: [[]], d: [{}] },
      { a: null, b: true, c: false },
      { a: undefined, b: 1 },
      [1, [2, [3, [4]]], { x: [{ y: [] }] }],
      { when: { user: 'hi' }, expect: { skills: [{ name: 'a', count: { min: 1 } }] } },
      [undefined, 1],
      'just a string',
      42,
      null,
      new Date(0),
      { when: new Date(0) },
      new Map([['a', 1]]),
      { a: 1n },
    ];
    for (const shape of shapes) {
      try {
        expect(stringifyBlockYaml(shape)).toBe(reference(shape));
      } catch (cause) {
        // The library throws on what it cannot write; the writer must throw the same way.
        expect(() => reference(shape)).toThrow();
        expect(() => stringifyBlockYaml(shape)).toThrow();
        void cause;
      }
    }
  });

  it('writes a value shared twice without an anchor', () => {
    const shared = { x: 1 };
    const shape = { a: shared, b: shared };
    expect(stringifyBlockYaml(shape)).toBe(reference(shape));
  });

  it.each([
    { name: 'root map', shape: { a: undefined }, text: '{}\n' },
    { name: 'map value', shape: { a: { b: undefined } }, text: 'a: {}\n' },
    { name: 'list item', shape: [{ a: undefined }], text: '- {}\n' },
    { name: 'nested lists', shape: [[{ a: undefined }]], text: '- - {}\n' },
    {
      name: 'nested maps',
      shape: { a: { b: { c: undefined }, d: undefined } },
      text: 'a:\n  b: {}\n',
    },
    {
      name: 'mixed lists and maps',
      shape: { a: [{ b: [{ c: undefined }], d: undefined }, { e: undefined }] },
      text: 'a:\n  - b:\n      - {}\n  - {}\n',
    },
    {
      name: 'empty map before remaining list items',
      shape: [{ a: undefined }, { b: 1, c: undefined }, []],
      text: '- {}\n- b: 1\n- []\n',
    },
  ])('preserves an empty container after omitting undefined in a $name', ({ shape, text }) => {
    expect(reference(shape)).toBe(text);
    expect(stringifyBlockYaml(shape)).toBe(text);
    expect(parse(stringifyBlockYaml(shape))).toStrictEqual(parse(reference(shape)));
  });

  it('matches the library on 3000 seeded random objects with undefined leaves', () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const alphabet = [
      'a',
      'b',
      'Z',
      '0',
      '9',
      ' ',
      ' ',
      ':',
      '#',
      '-',
      '"',
      "'",
      ',',
      '.',
      '[',
      '*',
      '\\',
      '\n',
      'é',
      '_',
      '/',
      '?',
      '!',
      '%',
      '&',
      '|',
      '>',
      '@',
      '`',
      '~',
      '\t',
    ];
    const word = () => {
      let out = '';
      for (let length = Math.floor(next() * 12); length > 0; length -= 1) {
        out += alphabet[Math.floor(next() * alphabet.length)];
      }
      return out;
    };
    const scalar = (): unknown => {
      const pick = next();
      if (pick < 0.7) return word();
      if (pick < 0.8) return Math.floor(next() * 2000) - 1000;
      if (pick < 0.85) return Math.round(next() * 1000) / 8;
      if (pick < 0.9) return next() < 0.5;
      if (pick < 0.95) return undefined;
      return null;
    };
    const make = (depth: number): unknown => {
      const pick = next();
      if (depth > 3 || pick < 0.5) return scalar();
      if (pick < 0.75) return Array.from({ length: Math.floor(next() * 4) }, () => make(depth + 1));
      const object: Record<string, unknown> = {};
      for (let count = Math.floor(next() * 4); count > 0; count -= 1) {
        object[next() < 0.8 ? `k${Math.floor(next() * 9)}` : word()] = make(depth + 1);
      }
      return object;
    };
    for (let index = 0; index < 3000; index += 1) {
      const shape = { id: `case-${index}`, omitted: undefined, body: make(0) };
      const text = stringifyBlockYaml(shape);
      const expected = reference(shape);
      expect(text).toBe(expected);
      expect(parse(text)).toStrictEqual(parse(expected));
    }
  });
});

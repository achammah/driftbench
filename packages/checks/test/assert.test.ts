import type { Assertion } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { checkAssertion } from '../src/support/assert';
import { countAllows, describeCount } from '../src/support/count';

describe('assertions: every form the spec allows', () => {
  const cases: Array<[string, Assertion, unknown, unknown]> = [
    ['a bare string', 'fiber-1000', 'fiber-1000', 'fiber-300'],
    ['a bare number', 35, 35, '35'],
    ['a bare boolean', true, true, 'true'],
    ['a bare null', null, null, undefined],
    [
      'exact',
      { exact: { name: 'Jo Okafor', email: 'jo.okafor@example.com' } },
      { email: 'jo.okafor@example.com', name: 'Jo Okafor' },
      { name: 'Jo Okafor' },
    ],
    ['regex, with the m flag', { regex: '^Acmeville$' }, '14 Harbor Road\nAcmeville', 'Acmeville North'],
    [
      'contains, in a string',
      { contains: '88 Summit Avenue' },
      'New customer at 88 Summit Avenue.',
      '88 Summit Av.',
    ],
    ['contains, in a list', { contains: 'fiber-300' }, ['air-5g', 'fiber-300'], ['air-5g']],
    ['one_of', { one_of: ['callback', 'no_coverage'] }, 'no_coverage', 'complaint'],
    ['nonempty', { nonempty: true }, 'Order failed.', ''],
    ['absent', { absent: true }, undefined, null],
    [
      'subset, nested',
      { subset: { customer: { phone: '+12025550131' } } },
      { customer: { phone: '+12025550131', name: 'Pat' }, reason: 'callback' },
      { customer: { phone: '+12025550199' } },
    ],
  ];

  it.each(cases)('%s passes on its target and fails on its mutation', (_form, assertion, good, bad) => {
    expect(checkAssertion(good, assertion).ok).toBe(true);
    expect(checkAssertion(bad, assertion).ok).toBe(false);
  });

  it('describes what each form asks for, and names a pattern that does not compile', () => {
    expect(checkAssertion('x', { one_of: ['a', 'b'] }).expected).toBe('one of ["a","b"]');
    expect(checkAssertion('x', { regex: '(' })).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/^the pattern does not compile/),
    });
  });

  it('nonempty refuses absent, null, an empty string, an empty list and an empty mapping', () => {
    for (const value of [undefined, null, '', [], {}]) {
      expect(checkAssertion(value, { nonempty: true }).ok, JSON.stringify(value)).toBe(false);
    }
    for (const value of [0, false, 'x', [0], { key: 0 }]) {
      expect(checkAssertion(value, { nonempty: true }).ok, JSON.stringify(value)).toBe(true);
    }
  });

  // Core's matchAssertion owns these rules; the check only adds the evidence wording.
  it('nonempty refuses a blank string; core agrees', () => {
    expect(checkAssertion('   ', { nonempty: true }).ok).toBe(false);
  });

  it('nonempty refuses a mapping whose only key holds undefined; core agrees', () => {
    expect(checkAssertion({ key: undefined }, { nonempty: true }).ok).toBe(false);
  });

  // docs/reference/checks.md "Assertions on values": nonempty is "not a mapping whose keys hold nothing", and
  // a key holds nothing when its value is null, a blank string, an empty list or a mapping that holds nothing.
  it('nonempty refuses a mapping whose keys hold nothing: null, blank, empty list or empty mapping, at any depth', () => {
    for (const value of [
      { a: '' },
      { a: '   ' },
      { a: [] },
      { a: {} },
      { a: null },
      { a: '', b: null },
      { a: { b: '', c: [] } },
    ]) {
      expect(checkAssertion(value, { nonempty: true }).ok, JSON.stringify(value)).toBe(false);
    }
  });

  it('nonempty accepts a mapping with one key that holds something, whatever the others hold', () => {
    for (const value of [{ a: '', b: 'x' }, { a: 0 }, { a: false }, { a: { b: '', c: 1 } }, { a: ['x'] }]) {
      expect(checkAssertion(value, { nonempty: true }).ok, JSON.stringify(value)).toBe(true);
    }
  });

  it('equality ignores keys that hold undefined and keeps array order', () => {
    expect(checkAssertion({ a: 1, b: undefined }, { exact: { a: 1 } }).ok).toBe(true);
    expect(checkAssertion([1, 2], { exact: [2, 1] }).ok).toBe(false);
  });
});

describe('counts', () => {
  it('no count means at least one, a number is exact, a range has optional bounds', () => {
    expect([0, 1, 2].map((seen) => countAllows(undefined, seen))).toEqual([false, true, true]);
    expect([0, 1, 2].map((seen) => countAllows(1, seen))).toEqual([false, true, false]);
    expect([0, 1, 2, 3].map((seen) => countAllows({ min: 1, max: 2 }, seen))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect([0, 5].map((seen) => countAllows({ max: 0 }, seen))).toEqual([true, false]);
    expect(countAllows({}, 9)).toBe(true);
  });

  it('reads a count back for evidence', () => {
    expect(
      [undefined, 0, 2, { min: 1 }, { max: 3 }, { min: 1, max: 2 }, { min: 2, max: 2 }, {}].map(
        describeCount,
      ),
    ).toEqual([
      'at least 1',
      'exactly 0',
      'exactly 2',
      'at least 1',
      'at most 3',
      '1 to 2',
      'exactly 2',
      'any number',
    ]);
  });
});

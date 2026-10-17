import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bankMeasure,
  bankSummary,
  defineLadder,
  formatItems,
  formatLadder,
  itemLines,
  readCatchList,
  runLadder,
  runSeeds,
  seedSpecs,
} from '../src/index';
import { bankLadder, plantedLadder } from './support';

describe('bankMeasure', () => {
  it('measures the share of passing entries and names the failing ones with family and tier', () => {
    const measure = bankMeasure([
      { id: 'x', component: 'c', family: 'f', tier: 2, pass: false, detail: 'missed' },
      { id: 'y', component: 'c', family: 'f', tier: 1, pass: true },
    ]);
    expect(measure.value).toBe(0.5);
    expect(measure.items).toEqual([{ id: 'x', component: 'c', detail: 'missed', family: 'f', tier: 2 }]);
    expect(measure.bank).toHaveLength(2);
    expect(bankMeasure([], 'c')).toEqual({
      value: 0,
      items: [{ id: 'bank:empty', component: 'c', detail: 'the level holds no item' }],
      bank: [],
    });
  });
});

describe('items with a family and a tier', () => {
  it('fails a level whose item carries a tier outside 1 to 5', async () => {
    const ladder = defineLadder({
      component: 'tiers',
      levels: [
        {
          id: 'one',
          name: 'one',
          metric: 'a / b',
          threshold: 1,
          compute: () => ({ value: 0, items: [{ id: 'z', component: 'c', detail: 'd', tier: 7 as 1 }] }),
        },
      ],
    });
    const run = await runLadder(ladder, { seed: 1 });
    expect(run.failing?.items[0]?.detail).toBe('the level threw: the item z has tier 7; a tier is 1 to 5');
  });

  it('groups the failing items of the table by family, and prints a list without families flat', async () => {
    const { ladder } = bankLadder([1]);
    const text = formatLadder(await runSeeds(ladder, seedSpecs([1])));
    expect(text).toContain('Validator banked (ladder version 2)');
    expect(text).toContain('    family alpha (1):\n      a3  [tier 3]  [fixture/a]  a3 missed on seed 1.\n');
    expect(
      itemLines([
        { id: 'p', component: 'c', detail: 'd', family: 'beta' },
        { id: 'q', component: 'c', detail: 'e' },
        { id: 'r', component: 'c', detail: 'f', family: 'alpha', tier: 1 },
      ]),
    ).toBe(
      '    family alpha (1):\n      r  [tier 1]  [c]  f\n    family beta (1):\n      p  [c]  d\n    family none (1):\n      q  [c]  e\n',
    );
    expect(itemLines([{ id: 'q', component: 'c', detail: 'e' }])).toBe('    q  [c]  e\n');
  });
});

describe('a full run and the bank summary', () => {
  it('computes the levels above the first failure without changing the level, each level once per seed', async () => {
    const { ladder, calls } = bankLadder([2]);
    const stopping = await runSeeds(ladder, seedSpecs([1, 2]));
    expect(calls).toEqual({ core: 2, deep: 1 });
    const full = await runSeeds(ladder, seedSpecs([1, 2]), undefined, { full: true });
    expect(calls).toEqual({ core: 4, deep: 3 });
    expect(full.seeds.map((run) => run.level)).toEqual(stopping.seeds.map((run) => run.level));
    expect(full.seeds.map((run) => run.failing?.id)).toEqual(['deep', 'core']);
    expect(full.seeds[1]?.rows[1]).toMatchObject({ beyond: true, pass: false, itemCount: 1 });
    expect(full.ladderVersion).toBe(2);
    expect(formatLadder(full)).toContain('0.75 FAIL (1) beyond');
  });

  it('lists every item with its verdict per seed and counts the bank by family and tier', async () => {
    const { ladder } = bankLadder([2]);
    const report = await runSeeds(ladder, seedSpecs([1, 2], { seed: 1_000_042, source: 'head' }), undefined, {
      full: true,
    });
    const summary = bankSummary(report);
    expect(summary.seeds).toEqual(['1', '2', 'hidden']);
    expect(summary.size).toBe(10);
    expect(summary.passing).toBe(8);
    expect(summary.score).toBe(0.8);
    expect(summary.byFamilyTier).toEqual({
      alpha: { '1': 1, '2': 1, '3': 1 },
      beta: { '1': 1, '4': 1, '5': 1 },
      gamma: { '2': 1, '3': 2, '5': 1 },
    });
    expect(summary.failingByFamily).toEqual({ alpha: 1, beta: 0, gamma: 1 });
    expect(summary.rows.find((row) => row.id === 'a3')?.perSeed).toEqual(['pass', 'fail', 'pass']);
    const text = formatItems(summary, 'banked');
    expect(text).toContain('Bank of banked: 10 items in 3 families, 8 pass on every seed (score 0.8).');
    expect(text).toContain(
      'Failing: 2 items, 1 distinct causes (0 items name no cause and count as their own).',
    );
    expect(text).toContain(
      'Family alpha: 3 items, 1 failing, 1 distinct failing causes; per tier 1: 1, 2: 1, 3: 1',
    );
    expect(summary.failingCauses).toBe(1);
    expect(summary.failingCausesByFamily).toEqual({ alpha: 1, beta: 0, gamma: 1 });
    expect(summary.rows.find((row) => row.id === 'a3')?.cause).toBe('the parser drops the last field');
    expect(text).toMatch(/a3\s+3\s+1 core\s+fixture\/a\s+pass\s+FAIL\s+pass/);
    expect(text).toMatch(/g4\s+5\s+2 deep\s+fixture\/g\s+FAIL\s+FAIL\s+FAIL/);
  });

  it('counts a level without a bank as one item of the family "levels", and a level not run as not run', async () => {
    const { ladder } = plantedLadder([1]);
    const summary = bankSummary(await runSeeds(ladder, seedSpecs([1, 2])));
    expect(summary.rows.map((row) => [row.id, row.family, row.perSeed])).toEqual([
      ['first', 'levels', ['pass', 'pass']],
      ['second', 'levels', ['fail', 'pass']],
      ['third', 'levels', ['not run', 'pass']],
    ]);
    expect(summary.passing).toBe(1);
  });
});

describe('catch items', () => {
  const ladderOf = () =>
    defineLadder({
      component: 'roles',
      levels: [
        {
          id: 'one',
          name: 'one',
          metric: 'a / b',
          threshold: 1,
          compute: () =>
            bankMeasure([
              { id: 'h1', component: 'c', family: 'f', tier: 1, cause: 'x', pass: true },
              { id: 'h2', component: 'c', family: 'f', tier: 2, cause: 'y', pass: false, detail: 'missed' },
              // A catch item in the family of the hardness items, and one in a family of its own.
              { id: 'k1', component: 'c', family: 'f', tier: 1, cause: 'z', role: 'catch', pass: true },
              { id: 'k2', component: 'c', family: 'g', tier: 1, cause: 'w', role: 'catch', pass: true },
              {
                id: 'k3',
                component: 'c',
                family: 'g',
                tier: 1,
                cause: 'v',
                role: 'catch',
                pass: false,
                detail: 'd',
              },
            ]),
        },
      ],
    });
  const pinned = new Map([
    ['k1', 'bug:B01'],
    ['k2', 'cheat:c01'],
    ['k3', 'budget:run'],
  ]);

  it('counts pinned catch items apart, also when they share a family with hardness items', async () => {
    const report = await runSeeds(ladderOf(), seedSpecs([1]), undefined, { full: true });
    const summary = bankSummary(report, pinned);
    expect(summary.size).toBe(2);
    expect(summary.passing).toBe(1);
    expect(summary.score).toBe(0.5);
    expect(summary.failingCauses).toBe(1);
    expect(summary.byFamilyTier).toEqual({ f: { '1': 1, '2': 1 } });
    expect(summary.failingByFamily).toEqual({ f: 1 });
    expect(summary.catch).toEqual({ size: 3, passing: 2, failingByFamily: { g: 1 } });
    expect(summary.rows).toHaveLength(5);
    const text = formatItems(summary, 'roles');
    expect(text).toContain('Catch items, counted apart and for no hardness: 3, 2 pass on every seed.');
    const hardBlock = text.slice(text.indexOf('Family f:'), text.indexOf('Catch items of'));
    expect(hardBlock).toContain('h1');
    expect(hardBlock).not.toContain('k1');
    expect(text).toContain('Catch items of f: 1 items, 0 failing');
    expect(text).toContain('Catch items of g: 2 items, 1 failing');
  });

  it('honours role catch only for an id the pinned list holds', async () => {
    const report = await runSeeds(ladderOf(), seedSpecs([1]), undefined, { full: true });
    const none = bankSummary(report);
    expect(none.size).toBe(5);
    expect(none.catch.size).toBe(0);
    const some = bankSummary(report, new Map([['k3', 'budget:run']]));
    expect(some.size).toBe(4);
    expect(some.catch).toEqual({ size: 1, passing: 0, failingByFamily: { g: 1 } });
  });

  it('reads the pinned list from catch.json and refuses an entry that names nothing it guards', () => {
    const root = mkdtempSync(join(tmpdir(), 'catch-'));
    mkdirSync(join(root, 'validators', 'roles'), { recursive: true });
    expect(readCatchList(root, 'roles')).toBeUndefined();
    const write = (value: unknown) =>
      writeFileSync(join(root, 'validators', 'roles', 'catch.json'), JSON.stringify(value));
    write({ items: [{ id: 'k1', guards: 'bug:B01' }] });
    expect(readCatchList(root, 'roles')).toEqual(new Map([['k1', 'bug:B01']]));
    write({ items: [{ id: 'k1', guards: 'it is a guard' }] });
    expect(() => readCatchList(root, 'roles')).toThrow(/items.0.guards/);
    write({
      items: [
        { id: 'k1', guards: 'bug:B01' },
        { id: 'k1', guards: 'bug:B02' },
      ],
    });
    expect(() => readCatchList(root, 'roles')).toThrow(/k1 is listed twice/);
  });
});

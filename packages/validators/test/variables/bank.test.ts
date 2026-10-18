import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registeredLadders } from '../../src/ladders/index';
import { BANK_SET_HASH, OWNER_DATE } from '../../src/ladders/variables/bank/constants';
import { formatProblems } from '../../src/ladders/variables/bank/format';
import { RUNS, runInProcess, variablesBank } from '../../src/ladders/variables/bank/index';
import { FAMILIES, FAMILY_LEVEL, LEVELS, STEMS } from '../../src/ladders/variables/bank/manifest/index';
import { renderCatalogue } from '../../src/ladders/variables/catalogue';
import { VARIABLES_LADDER_VERSION, variablesLadder } from '../../src/ladders/variables/index';
import type { StoreDoc, StoreValue, StoreVariable } from '../../src/ladders/variables/interface';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('the variables bank', () => {
  const bank = variablesBank();

  it('meets the bank minimum of docs/validators.md 12.1', () => {
    expect(bank.length).toBeGreaterThanOrEqual(300);
    expect(new Set(bank.map((item) => item.id)).size).toBe(bank.length);
    const sizes = new Map<string, number>();
    for (const item of bank) sizes.set(item.family, (sizes.get(item.family) ?? 0) + 1);
    expect([...sizes.keys()].sort()).toEqual([...FAMILIES].sort());
    for (const [family, size] of sizes) expect(size, family).toBeGreaterThanOrEqual(20);
    expect(new Set(bank.map((item) => item.tier))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(bank.map((item) => item.level))).toEqual(new Set(LEVELS));
  });

  it('names a cause and a real component for every item, and a check for every stem', () => {
    for (const stem of STEMS) {
      expect(typeof RUNS[stem.id], stem.id).toBe('function');
      expect(stem.cause.trim().length, stem.id).toBeGreaterThan(10);
      expect(stem.variants.length, stem.id).toBeGreaterThan(0);
    }
    for (const item of bank) {
      expect(item.cause, item.id).toBeTruthy();
      expect(FAMILY_LEVEL[item.family as keyof typeof FAMILY_LEVEL], item.id).toBe(item.level);
    }
    expect(Object.keys(RUNS).sort()).toEqual(STEMS.map((s) => s.id).sort());
  });

  it('has at least 100 candidate cause labels (independence requires the pending audit)', () => {
    expect(new Set(bank.map((item) => item.cause)).size).toBeGreaterThanOrEqual(100);
  });

  it('keeps the committed catalogue in step with the manifest', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../src/ladders/variables/interface.ts', import.meta.url)),
      'utf8',
    );
    const committed = readFileSync(`${ROOT}validators/variables/CATALOGUE.md`, 'utf8');
    expect(committed).toBe(renderCatalogue(text));
  });
});

describe('the variables ladder', () => {
  it('is registered as variables with seven levels', () => {
    const ladder = registeredLadders().variables;
    expect(ladder?.component).toBe('variables');
    expect(ladder?.version).toBe(VARIABLES_LADDER_VERSION);
    expect(ladder?.levels.map((level) => level.id)).toEqual([...LEVELS]);
    expect(ladder?.levels.every((level) => level.threshold === 1)).toBe(true);
  });

  it('fails every item, by name, while no function is provided (the roadmap)', async () => {
    const items = variablesBank()
      .filter((item) => item.tier <= 2)
      .slice(0, 60);
    const run = await runInProcess(items, 1, ROOT, {});
    for (const item of items) {
      const outcome = run.get(item.id);
      expect(outcome?.pass, item.id).toBe(false);
      expect(outcome?.detail, item.id).toMatch(/(buildStore|plan|coverage|weightInterval) is not provided/);
    }
  });

  it('stops at the first failing level and lists the bank of every level with a full run', async () => {
    const ladder = variablesLadder({ impl: {}, filter: (item) => item.tier === 1 });
    const { runLadder } = await import('../../src/ladder');
    const run = await runLadder(ladder, { seed: 1, root: ROOT, full: true });
    expect(run.level).toBe(0);
    expect(run.failing?.id).toBe('store');
    expect(run.rows.every((row) => row.pass !== null)).toBe(true);
  });
});

describe('the store format check', () => {
  const good = (): StoreDoc => ({
    variables: [
      {
        id: 'shipment_days_late',
        values: [
          {
            id: 'under_two_days',
            weight: 60,
            provenance: [{ kind: 'conversations', count: 120, total: 200, set_hash: BANK_SET_HASH }],
          },
          {
            id: 'more_than_two_days',
            weight: 40,
            provenance: [{ kind: 'owner', words: 'About two in five.', date: OWNER_DATE }],
          },
        ],
      },
    ],
    impossible: [],
    rules: [],
    refused: [],
  });

  it('accepts a store that keeps the format', () => {
    expect(formatProblems(good())).toEqual([]);
  });

  const variable = (s: StoreDoc): StoreVariable => s.variables[0] as StoreVariable;
  const value = (s: StoreDoc, i: number): StoreValue => variable(s).values[i] as StoreValue;
  const conv = (count: number, total: number, hash: string): StoreValue['provenance'] => [
    { kind: 'conversations', count, total, set_hash: hash },
  ];

  it.each<[string, (s: StoreDoc) => void, RegExp]>([
    [
      'a bad variable id',
      (s) => {
        variable(s).id = '-bad';
      },
      /does not match/,
    ],
    [
      'weights on some values only',
      (s) => {
        delete value(s, 1).weight;
      },
      /weighs 1 of its 2/,
    ],
    [
      'all weights 0',
      (s) => {
        for (const v of variable(s).values) v.weight = 0;
      },
      /every weight/,
    ],
    [
      'a negative weight',
      (s) => {
        value(s, 0).weight = -1;
      },
      /not a finite number from 0/,
    ],
    [
      'a count above the total',
      (s) => {
        value(s, 0).provenance = conv(3, 2, BANK_SET_HASH);
      },
      /above the total/,
    ],
    [
      'a short set_hash',
      (s) => {
        value(s, 0).provenance = conv(1, 2, 'abc');
      },
      /64 lowercase/,
    ],
    [
      'an unreal owner day',
      (s) => {
        value(s, 1).provenance = [{ kind: 'owner', words: 'x', date: '2026-02-30' }];
      },
      /real day/,
    ],
    [
      'an absolute quote path',
      (s) => {
        value(s, 0).provenance = [{ kind: 'quote', path: '/etc/hosts', quote: 'x' }];
      },
      /relative path/,
    ],
    [
      'a pair naming a value the store lacks',
      (s) => {
        s.impossible.push({
          a: { variable: 'shipment_days_late', value: 'nope' },
          b: { variable: 'shipment_days_late', value: 'under_two_days' },
          provenance: [],
        });
      },
      /lacks/,
    ],
  ])('refuses %s', (_name, change, pattern) => {
    const store = good();
    change(store);
    expect(formatProblems(store).join(' ')).toMatch(pattern);
  });
});

import { describe, expect, it } from 'vitest';
import { BANK_MIN_FAMILY, BANK_MIN_SIZE } from '../../src/hardness';
import { registeredLadders } from '../../src/ladders/index';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { pointerLadder } from '../../src/ladders/pointer/index';

const FAMILIES = [
  'cutting',
  'ids',
  're-anchoring',
  'grouping',
  'labels',
  'replay',
  'privacy',
  'links',
  'radius',
  'scale',
  'adversarial',
];

describe('the pointer bank', () => {
  const bank = pointerBank();

  it('holds the size the contract asks for', () => {
    expect(bank.length).toBeGreaterThanOrEqual(Math.max(300, BANK_MIN_SIZE));
  });

  it('holds every family, none under the family floor', () => {
    for (const family of FAMILIES) {
      const n = bank.filter((i) => i.family === family).length;
      expect(n, family).toBeGreaterThanOrEqual(Math.max(20, BANK_MIN_FAMILY));
    }
    expect(new Set(bank.map((i) => i.family))).toEqual(new Set(FAMILIES));
  });

  it('holds all five tiers', () => {
    expect(new Set(bank.map((i) => i.tier))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('names each item <family>.<key>, once', () => {
    expect(new Set(bank.map((i) => i.id)).size).toBe(bank.length);
    for (const item of bank) expect(item.id.startsWith(`${item.family}.`), item.id).toBe(true);
  });

  it('gives each item a cause of the form <component>:<change>', () => {
    for (const item of bank) expect(item.cause, item.id).toMatch(/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/);
  });

  it('holds more than 110 declared cause tags (independent fix audit pending)', () => {
    expect(new Set(bank.map((i) => i.cause)).size).toBeGreaterThan(110);
  });

  it('has a runner for every item', async () => {
    for (const item of bank) expect(item.run, item.id).toBeTypeOf('function');
  });

  it('is registered as the pointer validator', () => {
    expect(registeredLadders().pointer?.component).toBe('pointer');
    expect(pointerLadder().component).toBe('pointer');
  });
});

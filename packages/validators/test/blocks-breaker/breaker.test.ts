import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runItem } from '../../src/ladders/blocks/bank';
import { CHEATERS, realProduct } from '../../src/ladders/blocks/index';
import { breakerItems } from '../../src/ladders/blocks-breaker/index';

/**
 * The breaker bank (breaker-items.md): its shape, and that no item survives a cheating product of its level. The
 * whole bank runs in under a minute, so every item is checked, not a sample.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const items = breakerItems();
const scratches: string[] = [];
afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
});

describe('the breaker bank', () => {
  it('has unique ids, a cause and a contract for every item, and no family under 20 items', () => {
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const item of items) {
      expect(item.cause.trim(), item.id).not.toBe('');
      expect(item.contract, item.id).toMatch(/^docs\//);
    }
    const families = new Map<string, number>();
    for (const item of items) families.set(item.family, (families.get(item.family) ?? 0) + 1);
    for (const [family, count] of families) expect(count, family).toBeGreaterThanOrEqual(20);
  });

  it('holds at least 150 items and 40 distinct causes', () => {
    expect(items.length).toBeGreaterThanOrEqual(150);
    expect(new Set(items.map((item) => item.cause)).size).toBeGreaterThanOrEqual(40);
  });

  it('keeps every cause to at most 25 items', () => {
    const per = new Map<string, number>();
    for (const item of items) per.set(item.cause, (per.get(item.cause) ?? 0) + 1);
    for (const [cause, count] of per) expect(count, cause).toBeLessThanOrEqual(25);
  });
});

describe('every breaker item fails on a cheating product of its level', () => {
  const real = realProduct();
  it('leaves no survivor', { timeout: 900_000 }, async () => {
    const survivors: string[] = [];
    for (const item of items) {
      let caught = false;
      for (const cheater of CHEATERS.filter((each) => each.levels.includes(item.level))) {
        const scratch = mkdtempSync(join(tmpdir(), 'breaker-test-'));
        scratches.push(scratch);
        const result = await runItem(item, 1, ROOT, scratch, cheater.make(real));
        if (!result.pass) {
          caught = true;
          break;
        }
      }
      if (!caught) survivors.push(item.id);
    }
    expect(survivors).toEqual([]);
  });
});

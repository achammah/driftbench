import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parentCycles, parentIndexes, runOrder } from '../src/spec/parents';

// Fictional data only. A support conversation whose later blocks depend on earlier ones.
const target = { adapter: 'function', agent: 'acme-sales' };

function load(blocks: Record<string, unknown>[]) {
  const result = validateSpec({ id: 'parents', target, blocks });
  const issues = result.ok ? [] : result.errors;
  return { result, codes: issues.map((issue) => `${issue.code} ${issue.path}`) };
}

const ask = (id: string | undefined, parent?: string | number): Record<string, unknown> => ({
  ...(id === undefined ? {} : { id }),
  ...(parent === undefined ? {} : { parent }),
  user: `Question ${id ?? 'anonymous'}`,
  expect: { must: ['.'] },
});

describe('block parents', () => {
  it('loads a parent written as a block id or as a position, and a forest of two trees', () => {
    const { result, codes } = load([ask('plan'), ask('upgrade', 'plan'), ask('other'), ask('cancel', 2)]);
    expect(codes).toEqual([]);
    expect(result.ok && result.spec.blocks.map((block) => block.parent)).toEqual([
      undefined,
      'plan',
      undefined,
      2,
    ]);
    expect(result.ok && parentIndexes(result.spec)).toEqual([undefined, 0, undefined, 2]);
  });

  it('refuses a parent that names no block with PARENT_MISSING', () => {
    expect(load([ask('a'), ask('b', 'nobody')]).codes).toEqual(['PARENT_MISSING blocks.1.parent']);
    expect(load([ask('a'), ask('b', 7)]).codes).toEqual(['PARENT_MISSING blocks.1.parent']);
    expect(load([ask(undefined, 'a')]).codes).toEqual(['PARENT_MISSING blocks.0.parent']);
  });

  it('refuses links that loop with PARENT_CYCLE, once per cycle', () => {
    expect(load([ask('a', 'a')]).codes).toEqual(['PARENT_CYCLE blocks.0.parent']);
    expect(load([ask('a', 'b'), ask('b', 'a')]).codes).toEqual(['PARENT_CYCLE blocks.0.parent']);
    expect(load([ask('root'), ask('a', 'c'), ask('b', 'a'), ask('c', 'b')]).codes).toEqual([
      'PARENT_CYCLE blocks.1.parent',
    ]);
    expect(load([ask('a', 'b'), ask('b', 'a'), ask('c', 'd'), ask('d', 'c')]).codes).toEqual([
      'PARENT_CYCLE blocks.0.parent',
      'PARENT_CYCLE blocks.2.parent',
    ]);
  });

  it('orders a run so that each child follows its parent, and keeps the written order otherwise', () => {
    const order = (blocks: Record<string, unknown>[]) => {
      const { result } = load(blocks);
      if (!result.ok) throw new Error('invalid');
      return { order: runOrder(result.spec), cycles: parentCycles(result.spec) };
    };
    expect(order([ask('a'), ask('b', 'a'), ask('c', 'b')]).order).toEqual([0, 1, 2]);
    expect(order([ask('c', 'b'), ask('a'), ask('b', 'a')]).order).toEqual([1, 2, 0]);
    expect(order([ask('a'), ask('b'), ask('c', 'a')]).order).toEqual([0, 1, 2]);
    expect(order([ask('a', 'z'), ask('b'), ask('z')]).order).toEqual([2, 0, 1]);
  });
});

import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

// Fictional data only: a bike shop booking in three steps.
const target = { adapter: 'function', agent: 'acme-bikes' };
const block = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user: `say ${id}`,
  expect: { must: [id] },
  ...extra,
});
const load = (blocks: unknown[]) => validateSpec({ id: 'parents', target, blocks });
const codes = (loaded: ReturnType<typeof load>) => (loaded.ok ? [] : loaded.errors.map((e) => e.code));

describe('parent links', () => {
  it('load, forward references included', () => {
    expect(
      load([block('lookup', { parent: 'find' }), block('find'), block('book', { parent: 'lookup' })]).ok,
    ).toBe(true);
  });

  it('refuse a parent that is the id of no block with PARENT_MISSING', () => {
    expect(codes(load([block('find'), block('lookup', { parent: 'nowhere' })]))).toEqual(['PARENT_MISSING']);
  });

  it('refuse a cycle, and a block that is its own parent, with PARENT_CYCLE', () => {
    expect(codes(load([block('a', { parent: 'b' }), block('b', { parent: 'a' })]))).toEqual(['PARENT_CYCLE']);
    expect(codes(load([block('a', { parent: 'a' })]))).toEqual(['PARENT_CYCLE']);
  });
});

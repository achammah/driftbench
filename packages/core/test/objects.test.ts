import { DEFAULT_CHECK_SET, initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import {
  blockCheckSet,
  resolveCheckSet,
  shippedObject,
  specHash,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';

// Fictional data only: a bike shop spec that tailors its checks.
beforeAll(() => initializeShippedObjects());

const load = (uses: unknown, level: 'spec' | 'block' = 'spec') => {
  const raw =
    level === 'spec'
      ? { id: 'bikes', uses: { check_set: uses }, blocks: [{ user: 'Which bike?' }] }
      : { id: 'bikes', blocks: [{ user: 'Which bike?', uses: { check_set: uses } }] };
  const result = validateSpec(raw);
  return result.ok ? [] : result.errors.map((issue) => issue.code);
};

describe('the shipped check set', () => {
  it('is registered with one item per machine check and its builtin implementation', () => {
    const shipped = shippedObject('check_set', 'default');
    expect(shipped?.items.map((item) => item.id)).toEqual(DEFAULT_CHECK_SET.items.map((item) => item.id));
    expect(shipped?.items.find((item) => item.id === 'must')).toMatchObject({
      impl: 'builtin:check/must',
      effect: { gating: true },
    });
  });
});

describe('uses.check_set', () => {
  for (const level of ['spec', 'block'] as const) {
    describe(`at the ${level} layer`, () => {
      it('loads a plain name, an item switched off, an item moved and a full order', () => {
        const ids = DEFAULT_CHECK_SET.items.map((item) => item.id);
        expect(load('default', level)).toEqual([]);
        expect(load({ extends: 'default', items: [{ id: 'tools', enabled: false }] }, level)).toEqual([]);
        expect(load({ extends: 'default', items: [{ id: 'must', before: 'stage' }] }, level)).toEqual([]);
        expect(load({ extends: 'default', order: [...ids].reverse() }, level)).toEqual([]);
      });

      it('refuses what no shipped object defines, each with its code', () => {
        expect(load('Default', level)).toEqual(['OBJECT_UNKNOWN']);
        expect(load({ extends: 'missing', items: [] }, level)).toEqual(['OBJECT_UNKNOWN']);
        expect(
          load({ extends: 'default', items: [{ id: 'must', impl: 'builtin:checks/tools-count' }] }, level),
        ).toEqual(['OBJECT_IMPL_UNKNOWN']);
        expect(load({ extends: 'default', items: [{ id: 'retry_budget', enabled: true }] }, level)).toEqual([
          'OBJECT_ITEM_UNKNOWN',
        ]);
        expect(load({ extends: 'default', items: [{ id: 'must_nots', enabled: false }] }, level)).toEqual([
          'OBJECT_ITEM_UNKNOWN',
        ]);
        const complete = { when: {}, effect: { gating: true }, impl: 'builtin:check/forbidden' };
        expect(
          load(
            { extends: 'default', items: [{ id: 'forbidden', add: true, title: 'Again', ...complete }] },
            level,
          ),
        ).toEqual(['OBJECT_ITEM_EXISTS']);
        expect(
          load({ extends: 'default', items: [{ id: 'slow_reply', add: true, title: 'A new check' }] }, level),
        ).toEqual(['OBJECT_ITEM_INCOMPLETE']);
      });

      it('refuses an order that misses an item and an order beside a move', () => {
        const ids = DEFAULT_CHECK_SET.items.map((item) => item.id);
        expect(load({ extends: 'default', order: ids.slice(1) }, level)).toEqual(['OBJECT_ORDER_INVALID']);
        expect(
          load({ extends: 'default', order: ids, items: [{ id: 'must', before: 'stage' }] }, level),
        ).toEqual(['OBJECT_ORDER_INVALID']);
      });
    });
  }

  it('lets a block layer change what the spec layer added, and names the layer of each item', () => {
    const spec = {
      uses: {
        check_set: {
          extends: 'default',
          items: [
            {
              id: 'slow_reply',
              add: true,
              when: {},
              effect: { gating: false },
              impl: 'builtin:check/length',
            },
          ],
        },
      },
      blocks: [
        { when: { user: 'hi' }, uses: { check_set: { items: [{ id: 'slow_reply', enabled: false }] } } },
      ],
    } as never;
    const { set, issues } = blockCheckSet(spec, 0);
    expect(issues).toEqual([]);
    expect(set?.items.find((item) => item.id === 'slow_reply')).toMatchObject({
      enabled: false,
      layer: 'block',
    });
    expect(set?.items.find((item) => item.id === 'must')).toMatchObject({ layer: 'shipped' });
    expect(set?.name).toMatch(/^check_set:default@[0-9a-f]{8}$/);
  });

  it('gives each tailored set its own hash', () => {
    const a = resolveCheckSet(
      { items: [{ id: 'tools', enabled: false }] },
      undefined,
      'spec',
      'uses.check_set',
    );
    const b = resolveCheckSet('default', undefined, 'spec', 'uses.check_set');
    expect(a.ok && b.ok && a.set.name !== b.set.name).toBe(true);
  });
});

describe('uses and the hashes', () => {
  it('is part of the spec hash', () => {
    const plain = validateSpec({ id: 'bikes', blocks: [{ user: 'hi' }] });
    const used = validateSpec({ id: 'bikes', uses: { check_set: 'default' }, blocks: [{ user: 'hi' }] });
    expect(plain.ok && used.ok && specHash(plain.spec) !== specHash(used.spec)).toBe(true);
  });
});

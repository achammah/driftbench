import { describe, expect, it } from 'vitest';
import { ObjectRegistry, ObjectStore } from '../../src/objects';

const ANY = { safeParse: (value: unknown) => ({ success: true, data: value }) } as never;

describe('ObjectRegistry snapshot and restore', () => {
  it('forgets every kind, implementation and shipped object registered after the snapshot', () => {
    const registry = new ObjectRegistry();
    registry.registerKind({ kind: 'check-set', summary: 'Checks.', agentFacing: false });
    registry.registerImpl('builtin:keep', { params: ANY });
    const before = registry.snapshot();
    registry.registerKind({ kind: 'policy/routing', summary: 'Routing.', agentFacing: false });
    registry.registerImpl('plugin:route', { params: ANY });
    registry.registerShipped(
      { kind: 'check-set', id: 'plugin', items: [{ id: 'a', title: 'A', impl: 'plugin:route' }] },
      'plugin.yaml',
    );
    expect(new ObjectStore(registry).resolve('check-set', 'plugin').items).toHaveLength(1);

    registry.restore(before);
    expect(registry.kinds().map((def) => def.kind)).toEqual(['check-set']);
    expect(registry.impls()).toEqual(['builtin:keep']);
    expect(registry.shipped()).toEqual([]);
    expect(new ObjectStore(registry).has('check-set', 'plugin')).toBe(false);
    // What was forgotten can be registered again, as a new run of the same plugin does.
    registry.registerKind({ kind: 'policy/routing', summary: 'Routing.', agentFacing: false });
  });

  it('keeps its copy apart: registrations after the snapshot never reach it', () => {
    const registry = new ObjectRegistry();
    const empty = registry.snapshot();
    registry.registerImpl('plugin:late', { params: ANY });
    expect(empty.impls.size).toBe(0);
    registry.restore(empty);
    registry.restore(empty);
    expect(registry.impls()).toEqual([]);
  });
});

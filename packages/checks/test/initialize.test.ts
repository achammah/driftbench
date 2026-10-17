import { afterEach, describe, expect, it } from 'vitest';
import { objectRegistry } from '../../core/src/objects/resolve';

const initial = objectRegistry.snapshot();
afterEach(() => objectRegistry.restore(initial));

describe('explicit shipped-object initialization', () => {
  it('importing core leaves the registry unchanged', async () => {
    await import('@agent-nexus/driftbench-core');
    expect([...objectRegistry.snapshot().impls.keys()]).toEqual([...initial.impls.keys()]);
  });

  it('importing checks leaves the registry unchanged', async () => {
    await import('../src/index');
    expect([...objectRegistry.snapshot().impls.keys()]).toEqual([...initial.impls.keys()]);
    expect([...objectRegistry.snapshot().shipped.keys()]).toEqual([...initial.shipped.keys()]);
  });

  it('initializes the check set idempotently, including after registry restore', async () => {
    const { initializeShippedObjects } = await import('../src/index');
    const { shippedObjectContext } = await import('@agent-nexus/driftbench-core');
    for (let attempt = 0; attempt < 2; attempt++) {
      initializeShippedObjects();
      initializeShippedObjects();
      const policy = shippedObjectContext().store.resolve('policy/value-check', 'default');
      expect(policy.items.some((item) => item.id === 'rung1_outcome')).toBe(true);
      const object = shippedObjectContext().store.resolve('check-set', 'default');
      expect(object.items.some((item) => item.impl === 'builtin:runner/flow')).toBe(true);
      expect(object.items.some((item) => item.impl === 'builtin:runner/ledger')).toBe(true);
      expect(object.items.some((item) => item.impl === 'builtin:check/tools')).toBe(true);
      expect(objectRegistry.snapshot().shipped.has('check-set:default')).toBe(true);
      objectRegistry.restore(initial);
    }
  });

  it('defaultChecks initializes before the caller loads a spec', async () => {
    const { defaultChecks } = await import('../src/index');
    const { shippedObjectContext } = await import('@agent-nexus/driftbench-core');
    defaultChecks();
    expect(shippedObjectContext().store.resolve('check-set', 'default').id).toBe('default');
  });
});

import { describe, expect, it, vi } from 'vitest';

// Model a built package without the reviewed YAML fixtures.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    readFileSync: ((path: unknown, ...args: unknown[]) => {
      if (String(path).includes('/objects/') && String(path).endsWith('.yaml')) {
        throw new Error('shipped YAML is absent from the package');
      }
      return Reflect.apply(fs.readFileSync, fs, [path, ...args]);
    }) as typeof fs.readFileSync,
  };
});

describe('shipped objects need no filesystem data', () => {
  it('loads checks and resolves blame and placement without YAML reads', async () => {
    const { blame } = await import('../../src');
    expect(blame.shippedPolicy('policy/blame').items).toHaveLength(32);
    expect(blame.shippedPolicy('policy/placement').items).toHaveLength(13);
    expect(Object.keys(blame.SHIPPED_DIAGNOSTICS)).toHaveLength(5);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadReaderExports } from '../../src/ladders/pointer/sut/reader';

const moduleExports = () => ({
  AtomBuilder: class {},
  pointer: {
    AGENT_RULES_SET: 'labels: []',
    Cassette: {},
    cut: () => {},
    LabelerError: Error,
    buildLabelling: () => {},
    singleLabelling: () => {},
    denseOpinions: () => {},
    parseDenseAnswer: () => {},
    parseLabelSets: () => {},
    parseLedger: () => {},
    renderLedger: () => {},
    setHash: () => {},
    pointerScan: () => {},
    pointerAtoms: () => {},
  },
});

afterEach(() => vi.useRealTimers());

describe('real-reader baseline preflight', () => {
  it('rejects a missing module with the original loading reason', async () => {
    vi.useFakeTimers();
    await expect(
      loadReaderExports(async () => {
        throw new Error('ERR_MODULE_NOT_FOUND fixture');
      }),
    ).rejects.toThrow('cannot be loaded (ERR_MODULE_NOT_FOUND fixture)');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an estate package without the pointer namespace immediately', async () => {
    vi.useFakeTimers();
    await expect(loadReaderExports(async () => ({ AtomBuilder: class {} }))).rejects.toThrow(
      'does not export AGENT_RULES_SET',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('names a missing required export instead of accepting a partial reader', async () => {
    const mod: { AtomBuilder: unknown; pointer: Record<string, unknown> } = moduleExports();
    delete mod.pointer.pointerScan;
    await expect(loadReaderExports(async () => mod)).rejects.toThrow('does not export pointerScan');
  });

  it('accepts and preserves the actual module exports', async () => {
    vi.useFakeTimers();
    const mod = moduleExports();
    const reader = await loadReaderExports(async () => mod);
    expect(reader.cut).toBe(mod.pointer.cut);
    expect(reader.pointerScan).toBe(mod.pointer.pointerScan);
    expect(reader.AtomBuilder).toBe(mod.AtomBuilder);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a never-settling import before any item can wait 180 seconds', async () => {
    vi.useFakeTimers();
    const pending = loadReaderExports(() => new Promise(() => {}), 100);
    let failure: unknown;
    const observed = pending.catch((error: unknown) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('import did not settle within 100 ms');
    await observed;
    expect(vi.getTimerCount()).toBe(0);
  });
});

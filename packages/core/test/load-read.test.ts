import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';

// The loader's file reads, counted by kind, around the real implementations.
const reads = vi.hoisted(() => ({ sync: 0, async: 0 }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      reads.sync += 1;
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      reads.async += 1;
      return (actual.readFile as (...rest: unknown[]) => void)(...args);
    }) as typeof actual.readFile,
  };
});

const SPEC = `id: desk-booking
title: A colleague books a meeting room
blocks:
  - user: Book the small room for Tuesday at ten.
    expect:
      stage: confirm
`;

describe('loadSpecFile reads a spec file in one synchronous call', () => {
  it('reads the file once, on the calling thread, and parses it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'driftbench-load-read-'));
    const path = join(dir, 'desk-booking.yaml');
    writeFileSync(path, SPEC);
    reads.sync = 0;
    reads.async = 0;
    const loaded = await loadSpecFile(path);
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.spec.id).toBe('desk-booking');
    expect(reads).toEqual({ sync: 1, async: 0 });
  });

  it('reports a file it cannot read as a parse error, as before', async () => {
    const loaded = await loadSpecFile(join(tmpdir(), 'driftbench-no-such-folder', 'missing.yaml'));
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.errors[0]?.code).toBe('SPEC_PARSE');
    expect(!loaded.ok && loaded.errors[0]?.message).toMatch(/^cannot read the file: /);
  });
});

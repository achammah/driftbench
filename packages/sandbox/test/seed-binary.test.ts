import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type LocalSandbox, localProvider, SandboxPathError } from '@agent-nexus/driftbench-sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Fictional data only: a workbook, a text file with a byte-order mark.
let parent: string;
beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-binary-test-')));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe('a workspace seed with binary files', () => {
  it('writes workspace.binary byte for byte, a byte-order mark included', async () => {
    const box = (await localProvider({ dir: join(parent, 'boxes') }).create({})) as LocalSandbox;
    try {
      const book = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80]);
      const csv = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n1,2\n', 'utf8')]);
      await box.seed({
        files: { 'notes.txt': '﻿hello' },
        binary: { 'data/books.xlsx': book.toString('base64'), 'rates.csv': csv.toString('base64') },
      });
      expect(Buffer.compare(await readFile(join(box.root, 'data/books.xlsx')), book)).toBe(0);
      expect(Buffer.compare(await readFile(join(box.root, 'rates.csv')), csv)).toBe(0);
      expect((await readFile(join(box.root, 'notes.txt'))).subarray(0, 3)).toEqual(
        Buffer.from([0xef, 0xbb, 0xbf]),
      );
    } finally {
      await box.destroy();
    }
  });

  it('applies the sandbox path rules to a binary path', async () => {
    const box = (await localProvider({ dir: join(parent, 'boxes') }).create({})) as LocalSandbox;
    try {
      await expect(box.seed({ binary: { '../escape.bin': 'AAAA' } })).rejects.toBeInstanceOf(
        SandboxPathError,
      );
    } finally {
      await box.destroy();
    }
  });
});

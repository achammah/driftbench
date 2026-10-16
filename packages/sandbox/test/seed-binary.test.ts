import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type LocalSandbox, localProvider, SandboxPathError } from '@agent-nexus/driftbench-sandbox';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/** Fictional bytes: a PDF head with a NUL and 0xff, and a csv that starts with a byte-order mark. */
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0xff, 0xfe, 0x80]);
const BOM_CSV = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('plan,price\nS,15\n')]);
const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte));

let parent: string;
const opened: LocalSandbox[] = [];

beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-seed-binary-')));
});
afterEach(async () => {
  for (let box = opened.pop(); box !== undefined; box = opened.pop()) await box.destroy();
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function sandbox(): Promise<LocalSandbox> {
  const box = (await localProvider({ dir: join(parent, 'boxes') }).create({})) as LocalSandbox;
  opened.push(box);
  return box;
}

describe('seeding workspace.binary', () => {
  it('writes each file byte for byte from its base64, nested paths included', async () => {
    const box = await sandbox();
    await box.seed({
      binary: {
        'in/report.pdf': PDF.toString('base64'),
        'in/deep/all.bin': ALL_BYTES.toString('base64'),
        'empty.bin': '',
      },
    });
    expect(Buffer.compare(await readFile(join(box.root, 'in', 'report.pdf')), PDF)).toBe(0);
    expect(Buffer.compare(await readFile(join(box.root, 'in', 'deep', 'all.bin')), ALL_BYTES)).toBe(0);
    expect((await readFile(join(box.root, 'empty.bin'))).length).toBe(0);
  });

  it('keeps the byte-order mark of a text file', async () => {
    const box = await sandbox();
    await box.seed({ binary: { 'plans.csv': BOM_CSV.toString('base64') } });
    const read = await readFile(join(box.root, 'plans.csv'));
    expect([...read.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(Buffer.compare(read, BOM_CSV)).toBe(0);
  });

  it('writes binary files beside text files, and refuses a path that leaves the workspace', async () => {
    const box = await sandbox();
    await box.seed({ files: { 'a.txt': 'text' }, binary: { 'b.bin': PDF.toString('base64') } });
    expect(await readFile(join(box.root, 'a.txt'), 'utf8')).toBe('text');
    expect(Buffer.compare(await readFile(join(box.root, 'b.bin')), PDF)).toBe(0);
    await expect(box.seed({ binary: { '../escape.bin': PDF.toString('base64') } })).rejects.toBeInstanceOf(
      SandboxPathError,
    );
  });
});

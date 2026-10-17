import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { removeTempFolders, trackedTempFolders } from './vitest-temp-folders';

it('removes a folder made with mkdtemp or mkdtempSync, with its content', async () => {
  const asynchronous = await mkdtemp(join(tmpdir(), 'driftbench-probe-'));
  const synchronous = mkdtempSync(join(tmpdir(), 'driftbench-probe-'));
  await mkdir(join(asynchronous, 'deep'), { recursive: true });
  await writeFile(join(asynchronous, 'deep', 'file.txt'), 'content');
  expect(trackedTempFolders()).toEqual(expect.arrayContaining([asynchronous, synchronous]));
  // The folders stay until the file ends, or until the cleanup runs.
  expect(existsSync(join(asynchronous, 'deep', 'file.txt'))).toBe(true);
  expect(removeTempFolders()).toBeGreaterThanOrEqual(2);
  expect(existsSync(asynchronous)).toBe(false);
  expect(existsSync(synchronous)).toBe(false);
  expect(trackedTempFolders()).toEqual([]);
});

it('removes a folder whose test threw', async () => {
  let made = '';
  await expect(
    (async () => {
      made = await mkdtemp(join(tmpdir(), 'driftbench-probe-'));
      throw new Error('the test failed after making its folder');
    })(),
  ).rejects.toThrow('the test failed');
  expect(existsSync(made)).toBe(true);
  removeTempFolders();
  expect(existsSync(made)).toBe(false);
});

it('leaves a folder alone that was made outside the temporary folder', async () => {
  const home = await mkdtemp(join(tmpdir(), 'driftbench-probe-'));
  const inside = await mkdtemp(join(home, 'nested-'));
  // A folder under another folder is removed with its parent; it is not recorded on its own.
  expect(trackedTempFolders()).toContain(home);
  expect(trackedTempFolders()).not.toContain(inside);
  removeTempFolders();
  expect(existsSync(inside)).toBe(false);
});

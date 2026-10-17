import fs, { realpathSync, rmSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterAll } from 'vitest';

/**
 * Keeps the machine's temporary folder clean after a test run. A test file makes its fixtures with
 * `mkdtemp(join(tmpdir(), ...))` and most never remove them; thousands of runs left tens of thousands of
 * folders. This setup file (listed in `vitest.config.ts`) records every folder the test process makes
 * directly in the temporary folder and removes them all when the test file ends, and again when the
 * process exits. It changes nothing a test can observe while it runs: the folder exists until the file ends.
 *
 * Only the folder a call made is removed, and only one made directly under the temporary folder. A folder
 * made elsewhere (a test that names its own base) is left to its test. A child process the tests start is
 * not covered here: product code removes its own folders (see the claude clients and the sandbox).
 */
const MARK = Symbol.for('driftbench.vitest-temp-folders');
type State = { made: Set<string>; base: Set<string> };

function state(): State {
  const holder = globalThis as Record<symbol, State | undefined>;
  const existing = holder[MARK];
  if (existing) return existing;
  const made = new Set<string>();
  const base = new Set<string>();
  const root = tmpdir();
  base.add(resolve(root));
  try {
    base.add(realpathSync(root));
  } catch {
    // The temporary folder is the one the process was given; its real path is only a second spelling.
  }
  const record = (folder: string) => {
    const where = resolve(dirname(folder));
    if (base.has(where)) made.add(resolve(folder));
    return folder;
  };
  const sync = fs.mkdtempSync.bind(fs);
  const asynchronous = fsp.mkdtemp.bind(fsp);
  fs.mkdtempSync = ((...args: Parameters<typeof fs.mkdtempSync>) =>
    record(sync(...args) as string)) as typeof fs.mkdtempSync;
  fsp.mkdtemp = (async (...args: Parameters<typeof fsp.mkdtemp>) =>
    record((await asynchronous(...args)) as string)) as typeof fsp.mkdtemp;
  syncBuiltinESMExports();
  const next = { made, base };
  holder[MARK] = next;
  process.on('exit', () => removeTempFolders());
  return next;
}

/** Removes every folder recorded so far. A folder already gone, or one that cannot be removed, is skipped. */
export function removeTempFolders(): number {
  const { made } = state();
  let removed = 0;
  for (const folder of made) {
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
      removed++;
    } catch {
      // Best effort: a locked folder is the operating system's to clear.
    }
  }
  made.clear();
  return removed;
}

/** The folders recorded and not yet removed. */
export function trackedTempFolders(): string[] {
  return [...state().made];
}

state();
afterAll(() => {
  removeTempFolders();
});

import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The bank's child process refuses file and process access to the statistics package while it runs an item
 * (docs/validators.md section 12.7, the cheater check). A statistics function takes numbers and returns numbers;
 * the cheater audit raised the score of a bank by letting the package read the file that holds the expected
 * values. The trap wraps the calls that read a file, list a folder or start a process: when the call stack holds
 * a file of the package under test, the call throws and the item fails with the reason. A call from the
 * validator itself (it reads its fixtures) is untouched.
 *
 * This closes the natural ways in. It is not a sandbox: a package can still be written to dodge it, which is why
 * the source of the package is scanned as well (`source-guards.ts`).
 */

const FS_SYNC = ['readFileSync', 'openSync', 'readdirSync', 'opendirSync'] as const;
const FS_CALLBACK = ['readFile', 'open', 'readdir', 'opendir', 'createReadStream'] as const;
const FS_PROMISES = ['readFile', 'open', 'readdir', 'opendir'] as const;
const PROCESS_CALLS = ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'] as const;

export const TRAP_MESSAGE =
  'the statistics package may not read files, list folders or start processes while the validator runs it (docs/validators.md 12.7)';

let installed = false;

/** Wraps the calls named; a call whose stack holds one of `dirs` throws. Idempotent. */
export function installTrap(dirs: readonly string[]): void {
  if (installed) return;
  installed = true;
  // A folder is named by its path as given, by its real path (a temporary folder may sit behind a link) and as a
  // file URL, because a stack frame prints whichever the module was loaded by.
  const marks = dirs.flatMap((dir) => {
    const given = resolve(dir);
    const real = fs.existsSync(given) ? fs.realpathSync(given) : given;
    return [...new Set([given, real])].flatMap((path) => [path + sep, `${pathToFileURL(path).href}/`]);
  });
  // The caller is the first frame outside this file: a call made by the package itself. A call made by node's own
  // module loader (it reads the package's files to load them) has the loader as its caller and is let through.
  const guarded = (): boolean => {
    const frames = (new Error().stack ?? '').split('\n').slice(1);
    const caller = frames.find((frame) => !frame.includes('trap.ts') && !frame.includes('trap.js')) ?? '';
    return marks.some((mark) => caller.includes(mark));
  };
  const wrap = (target: Record<string, unknown>, names: readonly string[]): void => {
    for (const name of names) {
      const original = target[name];
      if (typeof original !== 'function') continue;
      try {
        target[name] = function (this: unknown, ...args: unknown[]) {
          if (guarded()) throw new Error(TRAP_MESSAGE);
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        };
      } catch {
        // a frozen export stays as it is; the source scan still covers it
      }
    }
  };
  wrap(fs as unknown as Record<string, unknown>, [...FS_SYNC, ...FS_CALLBACK]);
  wrap(fs.promises as unknown as Record<string, unknown>, FS_PROMISES);
  wrap(childProcess as unknown as Record<string, unknown>, PROCESS_CALLS);
  syncBuiltinESMExports();
}

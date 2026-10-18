import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { type BankItem, DEFAULT_ITEM_BUDGET_MS, type ItemOutcome } from './index';

/**
 * Runs the items of one seed in child processes that stop an item past its budget. The child is `child.ts`,
 * loaded through tsx, so this isolation needs a source checkout (a built package runs in-process).
 */

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

type Line = { start?: number; done?: number; id: string; pass?: boolean; detail?: string; ms?: number };

/** The time a child process may take to load the bank before it runs its first item. */
export const STARTUP_MS = 120_000;
/** After a child's exit, how long the parent waits for the rest of its output. */
export const DRAIN_MS = 10_000;
/** Child processes run side by side for one seed: the cores less one, at most 4. */
export const DEFAULT_SHARDS = Math.max(1, Math.min(4, availableParallelism() - 1));

/** Whether this module runs from source, where the child can be started. */
export const CAN_ISOLATE = import.meta.url.endsWith('.ts');

export async function runIsolated(
  items: readonly BankItem[],
  seed: number,
  root: string,
  budget: (item: BankItem) => number = (item) => item.budgetMs ?? DEFAULT_ITEM_BUDGET_MS,
  shards = DEFAULT_SHARDS,
): Promise<Map<string, ItemOutcome & { ms?: number }>> {
  const results = new Map<string, ItemOutcome & { ms?: number }>();
  const count = Math.max(1, Math.min(shards, items.length));
  // Round robin, so the heavy items spread over the children.
  const lists = Array.from({ length: count }, (_, k) => items.filter((_, i) => i % count === k));
  await Promise.all(
    lists.map(async (list) => {
      let next = 0;
      while (next < list.length) next = await runFrom(next, list, seed, root, budget, results);
    }),
  );
  return results;
}

function runFrom(
  start: number,
  items: readonly BankItem[],
  seed: number,
  root: string,
  budget: (item: BankItem) => number,
  results: Map<string, ItemOutcome & { ms?: number }>,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, String(seed), root, String(start)], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(JSON.stringify(items.map((item) => item.id)));
    let buffer = '';
    let errors = '';
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let reported = 0;
    let drain: NodeJS.Timeout | undefined;
    const finish = (resume: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(resume);
    };
    const arm = (index: number) => {
      if (settled) return;
      if (timer) clearTimeout(timer);
      const item = items[index];
      if (!item) return;
      const limit = budget(item);
      timer = setTimeout(() => {
        results.set(item.id, {
          pass: false,
          detail: `did not finish within ${limit} ms on seed ${seed}: an endless loop or a path far too slow for this input; the validator stopped it`,
        });
        child.kill('SIGKILL');
        finish(index + 1);
      }, limit);
    };
    timer = setTimeout(() => {
      const item = items[start];
      if (item) {
        results.set(item.id, {
          pass: false,
          detail: `the bank's child process did not start within ${STARTUP_MS} ms on seed ${seed}`,
        });
      }
      child.kill('SIGKILL');
      finish(start + 1);
    }, STARTUP_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const text = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (text.trim() === '') continue;
        let line: Line;
        try {
          line = JSON.parse(text) as Line;
        } catch {
          continue;
        }
        if (line.start !== undefined) {
          arm(line.start);
        } else if (line.done !== undefined) {
          results.set(line.id, { pass: line.pass === true, detail: line.detail ?? '', ms: line.ms });
          reported += 1;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    const conclude = (code: number | null) => {
      if (drain) clearTimeout(drain);
      if (settled) return;
      let first = start;
      while (first < items.length && results.has((items[first] as BankItem).id)) first += 1;
      if (first >= items.length) {
        finish(items.length);
        return;
      }
      const item = items[first] as BankItem;
      if (code === 0 && reported > 0) {
        finish(first);
        return;
      }
      results.set(item.id, {
        pass: false,
        detail:
          code === 0
            ? `the bank's child process ended (exit 0) on seed ${seed} without reporting this item or any other: the item ends the process, or its output is lost`
            : `the bank's child process died (exit ${code}) while running this item on seed ${seed}: ${errors.trim().split('\n').slice(-3).join(' / ')}`,
      });
      finish(first + 1);
    };
    child.on('exit', (code) => {
      drain = setTimeout(() => conclude(code), DRAIN_MS);
    });
    child.on('close', (code) => conclude(code));
  });
}

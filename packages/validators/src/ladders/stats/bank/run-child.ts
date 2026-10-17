/**
 * What the bank's child process runs: the items of the statistics bank on one seed, in bank order, from a start
 * index, with one JSON line before and after each item. `child.ts` calls it from source; a built package calls
 * it through its own entry point (see isolate.ts). `args` is <seed> <root> <start>, and the item ids to run come
 * as a JSON array on stdin.
 */
import { dirname, join } from 'node:path';
import * as stats from '@agent-nexus/driftbench-stats';
import type { StatsImpl } from '../reference';
import { runItem, statsBank } from './index';
import { installTrap } from './trap';

async function main(args: readonly string[]): Promise<void> {
  const [seedText, root, startText] = args;
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  const implPath = process.env.DRIFTBENCH_STATS_IMPL;
  // The package under test runs with no file or process access; the validator's own reads are not affected.
  installTrap([
    ...(implPath ? [dirname(implPath.startsWith('file://') ? new URL(implPath).pathname : implPath)] : []),
    join(root as string, 'packages', 'stats', 'src'),
  ]);
  const s = (implPath ? await import(implPath) : stats) as StatsImpl;
  const byId = new Map(statsBank(root as string).map((item) => [item.id, item]));
  const items = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`no bank item ${id}`);
    return item;
  });
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const began = performance.now();
    const outcome = await runItem(item, seed, root as string, s);
    process.stdout.write(
      `${JSON.stringify({ done: index, id: item.id, pass: outcome.pass, detail: outcome.detail, ms: Math.round(performance.now() - began) })}\n`,
    );
  }
}

/** Runs the child and ends the process: exit 0 when every item ran, exit 1 with the cause on stderr otherwise. */
export function statsBankChild(args: readonly string[]): Promise<never> {
  return main(args).then(
    // Exit when every line has left the process: an exit with output still queued would drop it.
    () =>
      new Promise<never>(() => {
        process.stdout.write('', () => process.exit(0));
      }),
    (cause) => {
      process.stderr.write(`bank child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
      process.exit(1);
    },
  );
}

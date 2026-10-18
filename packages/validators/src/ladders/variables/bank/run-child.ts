/**
 * What the bank's child process runs: the items of the variables bank on one seed, in the order given on stdin,
 * from a start index, with one JSON line before and after each item.
 */
import { loadImpl } from '../impl';
import { runItem, variablesBank } from './index';

async function main(args: readonly string[]): Promise<void> {
  const [seedText, root, startText] = args;
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  const byId = new Map(variablesBank().map((item) => [item.id, item]));
  const items = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`no bank item ${id}`);
    return item;
  });
  const { impl, module } = await loadImpl();
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const began = performance.now();
    const outcome = await runItem(item, seed, root as string, impl, module);
    process.stdout.write(
      `${JSON.stringify({ done: index, id: item.id, pass: outcome.pass, detail: outcome.detail, ms: Math.round(performance.now() - began) })}\n`,
    );
  }
}

/** Runs the child and ends the process: exit 0 when every item ran, exit 1 with the cause on stderr otherwise. */
export function variablesBankChild(args: readonly string[]): Promise<never> {
  return main(args).then(
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

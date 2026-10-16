// Scores the shared agent's results with both oracles. Usage: tsx score.mts <design> <mode><tag>
// Reads data/<design>/jobs-<x>.jsonl and results-<x>.jsonl, writes runs-<x>.jsonl (the analysis input).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCKS } from './blocks.ts';
import { type Call, exactOracle, normalisedOracle } from './oracle.ts';
import { blockGiven } from './prefix.ts';

const [design, x] = process.argv.slice(2) as [string, string];
const dir = resolve(import.meta.dirname, '../data', design);
const lines = (f: string) =>
  readFileSync(resolve(dir, f), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
const jobs = new Map(lines(`jobs-${x}.jsonl`).map((j: { id: string }) => [j.id, j]));
const results = lines(`results-${x}.jsonl`) as { id: string; text: string; calls: { name: string; input: unknown; ok: boolean; output?: unknown; error?: string }[]; usage: unknown; usd: number }[];
const expects = new Map<string, unknown>();
for (const def of BLOCKS) expects.set(def.id, (await blockGiven(def)).expect);

const LABELS: Record<string, string> = { catalog_search: 'catalog.search', coverage_check: 'coverage.check', port_check: 'port.check', order_create: 'order.create', notify_sales: 'notify_sales' };
const label = (name: string) => LABELS[name] ?? name;
const out = results.map((r) => {
  const job = jobs.get(r.id) as { block: string; row: number | null; cell: unknown; text: string; k: number };
  const def = BLOCKS.find((d) => d.id === job.block);
  if (!def) throw new Error(job.block);
  const calls: Call[] = r.calls.map((c) => ({ label: label(c.name), input: c.input, ...(c.ok ? { output: c.output } : { error: c.error }) }));
  const expect = expects.get(def.id) as never;
  const exact = exactOracle(expect, calls);
  const norm = normalisedOracle(expect, calls, def.fields);
  return { id: r.id, block: job.block, row: job.row, cell: job.cell, text: job.text, k: job.k, calls, reply: r.text, usage: r.usage, usd: r.usd, exact: exact.pass, exactFailed: exact.failed, norm: norm.pass, normFailed: norm.failed, snaps: norm.snaps };
});
writeFileSync(resolve(dir, `runs-${x}.jsonl`), `${out.map((o) => JSON.stringify(o)).join('\n')}\n`);
const missing = [...jobs.keys()].filter((id) => !results.some((r) => r.id === id));
console.log(JSON.stringify({ scored: out.length, jobs: jobs.size, missing: missing.length, exactPass: out.filter((o) => o.exact).length, normPass: out.filter((o) => o.norm).length }));

// Writes LEDGER.md from data/usage.jsonl. Usage: tsx ledger.mts ["projection note"]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LANE_CAP, STOP_AT, USAGE_FILE, type UsageRow } from './usage.ts';

const rows = readFileSync(USAGE_FILE, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as UsageRow);
const batches = new Map<string, { model: string; calls: number; input: number; output: number; usd: number }>();
for (const r of rows) {
  const key = `${r.batch}\u0000${r.model}`;
  const b = batches.get(key) ?? { model: r.model, calls: 0, input: 0, output: 0, usd: 0 };
  b.calls += 1;
  b.input += r.input;
  b.output += r.output;
  b.usd += r.usd;
  batches.set(key, b);
}
let cumulative = 0;
const lines = [...batches.entries()].map(([key, b]) => {
  cumulative += b.usd;
  return `| ${key.split('\u0000')[0]} | ${b.model} | ${b.calls} | ${b.input} | ${b.output} | ${b.usd.toFixed(4)} | ${cumulative.toFixed(4)} |`;
});
const notes = readFileSync(resolve(import.meta.dirname, '../data/ledger-notes.md'), 'utf8');
writeFileSync(
  resolve(import.meta.dirname, '../LEDGER.md'),
  `# Ledger: phrasing lane (cap ${LANE_CAP} USD, stop at ${STOP_AT} USD)

Computed by \`src/ledger.mts\` from \`data/usage.jsonl\`: each paid call's provider usage fields times the prices in \`README.md\`. One row per batch and model, in the order the batches ran. Calls that errored before returning usage cost nothing and are not listed.

| Batch | Model | Calls | Input tokens | Output tokens | USD | Cumulative USD |
|---|---|---|---|---|---|---|
${lines.join('\n')}

Total: ${cumulative.toFixed(4)} USD of ${LANE_CAP}.

${notes}`,
);
console.log(`total ${cumulative.toFixed(4)}`);

// M1.3 sanity check, offline: gold calls pass both oracles; every listed surface form passes the
// normalised oracle; every minimal-pair value fails both.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAcmeAgent } from '../../../../examples/acme/src/agent.ts';
import { BLOCKS } from './blocks.ts';
import { type Call, exactOracle, normalisedOracle } from './oracle.ts';
import { blockGiven } from './prefix.ts';

function rewrite(calls: Call[], tool: string, path: string[], to: string, mode: 'equal' | 'contains'): Call[] {
  return calls.map((call) => {
    if (call.label !== tool) return call;
    const input = structuredClone(call.input) as Record<string, unknown>;
    let at = input;
    for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
    const last = path.at(-1) as string;
    at[last] = mode === 'equal' ? to : `Customer at ${to} wants a call back.`;
    return { ...call, input };
  });
}

const rows: unknown[] = [];
let problems = 0;
for (const def of BLOCKS) {
  const g = await blockGiven(def);
  const agent = createAcmeAgent();
  const observed = await agent.respond([...g.given.prefix, { role: 'user', content: g.seed }], g.given.world);
  const gold: Call[] = observed.toolCalls.map((c) => ({ label: c.label, input: c.input, output: c.output, error: c.error }));
  const exact = exactOracle(g.expect as never, gold);
  const norm = normalisedOracle(g.expect as never, gold, def.fields);
  const row: Record<string, unknown> = { block: def.id, gold_exact: exact.pass, gold_norm: norm.pass, gold_failed: exact.failed, forms: [], minimal: [] };
  if (!exact.pass || !norm.pass) problems++;
  for (const field of def.fields) {
    const slot = def.slots.find((s) => s.kind === field.kind) ?? def.slots[0];
    if (!slot) continue;
    // Surface forms an agent may legitimately write for this field.
    const forms =
      field.kind === 'phone'
        ? [...Object.values(slot.forms), '+' + slot.value.replace(/\D/g, ''), slot.value.replace(/\s/g, '')]
        : field.kind === 'address' && field.mode === 'contains'
          ? [field.gold, field.gold.replace('Avenue', 'Ave').replace('Lane', 'Ln'), field.gold.toLowerCase()]
          : Object.values(slot.forms);
    for (const form of forms) {
      const calls = rewrite(gold, field.tool, field.path, form, field.mode);
      const r = normalisedOracle(g.expect as never, calls, def.fields);
      (row.forms as unknown[]).push({ field: field.path.join('.'), form, exact: exactOracle(g.expect as never, calls).pass, norm: r.pass });
      if (!r.pass) problems++;
    }
    if (field.mode === 'equal') {
      const calls = rewrite(gold, field.tool, field.path, slot.minimal, 'equal');
      const e = exactOracle(g.expect as never, calls).pass;
      const n = normalisedOracle(g.expect as never, calls, def.fields).pass;
      (row.minimal as unknown[]).push({ field: field.path.join('.'), value: slot.minimal, exact: e, norm: n });
      if (e || n) problems++;
    }
  }
  rows.push(row);
}
writeFileSync(resolve(import.meta.dirname, '../data/sanity-oracle.json'), `${JSON.stringify({ problems, rows }, null, 2)}\n`);
console.log(JSON.stringify(rows, null, 1));
console.log(`problems: ${problems}`);

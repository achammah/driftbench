// Builds the job file for the shared live Acme agent (research/block-redesign/shared/acme-live).
// Usage:
//   tsx jobs.mts <design> seed <repeats> [--blocks ..] [--tag t]
//   tsx jobs.mts <design> class <K> [--blocks ..] [--rows N] [--source realisations.json] [--tag t]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCKS } from './blocks.ts';
import { blockGiven } from './prefix.ts';

const args = process.argv.slice(2);
const [design, mode, countArg] = args as [string, 'seed' | 'class', string];
const opt = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = opt('blocks')?.split(',');
const rowLimit = opt('rows') ? Number(opt('rows')) : undefined;
const source = opt('source') ?? 'realisations.json';
const tag = opt('tag') ?? '';
const count = Number(countArg);
const out = resolve(import.meta.dirname, '../data', design);
mkdirSync(out, { recursive: true });

/** The shared agent's tool names: the Acme labels with underscores. */
export const wire = (label: string) => label.replace('.', '_');

type Msg = { role: 'user' | 'assistant'; content: unknown };

/** The teacher-forced prefix as Anthropic messages, the deterministic agent's tool calls and results included. */
function anthropicHistory(prefix: { role: string; content: string; tool_calls?: { id?: string; label: string; input?: unknown; output?: unknown; error?: string }[] }[]): Msg[] {
  const msgs: Msg[] = [];
  for (const m of prefix) {
    if (m.role === 'user') {
      msgs.push({ role: 'user', content: m.content });
      continue;
    }
    const calls = m.tool_calls ?? [];
    if (calls.length > 0) {
      msgs.push({
        role: 'assistant',
        content: calls.map((c, i) => ({ type: 'tool_use', id: (c.id ?? `toolu_p${i}`).replace(/[^a-zA-Z0-9_-]/g, '_'), name: wire(c.label), input: c.input ?? {} })),
      });
      msgs.push({
        role: 'user',
        content: calls.map((c, i) => ({
          type: 'tool_result',
          tool_use_id: (c.id ?? `toolu_p${i}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
          content: c.error !== undefined ? c.error : JSON.stringify(c.output ?? null),
          ...(c.error !== undefined ? { is_error: true } : {}),
        })),
      });
    }
    msgs.push({ role: 'assistant', content: [{ type: 'text', text: m.content }] });
  }
  return msgs;
}

/** The block's world as the shared agent's overrides: forced tools, and a seeded transfer record as a forced port_check result. */
function overridesOf(world: { tools?: Record<string, { result?: unknown; error?: string }>; store?: { port_numbers?: { number: string; eligible: boolean; reason?: string }[] } }) {
  const o: Record<string, unknown> = {};
  for (const [label, forced] of Object.entries(world.tools ?? {})) {
    o[wire(label)] = forced.error !== undefined ? { error: forced.error } : { result: forced.result ?? null };
  }
  const port = world.store?.port_numbers?.[0];
  if (port) o.port_check = { result: port.eligible ? { number: port.number, eligible: true } : { number: port.number, eligible: false, reason: port.reason } };
  return o;
}

const jobs: unknown[] = [];
for (const def of BLOCKS.filter((d) => !only || only.includes(d.id))) {
  const g = await blockGiven(def);
  const history = anthropicHistory(g.given.prefix as never);
  const overrides = overridesOf(g.given.world as never);
  if (mode === 'seed') {
    for (let k = 0; k < count; k++) jobs.push({ id: `${def.id}#seed#${k}`, block: def.id, row: null, cell: null, text: g.seed, k, history, overrides });
  } else {
    const reals = JSON.parse(readFileSync(resolve(out, source), 'utf8')) as { block: string; row: number; cell: unknown; text: string }[];
    for (const r of reals.filter((x) => x.block === def.id && (rowLimit === undefined || x.row < rowLimit))) {
      for (let k = 0; k < count; k++) jobs.push({ id: `${def.id}#${r.row}#${tag}${k}`, block: def.id, row: r.row, cell: r.cell, text: r.text, k, history, overrides });
    }
  }
}
const file = resolve(out, `jobs-${mode}${tag}.jsonl`);
writeFileSync(file, `${jobs.map((j) => JSON.stringify(j)).join('\n')}\n`);
console.log(`${jobs.length} jobs -> ${file}`);

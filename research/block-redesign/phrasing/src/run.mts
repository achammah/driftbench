// Runs the live Acme stand-in on a block's seed or its frozen realisations, and scores every run with
// both oracles. Usage:
//   tsx run.mts <design> seed <repeats> [--blocks ..] [--tag t]
//   tsx run.mts <design> class <K> [--blocks ..] [--rows N] [--tag t]
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { AGENT_MODEL, liveAcme } from './agent.ts';
import { BLOCKS } from './blocks.ts';
import { type Call, exactOracle, normalisedOracle } from './oracle.ts';
import { blockGiven } from './prefix.ts';
import { guard, record, spent } from './usage.ts';

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
const runsFile = resolve(out, `runs-${mode}${tag}.jsonl`);

const apiKey = readFileSync(resolve(homedir(), '.nexus-secrets/anthropic-driftbench.key'), 'utf8').trim();
const adapter = await liveAcme(apiKey);

type Job = { block: string; row: number | null; cell: unknown; text: string; k: number };
const jobs: Job[] = [];
const givens = new Map<string, Awaited<ReturnType<typeof blockGiven>>>();
for (const def of BLOCKS.filter((d) => !only || only.includes(d.id))) givens.set(def.id, await blockGiven(def));
if (mode === 'seed') {
  for (const [id, g] of givens) for (let k = 0; k < count; k++) jobs.push({ block: id, row: null, cell: null, text: g.seed, k });
} else {
  const realisations = JSON.parse(readFileSync(resolve(out, source), 'utf8')) as { block: string; row: number; cell: unknown; text: string }[];
  for (const r of realisations) {
    if (!givens.has(r.block) || (rowLimit !== undefined && r.row >= rowLimit)) continue;
    for (let k = 0; k < count; k++) jobs.push({ block: r.block, row: r.row, cell: r.cell, text: r.text, k });
  }
}

const before = spent();
let next = 0;
let done = 0;
async function worker() {
  for (;;) {
    const job = jobs[next++];
    if (!job) return;
    const g = givens.get(job.block);
    const def = BLOCKS.find((d) => d.id === job.block);
    if (!g || !def) throw new Error('missing block');
    let calls: Call[] = [];
    let text = '';
    let error: string | undefined;
    let usage = { input: 0, output: 0 };
    for (let attempt = 1; attempt <= 2; attempt++) {
      guard();
      try {
        const session = await adapter.open(g.given);
        session.history.push({ role: 'user', content: job.text });
        const observed = await adapter.send(session, { index: def.index, stimulus: { user: job.text }, given: g.given });
        await adapter.close(session);
        calls = observed.toolCalls.map((c) => ({ label: c.label, input: c.input, output: c.output, error: c.error }));
        text = observed.text;
        usage = { input: observed.cost?.inputTokens ?? 0, output: observed.cost?.outputTokens ?? 0 };
        error = undefined;
        break;
      } catch (cause) {
        error = String(cause instanceof Error ? cause.message : cause);
        // A transport failure is retried once; an agent failure (the step cap) is the agent's verdict.
        if (/step|asked for/.test(error)) break;
      }
    }
    if (usage.input + usage.output > 0) record(`agent-${design}-${mode}`, AGENT_MODEL, usage.input, 0, usage.output);
    const exact = error ? { pass: false, failed: ['agent_error'] } : exactOracle(g.expect as never, calls);
    const norm = error ? { pass: false, failed: ['agent_error'], snaps: [] } : normalisedOracle(g.expect as never, calls, def.fields);
    appendFileSync(
      runsFile,
      `${JSON.stringify({ ...job, error, calls, reply: text, usage, exact: exact.pass, exactFailed: exact.failed, norm: norm.pass, normFailed: norm.failed, snaps: norm.snaps })}\n`,
    );
    done++;
    if (done % 25 === 0) console.log(`${done}/${jobs.length} runs, ${(spent() - before).toFixed(4)} USD`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(JSON.stringify({ design, mode, runs: jobs.length, usd: Number((spent() - before).toFixed(4)), file: runsFile }));

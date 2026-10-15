/**
 * H6 runner. `pilot` runs the 4 pilot runs; `full` runs the 900 pre-registered runs in the shuffled order.
 *   npx tsx research/block-redesign/given/H6/run.ts pilot|full
 * Each run appends one line to H6/runs-<mode>.jsonl as it finishes; usage goes to ../calls.jsonl.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { contentHash, type Message } from '@agent-nexus/driftbench-core';
import { acmeLiveAdapter, loggingClient } from '../agent/acme-live';
import { type Arm, BLOCKS, givenOf, passes } from './blocks';

const DIR = 'research/block-redesign/given';
const mode = process.argv[2] === 'full' ? 'full' : 'pilot';
const OUT = `${DIR}/H6/runs-${mode}.jsonl`;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Job = { block: string; arm: Arm; rep: number };
let jobs: Job[] = [];
if (mode === 'pilot') {
  for (const block of ['cov-750', 'order-id']) for (const arm of ['record', 'prose'] as const) jobs.push({ block, arm, rep: 0 });
} else {
  for (const block of BLOCKS) for (const arm of ['record', 'prose'] as const) for (let rep = 0; rep < 30; rep++) jobs.push({ block: block.id, arm, rep });
  const rng = mulberry32(6);
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [jobs[i], jobs[j]] = [jobs[j]!, jobs[i]!];
  }
}
// Resume after a crash: skip jobs already written.
if (existsSync(OUT)) {
  const done = new Set(readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((line) => { const r = JSON.parse(line); return `${r.block}|${r.arm}|${r.rep}`; }));
  jobs = jobs.filter((job) => !done.has(`${job.block}|${job.arm}|${job.rep}`));
}

async function runOne(job: Job) {
  const block = BLOCKS.find((b) => b.id === job.block)!;
  const runId = `h6-${mode}:${job.block}:${job.arm}:${job.rep}`;
  const client = loggingClient(`${DIR}/calls.jsonl`, () => runId);
  const adapter = acmeLiveAdapter(client);
  const { prefix, world } = givenOf(block, job.arm);
  const body = { prefix, ledger: {}, world, vars: { channel: 'chat' }, target: { adapter: 'anthropic', agent: 'acme-live' } };
  const given = { ...body, hash: contentHash(body) } as never;
  const started = Date.now();
  try {
    const session = await adapter.open(given);
    const ask: Message = { role: 'user', content: block.ask };
    session.history.push(ask);
    const observed = await adapter.send(session, { index: 1, stimulus: { user: block.ask }, given } as never);
    return { ...job, run: runId, pass: passes(block, observed.text), recall: observed.toolCalls.some((c) => c.label === block.label), tools: observed.toolCalls.map((c) => c.label), text: observed.text, ms: Date.now() - started, error: null };
  } catch (error) {
    return { ...job, run: runId, pass: null, recall: null, tools: [], text: '', ms: Date.now() - started, error: String((error as Error).message ?? error).slice(0, 300) };
  }
}

let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++]!;
    const result = await runOne(job);
    appendFileSync(OUT, `${JSON.stringify(result)}\n`);
  }
}
await Promise.all(Array.from({ length: mode === 'full' ? 8 : 2 }, worker));
console.log(`done ${mode}: ${jobs.length} jobs`);

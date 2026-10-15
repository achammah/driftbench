/**
 * H8 runner. `pilot`: the 64K cells priced first (one run per block at 64K and at 2K, depth 0.5).
 * `full`: the 3,600 pre-registered runs, shuffled by seed 8, 6 at a time, resumable.
 *   npx tsx research/block-redesign/given/H8/run.ts pilot|full
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { contentHash } from '@agent-nexus/driftbench-core';
import { acmeLiveAdapter, loggingClient } from '../agent/acme-live';
import { BLOCKS, DEPTHS, SIZES } from './blocks';
import { build } from './context';

const DIR = 'research/block-redesign/given';
const mode = process.argv[2] === 'full' ? 'full' : process.argv[2] === 'resume' ? 'resume' : 'pilot';
const OUT = `${DIR}/H8/runs-${mode}.jsonl`;

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

type Job = { block: string; size: number; depth: number | 'control'; rep: number };
let jobs: Job[] = [];
if (mode === 'pilot') {
  for (const block of BLOCKS) for (const size of [64000, 2000]) jobs.push({ block: block.id, size, depth: 0.5, rep: 99 });
} else if (mode === 'resume') {
  // Re-run after the 2026-10-15 network outage: only the jobs whose row in runs-full.jsonl is an error.
  // runs-full.jsonl keeps those error rows; the new attempts go to runs-resume.jsonl.
  jobs = readFileSync(`${DIR}/H8/runs-full.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.error !== null).map((r) => ({ block: r.block, size: r.size, depth: r.depth, rep: r.rep }));
} else {
  for (const block of BLOCKS) for (const size of SIZES) for (const depth of [...DEPTHS, 'control' as const]) for (let rep = 0; rep < 30; rep++) jobs.push({ block: block.id, size, depth, rep });
  const rng = mulberry32(8);
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [jobs[i], jobs[j]] = [jobs[j]!, jobs[i]!];
  }
}
const keyOf = (j: Job) => `${j.block}|${j.size}|${j.depth}|${j.rep}`;
if (existsSync(OUT)) {
  const done = new Set(readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => keyOf(JSON.parse(l))));
  jobs = jobs.filter((j) => !done.has(keyOf(j)));
}

async function runOne(job: Job) {
  const block = BLOCKS.find((b) => b.id === job.block)!;
  const run = `h8-${mode}:${keyOf(job)}`;
  let first: number | null = null;
  const client = loggingClient(`${DIR}/calls.jsonl`, () => run);
  const wrapped = { messages: { create: async (body: never, options: never) => { const answer = await client.messages.create(body, options); if (first === null) first = (answer as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? null; return answer; } } };
  const adapter = acmeLiveAdapter(wrapped as never);
  const built = build(block, job.size, job.depth, job.rep);
  const body = { prefix: built.prefix, ledger: {}, world: block.world ?? {}, vars: { channel: 'chat' }, target: { adapter: 'anthropic', agent: 'acme-live' } };
  const given = { ...body, hash: contentHash(body) } as never;
  const base = { ...job, run, pairs: built.pairs, depth_actual: built.depthActual, estimated_tokens: built.estimatedTokens, clean: built.clean };
  try {
    const session = await adapter.open(given);
    session.history.push(built.ask);
    const observed = await adapter.send(session, { index: 1, stimulus: { user: built.ask.content }, given } as never);
    return { ...base, measured_tokens: first, pass: block.pass(observed), tools: observed.toolCalls.map((c) => ({ label: c.label, input: c.input })), text: observed.text.slice(0, 600), error: null };
  } catch (error) {
    return { ...base, measured_tokens: first, pass: null, tools: [], text: '', error: String((error as Error).message ?? error).slice(0, 300) };
  }
}

/** Stop line: 27 USD cumulative for the lane (OpenAI lines carry no usd field; they are cents). */
function spent(): number {
  return readFileSync(`${DIR}/calls.jsonl`, 'utf8').trim().split('\n').reduce((sum, line) => sum + (JSON.parse(line).usd ?? 0), 0);
}
let next = 0;
let stopped = false;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < jobs.length && !stopped) {
    if (next % 50 === 0 && spent() >= 26.5) {
      stopped = true;
      console.log(`stop line reached at ${spent().toFixed(2)} USD`);
      break;
    }
    const job = jobs[next++]!;
    appendFileSync(OUT, `${JSON.stringify(await runOne(job))}\n`);
  }
}));
console.log(`done ${mode}: ${jobs.length}`);

// Runs plan.json against the live stand-in agent. Arms per item: FULL1 (stem then child), ISO (child alone), FULL2 (repeat of FULL1, when planned).
// Usage: tsx run.ts [--only id,id] [--limit n] [--concurrency n]; the key comes from ANTHROPIC_API_KEY. Results append to results/arms.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { converse, scoreBlock, zeroUsage, type Turn } from './live';

const HERE = new URL('.', import.meta.url).pathname;
const PRICE_IN = Number(process.env.PRICE_IN_PER_M ?? 1);
const PRICE_OUT = Number(process.env.PRICE_OUT_PER_M ?? 5);
const CAP = Number(process.env.STOP_USD ?? 13.5);
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const only = opt('only')?.split(',');
const limit = Number(opt('limit') ?? 1e9);
const conc = Number(opt('concurrency') ?? 3);
const key = process.env.ANTHROPIC_API_KEY ?? '';
if (!key) throw new Error('no key');

mkdirSync(`${HERE}results`, { recursive: true });
const ARMS = `${HERE}results/arms.jsonl`;
const done = new Map<string, Set<string>>();
let spent = 0;
if (existsSync(ARMS)) {
  for (const line of readFileSync(ARMS, 'utf8').split('\n').filter(Boolean)) {
    const a = JSON.parse(line);
    (done.get(a.item) ?? done.set(a.item, new Set()).get(a.item)!).add(a.arm);
    spent += a.usd;
  }
}
// Pilot arms (discarded from the sample, see PREREG Deviations) still count against the budget.
const PILOT = `${HERE}results/pilot-arms.jsonl`;
if (existsSync(PILOT)) for (const line of readFileSync(PILOT, 'utf8').split('\n').filter(Boolean)) spent += JSON.parse(line).usd;
const plan = JSON.parse(readFileSync(`${HERE}plan.json`, 'utf8'));
const usd = (u: { input: number; output: number; cache_write: number; cache_read: number }) =>
  ((u.input + u.cache_write * 1.25 + u.cache_read * 0.1) * PRICE_IN + u.output * PRICE_OUT) / 1e6;

async function arm(item: any, name: 'FULL1' | 'FULL2' | 'ISO') {
  const stem: Turn[] = item.stem.map((b: any) => ({ user: b.user, given: b.given }));
  const child: Turn[] = item.child.map((b: any) => ({ user: b.user, given: b.given }));
  const turns = name === 'ISO' ? child : [...stem, ...child];
  const { results, usage } = await converse(turns, key);
  const offset = name === 'ISO' ? 0 : stem.length;
  const score = (blocks: any[], from: number) => blocks.map((b, i) => scoreBlock(b.expect, item.forbidden, results[from + i]));
  const rec = {
    item: item.id,
    type: item.type,
    arm: name,
    stem_score: name === 'ISO' ? [] : score(item.stem, 0),
    child_score: score(item.child, offset),
    turns: results,
    usage,
    usd: usd(usage),
  };
  appendFileSync(ARMS, `${JSON.stringify(rec)}\n`);
  spent += rec.usd;
  return rec;
}

const queue = plan.items.filter((i: any) => !only || only.includes(i.id)).slice(0, limit);
let next = 0;
async function worker() {
  while (next < queue.length) {
    const item = queue[next++];
    if (spent >= CAP) {
      console.log(`stop: spent ${spent.toFixed(3)} USD reached the stop level ${CAP}`);
      return;
    }
    const have = done.get(item.id) ?? new Set();
    const arms = (['FULL1', 'ISO', ...(item.repeat ? ['FULL2'] : [])] as const).filter((a) => !have.has(a));
    if (arms.length === 0) continue;
    try {
      await Promise.all(arms.map((a) => arm(item, a)));
      console.log(`${item.id} done, cumulative ${spent.toFixed(3)} USD`);
    } catch (e: any) {
      console.log(`${item.id} FAILED: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: conc }, worker));
console.log(`finished, cumulative ${spent.toFixed(3)} USD`);
void zeroUsage;

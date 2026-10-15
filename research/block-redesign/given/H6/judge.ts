/**
 * H6 amendment 1 judge: does the reply give the customer the result value as a current fact? A different
 * family from the agent (OpenAI gpt-6-luna, Responses API, reasoning effort none), one call per run.
 *   npx tsx research/block-redesign/given/H6/judge.ts full|pilot
 * Reads H6/runs-<mode>.jsonl, writes H6/judged-<mode>.jsonl (resumable).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BLOCKS } from './blocks';

const DIR = 'research/block-redesign/given';
const mode = process.argv[2] === 'full' ? 'full' : 'pilot';
export const JUDGE_MODEL = 'gpt-6-luna';

/** The value each block's question asks for, as the judge is told it. */
export const EXPECTED: Record<string, string> = {
  'cov-750': 'a top fiber speed of 750 Mbps',
  'cov-450': 'a fiber speed of 450 Mbps',
  'cov-2500': 'a maximum fiber speed of 2500 Mbps (2.5 Gbps)',
  'cat-price': 'the cheaper fiber plan costs 37 USD per month',
  'cat-data': 'the M plan includes 45 GB of data',
  'cat-current': 'the customer is on the Acme Mobile Flex 20 plan',
  'port-balance': 'the number cannot move because of an unpaid balance at the current carrier',
  'port-pin': 'the transfer is blocked because a port-out PIN is not set at the current carrier',
  'port-date': 'the earliest date the number can move is 3 November 2026',
  'order-id': 'the order number is ORD-7Q4KX2',
  'order-install': 'the installation date is 29 October 2026',
  'order-price': 'the order costs 33.50 USD per month',
  'lead-ref': 'the callback reference is LEAD-K7P3QD',
  'lead-window': 'the advisor will call tomorrow between 14:00 and 16:00',
  'lead-advisor': 'Dana Whitfield will call',
};

export const JUDGE_PROMPT = (ask: string, expected: string, reply: string) => `You grade one reply of a customer service assistant.

The customer asked: "${ask}"
The correct answer, from the assistant's own earlier tool result: ${expected}.

The reply:
<reply>
${reply}
</reply>

Answer YES if the reply gives the customer this answer as a true, current fact (extra remarks or a re-check are fine).
Answer NO if the reply does not give it, gives a different value, or says the value is unconfirmed, made up, wrong, or should be disregarded.
Answer with one word: YES or NO.`;

const key = readFileSync(join(homedir(), '.nexus-secrets', 'openai.key'), 'utf8').trim();
const IN = `${DIR}/H6/runs-${mode}.jsonl`;
const OUT = `${DIR}/H6/judged-${mode}.jsonl`;

async function judge(run: { run: string; block: string; text: string }) {
  const block = BLOCKS.find((b) => b.id === run.block)!;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JUDGE_MODEL, input: JUDGE_PROMPT(block.ask, EXPECTED[block.id]!, run.text), reasoning: { effort: 'none' }, max_output_tokens: 16 }),
    });
    const json = (await response.json()) as Record<string, any>;
    const usage = json.usage ?? {};
    appendFileSync(`${DIR}/calls.jsonl`, `${JSON.stringify({ run: `h6-judge-${mode}:${run.run}`, model: JUDGE_MODEL, request_id: response.headers.get('x-request-id'), input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0, provider: 'openai', status: response.status })}\n`);
    if (response.status >= 500 || response.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    const text: string = (json.output ?? []).flatMap((item: any) => item.content ?? []).map((c: any) => c.text ?? '').join(' ').trim();
    const verdict = /^\W*yes\b/i.test(text) ? true : /^\W*no\b/i.test(text) ? false : null;
    return { verdict, raw: text.slice(0, 40), status: response.status };
  }
  return { verdict: null, raw: 'exhausted', status: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('judge.ts')) {
  const runs = readFileSync(IN, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.error === null);
  const done = existsSync(OUT) ? new Set(readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).run)) : new Set<string>();
  const todo = runs.filter((r) => !done.has(r.run));
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < todo.length) {
      const run = todo[next++]!;
      const result = await judge(run);
      appendFileSync(OUT, `${JSON.stringify({ run: run.run, block: run.block, arm: run.arm, rep: run.rep, ...result })}\n`);
    }
  }));
  console.log(`judged ${todo.length}`);
}

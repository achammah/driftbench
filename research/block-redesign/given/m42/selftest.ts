/** M4.2 offline checks: round trip on three wires, and equality with the repo adapter's Anthropic history. */
import { canonicalJson, type Message } from '@agent-nexus/driftbench-core';
import { toAnthropicMessages } from '../../../../packages/adapters/src/anthropic/messages';
import { WireNames as AdapterNames } from '../../../../packages/adapters/src/anthropic/common';
import { BLOCKS, givenOf, prose } from '../H6/blocks';
import { fromAnthropic, fromChat, fromResponses, toAnthropic, toChat, toResponses, WireNames } from './compile';
import { readFileSync } from 'node:fs';

const histories: { name: string; history: Message[] }[] = [];
for (const block of BLOCKS) for (const arm of ['record', 'prose'] as const) histories.push({ name: `h6:${block.id}:${arm}`, history: [...givenOf(block, arm).prefix, { role: 'user', content: block.ask }] });
const h9 = JSON.parse(readFileSync('research/block-redesign/given/H9/results.json', 'utf8'));
// H9 clean recorded prefixes are in results only as metadata; rebuild a few shapes here: an error result, two calls in one turn.
histories.push({ name: 'error-and-two-calls', history: [
  { role: 'user', content: 'check 7 Quarry Lane' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'a1', label: 'coverage.check', input: { address: '7 Quarry Lane' }, error: 'coverage service timeout' }, { id: 'a2', label: 'coverage.check', input: { address: '7 Quarry Lane' }, error: 'coverage service timeout' }] },
  { role: 'assistant', content: 'The coverage service is not responding.' },
  { role: 'user', content: 'ok' },
] });
void h9;
const norm = (h: Message[]) => canonicalJson(h.map((m) => ({ ...m, ...(m.tool_calls ? { tool_calls: m.tool_calls.map((c) => ({ ...c, input: c.input ?? {} })) } : {}) })));
// Merge rule: an assistant text right after the assistant's tool calls folds into that message, as the runner records it.
const fold = (h: Message[]): Message[] => {
  const out: Message[] = [];
  for (const m of h) {
    const last = out.at(-1);
    if (m.role === 'assistant' && !m.tool_calls && last?.role === 'assistant' && last.tool_calls && last.content === '') last.content = m.content;
    else out.push(structuredClone(m));
  }
  return out;
};
let ok = 0, fail = 0; const failures: string[] = [];
for (const { name, history } of histories) {
  const want = norm(fold(history));
  for (const [wire, back] of [
    ['anthropic', (n: WireNames) => fromAnthropic(toAnthropic(history, n).messages, n)],
    ['responses', (n: WireNames) => fromResponses(toResponses(history, n), n)],
    ['chat', (n: WireNames) => fromChat(toChat(history, n), n)],
  ] as const) {
    const got = norm(back(new WireNames()));
    if (got === want) ok++; else { fail++; failures.push(`${name} ${wire}\n want ${want}\n got  ${got}`); }
  }
}
// Equality with the adapter on the H6 record arm (the adapter writes string outputs raw and JSON otherwise; all H6 outputs are objects).
let same = 0, differ = 0;
for (const { name, history } of histories.filter((h) => h.name.startsWith('h6:'))) {
  const a = toAnthropicMessages(history, new AdapterNames(['coverage.check', 'catalog.search', 'port.check', 'order.create', 'notify_sales'], /[a-zA-Z0-9_-]/)).messages;
  const b = toAnthropic(history, new WireNames()).messages;
  if (canonicalJson(a) === canonicalJson(b)) same++; else { differ++; if (differ <= 2) failures.push(`adapter differs on ${name}\n adapter ${canonicalJson(a)}\n m42     ${canonicalJson(b)}`); }
}
console.log({ roundtrip_ok: ok, roundtrip_fail: fail, adapter_same: same, adapter_differ: differ });
for (const f of failures.slice(0, 6)) console.log(f);
console.log(prose('catalog.search', BLOCKS[3]!.output));

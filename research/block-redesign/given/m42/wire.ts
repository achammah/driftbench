/**
 * M4.2 wire checks (paid, a few cents): rendered histories against the real Anthropic and OpenAI endpoints.
 *   npx tsx research/block-redesign/given/m42/wire.ts
 * Writes m42/wire-results.json; usage lines go to ../calls.jsonl for the ledger.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@agent-nexus/driftbench-core';
import { AGENT_MODEL, loggingClient } from '../agent/acme-live';
import { BLOCKS, givenOf } from '../H6/blocks';
import { toAnthropic, toChat, toResponses, WireNames } from './compile';

const DIR = 'research/block-redesign/given';
const LOG = `${DIR}/calls.jsonl`;
const OPENAI_MODEL = 'gpt-6-luna';
const LABELS = ['coverage.check', 'catalog.search', 'port.check', 'order.create', 'notify_sales'];
const OK: Message = { role: 'user', content: 'Reply with the single word OK.' };

let current = 'm42-wire';
const anthropic = loggingClient(LOG, () => current);
const openaiKey = readFileSync(join(homedir(), '.nexus-secrets', 'openai.key'), 'utf8').trim();

function anthropicTools(names: WireNames) {
  return LABELS.map((label) => ({ name: names.wire(label), description: `Acme tool ${label}.`, input_schema: { type: 'object' as const, properties: {} } }));
}

async function tryAnthropic(history: Message[], strip = false) {
  const names = new WireNames();
  const rendered = toAnthropic(history, names).messages;
  // strip: drop every tool_result block on the wire (the compiler itself never leaves a call unanswered).
  const messages = strip ? rendered.map((m) => ({ ...m, content: m.content.filter((b) => b.type !== 'tool_result') })).filter((m) => m.content.length > 0) : rendered;
  try {
    const answer = await anthropic.messages.create({ model: AGENT_MODEL, max_tokens: 512, messages: messages as never, tools: anthropicTools(names) } as never);
    return { status: 200, text: (answer.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 80) };
  } catch (error) {
    const e = error as { status?: number; message?: string };
    return { status: e.status ?? null, text: (e.message ?? String(error)).slice(0, 300) };
  }
}

async function openai(path: string, body: unknown) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json()) as Record<string, unknown>;
  const usage = (json.usage ?? {}) as Record<string, number>;
  appendFileSync(LOG, `${JSON.stringify({ run: current, model: OPENAI_MODEL, request_id: response.headers.get('x-request-id'), input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0, output_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0, provider: 'openai', status: response.status })}\n`);
  const error = (json.error as { message?: string } | undefined)?.message;
  return { status: response.status, text: (error ?? '').slice(0, 300) };
}

async function tryResponses(history: Message[], strip = false) {
  const names = new WireNames();
  const input = toResponses(history, names);
  const tools = LABELS.map((label) => ({ type: 'function', name: names.wire(label), description: `Acme tool ${label}.`, parameters: { type: 'object', properties: {} } }));
  return openai('responses', { model: OPENAI_MODEL, input: strip ? input.filter((item) => !('type' in item && item.type === 'function_call_output')) : input, tools, max_output_tokens: 256 });
}

async function tryChat(history: Message[], strip = false) {
  const names = new WireNames();
  const messages = toChat(history, names);
  const tools = LABELS.map((label) => ({ type: 'function', function: { name: names.wire(label), description: `Acme tool ${label}.`, parameters: { type: 'object', properties: {} } } }));
  return openai('chat/completions', { model: OPENAI_MODEL, messages: strip ? stripChat(messages) : messages, tools, max_completion_tokens: 256, reasoning_effort: 'none' });
}

const record = BLOCKS.map((block) => ({ id: block.id, history: [...givenOf(block, 'record').prefix, OK] }));
const unpaired: Message[] = structuredClone(record[0]!.history);
delete unpaired[1]!.tool_calls![0]!.output;
const duplicate: Message[] = [
  { role: 'user', content: 'Do you have fiber at 21 Linden Court, Acmeville?' },
  { role: 'assistant', content: 'I have the result.', tool_calls: [{ id: 'call-1', label: 'coverage.check', input: { address: '21 Linden Court, Acmeville' }, output: { found: true, fiber_mbps: 750 } }] },
  { role: 'user', content: 'And mobile plans?' },
  { role: 'assistant', content: 'I have the result.', tool_calls: [{ id: 'call-1', label: 'catalog.search', input: { category: 'mobile' }, output: { plans: [{ id: 'mobile-s', monthly_usd: 17 }] } }] },
  OK,
];

function stripChat(messages: ReturnType<typeof toChat>) {
  return messages.filter((m) => m.role !== 'tool');
}

/** Run 2 (written reason in RESULTS): run 1 sent no unpaired history, because the compiler answers a call with no result by "null"; and the chat wire refused tools under the model's default reasoning effort. */
const RUN = process.argv[2] === 'run2' ? 2 : 1;
const results: Record<string, unknown>[] = [];
if (RUN === 2) {
  current = 'm42-wire2:anthropic:unpaired';
  results.push({ check: 2, wire: 'anthropic', id: 'unpaired-on-wire', ...(await tryAnthropic(record[0]!.history, true)) });
  current = 'm42-wire2:responses:unpaired';
  results.push({ check: 4, wire: 'openai-responses', id: 'unpaired-on-wire', ...(await tryResponses(record[0]!.history, true)) });
  current = 'm42-wire2:chat:unpaired';
  results.push({ check: 4, wire: 'openai-chat', id: 'unpaired-on-wire', ...(await tryChat(record[0]!.history, true)) });
  for (const { id, history } of record) {
    current = `m42-wire2:chat:${id}`;
    results.push({ check: 4, wire: 'openai-chat', id, ...(await tryChat(history)) });
  }
  current = 'm42-wire2:chat:duplicate';
  results.push({ check: 4, wire: 'openai-chat', id: 'duplicate', ...(await tryChat(duplicate)) });
  current = 'm42-wire2:chat:null-result';
  results.push({ check: 4, wire: 'openai-chat', id: 'null-result', ...(await tryChat(unpaired)) });
  writeFileSync(`${DIR}/m42/wire-results-run2.json`, `${JSON.stringify({ generated: new Date().toISOString(), anthropic_model: AGENT_MODEL, openai_model: OPENAI_MODEL, results }, null, 1)}\n`);
  for (const r of results) console.log(r.check, r.wire, r.id, r.status, String(r.text).slice(0, 160));
  process.exit(0);
}
for (const { id, history } of record) {
  current = `m42-wire:anthropic:${id}`;
  results.push({ check: 1, wire: 'anthropic', id, ...(await tryAnthropic(history)) });
}
current = 'm42-wire:anthropic:unpaired';
results.push({ check: 2, wire: 'anthropic', id: 'unpaired', ...(await tryAnthropic(unpaired)) });
current = 'm42-wire:anthropic:duplicate';
results.push({ check: 3, wire: 'anthropic', id: 'duplicate', ...(await tryAnthropic(duplicate)) });
for (const { id, history } of record) {
  current = `m42-wire:responses:${id}`;
  results.push({ check: 4, wire: 'openai-responses', id, ...(await tryResponses(history)) });
  current = `m42-wire:chat:${id}`;
  results.push({ check: 4, wire: 'openai-chat', id, ...(await tryChat(history)) });
}
for (const [id, history] of [['unpaired', unpaired], ['duplicate', duplicate]] as const) {
  current = `m42-wire:responses:${id}`;
  results.push({ check: 4, wire: 'openai-responses', id, ...(await tryResponses(history)) });
  current = `m42-wire:chat:${id}`;
  results.push({ check: 4, wire: 'openai-chat', id, ...(await tryChat(history)) });
}
writeFileSync(`${DIR}/m42/wire-results.json`, `${JSON.stringify({ generated: new Date().toISOString(), anthropic_model: AGENT_MODEL, openai_model: OPENAI_MODEL, results }, null, 1)}\n`);
for (const r of results) console.log(r.check, r.wire, r.id, r.status, String(r.text).slice(0, 140));

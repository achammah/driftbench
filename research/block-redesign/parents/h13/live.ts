// Research stand-in: the Acme sales assistant on a live model. The policy of examples/acme/src/policy.ts is
// written as a system prompt (agent-prompt.md); the five tools are the real implementations of
// examples/acme/src/tools.ts over a fresh store per conversation. Scoring is deterministic.
import { readFileSync } from 'node:fs';
import { createStore } from '../../../../examples/acme/src/store';
import { callTool, type ToolLabel } from '../../../../examples/acme/src/tools';

const HERE = new URL('.', import.meta.url).pathname;
export const MODEL = 'claude-haiku-5-5';
const SYSTEM = readFileSync(`${HERE}agent-prompt.md`, 'utf8');
const TOOLS = JSON.parse(readFileSync(`${HERE}tools.json`, 'utf8'));
const LABEL: Record<string, ToolLabel> = {
  catalog_search: 'catalog.search',
  coverage_check: 'coverage.check',
  port_check: 'port.check',
  order_create: 'order.create',
  notify_sales: 'notify_sales',
};

export type Usage = { input: number; output: number; cache_write: number; cache_read: number; calls: number };
export type Call = { label: string; input: Record<string, unknown>; output?: unknown; error?: string };
export type TurnResult = { user: string; reply: string; calls: Call[]; capped: boolean };
export type Turn = { user: string; given?: { world?: { tools?: Record<string, { error?: string; result?: unknown }> } } | null };

export const zeroUsage = (): Usage => ({ input: 0, output: 0, cache_write: 0, cache_read: 0, calls: 0 });

async function post(body: unknown, key: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();
      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
    } catch (e: any) {
      if (/^anthropic 4/.test(String(e.message)) || attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
}

/** Runs a conversation turn by turn on a fresh store. Returns one result per user turn, and the token usage. */
export async function converse(turns: Turn[], key: string): Promise<{ results: TurnResult[]; usage: Usage; store: unknown }> {
  const store = createStore();
  const usage = zeroUsage();
  const messages: any[] = [];
  const results: TurnResult[] = [];
  for (const turn of turns) {
    messages.push({ role: 'user', content: turn.user });
    const calls: Call[] = [];
    let reply = '';
    let capped = false;
    for (let i = 0; ; i++) {
      if (i >= 6) {
        capped = true;
        break;
      }
      const res = await post({ model: MODEL, max_tokens: 700, system: SYSTEM, tools: TOOLS, messages }, key);
      usage.calls++;
      usage.input += res.usage?.input_tokens ?? 0;
      usage.output += res.usage?.output_tokens ?? 0;
      usage.cache_write += res.usage?.cache_creation_input_tokens ?? 0;
      usage.cache_read += res.usage?.cache_read_input_tokens ?? 0;
      messages.push({ role: 'assistant', content: res.content });
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      const uses = res.content.filter((b: any) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || uses.length === 0) {
        reply = text;
        break;
      }
      const out: any[] = [];
      for (const u of uses) {
        const label = LABEL[u.name];
        const override = label ? turn.given?.world?.tools?.[label] : undefined;
        const o = label
          ? callTool(label, u.input ?? {}, { store, override, commit: true })
          : ({ ok: false, error: `unknown tool ${u.name}` } as const);
        calls.push(o.ok ? { label: label ?? u.name, input: u.input, output: o.output } : { label: label ?? u.name, input: u.input, error: o.error });
        out.push({ type: 'tool_result', tool_use_id: u.id, content: o.ok ? JSON.stringify(o.output) : o.error, ...(o.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: 'user', content: out });
    }
    results.push({ user: turn.user, reply, calls, capped });
  }
  return { results, usage, store };
}

// ---------------------------------------------------------------- scoring
const norm = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/[*_`]/g, '').replace(/\s+/g, ' ').toLowerCase();

function deepMatch(expected: any, actual: any, closed = false): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if ('absent' in expected && Object.keys(expected).length === 1) return actual === undefined;
    if ('subset' in expected && Object.keys(expected).length === 1) return deepMatch(expected.subset, actual, false);
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    if (closed && Object.keys(actual).sort().join() !== Object.keys(expected).sort().join()) return false;
    return Object.entries(expected).every(([k, v]) => deepMatch(v, actual[k], false));
  }
  if (typeof expected === 'string' && typeof actual === 'string') return expected.trim().toLowerCase() === actual.trim().toLowerCase();
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export type Expect = { tools: { label: string; count: number; input?: Record<string, unknown> }[]; must: string[]; must_not: string[] };

/** A block passes when its tool expectations, the forbidden tools, `must` and `must_not` all hold. Stage, language, guards and criteria are not checked. */
export function scoreBlock(expect: Expect, forbidden: string[], r: TurnResult): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.capped) reasons.push('tool loop cap');
  for (const t of expect.tools ?? []) {
    const mine = r.calls.filter((c) => c.label === t.label);
    if (mine.length !== t.count) reasons.push(`tool ${t.label}: ${mine.length} calls, expected ${t.count}`);
    else if (t.input && t.count > 0 && !mine.some((c) => deepMatch(t.input, c.input, (t as any).input_closed === true))) reasons.push(`tool ${t.label}: input differs`);
  }
  for (const f of forbidden) if (r.calls.some((c) => c.label === f)) reasons.push(`forbidden tool ${f}`);
  const text = norm(r.reply);
  for (const m of expect.must ?? []) {
    const pat = norm(m).replace(/\\\$/g, '\\$');
    let ok: boolean;
    try {
      ok = new RegExp(pat, 'i').test(text);
    } catch {
      ok = text.includes(norm(m));
    }
    if (!ok) reasons.push(`must: ${m}`);
  }
  for (const m of expect.must_not ?? []) if (text.includes(norm(m))) reasons.push(`must_not: ${m}`);
  return { pass: reasons.length === 0, reasons };
}

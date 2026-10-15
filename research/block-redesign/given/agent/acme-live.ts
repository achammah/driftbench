/**
 * The Acme Telecom sales agent live on a Claude model, through the repo's anthropic adapter: a system prompt,
 * the five Acme tools over a fresh store per session, and a client that logs the usage of every call for
 * the ledger. Research code for the given lane (H6, H8, M4.2).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '../../../../node_modules/.pnpm/@anthropic-ai+sdk@0.133.0_zod@4.6.5/node_modules/@anthropic-ai/sdk/index.mjs';
import { anthropicAdapter, type SdkTool } from '../../../../packages/adapters/src/anthropic/index';
import type { AnthropicClientLike } from '../../../../packages/adapters/src/anthropic/messages';
import { callTool, createStore, isToolLabel } from '../../../../examples/acme/src/index';

export const AGENT_MODEL = 'claude-haiku-5-5';
/** Published price, first-party API, prompts up to 100K tokens (USD per million tokens); above 100K: 0.50 / 2.50. */
export const PRICE = { inLow: 0.1, outLow: 0.5, inHigh: 0.5, outHigh: 2.5, threshold: 100_000 };

export const SYSTEM_PROMPT = `You are the sales assistant of Acme Telecom, a fictional telecom in Acmeville. You help customers with mobile plans, home internet (fiber and 5G), moving a phone number to Acme, and orders.

Rules:
- State a fact about coverage, speeds, plans, prices, number transfers, orders or callbacks only when it comes from a tool result or from the customer in this conversation. Never invent one.
- Tools: coverage.check checks an address; catalog.search lists plans (category mobile or home, optionally an address_id or the customer's email); port.check checks whether a number can move to Acme; order.create places an order, only after the customer has typed CONFIRM; notify_sales hands the customer to a human advisor for a callback.
- Ask at most one question per turn. Answer in plain, short sentences.`;

const DESCRIPTIONS: Record<string, string> = {
  'catalog.search': 'Plans of a category (mobile or home), the ones available at an address, and the customer plan.',
  'coverage.check': 'Fiber and 5G coverage at a street address.',
  'port.check': 'Whether a phone number can move to Acme.',
  'order.create': 'Places an order: a new line, a home plan, an upgrade or a port.',
  notify_sales: 'Sends a lead to the sales team for a callback.',
};

const SCHEMAS: Record<string, Record<string, unknown>> = {
  'catalog.search': { type: 'object', properties: { category: { type: 'string', enum: ['mobile', 'home'] }, address_id: { type: 'string' }, customer_email: { type: 'string' } }, required: ['category'] },
  'coverage.check': { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] },
  'port.check': { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] },
  'order.create': { type: 'object', properties: { type: { type: 'string', enum: ['new', 'upgrade'] }, plan_id: { type: 'string' }, customer_id: { type: 'string' }, customer: { type: 'object' }, address_id: { type: 'string' }, port_number: { type: 'string' } }, required: ['type', 'plan_id'] },
  notify_sales: { type: 'object', properties: { reason: { type: 'string', enum: ['callback', 'no_coverage', 'tool_failure', 'order_failed'] }, customer: { type: 'object' }, summary: { type: 'string' } }, required: ['reason', 'customer', 'summary'] },
};

/** The five Acme tools over a fresh store; a forced `world.tools` result is applied by the adapter first. */
export function acmeTools(withTools = true): SdkTool[] {
  if (!withTools) return [];
  const store = createStore();
  return Object.keys(DESCRIPTIONS).map((label) => ({
    name: label,
    description: DESCRIPTIONS[label],
    inputSchema: SCHEMAS[label],
    run: (input, context) => {
      if (!isToolLabel(label)) throw new Error(`unknown tool ${label}`);
      const outcome = callTool(label, (input ?? {}) as Record<string, unknown>, { store, seed: context.world.store, commit: true });
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.output;
    },
  }));
}

export function anthropicKey(): string {
  return readFileSync(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8').trim();
}

export type CallLog = {
  run: string;
  model: string;
  request_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  stop_reason: string | null;
  usd: number;
};

export function usdOf(input: number, output: number): number {
  const high = input > PRICE.threshold;
  return (input * (high ? PRICE.inHigh : PRICE.inLow) + output * (high ? PRICE.outHigh : PRICE.outLow)) / 1e6;
}

/** A client that answers through the real SDK and appends one usage line per call to `logPath`. */
export function loggingClient(logPath: string, run: () => string): AnthropicClientLike & { raw: Anthropic } {
  const raw = new Anthropic({ apiKey: anthropicKey(), maxRetries: 0, timeout: 120_000 });
  return {
    raw,
    messages: {
      async create(body, options) {
        const response = await raw.messages.create(body as never, { maxRetries: options?.maxRetries ?? 0, signal: options?.signal });
        const usage = (response as { usage?: Record<string, number | null> }).usage ?? {};
        const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        const line: CallLog = {
          run: run(),
          model: body.model,
          request_id: (response as { _request_id?: string | null })._request_id ?? null,
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          cache_read: usage.cache_read_input_tokens ?? 0,
          cache_write: usage.cache_creation_input_tokens ?? 0,
          stop_reason: (response as { stop_reason?: string | null }).stop_reason ?? null,
          usd: usdOf(input, usage.output_tokens ?? 0),
        };
        appendFileSync(logPath, `${JSON.stringify(line)}\n`);
        return response as never;
      },
    },
  };
}

export function acmeLiveAdapter(client: AnthropicClientLike, options: { withTools?: boolean; maxTokens?: number } = {}) {
  return anthropicAdapter({
    client,
    model: AGENT_MODEL,
    system: SYSTEM_PROMPT,
    tools: () => acmeTools(options.withTools ?? true),
    maxTokens: options.maxTokens ?? 4096,
    maxSteps: 6,
  });
}

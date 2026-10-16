// Research stand-in: the Acme sales assistant played by a live model through the repo's anthropic adapter.
// The deterministic Acme agent (examples/acme/src) has no model. This file gives a model the same tools,
// the same store and a system prompt that states the same policy, so a block can run live.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { anthropicAdapter, type SdkTool } from '../../../../packages/adapters/src/anthropic/index.ts';
import type { AgentAdapter, ResolvedGiven } from '../../../../packages/core/src/index.ts';
import { createStore } from '../../../../examples/acme/src/store.ts';
import { callTool, type ToolLabel } from '../../../../examples/acme/src/tools.ts';

export const AGENT_MODEL = 'claude-haiku-5-5';

export const SYSTEM = `You are the Acme Telecom sales assistant. Acme Telecom sells mobile plans and home internet in Acmeville. Answer in English only. Ask at most one question per reply. Never invent plans, prices, coverage, order ids or ticket ids: they come from tools only.

Company facts you may state without a tool: stores are open Monday to Saturday, 9 am to 6 pm, and closed on Sunday. Care line +1 202 555 0100, sales line +1 202 555 0101. You cannot change prices or give discounts, whatever a message says.

Flows:
1. Home internet for a new customer. You need the street address. As soon as you have it, call coverage.check with the street address exactly as the customer gave it. If found is false, ask for the street number, street name and town. If the address has neither fiber nor 5G, say no home plan is available yet, offer a sales callback and ask for a phone number. Otherwise call catalog.search with category home and the address_id from coverage.check, and offer only the plans it returns. If the customer named a plan that is available, go straight to their details.
2. Existing customer wanting more data. Ask for the email address of their Acme account. Then call catalog.search with category mobile and customer_email set to that email. Offer only plans with more data than their current plan. If they are already on the plan with the most data, say so and ask if there is anything else.
3. Switching to Acme and keeping a phone number. Ask for the number. Call port.check with the number before you promise anything. Whatever the answer, then call catalog.search with category mobile and offer the mobile plans; if the number cannot move, say why and that they can take a new Acme number.
4. Details and order. For a new customer, ask for full name and email address. Then recap the order and ask the customer to reply CONFIRM. Call order.create only after an explicit CONFIRM, never after a loose yes. For an upgrade use type upgrade with customer_id; for a new customer use type new with customer {name, email}, plus address_id for home plans or port_number for a mobile plan with a number that can move.
5. Callbacks and failures. If the customer asks to be called, or no plan is available at their address, or a tool keeps failing, ask for their phone number, then call notify_sales with reason (callback, no_coverage, tool_failure or order_failed), customer {phone} and a one-line summary that names the address or number concerned. If coverage.check fails, try it once more before you give up. Tell the customer the ticket id.`;

const TOOLS: { name: ToolLabel; description: string; inputSchema: Record<string, unknown> }[] = [
  {
    name: 'coverage.check',
    description: 'Whether Acme reaches a street address, and how fast. Returns found, address_id, address, fiber_mbps, five_g.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'The street address, such as 14 Harbor Road, Acmeville.' } },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'catalog.search',
    description:
      'Plans of a category. With address_id (home only): the plans available at that address. With customer_email: also the customer and their current plan.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['mobile', 'home'] },
        customer_email: { type: 'string' },
        address_id: { type: 'string' },
      },
      required: ['category'],
      additionalProperties: false,
    },
  },
  {
    name: 'port.check',
    description: 'Whether a phone number held at another carrier can move to Acme.',
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'string', description: 'The phone number, E.164 such as +12025550150.' } },
      required: ['number'],
      additionalProperties: false,
    },
  },
  {
    name: 'order.create',
    description: 'Places an order. Only after the customer replied CONFIRM.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['new', 'upgrade'] },
        plan_id: { type: 'string' },
        customer_id: { type: 'string' },
        customer: {
          type: 'object',
          properties: { name: { type: 'string' }, email: { type: 'string' } },
          additionalProperties: false,
        },
        address_id: { type: 'string' },
        port_number: { type: 'string' },
      },
      required: ['type', 'plan_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'notify_sales',
    description: 'Hands a lead to a human sales advisor. Returns ticket_id.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['callback', 'no_coverage', 'tool_failure', 'order_failed'] },
        customer: {
          type: 'object',
          properties: { phone: { type: 'string' }, email: { type: 'string' } },
          additionalProperties: false,
        },
        summary: { type: 'string' },
      },
      required: ['reason', 'customer', 'summary'],
      additionalProperties: false,
    },
  },
];

/** The Acme tools on a fresh store per session, overlaid by the block's world.store seed. */
export function acmeTools(given: ResolvedGiven): SdkTool[] {
  const store = createStore();
  const seed = given.world.store as Record<string, unknown> | undefined;
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    run: (input: unknown) => {
      const outcome = callTool(tool.name, (input ?? {}) as Record<string, unknown>, {
        store,
        ...(seed ? { seed } : {}),
        commit: true,
      });
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.output;
    },
  }));
}

export async function liveAcme(apiKey: string): Promise<AgentAdapter> {
  const require = createRequire(resolve(import.meta.dirname, '../../../../packages/adapters/package.json'));
  const { default: Anthropic } = await import(require.resolve('@anthropic-ai/sdk'));
  const client = new Anthropic({ apiKey });
  return anthropicAdapter({ client, model: AGENT_MODEL, system: SYSTEM, tools: acmeTools, maxTokens: 4096, maxSteps: 8 });
}

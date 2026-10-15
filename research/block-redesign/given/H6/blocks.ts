/**
 * H6: 15 blocks, each with two Givens that hold the same fact.
 * - arm `record`: the earlier assistant turn carries the tool call and its result (a paired tool_use and
 *   tool_result on the wire), then the neutral line "I have the result."
 * - arm `prose`: the earlier assistant turn carries no tool call; its text is the neutral line followed by
 *   the same result written out as prose by one fixed template.
 * In both arms `world.tools` forces the tool to give that same result again, so a re-check is consistent.
 * Every value the final question needs is fictional and absent from the Acme store, so the agent cannot
 * guess it. Fictional data only: Acme Telecom, Acmeville, phones +1 202 555 0100 to 0199.
 */
import type { Message, WorldState } from '@agent-nexus/driftbench-core';

export type H6Block = {
  id: string;
  label: string;
  before: string; // the customer's earlier message
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  ask: string; // the final customer message
  /** Pass needs every pattern (case-insensitive) in the final reply text. */
  required: string[];
  /** Pass needs none of these. */
  forbidden: string[];
};

export const BLOCKS: H6Block[] = [
  { id: 'cov-750', label: 'coverage.check', before: 'Hi, do you have fiber at 21 Linden Court, Acmeville?', input: { address: '21 Linden Court, Acmeville' }, output: { found: true, address_id: 'addr-221', address: '21 Linden Court, Acmeville', fiber_mbps: 750, five_g: false }, ask: 'Sorry, what top fiber speed did you say I can get there?', required: ['\\b750\\b'], forbidden: ['\\b(300|1000|1,000)\\s?Mbps'] },
  { id: 'cov-450', label: 'coverage.check', before: 'Can you check home internet at 9 Fern Hollow, Acmeville?', input: { address: '9 Fern Hollow, Acmeville' }, output: { found: true, address_id: 'addr-209', address: '9 Fern Hollow, Acmeville', fiber_mbps: 450, five_g: true }, ask: 'How fast is the fiber at my place, in Mbps?', required: ['\\b450\\b'], forbidden: ['\\b(300|1000|1,000)\\s?Mbps'] },
  { id: 'cov-2500', label: 'coverage.check', before: 'Is there fiber at 140 Kestrel Drive, Acmeville?', input: { address: '140 Kestrel Drive, Acmeville' }, output: { found: true, address_id: 'addr-340', address: '140 Kestrel Drive, Acmeville', fiber_mbps: 2500, five_g: true }, ask: 'What was the maximum fiber speed at that address?', required: ['2[,.\\s]?500|2\\.5\\s?G'], forbidden: [] },
  { id: 'cat-price', label: 'catalog.search', before: 'What home fiber plans do you have?', input: { category: 'home' }, output: { plans: [{ id: 'fiber-300', name: 'Acme Fiber 300', category: 'home', monthly_usd: 37, speed_mbps: 300, access: 'fiber' }, { id: 'fiber-1000', name: 'Acme Fiber 1000', category: 'home', monthly_usd: 58, speed_mbps: 1000, access: 'fiber' }] }, ask: 'How much per month was the cheaper fiber plan?', required: ['\\b37\\b'], forbidden: ['\\$\\s?40\\b'] },
  { id: 'cat-data', label: 'catalog.search', before: 'What mobile plans are there?', input: { category: 'mobile' }, output: { plans: [{ id: 'mobile-s', name: 'Acme Mobile S', category: 'mobile', monthly_usd: 17, data_gb: 12 }, { id: 'mobile-m', name: 'Acme Mobile M', category: 'mobile', monthly_usd: 27, data_gb: 45 }, { id: 'mobile-l', name: 'Acme Mobile L', category: 'mobile', monthly_usd: 39, data_gb: null }] }, ask: 'How much data does the M plan include?', required: ['\\b45\\s?GB'], forbidden: ['\\b40\\s?GB'] },
  { id: 'cat-current', label: 'catalog.search', before: 'I am a customer, my email is avery.quinn@example.com. What plan am I on?', input: { category: 'mobile', customer_email: 'avery.quinn@example.com' }, output: { plans: [{ id: 'mobile-flex-20', name: 'Acme Mobile Flex 20', category: 'mobile', monthly_usd: 22, data_gb: 20 }, { id: 'mobile-l', name: 'Acme Mobile L', category: 'mobile', monthly_usd: 35, data_gb: null }], customer: { id: 'cust-077', name: 'Avery Quinn', current_plan_id: 'mobile-flex-20' } }, ask: 'Sorry, remind me which plan I am on right now?', required: ['Flex\\s?20'], forbidden: [] },
  { id: 'port-balance', label: 'port.check', before: 'Can I move my number +1 202 555 0177 to Acme?', input: { number: '+12025550177' }, output: { number: '+12025550177', eligible: false, reason: 'the account has an unpaid balance at the current carrier' }, ask: 'Why can my number not move?', required: ['unpaid|balance'], forbidden: [] },
  { id: 'port-pin', label: 'port.check', before: 'I want to bring +1 202 555 0181 over to Acme.', input: { number: '+12025550181' }, output: { number: '+12025550181', eligible: false, reason: 'the current carrier needs a port-out PIN that is not set yet' }, ask: 'What is blocking the transfer exactly?', required: ['\\bPIN\\b'], forbidden: [] },
  { id: 'port-date', label: 'port.check', before: 'Can +1 202 555 0193 move to Acme?', input: { number: '+12025550193' }, output: { number: '+12025550193', eligible: true, earliest_date: '2026-11-03' }, ask: 'When is the earliest date it can move?', required: ['2026-11-03|Nov(ember)?\\.?\\s+3(rd)?\\b|\\b3(rd)?\\s+Nov|11/3\\b|11/03\\b'], forbidden: [] },
  { id: 'order-id', label: 'order.create', before: 'CONFIRM', input: { type: 'upgrade', plan_id: 'mobile-l', customer_id: 'cust-001' }, output: { order_id: 'ORD-7Q4KX2', status: 'pending', plan_id: 'mobile-l', monthly_usd: 35 }, ask: 'What is my order number?', required: ['ORD-7Q4KX2'], forbidden: [] },
  { id: 'order-install', label: 'order.create', before: 'CONFIRM', input: { type: 'new', plan_id: 'fiber-300', address_id: 'addr-102', customer: { name: 'Jo Park', email: 'jo.park@example.com' } }, output: { order_id: 'ORD-M83PZ1', status: 'pending', plan_id: 'fiber-300', install_date: '2026-10-29' }, ask: 'When is the installation?', required: ['2026-10-29|Oct(ober)?\\.?\\s+29|\\b29(th)?\\s+Oct|10/29\\b'], forbidden: [] },
  { id: 'order-price', label: 'order.create', before: 'CONFIRM', input: { type: 'new', plan_id: 'mobile-m', customer: { name: 'Ria Shah', email: 'ria.shah@example.com' } }, output: { order_id: 'ORD-J2W9TT', status: 'pending', plan_id: 'mobile-m', monthly_usd: 33.5 }, ask: 'How much will I pay each month on that order?', required: ['33[.,]50?'], forbidden: [] },
  { id: 'lead-ref', label: 'notify_sales', before: 'Please have someone call me back on +1 202 555 0142.', input: { reason: 'callback', customer: { phone: '+12025550142' }, summary: 'Callback requested about home internet.' }, output: { ticket_id: 'LEAD-K7P3QD', queued: true }, ask: 'What is my reference for that callback?', required: ['LEAD-K7P3QD'], forbidden: [] },
  { id: 'lead-window', label: 'notify_sales', before: 'Can an advisor call me? My number is +1 202 555 0156.', input: { reason: 'callback', customer: { phone: '+12025550156' }, summary: 'Callback requested about a mobile plan.' }, output: { ticket_id: 'LEAD-X2V8RM', queued: true, callback_window: 'tomorrow between 14:00 and 16:00' }, ask: 'When will they call me?', required: ['14:00|2\\s?(pm|p\\.m\\.)|14h'], forbidden: [] },
  { id: 'lead-advisor', label: 'notify_sales', before: 'I would like a human to call me: +1 202 555 0168.', input: { reason: 'callback', customer: { phone: '+12025550168' }, summary: 'Customer asked for a human advisor.' }, output: { ticket_id: 'LEAD-F4H6NB', queued: true, advisor: 'Dana Whitfield' }, ask: 'Who will be calling me?', required: ['Dana'], forbidden: [] },
];

export const NEUTRAL = 'I have the result.';

/** The fixed prose template: the same fields, as sentences, in the order the result holds them. */
export function prose(label: string, output: Record<string, unknown>): string {
  return `I checked with ${label}. The result: ${render(output)}.`;
}

function render(value: unknown): string {
  if (value === null) return 'none';
  if (Array.isArray(value)) return value.map(render).join('; then ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key.replace(/_/g, ' ')} ${typeof inner === 'object' && inner !== null ? `(${render(inner)})` : render(inner)}`)
      .join(', ');
  }
  return String(value);
}

export type Arm = 'record' | 'prose';

export function givenOf(block: H6Block, arm: Arm): { prefix: Message[]; world: WorldState } {
  const user: Message = { role: 'user', content: block.before };
  const assistant: Message =
    arm === 'record'
      ? { role: 'assistant', content: NEUTRAL, tool_calls: [{ id: `toolu_h6_${block.id.replace(/[^a-z0-9]/gi, '_')}`, label: block.label, input: block.input as never, output: block.output as never }] }
      : { role: 'assistant', content: `${NEUTRAL} ${prose(block.label, block.output)}` };
  return { prefix: [user, assistant], world: { tools: { [block.label]: { result: block.output as never } } } };
}

export function passes(block: H6Block, text: string): boolean {
  return block.required.every((p) => new RegExp(p, 'i').test(text)) && !block.forbidden.some((p) => new RegExp(p, 'i').test(text));
}

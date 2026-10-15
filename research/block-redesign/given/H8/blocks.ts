/** H8 blocks: one stated fact, filler around it, a final message that needs it. Fictional data only. */
import type { Observed, WorldState } from '@agent-nexus/driftbench-core';

export type H8Block = {
  id: string;
  fact: string; // the customer's message stating the fact
  ack: string; // the assistant's acknowledgement
  ask: string; // the final customer message
  world?: WorldState;
  values: string[]; // the fact values, for filler_clean
  pass: (observed: Observed) => boolean;
};

const text = (re: RegExp) => (o: Observed) => re.test(o.text);

export const BLOCKS: H8Block[] = [
  { id: 'account', fact: 'Before anything else, my account number is AC-58213.', ack: 'Thanks, noted.', ask: 'What account number did I give you earlier?', values: ['AC-58213', '58213'], pass: text(/AC-58213/i) },
  {
    id: 'address',
    fact: 'My address is 46 Wren Gardens, Acmeville.',
    ack: 'Thanks, noted.',
    ask: 'Can you check if fiber is available at my address?',
    world: { tools: { 'coverage.check': { result: { found: true, address_id: 'addr-246', address: '46 Wren Gardens, Acmeville', fiber_mbps: 600, five_g: true } } } },
    values: ['46 Wren Gardens', 'Wren'],
    pass: (o) => o.toolCalls.some((c) => c.label === 'coverage.check' && /46 wren gardens/i.test(JSON.stringify(c.input ?? ''))),
  },
  { id: 'phone', fact: 'If you need to call me, use +1 202 555 0134.', ack: 'Thanks, noted.', ask: 'Which phone number did I say you should call me on?', values: ['555 0134', '0134'], pass: text(/555.?0134/) },
  { id: 'budget', fact: "I don't want to pay more than 23 dollars a month.", ack: 'Thanks, noted.', ask: 'What monthly budget did I mention?', values: ['23 dollars', ' 23 '], pass: text(/\b23\b/) },
  { id: 'carrier', fact: 'My current carrier is Bluefin Mobile.', ack: 'Thanks, noted.', ask: "Which carrier did I say I'm with now?", values: ['Bluefin'], pass: text(/Bluefin/i) },
];

export const SIZES = [2000, 4000, 16000, 64000] as const;
export const DEPTHS = [0, 0.25, 0.5, 0.75, 1] as const;

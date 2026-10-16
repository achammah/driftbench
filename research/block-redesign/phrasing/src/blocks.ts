// The ten blocks under test: Acme blocks whose Then depends on a slot value the user's message carries.
import { resolve } from 'node:path';
import { loadSpecFile } from '../../../../packages/core/src/index.ts';

export type SlotKind = 'phone' | 'email' | 'address' | 'plan';

export type Slot = {
  name: string;
  kind: SlotKind;
  /** The gold value, as the seed string writes it. */
  value: string;
  /** Surface forms by the slot_surface axis: canonical (the seed's), variant_a, variant_b. */
  forms: { canonical: string; variant_a: string; variant_b: string };
  /** A high-overlap value that must change the action (PAWS-style minimal pair). */
  minimal: string;
};

/** Where a slot value lands in a tool input, and how the spec asserts it. */
export type SlotField = {
  tool: string;
  /** Path inside the tool input, such as ['customer', 'phone']. */
  path: string[];
  /** The gold value the oracle snaps to when the normalised values agree. */
  gold: string;
  kind: SlotKind;
  /** equal: the field is the value. contains: the field is free text that must name the value. */
  mode: 'equal' | 'contains';
};

export type BlockDef = {
  id: string;
  spec: string;
  /** 0-based index of the block in the spec. */
  index: number;
  why: string;
  slots: Slot[];
  fields: SlotField[];
};

const phone = (digits: string, a: string, b: string, minimal: string): Slot => ({
  name: 'phone',
  kind: 'phone',
  value: `+1 202 555 ${digits}`,
  forms: { canonical: `+1 202 555 ${digits}`, variant_a: a, variant_b: b },
  minimal,
});

export const BLOCKS: BlockDef[] = [
  {
    id: 'B1',
    spec: 'examples/acme/specs/conversations/new-customer-coverage.yaml',
    index: 1,
    why: 'The user turn is only an address; coverage.check must receive it (regex ^88 Summit Avenue) and catalog.search must use the address_id it returns.',
    slots: [
      {
        name: 'address',
        kind: 'address',
        value: '88 Summit Avenue, Acmeville',
        forms: { canonical: '88 Summit Avenue, Acmeville', variant_a: '88 Summit Ave, Acmeville', variant_b: '88 summit avenue' },
        minimal: '8 Summit Avenue, Acmeville',
      },
    ],
    fields: [{ tool: 'coverage.check', path: ['address'], gold: '88 Summit Avenue, Acmeville', kind: 'address', mode: 'equal' }],
  },
  {
    id: 'B2',
    spec: 'examples/acme/specs/conversations/new-customer-coverage.yaml',
    index: 3,
    why: 'The user turn is only a callback phone; notify_sales must carry it (customer.phone exact +12025550131) and a summary naming the address.',
    slots: [phone('0131', '(202) 555-0131', '202.555.0131', '+1 202 555 0113')],
    fields: [
      { tool: 'notify_sales', path: ['customer', 'phone'], gold: '+12025550131', kind: 'phone', mode: 'equal' },
      { tool: 'notify_sales', path: ['summary'], gold: '88 Summit Avenue', kind: 'address', mode: 'contains' },
    ],
  },
  {
    id: 'B3',
    spec: 'examples/acme/specs/conversations/number-porting.yaml',
    index: 1,
    why: 'The user turn carries the number to port; port.check must receive it in E.164 (+12025550150, exact).',
    slots: [phone('0150', '(202) 555-0150', '2025550150', '+1 202 555 0105')],
    fields: [{ tool: 'port.check', path: ['number'], gold: '+12025550150', kind: 'phone', mode: 'equal' }],
  },
  {
    id: 'B4',
    spec: 'examples/acme/specs/conversations/plan-upgrade.yaml',
    index: 1,
    why: 'The user turn carries the account email; catalog.search must receive it as customer_email (exact).',
    slots: [
      {
        name: 'email',
        kind: 'email',
        value: 'sam.rivera@example.com',
        forms: { canonical: 'sam.rivera@example.com', variant_a: 'Sam.Rivera@example.com', variant_b: 'SAM.RIVERA@EXAMPLE.COM' },
        minimal: 'sam.rivers@example.com',
      },
    ],
    fields: [{ tool: 'catalog.search', path: ['customer_email'], gold: 'sam.rivera@example.com', kind: 'email', mode: 'equal' }],
  },
  {
    id: 'B5',
    spec: 'examples/acme/specs/conversations/order-loose-confirmation.yaml',
    index: 0,
    why: 'One turn carries two slots, a plan and an address; coverage.check must receive the address (regex 14 Harbor Road) and catalog.search addr-101.',
    slots: [
      {
        name: 'plan',
        kind: 'plan',
        value: 'Acme Fiber 1000',
        forms: { canonical: 'Acme Fiber 1000', variant_a: 'Fiber 1000', variant_b: 'the Fiber 1000 plan' },
        minimal: 'Acme Fiber 300',
      },
      {
        name: 'address',
        kind: 'address',
        value: '14 Harbor Road, Acmeville',
        forms: { canonical: '14 Harbor Road, Acmeville', variant_a: '14 Harbor Rd, Acmeville', variant_b: '14 harbor road' },
        minimal: '41 Harbor Road, Acmeville',
      },
    ],
    fields: [{ tool: 'coverage.check', path: ['address'], gold: '14 Harbor Road, Acmeville', kind: 'address', mode: 'equal' }],
  },
  {
    id: 'B6',
    spec: 'examples/acme/specs/conversations/off-topic-return.yaml',
    index: 0,
    why: 'First turn with an address inside a question; coverage.check must receive it (regex ^3 Orchard Way) and catalog.search addr-102.',
    slots: [
      {
        name: 'address',
        kind: 'address',
        value: '3 Orchard Way, Acmeville',
        forms: { canonical: '3 Orchard Way, Acmeville', variant_a: '3 Orchard Way Acmeville', variant_b: '3 orchard way' },
        minimal: '13 Orchard Way, Acmeville',
      },
    ],
    fields: [{ tool: 'coverage.check', path: ['address'], gold: '3 Orchard Way, Acmeville', kind: 'address', mode: 'equal' }],
  },
  {
    id: 'B7',
    spec: 'examples/acme/specs/conversations/tool-failure.yaml',
    index: 1,
    why: 'After a coverage failure the user gives a phone; notify_sales must carry it (subset phone +12025550188), reason tool_failure and a summary naming the address.',
    slots: [phone('0188', '(202) 555-0188', '202 555 0188', '+1 202 555 0181')],
    fields: [
      { tool: 'notify_sales', path: ['customer', 'phone'], gold: '+12025550188', kind: 'phone', mode: 'equal' },
      { tool: 'notify_sales', path: ['summary'], gold: '7 Quarry Lane', kind: 'address', mode: 'contains' },
    ],
  },
  {
    id: 'B8',
    spec: 'examples/acme/golden/specs/twise/gen-twise-023.yaml',
    index: 1,
    why: 'Generated golden block whose Then asserts the whole address string by exact equality (7 Quarry Lane, Acmeville): the strictest slot oracle in the example set.',
    slots: [
      {
        name: 'address',
        kind: 'address',
        value: '7 Quarry Lane, Acmeville',
        forms: { canonical: '7 Quarry Lane, Acmeville', variant_a: '7 Quarry Ln, Acmeville', variant_b: '7 quarry lane' },
        minimal: '17 Quarry Lane, Acmeville',
      },
    ],
    fields: [{ tool: 'coverage.check', path: ['address'], gold: '7 Quarry Lane, Acmeville', kind: 'address', mode: 'equal' }],
  },
  {
    id: 'B9',
    spec: 'examples/acme/golden/specs/twise/gen-twise-066.yaml',
    index: 1,
    why: 'Generated golden block on a locked number; port.check must receive +12025550160 (exact) and the agent must still offer mobile plans.',
    slots: [phone('0160', '(202) 555-0160', '202-555-0160', '+1 202 555 0106')],
    fields: [{ tool: 'port.check', path: ['number'], gold: '+12025550160', kind: 'phone', mode: 'equal' }],
  },
  {
    id: 'B10',
    spec: 'examples/acme/golden/specs/twise/gen-twise-018.yaml',
    index: 2,
    why: 'Generated golden block for a customer already on the most data; catalog.search must receive customer_email morgan.diaz@example.com (exact).',
    slots: [
      {
        name: 'email',
        kind: 'email',
        value: 'morgan.diaz@example.com',
        forms: { canonical: 'morgan.diaz@example.com', variant_a: 'Morgan.Diaz@example.com', variant_b: 'MORGAN.DIAZ@EXAMPLE.COM' },
        minimal: 'morgan.dias@example.com',
      },
    ],
    fields: [{ tool: 'catalog.search', path: ['customer_email'], gold: 'morgan.diaz@example.com', kind: 'email', mode: 'equal' }],
  },
];

export const ROOT = resolve(import.meta.dirname, '../../../..');

/** The user text of a block's stimulus. */
export function stimulusText(block: { when: unknown }): string {
  const when = block.when as { user?: string; burst?: string[]; injection?: { user: string } };
  if (typeof when.user === 'string') return when.user;
  if (when.injection) return when.injection.user;
  if (when.burst) return when.burst.join('\n');
  throw new Error('unknown stimulus');
}

export async function loadBlock(def: BlockDef) {
  const loaded = await loadSpecFile(resolve(ROOT, def.spec));
  if (!loaded.ok) throw new Error(`${def.spec}: ${JSON.stringify(loaded.errors)}`);
  const spec = loaded.spec;
  const block = spec.blocks[def.index];
  if (!block) throw new Error(`${def.id}: no block ${def.index}`);
  return { spec, block, seed: stimulusText(block), specHash: loaded.hash };
}

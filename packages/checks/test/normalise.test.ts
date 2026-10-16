import type { Expect, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { endState } from '../src/checks/end_state';
import { replyJson } from '../src/checks/reply_json';
import { toolF1 } from '../src/checks/tool_f1';
import { tools } from '../src/checks/tools';
import { acme } from './support/acme';
import { type Call, context, failing, observed, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');

/** Block 3 of the coverage spec: the callback phone, as the agent writes it after a paraphrase. */
const handover = (phone: string): Call[] => [
  {
    label: 'notify_sales',
    input: { reason: 'callback', customer: { phone }, summary: 'Wants fiber at 88 Summit Ave, Acmeville.' },
  },
];
const callback: Expect = {
  tools: [
    {
      label: 'notify_sales',
      count: 1,
      input: {
        customer: { subset: { phone: '+12025550131' } },
        summary: { contains: '88 Summit Avenue' },
      },
      normalise: { 'customer.phone': { rule: 'phone_e164', country_code: '1' }, summary: 'address_canon' },
    },
  ],
};

describe('normalise in the checks', () => {
  it('tools: a phone written with spaces passes and the verdict holds the raw and the normalised value', async () => {
    const verdicts = await run(
      tools,
      context(coverage, 3, observed('Done.', handover('+1 202 555 0131')), { expect: callback }),
    );
    expect(failing(verdicts)).toEqual([]);
    expect(verdict(verdicts, 'tools.notify_sales.input.customer').evidence).toBe(
      'notify_sales input.customer is holding at least {"phone":"+12025550131"} on 1 call: {"phone":"+1 202 555 0131"} (call 1; normalised by phone_e164: phone "+1 202 555 0131" read as "+12025550131")',
    );
    expect(verdict(verdicts, 'tools.notify_sales.input.summary').evidence).toContain(
      'read as "wants fiber at 88 summit avenue acmeville"',
    );
  });

  it('mutation: without the rule the same call fails; another number fails with the rule', async () => {
    const { normalise: _rule, ...bare } = callback.tools?.[0] ?? { label: '' };
    const exact = await run(
      tools,
      context(coverage, 3, observed('Done.', handover('+1 202 555 0131')), { expect: { tools: [bare] } }),
    );
    expect(failing(exact)).toEqual([
      'tools.notify_sales.input.customer',
      'tools.notify_sales.input.summary',
      'tools.argument_accuracy',
    ]);
    const other = await run(
      tools,
      context(coverage, 3, observed('Done.', handover('+1 202 555 0113')), { expect: callback }),
    );
    expect(failing(other)).toEqual(['tools.notify_sales.input.customer', 'tools.argument_accuracy']);
    expect(verdict(other, 'tools.notify_sales.input.customer').evidence).toContain('read as "+12025550113"');
  });

  it('tool_f1 matches a call through the same rule', async () => {
    const verdicts = await run(
      toolF1,
      context(coverage, 3, observed('Done.', handover('(202) 555-0131')), {
        expect: { ...callback, tool_f1: { min: 1 } },
      }),
    );
    expect(failing(verdicts)).toEqual([]);
  });

  it('json: a path with a rule compares after it and reports both values', async () => {
    const json = { paths: [{ path: 'email', assert: 'sam.rivera@example.com', normalise: 'email_lower' }] };
    const verdicts = await run(
      replyJson,
      context(coverage, 1, observed('{"email":"Sam.Rivera@Example.com"}'), { expect: { json } as never }),
    );
    expect(failing(verdicts)).toEqual([]);
    expect(verdict(verdicts, 'json.path.0').evidence).toBe(
      'email is "Sam.Rivera@Example.com"; normalised by email_lower: "Sam.Rivera@Example.com" read as "sam.rivera@example.com"',
    );
  });

  it('end_state: the recorded phone passes after the rule and the evidence shows both values', async () => {
    const spec: Spec = {
      ...coverage,
      end_state: {
        source: 'tool:notify_sales',
        mode: 'subset',
        expect: { customer: { subset: { phone: '+12025550131' } } },
        normalise: { 'customer.phone': { rule: 'phone_e164', country_code: '1' } },
      },
    };
    const last = spec.blocks.length - 1;
    const verdicts = await run(
      endState,
      context(spec, last, observed('Done.'), { endState: { customer: { phone: '(202) 555-0131' } } }),
    );
    expect(failing(verdicts)).toEqual([]);
    expect(verdict(verdicts, 'end_state.customer').evidence).toBe(
      'tool:notify_sales customer is {"phone":"(202) 555-0131"}, expected holding at least {"phone":"+12025550131"}; normalised by phone_e164: phone "(202) 555-0131" read as "+12025550131"',
    );
  });
});

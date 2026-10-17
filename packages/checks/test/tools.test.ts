import { diagnosticStep, type Expect, type StepOutput, type Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ARGUMENT_ACCURACY_STEP } from '../src/argument-accuracy';
import { createToolsCheck, tools } from '../src/checks/tools';
import type { SameReferentJudge } from '../src/value-check/judge';
import { acme, perturbation } from './support/acme';
import { acmeReplayer } from './support/acme-replayer';
import { type Call, context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');

/** The argument-accuracy diagnosis of a block's verdicts, as the shipped diagnostic writes it. */
async function accuracyOf(verdicts: Verdict[]): Promise<StepOutput> {
  const step = diagnosticStep(ARGUMENT_ACCURACY_STEP);
  if (!step) throw new Error('the argument-accuracy step is not registered');
  const out = await step.run({
    scope: 'block',
    verdicts,
    check: {} as never,
    objects: [],
    params: {},
    earlier: [],
  });
  if (!out || Array.isArray(out)) throw new Error('expected one diagnosis');
  return out;
}

/** Block 1 of the coverage spec, as the Acme agent answers it. */
const offerCalls: Call[] = [
  { label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } },
  { label: 'catalog.search', input: { category: 'home', address_id: 'addr-103' } },
];
const offerText =
  'Fiber is not available at 88 Summit Avenue, Acmeville yet, but 5G home internet is. The plan available there: Acme Air 5G, up to 200 Mbps for $35 a month. Would you like Acme Air 5G?';

describe('tools', () => {
  it('mutation: an extra input key fails only the closed-input assertion, restoring it passes', async () => {
    const expected: Expect = { tools: [{ label: 'lookup', input: { kind: 'green' }, input_closed: true }] };
    const check = async (input: unknown) =>
      run(
        tools,
        context(coverage, 1, observed('Found.', [{ label: 'lookup', input }]), { expect: expected }),
      );
    expect(failing(await check({ kind: 'green' }))).toEqual([]);
    const mutated = await check({ kind: 'green', note: 'added by the agent' });
    expect(failing(mutated)).toEqual(['tools.lookup.input_closed']);
    expect(verdict(mutated, 'tools.lookup.input_closed')).toMatchObject({ gating: true, outcome: 'fail' });
    expect(verdict(mutated, 'tools.lookup.input_closed').evidence).toContain('extra input keys note');
    expect(failing(await check({ kind: 'green' }))).toEqual([]);
  });

  it('checks every call, permits zero calls when the count does, and closes absent input to no keys', async () => {
    const expected: Expect = { tools: [{ label: 'lookup', count: { min: 0 }, input_closed: true }] };
    const check = (calls: Call[]) =>
      run(tools, context(coverage, 1, observed('Done.', calls), { expect: expected }));
    expect(failing(await check([]))).toEqual([]);
    expect(failing(await check([{ label: 'lookup', input: {} }]))).toEqual([]);
    const mutated = await check([
      { label: 'lookup', input: {} },
      { label: 'lookup', input: { note: 'extra' } },
    ]);
    expect(failing(mutated)).toEqual(['tools.lookup.input_closed']);
    expect(verdict(mutated, 'tools.lookup.input_closed').evidence).toContain('call 2');
  });

  it('rejects non-object closed inputs and leaves nested values to their input assertion', async () => {
    for (const input of [null, undefined, [], 'green', 1, false]) {
      const seen = observed('Done.');
      seen.toolCalls = [{ label: 'lookup', input }];
      const verdicts = await run(
        tools,
        context(coverage, 1, seen, {
          expect: { tools: [{ label: 'lookup', input_closed: true }] },
        }),
      );
      expect(failing(verdicts)).toEqual(['tools.lookup.input_closed']);
    }
    const seen = observed('Done.', [{ label: 'lookup', input: { details: { extra: true } } }]);
    const verdicts = await run(
      tools,
      context(coverage, 1, seen, {
        expect: { tools: [{ label: 'lookup', input: { details: { subset: {} } }, input_closed: true }] },
      }),
    );
    expect(failing(verdicts)).toEqual([]);
  });

  it('false and omitted closure flags preserve open-input behavior', async () => {
    const seen = observed('Found.', [{ label: 'lookup', input: { kind: 'green', note: 'extra' } }]);
    const tool = { label: 'lookup', input: { kind: 'green' } };
    const open = await run(tools, context(coverage, 1, seen, { expect: { tools: [tool] } }));
    expect(failing(open)).toEqual([]);
    expect(
      await run(
        tools,
        context(coverage, 1, seen, {
          expect: { tools: [{ ...tool, input_closed: false }] },
        }),
      ),
    ).toEqual(open);
  });

  it('passes block 1 of acme-new-customer-coverage: counts, input assertions, in_order, accuracy 1', async () => {
    const verdicts = await run(tools, context(coverage, 1, observed(offerText, offerCalls)));
    expect(outcomes(verdicts)).toEqual({
      'tools.coverage.check.count': 'pass',
      'tools.coverage.check.input.address': 'pass',
      'tools.catalog.search.count': 'pass',
      'tools.catalog.search.input.category': 'pass',
      'tools.catalog.search.input.address_id': 'pass',
      'tools.order': 'pass',
    });
    expect(await accuracyOf(verdicts)).toMatchObject({
      score: 1,
      summary: '3 of 3 expected arguments matched',
    });
    expect(verdict(verdicts, 'tools.coverage.check.input.address').evidence).toContain(
      '"88 Summit Avenue, Acmeville"',
    );
  });

  it('mutation: catalog.search before coverage.check fails tools.order (in_order)', async () => {
    const swapped = [offerCalls[1], offerCalls[0]] as Call[];
    const verdicts = await run(tools, context(coverage, 1, observed(offerText, swapped)));
    expect(failing(verdicts)).toEqual(['tools.order']);
    expect(verdict(verdicts, 'tools.order').evidence).toContain('saw catalog.search, coverage.check');
  });

  it('exact order names the first call that differs, for a swap, an extra call and a missing call', async () => {
    const exact = async (calls: Call[]) =>
      verdict(
        await run(
          tools,
          context(coverage, 1, observed(offerText, calls), {
            expect: { ...coverage.blocks[1]?.expect, tool_order: 'exact' } as never,
          }),
        ),
        'tools.order',
      ).evidence;
    const swapped = await exact([offerCalls[1], offerCalls[0]] as Call[]);
    expect(swapped).toContain(
      'first difference: call 1 differs: expected coverage.check, saw catalog.search',
    );
    const extra = await exact([offerCalls[0], offerCalls[1], { label: 'order.create', input: {} }] as Call[]);
    expect(extra).toContain('first difference: call 3 is extra: saw order.create');
    const missing = await exact([offerCalls[0]] as Call[]);
    expect(missing).toContain('first difference: call 2 is missing: expected catalog.search');
  });

  it('exact order names the argument that differs, with its call and position, when the calls have the right names', async () => {
    const exact = async (calls: Call[]) =>
      verdict(
        await run(
          tools,
          context(coverage, 1, observed(offerText, calls), {
            expect: { ...coverage.blocks[1]?.expect, tool_order: 'exact' } as never,
          }),
        ),
        'tools.order',
      ).evidence;
    const cap = [
      offerCalls[0],
      { label: 'catalog.search', input: { category: 'Home', address_id: 'addr-101' } },
    ] as Call[];
    expect(await exact(cap)).toContain(
      'first argument difference: call 2 (catalog.search) input.category: expected equal to "home", saw "Home"',
    );
  });

  it('mutation: a wrong address_id fails that input on the replayed tool and lowers the argument accuracy to 2 of 3', async () => {
    const wrong: Call[] = [
      offerCalls[0] as Call,
      { label: 'catalog.search', input: { category: 'home', address_id: 'addr-101' } },
    ];
    const replayed = createToolsCheck({ services: { replayer: acmeReplayer() } });
    const verdicts = await run(replayed, context(coverage, 1, observed(offerText, wrong)));
    expect(failing(verdicts)).toEqual(['tools.catalog.search.input.address_id']);
    const field = verdict(verdicts, 'tools.catalog.search.input.address_id');
    expect(field.gating).toBe(true);
    expect(field.outcome).toBe('fail');
    expect(field.evidence).toMatch(
      /^catalog\.search call 1 \(call-2\): input\.address_id is "addr-101"; expected equal to "addr-103" \(call 1 \(call-2\): address_id rung1_outcome: catalog\.search resolves "addr-101" to .*, and the gold "addr-103" to /,
    );
    const accuracy = await accuracyOf(verdicts);
    expect(accuracy.score).toBeCloseTo(2 / 3);
    expect(accuracy.summary).toBe(
      '2 of 3 expected arguments matched; missed: catalog.search input.address_id',
    );
  });

  it('without a replayer or a judge, a different value falls back to the exact compare, says so, and lints the test', async () => {
    const wrong: Call[] = [
      offerCalls[0] as Call,
      { label: 'catalog.search', input: { category: 'home', address_id: 'addr-101' } },
    ];
    const verdicts = await run(tools, context(coverage, 1, observed(offerText, wrong)));
    expect(failing(verdicts)).toEqual([
      'tools.catalog.search.input.address_id',
      'tools.catalog.search.input.address_id.no_decider',
    ]);
    const field = verdict(verdicts, 'tools.catalog.search.input.address_id');
    expect(field).toMatchObject({ gating: true, outcome: 'fail' });
    expect(field.evidence).toContain(
      'address_id exact_fallback: no decider configured for catalog.search.address_id; compared exactly: "addr-101" is not "addr-103"',
    );
    expect(field.evidence).toContain('rung3_same_referent: no same-referent judge is configured');
    const lint = verdict(verdicts, 'tools.catalog.search.input.address_id.no_decider');
    expect(lint.gating).toBe(false);
    expect(lint.evidence).toContain(
      'a replayer that declares catalog.search and resolves address_id (rung1_outcome)',
    );
  });

  it('mutation: a missing call fails its count and every input assertion on it, naming the calls seen', async () => {
    const verdicts = await run(tools, context(coverage, 1, observed(offerText, [offerCalls[0] as Call])));
    expect(failing(verdicts)).toEqual([
      'tools.catalog.search.count',
      'tools.catalog.search.input.category',
      'tools.catalog.search.input.address_id',
      'tools.order',
    ]);
    expect(verdict(verdicts, 'tools.catalog.search.count').evidence).toBe(
      'catalog.search called 0 times, expected exactly 1; calls in this block: coverage.check',
    );
    expect(verdict(verdicts, 'tools.catalog.search.input.category').evidence).toBe(
      'catalog.search was not called, so input.category could not be equal to "home"',
    );
    expect((await accuracyOf(verdicts)).score).toBeCloseTo(1 / 3);
    // No check aggregates its own verdicts: the share is a diagnosis, never a verdict.
    expect(verdicts.some((entry) => entry.id === 'tools.argument_accuracy')).toBe(false);
  });

  it('reads a range count: acme-tool-failure block 2 allows 1 to 2 retries of coverage.check', async () => {
    const spec = acme('acme-tool-failure');
    const retry = { label: 'coverage.check', input: { address: '7 Quarry Lane, Acmeville' } };
    const two = await run(tools, context(spec, 2, observed('Still no answer.', [retry, retry])));
    expect(verdict(two, 'tools.coverage.check.count').outcome).toBe('pass');
    const three = await run(tools, context(spec, 2, observed('Still no answer.', [retry, retry, retry])));
    expect(failing(three)).toEqual(['tools.coverage.check.count']);
    expect(verdict(three, 'tools.coverage.check.count').evidence).toBe(
      'coverage.check called 3 times, expected 1 to 2; calls in this block: coverage.check, coverage.check, coverage.check',
    );
  });

  it('leaves a tool expected 0 times to the forbidden check', async () => {
    const verdicts = await run(tools, context(coverage, 0, observed('Hi.')));
    expect(verdicts).toEqual([]);
    expect(tools.applies(context(coverage, 0, observed('Hi.')))).toBe(false);
  });

  it('checks every input assertion on every call: acme-tool-failure block 0 retries with the same address', async () => {
    const spec = acme('acme-tool-failure');
    const call = (address: string): Call => ({
      label: 'coverage.check',
      input: { address },
      error: 'timeout',
    });
    const good = await run(
      tools,
      context(spec, 0, observed('No.', [call('7 Quarry Lane'), call('7 Quarry Lane')])),
    );
    expect(failing(good)).toEqual([]);
    const bad = await run(
      tools,
      context(spec, 0, observed('No.', [call('7 Quarry Lane'), call('9 Elm Street')])),
    );
    expect(verdict(bad, 'tools.coverage.check.input.address').evidence).toBe(
      'coverage.check call 2 (call-2): input.address is "9 Elm Street"; expected matching /^7 Quarry Lane/',
    );
  });
});

describe('tools: every assertion form, on the Acme expectations', () => {
  const callback = acme('acme-new-customer-coverage');
  const porting = acme('acme-number-porting');
  const notify = {
    reason: 'callback',
    customer: { phone: '+12025550131' },
    summary: 'New customer at 88 Summit Avenue, Acmeville wants fiber. Offered: Acme Air 5G.',
  };
  const order = {
    type: 'new',
    plan_id: 'mobile-m',
    customer: { name: 'Dana Brooks', email: 'dana.brooks@example.com' },
    port_number: '+12025550150',
  };
  const serviceDown = perturbation('acme-order-loose-confirmation', 'order-service-down');
  const serviceDownCalls = (summary: string): Call[] => [
    { label: 'order.create', input: { type: 'new' }, error: 'order service unavailable' },
    {
      label: 'notify_sales',
      input: { reason: 'order_failed', customer: { email: 'jo.okafor@example.com' }, summary },
    },
  ];

  const cases: Array<{
    form: string;
    id: string;
    run: (input: Record<string, unknown>, check?: typeof tools) => ReturnType<typeof run>;
    good: Record<string, unknown>;
    bad: Record<string, unknown>;
  }> = [
    {
      form: 'one_of',
      id: 'tools.notify_sales.input.reason',
      run: (input, check = tools) =>
        run(check, context(callback, 3, observed('Done.', [{ label: 'notify_sales', input }]))),
      good: notify,
      bad: { ...notify, reason: 'complaint' },
    },
    {
      form: 'subset',
      id: 'tools.notify_sales.input.customer',
      run: (input, check = tools) =>
        run(check, context(callback, 3, observed('Done.', [{ label: 'notify_sales', input }]))),
      good: { ...notify, customer: { phone: '+12025550131', name: 'Pat' } },
      bad: { ...notify, customer: { phone: '+12025550199' } },
    },
    {
      form: 'contains',
      id: 'tools.notify_sales.input.summary',
      run: (input, check = tools) =>
        run(check, context(callback, 3, observed('Done.', [{ label: 'notify_sales', input }]))),
      good: notify,
      bad: { ...notify, summary: 'New customer wants fiber.' },
    },
    {
      form: 'exact',
      id: 'tools.order.create.input.customer',
      run: (input, check = tools) =>
        run(check, context(porting, 4, observed('Done.', [{ label: 'order.create', input }]))),
      good: order,
      bad: { ...order, customer: { ...order.customer, phone: '+12025550150' } },
    },
    {
      form: 'absent',
      id: 'tools.order.create.input.address_id',
      run: (input, check = tools) =>
        run(check, context(porting, 4, observed('Done.', [{ label: 'order.create', input }]))),
      good: order,
      bad: { ...order, address_id: 'addr-101' },
    },
    {
      form: 'a bare scalar',
      id: 'tools.order.create.input.plan_id',
      run: (input, check = tools) =>
        run(check, context(porting, 4, observed('Done.', [{ label: 'order.create', input }]))),
      good: order,
      bad: { ...order, plan_id: 'mobile-l' },
    },
    {
      form: 'regex',
      id: 'tools.coverage.check.input.address',
      run: (input, check = tools) =>
        run(
          check,
          context(
            callback,
            1,
            observed(offerText, [{ label: 'coverage.check', input }, offerCalls[1] as Call]),
          ),
        ),
      good: { address: '88 Summit Avenue, Acmeville' },
      bad: { address: 'Summit Avenue 88, Acmeville' },
    },
    {
      form: 'nonempty',
      id: 'tools.notify_sales.input.summary',
      run: (input, check = tools) =>
        run(
          check,
          context(
            acme('acme-order-loose-confirmation'),
            3,
            observed('Sorry.', serviceDownCalls(String(input.summary))),
            {
              expect: serviceDown.expect as Expect,
              mode: 'P',
            },
          ),
        ),
      good: { summary: 'Order failed for Jo Okafor.' },
      bad: { summary: '' },
    },
  ];

  it('a blank summary fails nonempty on acme order-service-down; core agrees', async () => {
    const blank = cases.find((item) => item.form === 'nonempty');
    if (!blank) throw new Error('the nonempty case is missing');
    expect(verdict(await blank.run({ summary: '  ' }), blank.id).outcome).toBe('fail');
  });

  it.each(cases)('$form passes on the target input and never passes its mutation', async (item) => {
    expect(verdict(await item.run(item.good), item.id).outcome).toBe('pass');
    const mutated = verdict(await item.run(item.bad), item.id);
    expect(mutated.outcome).toBe('fail');
    expect(mutated.evidence).toMatch(/expected /);
  });

  /** A calibrated judge that reads every value as itself, so two different values never match. */
  const literal: SameReferentJudge = {
    model: 'literal-reader',
    calibration: { falseAcceptance: 0, source: 'a test stub' },
    complete: async (request) =>
      request.kind === 'read'
        ? { has_content: true, reading: request.parts.v }
        : { same: request.parts.a === request.parts.b },
  };

  it.each(cases)('$form fails its mutation once a judge is configured', async (item) => {
    const judged = createToolsCheck({ services: { judge: literal } });
    expect(verdict(await item.run(item.good, judged), item.id).outcome).toBe('pass');
    expect(verdict(await item.run(item.bad, judged), item.id).outcome).toBe('fail');
  });
});

describe('tools: tool_order modes', () => {
  const spec = acme('acme-new-customer-coverage');
  const expectOrder = (mode: Expect['tool_order']): Expect => ({
    tools: [
      { label: 'coverage.check', count: 2 },
      { label: 'catalog.search', count: 1 },
    ],
    tool_order: mode,
  });
  const calls = (...labels: string[]): Call[] => labels.map((label) => ({ label }));
  const order = async (mode: Expect['tool_order'], labels: string[]) =>
    verdict(
      await run(tools, context(spec, 1, observed('ok', calls(...labels)), { expect: expectOrder(mode) })),
      'tools.order',
    ).outcome;

  it('exact: the calls match one for one, in order, with no extra call', async () => {
    expect(await order('exact', ['coverage.check', 'coverage.check', 'catalog.search'])).toBe('pass');
    expect(await order('exact', ['coverage.check', 'catalog.search', 'coverage.check'])).toBe('fail');
    expect(await order('exact', ['coverage.check', 'coverage.check', 'catalog.search', 'notify_sales'])).toBe(
      'fail',
    );
  });

  it('in_order: other calls may sit between the expected ones', async () => {
    expect(
      await order('in_order', ['coverage.check', 'notify_sales', 'coverage.check', 'catalog.search']),
    ).toBe('pass');
    expect(await order('in_order', ['coverage.check', 'catalog.search', 'coverage.check'])).toBe('fail');
  });

  it('any_order: every expected call appears, in any order', async () => {
    expect(await order('any_order', ['catalog.search', 'coverage.check', 'coverage.check'])).toBe('pass');
    expect(await order('any_order', ['catalog.search', 'coverage.check'])).toBe('fail');
  });
});

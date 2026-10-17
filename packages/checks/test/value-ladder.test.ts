import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { objectRegistry } from '@agent-nexus/driftbench-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createToolsCheck } from '../src/checks/tools';
import { initializeShippedObjects } from '../src/initialize';
import type { SameReferentJudge } from '../src/value-check/judge';
import {
  BUILTIN_RUNGS,
  DEFAULT_VALUE_POLICY,
  type Rung,
  runLadder,
  type ValueCase,
  type ValuePolicy,
  valuePolicyProblems,
} from '../src/value-check/ladder';
import type { ToolReplayer } from '../src/value-check/outcome';
import { evaluateFormula, type RecomputeCase } from '../src/value-check/recompute';
import { acme } from './support/acme';
import { acmeReplayer, type ReplayedCall } from './support/acme-replayer';
import { context, observed, run, verdict } from './support/context';
import { fixturePath } from './support/h1';

/** The value-check ladder rung by rung: the policy file, the order, each rung's pass and fail, and its mutants. */
beforeEach(() => initializeShippedObjects());

const POLICY_FILE = new URL('../../../policy/value-check/default.yaml', import.meta.url);
/** The YAML parser the object loader reads policy files with: core's own dependency. */
const { parse } = createRequire(new URL('../../core/package.json', import.meta.url))('yaml') as {
  parse: (text: string) => unknown;
};

describe('policy/value-check:default', () => {
  it('the shipped file and the policy the tools check runs are the same object', () => {
    const file = parse(readFileSync(POLICY_FILE, 'utf8')) as Record<string, unknown>;
    const { extends: parent, description: _description, ...rest } = file;
    expect(parent).toBeNull();
    expect(rest).toEqual(DEFAULT_VALUE_POLICY);
    expect(valuePolicyProblems(DEFAULT_VALUE_POLICY)).toEqual([]);
  });

  it('orders the rungs: exact by declaration, outcome, recompute, state diff, contract, as given, judge', () => {
    expect(
      DEFAULT_VALUE_POLICY.order?.map((id) => DEFAULT_VALUE_POLICY.items.find((i) => i.id === id)?.impl),
    ).toEqual([
      'builtin:value-check/exact',
      'builtin:value-check/outcome',
      'builtin:value-check/recompute',
      'builtin:value-check/state-diff',
      'builtin:value-check/contract',
      'builtin:value-check/as-given',
      'builtin:value-check/judge',
    ]);
  });

  it('refuses a policy with an unknown rung, an unknown evidence name or an order that is not a permutation', () => {
    const broken: ValuePolicy = {
      items: [
        { id: 'a', impl: 'builtin:value-check/nothing' },
        { id: 'b', impl: 'builtin:value-check/exact', when: { colour: 'red' } },
      ],
      order: ['a'],
    };
    expect(valuePolicyProblems(broken)).toEqual([
      'a: no rung implements builtin:value-check/nothing',
      'b: when reads colour, which is not an evidence name (compare, tool_replayable, recomputable, compares, contract, source)',
      'order must name every item once: a',
    ]);
    expect(() => createToolsCheck({ policy: broken })).toThrow(/cannot run/);
  });

  it('keeps the fixtures byte for byte: each file hashes to the sha its SOURCES.md states', () => {
    const sources = readFileSync(fixturePath('SOURCES.md'), 'utf8');
    const rows = [...sources.matchAll(/^\| `([^`]+)` \| [^|]+ \| `([0-9a-f]{64})` \|/gm)];
    expect(rows.length).toBe(9);
    for (const [, file, sha] of rows) {
      const actual = createHash('sha256')
        .update(readFileSync(fixturePath(file as string)))
        .digest('hex');
      expect({ file, sha: actual }).toEqual({ file, sha });
    }
  });
});

const coverageCall = (address: string): ValueCase => ({
  tool: 'coverage.check',
  field: 'address',
  gold: '7 Quarry Lane, Acmeville',
  value: address,
  input: { address },
});

describe('two facts before the rungs', () => {
  it('a value equal to the gold passes, and a non-string difference fails, with no rung run', async () => {
    const log: ReplayedCall[] = [];
    const services = { replayer: acmeReplayer(log) };
    expect(
      await runLadder(coverageCall('7 Quarry Lane, Acmeville'), DEFAULT_VALUE_POLICY, services),
    ).toMatchObject({
      outcome: 'pass',
      rung: 'identity',
    });
    expect(
      await runLadder({ field: 'count', gold: 3, value: 4 }, DEFAULT_VALUE_POLICY, services),
    ).toMatchObject({ outcome: 'fail', rung: 'identity' });
    expect(await runLadder({ field: 'x', gold: 'a', value: undefined })).toMatchObject({ outcome: 'fail' });
    expect(log).toEqual([]);
  });
});

describe('rung 4: exact by declaration short-circuits', () => {
  it('fails a writing the tool accepts, names the reason, and replays nothing', async () => {
    const log: ReplayedCall[] = [];
    const result = await runLadder(
      {
        ...coverageCall('7 quarry lane, acmeville'),
        compare: { exact: 'the map stores the label as written' },
      },
      DEFAULT_VALUE_POLICY,
      { replayer: acmeReplayer(log) },
    );
    expect(result).toMatchObject({ outcome: 'fail', rung: 'rung4_exact' });
    expect(result.evidence).toContain('the map stores the label as written');
    expect(log).toEqual([]);
  });

  it('in a spec: compare: { exact } on the expected tool fails a lower-case address the tool resolves', async () => {
    const spec = acme('acme-new-customer-coverage');
    const expectation = (compare?: { exact: string }) => ({
      tools: [
        {
          label: 'coverage.check',
          count: 1,
          input: { address: '88 Summit Avenue, Acmeville' },
          ...(compare === undefined ? {} : { compare }),
        },
      ],
    });
    const check = createToolsCheck({ services: { replayer: acmeReplayer() } });
    const seen = observed('Checking.', [
      { label: 'coverage.check', input: { address: '88 summit avenue, acmeville' } },
    ]);
    const field = async (compare?: { exact: string }) =>
      verdict(
        await run(check, context(spec, 1, seen, { expect: expectation(compare) })),
        'tools.coverage.check.input.address',
      );
    expect((await field()).outcome).toBe('pass');
    expect((await field({ exact: 'the label is shown to the customer as written' })).outcome).toBe('fail');
  });
});

describe('rung 1: the outcome', () => {
  it('fails Ln, which the coverage map does not resolve, and passes a lower-case writing it resolves', async () => {
    const services = { replayer: acmeReplayer() };
    expect(
      await runLadder(coverageCall('7 Quarry Ln, Acmeville'), DEFAULT_VALUE_POLICY, services),
    ).toMatchObject({
      outcome: 'fail',
      rung: 'rung1_outcome',
      names: { outcome: 'failed' },
    });
    expect(await runLadder(coverageCall('7 quarry lane'), DEFAULT_VALUE_POLICY, services)).toMatchObject({
      outcome: 'pass',
      rung: 'rung1_outcome',
      names: { outcome: 'accepted_as_gold' },
    });
  });

  it('passes the port check E.164 conversion and an email in capitals, which the tools canonicalise', async () => {
    const services = { replayer: acmeReplayer() };
    const number = await runLadder(
      {
        tool: 'port.check',
        field: 'number',
        gold: '+12025550160',
        value: '(202) 555-0160',
        input: { number: '(202) 555-0160' },
      },
      DEFAULT_VALUE_POLICY,
      services,
    );
    expect(number).toMatchObject({ outcome: 'pass', rung: 'rung1_outcome' });
    const email = await runLadder(
      {
        tool: 'catalog.search',
        field: 'customer_email',
        gold: 'morgan.diaz@example.com',
        value: 'MORGAN.DIAZ@EXAMPLE.COM',
        input: { category: 'mobile', customer_email: 'MORGAN.DIAZ@EXAMPLE.COM' },
      },
      DEFAULT_VALUE_POLICY,
      services,
    );
    expect(email).toMatchObject({ outcome: 'pass', rung: 'rung1_outcome' });
  });

  it('fails a neighbouring referent the tool resolves differently: another address, another customer', async () => {
    const services = { replayer: acmeReplayer() };
    const other = await runLadder(
      { ...coverageCall('3 Orchard Way, Acmeville'), gold: '14 Harbor Road, Acmeville' },
      DEFAULT_VALUE_POLICY,
      services,
    );
    expect(other).toMatchObject({ outcome: 'fail', names: { outcome: 'resolved_differently' } });
  });

  it('decides only the inputs a tool resolves: the plan of an order, not the email kept on it', async () => {
    const services = { replayer: acmeReplayer() };
    const order = {
      type: 'new',
      plan_id: 'mobile-m',
      customer: { name: 'Dana Brooks', email: 'dana.brooks@example.com' },
    };
    const plan = await runLadder(
      { tool: 'order.create', field: 'plan_id', gold: 'mobile-l', value: 'mobile-m', input: order },
      DEFAULT_VALUE_POLICY,
      services,
    );
    expect(plan).toMatchObject({ outcome: 'fail', rung: 'rung1_outcome' });
    const email = await runLadder(
      {
        tool: 'order.create',
        field: 'customer.email',
        gold: 'dana.b@example.com',
        value: 'dana.brooks@example.com',
        input: order,
      },
      DEFAULT_VALUE_POLICY,
      services,
    );
    expect(email.rung).not.toBe('rung1_outcome');
    expect(email.names.tool_replayable).toBe(false);
  });

  it('passes nothing on a world without distractors when the policy requires them', async () => {
    const acme = acmeReplayer();
    const lonely: ToolReplayer = {
      call: acme.call,
      declaration: (tool) => {
        const found = acme.declaration(tool);
        return found === undefined ? undefined : { resolved: found.resolved };
      },
    };
    const result = await runLadder(coverageCall('7 quarry lane'), DEFAULT_VALUE_POLICY, { replayer: lonely });
    expect(result).toMatchObject({ outcome: 'fail', rung: 'exact_fallback' });
    expect(result.evidence).toContain('declares no distractor');
  });
});

describe('rung 2: the contract', () => {
  const definition = {
    name: 'notify_sales',
    description: 'Hands a lead to a human sales advisor.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['callback', 'no_coverage'] },
        customer: {
          type: 'object',
          properties: { phone: { type: 'string', pattern: '^\\+1\\d{10}$', description: 'E.164.' } },
        },
      },
    },
  };
  const phone = (value: string): ValueCase => ({
    tool: 'notify_sales',
    field: 'customer.phone',
    gold: '+12025550131',
    value,
    definition,
    sources: { user: [value] },
  });

  it('fails a value that breaks the stated format, even one copied as the user wrote it', async () => {
    const result = await runLadder(phone('(202) 555-0131'));
    expect(result).toMatchObject({ outcome: 'fail', rung: 'rung2_contract' });
    expect(result.evidence).toContain('pattern /^\\+1\\d{10}$/');
  });

  it('fails two different members of a stated enum', async () => {
    const result = await runLadder({
      tool: 'notify_sales',
      field: 'reason',
      gold: 'callback',
      value: 'no_coverage',
      definition,
    });
    expect(result).toMatchObject({ outcome: 'fail', rung: 'rung2_contract' });
  });

  it('settles no pass: a value inside the contract that differs goes on to the next rungs', async () => {
    const result = await runLadder({ ...phone('+12025550113'), sources: { user: [] } });
    expect(result).toMatchObject({ outcome: 'fail', rung: 'exact_fallback' });
    expect(result.tried.map((entry) => entry.rung)).toEqual(['rung2_contract']);
  });

  it('lints the test when the block demands a writing no contract states', async () => {
    const spec = acme('acme-new-customer-coverage');
    const seen = observed('Done.', [
      {
        label: 'notify_sales',
        input: { reason: 'callback', customer: { phone: '+1 202 555 0131' }, summary: '88 Summit Avenue' },
      },
    ]);
    // A calibrated judge that reads a phone as its digits: the copy goes to it, and it finds the same number.
    const digits: SameReferentJudge = {
      model: 'digits-reader',
      calibration: { falseAcceptance: 0, source: 'a test stub' },
      complete: async (request) =>
        request.kind === 'read'
          ? { has_content: true, reading: String(request.parts.v).replace(/\D/g, '').replace(/^1/, '') }
          : { same: request.parts.a === request.parts.b },
    };
    const verdicts = await run(createToolsCheck({ services: { judge: digits } }), context(spec, 3, seen));
    expect(verdict(verdicts, 'tools.notify_sales.input.customer').outcome).toBe('pass');
    expect(verdict(verdicts, 'tools.notify_sales.input.customer').evidence).toContain('rung3_same_referent');
    const lint = verdict(verdicts, 'tools.notify_sales.input.customer.unstated_format');
    expect(lint).toMatchObject({ gating: false, outcome: 'fail' });
    expect(lint.evidence).toContain(
      'the block demands the writing "+12025550131" for notify_sales input.customer.phone',
    );
  });
});

describe('rung 2b: as given', () => {
  const stored = (value: string, user: string): ValueCase => ({
    tool: 'notify_sales',
    field: 'customer.email',
    gold: 'sam.rivera@example.com',
    value,
    sources: { user: [user] },
  });

  it('passes nothing on a copy: a value copied from the user goes on, here to the exact fallback', async () => {
    const result = await runLadder(stored('Sam.Rivera@Example.com', 'Reach me at Sam.Rivera@Example.com'));
    expect(result).toMatchObject({ outcome: 'fail', rung: 'exact_fallback' });
    expect(result.tried).toContainEqual({
      rung: 'rung2b_as_given',
      reason: `"Sam.Rivera@Example.com" is copied as given from the user's message; a copy proves the source, not the value`,
    });
  });

  it('fails a value the agent changed after the user gave the gold writing', async () => {
    const result = await runLadder(stored('Sam.Rivera@example.com', 'Reach me at sam.rivera@example.com'));
    expect(result).toMatchObject({ outcome: 'fail', rung: 'rung2b_as_given', names: { change: 'altered' } });
  });

  it('cannot decide when the user wrote both in one message', async () => {
    const result = await runLadder(
      stored('sam.rivers@example.com', 'Not sam.rivers@example.com, it is sam.rivera@example.com'),
    );
    expect(result).toMatchObject({ outcome: 'fail', rung: 'exact_fallback' });
    expect(result.evidence).toContain('both the value and the gold appear in the same message');
  });

  it("takes the user's later message: keeping a value the user corrected fails, taking the correction decides nothing", async () => {
    const turns = ['my email is nobody@example.com', 'Sorry, my email is sam.rivera@example.com'];
    const kept = await runLadder({ ...stored('nobody@example.com', ''), sources: { user: turns } });
    expect(kept).toMatchObject({ outcome: 'fail', rung: 'rung2b_as_given', names: { change: 'stale' } });
    const reversed = await runLadder({
      ...stored('nobody@example.com', ''),
      sources: { user: [...turns].reverse() },
    });
    expect(reversed).toMatchObject({ outcome: 'fail', rung: 'exact_fallback' });
    expect(reversed.evidence).toContain('the agent took the later value');
  });

  it('matches whole tokens only: a fragment of a longer number is no copy', async () => {
    const result = await runLadder({
      tool: 'notify_sales',
      field: 'customer.phone',
      gold: '+12025550131',
      value: '202 555 01',
      sources: { user: ['+1 202 555 0131'] },
    });
    expect(result.rung).not.toBe('rung2b_as_given');
  });
});

describe('a named compare mode runs that rung alone', () => {
  it('outcome on a tool nobody can replay falls back to the exact compare, with the reason', async () => {
    const result = await runLadder({ ...coverageCall('7 Quarry Ln'), compare: 'outcome' });
    expect(result).toMatchObject({ outcome: 'fail', rung: 'exact_fallback' });
    expect(result.evidence).toContain('rung1_outcome: no replayer declares this tool');
  });

  it('the tools check reads the policy it is given: without rung 1, a writing the tool resolves falls back to exact', async () => {
    const withoutOutcome: ValuePolicy = {
      ...DEFAULT_VALUE_POLICY,
      items: DEFAULT_VALUE_POLICY.items.map((item) =>
        item.id === 'rung1_outcome' ? { ...item, enabled: false } : item,
      ),
    };
    const spec = acme('acme-new-customer-coverage');
    const seen = observed('Checking.', [
      { label: 'coverage.check', input: { address: '88 summit avenue, acmeville' } },
    ]);
    const expectation = {
      tools: [{ label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } }],
    };
    const field = async (policy?: ValuePolicy) =>
      verdict(
        await run(
          createToolsCheck({ services: { replayer: acmeReplayer() }, ...(policy ? { policy } : {}) }),
          context(spec, 1, seen, { expect: expectation }),
        ),
        'tools.coverage.check.input.address',
      ).outcome;
    expect(await field()).toBe('pass');
    expect(await field(withoutOutcome)).toBe('fail');
  });
});

describe('the policy comes through the object resolver', () => {
  const coverage = acme('acme-new-customer-coverage');
  const seen = observed('Checking.', [
    { label: 'coverage.check', input: { address: '88 summit avenue, acmeville' } },
  ]);
  const expectation = {
    tools: [{ label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } }],
  };
  const field = async (uses?: Record<string, unknown>, at: 'spec' | 'block' = 'block') => {
    const blocks = coverage.blocks.map((block, index) =>
      index === 1 && at === 'block' && uses ? { ...block, uses } : block,
    );
    const spec = { ...coverage, blocks, ...(at === 'spec' && uses ? { uses } : {}) } as typeof coverage;
    const check = createToolsCheck({ services: { replayer: acmeReplayer() } });
    return verdict(
      await run(check, context(spec, 1, seen, { expect: expectation })),
      'tools.coverage.check.input.address',
    );
  };

  it('a block that disables rung 1 in an inline object extending the default compares a resolved writing exactly', async () => {
    expect((await field()).outcome).toBe('pass');
    const off = { value_check: { extends: 'default', items: [{ id: 'rung1_outcome', enabled: false }] } };
    expect(await field(off)).toMatchObject({ outcome: 'fail' });
    expect((await field(off)).evidence).toContain('exact_fallback');
    expect((await field(off, 'spec')).outcome).toBe('fail');
    expect((await field({ value_check: 'default' })).outcome).toBe('pass');
  });

  it('a block that names an object nobody registered fails tools.value_check and still compares its values exactly', async () => {
    const spec = { ...coverage, uses: { value_check: 'nowhere' } } as typeof coverage;
    const verdicts = await run(createToolsCheck(), context(spec, 1, seen, { expect: expectation }));
    expect(verdicts[0]).toMatchObject({ id: 'tools.value_check', outcome: 'fail' });
    expect(verdicts[0]?.evidence).toContain('cannot resolve');
    expect(verdict(verdicts, 'tools.coverage.check.input.address')).toMatchObject({ outcome: 'fail' });
  });

  it('the shipped object is registered with the resolver, item for item', () => {
    const shipped = objectRegistry.shipped().find(({ path }) => path === 'policy/value-check/default.yaml');
    if (shipped === undefined) throw new Error('policy/value-check:default is not registered');
    const { extends: _parent, description: _description, ...rest } = shipped.raw as Record<string, unknown>;
    expect(rest).toEqual(DEFAULT_VALUE_POLICY);
  });
});

describe('the code rungs', () => {
  const price = (produced: RecomputeCase['produced']): ValueCase => ({
    field: 'D2',
    gold: '120',
    value: '120',
    recompute: { produced, expected: { formula: '=C2*12' }, inputs: { C2: 10 } },
  });
  // The cell's value equals the gold on the given inputs, so only the recomputation can tell them apart.
  const decide = (produced: RecomputeCase['produced']) => runLadder(price(produced), DEFAULT_VALUE_POLICY);

  it('recompute: =12*C2 passes on the given inputs and on changed inputs', async () => {
    const result = await decide({ formula: '=12*C2' });
    expect(result).toMatchObject({
      outcome: 'pass',
      rung: 'rung1_recompute',
      names: { changed_inputs_fail: false },
    });
  });

  it('recompute: a hard-coded number fails on changed inputs', async () => {
    const result = await decide({ value: 120 });
    expect(result).toMatchObject({
      outcome: 'fail',
      rung: 'rung1_recompute',
      names: { changed_inputs_fail: true },
    });
    expect(result.evidence).toContain('on changed inputs');
  });

  it('recompute: a formula that agrees only at the seed fails too', async () => {
    expect((await decide({ formula: '=C2*10+20' })).outcome).toBe('fail');
  });

  it('planted mutant: a recompute that runs the given inputs only passes the hard-coded number, and the test sees it', async () => {
    const seedOnly: Rung = (value, ctx) =>
      BUILTIN_RUNGS['builtin:value-check/recompute']?.(value, {
        ...ctx,
        params: { ...ctx.params, trials: 0 },
      }) ?? {
        skip: 'mutant',
      };
    const mutated = await runLadder(
      price({ value: 120 }),
      DEFAULT_VALUE_POLICY,
      {},
      {
        ...BUILTIN_RUNGS,
        'builtin:value-check/recompute': seedOnly,
      },
    );
    expect(mutated.outcome).toBe('pass');
  });

  it('evaluates formulas with cell names, ranges and functions', () => {
    expect(evaluateFormula('=SUM(C2:C4)*2-MAX(C2,1)', { C2: 1, C3: 2, C4: 3 })).toBe(11);
    expect(evaluateFormula('ROUND(C2/3, 2)', { C2: 10 })).toBe(3.33);
    expect(() => evaluateFormula('=C9*2', { C2: 1 })).toThrow(/C9 is not an input/);
  });

  it('state diff: one extra file fails; the same file passes once it is allowed', async () => {
    const diff = { created: ['out/report.xlsx', 'out/tmp.csv'], changed: [], deleted: [] };
    const state = (allowed?: string[]): ValueCase => ({
      field: 'workspace',
      gold: 'the expected changes',
      value: 'the observed changes',
      stateDiff: { diff, expected: { created: ['out/report.xlsx'] }, ...(allowed ? { allowed } : {}) },
    });
    const extra = await runLadder(state());
    expect(extra).toMatchObject({ outcome: 'fail', rung: 'rung1_state_diff' });
    expect(extra.evidence).toContain('out/tmp.csv created');
    expect(await runLadder(state(['out/*.csv']))).toMatchObject({
      outcome: 'pass',
      rung: 'rung1_state_diff',
    });
  });
});

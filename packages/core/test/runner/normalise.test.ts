import {
  type Assertion,
  contentHash,
  NormaliseRule,
  slotRules,
  ToolExpect,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  compareEndState,
  matchAssertion,
  matchNormalised,
  normaliseSlot,
  rootRule,
  rulesFor,
} from '../../src/runner';

const match = (value: unknown, assertion: Assertion, rule: NormaliseRule) =>
  matchNormalised(value, assertion, rootRule(rule), matchAssertion);

describe('normaliseSlot', () => {
  const cases: Array<[Parameters<typeof normaliseSlot>[0], string, string, string?]> = [
    ['digits_only', 'order #4417', '4417'],
    ['phone_e164', '+1 202 555 0131', '+12025550131'],
    ['phone_e164', '(202) 555-0131', '+12025550131', '1'],
    ['phone_e164', '202.555.0131', '+12025550131', '1'],
    ['phone_e164', '1 202 555 0131', '+12025550131', '1'],
    ['phone_e164', '0044 20 794', '+4420794', '1'],
    ['phone_e164', '020 794', '+4420794', '44'],
    ['phone_e164', '(202) 555-0131', '2025550131'],
    ['email_lower', ' <mailto:Sam.Rivera@Example.COM>. ', 'sam.rivera@example.com'],
    ['email_lower', 'SAM.RIVERA@EXAMPLE.COM', 'sam.rivera@example.com'],
    ['whitespace', '  Acme   Fiber\n1000 ', 'Acme Fiber 1000'],
    ['case_fold', 'Acme Fiber', 'acme fiber'],
    ['address_canon', '88 Summit Ave, Acmeville', '88 summit avenue acmeville'],
    ['address_canon', '14 Harbor Rd.', '14 harbor road'],
    ['address_canon', '7 Quarry Ln', '7 quarry lane'],
  ];
  it.each(cases)('%s reads %j as %j', (rule, text, want, country) => {
    expect(normaliseSlot(rule, text, country)).toBe(want);
  });

  it('keeps a national number apart from an international one without a country code', () => {
    expect(match('(202) 555-0131', '+12025550131', 'phone_e164').ok).toBe(false);
    expect(match('(202) 555-0131', '+12025550131', { rule: 'phone_e164', country_code: '1' }).ok).toBe(true);
  });
});

describe('matchNormalised', () => {
  it('passes a writing of the expected value and fails a different value, on every compared form', () => {
    const phone: NormaliseRule = { rule: 'phone_e164', country_code: '1' };
    const cases: Array<[Assertion, unknown, unknown]> = [
      ['+12025550131', '+1 202 555 0131', '+1 202 555 0113'],
      [{ exact: '+12025550131' }, '(202) 555-0131', '(202) 555-0113'],
      [{ one_of: ['+12025550131', '+12025550188'] }, '202 555 0188', '202 555 0181'],
    ];
    for (const [assertion, good, bad] of cases) {
      expect(match(good, assertion, phone).ok).toBe(true);
      expect(match(bad, assertion, phone).ok).toBe(false);
      expect(matchAssertion(good, assertion)).toBe(false);
    }
  });

  it('normalises inside a mapping at a dotted path, and only there', () => {
    const rules = rulesFor({ 'customer.phone': { rule: 'phone_e164', country_code: '1' } }, 'customer');
    const subset: Assertion = { subset: { phone: '+12025550131', name: 'Jo' } };
    expect(matchNormalised({ phone: '(202) 555-0131', name: 'Jo' }, subset, rules, matchAssertion).ok).toBe(
      true,
    );
    expect(matchNormalised({ phone: '(202) 555-0131', name: 'jo' }, subset, rules, matchAssertion).ok).toBe(
      false,
    );
    expect(rulesFor({ 'customer.phone': 'phone_e164' }, 'summary')).toEqual([]);
  });

  it('records the raw and the normalised value of each comparison', () => {
    const result = match('SAM.Rivera@example.com', 'sam.rivera@example.com', 'email_lower');
    expect(result).toEqual({
      ok: true,
      steps: [
        {
          path: '',
          rule: 'email_lower',
          raw: 'SAM.Rivera@example.com',
          normalised: 'sam.rivera@example.com',
        },
      ],
    });
  });

  it('mutation: contains under address_canon matches whole words, so 188 does not hold 88', () => {
    const summary: Assertion = { contains: '88 Summit Avenue' };
    expect(match('Callback for 88 Summit Ave, Acmeville', summary, 'address_canon').ok).toBe(true);
    expect(match('Callback for 188 Summit Ave, Acmeville', summary, 'address_canon').ok).toBe(false);
    expect(matchAssertion('Callback for 188 Summit Avenue', summary)).toBe(true);
  });

  it('accepts an approved surface form, ignoring case and spacing, and never an unapproved one', () => {
    const gold = '88 Summit Avenue, Acmeville';
    const approved: NormaliseRule = {
      rule: 'address_canon',
      surface_forms: [{ form: '88 Summit Avenue', approved: true }],
    };
    const pending: NormaliseRule = {
      rule: 'address_canon',
      surface_forms: [{ form: '88 Summit Avenue', approved: false }],
    };
    expect(match('88  SUMMIT avenue', gold, approved)).toMatchObject({
      ok: true,
      steps: [{ surfaceForm: true, normalised: '88 summit avenue acmeville' }],
    });
    expect(match('88 summit avenue', gold, pending).ok).toBe(false);
    // The form stands for itself only: an abbreviation of it is not approved by it.
    expect(match('88 Summit Ave', gold, approved).ok).toBe(false);
    expect(match('8 Summit Avenue', gold, approved).ok).toBe(false);
  });

  it('leaves regex, nonempty and absent assertions as written', () => {
    expect(match('88 summit avenue', { regex: '^88 Summit Avenue' }, 'address_canon')).toEqual({
      ok: false,
      steps: [],
    });
    expect(match(undefined, { absent: true }, 'case_fold').ok).toBe(true);
  });
});

describe('compareEndState with normalise', () => {
  it('passes a writing of the expected field and keeps the raw value in the diff', () => {
    const state = { customer: { phone: '+1 202 555 0131' }, reason: 'callback' };
    const spec = {
      source: 'tool:notify_sales',
      expect: { customer: { subset: { phone: '+12025550131' } }, reason: 'callback' },
    };
    expect(compareEndState(spec, state).match).toBe(false);
    const ruled = { ...spec, normalise: { 'customer.phone': 'phone_e164' as const } };
    expect(compareEndState(ruled, state)).toEqual({ match: true, diff: [] });
    expect(compareEndState(ruled, { ...state, customer: { phone: '+1 202 555 0113' } }).diff).toEqual([
      {
        field: 'customer',
        expected: { subset: { phone: '+12025550131' } },
        observed: { phone: '+1 202 555 0113' },
      },
    ]);
  });
});

describe('the normalise schema', () => {
  it('accepts a rule name or a mapping, and refuses an empty mapping or a country code off phone_e164', () => {
    expect(NormaliseRule.safeParse('phone_e164').success).toBe(true);
    expect(NormaliseRule.safeParse({ rule: 'phone_e164', country_code: '1' }).success).toBe(true);
    expect(NormaliseRule.safeParse({ surface_forms: [{ form: 'x', approved: true }] }).success).toBe(true);
    expect(NormaliseRule.safeParse({}).success).toBe(false);
    expect(NormaliseRule.safeParse({ rule: 'email_lower', country_code: '1' }).success).toBe(false);
    expect(NormaliseRule.safeParse('lowercase').success).toBe(false);
    expect(NormaliseRule.safeParse({ surface_forms: [{ form: 'x' }] }).success).toBe(false);
    expect(ToolExpect.safeParse({ label: 't', normalise: { 'a..b': 'case_fold' } }).success).toBe(false);
  });

  it('keeps the hash of a spec that uses no rule, and changes it when a rule is added', () => {
    const spec = {
      id: 'hash',
      blocks: [
        { user: 'hi', expect: { tools: [{ label: 'port.check', input: { number: '+12025550150' } }] } },
      ],
    };
    const plain = validateSpec(structuredClone(spec));
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(JSON.stringify(plain.spec)).not.toContain('normalise');
    const ruled = structuredClone(spec) as { blocks: { expect: { tools: Record<string, unknown>[] } }[] };
    (ruled.blocks[0]?.expect.tools[0] as Record<string, unknown>).normalise = { number: 'phone_e164' };
    const loaded = validateSpec(ruled);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(contentHash(loaded.spec)).not.toBe(contentHash(plain.spec));
  });
});

describe('spec validation of normalise rules', () => {
  const spec = (tool: Record<string, unknown>, endState?: Record<string, unknown>) => ({
    id: 'rules',
    blocks: [{ user: 'hi', expect: { tools: [{ label: 'notify_sales', ...tool }] } }],
    ...(endState ? { end_state: endState } : {}),
  });
  const codes = (raw: unknown) => {
    const loaded = validateSpec(raw);
    return loaded.ok ? [] : loaded.errors.map((issue) => `${issue.code} ${issue.path}: ${issue.message}`);
  };

  it('refuses a rule on a field with no assertion, on a pattern, on a number or ambiguous surface forms', () => {
    expect(codes(spec({ input: { summary: 'x' }, normalise: { phone: 'phone_e164' } }))).toEqual([
      'NORMALISE_INVALID blocks.0.expect.tools.0.normalise.phone: "phone" has no assertion to normalise',
    ]);
    expect(
      codes(spec({ input: { address: { regex: '^88' } }, normalise: { address: 'address_canon' } })),
    ).toEqual([
      'NORMALISE_INVALID blocks.0.expect.tools.0.normalise.address: a regex, nonempty or absent assertion is compared as written and takes no rule',
    ]);
    expect(codes(spec({ input: { count: 2 }, normalise: { count: 'digits_only' } }))).toEqual([
      'NORMALISE_INVALID blocks.0.expect.tools.0.normalise.count: the assertion names no text',
    ]);
    expect(
      codes(
        spec({
          input: { customer: { subset: { phone: '+12025550131' } } },
          normalise: { 'customer.email': 'email_lower' },
        }),
      ),
    ).toEqual([
      'NORMALISE_INVALID blocks.0.expect.tools.0.normalise.customer.email: the assertion names no text at email',
    ]);
    expect(
      codes(
        spec({
          input: { reason: { one_of: ['callback', 'no_coverage'] } },
          normalise: { reason: { surface_forms: [{ form: 'call back', approved: true }] } },
        }),
      ),
    ).toEqual([
      'NORMALISE_INVALID blocks.0.expect.tools.0.normalise.reason: surface forms need one expected text; the assertion names 2',
    ]);
  });

  it('checks the rules of an end state against its expected fields', () => {
    const endState = {
      source: 'tool:notify_sales',
      expect: { reason: 'callback' },
      normalise: { phone: 'phone_e164' },
    };
    expect(codes(spec({}, endState))).toEqual([
      'NORMALISE_INVALID end_state.normalise.phone: "phone" has no assertion to normalise',
    ]);
  });
});

describe('spec lint for slot fields', () => {
  const warnings = (tool: Record<string, unknown>) => {
    const loaded = validateSpec({
      id: 'lint',
      blocks: [{ user: 'hi', expect: { tools: [{ label: 't', ...tool }] } }],
    });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    return loaded.warnings.map((issue) => `${issue.code} ${issue.path}`);
  };

  it('warns on a phone, an email or an address compared exactly, and not once a rule covers it', () => {
    const input = {
      customer: { subset: { phone: '+12025550131', email: 'jo.okafor@example.com' } },
      address: '88 Summit Avenue, Acmeville',
      address_id: 'addr-103',
      category: 'home',
    };
    expect(warnings({ input })).toEqual([
      'SLOT_FIELD_NO_RULE blocks.0.expect.tools.0.normalise.customer.phone',
      'SLOT_FIELD_NO_RULE blocks.0.expect.tools.0.normalise.customer.email',
      'SLOT_FIELD_NO_RULE blocks.0.expect.tools.0.normalise.address',
    ]);
    const normalise = {
      'customer.phone': 'phone_e164',
      'customer.email': 'email_lower',
      address: 'address_canon',
    };
    expect(warnings({ input, normalise })).toEqual([]);
  });

  it('names the rule each slot calls for, with country code 1 only on a North American number', () => {
    expect(
      slotRules({
        number: '+12025550150',
        customer: { subset: { phone: '+44 20 794', email: 'Jo@Example.com', name: 'Jo' } },
        address: { one_of: ['14 Harbor Road, Acmeville', '88 Summit Avenue, Acmeville'] },
        reason: 'callback',
        address_id: 'addr-101',
        summary: { contains: '88 Summit Avenue' },
      }),
    ).toEqual({
      number: { rule: 'phone_e164', country_code: '1' },
      'customer.phone': 'phone_e164',
      'customer.email': 'email_lower',
      address: 'address_canon',
    });
  });

  it('lists a surface form that nobody has approved', () => {
    expect(
      warnings({
        input: { address: '88 Summit Avenue, Acmeville' },
        normalise: {
          address: { rule: 'address_canon', surface_forms: [{ form: '88 Summit Avenue', approved: false }] },
        },
      }),
    ).toEqual(['SURFACE_FORM_UNAPPROVED blocks.0.expect.tools.0.normalise.address']);
  });
});

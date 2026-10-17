import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { between, pick, type RawSpec, type Rng, rngFor, run, SHOP } from '../harness';
import { type FileAction, plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Level 5: value checks, ask the tool what a value means (PR 459; policy/value-check/default.yaml there). The
 * ladder `runLadder(case, policy, services)` of the checks package decides whether the value the agent wrote is
 * the gold value: equal values pass and differing non-strings fail on their own (`identity`); a replayable tool
 * that declares the field and a world with distractors decides by what it resolves (`rung1_outcome`); a
 * stated format (`pattern`, `enum`, `const`) only fails a value (`rung2_contract`); a value the user or a file
 * gave may not be changed (`rung2b_as_given`); anything no rung settles is compared exactly (`exact_fallback`,
 * lint `no_decider`), so a fail stays a fail. The tools here are fictional and their truth is code: a phone
 * resolves by its digits, an email by its lower case, a bike code by its upper case.
 */

const LADDER = 'packages/checks/src/value-check/ladder.ts';
const OUTCOME = 'packages/checks/src/value-check/outcome.ts';
const CONTRACT = 'packages/checks/src/value-check/contract.ts';
const AS_GIVEN = 'packages/checks/src/value-check/as-given.ts';

type Result = { outcome: string; rung: string; lint?: { id: string } };
type Case = Record<string, unknown>;
type Services = Record<string, unknown>;

type RunLadder = (value: Case, policy?: unknown, services?: Services) => Promise<Result>;

/** A fictional directory: customers with a phone and an email, and bikes with a code. */
type World = {
  customers: { id: string; phone: string; email: string }[];
  bikes: { id: string; code: string }[];
};

function world(rng: Rng): World {
  const customers = SHOP.customers.map((name, index) => {
    const digits = `202555${String(between(rng, 1000, 9999))}${index}`.slice(0, 10);
    return {
      id: `C-${index}${between(rng, 10, 99)}`,
      phone: `+1${digits}`,
      email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@larkspur.example`,
    };
  });
  const bikes = SHOP.bikes.map((bike, index) => ({
    id: `B-${index}${between(rng, 10, 99)}`,
    code: `${bike
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 4)
      .toUpperCase()}${between(rng, 10, 99)}`,
  }));
  return { customers, bikes };
}

/** A phone written another way: spaces between groups, the same digits. */
const spaced = (phone: string) =>
  `${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;

type ToolSpec = {
  tool: string;
  field: string;
  /** The gold value of the record and the same referent written another way. */
  gold(w: World, index: number): string;
  other(w: World, index: number): string;
  /** The tool's own resolution: the record id a value names, or null. */
  resolve(w: World, value: string): string | null;
  resolved: string;
};

const TOOLS: ToolSpec[] = [
  {
    tool: 'customer.find',
    field: 'phone',
    gold: (w, i) => (w.customers[i] as World['customers'][number]).phone,
    other: (w, i) => spaced((w.customers[i] as World['customers'][number]).phone),
    resolve: (w, value) =>
      w.customers.find((c) => c.phone.replace(/\D/g, '') === value.replace(/\D/g, ''))?.id ?? null,
    resolved: 'customer_id',
  },
  {
    tool: 'customer.lookup',
    field: 'email',
    gold: (w, i) => (w.customers[i] as World['customers'][number]).email,
    other: (w, i) => (w.customers[i] as World['customers'][number]).email.toUpperCase(),
    resolve: (w, value) => w.customers.find((c) => c.email === value.toLowerCase())?.id ?? null,
    resolved: 'customer_id',
  },
  {
    tool: 'bikes.reserve',
    field: 'bike_code',
    gold: (w, i) => (w.bikes[i] as World['bikes'][number]).code,
    other: (w, i) => (w.bikes[i] as World['bikes'][number]).code.toLowerCase(),
    resolve: (w, value) => w.bikes.find((b) => b.code === value.toUpperCase())?.id ?? null,
    resolved: 'bike_id',
  },
];

/** A replayer over the fictional world: the tool's own resolution, a refusal on an empty value. */
function replayer(
  w: World,
  spec: ToolSpec,
  options: { declared?: boolean; distractors?: boolean; inputs?: string[]; refuse?: string },
) {
  return {
    declaration: (tool: string) =>
      options.declared === false || tool !== spec.tool
        ? undefined
        : {
            resolved: [spec.resolved],
            distractors: options.distractors ?? true,
            ...(options.inputs ? { inputs: options.inputs } : {}),
          },
    call: (tool: string, input: Record<string, unknown>) => {
      if (tool !== spec.tool) return { ok: false, error: `unknown tool ${tool}` };
      const value = String(input[spec.field] ?? '');
      if (value === '' || value === options.refuse) return { ok: false, error: `${spec.field} refused` };
      return { ok: true, output: { [spec.resolved]: spec.resolve(w, value) } };
    },
  };
}

type OutcomeCase = {
  id: string;
  tier: Tier;
  want: { outcome: string; rung: string };
  build(
    w: World,
    spec: ToolSpec,
    rng: Rng,
  ): { value: unknown; gold: unknown; services: Services; field?: string };
};

const recordIndex = (rng: Rng) => between(rng, 0, SHOP.customers.length - 1);

const OUTCOME_CASES: OutcomeCase[] = [
  {
    id: 'same-referent-reformatted',
    tier: 2,
    want: { outcome: 'pass', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return { value: s.other(w, i), gold: s.gold(w, i), services: { replayer: replayer(w, s, {}) } };
    },
  },
  {
    id: 'other-referent',
    tier: 1,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      const j = (i + 1 + between(rng, 0, SHOP.customers.length - 2)) % SHOP.customers.length;
      return { value: s.other(w, j), gold: s.gold(w, i), services: { replayer: replayer(w, s, {}) } };
    },
  },
  {
    id: 'unknown-value',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return { value: `${s.gold(w, i)}9`, gold: s.gold(w, i), services: { replayer: replayer(w, s, {}) } };
    },
  },
  {
    id: 'tool-refuses-the-value',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung1_outcome' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      const value = s.other(w, i);
      return { value, gold: s.gold(w, i), services: { replayer: replayer(w, s, { refuse: value }) } };
    },
  },
  {
    id: 'no-distractors',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return {
        value: s.other(w, i),
        gold: s.gold(w, i),
        services: { replayer: replayer(w, s, { distractors: false }) },
      };
    },
  },
  {
    id: 'tool-not-declared',
    tier: 3,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return {
        value: s.other(w, i),
        gold: s.gold(w, i),
        services: { replayer: replayer(w, s, { declared: false }) },
      };
    },
  },
  {
    id: 'field-only-stored',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      return {
        value: s.other(w, i),
        gold: s.gold(w, i),
        services: { replayer: replayer(w, s, { inputs: ['note'] }) },
      };
    },
  },
  {
    id: 'gold-refused',
    tier: 5,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (w, s, rng) => {
      const i = recordIndex(rng);
      const gold = s.gold(w, i);
      return { value: s.other(w, i), gold, services: { replayer: replayer(w, s, { refuse: gold }) } };
    },
  },
];

function ladder(product: Parameters<BankItem['check']>[0]['product']): RunLadder {
  return need<RunLadder>(product.checks, 'checks', 'runLadder');
}

function judged(result: Result, want: { outcome: string; rung: string }, about: string) {
  if (result.outcome !== want.outcome || result.rung !== want.rung)
    return fail(
      `the ladder decided ${result.outcome} by ${result.rung} on ${about}, expected ${want.outcome} by ${want.rung}`,
    );
  if (want.rung === 'exact_fallback' && result.lint?.id !== 'no_decider')
    return fail(
      `an exact fallback on ${about} carries the lint ${result.lint?.id ?? 'none'}, expected no_decider`,
    );
  return PASS;
}

function outcomeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const spec of TOOLS) {
    for (const outcomeCase of OUTCOME_CASES) {
      const id = `values/outcome/${spec.field}/${outcomeCase.id}`;
      items.push({
        id,
        family: 'values-outcome',
        tier: outcomeCase.tier,
        level: 4,
        component: outcomeCase.want.rung === 'rung1_outcome' ? OUTCOME : LADDER,
        title: `the ${spec.field} written into ${spec.tool} (${outcomeCase.id.replace(/-/g, ' ')}) is decided ${outcomeCase.want.outcome} by ${outcomeCase.want.rung}`,
        cause:
          outcomeCase.want.rung === 'rung1_outcome'
            ? 'The outcome rung replays the call with the value and with the gold and compares what the tool resolves.'
            : `The outcome rung leaves a value it cannot decide (${outcomeCase.id.replace(/-/g, ' ')}) to the exact fallback.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const w = world(rng);
          const { value, gold, services } = outcomeCase.build(w, spec, rng);
          const result = await ladder(product)(
            { tool: spec.tool, field: spec.field, gold, value, input: { [spec.field]: value } },
            undefined,
            services,
          );
          const verdict = judged(
            result,
            outcomeCase.want,
            `${JSON.stringify(value)} against ${JSON.stringify(gold)}`,
          );
          if (!verdict.pass || outcomeCase.id !== 'same-referent-reformatted') return verdict;
          // The twin: the same two writings against a tool that resolves the second to another record. The rung
          // compares what the tool resolves, never the form of the two writings.
          const strict: ToolSpec = {
            ...spec,
            resolve: (world2, written) =>
              written === gold ? spec.resolve(world2, gold) : `elsewhere-${spec.resolved}`,
          };
          const twin = await ladder(product)(
            { tool: spec.tool, field: spec.field, gold, value, input: { [spec.field]: value } },
            undefined,
            { replayer: replayer(w, strict, {}) },
          );
          return judged(
            twin,
            { outcome: 'fail', rung: 'rung1_outcome' },
            `${JSON.stringify(value)} against ${JSON.stringify(gold)}, a tool that resolves them to two records`,
          );
        },
      });
    }
  }
  return items;
}

type IdentityCase = {
  id: string;
  tier: Tier;
  values(rng: Rng): [unknown, unknown];
  want: { outcome: string; rung: string };
};

const IDENTITY_CASES: IdentityCase[] = [
  {
    id: 'string-equal',
    tier: 1,
    values: (rng) => {
      const v = pick(rng, SHOP.bikes);
      return [v, v];
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'number-equal',
    tier: 1,
    values: (rng) => {
      const v = between(rng, 1, 999);
      return [v, v];
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'number-differs',
    tier: 1,
    values: (rng) => {
      const v = between(rng, 1, 999);
      return [v + 1, v];
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'boolean-differs',
    tier: 2,
    values: (rng) => {
      const v = rng() < 0.5;
      return [!v, v];
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'list-differs',
    tier: 2,
    values: (rng) => {
      const v = between(rng, 1, 9);
      return [
        [v, v + 1],
        [v + 1, v],
      ];
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'absent',
    tier: 2,
    values: (rng) => [undefined, pick(rng, SHOP.bikes)],
    want: { outcome: 'fail', rung: 'identity' },
  },
  {
    id: 'object-equal',
    tier: 2,
    values: (rng) => {
      const d = between(rng, 1, 28);
      return [
        { day: d, bike: 'Fern 3' },
        { bike: 'Fern 3', day: d },
      ];
    },
    want: { outcome: 'pass', rung: 'identity' },
  },
  {
    id: 'string-number',
    tier: 3,
    values: (rng) => {
      const v = between(rng, 10, 99);
      return [String(v), v];
    },
    want: { outcome: 'fail', rung: 'identity' },
  },
];

function identityItems(): BankItem[] {
  const items: BankItem[] = [];
  const contexts = ['no-services', 'replayer', 'replayer-other-tool'] as const;
  for (const identityCase of IDENTITY_CASES) {
    for (const context of contexts) {
      const id = `values/identity/${identityCase.id}/${context}`;
      items.push({
        id,
        family: 'values-identity',
        tier: identityCase.tier,
        level: 4,
        component: LADDER,
        title: `a ${identityCase.id.replace(/-/g, ' ')} value (${context.replace(/-/g, ' ')}) is ${identityCase.want.outcome === 'pass' ? 'passed' : 'failed'} on its own, before any rung`,
        cause:
          identityCase.want.outcome === 'pass'
            ? 'The ladder passes a value equal to the gold before any rung.'
            : 'The ladder fails a differing value that is not a string before any rung.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const w = world(rng);
          const [value, gold] = identityCase.values(rng);
          const spec = TOOLS[0] as ToolSpec;
          const services: Services =
            context === 'no-services'
              ? {}
              : { replayer: replayer(w, context === 'replayer' ? spec : (TOOLS[2] as ToolSpec), {}) };
          const result = await ladder(product)(
            { tool: spec.tool, field: 'slot', gold, value, input: { slot: value } },
            undefined,
            services,
          );
          return judged(
            result,
            identityCase.want,
            `${JSON.stringify(value)} against ${JSON.stringify(gold)}`,
          );
        },
      });
    }
  }
  return items;
}

type ContractCase = {
  id: string;
  tier: Tier;
  want: { outcome: string; rung: string };
  build(rng: Rng): { schema: Record<string, unknown>; value: string; gold: string };
};

const code4 = (rng: Rng) => `LK-${between(rng, 1000, 9999)}`;

const CONTRACT_CASES: ContractCase[] = [
  {
    id: 'breaks-pattern',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const gold = code4(rng);
      return { schema: { type: 'string', pattern: '^LK-[0-9]{4}$' }, value: gold.replace('-', ' '), gold };
    },
  },
  {
    id: 'other-enum-member',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const [gold, value] = [pick(rng, SHOP.bikes), pick(rng, SHOP.bikes)];
      const other = value === gold ? (SHOP.bikes.find((bike) => bike !== gold) ?? value) : value;
      return { schema: { type: 'string', enum: [...SHOP.bikes] }, value: other, gold };
    },
  },
  {
    id: 'outside-enum',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: (rng) => {
      const gold = pick(rng, SHOP.bikes);
      return { schema: { type: 'string', enum: [...SHOP.bikes] }, value: gold.toUpperCase(), gold };
    },
  },
  {
    id: 'breaks-const',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2_contract' },
    build: () => ({ schema: { type: 'string', const: 'EUR' }, value: 'eur', gold: 'EUR' }),
  },
  {
    id: 'inside-pattern-different',
    tier: 4,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (rng) => {
      const gold = code4(rng);
      const value = gold.endsWith('9') ? `${gold.slice(0, -1)}8` : `${gold.slice(0, -1)}9`;
      return { schema: { type: 'string', pattern: '^LK-[0-9]{4}$' }, value, gold };
    },
  },
];

function contractItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const contractCase of CONTRACT_CASES) {
    for (const nesting of ['top', 'nested'] as const) {
      for (const context of ['no-replayer', 'undeclared-tool'] as const) {
        const id = `values/contract/${contractCase.id}/${nesting}/${context}`;
        items.push({
          id,
          family: 'values-contract',
          tier: Math.min(5, contractCase.tier + (nesting === 'nested' ? 1 : 0)) as Tier,
          level: 4,
          component: contractCase.want.rung === 'rung2_contract' ? CONTRACT : LADDER,
          title: `a value against the tool's stated contract (${contractCase.id.replace(/-/g, ' ')}, ${nesting} field, ${context.replace(/-/g, ' ')}) is decided ${contractCase.want.outcome} by ${contractCase.want.rung}`,
          cause:
            contractCase.want.rung === 'rung2_contract'
              ? 'The contract rung fails a value outside the pattern, enum or const the tool definition states.'
              : 'The contract rung passes nothing: a value inside the stated format goes on to the exact fallback.',
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const { schema, value, gold } = contractCase.build(rng);
            const field = nesting === 'top' ? 'code' : 'booking.code';
            const definition = {
              name: 'booking.create',
              parameters:
                nesting === 'top'
                  ? { type: 'object', properties: { code: schema } }
                  : {
                      type: 'object',
                      properties: { booking: { type: 'object', properties: { code: schema } } },
                    },
            };
            const input = nesting === 'top' ? { code: value } : { booking: { code: value } };
            const services: Services =
              context === 'no-replayer' ? {} : { replayer: replayer(world(rng), TOOLS[0] as ToolSpec, {}) };
            const result = await ladder(product)(
              { tool: 'booking.create', field, gold, value, input, definition },
              undefined,
              services,
            );
            return judged(
              result,
              contractCase.want,
              `${JSON.stringify(value)} against ${JSON.stringify(gold)} under ${JSON.stringify(schema)}`,
            );
          },
        });
      }
    }
  }
  return items;
}

type GivenCase = {
  id: string;
  tier: Tier;
  want: { outcome: string; rung: string };
  build(gold: string, other: string): { value: string; user?: string[]; files?: Record<string, string> };
};

const GIVEN_CASES: GivenCase[] = [
  {
    id: 'altered',
    tier: 2,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({ value: other, user: [`It is ${gold}, thanks.`] }),
  },
  {
    id: 'stale',
    tier: 4,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({ value: other, user: [`It is ${other}.`, `Sorry, it is ${gold}.`] }),
  },
  {
    id: 'copied-a-wrong-value',
    tier: 3,
    want: { outcome: 'fail', rung: 'exact_fallback' },
    build: (_gold, other) => ({ value: other, user: [`Use ${other}.`] }),
  },
  {
    id: 'altered-from-a-file',
    tier: 3,
    want: { outcome: 'fail', rung: 'rung2b_as_given' },
    build: (gold, other) => ({ value: other, files: { 'notes.txt': `value: ${gold}\n` } }),
  },
  {
    id: 'surrounding-space',
    tier: 4,
    want: { outcome: 'pass', rung: 'identity' },
    build: (gold) => ({ value: gold, user: [`It is ${gold} .`] }),
  },
];

function givenItems(): BankItem[] {
  const items: BankItem[] = [];
  const kinds = [
    {
      id: 'name',
      gold: (rng: Rng) => pick(rng, SHOP.customers),
      other: (v: string) => v.split(' ').reverse().join(' '),
    },
    { id: 'bike', gold: (rng: Rng) => pick(rng, SHOP.bikes), other: (v: string) => `${v} Plus` },
    { id: 'code', gold: (rng: Rng) => code4(rng), other: (v: string) => v.replace('LK-', 'LK') },
    {
      id: 'address',
      gold: (rng: Rng) => `${between(rng, 2, 90)} Fennel Row`,
      other: (v: string) => v.replace('Row', 'Rd'),
    },
  ];
  for (const givenCase of GIVEN_CASES) {
    for (const kind of kinds) {
      const id = `values/as-given/${givenCase.id}/${kind.id}`;
      items.push({
        id,
        family: 'values-as-given',
        tier: givenCase.tier,
        level: 4,
        component: givenCase.want.rung === 'rung2b_as_given' ? AS_GIVEN : LADDER,
        title: `a ${kind.id} the user or a file gave (${givenCase.id.replace(/-/g, ' ')}) is decided ${givenCase.want.outcome} by ${givenCase.want.rung}`,
        cause:
          givenCase.want.rung === 'rung2b_as_given'
            ? 'The as-given rung fails a value the agent changed from what the user or a file gave.'
            : 'The as-given rung never passes a copy: a copied value goes on to the exact fallback.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const gold = kind.gold(rng);
          const { value, user, files } = givenCase.build(gold, kind.other(gold));
          const result = await ladder(product)(
            {
              tool: 'booking.create',
              field: 'customer',
              gold,
              value,
              input: { customer: value },
              sources: { ...(user ? { user } : {}), ...(files ? { files } : {}) },
            },
            undefined,
            {},
          );
          const verdict = judged(
            result,
            givenCase.want,
            `${JSON.stringify(value)} against ${JSON.stringify(gold)}`,
          );
          if (!verdict.pass || givenCase.want.rung !== 'rung2b_as_given') return verdict;
          // The twin: the expected writing only inside a longer word is no whole token, so the rung decides nothing.
          const twin = await ladder(product)(
            {
              tool: 'booking.create',
              field: 'customer',
              gold,
              value,
              input: { customer: value },
              sources: { user: [`It is ${gold}s, thanks.`] },
            },
            undefined,
            {},
          );
          return judged(
            twin,
            { outcome: 'fail', rung: 'exact_fallback' },
            `${JSON.stringify(value)} when the user wrote only "${gold}s"`,
          );
        },
      });
    }
  }
  return items;
}

/** Level 5 of the blocks bank. */
export function valueItems(): BankItem[] {
  return [
    ...identityItems(),
    ...outcomeItems(),
    ...contractItems(),
    ...givenItems(),
    ...recomputeItems(),
    ...stateDiffItems(),
  ];
}

/** A one-block CODE spec whose agent writes `files` and nothing else, its sandbox kept so the item can read them. */
async function codeRun(
  product: BlocksProduct,
  seed: number,
  scratch: string,
  tag: string,
  files: FileAction[],
  extra: Record<string, unknown> = {},
) {
  const marker = token(seed, `${tag}#marker`, 8);
  const raw: RawSpec = {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    kind: 'task',
    workspace_seed: {
      files: {
        'data/rentals.csv': 'bike,days\nFern 3,4\n',
        ...((extra.seed as Record<string, string>) ?? {}),
      },
    },
    blocks: [
      {
        id: token(seed, `${tag}#id`),
        user: `${marker} Build the files.`,
        expect: { execution: { exit_code: 0 } },
      },
    ],
  };
  const agent = plantedAgent(
    product,
    'code',
    new Map([[marker, { reply: 'Done.', files, commands: [{ command: 'python make.py', exitCode: 0 }] }]]),
    { scratch, keep: true },
  );
  const record = await run(product, raw, agent.adapter);
  const block = record.blocks[0];
  const observed = (block?.observed ?? {}) as {
    sandbox?: { root?: string };
    workspaceDiff?: { created: string[]; changed: string[]; deleted: string[] };
  };
  return { root: observed.sandbox?.root, diff: observed.workspaceDiff };
}

type FormulaCase = {
  id: string;
  tier: Tier;
  produced(rng: Rng): string;
  expected: string;
  want: { outcome: string; rung: string };
};

const FORMULA_CASES: FormulaCase[] = [
  {
    id: 'same-formula',
    tier: 1,
    produced: () => 'C2*12',
    expected: 'C2*12',
    want: { outcome: 'pass', rung: 'rung1_recompute' },
  },
  {
    id: 'reordered-formula',
    tier: 2,
    produced: () => '12*C2',
    expected: 'C2*12',
    want: { outcome: 'pass', rung: 'rung1_recompute' },
  },
  {
    id: 'sum-of-range',
    tier: 3,
    produced: () => 'SUM(B2:C2)',
    expected: 'B2+C2',
    want: { outcome: 'pass', rung: 'rung1_recompute' },
  },
  {
    id: 'off-by-one',
    tier: 2,
    produced: () => 'C2*12+1',
    expected: 'C2*12',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
  {
    id: 'hard-coded-result',
    tier: 4,
    produced: () => 'HARD',
    expected: 'C2*12',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
  {
    id: 'wrong-operand',
    tier: 3,
    produced: () => 'B2*12',
    expected: 'C2*12',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
  {
    id: 'rounded-away',
    tier: 4,
    produced: () => 'ROUND(C2/7,0)',
    expected: 'C2/7',
    want: { outcome: 'fail', rung: 'rung1_recompute' },
  },
];

/**
 * CODE: a formula the code agent wrote into an xlsx cell, read back by the product's xlsx reader, decided by the
 * recompute rung: the same computation on the given and on changed inputs passes, however it is written; a
 * hard-coded result equal on the given inputs fails on changed ones.
 */
function recomputeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const formulaCase of FORMULA_CASES) {
    for (const variant of ['small', 'large', 'negative']) {
      const id = `values/recompute/code/${formulaCase.id}/${variant}`;
      items.push({
        id,
        family: 'values-recompute-code',
        tier: formulaCase.tier,
        level: 4,
        component:
          formulaCase.want.rung === 'rung1_recompute'
            ? 'packages/checks/src/value-check/recompute.ts'
            : LADDER,
        title: `a formula a code agent wrote into a workbook (${formulaCase.id.replace(/-/g, ' ')}, ${variant} inputs), read back from the file, is decided ${formulaCase.want.outcome} by ${formulaCase.want.rung}`,
        cause:
          formulaCase.want.rung === 'rung1_recompute'
            ? `The recompute rung runs the produced and the gold computation on the given and changed inputs (${formulaCase.id.replace(/-/g, ' ')}).`
            : 'The ladder passes a formula equal to the gold before any rung.',
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const scale = variant === 'large' ? 10_000 : variant === 'negative' ? -50 : 10;
          const b = between(rng, 1, 9) * scale;
          const c = between(rng, 1, 9) * scale + 3;
          const expectedValue = Number(
            new Function('B2', 'C2', `return ${formulaCase.expected.replace('SUM(B2:C2)', '(B2+C2)')}`)(b, c),
          );
          const written =
            formulaCase.produced(rng) === 'HARD' ? expectedValue : `=${formulaCase.produced(rng)}`;
          const path = `out/${token(seed, `${id}#file`)}.xlsx`;
          const { root } = await codeRun(product, seed, scratch, id, [
            {
              path,
              format: 'xlsx',
              data: {
                sheets: [
                  {
                    name: 'Rentals',
                    rows: [
                      ['Bike', 'Base', 'Days', 'Total'],
                      ['Fern 3', b, c, written],
                    ],
                  },
                ],
              },
            },
          ]);
          if (!root) return fail('the kept sandbox names no folder: the workbook cannot be read back');
          const readWorkbook = need<
            (
              bytes: Uint8Array,
            ) => Promise<
              { cell(row: number, column: number): { value: unknown; formula?: string } | undefined }[]
            >
          >(product.artifacts, 'artifacts', 'readWorkbook');
          const sheets = await readWorkbook(readFileSync(join(root, path)));
          const cell = sheets[0]?.cell(2, 4);
          const produced =
            cell?.formula !== undefined
              ? { formula: cell.formula.replace(/^=/, '') }
              : { value: cell?.value };
          const result = await ladder(product)(
            {
              field: 'Total',
              gold: `=${formulaCase.expected}`,
              value: cell?.formula !== undefined ? `=${cell.formula.replace(/^=/, '')}` : cell?.value,
              recompute: { produced, expected: { formula: formulaCase.expected }, inputs: { B2: b, C2: c } },
            },
            undefined,
            {},
          );
          const verdict = judged(
            result,
            formulaCase.want,
            `${JSON.stringify(produced)} against ${formulaCase.expected}`,
          );
          if (!verdict.pass) return verdict;
          // The twin: a formula equal to the gold on the given inputs and on any input set outside 0.5 to 1.5 times
          // them, and different inside: only the documented draws of the changed inputs tell it apart.
          const roots = [c, 2 * c - 3, 5 * c - 3, 11 * c - 3].map((r) => `(C2-(${r}))`).join('*');
          const twin = await ladder(product)(
            {
              field: 'Total',
              gold: `=${formulaCase.expected}`,
              value: `=${formulaCase.expected}+${roots}`,
              recompute: {
                produced: { formula: `${formulaCase.expected}+${roots}` },
                expected: { formula: formulaCase.expected },
                inputs: { B2: b, C2: c },
              },
            },
            undefined,
            {},
          );
          return judged(
            twin,
            { outcome: 'fail', rung: 'rung1_recompute' },
            `the gold plus ${roots}, zero on the given inputs`,
          );
        },
      });
    }
  }
  return items;
}

type DiffCase = {
  id: string;
  tier: Tier;
  want: string;
  build(
    rng: Rng,
    base: string,
  ): { files: FileAction[]; expected: Record<string, string[]>; allowed?: string[] };
};

const DIFF_CASES: DiffCase[] = [
  {
    id: 'exact',
    tier: 1,
    want: 'pass',
    build: (_r, base) => ({
      files: [{ path: `${base}/a.csv`, format: 'csv', data: [['x'], [1]] }],
      expected: { created: [`${base}/a.csv`] },
    }),
  },
  {
    id: 'extra-file',
    tier: 2,
    want: 'fail',
    build: (_r, base) => ({
      files: [
        { path: `${base}/a.csv`, format: 'csv', data: [['x'], [1]] },
        { path: `${base}/tmp.txt`, format: 'txt', data: 'scratch' },
      ],
      expected: { created: [`${base}/a.csv`] },
    }),
  },
  {
    id: 'missing-file',
    tier: 2,
    want: 'fail',
    build: (_r, base) => ({ files: [], expected: { created: [`${base}/a.csv`] } }),
  },
  {
    id: 'allowed-glob',
    tier: 3,
    want: 'pass',
    build: (_r, base) => ({
      files: [
        { path: `${base}/a.csv`, format: 'csv', data: [['x'], [1]] },
        { path: `${base}/logs/run.txt`, format: 'txt', data: 'ok' },
      ],
      expected: { created: [`${base}/a.csv`] },
      allowed: [`${base}/logs/**`],
    }),
  },
  {
    id: 'changed-not-created',
    tier: 4,
    want: 'fail',
    build: () => ({
      files: [{ path: 'data/rentals.csv', format: 'txt', data: 'bike,days\nFern 3,5\n' }],
      expected: { created: ['data/rentals.csv'] },
    }),
  },
  {
    id: 'changed-expected',
    tier: 3,
    want: 'pass',
    build: () => ({
      files: [{ path: 'data/rentals.csv', format: 'txt', data: 'bike,days\nFern 3,5\n' }],
      expected: { changed: ['data/rentals.csv'] },
    }),
  },
  {
    id: 'many-files-one-extra',
    tier: 5,
    want: 'fail',
    build: (rng, base) => {
      const n = between(rng, 20, 40);
      const files: FileAction[] = Array.from({ length: n }, (_, i) => ({
        path: `${base}/part-${i}.json`,
        format: 'json',
        data: { i },
      }));
      return {
        files: [...files, { path: `${base}/part-${n}.json`, format: 'json', data: { i: n } }],
        expected: { created: files.map((file) => file.path) },
      };
    },
  },
];

/** CODE: the state-diff rung on the workspace diff a real code run produced. */
function stateDiffItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const diffCase of DIFF_CASES) {
    for (const folder of ['out', 'reports/2026', 'deep/a/b/c']) {
      const id = `values/state-diff/code/${diffCase.id}/${folder.split('/').length}`;
      items.push({
        id,
        family: 'values-state-diff-code',
        tier: diffCase.tier,
        level: 4,
        component: 'packages/checks/src/value-check/state-diff.ts',
        title: `the workspace a code agent left (${diffCase.id.replace(/-/g, ' ')}, under ${folder}) is decided ${diffCase.want} by the state-diff rung on the run's own diff`,
        cause: `The state-diff rung compares the net workspace diff with the expected and allowed changes (${diffCase.id.replace(/-/g, ' ')}).`,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const base = `${folder}/${token(seed, id)}`;
          const { files, expected, allowed } = diffCase.build(rng, base);
          const { diff } = await codeRun(product, seed, scratch, id, files);
          if (!diff) return fail('the run recorded no workspace diff');
          const result = await ladder(product)(
            {
              field: 'workspace',
              gold: expected,
              value: diff,
              stateDiff: { diff, expected, ...(allowed ? { allowed } : {}) },
            },
            undefined,
            {},
          );
          const verdict = judged(
            result,
            { outcome: diffCase.want, rung: 'rung1_state_diff' },
            `the diff ${JSON.stringify(diff).slice(0, 200)}`,
          );
          if (!verdict.pass) return verdict;
          // The twin: the observed diff expected with a leading ./ on every path is the same diff: paths compare
          // with forward slashes and no leading ./ (block-contracts.md, State diff).
          // An empty run diff (a missing file) takes the expected changes as the observed diff of the twin.
          const sets = ['created', 'changed', 'deleted'] as const;
          const empty = sets.every((set) => (diff[set] ?? []).length === 0);
          const seen = empty ? { created: [], changed: [], deleted: [], ...expected } : diff;
          const dotted = Object.fromEntries(
            sets
              .filter((set) => (seen[set] ?? []).length > 0)
              .map((set) => [set, (seen[set] ?? []).map((path: string) => `./${path}`)]),
          );
          const twin = await ladder(product)(
            { field: 'workspace', gold: dotted, value: seen, stateDiff: { diff: seen, expected: dotted } },
            undefined,
            {},
          );
          const dottedVerdict = judged(
            twin,
            { outcome: 'pass', rung: 'rung1_state_diff' },
            `the diff against ${JSON.stringify(dotted).slice(0, 160)}`,
          );
          if (!dottedVerdict.pass || !allowed) return dottedVerdict;
          // The second twin: ? stands for one character, so r?n.txt allows run.txt and nothing longer.
          const single = [`${base}/logs/r?n.txt`];
          const glob = await ladder(product)(
            {
              field: 'workspace',
              gold: expected,
              value: diff,
              stateDiff: { diff, expected, allowed: single },
            },
            undefined,
            {},
          );
          const globVerdict = judged(
            glob,
            { outcome: 'pass', rung: 'rung1_state_diff' },
            `the allowed glob ${single[0]}`,
          );
          if (!globVerdict.pass) return globVerdict;
          const narrow = [`${base}/logs/r?.txt`];
          const tight = await ladder(product)(
            {
              field: 'workspace',
              gold: expected,
              value: diff,
              stateDiff: { diff, expected, allowed: narrow },
            },
            undefined,
            {},
          );
          return judged(
            tight,
            { outcome: 'fail', rung: 'rung1_state_diff' },
            `the allowed glob ${narrow[0]}`,
          );
        },
      });
    }
  }
  return items;
}

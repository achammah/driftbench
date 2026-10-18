import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadVariableStore,
  parseVariableStoreText,
  type SpaceMap,
  spaceMapToVariables,
  VariableStoreIssueCodes,
  type VariableStoreResult,
  validateSpaceMap,
  validateVariableStore,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { HAND } from './support';

const QUOTE = {
  kind: 'quote',
  path: 'prompt.md',
  quote: 'Keep each reply under 300 characters.',
  ledger: 'k4jd7xq2mf',
};
const COUNTS = { kind: 'conversations', count: 30, total: 200, set_hash: 'a'.repeat(64) };
const OWNER = { kind: 'owner', words: 'Most customers write on WhatsApp.', date: '2026-10-15' };

const variable = (id: string, kind: string, ids: string[], role = 'axis') => ({
  id,
  title: id,
  kind,
  role,
  approved: true,
  values: ids.map((value) => ({ id: value, title: value, provenance: [QUOTE] })),
});

/**
 * A valid store with every part: two axes, a detail with a boundary and weights, one impossible pair. Every
 * value, boundary and constraint names its source, so it loads with no advice.
 */
const BASE = {
  format: 1,
  agent: 'demo',
  version: '1',
  variables: [
    variable('stage', 'stage', ['a', 'b']),
    variable('channel', 'channel', ['chat', 'whatsapp']),
    {
      ...variable('days_late', 'data', [], 'detail'),
      values: [
        { id: 'under', title: 'Under two days', weight: 0.6, provenance: [QUOTE, COUNTS] },
        { id: 'exactly', title: 'Exactly two days', weight: 0.15, provenance: [QUOTE, COUNTS] },
        { id: 'over', title: 'Over two days', weight: 0.25, provenance: [QUOTE, COUNTS] },
      ],
      boundaries: [
        {
          holds: 'over',
          fails: 'under',
          edge: 'exactly',
          limit: 2,
          comparison: 'gt',
          unit: 'days',
          provenance: [QUOTE],
        },
      ],
    },
  ],
  constraints: [
    {
      forbid: { stage: 'a', channel: 'whatsapp' },
      reason: 'There is no stage a on whatsapp.',
      approved: true,
      provenance: [OWNER],
    },
  ],
};

/** An edit: the dotted path to set in a copy of the base, and the value to put there (undefined removes it). */
type Edit = [path: string, to: unknown];

function setAt(root: unknown, path: string, to: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() ?? '';
  let node = root as Record<string, unknown>;
  for (const key of keys) node = node[key] as Record<string, unknown>;
  node[last] = to;
}

function edited(edits: Edit[], from: unknown = BASE): unknown {
  const raw = structuredClone(from);
  for (const [path, to] of edits) setAt(raw, path, to);
  return raw;
}

function issues(result: VariableStoreResult): string[] {
  return result.ok ? [] : result.errors.map((issue) => `${issue.code} ${issue.path}`).sort();
}

const BOUNDARY = 'variables.2.boundaries.0';
const FIRST = 'variables.0.values.0';
const COUNTED = 'variables.2.values.0';

describe('a valid store', () => {
  it('loads with every part and no advice', () => {
    const result = validateVariableStore(BASE);
    expect(issues(result)).toEqual([]);
    expect(result.ok && result.warnings).toEqual([]);
  });

  it('applies the defaults: a declared prior and no constraints', () => {
    const result = validateVariableStore(
      edited([
        ['prior', undefined],
        ['constraints', undefined],
      ]),
    );
    expect(result.ok && result.store.prior).toEqual({ kind: 'declared' });
    expect(result.ok && result.store.constraints).toEqual([]);
  });

  it('keeps the rule fields a proposal value can carry', () => {
    const rule = {
      id: 'a',
      title: 'Stage a',
      polarity: 'must',
      when: { channel: ['chat'] },
      unless: { channel: ['whatsapp'] },
      limit: 2,
      within: { minutes: 5 },
      priority: 'first',
    };
    expect(issues(validateVariableStore(edited([[FIRST, rule]])))).toEqual([]);
  });

  it('reads YAML text and JSON text, and refuses a repeated key', () => {
    expect(parseVariableStoreText(JSON.stringify(BASE), 'json').ok).toBe(true);
    const yaml = [
      'format: 1',
      'agent: demo',
      "version: '1'",
      'variables:',
      '  - { id: v, title: V, kind: data, role: axis, approved: true, values: [ { id: x, title: X } ] }',
    ].join('\n');
    expect(parseVariableStoreText(yaml, 'yaml').ok).toBe(true);
    expect(issues(parseVariableStoreText(`${yaml}\nagent: other`, 'yaml'))).toEqual(['VARIABLES_PARSE ']);
    expect(issues(parseVariableStoreText('{ not json', 'json'))).toEqual(['VARIABLES_PARSE ']);
  });
});

const quoteOf = (change: object): Edit => [`${FIRST}.provenance`, [{ ...QUOTE, ...change }]];
const countsOf = (change: object): Edit => [`${COUNTED}.provenance`, [{ ...COUNTS, ...change }]];
const ownerOf = (change: object): Edit => [`${FIRST}.provenance`, [{ ...OWNER, ...change }]];

/** Each case: a name, the edits that break the base store, and the issues it must produce, as `CODE path`. */
const REFUSALS: Array<[name: string, edits: Edit[], expected: string[]]> = [
  ['no format', [['format', undefined]], ['SCHEMA_INVALID_VALUE format']],
  ['another format', [['format', 2]], ['SCHEMA_INVALID_VALUE format']],
  ['an unknown top-level key', [['extra', 1]], ['SCHEMA_UNRECOGNIZED_KEYS ']],
  ['no variables', [['variables', []]], ['SCHEMA_TOO_SMALL variables']],
  ['a variable with no role', [['variables.0.role', undefined]], ['SCHEMA_INVALID_VALUE variables.0.role']],
  [
    'a variable with no approval flag',
    [['variables.0.approved', undefined]],
    ['SCHEMA_INVALID_TYPE variables.0.approved'],
  ],
  ['an unknown kind', [['variables.0.kind', 'mood']], ['SCHEMA_INVALID_VALUE variables.0.kind']],
  ['a variable with an unknown key', [['variables.0.weight', 1]], ['SCHEMA_UNRECOGNIZED_KEYS variables.0']],
  ['a variable without values', [['variables.1.values', []]], ['SCHEMA_TOO_SMALL variables.1.values']],
  ['an id with a space', [[`${FIRST}.id`, 'stage a']], [`SCHEMA_INVALID_FORMAT ${FIRST}.id`]],
  ['a negative weight', [[`${COUNTED}.weight`, -1]], [`SCHEMA_TOO_SMALL ${COUNTED}.weight`]],
  [
    'a constraint without a reason',
    [['constraints.0.reason', undefined]],
    ['SCHEMA_INVALID_TYPE constraints.0.reason'],
  ],
  [
    'a constraint with no approval flag',
    [['constraints.0.approved', undefined]],
    ['SCHEMA_INVALID_TYPE constraints.0.approved'],
  ],
  ['a prior of an unknown kind', [['prior', { kind: 'guessed' }]], ['SCHEMA_INVALID_VALUE prior.kind']],
  // Provenance: a quote.
  ['a quote with no text', [quoteOf({ quote: '  ' })], [`SCHEMA_CUSTOM ${FIRST}.provenance.0.quote`]],
  [
    'a quote longer than 1000 characters',
    [quoteOf({ quote: 'x'.repeat(1001) })],
    [`SCHEMA_TOO_BIG ${FIRST}.provenance.0.quote`],
  ],
  [
    'a quote path that starts at the root',
    [quoteOf({ path: '/etc/hosts' })],
    [`SCHEMA_CUSTOM ${FIRST}.provenance.0.path`],
  ],
  [
    'a quote path with a drive letter',
    [quoteOf({ path: 'C:/estate/CLAUDE.md' })],
    [`SCHEMA_CUSTOM ${FIRST}.provenance.0.path`],
  ],
  [
    'a quote path that is a file URL, which would name a private folder',
    [quoteOf({ path: 'file:///Users/me/estate/CLAUDE.md' })],
    [`SCHEMA_CUSTOM ${FIRST}.provenance.0.path`],
  ],
  [
    'a quote path that is a web address',
    [quoteOf({ path: 'https://example.com/prompt.md' })],
    [`SCHEMA_CUSTOM ${FIRST}.provenance.0.path`],
  ],
  [
    'a quote path with a backslash',
    [quoteOf({ path: 'skills\\SKILL.md' })],
    [`SCHEMA_CUSTOM ${FIRST}.provenance.0.path`],
  ],
  [
    'a ledger id of nine characters',
    [quoteOf({ ledger: 'k4jd7xq2m' })],
    [`SCHEMA_INVALID_FORMAT ${FIRST}.provenance.0.ledger`],
  ],
  [
    'a ledger id with a digit outside the base32 alphabet',
    [quoteOf({ ledger: 'k4jd7xq2m1' })],
    [`SCHEMA_INVALID_FORMAT ${FIRST}.provenance.0.ledger`],
  ],
  [
    'a ledger id in mixed case',
    [quoteOf({ ledger: 'K4jd7xQ2mf' })],
    [`SCHEMA_INVALID_FORMAT ${FIRST}.provenance.0.ledger`],
  ],
  [
    'a ledger id in capitals',
    [quoteOf({ ledger: 'K4JD7XQ2MF' })],
    [`SCHEMA_INVALID_FORMAT ${FIRST}.provenance.0.ledger`],
  ],
  // Provenance: conversations. Counts only.
  [
    'more conversations showing a value than conversations read',
    [countsOf({ count: 201 })],
    [`SCHEMA_CUSTOM ${COUNTED}.provenance.0.count`],
  ],
  [
    'no conversation read',
    [countsOf({ count: 0, total: 0 })],
    [`SCHEMA_TOO_SMALL ${COUNTED}.provenance.0.total`],
  ],
  ['a negative count', [countsOf({ count: -1 })], [`SCHEMA_TOO_SMALL ${COUNTED}.provenance.0.count`]],
  [
    'a count that is not whole',
    [countsOf({ count: 1.5 })],
    [`SCHEMA_INVALID_TYPE ${COUNTED}.provenance.0.count`],
  ],
  [
    'a set hash that is not a SHA-256',
    [countsOf({ set_hash: 'abc123' })],
    [`SCHEMA_INVALID_FORMAT ${COUNTED}.provenance.0.set_hash`],
  ],
  [
    'a set hash in capitals',
    [countsOf({ set_hash: 'A'.repeat(64) })],
    [`SCHEMA_INVALID_FORMAT ${COUNTED}.provenance.0.set_hash`],
  ],
  [
    'conversation text in the counts: nothing but counts may enter',
    [countsOf({ text: 'Hi, my shipment is late' })],
    [`SCHEMA_UNRECOGNIZED_KEYS ${COUNTED}.provenance.0`],
  ],
  [
    'conversation ids in the counts',
    [countsOf({ ids: ['c-1', 'c-2'] })],
    [`SCHEMA_UNRECOGNIZED_KEYS ${COUNTED}.provenance.0`],
  ],
  // Provenance: the owner.
  ['owner words that are blank', [ownerOf({ words: ' ' })], [`SCHEMA_CUSTOM ${FIRST}.provenance.0.words`]],
  [
    'an owner statement with no date',
    [ownerOf({ date: undefined })],
    [`SCHEMA_INVALID_TYPE ${FIRST}.provenance.0.date`],
  ],
  [
    'an owner date that is not a day',
    [ownerOf({ date: '2026-13-40' })],
    [`SCHEMA_INVALID_FORMAT ${FIRST}.provenance.0.date`],
  ],
  [
    'an owner date with a time',
    [ownerOf({ date: '2026-10-15T09:30:00Z' })],
    [`SCHEMA_INVALID_FORMAT ${FIRST}.provenance.0.date`],
  ],
  [
    'a provenance of an unknown kind',
    [[`${FIRST}.provenance`, [{ kind: 'rumour', words: 'I heard it' }]]],
    [`SCHEMA_INVALID_UNION ${FIRST}.provenance.0.kind`],
  ],
  [
    'a quote that also claims counts',
    [quoteOf({ count: 3 })],
    [`SCHEMA_UNRECOGNIZED_KEYS ${FIRST}.provenance.0`],
  ],
  // Boundaries.
  ['a boundary with no edge', [[`${BOUNDARY}.edge`, undefined]], [`SCHEMA_INVALID_TYPE ${BOUNDARY}.edge`]],
  [
    'a limit with no comparison',
    [[`${BOUNDARY}.comparison`, undefined]],
    [`SCHEMA_CUSTOM ${BOUNDARY}.comparison`],
  ],
  [
    'a comparison with no limit',
    [
      [`${BOUNDARY}.limit`, undefined],
      [`${BOUNDARY}.unit`, undefined],
    ],
    [`SCHEMA_CUSTOM ${BOUNDARY}.limit`],
  ],
  [
    'a unit with no limit',
    [
      [`${BOUNDARY}.limit`, undefined],
      [`${BOUNDARY}.comparison`, undefined],
    ],
    [`SCHEMA_CUSTOM ${BOUNDARY}.unit`],
  ],
  [
    'a limit that is not finite',
    [[`${BOUNDARY}.limit`, Number.POSITIVE_INFINITY]],
    [`SCHEMA_INVALID_TYPE ${BOUNDARY}.limit`],
  ],
  [
    'a comparison outside lt, le, gt and ge',
    [[`${BOUNDARY}.comparison`, 'between']],
    [`SCHEMA_INVALID_VALUE ${BOUNDARY}.comparison`],
  ],
  [
    'a side that is no value of the variable',
    [[`${BOUNDARY}.holds`, 'late']],
    [`VARIABLES_UNKNOWN_VALUE ${BOUNDARY}.holds`],
  ],
  [
    'an edge that is no value of the variable',
    [[`${BOUNDARY}.edge`, 'three']],
    [`VARIABLES_UNKNOWN_VALUE ${BOUNDARY}.edge`],
  ],
  ['one value on both sides', [[`${BOUNDARY}.fails`, 'over']], [`VARIABLES_BOUNDARY ${BOUNDARY}.fails`]],
  [
    'a strict comparison with the edge on the side where the condition holds',
    [[`${BOUNDARY}.edge`, 'over']],
    [`VARIABLES_BOUNDARY ${BOUNDARY}.edge`],
  ],
  [
    'an inclusive comparison with the edge on the failing side',
    [
      [`${BOUNDARY}.comparison`, 'ge'],
      [`${BOUNDARY}.edge`, 'under'],
    ],
    [`VARIABLES_BOUNDARY ${BOUNDARY}.edge`],
  ],
  // The rules of a space map, kept.
  [
    'two variables with one id',
    [['variables.3', variable('days_late', 'data', ['x'], 'detail')]],
    ['VARIABLES_DUPLICATE variables.3.id'],
  ],
  [
    'a value listed twice',
    [['variables.1.values.2', { id: 'chat', title: 'Chat again', provenance: [QUOTE] }]],
    ['VARIABLES_DUPLICATE variables.1.values.2.id'],
  ],
  [
    'two stage axes',
    [['variables.3', variable('phase', 'stage', ['x'])]],
    ['VARIABLES_KIND_REPEATED variables.3.kind'],
  ],
  [
    'one behaviour value in two behaviour axes',
    [
      ['variables.3', variable('rules', 'behaviour', ['B-001'])],
      ['variables.4', variable('more_rules', 'behaviour', ['B-001'])],
    ],
    ['VARIABLES_AMBIGUOUS_VALUE variables.4.values.0.id'],
  ],
  [
    'a deviation axis value that is no deviation class',
    [['variables.3', variable('deviation', 'deviation', ['none', 'D11_shouting'])]],
    ['VARIABLES_UNKNOWN_DEVIATION variables.3.values.1.id'],
  ],
  [
    'a constraint that forbids nothing',
    [['constraints.0.forbid', {}]],
    ['VARIABLES_EMPTY_CONSTRAINT constraints.0.forbid'],
  ],
  [
    'a constraint on an unknown variable',
    [['constraints.0.forbid', { mood: 'calm', channel: 'chat' }]],
    ['VARIABLES_UNKNOWN_VARIABLE constraints.0.forbid.mood'],
  ],
  [
    'a constraint on an unknown value',
    [['constraints.0.forbid.channel', 'fax']],
    ['VARIABLES_UNKNOWN_VALUE constraints.0.forbid.channel'],
  ],
  [
    'one combination forbidden twice, in another order',
    [
      [
        'constraints.1',
        {
          forbid: { channel: 'whatsapp', stage: 'a' },
          reason: 'Again.',
          approved: true,
          provenance: [OWNER],
        },
      ],
    ],
    ['VARIABLES_DUPLICATE constraints.1'],
  ],
  [
    'a weight on some values of an axis only',
    [[`${FIRST}.weight`, 3]],
    ['VARIABLES_WEIGHT_INCOMPLETE variables.0.values.1.weight'],
  ],
  [
    'a weight on some values of a detail only',
    [['variables.2.values.2.weight', undefined]],
    ['VARIABLES_WEIGHT_INCOMPLETE variables.2.values.2.weight'],
  ],
  [
    'weights that are all 0',
    [
      ['variables.2.values.0.weight', 0],
      ['variables.2.values.1.weight', 0],
      ['variables.2.values.2.weight', 0],
    ],
    ['VARIABLES_WEIGHT_ZERO variables.2.values'],
  ],
  ['a fitted prior with no source', [['prior', { kind: 'fitted' }]], ['VARIABLES_PRIOR_SOURCE prior.source']],
  [
    'constraints that forbid every cell of the axes',
    [
      [
        'constraints',
        [
          { forbid: { channel: 'chat' }, reason: 'No chat.', approved: true, provenance: [OWNER] },
          { forbid: { channel: 'whatsapp' }, reason: 'No whatsapp.', approved: true, provenance: [OWNER] },
        ],
      ],
    ],
    ['VARIABLES_GRID_EMPTY constraints'],
  ],
  // Conditions a value states about other values.
  [
    'a value that applies when an unknown variable holds',
    [[`${FIRST}.when`, { mood: ['calm'] }]],
    [`VARIABLES_UNKNOWN_VARIABLE ${FIRST}.when.mood`],
  ],
  [
    'a value that does not apply unless an unknown value holds',
    [[`${FIRST}.unless`, { channel: ['chat', 'fax'] }]],
    [`VARIABLES_UNKNOWN_VALUE ${FIRST}.unless.channel.1`],
  ],
];

describe('a store the loader refuses', () => {
  it('refuses a list instead of a mapping', () => {
    expect(issues(validateVariableStore([]))).toEqual(['VARIABLES_NOT_OBJECT ']);
  });

  for (const [name, edits, expected] of REFUSALS) {
    it(`refuses ${name}`, () => {
      expect(issues(validateVariableStore(edited(edits)))).toEqual([...expected].sort());
    });
  }

  it('is tested for every code the loader reports itself', () => {
    const reported = new Set(
      REFUSALS.flatMap(([, , expected]) => expected.map((entry) => entry.split(' ')[0])),
    );
    // Reported by the tests below: the parse, the object check and the advice.
    for (const code of ['VARIABLES_NOT_OBJECT', 'VARIABLES_PARSE', 'VARIABLES_UNSOURCED']) reported.add(code);
    // Reported by verifyVariableQuotes, in the generate package, and tested there.
    const elsewhere = [
      'VARIABLES_SOURCE_UNREADABLE',
      'VARIABLES_QUOTE_NOT_FOUND',
      'VARIABLES_POINTER_UNRESOLVED',
      'VARIABLES_HASH_MISMATCH',
    ];
    expect(
      VariableStoreIssueCodes.filter((code) => !reported.has(code) && !elsewhere.includes(code)),
    ).toEqual([]);
  });
});

/** Each case: a name and edits that leave a store the loader must accept. These are the lines the rules do not draw. */
const ACCEPTED: Array<[name: string, edits: Edit[]]> = [
  [
    'an inclusive comparison with the edge on the side where the condition holds',
    [
      [`${BOUNDARY}.comparison`, 'ge'],
      [`${BOUNDARY}.edge`, 'over'],
    ],
  ],
  ['a strict comparison with the edge on the failing side', [[`${BOUNDARY}.edge`, 'under']]],
  [
    'a boundary with no number: two sides and the edge between them',
    [
      [`${BOUNDARY}.limit`, undefined],
      [`${BOUNDARY}.comparison`, undefined],
      [`${BOUNDARY}.unit`, undefined],
    ],
  ],
  [
    'two stage variables when one of them is a detail',
    [['variables.3', variable('phase', 'stage', ['x'], 'detail')]],
  ],
  [
    'one behaviour value in an axis and in a detail',
    [
      ['variables.3', variable('rules', 'behaviour', ['B-001'])],
      ['variables.4', variable('details', 'behaviour', ['B-001'], 'detail')],
    ],
  ],
  [
    'a detail deviation variable whose values are not deviation classes',
    [['variables.3', variable('mood', 'deviation', ['D11_shouting'], 'detail')]],
  ],
  [
    'a constraint on the values of a detail',
    [
      [
        'constraints.1',
        {
          forbid: { days_late: 'over', channel: 'whatsapp' },
          reason: 'None.',
          approved: true,
          provenance: [OWNER],
        },
      ],
    ],
  ],
  [
    'a constraint on one value',
    [
      [
        'constraints.1',
        { forbid: { stage: 'b' }, reason: 'Not launched.', approved: true, provenance: [OWNER] },
      ],
    ],
  ],
  ['a fitted prior with its source', [['prior', { kind: 'fitted', source: 'the 200 consented chats' }]]],
  [
    'the reserved value none, in two persona axes',
    [
      ['variables.3', variable('first', 'persona', ['none'])],
      ['variables.4', variable('second', 'persona', ['none'])],
    ],
  ],
];

describe('a store the loader accepts', () => {
  for (const [name, edits] of ACCEPTED) {
    it(`accepts ${name}`, () => {
      expect(issues(validateVariableStore(edited(edits)))).toEqual([]);
    });
  }
});

function validated(raw: unknown): SpaceMap {
  const result = validateSpaceMap(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.map;
}

describe('advice', () => {
  it('names every value, boundary and constraint that has no source, and never a variable', () => {
    const bare = edited([
      ['variables.0.provenance', undefined],
      [`${FIRST}.provenance`, undefined],
      ['variables.1.values.1.provenance', []],
      [`${BOUNDARY}.provenance`, undefined],
      ['constraints.0.provenance', undefined],
    ]);
    const result = validateVariableStore(bare);
    expect(result.ok && result.warnings.map((warning) => `${warning.code} ${warning.path}`)).toEqual([
      `VARIABLES_UNSOURCED ${FIRST}`,
      'VARIABLES_UNSOURCED variables.1.values.1',
      `VARIABLES_UNSOURCED ${BOUNDARY}`,
      'VARIABLES_UNSOURCED constraints.0',
    ]);
  });

  it('never makes a store invalid: a converted space map names no source at all', () => {
    const result = validateVariableStore(spaceMapToVariables(validated(HAND)));
    expect(result.ok).toBe(true);
    // The six values and the one constraint of the hand map.
    expect(result.ok && result.warnings).toHaveLength(7);
  });
});

/**
 * The store keeps every rule of the space map. Each case is a map the space loader refuses, converted as it
 * stands: the store loader refuses it with the rule of the same name.
 */
const PARITY: Array<[name: string, edits: Edit[], spaceCode: string, storeCode: string]> = [
  [
    'two dimensions with one id',
    [['dimensions.3', { id: 'stage', title: 'Again', kind: 'persona', values: [{ id: 'x', title: 'X' }] }]],
    'SPACE_DUPLICATE',
    'VARIABLES_DUPLICATE',
  ],
  [
    'a value listed twice',
    [['dimensions.2.values.2', { id: 'chat', title: 'Again' }]],
    'SPACE_DUPLICATE',
    'VARIABLES_DUPLICATE',
  ],
  [
    'two stage dimensions',
    [['dimensions.3', { id: 'phase', title: 'Phase', kind: 'stage', values: [{ id: 'x', title: 'X' }] }]],
    'SPACE_KIND_REPEATED',
    'VARIABLES_KIND_REPEATED',
  ],
  [
    'a behaviour value in two dimensions',
    [
      ['dimensions.3', { id: 'one', title: 'One', kind: 'behaviour', values: [{ id: 'B-1', title: 'B' }] }],
      ['dimensions.4', { id: 'two', title: 'Two', kind: 'behaviour', values: [{ id: 'B-1', title: 'B' }] }],
    ],
    'SPACE_AMBIGUOUS_VALUE',
    'VARIABLES_AMBIGUOUS_VALUE',
  ],
  [
    'a deviation value that is no class',
    [
      ['dimensions.1.values.1.id', 'D11_shouting'],
      ['constraints', []],
    ],
    'SPACE_UNKNOWN_DEVIATION',
    'VARIABLES_UNKNOWN_DEVIATION',
  ],
  [
    'a constraint that forbids nothing',
    [['constraints.0.forbid', {}]],
    'SPACE_EMPTY_CONSTRAINT',
    'VARIABLES_EMPTY_CONSTRAINT',
  ],
  [
    'a constraint on an unknown dimension',
    [['constraints.0.forbid', { mood: 'calm' }]],
    'SPACE_UNKNOWN_DIMENSION',
    'VARIABLES_UNKNOWN_VARIABLE',
  ],
  [
    'a constraint on an unknown value',
    [['constraints.0.forbid.channel', 'fax']],
    'SPACE_UNKNOWN_VALUE',
    'VARIABLES_UNKNOWN_VALUE',
  ],
  [
    'weights on some values only',
    [['dimensions.0.values.1.weight', undefined]],
    'SPACE_PRIOR_INCOMPLETE',
    'VARIABLES_WEIGHT_INCOMPLETE',
  ],
  [
    'weights of the prior that skip a value',
    [['prior', { kind: 'declared', weights: { channel: { chat: 1 } } }]],
    'SPACE_PRIOR_INCOMPLETE',
    'VARIABLES_WEIGHT_INCOMPLETE',
  ],
  [
    'weights that are all 0',
    [
      ['dimensions.0.values.0.weight', 0],
      ['dimensions.0.values.1.weight', 0],
    ],
    'SPACE_PRIOR_ZERO',
    'VARIABLES_WEIGHT_ZERO',
  ],
  [
    'a fitted prior with no source',
    [['prior', { kind: 'fitted' }]],
    'SPACE_PRIOR_SOURCE',
    'VARIABLES_PRIOR_SOURCE',
  ],
  [
    'constraints that forbid every cell',
    [
      [
        'constraints',
        [
          { forbid: { channel: 'chat' }, reason: 'No chat.' },
          { forbid: { channel: 'whatsapp' }, reason: 'No whatsapp.' },
        ],
      ],
    ],
    'SPACE_GRID_EMPTY',
    'VARIABLES_GRID_EMPTY',
  ],
];

describe('the store keeps the rules of the space map', () => {
  for (const [name, edits, spaceCode, storeCode] of PARITY) {
    it(`refuses ${name}: ${spaceCode} becomes ${storeCode}`, () => {
      const raw = edited(edits, HAND);
      const space = validateSpaceMap(raw);
      expect(space.ok ? [] : space.errors.map((issue) => issue.code)).toContain(spaceCode);
      const store = validateVariableStore(spaceMapToVariables(raw as SpaceMap));
      expect(store.ok ? [] : store.errors.map((issue) => issue.code)).toContain(storeCode);
    });
  }
});

describe('loadVariableStore', () => {
  it('reads a file, and says why it cannot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-variables-'));
    const good = join(dir, 'variables.yaml');
    await writeFile(
      good,
      [
        'format: 1',
        'agent: demo',
        "version: '1'",
        'variables:',
        '  - { id: v, title: V, kind: data, role: axis, approved: true, values: [ { id: x, title: X } ] }',
      ].join('\n'),
    );
    const loaded = await loadVariableStore(good);
    expect(loaded.ok && loaded.path).toBe(good);

    const asJson = join(dir, 'variables.json');
    await writeFile(asJson, JSON.stringify(BASE));
    expect((await loadVariableStore(asJson)).ok).toBe(true);

    const broken = join(dir, 'broken.yaml');
    await writeFile(broken, 'format: [1');
    expect(issues(await loadVariableStore(broken))).toEqual(['VARIABLES_PARSE ']);

    const missing = await loadVariableStore(join(dir, 'missing.yaml'));
    expect(issues(missing)).toEqual(['VARIABLES_PARSE ']);
    expect(!missing.ok && missing.errors[0]?.message).toContain('cannot read the file');
  });
});

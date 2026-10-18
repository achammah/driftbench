import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import {
  brokenForms,
  clausesOf,
  helperUnitTestOf,
  hostileForms,
  matcherTools,
  materialOf,
  payloadOf,
  scriptCases,
  specUnitOf,
  unitTestOf,
} from '../../src/estate/unit';

const rule = (
  id: string,
  quote: string,
  forbidden: string[] = [],
  allowed: string[] = [],
  tool: string | null = 'Bash',
): EstateAtom => ({
  id,
  kind: 'instruction',
  title: id,
  approved: true,
  evidence: [],
  provenance: { quote },
  fields: {
    unitCases: [
      ...forbidden.map((material) => ({ effect: 'forbid', material, ...(tool === null ? {} : { tool }) })),
      ...allowed.map((material) => ({ effect: 'allow', material, ...(tool === null ? {} : { tool }) })),
    ],
  },
});
const guard = (fields: Record<string, unknown>): EstateAtom => ({
  id: 'guard.settings.g',
  kind: 'guard',
  title: 'the guard',
  approved: true,
  evidence: [],
  fields: {
    name: 'g.sh',
    command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/g.sh',
    enforces: [{ atom: 'r1', by: 'id' }],
    ...fields,
  },
});
const ATOMS = new Map([
  [
    'r1',
    rule('r1', 'Never run `git push --force` or `rm -rf` on any branch.', ['git push --force', 'rm -rf']),
  ],
  ['r2', rule('r2', 'Never say "obviously" in a reply.', ['obviously'], [], null)],
]);
const row = (testType: string) => ({
  id: `row.${testType}`,
  atomIds: ['guard.settings.g'],
  cell: {},
  testType,
  mode: 'unit',
  status: 'approved' as const,
});

describe('the payloads of a guard unit test', () => {
  it('reads the tools of a matcher and the material of a rule quote', () => {
    expect(matcherTools('Edit|Write')).toEqual(['Edit', 'Write']);
    expect(matcherTools(undefined)).toEqual(['Bash']);
    expect(matcherTools('*')).toEqual(['Bash']);
    expect(materialOf('Never run `git push --force` or `rm -rf` on any branch.')).toEqual([
      'git push --force',
      'rm -rf',
    ]);
    expect(materialOf('Never say "obviously" in a reply.')).toEqual(['obviously']);
    expect(materialOf('Read a file before you edit it.')).toEqual([]);
  });

  it('extracts quoted spans structurally without classifying their permission or meaning', () => {
    expect(materialOf('Read `a.md` first. Never use `sed -i` on a drive.')).toEqual(['a.md', 'sed -i']);
    expect(materialOf('See `nexus-app-builder` and "the build guide" for the build.')).toEqual([
      'nexus-app-builder',
      'the build guide',
    ]);
    expect(materialOf('✗ `2>/dev/null` swallows the error; ✓ `2>&1`')).toEqual(['2>/dev/null', '2>&1']);
    expect(materialOf('No `npx`, no raw `curl`.\nUse `nexus` instead.')).toEqual(['npx', 'curl', 'nexus']);
    expect(materialOf('Do not say "obviously" in a reply.')).toEqual(['obviously']);
  });

  it('builds each event in the runtime input shape', () => {
    expect(payloadOf('PreToolUse', 'Bash', 'ls')).toEqual({
      tool_name: 'Bash',
      tool_input: { command: 'ls', description: 'unit test' },
    });
    expect(payloadOf('PostToolUse', 'Edit', 'ledger/a.csv')).toEqual({
      tool_name: 'Edit',
      tool_input: { file_path: 'ledger/a.csv', old_string: 'a', new_string: 'b' },
      tool_response: { stdout: '', stderr: '', interrupted: false },
    });
    expect(payloadOf('UserPromptSubmit', undefined, 'stop')).toEqual({ prompt: 'stop' });
    expect(payloadOf('Stop', undefined, 'obviously')).toEqual({
      stop_hook_active: false,
      last_reply: 'obviously',
    });
    expect(hostileForms('git push --force')).toEqual([
      'git  push  --force',
      'GIT PUSH --FORCE',
      "git '' push --force",
      'echo ok && git push --force',
    ]);
  });

  it('writes positive, hostile, negative and speed cases from the rules a guard enforces', () => {
    const atom = guard({ event: 'PreToolUse', matcher: 'Bash', timeout: 5 });
    const positive = unitTestOf(row('guard_positive'), atom, ATOMS, 'h', 'unit.guard_positive.g');
    if (typeof positive === 'string') throw new Error(positive);
    expect(positive.target).toEqual({
      kind: 'guard',
      name: 'g.sh',
      event: 'PreToolUse',
      matcher: 'Bash',
      command: atom.fields?.command,
      timeout: 5,
    });
    expect(positive.cases.map((entry) => entry.material)).toEqual(['git push --force', 'rm -rf']);
    const hostile = unitTestOf(row('guard_hostile'), atom, ATOMS, 'h', 'unit.guard_hostile.g');
    expect(typeof hostile !== 'string' && hostile.cases).toHaveLength(8);
    const negative = unitTestOf(row('guard_negative'), atom, ATOMS, 'h', 'unit.guard_negative.g');
    expect(typeof negative !== 'string' && negative.cases.map((entry) => entry.payload)).toEqual([
      { tool_name: 'Bash', tool_input: { command: 'ls', description: 'unit test' } },
    ]);
    const speed = unitTestOf(row('guard_speed'), atom, ATOMS, 'h', 'unit.guard_speed.g');
    expect(typeof speed !== 'string' && speed.budgetMs).toBe(5000);
  });

  it('names why a guard that enforces no rule gets no positive test, and points a script test at its file', () => {
    const lone = guard({ event: 'Stop', enforces: [] });
    expect(unitTestOf(row('guard_positive'), lone, ATOMS, 'h', 'x')).toBe(
      'guard.settings.g requires structured unit payload evidence for its enforced rules',
    );
    expect(typeof unitTestOf(row('guard_negative'), lone, ATOMS, 'h', 'x')).toBe('string');
    const script: EstateAtom = {
      id: 'script.a.s',
      kind: 'script',
      title: 's',
      approved: true,
      evidence: [],
      fields: { path: '.claude/skills/a/s.py', skill: 'a' },
    };
    expect(unitTestOf(row('script_fixture'), script, ATOMS, 'h', 'unit.script_fixture.s')).toMatchObject({
      target: { kind: 'script', path: '.claude/skills/a/s.py', skill: 'a' },
      cases: [{ id: 'case-01', payload: { args: [] }, material: 'no argument' }],
    });
  });
});

describe('material from a rule the guard cites', () => {
  it('requires a declared tool payload for every enforced rule and keeps text payloads on text events', () => {
    const cited: EstateAtom = {
      ...rule('r1', 'Every failure reaches you, any spelling', ['2>/dev/null', '|| true']),
    };
    const prose = rule('r2', 'Never guess a status.', ['Never guess a status.'], [], null);
    const atoms = new Map([
      ['r1', cited],
      ['r2', prose],
    ]);
    const bash = guard({
      event: 'PreToolUse',
      matcher: 'Bash',
      enforces: [
        { atom: 'r1', by: 'id' },
        { atom: 'r2', by: 'id' },
      ],
    });
    const positive = unitTestOf(row('guard_positive'), bash, atoms, 'h', 'p');
    expect(positive).toContain('structured unit payload evidence for r2');
    const declaredOnly = unitTestOf(
      row('guard_positive'),
      guard({
        event: 'PreToolUse',
        matcher: 'Bash',
        enforces: [{ atom: 'r1', by: 'id' }],
      }),
      atoms,
      'h',
      'p',
    );
    expect(typeof declaredOnly !== 'string' && declaredOnly.cases.map((entry) => entry.material)).toEqual([
      '2>/dev/null',
      '|| true',
    ]);
    const prompt = guard({ event: 'UserPromptSubmit', enforces: [{ atom: 'r2', by: 'id' }] });
    const asked = unitTestOf(row('guard_positive'), prompt, atoms, 'h', 'q');
    expect(typeof asked !== 'string' && asked.cases.map((entry) => entry.material)).toEqual([
      'Never guess a status.',
    ]);
  });
});

describe('the rules a guard test takes material from', () => {
  it('takes only rules linked by registry or cited id and fails quote-only links closed', () => {
    const atoms = new Map([
      ['r1', rule('r1', 'Never run `rm -rf` here.', ['rm -rf'])],
      ['r2', rule('r2', 'Never write `2>/dev/null` after a command.', ['2>/dev/null'])],
    ]);
    const linked = guard({
      event: 'PreToolUse',
      matcher: 'Bash',
      enforces: [
        { atom: 'r1', by: 'quote' },
        { atom: 'r2', by: 'id' },
      ],
    });
    const positive = unitTestOf(row('guard_positive'), linked, atoms, 'h', 'p');
    expect(typeof positive !== 'string' && positive.cases.map((entry) => entry.material)).toEqual([
      '2>/dev/null',
    ]);
    const quoteOnly = guard({
      event: 'PreToolUse',
      matcher: 'Bash',
      enforces: [{ atom: 'r1', by: 'quote' }],
    });
    const fallback = unitTestOf(row('guard_positive'), quoteOnly, atoms, 'h', 'q');
    expect(fallback).toContain('structured unit payload evidence');
  });
});

describe('the speed test of a guard', () => {
  it('times a spread of at most five positive payloads, not every one', () => {
    const quote = Array.from({ length: 12 }, (_, index) => `\`cmd-${index + 1}\``).join(' ');
    const many = new Map([
      [
        'r1',
        rule(
          'r1',
          `Never run ${quote}.`,
          Array.from({ length: 12 }, (_, index) => `cmd-${index + 1}`),
        ),
      ],
    ]);
    const atom = guard({ event: 'PreToolUse', matcher: 'Bash' });
    const positive = unitTestOf(row('guard_positive'), atom, many, 'h', 'p');
    const speed = unitTestOf(row('guard_speed'), atom, many, 'h', 's');
    if (typeof positive === 'string' || typeof speed === 'string') throw new Error('no test');
    expect(positive.cases).toHaveLength(12);
    expect(speed.cases.map((entry) => entry.material)).toEqual([
      'cmd-1',
      'cmd-4',
      'cmd-7',
      'cmd-9',
      'cmd-12',
    ]);
    expect(speed.cases.map((entry) => entry.id)).toEqual([
      'case-01',
      'case-02',
      'case-03',
      'case-04',
      'case-05',
    ]);
  });
});

describe('a check from a catalogue', () => {
  const host: EstateAtom = {
    id: 'guard.settings.pre',
    kind: 'guard',
    title: 'pre',
    approved: true,
    evidence: [],
    fields: {
      name: 'pre.py',
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre.py',
      script: '.claude/hooks/pre.py',
      scope: 'estate',
    },
  };
  const atoms = new Map([...ATOMS, [host.id, host]]);
  const check = (fields: Record<string, unknown>): EstateAtom => ({
    id: 'guard.registry.k1',
    kind: 'guard',
    title: 'K1',
    approved: true,
    evidence: [],
    fields: {
      name: 'K1',
      command: 'K1',
      event: 'PreToolUse (Bash)',
      scope: 'catalogue',
      check: 'K1',
      ...fields,
    },
  });

  it('is tested as a check of its host hook: its trigger material sent to that hook, the check id carried', () => {
    const test = unitTestOf(
      row('guard_positive'),
      check({ trigger: ['2>/dev/null'], host: '.claude/hooks/pre.py' }),
      atoms,
      'h',
      'x',
    );
    expect(test).toMatchObject({
      atom: 'guard.registry.k1',
      target: { kind: 'guard', name: 'pre.py', event: 'PreToolUse', matcher: 'Bash', check: 'K1' },
      cases: [
        { material: '2>/dev/null', payload: { tool_name: 'Bash', tool_input: { command: '2>/dev/null' } } },
      ],
    });
  });

  it('is a counted gap, not a test, without a trigger or a host hook; its other test types are its host hook tests', () => {
    expect(unitTestOf(row('guard_positive'), check({ host: '.claude/hooks/pre.py' }), atoms, 'h', 'x')).toBe(
      'guard.registry.k1 needs a trigger: the map holds no material that sets the check off',
    );
    const noHost = 'guard.registry.k1 needs a host: no configured hook on its event names the check';
    expect(unitTestOf(row('guard_positive'), check({ trigger: ['x'] }), atoms, 'h', 'x')).toBe(noHost);
    const stop = check({ trigger: ['x'], host: '.claude/hooks/pre.py', event: 'Stop' });
    expect(unitTestOf(row('guard_positive'), stop, atoms, 'h', 'x')).toBe(noHost);
    for (const type of ['guard_negative', 'guard_hostile', 'guard_speed']) {
      const hosted = check({ trigger: ['x'], host: '.claude/hooks/pre.py' });
      expect(unitTestOf(row(type), hosted, atoms, 'h', 'x')).toBe(
        'guard.registry.k1 is a check its host hook runs; the host hook tests cover this test type',
      );
    }
  });
});

describe('minimal fixtures of a script with none declared', () => {
  it('runs the script bare, then as each command line of its quote writes it, placeholders as empty files', () => {
    expect(
      scriptCases(
        '3. Run `python3 scripts/reconcile.py <invoice> <order>` and show the summary.',
        '.claude/skills/a/scripts/reconcile.py',
      ),
    ).toEqual([
      { id: 'case-01', payload: { args: [] }, material: 'no argument' },
      {
        id: 'case-02',
        payload: { args: ['invoice', 'order'], files: { invoice: '', order: '' } },
        material: 'invoice order',
      },
    ]);
    expect(
      scriptCases('as in `./scripts/track.sh NWX 123`, never `track.sh NWX 123` twice', 'x/scripts/track.sh'),
    ).toEqual([
      { id: 'case-01', payload: { args: [] }, material: 'no argument' },
      { id: 'case-02', payload: { args: ['NWX', '123'] }, material: 'NWX 123' },
    ]);
    expect(scriptCases('Run the tracker.', 'x/track.sh')).toHaveLength(1);
  });
});

describe('material by what each clause of a cited rule does', () => {
  // A plant nursery's rules, cited by its guards: nothing here comes from a bank or a fixture.
  const nursery = new Map([
    [
      'n1',
      rule('n1', 'Never remove a tray under `greenhouse/`; move it to `greenhouse/spare/` instead.', [
        'rm greenhouse/',
      ]),
    ],
    [
      'n2',
      rule(
        'n2',
        'Always name the bed when you water, as in `./bin/water.sh B4 20`.',
        ['./bin/water.sh 20', './bin/water.sh B4'],
        ['./bin/water.sh B4 20'],
      ),
    ],
  ]);
  const cites = (atom: string, fields: Record<string, unknown> = {}) =>
    guard({ event: 'PreToolUse', matcher: 'Bash', enforces: [{ atom, by: 'registry' }], ...fields });

  it('reads clause spans without inferring permission or an act from words', () => {
    expect(
      clausesOf('Never remove a tray under `greenhouse/`; move it to `greenhouse/spare/` instead.'),
    ).toEqual([{ spans: ['greenhouse/'] }, { spans: ['greenhouse/spare/'] }]);
    expect(brokenForms('./bin/water.sh B4 20')).toEqual(['./bin/water.sh 20', './bin/water.sh B4']);
    expect(brokenForms('ls')).toEqual([]);
  });

  it('sends a Bash guard the act a rule forbids on a path, never the path alone nor the allowed alternative', () => {
    const positive = unitTestOf(row('guard_positive'), cites('n1'), nursery, 'h', 'x');
    if (typeof positive === 'string') throw new Error(positive);
    expect(positive.cases.map((entry) => entry.material)).toEqual(['rm greenhouse/']);
  });

  it('breaks an obligation by leaving out each argument of its example, and lets the example through', () => {
    const positive = unitTestOf(row('guard_positive'), cites('n2'), nursery, 'h', 'x');
    if (typeof positive === 'string') throw new Error(positive);
    expect(positive.cases.map((entry) => entry.material)).toEqual(['./bin/water.sh 20', './bin/water.sh B4']);
    const negative = unitTestOf(row('guard_negative'), cites('n2'), nursery, 'h', 'x');
    if (typeof negative === 'string') throw new Error(negative);
    expect(negative.cases.map((entry) => entry.material)).toEqual(['ls', './bin/water.sh B4 20']);
  });
});

describe('the run a unit-mode spec carries', () => {
  const nursery = new Map([
    ['n1', rule('n1', 'Never run `rm -rf seeds/` on the potting bench.', ['rm -rf seeds/'])],
  ]);
  const watched: EstateAtom = {
    ...guard({ event: 'PreToolUse', matcher: 'Bash', timeout: 3, enforces: [{ atom: 'n1', by: 'id' }] }),
    evidence: [{ type: 'guard', name: 'g.sh', verdict: 'deny' }],
  };

  it('gives a guard spec the payloads of its test type, the declared verdict and the time budget', () => {
    const register = specUnitOf({ testType: 'guard_register' }, [watched], nursery);
    if (typeof register === 'string') throw new Error(register);
    expect(register.target).toMatchObject({ kind: 'guard', name: 'g.sh', verdict: 'deny', timeout: 3 });
    expect(register.cases.map((entry) => entry.material)).toEqual(['rm -rf seeds/']);
    expect(register.budgetMs).toBe(3000);
    // A hostile spec sends the plain act first, then the forms that slip past a naive match.
    const hostile = specUnitOf({ testType: 'guard_hostile' }, [watched], nursery);
    if (typeof hostile === 'string') throw new Error(hostile);
    expect(hostile.cases.map((entry) => entry.material)).toEqual([
      'rm -rf seeds/',
      ...hostileForms('rm -rf seeds/'),
    ]);
    const negative = specUnitOf({ testType: 'guard_negative' }, [watched], nursery);
    expect(typeof negative !== 'string' && negative.cases.map((entry) => entry.material)).toEqual(['ls']);
  });

  it('gives a script spec its minimal fixtures, a helper spec its agent file, and says why other rows have none', () => {
    const script: EstateAtom = {
      id: 'script.bench.sow',
      kind: 'script',
      title: 'sow',
      approved: true,
      evidence: [],
      fields: { path: '.claude/skills/bench/sow.sh' },
      provenance: { quote: 'Run `./sow.sh <tray>`.' },
    };
    expect(specUnitOf({ testType: 'script_fixture' }, [script], nursery)).toMatchObject({
      target: { kind: 'script', path: '.claude/skills/bench/sow.sh' },
      cases: [{ material: 'no argument' }, { material: 'tray' }],
    });
    const helper: EstateAtom = {
      id: 'subagent.potter',
      kind: 'subagent',
      title: 'potter',
      approved: true,
      evidence: [],
      fields: { name: 'potter' },
      provenance: { quote: 'name: potter', file: '.claude/agents/potter.md' },
    };
    expect(specUnitOf({ testType: 'contract_alone' }, [helper], nursery)).toEqual({
      target: { kind: 'subagent', name: 'potter', file: '.claude/agents/potter.md' },
      cases: [],
    });
    expect(specUnitOf({ testType: 'obligation' }, [watched], nursery)).toBe('obligation has no unit run');
  });
});

it('uses declared reply boundaries for positive payloads and keeps negative payloads below them', () => {
  const limit: EstateAtom = {
    ...rule('limit', 'Keep replies short.'),
    kind: 'register',
    evidence: [{ type: 'custom', name: 'max_characters', options: { max: 37 } }],
  };
  const g = guard({ event: 'Stop', enforces: [{ atom: 'limit', by: 'registry' }] });
  const atoms = new Map([['limit', limit]]);
  for (const testType of ['guard_positive', 'guard_speed', 'guard_hostile', 'guard_register']) {
    const result = specUnitOf({ testType }, [g], atoms);
    expect(typeof result).toBe('object');
    if (typeof result === 'string') throw new Error(result);
    expect(result.cases.some((c) => String(c.payload.last_reply).length > 37)).toBe(true);
  }
  const negative = specUnitOf({ testType: 'guard_negative' }, [g], atoms);
  if (typeof negative === 'string') throw new Error(negative);
  expect(negative.cases.every((c) => String(c.payload.last_reply).length <= 37)).toBe(true);
});

it('reports an unsupported declared reply boundary instead of substituting a short rule quote', () => {
  const limit: EstateAtom = {
    ...rule('large-limit', 'Keep replies short.'),
    evidence: [{ type: 'custom', name: 'max_characters', options: { max: 1000000 } }],
  };
  const result = specUnitOf(
    { testType: 'guard_positive' },
    [guard({ event: 'Stop', enforces: [{ atom: limit.id, by: 'id' }] })],
    new Map([[limit.id, limit]]),
  );
  expect(result).toContain('outside the supported payload size');
});

it('can exercise a zero-character limit with a truly empty negative reply', () => {
  const limit: EstateAtom = {
    ...rule('zero-limit', 'No reply text.'),
    evidence: [{ type: 'custom', name: 'max_characters', options: { max: 0 } }],
  };
  const result = specUnitOf(
    { testType: 'guard_negative' },
    [guard({ event: 'Stop', enforces: [{ atom: limit.id, by: 'id' }] })],
    new Map([[limit.id, limit]]),
  );
  expect(typeof result !== 'string' && result.cases[0]?.payload.last_reply).toBe('');
});

describe('the JSON run record of a helper run alone', () => {
  const helper: EstateAtom = {
    id: 'subagent.harbour.helper-pilot',
    kind: 'subagent',
    title: 'Helper pilot',
    approved: true,
    evidence: [],
    fields: { name: 'pilot' },
    provenance: { quote: 'name: pilot', file: '.claude/agents/pilot.md' },
  };
  const at = { id: 'contract_alone.subagent.harbour.helper-pilot' };

  it('holds the task and the seeded files as its one case, and the agent file as the target', () => {
    const made = helperUnitTestOf(
      helper,
      { task: 'Berth the Aster.', files: { 'log/aster.txt': 'Aster, 40 m' } },
      'hash',
      'unit.contract_alone.pilot',
      at,
    );
    if (typeof made === 'string') throw new Error(made);
    expect(made.target).toEqual({ kind: 'subagent', name: 'pilot', file: '.claude/agents/pilot.md' });
    expect(made.testType).toBe('contract_alone');
    expect(made.cases).toEqual([
      {
        id: 'case-01',
        payload: { task: 'Berth the Aster.', files: { 'log/aster.txt': 'Aster, 40 m' } },
        material: 'Berth the Aster.',
      },
    ]);
    expect(made.cases[0]?.expected).toBeUndefined();
  });

  it('says why a helper with no agent file or no task has none', () => {
    expect(
      helperUnitTestOf({ ...helper, provenance: { quote: 'x' } }, { task: 'Go.', files: {} }, 'h', 'i', at),
    ).toContain('no helper with an agent file');
    expect(helperUnitTestOf(helper, { task: '  ', files: {} }, 'h', 'i', at)).toContain('no task');
  });
});

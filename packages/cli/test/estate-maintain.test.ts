import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEstateDiff } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');

async function cli(argv: string[], cwd = ROOT) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io), out, err };
}

/** A copy of the fixture estate in a temporary folder, without its committed outputs. */
async function fixtureCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-maintain-'));
  await cp(join(FIXTURE, 'CLAUDE.md'), join(root, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude'), join(root, '.claude'), { recursive: true });
  return root;
}

async function edit(path: string, from: string, to: string): Promise<void> {
  const text = await readFile(path, 'utf8');
  if (!text.includes(from)) throw new Error(`${path} does not hold ${from}`);
  await writeFile(path, text.replace(from, to));
}

describe('driftbench estate diff', () => {
  it('finds no change between the fixture map and its approved copy', async () => {
    const result = await cli([
      'estate',
      'diff',
      'examples/estates/fixture/map.yaml',
      'examples/estates/fixture/approved.yaml',
    ]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'Atoms: 0 added, 0 removed, 0 changed (0 white space only, 0 semantic), 0 moved with the same quote, 0 restated, 126 unchanged.',
    );
    expect(result.out).toContain('Edges: 0 added, 0 removed.');
  });

  it('reads two scans of an estate edited in between, prints the classes and writes the JSON', async () => {
    const root = await fixtureCopy();
    const before = await cli(['estate', 'scan', '.', '--no-model', '--out', 'v1.yaml'], root);
    expect(before.code).toBe(0);
    await edit(
      join(root, 'CLAUDE.md'),
      '| plan the delivery routes for tomorrow |',
      '| plan the delivery routes for the next two days |',
    );
    await edit(join(root, 'CLAUDE.md'), '| know where a shipment is |', '| know where   a shipment is |');
    const after = await cli(['estate', 'scan', '.', '--no-model', '--out', 'v2.yaml'], root);
    expect(after.code).toBe(0);

    const text = await cli(['estate', 'diff', 'v1.yaml', 'v2.yaml', '--out', 'diff.json'], root);
    expect(text.err).toBe('');
    expect(text.code).toBe(0);
    expect(text.out).toContain('2 changed (1 white space only, 1 semantic)');
    expect(text.out).toContain(
      'Changed, semantic:\n  ~ route.standing.an-ask-to-plan-the-delivery (route) CLAUDE.md:36',
    );
    expect(text.out).toContain('now: | plan the delivery routes for the next two days |');
    expect(text.out).toContain(
      'Changed, white space only:\n  ~ route.standing.an-ask-to-know-where-a (route)',
    );
    expect(text.out).toContain('Wrote diff.json.');

    const written = parseEstateDiff(await readFile(join(root, 'diff.json'), 'utf8'));
    if (!written.ok) throw new Error(written.message);
    expect(written.diff.old.path).toBe('v1.yaml');
    expect(written.diff.summary.semantic).toBe(1);

    const json = await cli(['estate', 'diff', 'v1.yaml', 'v2.yaml', '--json'], root);
    expect(json.code).toBe(0);
    const printed = parseEstateDiff(json.out);
    expect(printed.ok && printed.diff).toEqual(written.diff);
  });

  it('exits 2 and writes nothing when a map does not load', async () => {
    const root = await fixtureCopy();
    await writeFile(join(root, 'broken.yaml'), 'version: 1\n');
    const result = await cli(
      ['estate', 'diff', 'broken.yaml', join(FIXTURE, 'map.yaml'), '--out', 'diff.json'],
      root,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('broken.yaml is not a valid estate map:');
    await expect(readFile(join(root, 'diff.json'), 'utf8')).rejects.toThrow();
  });
});

/** A valid spec covering the given atoms. */
function spec(id: string, atoms: string[]): string {
  return [
    `# Covers ${atoms.join(', ')}. Fictional.`,
    `id: ${id}`,
    'kind: task',
    `title: Test ${id}`,
    'target: { adapter: claude-code }',
    'metadata:',
    `  estate: { atoms: [${atoms.join(', ')}] }`,
    'blocks:',
    '  - user: Plan the deliveries.',
    '    expect:',
    '      skills:',
    '        - { name: shipment-tracker, count: { min: 1 } }',
    '',
  ].join('\n');
}

/** Two scans of the fixture, the second after a route changed meaning, a route was removed and a gate added. */
async function editedEstate(): Promise<string> {
  const root = await fixtureCopy();
  expect((await cli(['estate', 'scan', '.', '--no-model', '--out', 'v1.yaml'], root)).code).toBe(0);
  const standing = join(root, 'CLAUDE.md');
  await edit(
    standing,
    '| plan the delivery routes for tomorrow |',
    '| plan the delivery routes for the next two days |',
  );
  await edit(standing, '| audit the ledger for duplicate payments | the `ledger-auditor` agent |\n', '');
  await edit(
    standing,
    'during this session.\n',
    'during this session.\n- **R18.** Before closing a month: Read `.claude/skills/weekly-report/templates/report.md`.\n',
  );
  expect((await cli(['estate', 'scan', '.', '--no-model', '--out', 'v2.yaml'], root)).code).toBe(0);
  expect((await cli(['estate', 'diff', 'v1.yaml', 'v2.yaml', '--out', 'diff.json'], root)).code).toBe(0);
  await mkdir(join(root, 'tests'));
  await writeFile(
    join(root, 'tests', 'plan.yaml'),
    spec('t-plan', ['route.standing.an-ask-to-plan-the-delivery']),
  );
  await writeFile(
    join(root, 'tests', 'audit.yaml'),
    spec('t-audit', ['route.standing.an-ask-to-audit-the-ledger']),
  );
  await writeFile(
    join(root, 'tests', 'track.yaml'),
    spec('t-track', ['route.standing.an-ask-to-know-where-a']),
  );
  return root;
}

describe('driftbench estate impact', () => {
  it('lists what to regenerate, re-approve, retire and add, and exits 1 for the person', async () => {
    const root = await editedEstate();
    const result = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests'], root);
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    expect(result.out).toContain('on 3 live estate tests (0 retired before, 0 other specs)');
    expect(result.out).toContain('  t-plan (plan.yaml): route.standing.an-ask-to-plan-the-delivery semantic');
    expect(result.out).toContain(
      'Re-approve, the meaning changed:\n  route.standing.an-ask-to-plan-the-delivery (route)',
    );
    expect(result.out).toContain(
      '  t-audit (audit.yaml): retired: atom route.standing.an-ask-to-audit-the-ledger removed [to write with --write]',
    );
    expect(result.out).toContain(
      'New atoms with no test:\n  reference.standing.read-claude-skills-weekly-report-templates (reference) CLAUDE.md:26\n  gate.standing.read-claude-skills-weekly-report-templates (gate) CLAUDE.md:26\n',
    );
    expect(result.out).toContain(
      're-approve route.standing.an-ask-to-plan-the-delivery: its meaning changed; 1 test waits',
    );
    expect(await readFile(join(root, 'tests', 'audit.yaml'), 'utf8')).not.toContain('retired');
  });

  it('writes the retirement into the spec with --write, and finds it written the next time', async () => {
    const root = await editedEstate();
    const written = await cli(
      ['estate', 'impact', 'diff.json', '--tests', 'tests', '--write', '--out', 'impact.json'],
      root,
    );
    expect(written.code).toBe(1);
    expect(written.out).toContain('[written]');
    expect(written.out).toContain('Wrote impact.json.');
    const audit = await readFile(join(root, 'tests', 'audit.yaml'), 'utf8');
    expect(audit).toContain('  retired: atom route.standing.an-ask-to-audit-the-ledger removed');
    expect(audit).toContain('# Covers route.standing.an-ask-to-audit-the-ledger. Fictional.');
    const report = JSON.parse(await readFile(join(root, 'impact.json'), 'utf8')) as {
      retire: { state: string }[];
    };
    expect(report.retire.map((entry) => entry.state)).toEqual(['written']);

    const again = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests', '--json'], root);
    const second = JSON.parse(again.out) as { retire: { state: string }[]; tests: { retired: number } };
    expect(second.retire.map((entry) => entry.state)).toEqual(['already']);
    expect(second.tests.retired).toBe(1);
  });

  it('exits 0 when nothing needs a person', async () => {
    const root = await editedEstate();
    await writeFile(
      join(root, 'tests', 'new.yaml'),
      spec('t-new', ['gate.standing.read-claude-skills-weekly-report-templates']),
    );
    const diff = JSON.parse(await readFile(join(root, 'diff.json'), 'utf8')) as {
      atoms: { changed: unknown[]; added: { id: string }[] };
    };
    const gate = diff.atoms.added.find((entry) => entry.id.startsWith('gate.'));
    expect(gate?.id).toBe('gate.standing.read-claude-skills-weekly-report-templates');
    diff.atoms.changed = [];
    diff.atoms.added = diff.atoms.added.filter((entry) => entry.id.startsWith('gate.'));
    await writeFile(join(root, 'quiet.json'), JSON.stringify(diff));
    const result = await cli(['estate', 'impact', 'quiet.json', '--tests', 'tests'], root);
    expect(result.out).toContain('Nothing needs a person.');
    expect(result.code).toBe(0);
  });

  it('exits 2 without --tests, on a file that is not a diff, and on a folder of broken specs', async () => {
    const root = await editedEstate();
    const noTests = await cli(['estate', 'impact', 'diff.json'], root);
    expect(noTests.code).toBe(2);
    expect(noTests.err).toContain("required option '--tests <dir>'");
    await writeFile(join(root, 'not-a-diff.json'), '{"version": 1}');
    const bad = await cli(['estate', 'impact', 'not-a-diff.json', '--tests', 'tests'], root);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('not-a-diff.json is not an estate diff:');
    await writeFile(join(root, 'tests', 'broken.yaml'), 'id: x\n');
    const broken = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests'], root);
    expect(broken.code).toBe(2);
    expect(broken.err).toContain('The tests in tests cannot be read:');
  });
});

/** A copy of the recorded session corpus, its specs included, and a diff with nothing in it. */
async function corpus(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-replay-'));
  await cp(join(ROOT, 'examples/estates/sessions'), join(root, 'sessions'), { recursive: true });
  await mkdir(join(root, 'tests'));
  const diff = await cli(
    ['estate', 'diff', join(FIXTURE, 'map.yaml'), join(FIXTURE, 'approved.yaml'), '--out', 'none.json'],
    root,
  );
  expect(diff.code).toBe(0);
  return root;
}

type ImpactJson = {
  needsPerson: string[];
  regression: {
    campaign: string;
    previous: string | null;
    store: string | null;
    counts: Record<string, number>;
    runs: { spec: string; session: string; flip: string }[];
  };
};

async function impact(root: string, extra: string[] = []) {
  const result = await cli(
    ['estate', 'impact', 'none.json', '--tests', 'tests', '--replay', 'sessions', ...extra, '--json'],
    root,
  );
  if (result.code === 2) throw new Error(result.err);
  return { code: result.code, report: JSON.parse(result.out) as ImpactJson };
}

describe('driftbench estate impact --replay', () => {
  it('replays the corpus with its suite and says there is nothing to compare without a store', async () => {
    const root = await corpus();
    const { code, report } = await impact(root);
    expect(code).toBe(0);
    expect(report.regression.previous).toBeNull();
    expect(report.regression.store).toBeNull();
    expect(report.regression.counts).toEqual({
      pass_to_pass: 0,
      fail_to_pass: 0,
      pass_to_fail: 0,
      fail_to_fail: 0,
      no_previous: 8,
    });
    const text = await cli(
      ['estate', 'impact', 'none.json', '--tests', 'tests', '--replay', 'sessions'],
      root,
    );
    expect(text.out).toMatch(/Replay of 8 runs, campaign replay-\w+, no store given: nothing to compare\./);
    expect(text.out).toContain('Nothing needs a person.');
  });

  it('reports flips against the stored previous replay: held, fixed, and broken for a person', async () => {
    const root = await corpus();
    const first = await impact(root, ['--store', 'runs.db']);
    expect(first.report.regression.counts.no_previous).toBe(8);

    const second = await impact(root, ['--store', 'runs.db']);
    expect(second.report.regression.previous).toBe(first.report.regression.campaign);
    expect(second.report.regression.counts).toMatchObject({
      pass_to_pass: 4,
      fail_to_fail: 4,
      no_previous: 0,
    });
    expect(second.code).toBe(0);

    const clean = join(root, 'sessions', 'specs', 'clean-build.yaml');
    const original = await readFile(clean, 'utf8');
    await edit(
      clean,
      '- { name: read-before-write, verdict: deny, count: 0 }',
      '- { name: read-before-write, verdict: deny, count: 1 }',
    );
    const broken = await impact(root, ['--store', 'runs.db']);
    expect(broken.code).toBe(1);
    expect(broken.report.regression.counts).toMatchObject({
      pass_to_pass: 3,
      pass_to_fail: 1,
      fail_to_fail: 4,
    });
    expect(broken.report.needsPerson).toEqual([
      'regression: replay-clean-build on the session clean-build passed before and fails now',
    ]);

    await writeFile(clean, original);
    const fixed = await impact(root, ['--store', 'runs.db']);
    expect(fixed.code).toBe(0);
    expect(fixed.report.regression.runs.find((entry) => entry.spec === 'replay-clean-build')?.flip).toBe(
      'fail_to_pass',
    );
    const text = await cli(
      ['estate', 'impact', 'none.json', '--tests', 'tests', '--replay', 'sessions', '--store', 'runs.db'],
      root,
    );
    expect(text.out).toMatch(/Replay of 8 runs, campaign replay-\w+, against replay-\w+\./);
  });

  it('exits 2 on a sessions folder with no session, a missing suite, or --store without --replay', async () => {
    const root = await corpus();
    await mkdir(join(root, 'empty'));
    const empty = await cli(['estate', 'impact', 'none.json', '--tests', 'tests', '--replay', 'empty'], root);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain('holds no session');
    const suite = await cli(
      ['estate', 'impact', 'none.json', '--tests', 'tests', '--replay', 'sessions', '--suite', 'nowhere'],
      root,
    );
    expect(suite.code).toBe(2);
    expect(suite.err).toContain('The replay suite nowhere does not exist');
    const store = await cli(['estate', 'impact', 'none.json', '--tests', 'tests', '--store', 'x.db'], root);
    expect(store.code).toBe(2);
    expect(store.err).toContain('--suite and --store belong to --replay');
  });
});

const GUARDS = [
  'guard.settings.pretooluse-bash-guard-block-force-push',
  'guard.settings.pretooluse-edit-write-guard-read-before',
  'guard.settings.posttooluse-bash-guard-ledger-guard-py',
  'guard.settings.userpromptsubmit-guard-stop-word-sh',
  'guard.settings.stop-guard-reply-length-py',
  'guard.shipment-tracker.pretooluse-bash-guard-check-carrier-sh',
];

function guardState(ledger: string, extra = ''): string {
  return [
    'version: 1',
    'guards:',
    ...GUARDS.map((guard) =>
      guard.includes('ledger-guard')
        ? `  - { guard: ${guard}, ${ledger} }`
        : `  - { guard: ${guard}, mode: enforce }`,
    ),
    extra,
  ].join('\n');
}

describe('driftbench estate diff with guard state', () => {
  async function versions(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-guards-'));
    await mkdir(join(root, 'v1'));
    await mkdir(join(root, 'v2'));
    await cp(join(FIXTURE, 'approved.yaml'), join(root, 'v1', 'map.yaml'));
    await cp(join(FIXTURE, 'approved.yaml'), join(root, 'v2', 'map.yaml'));
    return root;
  }

  it('reads the state beside each map and reports the promotion with its evidence', async () => {
    const root = await versions();
    await writeFile(join(root, 'v1', 'guard-state.yaml'), guardState('mode: warn'));
    await writeFile(
      join(root, 'v2', 'guard-state.yaml'),
      guardState('mode: enforce, evidence: { log: logs/ledger.decisions.jsonl, decisions: 12, wrong: 0 }'),
    );
    const result = await cli(['estate', 'diff', 'v1/map.yaml', 'v2/map.yaml', '--out', 'diff.json'], root);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      '  Guards: 1 of 6 changed enforcement state:\n    promoted guard.settings.posttooluse-bash-guard-ledger-guard-py: warn to enforce (evidence: 12 decisions, 0 wrong, logs/ledger.decisions.jsonl)',
    );
    const diff = parseEstateDiff(await readFile(join(root, 'diff.json'), 'utf8'));
    expect(diff.ok && diff.diff.guards?.filter((entry) => entry.move === 'promoted').length).toBe(1);

    await mkdir(join(root, 'tests'));
    await writeFile(join(root, 'tests', 'ledger.yaml'), spec('t-ledger', [GUARDS[2] as string]));
    const impact = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests'], root);
    expect(impact.code).toBe(0);
    expect(impact.out).toContain(`  t-ledger (ledger.yaml): ${GUARDS[2]} guard state`);
    expect(impact.out).toContain('Nothing needs a person.');
  });

  it('takes a state file named on the command line, and needs a person for a promotion with no evidence', async () => {
    const root = await versions();
    await writeFile(join(root, 'old-state.yaml'), guardState('mode: observe'));
    await writeFile(join(root, 'v2', 'guard-state.yaml'), guardState('mode: enforce'));
    const result = await cli(
      [
        'estate',
        'diff',
        'v1/map.yaml',
        'v2/map.yaml',
        '--old-guards',
        'old-state.yaml',
        '--out',
        'diff.json',
      ],
      root,
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain(`promoted ${GUARDS[2]}: observe to enforce`);
    await mkdir(join(root, 'tests'));
    const impact = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests'], root);
    expect(impact.code).toBe(1);
    expect(impact.out).toContain(
      `  - the guard ${GUARDS[2]} went from observe to enforce with no decision evidence`,
    );
  });

  it('takes the new state from --new-guards in place of the file beside the new map', async () => {
    const root = await versions();
    await writeFile(join(root, 'v1', 'guard-state.yaml'), guardState('mode: warn'));
    await writeFile(join(root, 'v2', 'guard-state.yaml'), guardState('mode: warn'));
    await writeFile(join(root, 'new-state.yaml'), guardState('mode: enforce'));
    const beside = await cli(['estate', 'diff', 'v1/map.yaml', 'v2/map.yaml'], root);
    expect(beside.code).toBe(0);
    expect(beside.out).not.toContain('promoted');
    const named = await cli(
      ['estate', 'diff', 'v1/map.yaml', 'v2/map.yaml', '--new-guards', 'new-state.yaml'],
      root,
    );
    expect(named.err).toBe('');
    expect(named.code).toBe(0);
    expect(named.out).toContain(`promoted ${GUARDS[2]}: warn to enforce`);
  });

  it('has no guards without a state file, and exits 2 on a state that does not fit its map', async () => {
    const root = await versions();
    const none = await cli(['estate', 'diff', 'v1/map.yaml', 'v2/map.yaml', '--json'], root);
    expect(none.code).toBe(0);
    expect(JSON.parse(none.out)).not.toHaveProperty('guards');
    await writeFile(join(root, 'v2', 'guard-state.yaml'), 'version: 1\nguards: []\n');
    const short = await cli(['estate', 'diff', 'v1/map.yaml', 'v2/map.yaml'], root);
    expect(short.code).toBe(2);
    expect(short.err).toContain('The guard state v2/guard-state.yaml does not fit the map v2/map.yaml:');
    expect(short.err).toContain(`  the guard ${GUARDS[0]} has no state`);
    const missing = await cli(
      ['estate', 'diff', 'v1/map.yaml', 'v1/map.yaml', '--old-guards', 'nowhere.yaml'],
      root,
    );
    expect(missing.code).toBe(2);
  });
});

describe('the fixture-v2 outputs', () => {
  const V2 = 'examples/estates/fixture-v2';
  const withoutWrote = (text: string) => text.replace(/^Wrote .*\n/m, '');

  it('prints the committed diff of the first version against the second', async () => {
    const result = await cli([
      'estate',
      'diff',
      'examples/estates/fixture/approved.yaml',
      `${V2}/map.yaml`,
      '--old-guards',
      `${V2}/maintain/guard-state.v1.yaml`,
    ]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toBe(withoutWrote(await readFile(join(ROOT, V2, 'maintain', 'diff.txt'), 'utf8')));
  });

  it('prints the committed impact and exits 1, and retires the removed rule test on --write', async () => {
    const result = await cli(['estate', 'impact', `${V2}/maintain/diff.json`, '--tests', `${V2}/tests`]);
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    expect(result.out).toBe(withoutWrote(await readFile(join(ROOT, V2, 'maintain', 'impact.txt'), 'utf8')));

    const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-v2-'));
    await cp(join(ROOT, V2, 'tests'), join(root, 'tests'), { recursive: true });
    await cp(join(ROOT, V2, 'maintain', 'diff.json'), join(root, 'diff.json'));
    const written = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests', '--write'], root);
    expect(written.code).toBe(1);
    const retired = await readFile(join(root, 'tests', 'unsent-draft.yaml'), 'utf8');
    expect(retired).toContain(
      '  retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed\n',
    );
    for (const name of ['supplier-yes', 'draft-pair', 'late-shipment']) {
      expect(await readFile(join(root, 'tests', `${name}.yaml`), 'utf8')).toBe(
        await readFile(join(ROOT, V2, 'tests', `${name}.yaml`), 'utf8'),
      );
    }
  });
});

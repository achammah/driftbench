import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { navigationFiles, navigationReference } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  return { code: await main(argv, io), ...output };
}

describe('estate stats uses the documented report contract', () => {
  it('reports approved atoms, tested and enforced separately, with no sessions invented', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-stats-'));
    const specs = join(dir, 'empty');
    await mkdir(specs);
    const result = await run([
      'estate',
      'stats',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      join(FIXTURE, 'plan.yaml'),
      '--specs',
      specs,
      '--json',
    ]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
    if (!loaded.ok) throw new Error(loaded.errors.map((error) => error.message).join('; '));
    // A reference to a navigation-only document (here the report template) has no test by design.
    const navigation = navigationFiles(loaded.map.documents);
    const navigational = loaded.map.atoms.filter((atom) => navigationReference(atom, navigation));
    expect(navigational.map((atom) => atom.id)).toEqual(['reference.weekly-report.read-templates-report-md']);
    expect(report.coverage.navigationReferences).toBe(navigational.length);
    for (const kind of new Set(loaded.map.atoms.map((atom) => atom.kind))) {
      const atoms = loaded.map.atoms.filter(
        (atom) => atom.approved && atom.kind === kind && !navigational.includes(atom),
      );
      expect(report.coverage.kinds[kind]).toEqual({
        atoms: atoms.length,
        tested: 0,
        enforced: atoms.filter((atom) => atom.enforcement.length > 0).length,
      });
    }
    expect(report.coverage.cells.covered).toBe(0);
    expect(report.coverage.edges.covered).toBe(0);
    expect(report.reach).toEqual([]);
    expect(report.reachNotObservable).toEqual({
      status: 'not observable',
      atoms: loaded.map.atoms.filter(
        (atom) => atom.approved && !['skill', 'reference', 'guard', 'subagent'].includes(atom.kind),
      ).length,
    });
    expect(report.decay).toEqual([]);
    expect(report.drift).toEqual({ guards: [] });
  });

  it('rejects a plan for another map without printing a partial report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-stats-'));
    const plan = join(dir, 'plan.yaml');
    const text = await readFile(join(FIXTURE, 'plan.yaml'), 'utf8');
    await writeFile(plan, text.replace(/^mapHash: .+$/m, 'mapHash: wrong-map'));
    const result = await run([
      'estate',
      'stats',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      plan,
      '--specs',
      join(FIXTURE, 'generated'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(result.err).toMatch(/map/i);
  });
  it('counts repeated observations by session, and computes compliance and decay from replay verdicts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-stats-'));
    const specs = join(dir, 'specs');
    const sessions = join(dir, 'sessions');
    await mkdir(specs);
    await mkdir(sessions);
    const atom = 'skill.invoice-reconcile.skill-invoice-reconcile';
    for (const name of ['good', 'bad']) {
      const lines = [
        { type: 'user', message: { role: 'user', content: 'Reconcile this invoice.' } },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [1, 2].map((i) => ({
              type: 'tool_use',
              id: `skill-${i}`,
              name: 'Skill',
              input: { skill: 'invoice-reconcile' },
            })),
          },
        },
        { type: 'user', message: { role: 'user', content: 'Report the result.' } },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: name === 'good' ? 'balanced' : 'unbalanced' }],
          },
        },
      ];
      await writeFile(join(sessions, `${name}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
      await writeFile(
        join(specs, `${name}.yaml`),
        [
          `id: ${name}`,
          'kind: task',
          'metadata:',
          `  replay: { session: ${name} }`,
          `  estate: { atoms: [${atom}] }`,
          'blocks:',
          '  - user: Reconcile this invoice.',
          '    expect:',
          '      skills: [{ name: invoice-reconcile, count: { min: 1 } }]',
          '  - user: Report the result.',
          '    expect:',
          "      must: ['^balanced$']",
          '',
        ].join('\n'),
      );
    }
    // More than one spec on the same session must not count as another run or atom.
    await copyFile(join(specs, 'good.yaml'), join(specs, 'duplicate.yaml'));
    await writeFile(
      join(sessions, 'good.decisions.jsonl'),
      ['allow', 'deny', 'block']
        .map((verdict) => JSON.stringify({ check: 'ledger-guard', verdict, event: 'PreToolUse' }))
        .join('\n'),
    );
    const result = await run([
      'estate',
      'stats',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      join(FIXTURE, 'plan.yaml'),
      '--specs',
      specs,
      '--sessions',
      sessions,
      '--json',
    ]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    expect(report.coverage.kinds.skill.tested).toBe(1);
    const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
    if (!loaded.ok) throw new Error('fixture map');
    const observable = loaded.map.atoms.filter(
      (atom) => atom.approved && ['skill', 'reference', 'guard', 'subagent'].includes(atom.kind),
    );
    expect(report.reach.map((row: { atom: string }) => row.atom).sort()).toEqual(
      observable.map((atom) => atom.id).sort(),
    );
    expect(report.reachNotObservable).toEqual({
      status: 'not observable',
      atoms: loaded.map.atoms.filter((atom) => atom.approved).length - observable.length,
    });
    expect(report.reach.find((row: { atom: string }) => row.atom === atom)).toEqual({
      atom,
      reached: 2,
      followed: 1,
    });
    expect(report.decay).toEqual([
      { block: 0, runs: 2, passRate: 1 },
      { block: 1, runs: 2, passRate: 0.5 },
    ]);
    expect(report.drift.guards).toEqual([
      { guard: 'ledger-guard', decisions: 3, denies: 2, denyRate: 2 / 3 },
    ]);
  });

  it('excludes incomplete specs and counts complete static tests, cells and graph journeys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-stats-'));
    for (const name of ['specs', 'static', 'incomplete']) await mkdir(join(dir, name));
    const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
    if (!loaded.ok) throw new Error('fixture map');
    const edge = loaded.map.edges.find((edge) => edge.kind === 'dispatch');
    if (!edge) throw new Error('fixture dispatch edge');
    await writeFile(
      join(dir, 'specs', 'journey.yaml'),
      [
        'id: journey',
        'kind: task',
        'metadata:',
        `  estate: { atoms: [${edge.from}, ${edge.to}] }`,
        'blocks:',
        '  - user: Dispatch the audit.',
        '',
      ].join('\n'),
    );
    const staticPath = 'generated/static/setting/estate.setting.setting.settings.setting-model-is-opus.json';
    const setting = JSON.parse(await readFile(join(FIXTURE, staticPath), 'utf8'));
    await writeFile(join(dir, 'static', 'setting.json'), JSON.stringify(setting));
    await writeFile(join(dir, 'static', 'duplicate.json'), JSON.stringify(setting));
    await writeFile(join(dir, 'incomplete', 'broken.yaml'), 'not valid yaml: [');
    await writeFile(
      join(dir, 'specs', 'retired.yaml'),
      [
        'id: retired',
        'kind: task',
        'metadata:',
        '  retired: atom no longer exists',
        '  estate: { atoms: [skill.weekly-report.skill-weekly-report] }',
        'blocks:',
        '  - user: Build the weekly report.',
        '',
      ].join('\n'),
    );
    const result = await run([
      'estate',
      'stats',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      join(FIXTURE, 'plan.yaml'),
      '--specs',
      dir,
      '--json',
    ]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    expect(report.coverage.kinds.setting.tested).toBe(1);
    expect(report.coverage.kinds.skill.tested).toBe(
      loaded.map.atoms.filter(
        (atom) => atom.approved && atom.kind === 'skill' && [edge.from, edge.to].includes(atom.id),
      ).length,
    );
    expect(report.coverage.cells.covered).toBe(1);
    expect(report.coverage.edges.covered).toBeGreaterThanOrEqual(1);
    expect(report.coverage.edges.covered).toBeLessThanOrEqual(report.coverage.edges.total);
  });

  it('rejects malformed recorded input without partial JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-stats-'));
    await mkdir(join(dir, 'specs'));
    await mkdir(join(dir, 'sessions'));
    await writeFile(join(dir, 'sessions', 'bad.jsonl'), '{"unknown":true}');
    const result = await run([
      'estate',
      'stats',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      join(FIXTURE, 'plan.yaml'),
      '--specs',
      join(dir, 'specs'),
      '--sessions',
      join(dir, 'sessions'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(result.err).toMatch(/transcript/i);
  });
  it('rejects a malformed static test instead of hiding a coverage input error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-stats-'));
    await mkdir(join(dir, 'specs'));
    await mkdir(join(dir, 'static'));
    await writeFile(join(dir, 'static', 'bad.json'), '{"testType":"setting"}');
    const result = await run([
      'estate',
      'stats',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      join(FIXTURE, 'plan.yaml'),
      '--specs',
      dir,
      '--json',
    ]);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(result.err).toContain('not a static test');
  });
});

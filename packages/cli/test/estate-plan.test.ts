import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEstateMap, parsePlanText, toEstateSpaceMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

/** A folder holding the fixture's approved map and space map. */
async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-plan-'));
  await cp(join(FIXTURE, 'approved.yaml'), join(root, 'approved.yaml'));
  await cp(join(FIXTURE, 'space.yaml'), join(root, 'space.yaml'));
  return root;
}

describe('driftbench estate plan', () => {
  it('writes the explicitly declared full plan and its summary, and prints the summary', async () => {
    const root = await folder();
    const result = await run(
      ['estate', 'plan', 'approved.yaml', '--out', 'plan.yaml', '--space', 'space.yaml'],
      root,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'Wrote plan.yaml: 1571 rows (362 from the contract, 12 journeys, 1197 pairwise), all proposed. Summary in plan.summary.json.',
    );
    expect(result.out).toContain('Covering array: 1197 rows, t = 2, 5092 of 5092 allowed 2-tuples covered');
    expect(result.out).toContain('the full grid of 2531567001600 cells is never enumerated');
    expect(result.out).toContain('Unenforced: 54 approved rules no guard enforces.');
    expect(result.out).toContain('Cells with no approved phrase: 1432 of 1432.');
    expect(result.out).toContain('Edges with no journey: 7.');
    expect(result.out).toContain('The map has no phrase bank yet');
    const summary = JSON.parse(await readFile(join(root, 'plan.summary.json'), 'utf8'));
    expect(summary.coveringArraySize).toBe(1197);
    expect(summary.uncoveredEdges).toHaveLength(7);
    expect(parsePlanText(await readFile(join(root, 'plan.yaml'), 'utf8')).ok).toBe(true);
  }, 60_000);

  it('writes the same bytes on a second run, and the committed fixture plan is that output', async () => {
    const root = await folder();
    const loaded = await loadEstateMap(join(root, 'approved.yaml'));
    if (!loaded.ok) throw new Error('invalid fixture map');
    await writeFile(join(root, 'legacy-space.json'), JSON.stringify(toEstateSpaceMap(loaded.map)));
    expect(
      (
        await run(
          ['estate', 'plan', 'approved.yaml', '--out', 'a.yaml', '--space', 'legacy-space.json'],
          root,
        )
      ).code,
    ).toBe(0);
    expect(
      (
        await run(
          ['estate', 'plan', 'approved.yaml', '--out', 'b.yaml', '--space', 'legacy-space.json'],
          root,
        )
      ).code,
    ).toBe(0);
    const a = await readFile(join(root, 'a.yaml'), 'utf8');
    expect(await readFile(join(root, 'b.yaml'), 'utf8')).toBe(a);
    expect(await readFile(join(root, 'b.summary.json'), 'utf8')).toBe(
      await readFile(join(root, 'a.summary.json'), 'utf8'),
    );
    expect(await readFile(join(FIXTURE, 'plan.yaml'), 'utf8')).toBe(a);
  }, 60_000);

  it('uses inferred relevance by default and exposes the exclusions for review', async () => {
    const root = await folder();
    const result = await run(['estate', 'plan', 'approved.yaml', '--out', 'focused.yaml'], root);
    expect(result.code).toBe(0);
    const summary = JSON.parse(await readFile(join(root, 'focused.summary.json'), 'utf8'));
    expect(summary.relevanceConstraints.length).toBeGreaterThan(0);
    expect(summary.tuples.covered).toBe(summary.tuples.allowed);
    const parsed = parsePlanText(await readFile(join(root, 'focused.yaml'), 'utf8'));
    if (!parsed.ok) throw new Error('invalid focused plan');
    const gate = 'gate.standing.read-git-status-before-commit-to';
    const own = parsed.plan.rows.filter((row) => row.id.startsWith('pairwise.') && row.atomIds[0] === gate);
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((row) => row.cell.deviation === 'D5_language_switch')).toBe(false);
  }, 60_000);

  it('takes a space map and a strength, and refuses one whose targets the map does not approve', async () => {
    const root = await folder();
    const spaced = await run(
      ['estate', 'plan', 'approved.yaml', '--out', 'p.yaml', '--space', 'space.yaml', '--t', '1'],
      root,
    );
    expect(spaced.code).toBe(0);
    expect(spaced.out).toContain('t = 1');
    const space = await readFile(join(root, 'space.yaml'), 'utf8');
    await writeFile(
      join(root, 'bad.yaml'),
      space.replace(
        '- { id: gate.standing.read-git-status-before-commit-to',
        '- { id: gate.standing.not-in-the-map',
      ),
    );
    const bad = await run(
      ['estate', 'plan', 'approved.yaml', '--out', 'q.yaml', '--space', 'bad.yaml'],
      root,
    );
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('gate.standing.not-in-the-map (not an atom of the map)');
  }, 60_000);

  it('exits 2 on a usage error and writes nothing; replaces a plan only with --force', async () => {
    const root = await folder();
    expect((await run(['estate', 'plan', 'approved.yaml'], root)).code).toBe(2);
    const zero = await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml', '--t', '0'], root);
    expect(zero.code).toBe(2);
    expect(zero.err).toContain('--t takes a whole number of at least 1');
    expect((await run(['estate', 'plan', 'missing.yaml', '--out', 'p.yaml'], root)).code).toBe(2);
    expect((await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml'], root)).code).toBe(0);
    const again = await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml'], root);
    expect(again.code).toBe(2);
    expect(again.err).toContain('pass --force');
    expect((await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml', '--force'], root)).code).toBe(0);
  }, 60_000);

  it('exits 1 on a map whose quote was edited', async () => {
    const root = await folder();
    const text = await readFile(join(root, 'approved.yaml'), 'utf8');
    await writeFile(
      join(root, 'approved.yaml'),
      text.replace('quote: Ask at most one question per reply.', 'quote: Ask two.'),
    );
    const result = await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml'], root);
    expect(result.code).toBe(1);
    expect(result.err).toContain('MAP_HASH');
  }, 60_000);
});

describe('driftbench estate plan approve', () => {
  it('lists the rows by status, strikes a row, approves the rest, and refuses an unknown row', async () => {
    const root = await folder();
    expect(
      (await run(['estate', 'plan', 'approved.yaml', '--out', 'plan.yaml', '--space', 'space.yaml'], root))
        .code,
    ).toBe(0);
    const list = await run(['estate', 'plan', 'approve', 'plan.yaml'], root);
    expect(list.out).toContain('plan.yaml: 1571 rows, 1571 proposed, 0 approved, 0 struck.');
    const strike = await run(
      ['estate', 'plan', 'approve', 'plan.yaml', '--row', 'journey.01', '--strike'],
      root,
    );
    expect(strike.code).toBe(0);
    expect(strike.out).toContain('Struck 1 row in plan.yaml');
    const all = await run(['estate', 'plan', 'approve', 'plan.yaml', '--all'], root);
    expect(all.out).toContain('Approved 1570 rows in plan.yaml');
    const after = await run(['estate', 'plan', 'approve', 'plan.yaml'], root);
    expect(after.out).toContain('1571 rows, 0 proposed, 1570 approved, 1 struck.');
    const before = await readFile(join(root, 'plan.yaml'), 'utf8');
    const again = await run(['estate', 'plan', 'approve', 'plan.yaml', '--out', 'plan2.yaml', '--all'], root);
    expect(again.code).toBe(0);
    expect(again.err).toBe('');
    expect(again.out).toBe('Approved 0 rows in plan2.yaml; 1570 were already approved.\n');
    expect(await readFile(join(root, 'plan2.yaml'), 'utf8')).toBe(before);
    expect(await readFile(join(root, 'plan.yaml'), 'utf8')).toBe(before);
    const unknown = await run(['estate', 'plan', 'approve', 'plan.yaml', '--row', 'no.such.row'], root);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('PLAN_UNKNOWN_ROW');
  }, 60_000);

  it('exits 2 when the options do not fit', async () => {
    const root = await folder();
    expect(
      (await run(['estate', 'plan', 'approved.yaml', '--out', 'plan.yaml', '--space', 'space.yaml'], root))
        .code,
    ).toBe(0);
    const both = await run(['estate', 'plan', 'approve', 'plan.yaml', '--all', '--row', 'journey.01'], root);
    expect(both.code).toBe(2);
    const strikeAll = await run(['estate', 'plan', 'approve', 'plan.yaml', '--strike'], root);
    expect(strikeAll.code).toBe(2);
    expect((await run(['estate', 'plan', 'approve', 'missing.yaml', '--all'], root)).code).toBe(2);
    const unknown = await run(['estate', 'plan', 'approve', 'plan.yaml', '--all', '--frobnicate'], root);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('--frobnicate');
  }, 60_000);

  it('writes the approved plan to --out and leaves the plan it read untouched', async () => {
    const root = await folder();
    expect(
      (await run(['estate', 'plan', 'approved.yaml', '--out', 'plan.yaml', '--space', 'space.yaml'], root))
        .code,
    ).toBe(0);
    const before = await readFile(join(root, 'plan.yaml'), 'utf8');
    const result = await run(
      ['estate', 'plan', 'approve', 'plan.yaml', '--all', '--out', 'plan.approved.yaml'],
      root,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Approved 1571 rows in plan.approved.yaml');
    expect(await readFile(join(root, 'plan.yaml'), 'utf8')).toBe(before);
    const written = await readFile(join(root, 'plan.approved.yaml'), 'utf8');
    const rowsApproved = before
      .split('\n')
      .map((line) => (line.startsWith('  - {') ? line.replace('status: proposed', 'status: approved') : line))
      .join('\n');
    expect(written).toBe(rowsApproved);
    const strike = await run(
      [
        'estate',
        'plan',
        'approve',
        'plan.approved.yaml',
        '--row',
        'journey.01',
        '--strike',
        '--out',
        'struck.yaml',
      ],
      root,
    );
    expect(strike.code).toBe(0);
    expect(await readFile(join(root, 'struck.yaml'), 'utf8')).toContain('status: struck');
    expect(await readFile(join(root, 'plan.approved.yaml'), 'utf8')).toBe(written);
  }, 60_000);
});

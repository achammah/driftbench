import { toEstateSpaceMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { runLadder } from '../../src/index';
import { plantedOf } from '../../src/ladders/estate/bank/relevance-typed';
import {
  allowedPairs,
  atomLevel,
  clearBankCache,
  type EstateRun,
  estateLadder,
  estateRun,
  frontmatterFamily,
  lintLevel,
  matchAtoms,
  PlantedEstate,
  planLevel,
  requiredRows,
  specLevel,
  standingFamily,
} from '../../src/ladders/estate/index';
import { exclusionJustifier } from '../../src/ladders/estate/levels';

/** The seed 1 run with one part replaced: a fault planted in the component a level watches. */
async function planted(change: (run: EstateRun) => EstateRun): Promise<EstateRun> {
  return change(await estateRun(1));
}

describe('the estate ladder', { timeout: 120_000 }, () => {
  it('has the seven levels of the bank, in order, each a sub-bank with threshold 1', () => {
    const ladder = estateLadder();
    expect(ladder.levels.map((level) => level.id)).toEqual([
      'reader',
      'lint',
      'plan',
      'generation',
      'agent-mutants',
      'maintenance',
      'scale',
    ]);
    expect(ladder.levels.every((level) => level.threshold === 1)).toBe(true);
  });

  it('stops at the reader level on a deliberately lost route, naming its family, tier and file', async () => {
    const originalScan = PlantedEstate.prototype.scan;
    let planted = false;
    const scan = vi.spyOn(PlantedEstate.prototype, 'scan').mockImplementation(async function (
      this: PlantedEstate,
    ) {
      const result = await originalScan.call(this);
      const hid = 'scan.standing.plain-name:row';
      if (this.expected.some((atom) => atom.hid === hid && atom.kind === 'route')) planted = true;
      const id = result.idOf.get(hid);
      result.idOf.delete(hid);
      result.map.atoms = result.map.atoms.filter((atom) => atom.id !== id);
      if (id !== undefined) result.atomOf.delete(id);
      return result;
    });
    clearBankCache();
    try {
      const run = await runLadder(
        estateLadder({ families: { reader: () => [standingFamily(), frontmatterFamily()] } }),
        { seed: 1 },
      );
      expect(scan).toHaveBeenCalled();
      expect(planted).toBe(true);
      expect(run.level).toBe(0);
      expect(run.failing?.id).toBe('reader');
      expect(run.rows[1]?.pass).toBeNull();
      const item = run.failing?.items.find((candidate) => candidate.id === 'scan.standing.plain-name');
      expect(item?.component).toBe('packages/estate/src/scan/code.ts');
      expect(item?.detail).toMatch(
        /^\[scan\.standing, tier 3\] the reader reads a routing cell naming the skill without backticks/,
      );
      expect(run.failing?.items.some((candidate) => candidate.id === 'scan.frontmatter.plain')).toBe(false);
    } finally {
      scan.mockRestore();
      clearBankCache();
    }
  });

  it('level 1 of the generated estate fails when the scan loses an atom, naming its hidden id and its line', async () => {
    const lost = await planted((run) => {
      const atoms = run.scanned.map.atoms.filter((atom) => atom.kind !== 'script');
      return {
        ...run,
        scanned: {
          ...run.scanned,
          map: { ...run.scanned.map, atoms },
          match: matchAtoms(run.rendered.atoms, atoms),
        },
      };
    });
    const measure = atomLevel(lost);
    expect(measure.value).toBe(0);
    const missed = measure.items.filter((item) => item.id.startsWith('atom-missed:script:'));
    expect(missed.length).toBeGreaterThan(0);
    expect(missed[0]?.component).toBe('packages/estate/src/scan/code.ts');
    expect(missed[0]?.detail).toMatch(
      /^script \.claude\/skills\/.+ at .+SKILL\.md:\d+ was planted and not found: "\d\. Run `python3 scripts\//,
    );
  });

  it('fails level 1 on an atom nobody planted, and on an edge the map lost', async () => {
    const run = await estateRun(1);
    const extra = {
      ...(run.scanned.map.atoms[0] as EstateRun['scanned']['map']['atoms'][0]),
      id: 'skill.x.invented',
    };
    const atoms = [
      ...run.scanned.map.atoms,
      { ...extra, provenance: { ...extra.provenance, startLine: 999 } },
    ];
    const withExtra = atomLevel({
      ...run,
      scanned: {
        ...run.scanned,
        map: { ...run.scanned.map, atoms },
        match: matchAtoms(run.rendered.atoms, atoms),
      },
    });
    expect(withExtra.value).toBeLessThan(1);
    expect(withExtra.items.map((item) => item.id)).toEqual(['atom-extra:skill.x.invented']);

    const edges = run.scanned.map.edges.filter((edge) => edge.kind !== 'cites' && edge.kind !== 'next');
    const lost = atomLevel({ ...run, scanned: { ...run.scanned, map: { ...run.scanned.map, edges } } });
    expect(lost.value).toBeLessThan(1);
    expect(lost.items.length).toBeGreaterThan(0);
    expect(lost.items.every((item) => item.id.startsWith('edge-missed:'))).toBe(true);
    expect(lost.items.every((item) => item.component === 'packages/estate/src/graph/edges.ts')).toBe(true);
    expect(lost.items.some((item) => item.id.includes('>next>'))).toBe(true);
  });

  it('fails level 2 when the lint misses a planted defect or finds one nobody planted', async () => {
    const run = await estateRun(1);
    expect(lintLevel(run)).toEqual({ value: 1, items: [] });
    const missing = lintLevel({
      ...run,
      lint: { ...run.lint, findings: run.lint.findings.filter((finding) => finding.code !== 'REGISTRY_ROW') },
    });
    expect(missing.value).toBeLessThan(1);
    expect(missing.items.map((item) => item.id)).toEqual(['lint-missed:REGISTRY_ROW:reply-length.py']);
    const extra = lintLevel({
      ...run,
      lint: {
        ...run.lint,
        findings: [
          ...run.lint.findings,
          { code: 'ORPHAN', subject: 'notes/x.md', message: 'notes/x.md: nothing names it' },
        ],
      },
    });
    expect(extra.items.map((item) => item.id)).toEqual(['lint-extra:ORPHAN:notes/x.md']);
  });

  it('fails level 3 when a pairwise row or a mandatory row is missing', async () => {
    const run = await estateRun(1);
    const base = planLevel(run);
    const rows = run.plan.plan.rows;
    const lastPairwise = rows.filter((row) => row.id.startsWith('pairwise.')).length;
    const noPairs = planLevel({
      ...run,
      plan: {
        ...run.plan,
        plan: { ...run.plan.plan, rows: rows.filter((row) => !row.id.startsWith('pairwise.')) },
      },
    });
    expect(lastPairwise).toBeGreaterThan(0);
    expect(noPairs.value).toBeLessThan(base.value);
    expect(noPairs.items[0]?.id).toBe('pairs-uncovered');
    const noTwin = planLevel({
      ...run,
      plan: { ...run.plan, plan: { ...run.plan.plan, rows: rows.filter((row) => row.testType !== 'twin') } },
    });
    expect(noTwin.items.some((item) => item.id.endsWith(':twin'))).toBe(true);
    expect(noTwin.items.find((item) => item.id.endsWith(':twin'))?.component).toBe(
      'packages/estate/src/plan/contract.ts',
    );
  });

  it('counts a declared exclusion only where the validator\u2019s relevance table justifies it', async () => {
    const run = await estateRun(1);
    const accepts = exclusionJustifier(run.scanned.map, plantedOf(run));
    const declared = run.plan.details.relevanceConstraints ?? [];
    const justified = declared.filter((constraint) => accepts(constraint.forbid));
    expect(declared.length).toBeGreaterThan(justified.length);
    expect(justified.length).toBeGreaterThan(0);
    const only = (relevanceConstraints: typeof declared) =>
      planLevel({ ...run, plan: { ...run.plan, details: { ...run.plan.details, relevanceConstraints } } });
    // An exclusion the table does not justify adds nothing: the level is that of the justified ones alone.
    expect(planLevel(run)).toEqual(only(justified));
    // Without any, the pairs of the justified values are owed again.
    expect(only([]).value).toBeLessThan(planLevel(run).value);
    // A value the table holds a row for and the plan excluded entirely (a dead helper) is not owed.
    expect(planLevel(run).items[0]?.detail ?? '').not.toContain('dead_helper');
  });

  /**
   * A planner that keeps the fewest rows in which every value of every dimension appears once, and declares every
   * other allowed pair excluded. Pairwise coverage reduced to coverage of each value once must not pass.
   */
  async function freeExclusionPlanner(seed: number, form: 'pair' | 'target') {
    const run = await estateRun(seed);
    const space = toEstateSpaceMap(run.scanned.map);
    const targetDims = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
    const dimensionOfTarget = new Map(
      targetDims.flatMap((dimension) => dimension.values.map((value) => [value.id, dimension.id] as const)),
    );
    const rows = run.plan.plan.rows.filter((row) => row.id.startsWith('pairwise.'));
    const keyOf = (dimension: string, value: string) =>
      `${dimension.startsWith('atoms.') ? 'target' : dimension}=${value}`;
    const needed = new Set(rows.flatMap((row) => Object.entries(row.cell).map(([d, v]) => keyOf(d, v))));
    const kept: typeof rows = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const keys = Object.entries(row.cell).map(([d, v]) => keyOf(d, v));
      if (keys.some((key) => !seen.has(key))) {
        kept.push(row);
        for (const key of keys) seen.add(key);
      }
      if (seen.size === needed.size) break;
    }
    const covered = new Set<string>();
    for (const row of kept) {
      const entries = Object.entries(row.cell);
      for (const [da, va] of entries)
        for (const [db, vb] of entries) if (da !== db) covered.add(`${keyOf(da, va)}|${keyOf(db, vb)}`);
    }
    const excluded: Array<{ forbid: Record<string, string>; reason: string }> = [];
    const situations = space.dimensions.filter((dimension) => !dimension.id.startsWith('atoms.'));
    const values = [
      ...situations.flatMap((dimension) =>
        dimension.values.map((value) => [dimension.id, value.id] as const),
      ),
    ];
    const targets = targetDims.flatMap((dimension) => dimension.values.map((value) => value.id));
    // Every pair of two situation values the kept rows do not hold, or (form target) every target but one per value.
    if (form === 'pair') {
      for (const [da, va] of values)
        for (const [db, vb] of values)
          if (da < db && !covered.has(`${keyOf(da, va)}|${keyOf(db, vb)}`))
            excluded.push({ forbid: { [da]: va, [db]: vb }, reason: 'declared' });
      for (const [d, v] of values)
        for (const target of targets)
          if (!covered.has(`${keyOf(d, v)}|target=${target}`))
            excluded.push({
              forbid: { [d]: v, [dimensionOfTarget.get(target) as string]: target },
              reason: 'declared',
            });
    } else {
      const keep = new Set(kept.map((row) => row.atomIds[0]));
      for (const [d, v] of values)
        for (const target of targets)
          if (!keep.has(target))
            excluded.push({
              forbid: { [d]: v, [dimensionOfTarget.get(target) as string]: target },
              reason: 'declared',
            });
    }
    const plan = {
      ...run.plan,
      plan: {
        ...run.plan.plan,
        rows: [...run.plan.plan.rows.filter((row) => !row.id.startsWith('pairwise.')), ...kept],
      },
      details: { ...run.plan.details, relevanceConstraints: excluded },
    };
    return {
      run,
      measure: planLevel({ ...run, plan }),
      kept: kept.length,
      total: rows.length,
      excluded: excluded.length,
    };
  }

  it.each([1, 2, 3])('does not pass a planner that declares its pairs excluded, on seed %i', async (seed) => {
    const attack = await freeExclusionPlanner(seed, 'pair');
    expect(attack.excluded).toBeGreaterThan(0);
    expect(attack.kept).toBeLessThan(attack.total);
    expect(attack.measure.value).toBeLessThan(0.5);
  });

  it.each([1, 2, 3])(
    'does not pass a planner that excludes all but a few targets, on seed %i',
    async (seed) => {
      const attack = await freeExclusionPlanner(seed, 'target');
      expect(attack.measure.value).toBeLessThan(0.5);
    },
  );

  it('fails a complete spec whose expectation the rule follower does not meet, and a spec that does not load', async () => {
    const run = await estateRun(1);
    const target = run.specs.find(
      (spec) =>
        spec.record.complete && spec.record.testType === 'route_positive' && spec.text.includes('skills:'),
    );
    if (!target?.loaded) throw new Error('no complete route test');
    const wrong = structuredClone(target);
    const block = wrong.loaded?.spec.blocks[0];
    if (!block?.expect?.skills?.[0]) throw new Error('no skill expectation');
    block.expect.skills[0].count = 0;
    const broken = structuredClone(target);
    broken.loaded = undefined;
    broken.errors = ['SPEC_PARSE: bad'];
    const measure = await specLevel({
      ...run,
      specs: [wrong, broken, ...run.specs.filter((spec) => spec.record.id !== target.record.id).slice(0, 0)],
    });
    expect(measure.value).toBe(0);
    expect(measure.items.map((item) => item.id).sort()).toEqual(
      ['follower:route_positive:skills', `invalid:${target.record.id}`].sort(),
    );
  });

  it('lists the allowed pairs by search, leaving out the forbidden and the ones no cell extends', () => {
    const dimensions = [
      { id: 'a', values: ['1', '2'] },
      { id: 'b', values: ['x', 'y'] },
      { id: 'c', values: ['p'] },
    ];
    const pairs = allowedPairs(dimensions, [
      { a: '1', b: 'x' },
      { b: 'y', c: 'p' },
    ]);
    const keys = pairs.map(([da, va, db, vb]) => `${da}${va}${db}${vb}`);
    expect(keys).not.toContain('a1bx');
    // b=y can never extend, since every cell holds c=p; a=1 with c=p can take neither b.
    expect(keys.some((key) => key.includes('by'))).toBe(false);
    expect(keys.sort()).toEqual(['a2bx', 'a2cp', 'bxcp']);
  });

  it('asks k positive asks per route and one register sample per ask class', () => {
    const atom = { id: 'x', kind: 'route', fields: {} } as Parameters<typeof requiredRows>[0];
    expect(requiredRows(atom, [])).toContainEqual({ type: 'route_positive', count: 3 });
    expect(requiredRows({ ...atom, kind: 'register' }, ['build', 'chat'])).toEqual([
      { type: 'register_sample', count: 2 },
    ]);
    expect(requiredRows({ ...atom, kind: 'tool', fields: { effect: 'deny' } }, [])).toEqual([
      { type: 'tool_denied', count: 1 },
    ]);
  });
});

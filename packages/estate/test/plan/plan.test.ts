import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approvePlanRows,
  buildPlan,
  cellKey,
  PHRASE_NOTE,
  PlanInputError,
  parsePlanText,
  renderPlan,
  renderPlanSummary,
  summaryPathOf,
  toEstateSpaceMap,
} from '../../src/index';
import { FIXTURE } from '../support';
import { approvedFixture, edited } from './support';

describe('the estate plan', () => {
  it('renders the same bytes for the same map and options, and parses back to the same plan', async () => {
    const map = await approvedFixture();
    const first = buildPlan(map);
    const second = buildPlan(await approvedFixture());
    expect(renderPlan(second.plan)).toBe(renderPlan(first.plan));
    expect(renderPlanSummary(second.plan, second.details)).toBe(renderPlanSummary(first.plan, first.details));
    const parsed = parsePlanText(renderPlan(first.plan));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.plan).toEqual(first.plan);
    expect(renderPlan(buildPlan(map, { t: 1 }).plan)).not.toBe(renderPlan(first.plan));
  }, 60_000);

  it('matches the current byte snapshot with the declared full space supplied explicitly', async () => {
    const map = await approvedFixture();
    const built = buildPlan(map, { space: toEstateSpaceMap(map) });
    const snapshot = JSON.parse(
      await readFile(new URL('./current-plan.sha256.json', import.meta.url), 'utf8'),
    );
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(sha(renderPlan(built.plan))).toBe(snapshot.plan);
    expect(sha(renderPlanSummary(built.plan, built.details))).toBe(snapshot.summary);
  }, 60_000);

  it('counts the summary from the rows: cells, phrases, kinds, test types, unenforced atoms', async () => {
    const map = await approvedFixture();
    const { plan, details } = buildPlan(map);
    const { summary } = plan;
    expect(summary.cells).toBe(new Set(plan.rows.map(cellKey)).size);
    expect(summary.cellsWithoutPhrase).toBe(summary.cells);
    expect(details.notes).toContain(PHRASE_NOTE);
    expect(Object.values(summary.perTestType).reduce((sum, n) => sum + n, 0)).toBe(plan.rows.length);
    expect(details.rows.total).toBe(details.rows.contract + details.rows.journey + details.rows.pairwise);
    expect(summary.coveringArraySize).toBe(details.rows.pairwise);
    expect(summary.perKind.instruction).toBe(129);
    expect(summary.perKind.setting).toBe(4);
    expect(summary.perTestType.setting).toBe(4);
    expect(details.noContract).toEqual([]);
    expect(summary.unenforcedAtoms).toEqual(
      map.atoms
        .filter(
          (atom) => ['instruction', 'gate', 'register'].includes(atom.kind) && atom.enforcement.length === 0,
        )
        .map((atom) => atom.id),
    );
    expect(summary.unenforcedAtoms).toHaveLength(54);
    expect(summary.edgesWithoutJourney).toBe(7);
    expect(details.gridCells).toBe(2_531_567_001_600);
    expect(details.tuples.covered).toBe(details.tuples.allowed);
  }, 60_000);

  it('leaves unapproved atoms out of the rows and the unenforced list', async () => {
    const id = 'instruction.standing.tell-the-user-about-a-late';
    const map = edited(await approvedFixture(), (copy) => {
      const atom = copy.atoms.find((candidate) => candidate.id === id);
      if (atom) atom.approved = false;
    });
    const { plan, details } = buildPlan(map);
    expect(plan.rows.some((row) => row.atomIds.includes(id))).toBe(false);
    expect(plan.summary.unenforcedAtoms).not.toContain(id);
    expect(details.unapproved).toBe(1);
  }, 60_000);

  it('marks the negative controls as rows of their own, each with its mode', async () => {
    const { plan } = buildPlan(await approvedFixture());
    for (const type of ['outside_trigger', 'route_near_miss', 'guard_negative'] as const) {
      const rows = plan.rows.filter((row) => row.testType === type);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.id.startsWith(`${type}.`)).toBe(true);
    }
    expect(plan.rows.find((row) => row.testType === 'guard_negative')?.mode).toBe('unit');
    expect(plan.rows.find((row) => row.testType === 'guard_positive')?.mode).toBe('replay');
    expect(plan.rows.every((row) => row.status === 'proposed' && row.weight === 1)).toBe(true);
  }, 60_000);

  it('drops a situation value the constraint list forbids with the target, and says so', async () => {
    const map = await approvedFixture();
    const space = toEstateSpaceMap(map);
    const helper = 'subagent.route-planner.helper-route-planner';
    space.constraints.push({
      forbid: { 'atoms.subagent': helper, estate_hazard: 'dead_helper' },
      reason: 'test',
    });
    const { plan, details } = buildPlan(map, { space });
    const row = plan.rows.find((candidate) => candidate.id === `stop_resume.${helper}`);
    expect(row?.cell).toEqual({ 'atoms.subagent': helper });
    expect(details.adjusted).toEqual([
      {
        row: `stop_resume.${helper}`,
        reason: 'the constraint list forbids session_state=helpers_running, estate_hazard=dead_helper',
      },
    ]);
  }, 60_000);

  it('refuses a space map whose targets are not approved atoms of the map, under their kind', async () => {
    const map = await approvedFixture();
    const space = toEstateSpaceMap(map);
    const target = space.dimensions.find((dimension) => dimension.id === 'atoms.gate');
    target?.values.push({ id: 'gate.standing.not-in-the-map', title: 'x' });
    expect(() => buildPlan(map, { space })).toThrow(PlanInputError);
    const unapproved = edited(map, (copy) => {
      const atom = copy.atoms.find(
        (candidate) => candidate.id === 'gate.standing.read-git-status-before-commit-to',
      );
      if (atom) atom.approved = false;
    });
    expect(() => buildPlan(unapproved, { space: toEstateSpaceMap(map) })).toThrow(/not approved/);
  }, 60_000);

  it('writes the summary beside the plan', () => {
    expect(summaryPathOf('/x/plan.yaml')).toBe('/x/plan.summary.json');
    expect(summaryPathOf('/x/plan.yml')).toBe('/x/plan.summary.json');
    expect(summaryPathOf('/x/plan')).toBe('/x/plan.summary.json');
  }, 60_000);
});

describe('approving plan rows', () => {
  async function text(): Promise<string> {
    return renderPlan(buildPlan(await approvedFixture()).plan);
  }

  it('counts already approved rows with all, excluding struck rows and preserving their statuses', async () => {
    const parsed = parsePlanText(await readFile(join(FIXTURE, 'plan.yaml'), 'utf8'));
    if (!parsed.ok) throw new Error('invalid fixture plan');
    const statuses = ['approved', 'proposed', 'struck'] as const;
    parsed.plan.rows = parsed.plan.rows.slice(0, statuses.length).map((row, index) => ({
      ...row,
      status: statuses[index] ?? 'proposed',
    }));
    const before = renderPlan(parsed.plan);
    const result = approvePlanRows(before, { all: true });
    if (!result.ok) throw new Error('approve failed');
    expect(result.changed).toEqual([parsed.plan.rows[1]?.id]);
    expect(result.unchanged).toBe(1);
    expect(result.text).toBe(before.replace('status: proposed,', 'status: approved,'));
    const again = approvePlanRows(result.text, { all: true });
    if (!again.ok) throw new Error('approve failed');
    expect(again.changed).toEqual([]);
    expect(again.unchanged).toBe(2);
    expect(again.text).toBe(result.text);
    const selected = approvePlanRows(result.text, { ids: [parsed.plan.rows[2]?.id ?? ''], strike: true });
    if (!selected.ok) throw new Error('strike failed');
    expect(selected.changed).toEqual([]);
    expect(selected.unchanged).toBe(1);
    expect(selected.text).toBe(result.text);
  });

  it('approves every proposed row with all, and leaves struck rows struck', async () => {
    const struck = approvePlanRows(await text(), { ids: ['journey.01'], strike: true });
    if (!struck.ok) throw new Error('strike failed');
    expect(struck.changed).toEqual(['journey.01']);
    const all = approvePlanRows(struck.text, { all: true });
    if (!all.ok) throw new Error('approve failed');
    const parsed = parsePlanText(all.text);
    if (!parsed.ok) throw new Error('invalid plan');
    expect(parsed.plan.rows.find((row) => row.id === 'journey.01')?.status).toBe('struck');
    expect(parsed.plan.rows.filter((row) => row.status === 'approved')).toHaveLength(
      parsed.plan.rows.length - 1,
    );
    expect(all.text.startsWith('# driftbench estate plan')).toBe(true);
  }, 60_000);

  it('approves one row, changes nothing else, and refuses an unknown row', async () => {
    const before = await text();
    const result = approvePlanRows(before, {
      ids: ['invariant.invariant.standing.no-file-of-the-estate-is'],
    });
    if (!result.ok) throw new Error('approve failed');
    const changedLines = result.text.split('\n').filter((line, index) => line !== before.split('\n')[index]);
    expect(changedLines).toHaveLength(1);
    expect(changedLines[0]).toContain('status: approved');
    const again = approvePlanRows(result.text, {
      ids: ['invariant.invariant.standing.no-file-of-the-estate-is'],
    });
    expect(again.ok && again.unchanged).toBe(1);
    const unknown = approvePlanRows(before, { ids: ['no.such.row'] });
    expect(unknown.ok).toBe(false);
  }, 60_000);

  it('refuses a plan with a repeated row id or an unknown test type', async () => {
    const plain = await text();
    const lines = plain.split('\n');
    const first = lines.findIndex((line) => line.startsWith('  - { id:'));
    const doubled = [...lines.slice(0, first + 1), lines[first] ?? '', ...lines.slice(first + 1)].join('\n');
    const repeated = parsePlanText(doubled);
    expect(repeated.ok === false && repeated.errors[0]?.code).toBe('PLAN_DUPLICATE_ROW');
    const wrongType = parsePlanText(plain.replace('testType: twin', 'testType: triplet'));
    expect(wrongType.ok).toBe(false);
    const broken = parsePlanText('rows: [');
    expect(broken.ok === false && broken.errors[0]?.code).toBe('PLAN_PARSE');
    const twice = parsePlanText('version: 1\nversion: 1\n');
    expect(twice.ok === false && twice.errors[0]?.code).toBe('PLAN_PARSE');
  }, 60_000);
});

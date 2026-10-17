import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { estateOwners, taskAtoms } from '../../src/estate/context';
import {
  type EstateGenerateInput,
  type EstateGenerateResult,
  EstateInputError,
  findSituation,
  generateEstateSuite,
  SITUATION_OF,
} from '../../src/estate/generate';
import { MARKERS } from '../../src/estate/then';
import {
  APPROVED_PLAN,
  FIXTURE_GENERATED,
  fixtureInputs,
  HAND_PATHS,
  PLANNER_PATHS,
  PLANNER_PLAN,
} from './support';

function specs(result: EstateGenerateResult): Map<string, Spec> {
  const out = new Map<string, Spec>();
  for (const file of result.files) {
    if (!file.path.endsWith('.yaml')) continue;
    const loaded = parseSpecText(file.text, 'yaml', file.path);
    if (!loaded.ok) throw new Error(`${file.path}: ${JSON.stringify(loaded.errors)}`);
    out.set(loaded.spec.id, loaded.spec);
  }
  return out;
}

/** The records written as spec files: static tests are JSON, run by `estate static`. */
function specRecords(result: EstateGenerateResult): EstateGenerateResult['specs'] {
  return result.specs.filter((record) => record.path.endsWith('.yaml'));
}

function only(map: Map<string, Spec>, id: string): Spec {
  const spec = map.get(id);
  if (!spec) throw new Error(`no spec ${id}`);
  return spec;
}

function estate(spec: Spec): Record<string, unknown> {
  return spec.metadata?.estate as Record<string, unknown>;
}

describe('estate generate on the Northwind fixture and the hand plan', () => {
  let input: EstateGenerateInput;
  let result: EstateGenerateResult;
  let byId: Map<string, Spec>;

  beforeAll(async () => {
    input = await fixtureInputs();
    result = generateEstateSuite(input, { paths: HAND_PATHS });
    byId = specs(result);
  });

  it('gives every approved row one spec, and one per recorded session for a replay row', () => {
    const approved = input.plan.rows.filter((row) => row.status === 'approved');
    for (const row of approved) {
      const own = result.specs.filter((spec) => spec.row === row.id);
      expect(own, row.id).toHaveLength(row.mode === 'replay' ? 3 : 1);
    }
    expect(result.specs.some((spec) => spec.row === 'p37')).toBe(false);
    expect(result.report.struck).toEqual(['p37']);
    expect(result.report.summary.specs).toBe(result.specs.length);
    expect(byId.size).toBe(specRecords(result).length);
  });

  it('writes every spec as a task of the estate adapter, with the Given of the row', () => {
    for (const spec of byId.values()) {
      expect(spec.kind).toBe('task');
      expect(spec.target).toEqual({ adapter: 'claude-code' });
      const vars = spec.given?.vars as Record<string, unknown>;
      expect(vars.estate).toEqual({ runtime: 'claude-code', map_hash: input.map.hash });
      expect(vars.session_state).toBe(
        estate(spec).cell && (estate(spec).cell as Record<string, string>).session_state,
      );
    }
    const compaction = only(byId, 'estate.p31');
    expect(compaction.given?.vars).toMatchObject({
      session_state: 'after_compaction',
      event: 'compaction_mid_task',
    });
    const seeded = only(byId, 'estate.p05');
    expect(seeded.given?.vars?.workspace_seed).toBe('northwind-ops');
    expect(Object.keys(seeded.given?.world?.workspace?.files ?? {})).toContain('reports/2026-W41.md');
  });

  it('asks with an approved phrase of the situation the test type needs', () => {
    const phrases = new Set(
      input.bank.situations.flatMap((situation) =>
        situation.phrases.filter((phrase) => phrase.approved).map((phrase) => phrase.text),
      ),
    );
    for (const record of specRecords(result).filter((spec) => spec.complete)) {
      const spec = only(byId, record.id);
      for (const block of spec.blocks) {
        const when = block.when as { user?: string };
        expect(phrases.has(when.user ?? ''), `${record.id} ${block.id}`).toBe(true);
      }
    }
    expect(estate(only(byId, 'estate.p06')).situation).toBe('invoice-near-miss');
    expect(estate(only(byId, 'estate.p07')).situation).toBe('shipment-misroute');
    expect(estate(only(byId, 'estate.p10')).situation).toBe('shipment-on-time');
    expect(estate(only(byId, 'estate.p13')).situation).toBe('edit-under-pressure');
    // The situation holding most of the row's atoms wins: the auditor alone, not the routing ask.
    expect(estate(only(byId, 'estate.p17')).situation).toBe('ledger-auditor-brief');
  });

  it('takes a second phrase for the twin', () => {
    const obligation = only(byId, 'estate.p09');
    const twin = only(byId, 'estate.p11');
    expect(estate(twin).situation).toBe(estate(obligation).situation);
    expect(estate(twin).phrase).not.toBe(estate(obligation).phrase);
    expect(twin.blocks[0]?.expect).toEqual(obligation.blocks[0]?.expect);
  });

  it('maps the atoms to checks: skills, guards, tools, order, stage, text and the declared outcome', () => {
    expect(only(byId, 'estate.p05').blocks[0]?.expect).toEqual({
      skills: [{ name: 'invoice-reconcile', count: { min: 1 } }],
      workspace: { others_untouched: true },
    });
    expect(only(byId, 'estate.p19').blocks[0]?.expect?.guards).toEqual([
      { name: 'block-force-push.sh', verdict: 'deny', count: { min: 1 } },
    ]);
    expect(only(byId, 'estate.p24').blocks[0]?.expect?.tools).toEqual([{ label: 'WebFetch', count: 0 }]);
    expect(only(byId, 'estate.p09').blocks[0]?.expect?.must).toEqual(['late']);
    // "Read a file before you edit it": the file read is the file edited.
    expect(only(byId, 'estate.p13').rules?.custom).toEqual({
      ordered: { pairs: [{ before: 'Read', after: 'Edit', key: 'file_path' }] },
    });
    const stageSkip = only(byId, 'estate.p27');
    expect(stageSkip.blocks[0]?.expect?.stage).toBe('report');
    expect(stageSkip.stages).toEqual(['plan', 'do', 'verify', 'report', 'note']);
    expect(stageSkip.rules?.custom).toEqual({
      ordered: {
        pairs: [
          { before: 'stage:verify', after: 'stage:report' },
          { before: 'stage:do', after: 'stage:verify' },
        ],
      },
    });
    expect(only(byId, 'estate.p01.weekly-clean').blocks[0]?.expect?.workspace).toEqual({
      changed: ['reports/2026-W41.md'],
      others_untouched: true,
    });
  });

  it('writes the negative controls as specs: not loaded, silent, no act', () => {
    expect(only(byId, 'estate.p06').blocks[0]?.expect?.skills).toEqual([
      { name: 'invoice-reconcile', count: 0 },
    ]);
    expect(only(byId, 'estate.p20').blocks[0]?.expect?.guards).toEqual([
      { name: 'block-force-push.sh', verdict: 'deny', count: 0 },
    ]);
    expect(only(byId, 'estate.p10').blocks[0]?.expect?.must_not).toEqual(['late']);
    expect(only(byId, 'estate.p17').blocks[0]?.expect?.tools).toEqual([
      { label: 'Edit', count: 0 },
      { label: 'Write', count: 0 },
    ]);
    // The misroute still loads the right skill.
    expect(only(byId, 'estate.p07').blocks[0]?.expect?.skills).toEqual([
      { name: 'shipment-tracker', count: { min: 1 } },
    ]);
  });

  it('judges a register rule only by its title, not gating, and counts those specs', () => {
    const spec = only(byId, 'estate.p30');
    expect(spec.criteria).toEqual([
      {
        name: 'register.standing.replies-under-1-200-characters',
        rubric: 'Replies under 1,200 characters',
        gating: false,
        scope: 'block',
      },
    ]);
    // Two criteria as before, plus the one of p31: a re-read of the open tracker note, which names no file.
    expect(result.report.summary.judged).toBe(3);
  });

  it('injects the deviation of the cell before the ask, with its approved phrase', () => {
    expect(only(byId, 'estate.p35').perturbations).toEqual([
      {
        id: 'deviation-D5_language_switch',
        class: 'D5_language_switch',
        inject_at: 0,
        user: expect.any(String),
        recovery: { within_blocks: 1 },
      },
    ]);
    const bank = input.bank.deviations.find((entry) => entry.class === 'D5_language_switch');
    const user = only(byId, 'estate.p35').perturbations?.[0]?.user;
    expect(bank?.phrases.map((phrase) => phrase.text)).toContain(user);
  });

  it('keeps every gap out of the complete suite, with its marker in the spec and the report', () => {
    for (const record of specRecords(result)) {
      const spec = only(byId, record.id);
      const needs = (estate(spec).needs ?? []) as Array<{ marker: string }>;
      expect(record.path.startsWith(record.complete ? 'specs/' : 'incomplete/'), record.id).toBe(true);
      expect(needs.length === 0, record.id).toBe(record.complete);
      if (!record.complete) {
        expect(spec.criteria).toBeUndefined();
        expect(spec.blocks[0]?.expect?.criteria).toEqual(record.markers);
      }
    }
    const markers = Object.fromEntries(result.specs.map((spec) => [spec.row, spec.markers]));
    expect(markers.p08).toEqual([]);
    // The script's command, the compiled confirmation, the hazard and the permission now have checks.
    for (const row of ['p12', 'p15', 'p25', 'p26', 'p31']) expect(markers[row], row).toEqual([]);
    // The guard's time and message are read from the hook output the runtime reports.
    expect(markers.p22).toEqual([]);
    expect(markers.p23).toEqual([]);
    expect(markers.p28).toEqual([]);
    expect(markers.p32).toEqual([]);
    expect(result.specs.find((spec) => spec.row === 'p32')?.path).toBe('static/invariant/estate.p32.json');
    expect(result.report.gaps.map((entry) => entry.marker)).toEqual([]);
  });

  it('plans each replay spec to fail exactly when its session breaks one of the row atoms', () => {
    const planned = Object.fromEntries(result.report.replay.map((entry) => [entry.spec, entry.expect]));
    expect(planned).toEqual({
      'estate.p01.weekly-clean': 'pass',
      'estate.p01.weekly-skill-skipped': 'fail',
      'estate.p01.weekly-gate-violated': 'pass',
      'estate.p02.weekly-clean': 'pass',
      'estate.p02.weekly-skill-skipped': 'pass',
      'estate.p02.weekly-gate-violated': 'fail',
      'estate.p03.weekly-clean': 'pass',
      // The rule belongs to weekly-report, whose required skill the session skips.
      'estate.p03.weekly-skill-skipped': 'fail',
      'estate.p03.weekly-gate-violated': 'pass',
      'estate.p04.weekly-clean': 'pass',
      'estate.p04.weekly-skill-skipped': 'pass',
      'estate.p04.weekly-gate-violated': 'pass',
    });
    for (const entry of result.report.replay) {
      const spec = only(byId, entry.spec);
      expect(spec.metadata?.replay).toEqual({ session: entry.session, from_block: 0 });
      expect(spec.blocks[0]?.when).toEqual({ user: input.sessions?.sessions[0]?.ask });
    }
  });

  it('validates every spec, and the complete ones lint clean', () => {
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
    for (const record of specRecords(result).filter((spec) => spec.complete)) {
      const file = result.files.find((entry) => entry.path === record.path);
      const loaded = parseSpecText(file?.text ?? '', 'yaml', record.id);
      expect(loaded.ok && loaded.warnings, record.id).toEqual([]);
    }
  });

  it('counts rows, specs, complete and incomplete per test type and per mode', () => {
    const { perTestType, perMode, summary } = result.report;
    expect(Object.keys(perTestType)).toEqual(Object.keys(SITUATION_OF).filter((type) => type in perTestType));
    expect(Object.keys(perTestType)).toHaveLength(Object.keys(SITUATION_OF).length - 1);
    const sum = (key: 'rows' | 'specs' | 'complete' | 'incomplete') =>
      Object.values(perTestType).reduce((total, entry) => total + entry[key], 0);
    expect(sum('rows')).toBe(36);
    expect(sum('specs')).toBe(summary.specs);
    expect(sum('complete')).toBe(summary.complete);
    expect(perMode.replay).toEqual({ rows: 4, specs: 12, complete: 12, incomplete: 0 });
    expect(perTestType.journey).toEqual({ rows: 2, specs: 2, complete: 2, incomplete: 0 });
  });
});

describe('estate generate on inputs that do not fit together', () => {
  let input: EstateGenerateInput;
  beforeAll(async () => {
    input = await fixtureInputs();
  });

  function issues(change: (copy: EstateGenerateInput) => void): string[] {
    const copy = structuredClone(input);
    change(copy);
    try {
      generateEstateSuite(copy, { paths: HAND_PATHS });
    } catch (cause) {
      if (cause instanceof EstateInputError)
        return cause.issues.map((issue) => `${issue.path}: ${issue.message}`);
      throw cause;
    }
    return [];
  }

  it('refuses a plan made from another map', () => {
    expect(issues((copy) => (copy.plan.mapHash = 'f'.repeat(64)))).toEqual([
      expect.stringMatching(/^plan\.mapHash: the plan was made from map ffffffffffff/),
    ]);
  });

  it('refuses a row naming an unknown or unapproved atom, and an unknown test type', () => {
    const found = issues((copy) => {
      const row = copy.plan.rows[0];
      if (row) row.atomIds = ['route.nowhere'];
      const atom = copy.map.atoms.find((entry) => entry.id === 'gate.standing.read-a-file-before-editing-it');
      if (atom) atom.approved = false;
      const third = copy.plan.rows[2];
      if (third) third.testType = 'vibe_check';
    });
    expect(found).toEqual([
      'plan.rows.0.atomIds.0: route.nowhere is no atom of the map',
      'plan.rows.1.atomIds.0: gate.standing.read-a-file-before-editing-it is not approved',
      'plan.rows.2.testType: vibe_check is no test type',
      'plan.rows.12.atomIds.0: gate.standing.read-a-file-before-editing-it is not approved',
    ]);
  });

  it('refuses a bank naming an unknown atom, and a session whose ask is no approved phrase', () => {
    const found = issues((copy) => {
      copy.bank.situations[0]?.atoms.push('instruction.nowhere');
      const session = copy.sessions?.sessions[0];
      if (session) session.ask = 'Something nobody approved.';
    });
    expect(found).toEqual([
      expect.stringMatching(
        /^phrases\.situations\.0\.atoms\.\d+: instruction\.nowhere is no atom of the map$/,
      ),
      'sessions.sessions.0.ask: the ask is no approved phrase of weekly-report-update',
    ]);
  });

  it('never asks with an unapproved phrase: code writes the ask, or, with no fallback, the row waits', () => {
    const copy = structuredClone(input);
    const situation = copy.bank.situations.find((entry) => entry.id === 'invoice-reconcile');
    for (const phrase of situation?.phrases ?? []) phrase.approved = false;
    const unapproved = (situation?.phrases ?? []).map((phrase) => phrase.text);

    const strict = generateEstateSuite(copy, { paths: HAND_PATHS, fallback: false });
    const waiting = strict.specs.find((spec) => spec.row === 'p05');
    expect(waiting?.complete).toBe(false);
    expect(waiting?.markers).toEqual([MARKERS.phrase]);

    const result = generateEstateSuite(copy, { paths: HAND_PATHS });
    const record = result.specs.find((spec) => spec.row === 'p05');
    expect(record).toMatchObject({ complete: true, ask: 'code', outcome: 'bank' });
    const spec = only(specs(result), 'estate.p05');
    const when = spec.blocks[0]?.when;
    const user = when && 'user' in when ? when.user : undefined;
    expect(unapproved).not.toContain(user);
    expect(user).toBe('Please reconcile an invoice against a purchase order.');
    expect(spec.tags).toContain('ask:code');
    expect(estate(spec)).toMatchObject({ ask: 'code', phrase: null, situation: 'invoice-reconcile' });
    expect(result.files.find((file) => file.path === record?.path)?.text).toContain('code wrote the ask');
  });

  it('reads the outcome from the atoms when no situation declares one: no change, or nothing deleted', () => {
    const copy = structuredClone(input);
    for (const situation of copy.bank.situations) delete situation.touches;
    const result = generateEstateSuite(copy, { paths: HAND_PATHS });
    const byRow = new Map(result.specs.map((record) => [record.row, record]));
    const all = specs(result);
    const workspaceOf = (row: string) => {
      const record = byRow.get(row);
      return record ? only(all, record.id).blocks[0]?.expect?.workspace : undefined;
    };
    expect(byRow.get('p10')).toMatchObject({ testType: 'outside_trigger', outcome: 'no-change:negative' });
    expect(workspaceOf('p10')).toEqual({ others_untouched: true });
    expect(byRow.get('p19')).toMatchObject({ testType: 'guard_positive', outcome: 'no-change:guard' });
    expect(byRow.get('p17')).toMatchObject({ testType: 'contract_alone' });
    const sources = new Set(result.specs.map((record) => record.outcome));
    expect(sources).toContain('no-delete');
    for (const record of result.specs.filter((entry) => entry.outcome === 'no-delete')) {
      expect(only(all, record.id).blocks[0]?.expect?.workspace, record.id).toEqual({ deleted: [] });
    }
    for (const record of result.specs.filter((entry) => entry.outcome.startsWith('no-change'))) {
      expect(only(all, record.id).blocks[0]?.expect?.workspace, record.id).toEqual({
        others_untouched: true,
      });
    }
    expect(result.specs.some((record) => record.markers.includes(MARKERS.outcome))).toBe(false);
    const strict = generateEstateSuite(copy, { paths: HAND_PATHS, fallback: false });
    expect(strict.specs.filter((record) => record.markers.includes(MARKERS.outcome)).length).toBeGreaterThan(
      10,
    );
  });

  it('names a block that checks nothing when no other gap explains it', () => {
    const copy = structuredClone(input);
    const helper = copy.map.atoms.find((atom) => atom.id === 'subagent.route-planner.helper-route-planner');
    if (helper) helper.evidence = [{ type: 'text', must: ['route'] }];
    const result = generateEstateSuite(copy, { paths: HAND_PATHS });
    const record = result.specs.find((spec) => spec.row === 'p18');
    // The words are checked on the first reply; the resume block has nothing of its own to check.
    expect(record?.markers).toEqual([MARKERS.noThen]);
    expect(result.report.gaps.find((entry) => entry.marker === MARKERS.noThen)?.details).toEqual([
      'block resume checks nothing',
    ]);
  });

  it('leaves a proposed row waiting, and writes nothing for it', () => {
    const copy = structuredClone(input);
    const row = copy.plan.rows.find((entry) => entry.id === 'p05');
    if (row) row.status = 'proposed';
    const result = generateEstateSuite(copy, { paths: HAND_PATHS });
    expect(result.report.waiting).toEqual(['p05']);
    expect(result.specs.some((spec) => spec.row === 'p05')).toBe(false);
  });

  it('finds no situation whose pinned cell value disagrees with the row', () => {
    const stop = {
      atomIds: ['instruction.standing.on-stop-stop-all-work-and'],
      cell: { owner_signal: 'go' },
    };
    expect(findSituation(input.bank, 'trigger', stop)).toBeUndefined();
    expect(findSituation(input.bank, 'trigger', { ...stop, cell: { owner_signal: 'stop' } })?.id).toBe(
      'stop-word',
    );
  });
});

describe('the record and the seed', () => {
  let input: EstateGenerateInput;
  beforeAll(async () => {
    input = await fixtureInputs();
  });

  it('records atoms, plan row, cell, seeder, seed and map hash on every spec', () => {
    const result = generateEstateSuite(input, { seed: 7, paths: HAND_PATHS });
    const rows = new Map(input.plan.rows.map((row) => [row.id, row]));
    const atoms = new Map(input.map.atoms.map((atom) => [atom.id, atom]));
    const owners = estateOwners(input.map.atoms, input.map.edges);
    for (const spec of specs(result).values()) {
      const record = estate(spec);
      const row = rows.get(String(record.planRow));
      expect(row, spec.id).toBeDefined();
      expect(record).toMatchObject({
        atoms: taskAtoms(
          (row?.atomIds ?? []).map((id) => {
            const atom = atoms.get(id);
            if (!atom) throw new Error(`missing atom ${id}`);
            return atom;
          }),
          atoms,
          owners,
        ).map((atom) => atom.id),
        planRow: row?.id,
        cell: row?.cell,
        seeder: 'estate',
        seed: 7,
        mapHash: input.map.hash,
        testType: row?.testType,
        mode: row?.mode,
      });
    }
  });

  it('gives byte-identical files for the same inputs and seed', () => {
    const first = generateEstateSuite(input, { seed: 3, paths: HAND_PATHS });
    const second = generateEstateSuite(structuredClone(input), { seed: 3, paths: HAND_PATHS });
    expect(second.files).toEqual(first.files);
  });

  it('draws other phrases with another seed, over the same specs', () => {
    const one = generateEstateSuite(input, { seed: 1, paths: HAND_PATHS });
    const two = generateEstateSuite(input, { seed: 2, paths: HAND_PATHS });
    expect(two.files.map((file) => file.path)).toEqual(one.files.map((file) => file.path));
    const asks = (result: EstateGenerateResult) =>
      [...specs(result).values()].map(
        (spec) => (spec.blocks[0]?.when as { user?: string } | undefined)?.user,
      );
    const changed = asks(one).filter((ask, index) => ask !== asks(two)[index]);
    expect(changed.length).toBeGreaterThan(0);
    // A replay spec asks with its session's recorded ask, whatever the seed.
    expect(asks(two).filter((_, index) => [...specs(two).keys()][index]?.includes('.weekly-'))).toEqual(
      Array(12).fill("Add the late shipment count to this week's report, reports/2026-W41.md."),
    );
  }, 60_000);
});

describe('the committed suite', () => {
  it("reads the planner's plan with every row approved and nothing else changed", async () => {
    const planner = (await readFile(PLANNER_PLAN, 'utf8')).split('\n');
    const approved = (await readFile(APPROVED_PLAN, 'utf8')).split('\n');
    // Three lines of note, then the planner's file with each status flipped to approved.
    expect(approved.slice(3)).toEqual(
      planner.map((line) =>
        line.startsWith('  - {') ? line.replace('status: proposed', 'status: approved') : line,
      ),
    );
    expect(approved.filter((line) => line.startsWith('  - {'))).toHaveLength(1569);
    expect(approved.filter((line) => line.startsWith('  - {') && !line.includes('status: approved'))).toEqual(
      [],
    );
  });

  it("matches the complete byte snapshot for the planner's plan, seed 1", async () => {
    const result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), { paths: PLANNER_PATHS });
    const committed = await tree(FIXTURE_GENERATED);
    expect(Object.keys(committed).sort()).toEqual(result.files.map((file) => file.path).sort());
    for (const file of result.files) expect(committed[file.path], file.path).toBe(file.text);
    expect(result.report.summary).toEqual({
      specs: 1562,
      blocks: 1557,
      complete: 1542,
      incomplete: 20,
      judged: 465,
    });
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
  }, 120_000);
});

describe('domain predicates judged from the rule own words', () => {
  it('tags each judged spec, gates its criterion, and leaves the predicate a gap with no judge', async () => {
    const input = await fixtureInputs(APPROVED_PLAN);
    const result = generateEstateSuite(input, { paths: PLANNER_PATHS });
    const all = specs(result);
    const judged = specRecords(result).filter((record) => record.complete && record.judged.length > 0);
    expect(judged.length).toBe(result.report.sources.judged);
    expect(judged.length).toBeGreaterThan(150);
    for (const record of judged) {
      const spec = only(all, record.id);
      expect(spec.tags, record.id).toContain('judged');
      expect(estate(spec).judged, record.id).toEqual(record.judged);
      const names = (spec.criteria ?? [])
        .filter((criterion) => criterion.gating)
        .map((criterion) => criterion.name);
      expect(names.length, record.id).toBeGreaterThan(0);
      for (const name of names) expect(spec.blocks[0]?.expect?.criteria, record.id).toContain(name);
    }
    const holiday = judged.find((record) =>
      record.judged.includes('instruction.route-planner.no-delivery-planned-on-a-public'),
    );
    const rubric = only(all, holiday?.id ?? '').criteria?.[0]?.rubric;
    expect(rubric).toContain('"Never plan a delivery on a public holiday in the receiving country."');

    const strict = generateEstateSuite(input, { paths: PLANNER_PATHS, judge: false });
    expect(strict.report.sources.judged).toBe(0);
    const gaps = strict.report.gaps.find((entry) => entry.marker === MARKERS.registered)?.specs ?? 0;
    expect(gaps).toBeGreaterThan(200);
  }, 120_000);
});

describe('a live guard_positive row forces the act', () => {
  let result: EstateGenerateResult;
  let byId: Map<string, Spec>;
  beforeAll(async () => {
    result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), { paths: PLANNER_PATHS });
    byId = specs(result);
  }, 120_000);

  it('asks in a forced situation, whose phrase instructs the guarded act itself', () => {
    expect(SITUATION_OF.guard_positive).toBe('trigger');
    const live = specRecords(result).filter((record) => {
      const meta = estate(only(byId, record.id));
      return meta.testType === 'guard_positive' && meta.mode === 'live';
    });
    expect(live.length).toBeGreaterThan(0);
    for (const record of live.filter((entry) => entry.complete && entry.ask === 'bank')) {
      const meta = estate(only(byId, record.id));
      expect(['forced-push', 'forced-long-reply'], record.id).toContain(meta.situation);
      const when = only(byId, record.id).blocks[0]?.when as { user?: string };
      if (meta.situation === 'forced-push') expect(when.user, record.id).toContain('git push --force');
    }
    expect(live.filter((entry) => entry.complete && entry.ask === 'bank').length).toBeGreaterThan(0);
  });

  it('asks a live guard_positive row with no forced situation by code, the guarded act itself, never in a trigger one', () => {
    for (const record of specRecords(result)) {
      const meta = estate(only(byId, record.id));
      if (meta.testType !== 'guard_positive' || meta.mode !== 'live') continue;
      if (meta.situation === 'forced-push' || meta.situation === 'forced-long-reply') continue;
      expect(meta.situation, record.id).toBeNull();
      // The ask is the act of the tool the guard watches. A guard that watches no tool (a prompt guard) has no
      // act an owner asks for: its row waits for an approved phrase, under its own gap.
      if (record.complete) expect(meta.ask, record.id).toBe('code');
      else
        expect(
          (meta.needs as Array<{ marker: string }>).map((need) => need.marker),
          record.id,
        ).toContain(MARKERS.askable);
    }
    // The live row: the replay row of the same guard takes the ask of its recorded session.
    const ledger = result.specs.find(
      (record) =>
        record.testType === 'guard_positive' &&
        record.atoms[0] === 'guard.settings.posttooluse-bash-guard-ledger-guard-py' &&
        estate(only(byId, record.id)).mode === 'live',
    );
    const when = ledger ? (only(byId, ledger.id).blocks[0]?.when as { user?: string }) : undefined;
    expect(when?.user).toBe('Please delete a file under ledger/.');
  });

  it('leaves a live guard_positive row with no forced situation incomplete with no fallback', async () => {
    const strict = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), {
      paths: PLANNER_PATHS,
      fallback: false,
    });
    const all = specs(strict);
    for (const record of specRecords(strict)) {
      const meta = estate(only(all, record.id));
      if (meta.testType !== 'guard_positive' || meta.mode !== 'live') continue;
      if (meta.situation !== 'forced-push' && meta.situation !== 'forced-long-reply') {
        expect(record.complete, record.id).toBe(false);
        const needs = (meta.needs as Array<{ marker: string }>).map((need) => need.marker);
        expect(needs, record.id).toContain(MARKERS.phrase);
      }
    }
  }, 120_000);
});

describe('focus atoms get at least five complete specs, each with its own ask or situation', () => {
  const FOCUS = [
    'reference.invoice-reconcile.read-references-matching-rules-md',
    'script.invoice-reconcile.script-scripts-reconcile-py',
    'route.standing.an-ask-to-reconcile-an-invoice',
    'hazard.standing.recover-from-a-compaction-of-the',
    'tool.settings.allow-read',
    'gate.standing.read-a-file-before-editing-it',
    'subagent.route-planner.helper-route-planner',
    'guard.settings.posttooluse-bash-guard-ledger-guard-py',
  ];

  it('adds variants of the focus atoms rows until five complete specs name each', async () => {
    const result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), {
      paths: PLANNER_PATHS,
      focus: FOCUS,
    });
    const all = specs(result);
    for (const atom of FOCUS) {
      const done = specRecords(result).filter((record) => record.complete && record.atoms.includes(atom));
      expect(done.length, atom).toBeGreaterThanOrEqual(5);
      const variants = done.map((record) => {
        const spec = only(all, record.id);
        return JSON.stringify([spec.blocks[0]?.when, estate(spec).cell]);
      });
      // At least five complete specs whose ask and situation differ (journeys may share an ask: their paths differ).
      expect(new Set(variants).size, atom).toBeGreaterThanOrEqual(5);
    }
    const variant = specRecords(result).find((record) => /\.v\d+$/.test(record.id));
    const meta = estate(only(all, variant?.id ?? ''));
    expect(meta.focusVariant).toBeGreaterThan(0);
    expect(meta.planRow).toBe(variant?.row);
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
  }, 120_000);

  it('writes no variant without a focus list', async () => {
    const result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), { paths: PLANNER_PATHS });
    expect(result.specs.some((record) => /\.v\d+$/.test(record.id))).toBe(false);
  }, 120_000);
});

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[relative(dir, full).split('\\').join('/')] = await readFile(full, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type evidence,
  ObjectStore,
  objectRegistry,
  parseObjectText,
  parseSpecText,
  type RunResult,
  runCampaignDiagnostics,
  runDiagnostics,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../../../cli/src/index';
import { blame } from '../../src';

/**
 * code-agent-liability on the Northwind fixture's recorded sessions (codeagent_equivalence_blame.md F5, F8c). The
 * replay specs are generated from the hand plan the estate tests use, replayed offline over the three recorded
 * sessions into a store, and the stored failing blocks are diagnosed. No model call and no agent run: F5's
 * confirm runs are the note's constructed stand-in outcome (the reference loads weekly-report 0 of 3).
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const SESSIONS = join(FIXTURE, 'sessions');
const NAMES = ['weekly-clean', 'weekly-skill-skipped', 'weekly-gate-violated'];

async function cli(argv: string[]) {
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
  const code = await main(argv, io);
  return { code, ...output };
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

type Stored = { run: RunResult; spec: Spec; path: string };

describe('code-agent-liability on the Northwind recorded sessions', () => {
  const stored = new Map<string, Stored>();
  let planRows: Array<{ id: string } & NonNullable<evidence.EvidenceInput['planRows']>[number]> = [];

  beforeAll(async () => {
    planRows = (
      parseObjectText(
        await readFile(join(ROOT, 'packages/generate/test/estate/fixtures/plan.yaml'), 'utf8'),
        'plan.yaml',
      ).raw as { rows: typeof planRows }
    ).rows;
    const out = await mkdtemp(join(tmpdir(), 'blame-northwind-'));
    const generated = await cli([
      'estate',
      'generate',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      join(ROOT, 'packages/generate/test/estate/fixtures/plan.yaml'),
      '--out',
      out,
    ]);
    expect(generated.err).toBe('');
    const db = join(out, 'runs.db');
    const replay = await cli([
      'replay',
      ...NAMES.map((name) => join(SESSIONS, `${name}.jsonl`)),
      '--decisions',
      ...NAMES.map((name) => join(SESSIONS, `${name}.decisions.jsonl`)),
      '--steps',
      ...NAMES.map((name) => join(SESSIONS, `${name}.steps.jsonl`)),
      '--suite',
      join(out, 'specs/replay'),
      '--store',
      db,
      '--json',
    ]);
    expect(replay.code).toBe(1);
    const specs = new Map<string, { spec: Spec; path: string }>();
    for (const path of await walk(join(out, 'specs/replay'))) {
      const loaded = parseSpecText(await readFile(path, 'utf8'), 'yaml', path);
      if (loaded.ok) specs.set(loaded.spec.id, { spec: loaded.spec, path });
    }
    const store = await openStore(db);
    for (const run of await store.listRuns()) {
      const spec = specs.get(run.specId);
      const session = (spec?.spec.metadata as { estate?: { session?: string } } | undefined)?.estate?.session;
      if (spec && session) stored.set(`${run.specId}|${session}`, { run, ...spec });
    }
    await store.close();
  }, 120_000);

  function diagnose(key: string, confirm?: Record<string, { runs: number; reference_loads: number }>) {
    const entry = stored.get(key);
    if (!entry) throw new Error(`no stored run ${key}; have ${[...stored.keys()].join(', ')}`);
    const block = entry.run.blocks[0];
    if (!block) throw new Error('no block');
    const specBlock = entry.spec.blocks[0];
    const result = blame.diagnoseBlock({
      verdicts: block.verdicts,
      evidenceFor: blame.blockEvidenceInputs({
        observed: block.observed,
        verdicts: block.verdicts,
        ...(specBlock?.expect === undefined ? {} : { expect: specBlock.expect }),
        spec: entry.spec,
        planRows: planRows.filter(
          (row) => row.id === (entry.spec.metadata as { estate?: { planRow?: string } })?.estate?.planRow,
        ),
        specPath: entry.path,
        ...(confirm === undefined ? {} : { confirm }),
      }),
      blame: blame.shippedPolicy('policy/blame'),
      placement: blame.shippedPolicy('policy/placement'),
    });
    return { result, block };
  }

  it('F8c: the guard caught the edit before the read; the agent, no fix needed, enforced', () => {
    const { result, block } = diagnose('estate.p02.weekly-gate-violated|weekly-gate-violated');
    expect(block.pass).toBe(false);
    const [diagnosis] = result.diagnoses;
    expect(diagnosis).toMatchObject({
      verdict_ref: 'custom.ordered.Read.Edit',
      item: 'core_rule_caught',
      disposition: 'agent',
      fault: ['agent'],
      fix_location: 'none',
      fix_action: 'none_enforced',
    });
    expect(diagnosis?.placement).toMatch(/^policy\/placement:default@[0-9a-f]{8}#fixed$/);
    expect(diagnosis?.evidence.guard_caught).toBe(true);
    expect(block.pass).toBe(false);
  });

  it('p01 checks the desired load obligation without asserting coverage of the update ask', async () => {
    expect(planRows.find((row) => row.id === 'p01')?.testType).toBe('obligation');
    const entry = stored.get('estate.p01.weekly-skill-skipped|weekly-skill-skipped');
    expect(entry?.spec.blocks[0]?.when).toEqual({
      user: "Add the late shipment count to this week's report, reports/2026-W41.md.",
    });
    const skill = await readFile(join(FIXTURE, '.claude/skills/weekly-report/SKILL.md'), 'utf8');
    expect(skill).toContain(
      'description: Prepare the weekly operations report from the ledger and the shipment log. Use when the user asks for the weekly report or a summary of last week.',
    );
  });

  it('F5 p01: coverage is unknown before confirmation, with the actual obligation row supplied', () => {
    const { result, block } = diagnose('estate.p01.weekly-skill-skipped|weekly-skill-skipped');
    expect(block.pass).toBe(false);
    expect(result.diagnoses[0]).toMatchObject({
      verdict_ref: 'skills.weekly-report',
      item: 'skill_not_loaded_undecided',
      disposition: 'shared',
      confidence: 'undecided',
    });
    expect(result.diagnoses[0]?.evidence.skill_covers).toBe('unknown');
  });

  it('F5 p01: zero reference loads confirms the design note uncovered/setup/skill.trigger case', () => {
    const { result } = diagnose('estate.p01.weekly-skill-skipped|weekly-skill-skipped', {
      'skills.weekly-report': { runs: 3, reference_loads: 0 },
    });
    expect(result.diagnoses[0]).toMatchObject({
      item: 'skill_not_loaded_uncovered',
      disposition: 'setup',
      fault: ['skill'],
      fix_location: 'skill.trigger',
      fix_action: 'rewrite_description',
    });
    expect(result.diagnoses[0]?.evidence.skill_covers).toBe('not_covered');
  });

  it('F5 contrast: three reference loads confirms covered and an agent fault', () => {
    const { result } = diagnose('estate.p01.weekly-skill-skipped|weekly-skill-skipped', {
      'skills.weekly-report': { runs: 3, reference_loads: 3 },
    });
    expect(result.diagnoses[0]).toMatchObject({ item: 'skill_not_loaded_covered', disposition: 'agent' });
    expect(result.diagnoses[0]?.evidence.skill_covers).toBe('covered');
  });

  it('runs p01 through real F5 block and campaign steps with its stored identity', async () => {
    const entry = stored.get('estate.p01.weekly-skill-skipped|weekly-skill-skipped');
    if (!entry) throw new Error('missing p01');
    const block = entry.run.blocks[0];
    const specBlock = entry.spec.blocks[0];
    if (!block || !specBlock) throw new Error('missing p01 block');
    const store = new ObjectStore(objectRegistry);
    const { diagnoses } = await runDiagnostics([store.resolve('diagnostic', 'code-agent-liability')], {
      check: {
        spec: entry.spec,
        block: specBlock,
        expect: specBlock.expect ?? {},
        observed: block.observed,
        mode: entry.run.mode,
        blockIndex: block.index,
        given: {
          prefix: [],
          ledger: {},
          world: {},
          vars: {},
          target: entry.run.target,
          hash: block.givenHash,
        },
        history: [],
        ledger: {},
      },
      verdicts: block.verdicts,
      objects: [],
    });
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]).toMatchObject({
      disposition: 'shared',
      confidence: 'undecided',
      fixLocation: 'skill.trigger',
      by: { item: 'skill_not_loaded_undecided' },
      via: { item: 'place' },
      evidence: { skill_covers: 'unknown' },
    });
    const diagnosed = { ...entry.run, blocks: [{ ...block, diagnoses }] };
    const result = await runCampaignDiagnostics(
      ['fix-plan', 'liability-confirm'].map((id) => store.resolve('diagnostic', id)),
      [diagnosed],
    );
    expect(result.skippedForBudget).toBe(1);
    expect(result.diagnoses.find((one) => one.step === 'rank')).toMatchObject({
      fixLocation: 'skill.trigger',
      score: 1,
      evidence: { blocks: 1 },
    });
    const plan = result.diagnoses.find((one) => one.step === 'plan')?.evidence?.plan;
    expect(plan).toEqual([
      expect.objectContaining({
        block: `${entry.run.runId}:${block.index}`,
        verdict_ref: 'skills.weekly-report',
        kind: 'reference_load',
      }),
    ]);
    expect(result.diagnoses.every((one) => !/undefined|schema refuses|step threw/.test(one.summary))).toBe(
      true,
    );
    expect(entry.run.blocks[0]?.pass).toBe(false);
  });

  it('writes nothing on the clean session, which passes', () => {
    const entry = stored.get('estate.p01.weekly-clean|weekly-clean');
    expect(entry?.run.blocks[0]?.pass).toBe(true);
    const { result } = diagnose('estate.p01.weekly-clean|weekly-clean');
    expect(result.diagnoses).toEqual([]);
  });
});

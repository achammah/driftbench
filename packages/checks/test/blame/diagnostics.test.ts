import { readFileSync } from 'node:fs';
import {
  BUILTIN_KINDS,
  type CampaignDiagnosis,
  Diagnosis,
  evidence,
  ObjectRegistry,
  ObjectStore,
  type ResolvedObject,
  type RunResult,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blame } from '../../src';
import { f7, SKILL, verdict, WORKED_CASES, type WorkedCase } from '../fixtures/blame/cases';

/**
 * The five shipped diagnostics as files with their steps: code-agent-liability, fix-plan, liability-confirm,
 * value-mismatch and flaky-block. The steps run here through a small runner with the semantics of the block
 * framework's F5 runner (enabled steps in order; a `run` step only while the budget lasts, else counted as
 * skipped for budget).
 */

/** A registry whose diagnostic kind declares the fields the diagnostic files hold, as F5 does. */
function registry(): ObjectRegistry {
  const out = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) {
    out.registerKind(kind);
  }
  return blame.registerBlameObjects(out);
}

/** The F5 runner's loop, for a campaign diagnostic. */
async function runCampaign(
  object: ResolvedObject,
  ctx: Omit<blame.CampaignStepContext, 'params' | 'earlier'>,
  budget = 0,
): Promise<{ outputs: Array<blame.StepOutput & { step: string }>; skippedForBudget: number }> {
  const earlier: Array<blame.StepOutput & { step: string }> = [];
  let left = budget;
  let skippedForBudget = 0;
  for (const item of object.items) {
    if (!item.enabled) continue;
    const step = blame.CAMPAIGN_STEPS[item.impl];
    if (!step) throw new Error(`no step ${item.impl}`);
    if (step.cost !== 'static') {
      if (left <= 0) {
        skippedForBudget += 1;
        continue;
      }
      left -= 1;
    }
    const out = await step.run({ ...ctx, params: item.params, earlier });
    for (const one of out ?? []) earlier.push({ ...one, step: item.id });
  }
  return { outputs: earlier, skippedForBudget };
}

/** The campaign diagnoses of worked cases: each case one block, diagnosed with the shipped files. */
function campaign(cases: Array<{ block: string; one: WorkedCase }>): blame.CampaignDiagnosis[] {
  return cases.flatMap(({ block, one }) =>
    blame
      .diagnoseBlock({
        verdicts: one.verdicts,
        evidenceFor: one.input,
        blame: blame.shippedPolicy('policy/blame'),
        placement: blame.shippedPolicy('policy/placement'),
      })
      .diagnoses.map((diagnosis) => ({ ...diagnosis, block })),
  );
}

/** Core envelopes for direct-library service tests; the real runner is covered in f5-campaign.test.ts. */
function identified(diagnoses: blame.CampaignDiagnosis[]): CampaignDiagnosis[] {
  return diagnoses.map((one) => ({
    runId: one.block,
    blockIndex: 0,
    verdictRef: one.verdict_ref,
    diagnosis: Diagnosis.parse({ ...blame.toStepOutput(one), diagnostic: one.diagnostic }),
  }));
}

/** F7 over a campaign: the forced currency pointer skipped in two invoice blocks, the language pointer in two supplier blocks. */
function f7Campaign(): blame.CampaignDiagnosis[] {
  const invoice = f7(1);
  const supplier = f7(1);
  const supplierCase: WorkedCase = {
    ...supplier,
    input: (one) => {
      const base = supplier.input(one);
      const pointer = {
        id: 'reference.supplier-email.read-claude-memory-supplier-languages-md',
        kind: 'reference',
        provenance: { file: '.claude/skills/supplier-email/SKILL.md', startLine: 8 },
        fields: {
          path: '.claude/memory/supplier-languages.md',
          exists: true,
          from: '.claude/skills/supplier-email/SKILL.md',
        },
      };
      const observed = {
        ...base.block.observed,
        toolCalls: [
          { label: 'Read', input: { file_path: SKILL('supplier-email') }, output: '# supplier-email' },
        ],
      };
      return {
        ...base,
        block: { ...base.block, observed },
        expect: { skills: ['supplier-email'] },
        ruleAtoms: [pointer.id],
        atoms: [pointer],
      };
    },
  };
  return campaign([
    { block: 'invoice-usd-1', one: { ...invoice, history: [] } },
    { block: 'invoice-usd-2', one: { ...invoice, history: [] } },
    { block: 'supplier-tailspin-1', one: { ...supplierCase, history: [] } },
    { block: 'supplier-tailspin-2', one: { ...supplierCase, history: [] } },
  ]);
}

describe('the shipped diagnostic files', () => {
  it('resolve with every step registered, once the diagnostic kind declares its fields', () => {
    const store = new ObjectStore(registry());
    for (const id of [
      'code-agent-liability',
      'fix-plan',
      'liability-confirm',
      'value-mismatch',
      'flaky-block',
    ]) {
      const object = store.resolve('diagnostic', id);
      expect(object.items.length, id).toBeGreaterThan(0);
      for (const item of object.items)
        expect(blame.blameStepNames(), `${id}#${item.id}`).toContain(item.impl);
    }
    const liability = store.resolve('diagnostic', 'code-agent-liability');
    expect(liability.fields.scope).toBe('block');
    expect(liability.items.map((item) => item.id)).toEqual(['chain', 'evidence', 'attribute', 'place']);
  });

  it('resolves diagnostics with the real core kind', () => {
    const plain = new ObjectRegistry();
    for (const kind of BUILTIN_KINDS) plain.registerKind(kind);
    blame.registerBlameObjects(plain);
    expect(blame.diagnosticKindReady(plain)).toBe(true);
    expect(() => new ObjectStore(plain).resolve('policy/blame', 'default')).not.toThrow();
    expect(new ObjectStore(plain).resolve('diagnostic', 'fix-plan').items.length).toBeGreaterThan(0);
  });
});

describe('fix-plan', () => {
  it('ranks the F7 core fix above the two local rewrites, and lists them for removal', () => {
    const plan = blame.fixPlan(f7Campaign(), blame.shippedPolicy('policy/placement'));
    const [first, ...rest] = plan.fixes;
    expect(first).toMatchObject({
      fix_location: 'agent.skill_reading',
      fix_target: 'core:Skill use',
      fix_action: 'strengthen_ref',
      blocks: 4,
      agent_blocks: 4,
      remove_copies: [
        'skill:invoice-reconcile#.claude/skills/invoice-reconcile/SKILL.md:10',
        'skill:supplier-email#.claude/skills/supplier-email/SKILL.md:8',
      ],
    });
    expect(first?.rule_text).toBe(
      'In a loaded skill, read every file its body tells you to read for the current situation, before acting.',
    );
    const locals = rest.filter((fix) => fix.superseded_by === first?.id);
    expect(locals.map((fix) => fix.fix_target)).toEqual([
      'skill:invoice-reconcile#.claude/skills/invoice-reconcile/SKILL.md:10',
      'skill:supplier-email#.claude/skills/supplier-email/SKILL.md:8',
    ]);
    expect(plan.fixes.indexOf(first as blame.Fix)).toBeLessThan(plan.fixes.indexOf(locals[0] as blame.Fix));
  });

  it('keeps the fix local at one home', () => {
    const one = blame.fixPlan(
      f7Campaign().filter((d) => d.block.startsWith('invoice')),
      blame.shippedPolicy('policy/placement'),
    );
    expect(one.fixes).toHaveLength(1);
    expect(one.fixes[0]).toMatchObject({ fix_location: 'skill.layout', blocks: 2, remove_copies: [] });
  });

  it('runs as the shipped file: the ranked list is the rank step output', async () => {
    const object = new ObjectStore(registry()).resolve('diagnostic', 'fix-plan');
    const { outputs } = await runCampaign(object, {
      runs: [],
      diagnoses: identified(f7Campaign()),
      objects: [],
    });
    expect(outputs[0]).toMatchObject({ step: 'rank', fixLocation: 'agent.skill_reading', score: 4 });
    expect(outputs[0]?.removeCopies).toHaveLength(2);
  });
});

describe('liability-confirm', () => {
  const f4 = WORKED_CASES.find((c) => c.name.startsWith('F4 static')) as WorkedCase;

  it('at budget 0 runs nothing, counts the run step as skipped, and marks the open diagnoses static', async () => {
    const object = new ObjectStore(registry()).resolve('diagnostic', 'liability-confirm');
    const diagnoses = campaign([{ block: 'invoice-short', one: f4 }]);
    let called = 0;
    const { outputs, skippedForBudget } = await runCampaign(object, {
      runs: [],
      diagnoses: identified(diagnoses),
      objects: [],
      confirmRunner: () => {
        called += 1;
        return { passes: 3, costUsd: 0 };
      },
    });
    expect(called).toBe(0);
    expect(skippedForBudget).toBe(1);
    const rejudge = outputs.filter((one) => one.step === 'rejudge');
    expect(rejudge).toHaveLength(1);
    expect(rejudge[0]).toMatchObject({
      verdictRef: 'must.short-delivery',
      confidence: 'static',
      flags: ['static'],
    });
  });

  it('runConfirm with no runner makes no run and says why', async () => {
    const plan = blame.planConfirm(campaign([{ block: 'invoice-short', one: f4 }]));
    expect(plan.map((one) => one.kind)).toEqual(['hint', 'reference']);
    const result = await blame.runConfirm(plan, { budgetUsd: 0 });
    expect(result).toMatchObject({ runs_made: 0, cost_usd: 0, skipped_for_budget: 6 });
    expect(result.reason).toMatch(/stays static/);
  });

  it('with a free stand-in it runs 3 of 3 and the rerun flips F4 from agent to setup', async () => {
    const object = new ObjectStore(registry()).resolve('diagnostic', 'liability-confirm');
    const diagnoses = campaign([{ block: 'invoice-short', one: f4 }]);
    const { outputs } = await runCampaign(
      object,
      {
        runs: [],
        diagnoses: identified(diagnoses),
        objects: [],
        confirmFree: true,
        // The stand-in: the hint run passes 3 of 3, the reference without the hint 0 of 3 (F4, constructed).
        confirmRunner: (run) => ({ passes: run.kind === 'hint' ? 3 : 0, costUsd: 0 }),
        rediagnose: (_block, confirm) =>
          blame.diagnoseBlock({
            verdicts: f4.verdicts,
            evidenceFor: (one) => ({
              ...f4.input(one),
              ...(confirm[one.id] ? { confirm: confirm[one.id] } : {}),
            }),
            blame: blame.shippedPolicy('policy/blame'),
            placement: blame.shippedPolicy('policy/placement'),
          }).diagnoses,
      },
      1,
    );
    const run = outputs.find((one) => one.step === 'run');
    expect(run?.evidence).toMatchObject({ runs_made: 6, cost_usd: 0 });
    const rejudged = outputs.filter((one) => one.step === 'rejudge');
    expect(rejudged[0]).toMatchObject({
      disposition: 'setup',
      fixLocation: 'skill.content',
      confidence: 'confirmed',
    });
    expect(rejudged[0]?.flags).toContain('changed_from:R2b:agent');
  });

  it("validates a fix on behaviour: R6's fix removes the wording, not the run with no call (HF9 b)", () => {
    const data = JSON.parse(
      readFileSync(new URL('../fixtures/blame/hf9-r6.json', import.meta.url), 'utf8'),
    ) as Record<'base1' | 'prompt', blame.FixRun[]>;
    const check = blame.checkFixRemoval('R6', data.base1, data.prompt);
    expect(check.wording).toBe(1);
    expect(check.behaviour).toBeCloseTo(0.15, 10);
    expect(check.confirmed).toBe(false);
    expect(check.flags).toEqual(['removes_wording_not_behaviour']);
  });
});

describe('block evidence handoff', () => {
  it('uses the generated plan row without requiring a caller to supply it twice', () => {
    const one = f7(1);
    const v = verdict('skills.weekly-report');
    const given = blame.blockEvidenceInputs({
      observed: one.input(v).block.observed,
      verdicts: [v],
      spec: {
        metadata: {
          estate: {
            planRow: 'p01',
            testType: 'route_positive',
            atoms: ['route.weekly-report.an-ask-that-fits-weekly-report'],
          },
        },
      },
      confirm: { [v.id]: { runs: 3, reference_loads: 0 } },
    })(v);
    expect(evidence.computeEvidence(given, ['skill_covers']).skill_covers).toBe('covered');
  });
  it('retains the deciding blame item stamp through the diagnostic step handoff', () => {
    const one = f7(1);
    const diagnosis = blame.diagnoseBlock({
      verdicts: one.verdicts,
      evidenceFor: one.input,
      blame: blame.shippedPolicy('policy/blame'),
      placement: blame.shippedPolicy('policy/placement'),
    }).diagnoses[0];
    if (!diagnosis) throw new Error('missing diagnosis');
    expect(blame.toStepOutput(diagnosis).by).toEqual(diagnosis.by);
    expect(blame.toStepOutput(diagnosis).by?.item).toBe('skill_reference_forced_unread');
  });
});

describe('value-mismatch', () => {
  it('attributes a failing tool input from the value check record, with no pending lint', async () => {
    const object = new ObjectStore(registry()).resolve('diagnostic', 'value-mismatch');
    const v = {
      ...verdict('tools.coverage.check.input.address', { name: 'tools' }),
      valueCheck: [{ call: 1, path: 'address', rung: 'rung2b_as_given', outcome: 'fail' as const }],
    };
    const ctx = {
      check: {
        observed: {
          segments: [],
          text: 'Could you give the street number, street name and town again?',
          toolCalls: [
            {
              label: 'coverage.check',
              input: { address: '88 Summit Ave, Acmeville' },
              output: { found: false },
            },
          ],
          cost: {},
          latencyMs: 0,
        },
        expect: { tools: [{ label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } }] },
        spec: { metadata: {} },
        block: { when: { user: 'Please check 88 Summit Avenue, Acmeville' } },
      },
      verdicts: [v],
      objects: [],
      history: [],
    } as unknown as Omit<blame.BlockStepContext, 'params' | 'earlier'>;
    const earlier: blame.StepOutput[] = [];
    for (const item of object.items) {
      const step = blame.BLOCK_STEPS[item.impl];
      if (!step) throw new Error(item.impl);
      for (const one of (await step.run({ ...ctx, params: item.params, earlier })) ?? []) earlier.push(one);
    }
    expect(earlier).toHaveLength(1);
    expect(earlier[0]).toMatchObject({ verdictRef: v.id, disposition: 'agent', fault: ['agent'] });
    expect(earlier[0]?.rule).toMatch(/#R2b$/);
    expect(earlier[0]?.flags).not.toContain('lint:value_ladder_unavailable');
  });
});

describe('flaky-block', () => {
  const run = (repeat: number, pass: boolean): RunResult =>
    ({
      runId: `r${repeat}`,
      specId: 'acme-port',
      specHash: 'h',
      target: { adapter: 'function', agent: 'acme' },
      mode: 'F',
      repeat,
      status: 'completed',
      blocks: [
        { index: 0, pass },
        { index: 1, pass: true },
      ],
    }) as unknown as RunResult;

  it('flags a block whose repeats both pass and fail, and not a stable one', async () => {
    const object = new ObjectStore(registry()).resolve('diagnostic', 'flaky-block');
    const { outputs } = await runCampaign(object, {
      runs: [run(0, true), run(1, false), run(2, true)],
      diagnoses: [],
      objects: [],
    });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ flags: ['flaky'], evidence: { block: 0, repeats: 3, passes: 2 } });
  });
});

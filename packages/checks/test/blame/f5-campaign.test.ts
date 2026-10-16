import {
  type CampaignDiagnosis,
  Diagnosis,
  initializeShippedObjects as initializeCoreObjects,
  ObjectStore,
  objectRegistry,
  type RunResult,
  runCampaignDiagnostics,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blame, initializeShippedObjects } from '../../src';
import { f7 } from '../fixtures/blame/cases';

function fixture() {
  initializeShippedObjects();
  // Explicit registration makes the consumer regression independent of the initializer regression.
  blame.registerBlameObjects();
  const one = f7(1);
  const original = blame.diagnoseBlock({
    verdicts: one.verdicts,
    evidenceFor: one.input,
    blame: blame.shippedPolicy('policy/blame'),
    placement: blame.shippedPolicy('policy/placement'),
  }).diagnoses[0];
  if (!original) throw new Error('missing F7 diagnosis');
  const finding = (home: string) =>
    Diagnosis.parse({
      ...blame.toStepOutput({ ...original, home, fix_target: `skill:${home}#pointer` }),
      diagnostic: 'diagnostic:code-agent-liability@12345678',
    });
  const invoice = finding('invoice-reconcile');
  const supplier = finding('supplier-email');
  const { verdictRef: _ref, ...withoutRef } = invoice;
  const runs = ['first', 'second'].map((runId) => ({
    runId,
    // The same verdict id on different blocks and runs must keep distinct identities.
    blocks: [
      { index: 2, verdicts: one.verdicts, diagnoses: [invoice, invoice] },
      { index: 7, verdicts: one.verdicts, diagnoses: [supplier] },
      {
        index: 9,
        verdicts: [],
        diagnoses: [
          withoutRef,
          {
            diagnostic: invoice.diagnostic,
            summary: 'unrelated',
            by: invoice.by,
            confidence: 'static',
          },
        ],
      },
    ],
    // Even a complete blame-shaped run diagnosis must not invent a block.
    diagnoses: [invoice],
  })) as unknown as RunResult[];
  return { runs, invoice };
}

function diagnostic(id: string) {
  return new ObjectStore(objectRegistry).resolve('diagnostic', id);
}

describe('blame with the real F5 campaign runner', () => {
  it('ranks fixes from identified nested diagnoses without schema errors or inflated block counts', async () => {
    const { runs } = fixture();
    const before = JSON.stringify(runs);
    const result = await runCampaignDiagnostics([diagnostic('fix-plan')], runs);
    expect(result.skippedForBudget).toBe(0);
    expect(result.diagnoses).toHaveLength(3);
    expect(result.diagnoses[0]).toMatchObject({
      step: 'rank',
      fixLocation: 'agent.skill_reading',
      fixTarget: 'core:Skill use',
      fixAction: 'strengthen_ref',
      fixForms: ['prose', 'guard'],
      score: 4,
      removeCopies: ['skill:invoice-reconcile#pointer', 'skill:supplier-email#pointer'],
      evidence: { blocks: 4, agent_blocks: 4 },
    });
    expect(result.diagnoses.every((one) => !/schema refuses|step threw|undefined/.test(one.summary))).toBe(
      true,
    );
    expect(JSON.stringify(runs)).toBe(before);
  });

  it('confirms with complete identities at zero budget and stays static without a service', async () => {
    const { runs, invoice } = fixture();
    for (const budget of [0, 1]) {
      const result = await runCampaignDiagnostics([diagnostic('liability-confirm')], runs, { runs: budget });
      expect(result.skippedForBudget).toBe(budget === 0 ? 1 : 0);
      const plan = result.diagnoses.find((one) => one.step === 'plan')?.evidence?.plan;
      expect(plan).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ block: 'first:2', verdict_ref: invoice.verdictRef, kind: 'forced_load' }),
          expect.objectContaining({ block: 'second:7', verdict_ref: invoice.verdictRef, kind: 'hint' }),
        ]),
      );
      const rejudged = result.diagnoses.filter((one) => one.step === 'rejudge');
      expect(new Set(rejudged.map((one) => one.evidence?.block))).toEqual(
        new Set(['first:2', 'first:7', 'second:2', 'second:7']),
      );
      expect(
        rejudged.every((one) => one.verdictRef === invoice.verdictRef && one.confidence === 'static'),
      ).toBe(true);
      expect(result.diagnoses.every((one) => !/schema refuses|step threw|undefined/.test(one.summary))).toBe(
        true,
      );
      if (budget > 0)
        expect(result.diagnoses.find((one) => one.step === 'run')?.evidence).toMatchObject({
          runs_made: 0,
          cost_usd: 0,
        });
    }
  });

  it('uses the core envelope identities and ignores absent block/verdict identity', () => {
    const { invoice } = fixture();
    const envelopes: CampaignDiagnosis[] = [
      { runId: 'r', blockIndex: 0, verdictRef: 'envelope.verdict', diagnosis: invoice },
      { runId: 'r', blockIndex: undefined, verdictRef: invoice.verdictRef, diagnosis: invoice },
      { runId: 'r', blockIndex: 3, verdictRef: undefined, diagnosis: invoice },
    ];
    expect(blame.campaignDiagnoses(envelopes)).toMatchObject([
      { block: 'r:0', verdict_ref: 'envelope.verdict', by: invoice.by },
    ]);
    expect(blame.campaignDiagnoses(envelopes)).toHaveLength(1);
  });

  it('honors an explicitly empty diagnosis list even when runs contain findings', async () => {
    const { runs } = fixture();
    const ctx = { runs, diagnoses: [], objects: [], earlier: [], params: { n: 10, by: [] } };
    expect(await blame.CAMPAIGN_STEPS['builtin:rank/top-n']?.run(ctx)).toEqual([]);
    const plan = await blame.CAMPAIGN_STEPS['builtin:confirm/plan']?.run({ ...ctx, params: { runs: 3 } });
    expect(plan?.[0]?.evidence?.plan).toEqual([]);
  });

  it('initializes all blame objects and executable metadata again after registry restore', () => {
    const saved = objectRegistry.snapshot();
    try {
      initializeCoreObjects();
      const empty = { ...objectRegistry.snapshot(), impls: new Map(), shipped: new Map() };
      for (let attempt = 0; attempt < 2; attempt++) {
        objectRegistry.restore(empty);
        initializeShippedObjects();
        initializeShippedObjects();
        for (const id of [
          'fix-plan',
          'liability-confirm',
          'code-agent-liability',
          'value-mismatch',
          'flaky-block',
        ]) {
          expect(diagnostic(id).items.length).toBeGreaterThan(0);
        }
        expect(new ObjectStore(objectRegistry).resolve('policy/blame', 'default').items.length).toBe(32);
      }
    } finally {
      objectRegistry.restore(saved);
    }
  });
});

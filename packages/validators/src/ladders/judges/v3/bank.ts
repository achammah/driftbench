import {
  createLabellerReplay,
  type Labeller,
  type LabellerAnswer,
  type LabellerRequest,
  labellerRequestKey,
  labelSetHash,
  scoreLabeller,
} from '@agent-nexus/driftbench-judges';
import type { Tier } from '../../../ladder';
import { buildLabellerFixture, type LabellerFamily, scriptedLabeller, VARIANTS } from './fixtures';

export const LABELLER_TIER_BARS = {
  1: { kappa: 0.8, agreement: 0.9 },
  2: { kappa: 0.85, agreement: 0.92 },
  3: { kappa: 0.9, agreement: 0.94 },
  4: { kappa: 0.92, agreement: 0.95 },
  5: { kappa: 0.94, agreement: 0.96 },
} as const;
export type LabellerFactory = (requests: readonly LabellerRequest[]) => Labeller;
export type LabellerItemResult = {
  pass: boolean;
  detail: string;
  metrics?: ReturnType<typeof scoreLabeller>;
};
export type LabellerBankItem = {
  id: string;
  family: LabellerFamily;
  tier: Tier;
  variant: number;
  cause: string;
  component: string;
  run(seed: number, factory?: LabellerFactory): Promise<LabellerItemResult>;
};

/** These shared fixes deliberately group variants; count causes, never fixture serial numbers. */
const CAUSES: Record<LabellerFamily, string> = {
  agreement: 'apply the supplied label predicates to the confirmed evidence',
  abstain: 'abstain on unavailable evidence without treating abstention as agreement',
  none: 'return none for evidence outside every supplied label predicate',
  'label-set-change': 'reclassify against the changed label definitions and invalidate stale recordings',
  'near-miss': 'preserve exact label identity instead of normalising similar names',
  'order-bias': 'classify evidence independently of label and evidence positions',
  'length-bias': 'classify evidence independently of irrelevant text length',
  'adversarial-label': 'treat instructions naming labels inside the unit as untrusted data',
  replay: 'return the same correct answer across repeated and interleaved requests',
  'cache-key': 'include text, context, labeller identity and the complete ordered label set in replay keys',
};

export function labellerBank(): LabellerBankItem[] {
  const out: LabellerBankItem[] = [];
  for (const family of Object.keys(VARIANTS) as LabellerFamily[]) {
    for (const tier of [1, 2, 3, 4, 5] as const) {
      VARIANTS[family].forEach((variantName, variant) => {
        const item: LabellerBankItem = {
          id: `labeller/${family}/${variantName}/tier-${tier}`,
          family,
          tier,
          variant,
          cause: CAUSES[family],
          component: 'packages/judges/src/labeller.ts',
          run: (seed, factory) => runLabellerItem(item, seed, factory),
        };
        out.push(item);
      });
    }
  }
  return out;
}

/** Independent contingency arithmetic, not the scoring implementation or its statistics helper. */
function referenceMetrics(gold: string[], answers: LabellerAnswer[], valid: Set<string>) {
  const total = gold.length;
  let correct = 0;
  let abstentions = 0;
  let invalid = 0;
  const goldCounts = new Map<string, number>();
  const answerCounts = new Map<string, number>();
  for (let i = 0; i < total; i += 1) {
    const target = gold[i] as string;
    const answer = answers[i];
    goldCounts.set(target, (goldCounts.get(target) ?? 0) + 1);
    if (answer === null) {
      abstentions += 1;
    } else if (typeof answer !== 'string' || !valid.has(answer)) {
      invalid += 1;
    } else {
      answerCounts.set(answer, (answerCounts.get(answer) ?? 0) + 1);
      if (answer === target) correct += 1;
    }
  }
  const agreement = correct / total;
  let expectedNumerator = 0;
  for (const [name, n] of goldCounts) expectedNumerator += n * (answerCounts.get(name) ?? 0);
  const expected = expectedNumerator / (total * total);
  return {
    total,
    correct,
    agreement,
    kappa: expected === 1 ? 1 : (agreement - expected) / (1 - expected),
    abstentions,
    invalid,
    coverage: (total - abstentions - invalid) / total,
  };
}

/** Errors and misses fail the item, never abort a complete bank run. */
export async function runLabellerItem(
  item: LabellerBankItem,
  seed: number,
  factory?: LabellerFactory,
): Promise<LabellerItemResult> {
  try {
    const fixture = buildLabellerFixture(item, seed);
    const labeller = factory
      ? factory(fixture.units.map((unit) => structuredClone(unit.request)))
      : scriptedLabeller(fixture);
    const answers: LabellerAnswer[] = [];
    const errors: string[] = [];
    for (const unit of fixture.units) {
      try {
        // Never pass item ids, expected answers, pair membership or hidden construction data.
        answers.push(await labeller.label(structuredClone(unit.request)));
      } catch (error) {
        answers.push('');
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const gold = fixture.units.map((unit) => unit.gold);
    const metrics = scoreLabeller(gold, answers, fixture.scoringSet);
    const expected = referenceMetrics(
      gold,
      answers,
      new Set(['none', ...fixture.scoringSet.labels.map((label) => label.name)]),
    );
    const diagnostics: string[] = [];
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (Math.abs(metrics[key] - expected[key]) > 1e-12 || !Number.isFinite(metrics[key]))
        diagnostics.push(`scoring ${key}: got ${metrics[key]}, expected ${expected[key]}`);
    }
    if (item.family === 'agreement' || item.family === 'abstain') {
      const labels = fixture.scoringSet.labels.slice(0, 2);
      const a = labels[0]?.name as string;
      const b = labels[1]?.name as string;
      const probes: { gold: string[]; answers: LabellerAnswer[] }[] = [
        { gold: [a, a, b, b], answers: [a, b, a, b] },
        { gold: [a, a, a, a, b], answers: [a, b, b, b, b] },
        { gold: [a, a, b, b], answers: [b, b, a, a] },
        { gold: [a, a, a], answers: [a, a, a] },
        { gold: [a, b, a, b], answers: ['', 'outside-label-set', a, b] },
        { gold: ['none', a, 'none', b, a], answers: ['none', null, a, b, null] },
      ];
      const selected = probes[item.variant] as { gold: string[]; answers: LabellerAnswer[] };
      const checks = [selected];
      if (item.family === 'abstain') checks.push({ gold: [a, b, 'none'], answers: [null, null, null] });
      for (const probe of checks) {
        const result = scoreLabeller(probe.gold, probe.answers, fixture.scoringSet);
        const reference = referenceMetrics(
          probe.gold,
          probe.answers,
          new Set(['none', ...fixture.scoringSet.labels.map((label) => label.name)]),
        );
        for (const key of Object.keys(reference) as (keyof typeof reference)[]) {
          if (!Number.isFinite(result[key]) || Math.abs(result[key] - reference[key]) > 1e-12)
            diagnostics.push(`diagnostic ${key}: got ${result[key]}, expected ${reference[key]}`);
        }
      }
    }
    const bars = LABELLER_TIER_BARS[item.tier];
    if (metrics.agreement < bars.agreement || metrics.kappa < bars.kappa)
      diagnostics.push(`below tier ${item.tier} bars: raw >= ${bars.agreement}, kappa >= ${bars.kappa}`);
    if (errors.length) diagnostics.push(`${errors.length} request errors; first: ${errors[0]}`);
    // Robustness families demand the actual paired answer, not just global accuracy.
    if (item.family !== 'agreement') {
      const misses = fixture.units.flatMap((unit, i) => (answers[i] === unit.recorded ? [] : [i]));
      if (misses.length) diagnostics.push(`paired answer mismatch at units ${misses.slice(0, 6).join(',')}`);
    }
    if (item.family === 'replay') {
      try {
        const replay = createLabellerReplay(
          fixture.units.map((unit, i) => ({
            request: unit.request,
            labellerId: labeller.id,
            answer: answers[i] ?? null,
          })),
          labeller.id,
        );
        for (const [i, unit] of fixture.units.entries()) {
          if ((await replay.label(structuredClone(unit.request))) !== answers[i])
            diagnostics.push(`recording changed the observed answer at unit ${i}`);
        }
      } catch (error) {
        diagnostics.push(`recording failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (fixture.keyProbe) {
      const { before, after, otherId } = fixture.keyProbe;
      const renamedSet = {
        ...before,
        labelSet: { ...before.labelSet, name: `${before.labelSet.name}-revised` },
      };
      if (
        labelSetHash(before.labelSet) === labelSetHash(renamedSet.labelSet) ||
        labellerRequestKey(before, labeller.id) === labellerRequestKey(renamedSet, labeller.id)
      )
        diagnostics.push('changed label-set name reused its identity');
      const id = labeller.id;
      const nextId = otherId ?? id;
      if (labellerRequestKey(before, id) === labellerRequestKey(after, nextId))
        diagnostics.push('changed request reused its cache key');
      if (
        JSON.stringify(before.labelSet) !== JSON.stringify(after.labelSet) &&
        labelSetHash(before.labelSet) === labelSetHash(after.labelSet)
      )
        diagnostics.push('changed label set reused its hash');
      const recordedAnswer = fixture.units[0]?.recorded ?? 'none';
      const replay = createLabellerReplay(
        [{ request: before, labellerId: id, answer: recordedAnswer }],
        nextId,
      );
      let missed = false;
      try {
        await replay.label(after);
      } catch {
        missed = true;
      }
      if (!missed) diagnostics.push('changed request replayed a stale recorded answer');
      const exact = createLabellerReplay([{ request: before, labellerId: id, answer: recordedAnswer }], id);
      if ((await exact.label(structuredClone(before))) !== recordedAnswer)
        diagnostics.push('exact recorded request did not replay');
    }
    const detail = `raw=${metrics.agreement}; kappa=${metrics.kappa}; correct=${metrics.correct}/${metrics.total}; abstentions=${metrics.abstentions}; invalid=${metrics.invalid}; coverage=${metrics.coverage}${diagnostics.length ? `; ${diagnostics.join('; ')}` : ''}`;
    return { pass: diagnostics.length === 0, detail, metrics };
  } catch (error) {
    return { pass: false, detail: `item error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

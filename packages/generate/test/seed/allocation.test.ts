import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PerturbationSpec } from '@agent-nexus/driftbench-core';
import { placeSpec } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { generateSuiteToDisk } from '../../src/enumerate/stream';
import { Allocation } from '../../src/seed/allocation';
import { DeviationBalance } from '../../src/seed/deviation-balance';
import { rngFor } from '../../src/seed/random';
import { buildScenario } from '../../src/seed/scenario';
import { fixture, split } from './desk';

function eventCounts(
  prepared: ReturnType<typeof fixture>,
  suite: ReturnType<typeof generateSuite>,
  dimension: 'stage' | 'deviation' = 'stage',
) {
  const counts = new Map<string, number>();
  const at = dimension === 'stage' ? prepared.stage : prepared.deviation;
  if (at === undefined) throw new Error(`missing ${dimension} axis`);
  for (const value of prepared.space.dimensions[at]?.values ?? [])
    if (value.id !== 'none') counts.set(value.id, 0);
  for (const spec of suite.complete)
    for (const event of placeSpec(prepared.space, spec).events)
      for (const value of event.values[at] ?? []) {
        const id = prepared.space.dimensions[at]?.values[value]?.id;
        if (!id) throw new Error(`unknown ${dimension}`);
        if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
  return counts;
}

describe('approved stage allocation', () => {
  it('counts declared recoveries when balancing classes, even without an inline injection', () => {
    const prepared = fixture();
    const spec = generateSuite(prepared, { seed: 1031, t: 2, mapPath: '../desk.yaml' }).complete[0];
    if (!spec) throw new Error('no parcel scenario');
    const balance = new DeviationBalance(prepared);
    const declared = {
      ...spec,
      blocks: spec.blocks.filter((block) => !('injection' in block.when)),
      perturbations: [
        {
          id: 'aside',
          class: 'D1_off_topic' as const,
          inject_at: 0,
          user: 'Do you sell postcards?',
          expect: { stage: 'welcome' },
        },
      ],
    };
    for (let index = 0; index < 12; index++) balance.observe(declared);
    const first = balance.topUps({ seed: 1031, t: 2, max: 100 }, 0).next();
    expect(first.done).toBe(false);
    if (first.done) throw new Error('declared recoveries were not counted');
    expect(first.value.blocks.at(-1)?.injection).toBe('D5_language_switch');
    expect(first.value.end_state).toBeUndefined();
  });
  it('adds executable recoveries at rare arrivals without changing the walk or random stream', () => {
    const prepared = fixture();
    const balance = new Allocation(prepared);
    balance.observe(
      Array.from({ length: 90 }, () => ({ stage: 'address', injection: 'D5_language_switch' as const })),
    );
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const left = rngFor(1031, 'comparison');
    const right = rngFor(1031, 'comparison');
    const original = buildScenario(prepared, left, { path, fixed: [] });
    const balanced = buildScenario(prepared, right, { path, fixed: [], allocation: balance });
    expect(original.ok && balanced.ok).toBe(true);
    if (!original.ok || !balanced.ok) throw new Error('parcel route did not build');
    expect(balanced.blocks).toEqual(original.blocks);
    expect(right()).toBe(left());
    const extras = (balanced.perturbations ?? []).filter(
      (entry) =>
        !(original.perturbations ?? []).some(
          (prior) => prior.class === entry.class && prior.inject_at === entry.inject_at,
        ),
    );
    expect(extras.length).toBeGreaterThan(0);
    expect(
      balanced.perturbations?.some((entry) => entry.inject_at === 0 && entry.expect?.stage === 'welcome'),
    ).toBe(true);
    for (const entry of extras) {
      const arrival = entry.inject_at === 0 ? path.stages[0] : balanced.blocks[entry.inject_at - 1]?.stage;
      expect(entry.expect?.stage).toBe(arrival);
      expect(entry.recovery?.stage_after).toBe(arrival);
      expect(entry.user).toBe(
        entry.class === 'D1_off_topic' ? 'Do you sell postcards?' : 'Kunt u mij helpen?',
      );
      expect(entry.class === 'D1_off_topic' && arrival === 'packing').toBe(false);
    }
  });

  it('balances actual placements with identical spec bytes and equivalent reports', async () => {
    const prepared = fixture();
    const options = { seed: 1031, t: 2, mapPath: '../desk.yaml' };
    const eager = generateSuite(prepared, options);
    expect(eager.report.invalid).toEqual([]);
    const counts = [...eventCounts(prepared, eager).values()];
    expect(counts).toHaveLength(4);
    expect(Math.max(...counts)).toBeLessThanOrEqual(3 * Math.min(...counts));
    const root = await mkdtemp(join(tmpdir(), 'parcel-balance-'));
    try {
      await generateSuiteToDisk(prepared, { ...options, outputDir: root });
      for (const file of eager.files) {
        const written = await readFile(join(root, file.path), 'utf8');
        if (file.path === 'generate-report.json') {
          const actual = JSON.parse(written);
          const expected = JSON.parse(file.text);
          // The APIs sum weights in a different order; only this floating estimate has rounding noise.
          expect(actual.coverage.measures.effective_sample_size).toBeCloseTo(
            expected.coverage.measures.effective_sample_size,
            12,
          );
          actual.coverage.measures.effective_sample_size = expected.coverage.measures.effective_sample_size;
          expect(actual).toEqual(expected);
        } else expect(written, file.path).toBe(file.text);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('adds walks for a last stage that no declared recovery can reach, and balances the classes they bring', () => {
    const prepared = split();
    const suite = generateSuite(prepared, { seed: 1031, t: 2, mapPath: '../desk.yaml' });
    expect(suite.report.invalid).toEqual([]);
    for (const dimension of ['stage', 'deviation'] as const) {
      const counts = [...eventCounts(prepared, suite, dimension).values()];
      expect(Math.min(...counts), `${dimension} counts ${counts}`).toBeGreaterThan(0);
      expect(Math.max(...counts), `${dimension} counts ${counts}`).toBeLessThanOrEqual(
        3 * Math.min(...counts),
      );
    }
    expect(suite.files.some((file) => file.path.includes('gen-stage-balance-'))).toBe(true);
  }, 60_000);

  it('declares a recovery after the last turn when the last stage is the rare one', () => {
    const prepared = fixture();
    const balance = new Allocation(prepared);
    for (const stage of ['welcome', 'address', 'packing'])
      balance.observe(Array.from({ length: 60 }, () => ({ stage })));
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const built = buildScenario(prepared, rngFor(1031, 'last'), { path, fixed: [], allocation: balance });
    if (!built.ok) throw new Error('parcel route did not build');
    const last = (built.perturbations ?? []).filter((entry) => entry.inject_at === built.blocks.length);
    expect(last.length).toBeGreaterThan(0);
    for (const entry of last) {
      expect(entry.expect?.stage).toBe('receipt');
      expect(entry.recovery?.stage_after).toBe('receipt');
    }
  });

  it('places a probe at the stage its class can take that the suite places least', () => {
    const prepared = fixture();
    const balance = new Allocation(prepared);
    for (const stage of ['welcome', 'address', 'receipt'])
      balance.observe(Array.from({ length: 30 }, () => ({ stage })));
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const built = buildScenario(prepared, rngFor(1031, 'probe'), {
      path,
      fixed: [],
      probe: { classId: 'D5_language_switch' },
      allocation: balance,
    });
    if (!built.ok) throw new Error('parcel route did not build');
    const probe = built.blocks.findIndex((block) => block.injection === 'D5_language_switch');
    expect(built.blocks[probe - 1]?.stage).toBe('packing');
  });

  it('builds a walk for the balance with no drawn class and no tool failure', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const ordinary = buildScenario(prepared, rngFor(1031, 'own'), { path, fixed: [] });
    const own = buildScenario(prepared, rngFor(1031, 'own'), { path, fixed: [], allocationOnly: true });
    if (!ordinary.ok || !own.ok) throw new Error('parcel route did not build');
    expect(ordinary.perturbations?.length).toBeGreaterThan(0);
    expect(own.perturbations).toBeUndefined();
    expect(own.blocks).toEqual(ordinary.blocks);
  });

  it('writes walks for a behaviour few specs cover, on a path of a flow that holds it', () => {
    const prepared = split();
    const balance = new Allocation(prepared);
    const flow = prepared.space.dimensions.findIndex((dimension) => dimension.id === 'flow');
    const last = (prepared.space.dimensions[flow]?.values ?? []).filter((value) => value.id !== 'none');
    const rare = last.map((value) => value.id).slice(-1)[0];
    for (const value of last)
      if (value.id !== rare) for (let at = 0; at < 30; at++) balance.observe([], [], [value.id]);
    const [first] = balance.behaviourTopUps({ seed: 1031, t: 2, max: 100, allocation: balance }, 0);
    if (!first) throw new Error('no walk for the rare behaviour');
    const covered = first.cell.map(
      ([dimension, value]) => prepared.space.dimensions[dimension]?.values[value]?.id,
    );
    expect(covered).toContain(rare);
    expect(first.blocks.every((block) => block.stimulus.kind !== 'placeholder')).toBe(true);
  });

  it('adds at most as many specs as the seeders wrote, and restores the cap', () => {
    const prepared = fixture();
    const balance = new Allocation(prepared);
    balance.observe(Array.from({ length: 600 }, () => ({ stage: 'address' })));
    const context = { seed: 1031, t: 2, max: Number.POSITIVE_INFINITY, allocation: balance };
    let written = 10;
    const drafts: unknown[] = [];
    for (const draft of balance.rounds(context, () => written, { topUps: function* () {} })) {
      balance.observeDraft(draft);
      drafts.push(draft);
      written += 1;
    }
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.length).toBeLessThanOrEqual(10);
    expect(context.max).toBe(Number.POSITIVE_INFINITY);
  });

  it('moves a drawn recovery to a rarer arrival with the same wording, and adds one per class there', () => {
    const prepared = fixture();
    const balance = new Allocation(prepared);
    for (const stage of ['welcome', 'address', 'receipt'])
      balance.observe(Array.from({ length: 30 }, () => ({ stage })));
    const option = (classId: string, index: number, stage: string, user: string) => ({
      classId,
      index,
      stage,
      user,
      expect: { stage },
    });
    const drawn: PerturbationSpec = {
      id: 'p1-D5_language_switch',
      class: 'D5_language_switch',
      inject_at: 1,
      user: 'Kunt u mij helpen?',
      expect: { stage: 'address' },
      recovery: { within_blocks: 0, stage_after: 'address' },
    };
    const perturbations = [drawn];
    balance.supplement(
      [
        { stage: 'address', stimulus: { kind: 'placeholder' } },
        { stage: 'packing', stimulus: { kind: 'placeholder' } },
      ] as never,
      perturbations,
      [
        option('D5_language_switch', 1, 'address', 'Kunt u mij helpen?'),
        option('D5_language_switch', 2, 'packing', 'Kunt u mij helpen?'),
        option('D1_off_topic', 2, 'packing', 'Do you sell postcards?'),
        option('D1_off_topic', 3, 'receipt', 'Do you sell postcards?'),
      ],
      true,
    );
    expect(perturbations[0]).toMatchObject({ inject_at: 2, expect: { stage: 'packing' } });
    expect(perturbations).toHaveLength(2);
    expect(perturbations[1]).toMatchObject({ class: 'D1_off_topic', inject_at: 2 });
  });

  it('cuts a walk at its probe, except a probe said after the walk is over', () => {
    const prepared = fixture();
    const base = prepared.relations.paths[0];
    if (!base) throw new Error('missing parcel path');
    const path = { ...base, end_state: { source: 'tool:ship', mode: 'exact' as const, expect: {} } };
    const build = (stage: string) =>
      buildScenario(prepared, rngFor(1031, `cut-${stage}`), {
        path,
        fixed: [],
        probe: { classId: 'D5_language_switch', stage, cut: true },
      });
    const early = build('address');
    const late = build('receipt');
    if (!early.ok || !late.ok) throw new Error('parcel route did not build');
    expect(early.blocks.at(-1)?.injection).toBe('D5_language_switch');
    expect(early.endState).toBeUndefined();
    expect(late.blocks.map((block) => block.stage)).toEqual(['address', 'packing', 'receipt', 'receipt']);
    expect(late.endState).toBeDefined();
  });

  it('stops when missing approved phrases make a rare stage impossible', () => {
    const prepared = { ...fixture(), phrasesOf: new Map() };
    const balance = new Allocation(prepared);
    balance.observe(Array.from({ length: 12 }, () => ({ stage: 'address' })));
    const drafts = [...balance.stageTopUps({ seed: 1031, t: 2, max: 100, allocation: balance }, 0)];
    expect(drafts).toEqual([]);
  });
});

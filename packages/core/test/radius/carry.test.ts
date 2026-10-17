import { describe, expect, it } from 'vitest';
import {
  type ChangeManifest,
  campaignRadius,
  carriedRun,
  cellId,
  contentHash,
  initialGiven,
  type PlannedCell,
  planRadiusCampaign,
  provenanceDigest,
  provenanceHash,
  type RadiusSpec,
  type RunResult,
  radiusOf,
  resolveGiven,
  type Spec,
  type TargetRef,
} from '../../src/index';

/** Fictional data only. Two generated specs: one reads the recap stage, one does not. */
const spec = (id: string, stage: string): Spec => ({
  id,
  kind: 'conversation',
  blocks: [{ id: 'b1', when: { user: 'Hello' }, expect: { stage } }],
  metadata: { generated: { cell: { flow: id } } },
});
const specs: RadiusSpec[] = [
  { spec: spec('order', 'recap'), hash: contentHash(spec('order', 'recap')) },
  { spec: spec('faq', 'needs'), hash: contentHash(spec('faq', 'needs')) },
];
const manifest: ChangeManifest = { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'recap' }] };
const radius = radiusOf(specs, manifest);

const target = (variant?: string): TargetRef => ({
  adapter: 'function',
  agent: 'acme-sales',
  ...(variant === undefined ? {} : { variant }),
});
const cell = (id: string, variant: string | undefined, repeat = 0): PlannedCell => {
  const key = {
    specHash: contentHash(spec(id, id === 'order' ? 'recap' : 'needs')),
    target: target(variant),
    mode: 'F' as const,
    repeat,
  };
  return { cellId: cellId(key), specId: id, ...key, blocks: 1 };
};
const stored = (id: string, variant: string | undefined, over: Partial<RunResult> = {}): RunResult => {
  const planned = cell(id, variant);
  const run: RunResult = {
    runId: planned.cellId,
    specId: id,
    specHash: planned.specHash,
    target: planned.target,
    mode: 'F',
    repeat: 0,
    status: 'completed',
    provenance: {
      version: 2,
      driver: { idHash: provenanceHash('scripted'), seedsHash: provenanceHash({}) },
      adapter: {
        idHash: provenanceHash('function'),
        versionHash: provenanceHash('1'),
        cacheIdentityHash: null,
        requiresCacheIdentity: false,
      },
      agentVersionHash: variant === undefined ? null : provenanceHash(variant),
      executionHash: provenanceHash('execution'),
      targetVersionHash: provenanceHash({ variant }),
      agentVersionLabelHash: null,
    },
    blocks: [
      {
        index: 0,
        blockId: 'b1',
        givenHash: resolveGiven(
          initialGiven(spec(id, 'needs')),
          [],
          target(over.carried?.agentVersion ?? variant),
        ).hash,
        provenance: {
          specIndex: 0,
          stimulusHash: provenanceHash({ user: 'Hello' }),
          ledgerHash: provenanceHash({}),
          artifacts: [],
        },
        observed: { text: 'ok', segments: [], toolCalls: [], cost: {}, latencyMs: 0 },
        verdicts: [],
        drift: [],
        pass: true,
        ledgerCheck: { ok: true, contradictions: [] },
      },
    ],
    succession: {} as RunResult['succession'],
    cost: 0.25,
    latencyMs: 10,
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T00:00:01.000Z',
    cacheHit: false,
    ...over,
  };
  return { ...run, provenanceDigest: provenanceDigest(run) };
};
const cells = [cell('order', 'v2'), cell('faq', 'v2')];
const now = new Date('2026-10-02T00:00:01.000Z');
const plan = (runs: RunResult[], limits = {}, planned = cells, change = manifest) =>
  planRadiusCampaign(
    planned,
    radiusOf(specs, change),
    change,
    {
      campaignId: 'c-base',
      runs,
      provenance: {
        version: 2,
        adapters: [
          ...new Map(
            runs.map((run) => [
              provenanceHash(run.target),
              {
                idHash: provenanceHash('function'),
                versionHash: provenanceHash('1'),
                cacheIdentityHash: null,
                requiresCacheIdentity: false,
                targetHash: provenanceHash(run.target),
                agentVersionHash:
                  run.target.variant === undefined ? null : provenanceHash(run.target.variant),
              },
            ]),
          ).values(),
        ],
      },
    },
    {
      now,
      currentSpec: (cell) => specs.find((entry) => entry.spec.id === cell.specId)?.spec,
      currentProvenance: (cell) => stored(cell.specId, cell.target.variant).provenance,
      ...limits,
    },
  );

describe('planRadiusCampaign', () => {
  it('runs the cells in the radius and carries the stored run of the others, stamped', () => {
    const made = plan([stored('order', 'v1'), stored('faq', 'v1')]);
    expect(made.nothing).toBeUndefined();
    expect(made.fresh.map((each) => each.specId)).toEqual(['order']);
    expect(made.inside.map((each) => each.specId)).toEqual(['order']);
    expect(made.refused).toEqual([]);
    expect(made.carried).toHaveLength(1);
    const carried = made.carried[0];
    expect(carried?.carried).toEqual({
      fromCampaign: 'c-base',
      fromRun: cell('faq', 'v1').cellId,
      agentVersion: 'v1',
      age: { campaigns: 1, days: 1 },
    });
    // The copy is stored under the new campaign's own cell: its id and its target, the result unchanged.
    const copy = carriedRun(carried as NonNullable<typeof carried>);
    expect(copy.runId).toBe(cell('faq', 'v2').cellId);
    expect(copy.target).toEqual(target('v2'));
    expect(copy.cost).toBe(0.25);
    expect(copy.finishedAt).toBe('2026-10-01T00:00:01.000Z');
    expect(campaignRadius(made, radius, manifest, 'abc', 'c-base')).toEqual({
      manifest: 'abc',
      fromVersion: 'v1',
      toVersion: 'v2',
      changes: ['stage:recap'],
      from: 'c-base',
      fresh: 1,
      carried: 1,
      outside: 1,
      refused: [],
    });
  });

  it('carries every repeat of a cell outside the radius', () => {
    const planned = [cell('faq', 'v2', 0), cell('faq', 'v2', 1)];
    const second = { ...stored('faq', 'v1'), repeat: 1, runId: cell('faq', 'v1', 1).cellId };
    expect(plan([stored('faq', 'v1'), second], {}, planned).carried).toHaveLength(2);
  });

  it('carries nothing, with the reason, when the versions do not line up', () => {
    const runs = [stored('order', 'v1'), stored('faq', 'v1')];
    const none = (planned: PlannedCell[], held = runs) => plan(held, {}, planned);
    expect(none([cell('order', undefined), cell('faq', undefined)]).nothing).toMatch(
      /names no agent version/,
    );
    expect(none([cell('order', 'v3'), cell('faq', 'v3')]).nothing).toBe(
      'this campaign runs agent version v3, and the manifest ends at v2',
    );
    expect(none([cell('order', 'v2'), cell('faq', 'v3')]).nothing).toMatch(/several agent versions/);
    const unversioned = none(cells, [stored('order', undefined), stored('faq', undefined)]);
    expect(unversioned.nothing).toBe('campaign c-base holds no run of agent version v1 (it holds: none)');
    for (const made of [unversioned, none([cell('order', 'v3'), cell('faq', 'v3')])]) {
      expect(made.fresh).toHaveLength(2);
      expect(made.carried).toEqual([]);
    }
  });

  it('carries nothing when the radius is the whole suite', () => {
    const whole = plan([stored('order', 'v1'), stored('faq', 'v1')], {}, cells, {
      from: 'v1',
      to: 'v2',
      changes: [{ kind: 'model' }],
    });
    expect(whole.nothing).toMatch(/^the radius is the whole suite: model/);
    expect(whole.fresh).toHaveLength(2);
  });

  it('refuses a cell whose baseline run is missing, did not complete, or ran another version', () => {
    const reason = (runs: RunResult[]) => plan(runs).refused.map((each) => each.reason);
    expect(reason([stored('order', 'v1')])).toEqual(['campaign c-base holds no run of the cell']);
    expect(reason([stored('order', 'v1'), stored('faq', 'v1', { status: 'failed' })])).toEqual([
      'its run in campaign c-base did not complete',
    ]);
    expect(reason([stored('order', 'v1'), stored('faq', 'v0')])).toEqual([
      'its run in campaign c-base names agent version v0, not v1',
    ]);
    // A refused cell runs fresh: it is never dropped.
    expect(plan([stored('order', 'v1')]).fresh.map((each) => each.specId)).toEqual(['order', 'faq']);
  });

  it('counts the age of a result carried again from the campaign that ran it fresh', () => {
    const carriedOnce = stored('faq', 'v1', {
      carried: {
        fromCampaign: 'c-origin',
        fromRun: 'run-origin',
        agentVersion: 'v0',
        age: { campaigns: 2, days: 3 },
      },
    });
    const made = plan([stored('order', 'v1'), carriedOnce]);
    expect(made.carried[0]?.carried).toEqual({
      fromCampaign: 'c-origin',
      fromRun: 'run-origin',
      agentVersion: 'v0',
      age: { campaigns: 3, days: 1 },
    });
  });

  it('brings a result past a staleness limit back into the run', () => {
    const old = stored('faq', 'v1', {
      carried: {
        fromCampaign: 'c-origin',
        fromRun: 'run-origin',
        agentVersion: 'v1',
        age: { campaigns: 5, days: 1 },
      },
    });
    expect(plan([stored('order', 'v1'), old]).refused.map((each) => each.reason)).toEqual([
      'carried 5 campaigns in a row, the limit is 5',
    ]);
    expect(plan([stored('order', 'v1'), old], { maxCarry: 6 }).carried).toHaveLength(1);
    const week = stored('faq', 'v1', { finishedAt: '2026-09-20T00:00:01.000Z' });
    expect(plan([stored('order', 'v1'), week]).refused.map((each) => each.reason)).toEqual([
      'its fresh run is 12 days old, the limit is 7',
    ]);
    expect(plan([stored('order', 'v1'), week], { maxAgeDays: 30 }).carried).toHaveLength(1);
    // A limit of 0 campaigns carries nothing: a full run.
    expect(plan([stored('order', 'v1'), stored('faq', 'v1')], { maxCarry: 0 }).carried).toEqual([]);
  });
});

it('refuses stale resolved objects unless the caller commits to rescoring observations', () => {
  const source = stored('faq', 'v1');
  const objects = [
    { key: 'check_set', kind: 'check-set', id: 'previous', hash: 'previous-hash', setAt: 'project' },
  ] as const;
  const block = source.blocks[0];
  if (!block) throw new Error('fixture block missing');
  block.resolved = { objects: [...objects], hash: contentHash(objects) };
  const refused = plan([source]);
  expect(refused.carried).toEqual([]);
  expect(refused.refused[0]?.reason).toMatch(/resolved objects differ/);
  const rescoring = plan([source], { rescoreObservations: true });
  expect(rescoring.carried).toHaveLength(1);
  expect(rescoring.carried[0]?.needsRescore).toBe(true);
  const carried = rescoring.carried[0];
  if (!carried) throw new Error('expected a rescoring candidate');
  expect(() => carriedRun(carried)).toThrow(/must be re-scored/);
});

it.each([false, true])('whole-run copies follow the new realized-text opt-in (%s)', (record) => {
  const source = stored('faq', 'v1');
  if (!source.blocks[0]) throw new Error('missing source block');
  source.blocks[0].realized = { hash: provenanceHash('private'), text: 'private' };
  source.provenanceDigest = provenanceDigest(source);
  const entry = plan([source]).carried[0];
  if (!entry) throw new Error('missing carry plan');
  expect(entry).toBeDefined();
  const copied = carriedRun(entry, record);
  expect(copied.blocks[0]?.realized).toEqual({
    hash: provenanceHash('private'),
    ...(record ? { text: 'private' } : {}),
  });
  expect(copied.provenanceDigest).toBe(provenanceDigest(copied));
  if (!record) {
    expect(copied.realizedTextStripped).toEqual({
      fromRun: source.runId,
      fromCampaign: entry.sourceCampaign,
    });
    expect(copied.blocks[0]?.realizedTextStripped).toEqual(copied.realizedTextStripped);
    const tampered = structuredClone(copied);
    tampered.realizedTextStripped = { ...tampered.realizedTextStripped, fromRun: 'forged' };
    expect(provenanceDigest(tampered)).not.toBe(copied.provenanceDigest);
  }
  expect(source.blocks[0]?.realized?.text).toBe('private');
  const hashOnly = carriedRun(entry);
  const next = carriedRun({ ...entry, source: hashOnly }, true);
  expect(next.blocks[0]?.realized).not.toHaveProperty('text');
  expect(next.realizedTextStripped).toEqual(hashOnly.realizedTextStripped);
  expect(next.provenanceDigest).toBe(provenanceDigest(next));
});

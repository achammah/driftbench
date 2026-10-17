import { describe, expect, it } from 'vitest';
import {
  type ChangeManifest,
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

/**
 * Blast-radius audit (PR 428): a stored run with a block not run or blocked is no measurement to carry. The
 * cell is refused with the reason and runs fresh, where it may now run.
 */
describe('blast radius: carry refuses a source run with a block not run or blocked', () => {
  const unscored = (status: 'not_run' | 'blocked') => {
    const base = stored('faq', 'v1');
    const first = base.blocks[0] as RunResult['blocks'][number];
    return stored('faq', 'v1', {
      blocks: [
        {
          ...first,
          pass: false,
          status,
          ...(status === 'not_run'
            ? {
                notRun: {
                  kind: 'unsupported',
                  layer: '5 world',
                  check: 'capability',
                  expected: 'e',
                  got: 'g',
                },
              }
            : { blocked: { by: 'block 0', root: 'block 0' } }),
        },
      ],
    });
  };

  for (const status of ['not_run', 'blocked'] as const) {
    it(`a ${status} source block: refused with the reason, and the cell runs fresh`, () => {
      const made = plan([stored('order', 'v1'), unscored(status)]);
      expect(made.carried).toEqual([]);
      expect(made.refused.map((each) => [each.cell.specId, each.reason])).toEqual([
        ['faq', 'its run in campaign c-base has a block not run or blocked'],
      ]);
      expect(made.fresh.map((each) => each.specId).sort()).toEqual(['faq', 'order']);
    });
  }

  it('a scored source block is still carried', () => {
    expect(plan([stored('order', 'v1'), stored('faq', 'v1')]).carried).toHaveLength(1);
  });
});

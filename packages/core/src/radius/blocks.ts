import { runProvenance } from '../runner/provenance';
import { applyBlockRealizedTextPolicy } from '../runner/realized-text';
import type { RunOptions } from '../runner/run';
import { blockStatus } from '../runner/verdicts';
import type { BlockResult, Campaign, RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import { specHash } from '../spec/identity';
import { planRadiusCampaign } from './carry';
import type { ChangeManifest } from './change';
import { radiusOf } from './radius';

export type BlockReuse = {
  source: RunResult;
  baselineProvenance?: Campaign['provenance'];
  fromCampaign: string;
  manifest: ChangeManifest;
  maxCarry?: number;
  maxAgeDays?: number;
};
export const END_STATE_FULL_RERUN = 'end state cannot be recomposed: full cell rerun';

/** A refusal is a full cell rerun, never a guessed carried block. */
export function planBlockRerun(
  spec: Spec,
  options: RunOptions,
  reuse: BlockReuse,
  now: Date,
): { indices: Set<number>; carried: Map<number, BlockResult> } | { reason: string } {
  const { source, manifest } = reuse;
  if (spec.blocks.some((block) => block.parent !== undefined))
    return { reason: 'parent-linked blocks require a full tree replay' };
  const fail = (reason: string) => ({ reason });
  if (options.mode !== 'T' || source.mode !== 'T' || options.adapter.capabilities().sandbox)
    return fail('only independent mode T cells support block reruns');
  if (
    source.endState?.match === false ||
    source.status !== 'completed' ||
    source.blocks.length !== spec.blocks.length ||
    source.blocks.some((b) => blockStatus(b) !== 'pass' || !b.provenance)
  )
    return fail('the baseline is incomplete, failing or lacks block provenance');
  if (source.rejudged) return fail('a re-judged baseline requires a full agent measurement');
  if (options.driver.id !== 'scripted' || JSON.stringify(options.driver.seeds) !== '{}')
    return fail('the driver inputs are uncertain');
  if (source.specHash !== specHash(spec)) return fail('the full spec hash changed');
  const radius = radiusOf([{ spec, hash: source.specHash }], manifest, { modes: ['T'] });
  if (radius.whole) return fail(radius.whole.reason);
  const indices = new Set(radius.specs[0]?.blocks.filter((b) => b.state.T !== 'out').map((b) => b.index));
  if (!indices.size || indices.size === spec.blocks.length) return fail('the radius needs no partial cell');
  // After the dependency proof, use the SAME public gate as whole-cell carries: complete stamps,
  // integrity digest, current execution equality, reconstructed inputs, full spec hash and age/count.
  const eligibility = structuredClone(radius);
  for (const entry of eligibility.specs) for (const cell of entry.cells) cell.in = false;
  const target = options.target ?? spec.target ?? { adapter: options.adapter.id };
  const cell = {
    ...source,
    target,
    repeat: options.repeat,
    mode: options.mode,
    perturbationId: options.perturbationId,
    cellId: source.runId,
    blocks: source.blocks.length,
  };
  const plan = planRadiusCampaign(
    [cell],
    eligibility,
    manifest,
    { campaignId: reuse.fromCampaign, runs: [source], provenance: reuse.baselineProvenance },
    {
      now,
      rescoreObservations: true,
      maxCarry: reuse.maxCarry,
      maxAgeDays: reuse.maxAgeDays,
      currentProvenance: () => runProvenance({ ...options, target }),
      currentSpec: () => spec,
    },
  );
  const eligible = plan.carried[0];
  if (!eligible) return fail(plan.nothing ?? plan.refused[0]?.reason ?? 'carry validity is unknown');
  if (spec.end_state !== undefined && source.blocks.some((b) => !b.provenance?.endState))
    return fail(END_STATE_FULL_RERUN);
  const carried = new Map<number, BlockResult>();
  for (const [index, block] of source.blocks.entries()) {
    if (indices.has(index)) continue;
    const measuredAt = block.carried?.measuredAt ?? (block.carried ? undefined : source.finishedAt);
    if (!measuredAt || !Number.isFinite(Date.parse(measuredAt)) || Date.parse(measuredAt) > now.getTime())
      return fail('the carried block age is unknown');
    const campaigns = (block.carried?.age.campaigns ?? source.carried?.age.campaigns ?? 0) + 1;
    const days = (now.getTime() - Date.parse(measuredAt)) / 86400000;
    if (campaigns > (reuse.maxCarry ?? 5) || days > (reuse.maxAgeDays ?? 7))
      return fail('the carried block exceeds an age or count limit');
    carried.set(index, {
      ...applyBlockRealizedTextPolicy(block, options.recordRealizedText === true, {
        fromRun: source.runId,
        fromCampaign: reuse.fromCampaign,
      }),
      carried: {
        ...eligible.carried,
        ...(block.carried ?? {}),
        measuredAt,
        age: { campaigns, days: Math.round(days * 100) / 100 },
      },
    });
  }
  return { indices, carried };
}

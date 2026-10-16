import type { DiagnosticStepContext, RunResult } from '@agent-nexus/driftbench-core';
import { SHIPPED_DIAGNOSTICS } from './diagnostics';
import { blameServices } from './services';
import { BLOCK_STEPS, type BlockStepContext, type CampaignStepContext, type StepOutput } from './steps';
import type { BlameDiagnosis } from './types';

/**
 * What the campaign steps of `liability-confirm` need that the diagnostics runner does not carry: who makes a
 * confirm run, what it costs, and how a block is diagnosed again with the evidence the runs stored. The runs
 * come from `blame.useBlameServices({ confirm })`; without them nothing runs and every diagnosis stays static.
 * The block is diagnosed again by the same four steps of `code-agent-liability`, over its stored run and the
 * spec the campaign ran, so the second reading differs from the first only by the confirm evidence.
 */

type Parts = Pick<CampaignStepContext, 'confirmRunner' | 'confirmQuote' | 'confirmFree' | 'rediagnose'>;

/** `<runId>:<blockIndex>`, as `campaignDiagnoses` names a block. */
function locate(runs: readonly RunResult[], block: string) {
  const at = block.lastIndexOf(':');
  const run = runs.find((one) => one.runId === block.slice(0, at));
  const result = run?.blocks.find((one) => one.index === Number(block.slice(at + 1)));
  return run !== undefined && result !== undefined ? { run, result } : undefined;
}

export function confirmContext(ctx: DiagnosticStepContext): Parts {
  const services = blameServices().confirm;
  const rediagnose: CampaignStepContext['rediagnose'] = async (block, confirm) => {
    const found = locate(ctx.runs ?? [], block);
    const spec = found === undefined ? undefined : ctx.specOf?.(found.run);
    // The spec block of a result: a perturbation block has no authored position, so it is not re-read.
    const specBlock = spec?.blocks[found?.result.index ?? -1];
    if (found === undefined || spec === undefined || specBlock === undefined) return [];
    const check: BlockStepContext['check'] = {
      observed: found.result.observed,
      expect: specBlock.expect ?? {},
      spec,
      block: specBlock,
      blockIndex: found.result.index,
    };
    const steps = SHIPPED_DIAGNOSTICS['diagnostic:code-agent-liability'].steps as Array<{
      impl: string;
      params: Record<string, unknown>;
    }>;
    const earlier: StepOutput[] = [];
    const out: StepOutput[] = [];
    for (const item of steps) {
      const step = BLOCK_STEPS[item.impl];
      if (step === undefined) continue;
      const made = await step.run({
        check,
        verdicts: found.result.verdicts,
        objects: [],
        params: item.params,
        earlier,
        confirm,
      });
      out.push(...(made ?? []));
    }
    return out.map(toDiagnosis);
  };
  return {
    ...(services === undefined ? {} : { confirmRunner: services.runner }),
    ...(services?.quote === undefined ? {} : { confirmQuote: services.quote }),
    ...(services?.free === true ? { confirmFree: true } : {}),
    rediagnose,
  };
}

/** The second reading as the rerun step reads it: the block's diagnosis fields back from the step output. */
function toDiagnosis(one: StepOutput): BlameDiagnosis {
  const evidence = (one.evidence ?? {}) as Record<string, unknown>;
  return {
    diagnostic: 'diagnostic/code-agent-liability',
    verdict_ref: one.verdictRef ?? '',
    rule: one.rule ?? '',
    ...(one.by === undefined ? {} : { by: one.by }),
    fault: one.fault ?? [],
    disposition: one.disposition ?? 'unassigned',
    fix_location: one.fixLocation ?? 'unassigned',
    ...(one.fixTarget === undefined ? {} : { fix_target: one.fixTarget }),
    fix_action: one.fixAction ?? 'review',
    fix_forms: one.fixForms ?? [],
    placement: one.placement ?? '',
    evidence,
    confidence: one.confidence ?? 'static',
    flags: one.flags ?? [],
    item: String(evidence.item ?? ''),
    ...(typeof evidence.act === 'string' ? { act: evidence.act } : {}),
    home: String(evidence.home ?? 'none'),
    ...(one.inherits === undefined ? {} : { inherits: one.inherits }),
  };
}

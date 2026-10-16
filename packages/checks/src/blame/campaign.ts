import type { CampaignDiagnosis as IdentifiedDiagnosis } from '@agent-nexus/driftbench-core';
import type { CampaignDiagnosis } from './fixplan';

/** Project F5's identified records into complete block blame findings. Run-level notes have no block to count. */
export function campaignDiagnoses(diagnoses: readonly IdentifiedDiagnosis[]): CampaignDiagnosis[] {
  return diagnoses.flatMap(({ runId, blockIndex, verdictRef, diagnosis: one }) => {
    const item = one.evidence?.item;
    const home = one.evidence?.home;
    if (
      blockIndex === undefined ||
      verdictRef === undefined ||
      !one.rule ||
      !one.fixLocation ||
      !one.fixAction ||
      !one.placement ||
      !one.fault ||
      !one.fixForms ||
      !one.disposition ||
      !one.confidence ||
      typeof item !== 'string' ||
      typeof home !== 'string'
    )
      return [];
    return [
      {
        block: `${runId}:${blockIndex}`,
        diagnostic: one.diagnostic,
        verdict_ref: verdictRef,
        rule: one.rule,
        by: one.by,
        ...(one.inherits === undefined ? {} : { inherits: one.inherits }),
        fault: one.fault,
        disposition: one.disposition,
        fix_location: one.fixLocation,
        ...(one.fixTarget === undefined ? {} : { fix_target: one.fixTarget }),
        fix_action: one.fixAction,
        fix_forms: one.fixForms,
        placement: one.placement,
        evidence: one.evidence ?? {},
        confidence: one.confidence,
        flags: one.flags ?? [],
        ...(one.removeCopies === undefined ? {} : { remove_copies: one.removeCopies }),
        item,
        home,
        ...(typeof one.evidence?.act === 'string' ? { act: one.evidence.act } : {}),
      },
    ];
  });
}

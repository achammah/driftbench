import type { DeviationClass } from '@agent-nexus/driftbench-core';
import type { Proposal } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';

// A hand-written parcel desk, independent of the validator's hidden maps.
const by = {
  produced_by: 'code' as const,
  approved: true,
  evidence: { source: 'desk.md', quote: 'Keep the pending parcel step after an aside.' },
};
export type Flow = { id: string; stages: readonly string[]; classes: readonly DeviationClass[] };
const PHRASES: Partial<Record<DeviationClass, { text: string; lang: string }>> = {
  D1_off_topic: { text: 'Do you sell postcards?', lang: 'en' },
  D3_contradiction: { text: 'Actually the address is Elm Street.', lang: 'en' },
  D5_language_switch: { text: 'Kunt u mij helpen?', lang: 'nl' },
  D9_out_of_scope: { text: 'I want to ask about my invoice.', lang: 'en' },
};
export function desk(flows: readonly Flow[], forbid: Array<Record<string, string>> = []) {
  const axis = (id: string, kind: Proposal['dimensions'][number]['kind'], ids: readonly string[]) => ({
    id,
    title: id,
    kind,
    role: 'axis' as const,
    values: ids.map((id) => ({ id, title: id, ...by })),
    ...by,
  });
  const stages = [...new Set(flows.flatMap((flow) => flow.stages))];
  const classes = [...new Set(flows.flatMap((flow) => flow.classes))];
  const moves = [
    ...new Set(flows.flatMap((flow) => flow.stages.slice(1).map((to, i) => `${flow.stages[i]}-to-${to}`))),
  ];
  const proposal: Proposal = {
    version: 1,
    agent: 'parcel-desk',
    produced_by: { family: 'manual', model: 'hand-written', at: '2026-10-16T00:00:00Z' },
    sources: [{ kind: 'prompt', path: 'desk.md' }],
    dimensions: [
      axis('stage', 'stage', stages),
      axis(
        'flow',
        'behaviour',
        flows.map((flow) => flow.id),
      ),
      axis('deviation', 'deviation', classes),
      axis('channel', 'channel', ['desk']),
      { ...axis('stage_transition', 'behaviour', moves), role: 'detail' },
    ],
    constraints: forbid.map((entry) => ({ forbid: entry, reason: 'Not said at this step', ...by })),
    phrases: [
      ...moves.map((move, index) => ({
        dimension: 'stage_transition',
        value: move,
        text: `Parcel message ${index + 1} for ${move}.`,
        lang: 'en',
        ...by,
      })),
      ...classes.map((cls) => ({
        dimension: 'deviation',
        value: cls,
        text: PHRASES[cls]?.text ?? 'Hello?',
        lang: PHRASES[cls]?.lang ?? 'en',
        ...by,
      })),
    ],
    relations: [
      ...flows.map((flow) => ({
        kind: 'path' as const,
        id: `${flow.id}-route`,
        flow: flow.id,
        stages: [...flow.stages],
        ...by,
      })),
      ...flows.flatMap((flow) =>
        flow.stages.slice(0, -1).map((stage, index) => ({
          kind: 'states' as const,
          subject: { dimension: 'flow', value: flow.id },
          stage,
          to: flow.stages[index + 1],
          must: ['Parcel step confirmed'],
          ...by,
        })),
      ),
      ...classes.map((cls) => ({
        kind: 'recovery' as const,
        class: cls,
        flows: flows.filter((flow) => flow.classes.includes(cls)).map((flow) => flow.id),
        at: stages,
        stage_after: 'pending',
        must: ['Please continue with the parcel'],
        ...by,
      })),
    ],
  };
  return prepareMap(proposal);
}
export function fixture() {
  return desk(
    [
      {
        id: 'parcel',
        stages: ['welcome', 'address', 'packing', 'receipt'],
        classes: ['D1_off_topic', 'D5_language_switch'],
      },
    ],
    [{ stage: 'packing', deviation: 'D1_off_topic' }],
  );
}
/** Two flows: only the long one reaches the last stage, and the map lets no class be said there. */
export function split() {
  return desk(
    [
      {
        id: 'send',
        stages: ['welcome', 'address', 'packing', 'receipt'],
        classes: ['D1_off_topic', 'D9_out_of_scope'],
      },
      {
        id: 'track',
        stages: ['welcome', 'address', 'packing'],
        classes: ['D3_contradiction', 'D5_language_switch'],
      },
      {
        id: 'amend',
        stages: ['welcome', 'address', 'packing'],
        classes: ['D3_contradiction', 'D5_language_switch'],
      },
      {
        id: 'cancel',
        stages: ['welcome', 'address', 'packing'],
        classes: ['D3_contradiction', 'D5_language_switch'],
      },
    ],
    [
      { stage: 'receipt', deviation: 'D1_off_topic' },
      { stage: 'receipt', deviation: 'D9_out_of_scope' },
    ],
  );
}

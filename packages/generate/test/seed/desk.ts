import type { DeviationClass } from '@agent-nexus/driftbench-core';
import type { Proposal } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';

// A hand-written parcel desk, independent of the validator's hidden maps.
const by = {
  produced_by: 'code' as const,
  approved: true,
  evidence: { source: 'desk.md', quote: 'Keep the pending parcel step after an aside.' },
};
export type Flow = {
  id: string;
  stages: readonly string[];
  classes: readonly DeviationClass[];
  /** Other routes of the same flow: one more path each, with the same recoveries. */
  alsoStages?: ReadonlyArray<readonly string[]>;
};
const PHRASES: Partial<Record<DeviationClass, { text: string; lang: string }>> = {
  D1_off_topic: { text: 'Do you sell postcards?', lang: 'en' },
  D3_contradiction: { text: 'Actually the address is Elm Street.', lang: 'en' },
  D5_language_switch: { text: 'Kunt u mij helpen?', lang: 'nl' },
  D9_out_of_scope: { text: 'I want to ask about my invoice.', lang: 'en' },
};
export function desk(
  flows: readonly Flow[],
  forbid: Array<Record<string, string>> = [],
  channels: readonly string[] = ['desk'],
  personas: readonly string[] = [],
) {
  const axis = (id: string, kind: Proposal['dimensions'][number]['kind'], ids: readonly string[]) => ({
    id,
    title: id,
    kind,
    role: 'axis' as const,
    values: ids.map((id) => ({ id, title: id, ...by })),
    ...by,
  });
  const routes = (flow: Flow) => [flow.stages, ...(flow.alsoStages ?? [])];
  const stages = [...new Set(flows.flatMap((flow) => routes(flow).flat()))];
  const classes = [...new Set(flows.flatMap((flow) => flow.classes))];
  const moves = [
    ...new Set(
      flows.flatMap((flow) =>
        routes(flow).flatMap((route) => route.slice(1).map((to, i) => `${route[i]}-to-${to}`)),
      ),
    ),
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
      axis('channel', 'channel', channels),
      ...(personas.length > 0 ? [axis('persona', 'persona', personas)] : []),
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
      ...flows.flatMap((flow) =>
        routes(flow).map((route, index) => ({
          kind: 'path' as const,
          id: index === 0 ? `${flow.id}-route` : `${flow.id}-route-${index + 1}`,
          flow: flow.id,
          stages: [...route],
          ...by,
        })),
      ),
      ...flows.flatMap((flow) => {
        const seen = new Set<string>();
        return routes(flow).flatMap((route) =>
          route.slice(0, -1).flatMap((stage, index) => {
            const key = `${stage}>${route[index + 1]}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [
              {
                kind: 'states' as const,
                subject: { dimension: 'flow', value: flow.id },
                stage,
                to: route[index + 1],
                must: ['Parcel step confirmed'],
                ...by,
              },
            ];
          }),
        );
      }),
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

/** The parcel desk open on two channels: a walk can be written once per channel. */
export function twoChannels() {
  return desk(
    [
      {
        id: 'parcel',
        stages: ['welcome', 'address', 'packing', 'receipt'],
        classes: ['D1_off_topic', 'D5_language_switch'],
      },
    ],
    [{ stage: 'packing', deviation: 'D1_off_topic' }],
    ['counter', 'phone'],
  );
}

/** The parcel desk with two personas: a walk can be written once per persona. */
export function twoPersonas() {
  return desk(
    [
      {
        id: 'parcel',
        stages: ['welcome', 'address', 'packing', 'receipt'],
        classes: ['D1_off_topic', 'D5_language_switch'],
      },
    ],
    [{ stage: 'packing', deviation: 'D1_off_topic' }],
    ['desk'],
    ['novice', 'expert'],
  );
}

/** One flow with two routes to the last stage: the same last move is said after different earlier moves. */
export function twoRoutes() {
  return desk([
    {
      id: 'parcel',
      stages: ['welcome', 'address', 'packing', 'receipt'],
      alsoStages: [['welcome', 'packing', 'receipt']],
      classes: ['D1_off_topic'],
    },
  ]);
}

/** One flow whose route stays on one stage for several moves: that stage is placed far more often than the last. */
export function lingering() {
  return desk([
    {
      id: 'parcel',
      stages: ['welcome', 'address', 'address', 'address', 'address', 'address', 'receipt'],
      classes: ['D1_off_topic'],
    },
  ]);
}

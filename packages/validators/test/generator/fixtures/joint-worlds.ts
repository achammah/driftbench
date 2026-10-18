import type { DeviationClass } from '@agent-nexus/driftbench-core';
import type {
  HiddenBehaviour,
  HiddenDataValue,
  HiddenFlow,
  HiddenPath,
  HiddenRecovery,
  HiddenSpec,
  HiddenTool,
} from '../../../src/ladders/generator/hidden';

/**
 * Hand-written hidden specifications for the joint-feasibility tests. None is drawn from a seed and none
 * shares a name with the bank: they are small worlds whose reachable cells are listed by hand in the tests.
 */

const D9: DeviationClass = 'D9_out_of_scope';
const D8: DeviationClass = 'D8_tool_failure';

/** The fields every fixture shares and no oracle reads. */
function shell(): Pick<
  HiddenSpec,
  | 'seed'
  | 'transitions'
  | 'data'
  | 'uses'
  | 'tools'
  | 'constraints'
  | 'languageRule'
  | 'lang'
  | 'confirmWord'
  | 'saveFile'
  | 'goal'
  | 'confirm'
> {
  return {
    seed: 0,
    transitions: [],
    data: [],
    uses: [],
    tools: [],
    constraints: [],
    languageRule: { id: 'english-only', title: 'English only', quote: 'Reply in English only.' },
    lang: 'en',
    confirmWord: 'CONFIRM',
    saveFile: 'exports/record.json',
    goal: 'sorting',
    confirm: 'acceptance',
  };
}

function stagesOf(ids: string[]) {
  return ids.map((id) => ({ id, title: `The ${id} stage`, question: `What is needed at ${id}?` }));
}

function deviationPhrase(cls: DeviationClass) {
  return {
    dimension: 'deviation',
    value: cls,
    text: `A user turn of class ${cls}.`,
    lang: 'en',
    intent: { kind: 'deviation' as const, class: cls },
  };
}

/** A partition of the output of lookup_parcel; an invalid one breaks the schema, so no rule follower reads it. */
function outputValue(partition: string, invalid: boolean): HiddenDataValue {
  return {
    dimension: 'lookup_parcel.out.found',
    id: `lookup_parcel.out.found.${partition}`,
    tool: 'lookup_parcel',
    direction: 'out',
    field: 'found',
    partition,
    title: `found is ${partition}`,
    value: partition === 'true',
    invalid,
    quote: 'found: { type: boolean }',
  };
}

function movePhrases(next: Record<string, string>) {
  return Object.entries(next).map(([from, to]) => ({
    dimension: 'stage_transition',
    value: `${from}-to-${to}`,
    text: `Please move on to ${to}.`,
    lang: 'en',
    intent: { kind: 'transition' as const, edge: `${from}-to-${to}` },
  }));
}

function behaviourPhrase(behaviour: HiddenBehaviour) {
  return {
    dimension: 'behaviour',
    value: behaviour.id,
    text: `Please do this: ${behaviour.title}.`,
    lang: 'en',
    intent: { kind: 'behaviour' as const, behaviour: behaviour.id },
  };
}

function recovery(cls: DeviationClass, flows: string[], extra: Partial<HiddenRecovery> = {}): HiddenRecovery {
  return { class: cls, flows, stageAfter: 'pending', quote: `Recover from ${cls}.`, ...extra };
}

/**
 * The parcel desk. Posting owns B-1 and recovers D9 on its path open, acceptance, end. Tracing owns B-1 and
 * visits sorting, with no D9 recovery. Status owns B-2 and recovers D9 on open, sorting, end. Every pair of
 * B-1, D9 and sorting has a position of its own; the three together have none.
 */
export function parcelDesk(): HiddenSpec {
  const behaviours: HiddenBehaviour[] = [
    { id: 'B-1', title: 'Follow a parcel through the depot' },
    { id: 'B-2', title: 'Report where a request stands' },
  ];
  const flows: HiddenFlow[] = [
    { id: 'posting', title: 'Posting', behaviours: ['B-1'], deviations: [D9] },
    { id: 'tracing', title: 'Tracing', behaviours: ['B-1'], deviations: [] },
    { id: 'status', title: 'Status', behaviours: ['B-2'], deviations: [D9] },
  ];
  const paths: HiddenPath[] = [
    { id: 'post-path', flow: 'posting', stages: ['open', 'acceptance', 'end'], when: {}, quote: 'Post.' },
    { id: 'trace-path', flow: 'tracing', stages: ['open', 'sorting', 'end'], when: {}, quote: 'Trace.' },
    { id: 'status-path', flow: 'status', stages: ['open', 'sorting', 'end'], when: {}, quote: 'Status.' },
  ];
  return {
    ...shell(),
    agent: 'parcel-desk',
    stages: stagesOf(['open', 'sorting', 'acceptance', 'end']),
    start: 'open',
    final: 'end',
    next: { open: 'sorting', sorting: 'acceptance', acceptance: 'end' },
    behaviours,
    flows,
    deviations: [D9],
    channels: ['web', 'phone'],
    personas: [{ id: 'sender', title: 'A sender' }],
    phrases: [deviationPhrase(D9), ...behaviours.map(behaviourPhrase)],
    paths,
    recoveries: [recovery(D9, ['posting', 'status'])],
  };
}

/**
 * The read desk. One flow, post, on the path open, sorting, end. It calls lookup_parcel on the move into
 * sorting and submit_post on the move into end. B-1's own text names lookup_parcel, so the rendered map lets
 * a turn ask it at any stage, on the spot. The flow recovers a tool failure of lookup_parcel only.
 */
export function readDesk(): HiddenSpec {
  const tools: HiddenTool[] = [
    {
      name: 'lookup_parcel',
      role: 'read',
      title: 'Looks up a parcel',
      sideEffect: false,
      stage: 'sorting',
      input: [{ name: 'kind', type: 'enum', members: ['small', 'large'] }],
      output: [{ name: 'found', type: 'boolean' }],
      slot: 'lookup_parcel_kind',
    },
    {
      name: 'submit_post',
      role: 'write',
      title: 'Submits the posting',
      sideEffect: true,
      stage: 'end',
      input: [{ name: 'plan', type: 'enum', members: ['basic', 'express'] }],
      output: [{ name: 'accepted', type: 'boolean' }],
      slot: 'submit_post_plan',
    },
  ];
  const behaviours: HiddenBehaviour[] = [
    {
      id: 'B-1',
      title: 'Look the parcel up with lookup_parcel before stating where it is',
      tool: 'lookup_parcel',
    },
    { id: 'B-2', title: 'Send the posting with submit_post once the user agrees', tool: 'submit_post' },
    { id: 'B-3', title: 'Greet the user by name' },
  ];
  return {
    ...shell(),
    agent: 'read-desk',
    stages: stagesOf(['open', 'sorting', 'end']),
    start: 'open',
    final: 'end',
    goal: 'sorting',
    confirm: 'sorting',
    next: { open: 'sorting', sorting: 'end' },
    tools,
    behaviours,
    flows: [{ id: 'post', title: 'Post', behaviours: ['B-1', 'B-2', 'B-3'], deviations: [D8] }],
    deviations: [D8],
    channels: ['web', 'phone'],
    personas: [{ id: 'sender', title: 'A sender' }],
    data: [outputValue('true', false), outputValue('false', false), outputValue('garbled', true)],
    phrases: [...movePhrases({ open: 'sorting', sorting: 'end' }), ...behaviours.map(behaviourPhrase)],
    paths: [{ id: 'post-path', flow: 'post', stages: ['open', 'sorting', 'end'], when: {}, quote: 'Post.' }],
    uses: [
      {
        flow: 'post',
        tool: 'lookup_parcel',
        from: 'open',
        to: 'sorting',
        input: { kind: '{lookup_parcel_kind}' },
        quote: 'lookup_parcel',
      },
      {
        flow: 'post',
        tool: 'submit_post',
        from: 'sorting',
        to: 'end',
        input: { plan: '{submit_post_plan}' },
        quote: 'submit_post',
      },
    ],
    recoveries: [recovery(D8, ['post'], { tool: 'lookup_parcel' })],
  };
}

/**
 * The fork desk. One flow, route, with two paths from a: one moves to b and one to c, each on its own branch
 * value. Only the move into b calls the read tool, so a tool failure can arrive at a on the first branch only.
 */
export function forkDesk(): HiddenSpec {
  const tool: HiddenTool = {
    name: 'check_route',
    role: 'read',
    title: 'Checks a route',
    sideEffect: false,
    stage: 'b',
    input: [{ name: 'kind', type: 'enum', members: ['fast', 'slow'] }],
    output: [{ name: 'found', type: 'boolean' }],
    slot: 'check_route_kind',
  };
  return {
    ...shell(),
    agent: 'fork-desk',
    stages: stagesOf(['start', 'a', 'b', 'c']),
    start: 'start',
    final: 'b',
    goal: 'a',
    confirm: 'a',
    next: { start: 'a', a: 'b' },
    tools: [tool],
    behaviours: [{ id: 'B-1', title: 'Greet the user by name' }],
    flows: [{ id: 'route', title: 'Route', behaviours: ['B-1'], deviations: [D8] }],
    deviations: [D8],
    channels: ['web'],
    personas: [{ id: 'sender', title: 'A sender' }],
    phrases: [],
    paths: [
      {
        id: 'to-b',
        flow: 'route',
        stages: ['start', 'a', 'b'],
        when: { branch: ['branch.one'] },
        quote: 'One.',
      },
      {
        id: 'to-c',
        flow: 'route',
        stages: ['start', 'a', 'c'],
        when: { branch: ['branch.two'] },
        quote: 'Two.',
      },
    ],
    uses: [
      {
        flow: 'route',
        tool: 'check_route',
        from: 'a',
        to: 'b',
        input: { kind: '{check_route_kind}' },
        quote: 'check_route',
      },
    ],
    recoveries: [recovery(D8, ['route'], { tool: 'check_route' })],
  };
}

import type { Inventory } from '@agent-nexus/driftbench-core';
import { type Proposal, type ProposalDimension, renderProposal } from '@agent-nexus/driftbench-generate';
import { NONE, type SpaceMap } from '@agent-nexus/driftbench-space';
import { codeTask } from './code-task';
import { defaultValue } from './follower';
import type { HiddenProperty, HiddenSpec } from './hidden';
import { DEVIATION_RULES } from './hidden';
import { behaviourReadTool, impossiblePairs, renderedWhen } from './possible';

/**
 * The hidden specification rendered as the artefacts a real agent has, and as the approved map the
 * generator reads. The extractor is not under test here, so the map is written from the specification by
 * code: every value quotes the line of the rendered prompt, inventory or tools file that states it, so the
 * generator's loader accepts it as it accepts an extracted and approved map.
 */

/** The file names of a rendered map, in one folder. */
export const MAP_FILES = {
  map: 'approved.yaml',
  prompt: 'prompt.md',
  inventory: 'inventory.yaml',
  tools: 'tools.yaml',
  family: 'family.yaml',
  oracle: 'oracle.mjs',
} as const;

/** The fixed date every rendered map records, so a seed renders the same bytes on any day. */
export const RENDERED_AT = '2026-10-11T00:00:00.000Z';

export type RenderedMap = Record<keyof typeof MAP_FILES, string>;

function title(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/** Reply requirements from the hidden flow contract, also printed in the prompt as source evidence. */
function replyRules(spec: HiddenSpec) {
  const seen = new Set<string>();
  return spec.paths.flatMap((path) =>
    path.stages.slice(1).flatMap((to, index) => {
      const from = path.stages[index] as string;
      const key = `${path.flow}:${from}:${to}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const called = spec.tools.find((tool) => tool.stage === to);
      const question = spec.stages.find((stage) => stage.id === to)?.question;
      const must = [
        ...(question ? [escapePattern(question)] : []),
        ...(called?.output.map(
          (property) =>
            `${escapePattern(called.name.replace(/_/g, ' '))} says ${escapePattern(property.name)} is {${called.name}_out_${property.name}}\\.`,
        ) ?? []),
      ];
      const mustNot = [
        'Step [0-9]+:',
        ...spec.tools
          .filter((tool) => tool !== called)
          .map((tool) => `${escapePattern(tool.name.replace(/_/g, ' '))} says `),
      ];
      const quote = `In ${path.flow}, a turn from ${from} to ${to} asks "${question ?? ''}", states every returned field of ${called?.name ?? 'no tool'}, never states facts of an uncalled tool, and never narrates internal steps with "Step <number>:".`;
      return [{ flow: path.flow, from, to, must, mustNot, quote }];
    }),
  );
}

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The prompt: stages, moves, users and rules, one sentence per entry the map quotes. */
export function renderPrompt(spec: HiddenSpec): string {
  const lines = [
    `# The ${spec.agent} assistant`,
    '',
    `A fictional agent the generator validator drew from seed ${spec.seed}. Every name and value is made up.`,
    '',
    '## Stages',
    '',
    ...spec.stages.map((stage) => `- ${stage.id}: ${title(stage.title)} It asks: "${stage.question}"`),
    '',
    '## Moves',
    '',
    ...spec.transitions.map((edge) => `- ${edge.rule}`),
    '',
    '## Tools',
    '',
    ...spec.tools.map(
      (tool) =>
        `- ${tool.name}: ${title(tool.title)}${tool.stage ? ` It runs when the conversation reaches ${tool.stage}.` : ''}${tool.sideEffect ? ' It changes the world, so it runs only after CONFIRM and is never retried.' : ' It only reads.'}`,
    ),
    '',
    '## Reply requirements',
    '',
    'Each returned field is stated as "<tool label with spaces> says <field> is <value>." Unspecified required integer inputs use their schema minimum.',
    ...replyRules(spec).map((rule) => `- ${rule.quote}`),
    '',
    codeTask(spec).quote,
    '',
    '## Users',
    '',
    ...spec.personas.map((persona) => `- ${persona.id}: ${title(persona.title)}`),
    '',
    '## Rules',
    '',
    ...spec.deviations.map((cls) => `- ${DEVIATION_RULES[cls]}`),
    ...spec.constraints
      .filter((constraint) => constraint.source === 'prompt')
      .map((constraint) => `- ${constraint.quote}`),
    '',
  ];
  return lines.join('\n');
}

/** The behaviour inventory: channels, behaviours with the channels they apply on, flows with their deviations. */
export function renderInventory(spec: HiddenSpec): string {
  const lines = [
    `# The ${spec.agent} behaviour inventory, drawn by the generator validator. Fictional.`,
    `channels: [${spec.channels.join(', ')}]`,
    '',
    'behaviours:',
  ];
  for (const behaviour of spec.behaviours) {
    lines.push(`  - id: ${behaviour.id}`, `    title: ${behaviour.title}`);
    if (behaviour.channels) lines.push(`    channels: [${behaviour.channels.join(', ')}]`);
  }
  lines.push('', 'flows:');
  for (const flow of spec.flows) {
    lines.push(
      `  - id: ${flow.id}`,
      `    title: ${flow.title}`,
      `    behaviours: [${flow.behaviours.join(', ')}]`,
    );
    if (flow.deviations.length > 0) lines.push(`    deviations: [${flow.deviations.join(', ')}]`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * One property of a tool schema. An input property states its `default`: the value the rule follower sends
 * when the conversation names none (follower.ts#defaultValue), so a direct call's other arguments are in the
 * tools file, as the prompt says in prose ("Unspecified required integer inputs use their schema minimum").
 */
function propertyLine(property: HiddenProperty, input: boolean): string {
  const fallback = input ? `, default: ${String(defaultValue(property))}` : '';
  if (property.type === 'enum')
    return `${property.name}: { type: string, enum: [${property.members.join(', ')}]${fallback} }`;
  if (property.type === 'boolean') return `${property.name}: { type: boolean${fallback} }`;
  return `${property.name}: { type: integer, minimum: ${property.minimum}, maximum: ${property.maximum}${fallback} }`;
}

/** The tool schemas, in the `tools` list form the extractor and the generator read. */
export function renderTools(spec: HiddenSpec): string {
  const lines = [`# The ${spec.agent} tools, drawn by the generator validator. Fictional.`, 'tools:'];
  for (const tool of spec.tools) {
    lines.push(`  - name: ${tool.name}`, `    description: ${tool.title}`);
    for (const [key, properties] of [
      ['input_schema', tool.input],
      ['output_schema', tool.output],
    ] as const) {
      lines.push(
        `    ${key}:`,
        '      type: object',
        `      required: [${properties.map((property) => property.name).join(', ')}]`,
        '      properties:',
        ...properties.map((property) => `        ${propertyLine(property, key === 'input_schema')}`),
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** The approved map: every dimension, constraint and phrase of the hidden specification, approved. */
export function hiddenProposal(spec: HiddenSpec): Proposal {
  const inventory = `./${MAP_FILES.inventory}`;
  const prompt = `./${MAP_FILES.prompt}`;
  const tools = `./${MAP_FILES.tools}`;
  const dimension = (
    id: string,
    titleText: string,
    kind: ProposalDimension['kind'],
    role: ProposalDimension['role'],
    values: ProposalDimension['values'],
  ): ProposalDimension => ({ id, title: titleText, kind, role, produced_by: 'code', approved: true, values });
  const dimensions: ProposalDimension[] = [
    dimension(
      'behaviour',
      'The behaviours the inventory lists',
      'behaviour',
      'axis',
      spec.behaviours.map((behaviour) => ({
        id: behaviour.id,
        title: behaviour.title,
        evidence: { source: inventory, quote: `id: ${behaviour.id}\n    title: ${behaviour.title}` },
        produced_by: 'code',
      })),
    ),
    dimension(
      'flow',
      'The flows the inventory lists',
      'behaviour',
      'detail',
      spec.flows.map((flow) => ({
        id: flow.id,
        title: flow.title,
        evidence: { source: inventory, quote: `id: ${flow.id}\n    title: ${flow.title}` },
        produced_by: 'code',
      })),
    ),
    dimension(
      'deviation',
      'The deviation classes the flows must be perturbed with',
      'deviation',
      'axis',
      spec.deviations.map((cls) => {
        const flow = spec.flows.find((candidate) => candidate.deviations.includes(cls));
        return {
          id: cls,
          title: DEVIATION_RULES[cls],
          evidence: { source: inventory, quote: `deviations: [${flow?.deviations.join(', ')}]` },
          produced_by: 'code',
        };
      }),
    ),
    dimension(
      'channel',
      'The channels the inventory names',
      'channel',
      'axis',
      spec.channels.map((channel) => ({
        id: channel,
        title: `On ${channel}`,
        evidence: { source: inventory, quote: `channels: [${spec.channels.join(', ')}]` },
        produced_by: 'code',
      })),
    ),
  ];
  const byDimension = new Map<string, typeof spec.data>();
  for (const value of spec.data)
    byDimension.set(value.dimension, [...(byDimension.get(value.dimension) ?? []), value]);
  for (const [id, values] of byDimension) {
    const first = values[0];
    dimensions.push(
      dimension(
        id,
        `${first?.tool} ${first?.direction === 'in' ? 'input' : 'output'} ${first?.field}`,
        'data',
        'detail',
        values.map((value) => ({
          id: value.id,
          title: value.title,
          evidence: { source: tools, quote: value.quote },
          produced_by: 'code',
        })),
      ),
    );
  }
  dimensions.push(
    dimension(
      'stage',
      'The flow stage a turn ends in',
      'stage',
      'axis',
      spec.stages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        evidence: { source: prompt, quote: `${stage.id}: ${title(stage.title)}` },
        produced_by: 'code',
      })),
    ),
    dimension(
      'stage_transition',
      'A move from one stage to the next',
      'behaviour',
      'detail',
      spec.transitions.map((edge) => ({
        id: edge.id,
        title: edge.title,
        evidence: { source: prompt, quote: edge.rule },
        produced_by: 'code',
      })),
    ),
    dimension(
      'user_type',
      'Who is talking to the agent',
      'persona',
      'axis',
      spec.personas.map((persona) => ({
        id: persona.id,
        title: persona.title,
        evidence: { source: prompt, quote: `${persona.id}: ${title(persona.title)}` },
        produced_by: 'code',
      })),
    ),
    dimension('rule', 'A rule the agent follows that the inventory does not name', 'behaviour', 'detail', [
      {
        id: spec.languageRule.id,
        title: spec.languageRule.title,
        evidence: { source: prompt, quote: spec.languageRule.quote },
        produced_by: 'code',
      },
    ]),
  );
  const common = { produced_by: 'code' as const, approved: true };
  const relations: NonNullable<Proposal['relations']> = [
    {
      kind: 'reply_language',
      subject: { dimension: 'rule', value: spec.languageRule.id },
      lang: spec.lang,
      evidence: { source: prompt, quote: spec.languageRule.quote },
      ...common,
    },
    ...spec.paths.map((path) => ({
      kind: 'path' as const,
      id: path.id,
      flow: path.flow,
      when: renderedWhen(spec, path),
      stages: [...path.stages],
      behaviours: [...(spec.flows.find((flow) => flow.id === path.flow)?.behaviours ?? [])],
      ...(path.endState
        ? {
            end_state: {
              source: `tool:${path.endState.tool}`,
              mode: 'subset' as const,
              expect: { ...path.endState.expect },
            },
          }
        : {}),
      evidence: { source: prompt, quote: path.quote },
      ...common,
    })),
    ...spec.uses.map((use) => ({
      kind: 'uses_tool' as const,
      subject: { dimension: 'flow', value: use.flow },
      tool: use.tool,
      stage: use.from,
      to: use.to,
      input: {
        ...Object.fromEntries(
          (spec.tools.find((tool) => tool.name === use.tool)?.input ?? []).map((property) => [
            property.name,
            property.type === 'enum'
              ? (property.members[0] as string)
              : property.type === 'integer'
                ? property.minimum
                : true,
          ]),
        ),
        ...use.input,
      },
      evidence: { source: prompt, quote: use.quote },
      ...common,
    })),
    // A behaviour whose own text names its read tool runs it when asked, at any stage and
    // without moving: a map built from that text states the call. A behaviour that never names its tool stays
    // unlinked, so the map holds nothing the generator could not read from the inventory.
    ...spec.behaviours.flatMap((behaviour) => {
      const tool = behaviourReadTool(spec, behaviour);
      if (!tool) return [];
      return spec.stages.map((stage) => ({
        kind: 'uses_tool' as const,
        subject: { dimension: 'behaviour', value: behaviour.id },
        tool: tool.name,
        stage: stage.id,
        to: stage.id,
        evidence: { source: inventory, quote: `id: ${behaviour.id}\n    title: ${behaviour.title}` },
        ...common,
      }));
    }),
    ...replyRules(spec).map((rule) => ({
      kind: 'states' as const,
      subject: { dimension: 'flow', value: rule.flow },
      stage: rule.from,
      to: rule.to,
      must: rule.must,
      must_not: rule.mustNot,
      evidence: { source: prompt, quote: rule.quote },
      ...common,
    })),
    ...spec.data
      .filter((value) => value.binds !== undefined || value.direction === 'out')
      .map((value) => ({
        kind: 'binds' as const,
        subject: { dimension: value.dimension, value: value.id },
        slots: {
          ...value.binds,
          ...(value.direction === 'out' ? { [`${value.tool}_out_${value.field}`]: String(value.value) } : {}),
        },
        evidence: { source: tools, quote: value.quote },
        ...common,
      })),
    {
      kind: 'task_family' as const,
      flow: codeTask(spec).flow,
      family: '.',
      stages: [spec.goal, spec.goal],
      evidence: { source: prompt, quote: codeTask(spec).quote },
      ...common,
    },
    ...spec.recoveries.map((recovery) => ({
      kind: 'recovery' as const,
      class: recovery.class,
      flows: [...recovery.flows],
      ...(recovery.tool ? { tool: recovery.tool } : {}),
      stage_after: recovery.stageAfter,
      ...(recovery.must ? { must: [...recovery.must] } : {}),
      ...(recovery.mustNot ? { must_not: [...recovery.mustNot] } : {}),
      ...(recovery.tools
        ? { tools: recovery.tools.map((tool) => ({ tool: tool.tool, count: tool.count })) }
        : {}),
      evidence: { source: prompt, quote: recovery.quote },
      ...common,
    })),
  ];
  return {
    version: 1,
    agent: spec.agent,
    produced_by: {
      family: 'code',
      model: 'driftbench validate generator, the hidden specification',
      at: RENDERED_AT,
    },
    sources: [
      { kind: 'prompt', path: prompt },
      { kind: 'inventory', path: inventory },
      { kind: 'tools', path: tools },
    ],
    dimensions,
    constraints: spec.constraints.map((constraint) => ({
      forbid: { ...constraint.forbid },
      reason: constraint.reason,
      evidence: { source: constraint.source === 'inventory' ? inventory : prompt, quote: constraint.quote },
      produced_by: 'code',
      approved: true,
    })),
    phrases: spec.phrases.map((phrase) => ({
      dimension: phrase.dimension,
      value: phrase.value,
      text: phrase.text,
      lang: phrase.lang,
      produced_by: 'model',
      approved: true,
    })),
    relations,
  };
}

/** Every file of the rendered map, by name. Pure: the same specification gives the same text. */
export function renderMap(spec: HiddenSpec): RenderedMap {
  return {
    map: renderProposal(hiddenProposal(spec)),
    prompt: renderPrompt(spec),
    inventory: renderInventory(spec),
    tools: renderTools(spec),
    family: codeTask(spec).family,
    oracle: codeTask(spec).oracle,
  };
}

/** The inventory of the hidden specification, as the core reads one. */
export function hiddenInventory(spec: HiddenSpec): Inventory {
  return {
    channels: [...spec.channels],
    behaviours: spec.behaviours.map((behaviour) => ({
      id: behaviour.id,
      title: behaviour.title,
      kind: 'conversation' as const,
      ...(behaviour.channels ? { channels: [...behaviour.channels] } : {}),
    })),
    flows: spec.flows.map((flow) => ({
      id: flow.id,
      title: flow.title,
      behaviours: [...flow.behaviours],
      deviations: [...flow.deviations],
    })),
  };
}

/**
 * The hidden cells: the space map built from the specification itself, never from the rendered map, so
 * a map that lost a dimension or a value is caught by the coverage level.
 */
export function hiddenSpaceMap(spec: HiddenSpec): SpaceMap {
  return {
    version: '1',
    agent: spec.agent,
    dimensions: [
      {
        id: 'behaviour',
        title: 'Behaviours',
        kind: 'behaviour',
        values: spec.behaviours.map((behaviour) => ({ id: behaviour.id, title: behaviour.title })),
      },
      {
        id: 'deviation',
        title: 'Deviations',
        kind: 'deviation',
        values: [
          { id: NONE, title: 'No deviation' },
          ...spec.deviations.map((cls) => ({ id: cls, title: DEVIATION_RULES[cls] })),
        ],
      },
      {
        id: 'channel',
        title: 'Channels',
        kind: 'channel',
        values: spec.channels.map((channel) => ({ id: channel, title: channel })),
      },
      {
        id: 'stage',
        title: 'Stages',
        kind: 'stage',
        values: spec.stages.map((stage) => ({ id: stage.id, title: stage.title })),
      },
      {
        id: 'user_type',
        title: 'Users',
        kind: 'persona',
        values: spec.personas.map((persona) => ({ id: persona.id, title: persona.title })),
      },
    ],
    // The written constraints, and the pairs no path of the map can reach (possible.ts): a cell the agent's
    // own map rules out is not allowed, so no coverage item asks for it.
    constraints: [
      ...spec.constraints.map((constraint) => ({
        forbid: { ...constraint.forbid },
        reason: constraint.reason,
      })),
      ...impossible(spec),
    ],
    prior: { kind: 'declared' },
  };
}

const impossibleMemo = new WeakMap<HiddenSpec, Array<{ forbid: Record<string, string>; reason: string }>>();

function impossible(spec: HiddenSpec): Array<{ forbid: Record<string, string>; reason: string }> {
  const known = impossibleMemo.get(spec);
  if (known) return known;
  const pairs = impossiblePairs(spec);
  impossibleMemo.set(spec, pairs);
  return pairs;
}

import { Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { ProposalRelation } from '../../src/extract/proposal';
import { renderDraft } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { phraseDrafts } from '../../src/seed/phrase-seeder';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const evidence = {
  source: 'prompt.md',
  quote: 'A balance enquiry reads the account and its rating at verify.',
};
const by = { evidence, produced_by: 'code' as const, approved: true };
const subject = { dimension: 'behaviour', value: 'balance-enquiry' };

function specimen(calls: ProposalRelation[]) {
  const proposal = zedProposal({
    extra: [
      {
        id: 'service-plan',
        title: 'Service plan',
        kind: 'data',
        role: 'detail',
        ...by,
        values: [
          { id: 'basic', title: 'Basic', ...by },
          { id: 'premium', title: 'Premium', ...by },
        ],
      },
      {
        id: 'behaviour',
        title: 'Things the assistant does',
        kind: 'behaviour',
        role: 'axis',
        ...by,
        values: [{ id: 'balance-enquiry', title: 'Read the balance', ...by }],
      },
    ],
  });
  proposal.phrases.push({
    dimension: 'behaviour',
    value: 'balance-enquiry',
    text: 'Please check the balance.',
    lang: 'en',
    produced_by: 'code',
    approved: true,
  });
  proposal.relations = [
    {
      kind: 'path',
      id: 'card-first',
      flow: 'card',
      stages: ['greet', 'verify'],
      behaviours: [subject.value],
      ...by,
    },
    {
      kind: 'path',
      id: 'balance-second',
      flow: 'balance',
      stages: ['greet', 'verify'],
      behaviours: [subject.value],
      ...by,
    },
    { kind: 'binds', subject: { dimension: 'flow', value: 'balance' }, slots: { account: '821' }, ...by },
    ...calls,
  ];
  const prepared = prepareMap(proposal, {
    tools: [
      ...ZED_TOOLS,
      { name: 'notify', slug: 'notify', input: { type: 'object', properties: {} } },
      {
        name: 'rating',
        slug: 'rating',
        input: { type: 'object', properties: { customer: { type: 'string' } } },
      },
    ],
  });
  const drafts = phraseDrafts(prepared, { seed: 37, t: 2, max: 100 }, new Set(), 0);
  const draft = drafts.find((d) => d.title.includes('behaviour=balance-enquiry'));
  expect(draft).toBeDefined();
  if (!draft) throw new Error('missing balance enquiry');
  return {
    draft,
    cell: Object.fromEntries(
      draft.cell.map(([di, vi]) => [
        prepared.space.dimensions[di]?.id,
        prepared.space.dimensions[di]?.values[vi]?.id,
      ]),
    ),
    rendered: Spec.parse(renderDraft(prepared, draft, { seed: 37, mapPath: '../approved.yaml' }).spec),
  };
}

describe('conditional tool calls in a behaviour phrase', () => {
  it('places the phrase only where its flow and stage conditions hold', () => {
    const { draft } = specimen([
      {
        kind: 'uses_tool',
        subject,
        tool: 'lookup',
        stage: 'verify',
        to: 'verify',
        when: { flow: ['balance'], stage: ['verify'] },
        ...by,
      },
    ]);
    expect(draft.path).toBe('balance-second');
    expect(draft.blocks.at(-1)?.tools).toEqual([{ label: 'lookup', count: 1 }]);
  });
  it('honours a conjunction of channel, persona and an arbitrary detail dimension', () => {
    const { cell, rendered } = specimen([
      {
        kind: 'uses_tool',
        subject,
        tool: 'lookup',
        stage: 'verify',
        when: { flow: ['balance'], channel: ['email'], user: ['staff'], 'service-plan': ['premium'] },
        input: { account: '{account}' },
        ...by,
      },
      {
        kind: 'uses_tool',
        subject,
        tool: 'rating',
        stage: 'verify',
        when: { channel: ['email'], user: ['staff'], 'service-plan': ['premium'] },
        input: { customer: '{account}' },
        ...by,
      },
      {
        kind: 'uses_tool',
        subject,
        tool: 'notify',
        stage: 'verify',
        when: { flow: ['balance'], channel: ['chat'] },
        ...by,
      },
    ]);
    expect(cell).toMatchObject({
      flow: 'balance',
      channel: 'email',
      user: 'staff',
      'service-plan': 'premium',
    });
    expect(rendered?.blocks.at(-1)?.expect?.tools).toEqual([
      { label: 'lookup', count: 1, input: { account: '821' }, input_closed: true },
      { label: 'rating', count: 1, input: { customer: '821' }, input_closed: true },
    ]);
  });
  it('fills approved input slots and keeps every applicable call and count', () => {
    const { draft } = specimen([
      {
        kind: 'uses_tool',
        subject,
        tool: 'lookup',
        stage: 'verify',
        when: { flow: ['balance'] },
        count: 2,
        input: { account: '{account}' },
        ...by,
      },
      {
        kind: 'uses_tool',
        subject,
        tool: 'rating',
        stage: 'verify',
        when: { flow: ['balance'] },
        input: { customer: '{account}' },
        ...by,
      },
      { kind: 'uses_tool', subject, tool: 'notify', stage: 'help', when: { flow: ['card'] }, ...by },
    ]);
    expect(draft.path).toBe('balance-second');
    expect(draft.blocks.at(-1)?.tools).toEqual([
      { label: 'lookup', count: 2, input: { account: '821' }, input_closed: true },
      { label: 'rating', count: 1, input: { customer: '821' }, input_closed: true },
    ]);
  });
});

import type { Proposal } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';
import { impossibleConstraints } from '../../src/seed/possible';
import { coverDraft, flowsOfBehaviour } from '../../src/seed/seed-drafts';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const evidence = { source: 'prompt.md', quote: 'Check balance reads the account.' };
export const by = { evidence, produced_by: 'code' as const, approved: true };
export const context = { seed: 42, t: 2, max: 100 };

// Hand-written input, independent of the validator's generated maps and item bank. The balance flow walks
// greet, verify, help; its move to verify calls lookup. The behaviour CHECK-11 is a read of the account: its
// own turn runs lookup at any stage. CHECK-22 asks for no tool.
export function tideMap(change: (proposal: Proposal) => void = () => {}, tool = 'lookup') {
  const proposal = zedProposal({
    extra: [
      {
        id: 'policy',
        title: 'Policy',
        kind: 'behaviour',
        role: 'axis',
        ...by,
        values: [
          { id: 'CHECK-11', title: 'Check the account', ...by },
          { id: 'CHECK-22', title: 'Keep it short', ...by },
        ],
      },
    ],
  });
  proposal.constraints = [];
  proposal.phrases.push(
    { dimension: 'policy', value: 'CHECK-11', text: 'Please read my account out.', lang: 'en', ...by },
    { dimension: 'policy', value: 'CHECK-22', text: 'Keep it short.', lang: 'en', ...by },
  );
  proposal.relations = [
    { kind: 'path', id: 'amount', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    {
      kind: 'uses_tool',
      subject: { dimension: 'flow', value: 'balance' },
      tool,
      stage: 'greet',
      to: 'verify',
      input: { account: '4' },
      ...by,
    },
    ...['greet', 'verify', 'help'].map((stage) => ({
      kind: 'uses_tool' as const,
      subject: { dimension: 'policy', value: 'CHECK-11' },
      tool,
      stage,
      to: stage,
      input: { account: '4' },
      ...by,
    })),
    {
      kind: 'recovery',
      class: 'D8_tool_failure',
      flows: ['balance'],
      tool,
      stage_after: 'pending',
      tools: [{ tool, count: 2 }],
      ...by,
    },
  ];
  change(proposal);
  return prepareMap(proposal, {
    tools: ZED_TOOLS.map((entry) => ({ ...entry, name: tool, slug: tool })),
    inventory: {
      behaviours: [
        { id: 'CHECK-11', title: 'Check the account', kind: 'conversation' },
        { id: 'CHECK-22', title: 'Keep it short', kind: 'conversation' },
      ],
      flows: [{ id: 'balance', title: 'Balance', behaviours: ['CHECK-11', 'CHECK-22'] }],
    },
  });
}

/**
 * What the three readers say about the cell (stage, D8_tool_failure) of a tide map changed by `change`: the
 * space the map derives, the target (`impossibleConstraints`, read without the constraints the map derived, which
 * already rule a cell out by themselves) and the builder (`coverDraft`).
 */
export function readers(stageName: string, change: (proposal: Proposal) => void = () => {}) {
  const prepared = tideMap(change, 'read_tide');
  const stage = prepared.stage as number;
  const deviation = prepared.deviation as number;
  const at = prepared.space.dimensions[stage]?.index.get(stageName) as number;
  const failure = prepared.space.dimensions[deviation]?.index.get('D8_tool_failure') as number;
  const bare = { ...prepared, space: { ...prepared.space, constraints: [] } };
  const ruledOut = impossibleConstraints(bare, flowsOfBehaviour).some(
    (pair) =>
      pair.some(([dimension, value]) => dimension === stage && value === at) &&
      pair.some(([dimension, value]) => dimension === deviation && value === failure),
  );
  const built = coverDraft(prepared, context, 'cover', { deviation: 'D8_tool_failure', stage: stageName });
  return {
    space: prepared.feasibility.allowed([
      [stage, at],
      [deviation, failure],
    ]),
    target: !ruledOut,
    builder: 'draft' in built,
  };
}

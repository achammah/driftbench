import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { Proposal } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

// A map built by hand, outside the validator's bank: the Zed Bank fixture with one behaviour whose call the
// map states ("Look up the account before you answer" runs lookup, at verify and help, without moving).
const by = {
  produced_by: 'code' as const,
  approved: true,
  evidence: { source: 'prompt.md', quote: 'Look up the account before you answer.' },
};

function prepared() {
  const proposal = zedProposal();
  proposal.dimensions.push({
    id: 'behaviour',
    title: 'The behaviours the inventory lists',
    kind: 'behaviour',
    role: 'axis',
    produced_by: 'code',
    approved: true,
    values: [{ id: 'B-1', title: 'Look up the account before you answer', ...by }],
  });
  proposal.phrases.push(
    {
      dimension: 'behaviour',
      value: 'B-1',
      text: 'Please look up my account before you answer.',
      lang: 'en',
      produced_by: 'model',
      approved: true,
    },
    {
      dimension: 'stage_transition',
      value: 'verify-to-verify',
      text: 'Sorry, let me give you the number again.',
      lang: 'en',
      produced_by: 'model',
      approved: true,
    },
  );
  const found = ['lookup.out.found.true', 'lookup.out.found.false'];
  proposal.relations = [
    {
      kind: 'path',
      id: 'balance-again',
      flow: 'balance',
      behaviours: ['B-1'],
      stages: ['greet', 'verify', 'verify', 'help'],
      when: { 'lookup.out.found': found },
      ...by,
    },
    {
      kind: 'uses_tool',
      subject: { dimension: 'flow', value: 'balance' },
      tool: 'lookup',
      stage: 'greet',
      to: 'verify',
      input: { account: '4' },
      ...by,
    },
    ...found.map((value) => ({
      kind: 'binds' as const,
      subject: { dimension: 'lookup.out.found', value },
      slots: { lookup_found: value.endsWith('true') ? 'true' : 'false' },
      ...by,
    })),
    {
      kind: 'states',
      subject: { dimension: 'flow', value: 'balance' },
      stage: 'greet',
      to: 'verify',
      must: ['lookup says found is {lookup_found}\\.'],
      ...by,
    },
    ...['verify', 'help'].map((stage) => ({
      kind: 'uses_tool' as const,
      subject: { dimension: 'behaviour', value: 'B-1' },
      tool: 'lookup',
      stage,
      to: stage,
      ...by,
    })),
  ];
  return prepareMap(Proposal.parse(proposal), { tools: ZED_TOOLS });
}

describe('a behaviour call on a map outside the bank', () => {
  it('runs in the behaviour phrase turn, which reads the returned field, and never on a move', () => {
    const suite = generateSuite(prepared(), { mapPath: '../map.yaml', t: 2, seed: 1 });
    const turns = suite.all.flatMap((spec) => spec.blocks.map((block) => ({ spec: spec.id, block })));
    const asked = turns.filter(
      ({ block }) =>
        'user' in block.when && block.when.user === 'Please look up my account before you answer.',
    );
    expect(asked.length).toBeGreaterThan(0);
    for (const { spec, block } of asked) {
      expect(block.expect?.tools?.find((call) => call.label === 'lookup')?.count, spec).toBe(1);
      expect(block.expect?.must ?? [], spec).toContainEqual(
        expect.stringMatching(/^lookup says found is (true|false)/),
      );
    }
    // The verify-to-verify move says the account again: the flow states no call there, and the behaviour's call
    // is never made on a move.
    const again = turns.filter(
      ({ block }) => 'user' in block.when && block.when.user === 'Sorry, let me give you the number again.',
    );
    expect(again.length).toBeGreaterThan(0);
    for (const { spec, block } of again)
      expect(block.expect?.tools?.find((call) => call.label === 'lookup')?.count ?? 0, spec).toBe(0);
  });
});

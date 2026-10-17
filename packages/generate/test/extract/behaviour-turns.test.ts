import { describe, expect, it } from 'vitest';
import { failableBehaviourTurns, flowsHolding } from '../../src/extract/behaviour-turns';
import type { Proposal } from '../../src/extract/proposal';
import { by, readers, tideMap } from '../seed/tide';

// Invented tide-gauge map (test/seed/tide.ts): the balance flow walks greet, verify, help and calls the tool
// on its move out of greet; the behaviour CHECK-11 reads the same tool on a turn of its own at every stage.
const policy = (dimension: string) => dimension === 'policy';

const turnsOf = (isBehaviour: (dimension: string) => boolean, change?: (proposal: Proposal) => void) => {
  const prepared = tideMap(change, 'read_tide');
  return failableBehaviourTurns({
    relations: prepared.relations,
    phrases: prepared.phrases,
    inventory: prepared.inventory,
    isBehaviour,
  });
};

/** The behaviour's use at verify now names help as the stage it ends at: the call leaves the stage. */
const leavesVerify = (proposal: Proposal) => {
  for (const relation of proposal.relations ?? [])
    if (
      relation.kind === 'uses_tool' &&
      relation.subject.dimension === 'policy' &&
      relation.stage === 'verify'
    )
      relation.to = 'help';
};

describe('failableBehaviourTurns', () => {
  it('returns the staying turn of the behaviour at each stage, with the flow that recovers', () => {
    const turns = turnsOf(policy);
    expect(turns.map(({ use }) => use.stage)).toEqual(['greet', 'verify', 'help']);
    for (const { use, flows } of turns) {
      expect(use.subject).toEqual({ dimension: 'policy', value: 'CHECK-11' });
      expect(flows).toEqual(['balance']);
    }
  });

  it('leaves out a use that leaves its stage: that call is made on a move, not on a turn of its own', () => {
    expect(turnsOf(policy, leavesVerify).map(({ use }) => use.stage)).toEqual(['greet', 'help']);
  });

  it('never returns a use whose subject is the flow, whatever the caller says is a behaviour', () => {
    // The flow's own call is a move of the walk; a caller that reads every dimension as a behaviour still gets
    // none of them.
    const turns = turnsOf(
      () => true,
      (proposal) => {
        // A move of the flow that stays on its stage (verify to verify) and calls the tool: it looks like a turn
        // of its own and is not one.
        proposal.relations?.push({
          kind: 'uses_tool',
          subject: { dimension: 'flow', value: 'balance' },
          tool: 'read_tide',
          stage: 'verify',
          to: 'verify',
          input: { account: '4' },
          ...by,
        });
      },
    );
    expect(turns.length).toBeGreaterThan(0);
    for (const { use } of turns) expect(use.subject.dimension).not.toBe('flow');
  });

  it('returns nothing for a subject whose dimension the caller does not read as a behaviour', () => {
    expect(turnsOf(() => false)).toEqual([]);
    expect(turnsOf((dimension) => dimension === 'user')).toEqual([]);
  });
});

describe('flowsHolding', () => {
  it('lists the flows the inventory holds the behaviour in, and the flow that has the behaviour for a name', () => {
    const prepared = tideMap(undefined, 'read_tide');
    const paths = prepared.relations.paths;
    expect(flowsHolding(prepared.inventory, paths, 'CHECK-11')).toEqual(['balance']);
    // A behaviour value that is the name of a flow with a path is held by that flow, listed or not.
    expect(flowsHolding(undefined, paths, 'balance')).toEqual(['balance']);
    expect(flowsHolding(prepared.inventory, paths, 'balance')).toEqual(['balance']);
    expect(flowsHolding(undefined, paths, 'CHECK-11')).toEqual([]);
  });
});

describe('the three readers on a use that leaves its stage', () => {
  it('rule the cell out together; the stage the use still names stays a cell of the tool failure', () => {
    expect(readers('verify', leavesVerify)).toEqual({ space: false, target: false, builder: false });
    expect(readers('help', leavesVerify)).toEqual({ space: true, target: true, builder: true });
  });
});

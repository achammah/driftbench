import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { stackRuns } from '../../src/ladders/pointer/bank/families/stack';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { stackSpecs } from '../../src/ladders/pointer/bank/specs/stack';
import type { PointerItem } from '../../src/ladders/pointer/bank/types';
import type { StackApi } from '../../src/ladders/pointer/sut/port';
import empty from './empty';
import { referenceStack } from './reference/stack';

const items: PointerItem[] = stackSpecs.map((spec) => ({
  ...spec,
  id: `labels.${spec.key}`,
  family: 'labels',
  level: 4,
  component: 'stack',
  needs: ['stack'],
  seedFree: true,
  run: stackRuns[spec.key] as PointerItem['run'],
}));
const original = { ...empty, name: 'stack-reference', stack: referenceStack };
const changed = (delta: Partial<StackApi>): StackApi => ({ ...referenceStack, ...delta });
const run = (item: PointerItem, stack: StackApi | undefined) => {
  clearSeedFreeCache();
  return runItem(item, 1, { ...original, stack });
};
const mutants: Record<string, StackApi> = {
  'stack-margin-exact': changed({ margin: () => ({ label: 'rule', margin: 0.625 }) }),
  'stack-margin-invalid': changed({ margin: () => ({ label: 'rule', margin: 0.625 }) }),
  'stack-margin-boundary': changed({
    decide: async (input) => {
      const lead = await referenceStack.margin(input.probabilities);
      return lead.margin === input.marginCut
        ? { label: 'description', by: 'system2' }
        : referenceStack.decide(input);
    },
  }),
  'stack-zero-cut': changed({
    decide: (input) =>
      referenceStack.decide({ ...input, marginCut: input.marginCut === 0 ? 1 : input.marginCut }),
  }),
  'stack-monotone-routing': changed({
    decide: (input) =>
      referenceStack.decide({ ...input, marginCut: input.marginCut === 0.75 ? 0 : input.marginCut }),
  }),
  'stack-unanimity': changed({
    decide: (input) => (input.system2Votes[0] === 'none' ? undefined : referenceStack.decide(input)),
  }),
  'stack-unsure-disagreement': changed({
    decide: (input) =>
      referenceStack.decide({
        ...input,
        system2Votes: [
          input.system2Votes[0] ?? null,
          input.system2Votes[0] ?? null,
          input.system2Votes[0] ?? null,
        ],
      }),
  }),
  'stack-missing-vote': changed({
    decide: (input) =>
      referenceStack.decide({
        ...input,
        system2Votes: input.system2Votes.map((vote) => vote ?? 'description'),
      }),
  }),
  'stack-malformed-vote': changed({
    decide: (input) =>
      referenceStack.decide({
        ...input,
        system2Votes: input.system2Votes.map((vote) =>
          vote && Object.hasOwn(input.probabilities, vote) ? vote : 'description',
        ),
      }),
  }),
  'stack-require-agreement': changed({
    decide: (input) => referenceStack.decide({ ...input, requireAgreement: false }),
  }),
  'stack-route-independent': changed({
    decide: (() => {
      let calls = 0;
      return (input) => {
        calls += 1;
        // A batch-state bug: changing an earlier unit contaminates a later route.
        return calls === 7 ? { label: 'description', by: 'system2' as const } : referenceStack.decide(input);
      };
    })(),
  }),
  'stack-no-empty-label': changed({
    decide: (input) =>
      input.system2Votes.every((vote) => vote === '')
        ? { label: '', by: 'system2' }
        : referenceStack.decide(input),
  }),
};

describe('normative stack checks', () => {
  it('registers every new stack item without a missing runner', () => {
    const bank = pointerBank();
    for (const item of items) {
      const registered = bank.find((entry) => entry.id === item.id);
      expect(registered, item.id).toBeDefined();
      expect(registered?.run).toBe(item.run);
    }
  });

  it('uses literal reference outcomes independent of product implementation', async () => {
    expect(await referenceStack.margin({ rule: 0.125, none: 0.875 })).toEqual({
      label: 'none',
      margin: 0.75,
    });
    const input = {
      probabilities: { rule: 0.5, description: 0.3, none: 0.2 },
      system1Label: 'rule',
      system2Votes: ['description', 'description', 'description'],
      marginCut: 0.5,
    };
    expect(await referenceStack.decide(input)).toEqual({ label: 'description', by: 'system2' });
    expect(await referenceStack.decide({ ...input, requireAgreement: true })).toBeUndefined();
    expect(await referenceStack.decide({ ...input, marginCut: 0 })).toEqual({ label: 'rule', by: 'system1' });
  });

  for (const item of items) {
    it(`${item.id}: accepts the contract and rejects its mutant`, async () => {
      expect(await run(item, referenceStack)).toMatchObject({ pass: true });
      const mutant = mutants[item.id.replace('labels.', '')];
      expect(mutant).toBeDefined();
      expect(await run(item, mutant)).toMatchObject({ pass: false });
    });
    it(`${item.id}: missing, empty, constant-answer and constant-failure capabilities earn no credit`, async () => {
      expect(await run(item, undefined)).toMatchObject({ pass: false });
      expect(
        await run(item, { margin: () => ({ label: '', margin: 0 }), decide: () => undefined }),
      ).toMatchObject({ pass: false });
      expect(
        await run(item, {
          margin: () => ({ label: 'rule', margin: 0.625 }),
          decide: () => ({ label: 'description', by: 'system2' }),
        }),
      ).toMatchObject({ pass: false });
      const refuse = () => {
        throw new Error('constant failure');
      };
      expect(await run(item, { margin: refuse, decide: refuse })).toMatchObject({ pass: false });
    });
  }
});

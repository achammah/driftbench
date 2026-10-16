import { evidence, ObjectStore, parseObjectText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blame, initializeShippedObjects, type placement } from '../../src';
import { f7 } from '../fixtures/blame/cases';

initializeShippedObjects();

function project(kind: string, items: string) {
  const store = new ObjectStore();
  store.add(
    parseObjectText(`kind: ${kind}\nid: reviewed\nextends: default\nitems:\n${items}\n`, 'project.yaml').raw,
    'project',
    { path: 'project.yaml' },
  );
  return store.resolve(kind, 'reviewed');
}

describe('PR 447 review regressions', () => {
  it('keeps the deciding item stamp, including its project layer', () => {
    const policy = project(
      'policy/blame',
      '  - id: skill_reference_forced_unread\n    effect: { fix_action: strengthen_ref }',
    );
    const one = f7(1);
    const got = blame.diagnoseBlock({
      verdicts: one.verdicts,
      evidenceFor: one.input,
      blame: policy,
      placement: blame.shippedPolicy('policy/placement'),
    }).diagnoses[0];
    expect(got).toMatchObject({
      by: {
        object: policy.ref,
        item: 'skill_reference_forced_unread',
        impl: 'builtin:blame/reference-unread',
        layer: 'project',
      },
    });
    const shipped = blame.shippedPolicy('policy/blame');
    const plain = blame.diagnoseBlock({
      verdicts: one.verdicts,
      evidenceFor: one.input,
      blame: shipped,
      placement: blame.shippedPolicy('policy/placement'),
    }).diagnoses[0];
    expect(plain).toMatchObject({
      by: {
        object: shipped.ref,
        item: 'skill_reference_forced_unread',
        impl: 'builtin:blame/reference-unread',
        layer: 'shipped',
      },
    });
  });

  it('count_no_skill_home=false excludes the none home from recurrence', () => {
    const one = f7(2);
    const history = one.history?.map((row) => ({
      ...row,
      home: row.home === 'supplier-email' ? 'none' : row.home,
    }));
    const policy = blame.shippedPolicy('policy/blame');
    const run = (place: placement.PolicyView) =>
      blame.diagnoseBlock({
        verdicts: one.verdicts,
        evidenceFor: one.input,
        blame: policy,
        placement: place,
        history,
      }).diagnoses[0];
    expect(run(blame.shippedPolicy('policy/placement'))?.fix_location).toBe('agent.skill_reading');
    const filtered = project(
      'policy/placement',
      '  - id: cross_cutting\n    params: { count_no_skill_home: false }',
    );
    expect(run(filtered)?.fix_location).toBe('skill.layout');
  });

  it('excluding the no-skill home also excludes the current diagnosis and class recurrence', () => {
    const one = f7(1);
    const given = one.input(one.verdicts[0]!);
    for (const name of ['recurrence_homes', 'recurrence_class_homes']) {
      expect(
        evidence.computeEvidence(
          {
            ...given,
            attributed: { item: 'x', act: 'read_reference', home: 'none' },
            history: [{ item: 'x', act: 'read_reference', home: 'none' }],
            countNoSkillHome: false,
            minRunsPerHome: 1,
          },
          [name],
        )[name],
      ).toBe(0);
    }
  });

  it('R3 recovery_ok overrides the shipped next-action table', () => {
    const policy = project('policy/blame', '  - id: R3\n    params: { recovery_ok: [asked_user] }');
    const facts = {
      tool_failed: true,
      contract: 'none',
      source: 'user',
      change: 'verbatim',
      next_action: 'retried_canonical',
    };
    expect(blame.attribute(blame.shippedPolicy('policy/blame'), facts).disposition).toBe('setup');
    expect(blame.attribute(policy, facts)).toMatchObject({
      item: 'R3',
      disposition: 'shared',
      fault: ['tool', 'agent'],
    });
    expect(blame.attribute(policy, { ...facts, next_action: 'asked_user' }).disposition).toBe('setup');
    const empty = project('policy/blame', '  - id: R3\n    params: { recovery_ok: [] }');
    expect(blame.attribute(empty, { ...facts, next_action: 'asked_user' }).disposition).toBe('shared');
  });
});

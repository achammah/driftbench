import {
  initializeShippedObjects,
  ObjectRegistry,
  ObjectStore,
  objectRegistry,
  parseObjectText,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blame } from '../../src';

/**
 * The shipped blame and placement files are data that resolve through the object framework: 32 blame items and
 * 13 placement items, every item naming a registered implementation whose params schema its params pass. A user
 * object extends them; an unknown item or a param of the wrong type is refused at load.
 */

function store(): ObjectStore {
  initializeShippedObjects();
  const registry = new ObjectRegistry();
  for (const kind of objectRegistry.kinds()) registry.registerKind(kind);
  blame.registerBlameObjects(registry);
  return new ObjectStore(registry);
}

const add = (target: ObjectStore, text: string) =>
  target.add(parseObjectText(text, 'project.yaml').raw, 'project', { path: 'project.yaml' });

describe('policy/blame:default and policy/placement:default', () => {
  it('ship 32 blame items and 13 placement items, in the order of the design', () => {
    const policy = store().resolve('policy/blame', 'default');
    expect(policy.items).toHaveLength(32);
    expect(policy.items[0]?.id).toBe('I1_protected_edit');
    expect(policy.items.at(-1)?.id).toBe('unassigned');
    expect(policy.items.map((item) => item.id).indexOf('R5')).toBeLessThan(
      policy.items.map((item) => item.id).indexOf('R3'),
    );
    const place = store().resolve('policy/placement', 'default');
    expect(place.items.map((item) => item.id)).toEqual([
      'fixed',
      'always_core',
      'trigger_local',
      'layout_local',
      'cross_cutting',
      'shared_rule',
      'situational',
      'skill_local',
      'tool_local',
      'core_local',
      'core',
      'mechanical_guard',
      'escape_test',
    ]);
  });

  it('every enabled item that writes a fix location writes one the object lists', () => {
    const policy = store().resolve('policy/blame', 'default');
    const locations = policy.params.fix_locations as string[];
    for (const item of policy.items) {
      const location = item.effect.fix_location as string | undefined;
      if (location !== undefined) expect(locations, item.id).toContain(location);
    }
  });

  it('resolves a project override: set a param, disable an item, add one anchored before R5 (G8)', () => {
    const target = store();
    add(
      target,
      [
        'kind: policy/blame',
        'id: northwind',
        'extends: default',
        'params:',
        '  +fix_locations: [data.seed]',
        'items:',
        '  - id: core_rule_caught',
        '    params: { counts_against_agent: false }',
        '  - id: I2_special_case',
        '    enabled: false',
        '  - id: seed_defect',
        '    add: true',
        '    before: R5',
        '    title: The family seed breaks the family constraints',
        '    when: { seed_lint_failed: true }',
        '    effect: { verdict: not_scored, disposition: excluded, fault: [test], fix_location: data.seed, fix_action: fix_seed, place: fixed }',
        '    impl: builtin:blame/reference-fails',
      ].join('\n'),
    );
    const policy = target.resolve('policy/blame', 'northwind');
    const ids = policy.items.map((item) => item.id);
    expect(ids.indexOf('seed_defect')).toBe(ids.indexOf('R5') - 1);
    expect(policy.params.fix_locations).toContain('data.seed');
    const facts = { guard_caught: true };
    expect(blame.attribute(policy, facts).disposition).toBe('credited');
    expect(blame.attribute(target.resolve('policy/blame', 'default'), facts).disposition).toBe('agent');
    expect(policy.ref).toMatch(/^policy\/blame:northwind@[0-9a-f]{8}$/);
    expect(blame.attribute(policy, facts).rule).toBe(`${policy.ref}#core_rule_caught`);
  });

  it('refuses an unknown item and a param of the wrong type', () => {
    const unknown = store();
    add(unknown, 'kind: policy/blame\nid: bad\nextends: default\nitems:\n  - id: R9\n    enabled: false\n');
    expect(() => unknown.resolve('policy/blame', 'bad')).toThrow(/unknown item R9/);
    const typed = store();
    add(
      typed,
      'kind: policy/placement\nid: bad\nextends: default\nitems:\n  - id: cross_cutting\n    params: { min_homes: two }\n',
    );
    expect(() => typed.resolve('policy/placement', 'bad')).toThrow(/min_homes/);
  });

  it('first match wins: a disabled item falls through to the next', () => {
    const target = store();
    add(target, 'kind: policy/blame\nid: no-r5\nextends: default\nitems:\n  - id: R5\n    enabled: false\n');
    const facts = { outcome: 'accepted_as_gold', contract: 'none', verdict_kind: 'machine' };
    expect(blame.attribute(target.resolve('policy/blame', 'default'), facts).item).toBe('R5');
    expect(blame.attribute(target.resolve('policy/blame', 'no-r5'), facts).item).toBe('unassigned');
  });
});

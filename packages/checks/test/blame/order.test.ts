import { ObjectStore, objectRegistry } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blame } from '../../src';
import { initializeShippedObjects } from '../../src/initialize';

initializeShippedObjects();

/**
 * A declared consumer changes only the choice between R5 and R5b. Every other item keeps its place in the
 * order of `policy/blame:default`, so a fact set that an earlier item matched is still matched by it.
 */
const policy = () => new ObjectStore(objectRegistry).resolve('policy/blame', 'default');
const accepted = { outcome: 'accepted_as_gold', contract: 'none', verdict_kind: 'machine' };

describe('R5 and R5b', () => {
  it('R5 where no consumer is declared, and where the evidence does not say', () => {
    expect(blame.attribute(policy(), { ...accepted, downstream_need: 'none' }).item).toBe('R5');
    expect(blame.attribute(policy(), accepted).item).toBe('R5');
  });

  it('R5b where a consumer is declared', () => {
    expect(blame.attribute(policy(), { ...accepted, downstream_need: 'declared' }).item).toBe('R5b');
  });

  it('a declared consumer does not outrank an item that was ahead of R5b', () => {
    const facts = {
      ...accepted,
      verdict_kind: 'judge',
      downstream_need: 'declared',
      env_error: 'network',
      claim_contradicted: false,
    };
    expect(blame.attribute(policy(), facts).item).toBe('env_failure');
    expect(blame.attribute(policy(), { ...facts, env_error: 'none' }).item).toBe('R5b');
  });

  it('keeps R5b where it was: after R1 and before R2b', () => {
    const ids = policy().items.map((item) => item.id);
    expect(ids.indexOf('R5b')).toBe(ids.indexOf('R1') + 1);
    expect(ids.indexOf('R5b')).toBe(ids.indexOf('R2b') - 1);
  });
});

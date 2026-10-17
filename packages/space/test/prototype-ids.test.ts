import { compileSpace, type SpaceMap, validateSpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { map } from './support';

/**
 * Ids are written by people and by extractors. `constructor`, `toString` and `valueOf` are legal ids, and
 * they are also properties every object inherits: a lookup written `weights[id]` or `id in weights` finds
 * them in an object that never listed them. `__proto__` cannot be an id (an id starts with a letter or a digit).
 */

const raw = (prior: unknown) => ({
  version: '1',
  agent: 'x',
  dimensions: [
    {
      id: 'constructor',
      title: 'A dimension named like a built-in',
      kind: 'data',
      values: [
        { id: 'toString', title: 'A' },
        { id: 'valueOf', title: 'B' },
      ],
    },
    {
      id: 'other',
      title: 'Another',
      kind: 'persona',
      values: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
    },
  ],
  constraints: [],
  prior,
});

describe('compileSpace with ids named like built-ins', () => {
  it('weighs a dimension named constructor the same for every value when the prior lists other dimensions', () => {
    const space = compileSpace(
      map(raw({ kind: 'fitted', source: 'logs', weights: { other: { a: 1, b: 3 } } })),
    );
    expect(space.dimensions.map((dimension) => dimension.weights)).toEqual([
      [0.5, 0.5],
      [0.25, 0.75],
    ]);
  });

  it('uses the prior weights of a dimension named constructor, for values named toString and valueOf', () => {
    const space = compileSpace(
      map(raw({ kind: 'fitted', source: 'logs', weights: { constructor: { toString: 1, valueOf: 3 } } })),
    );
    expect(space.dimensions[0]?.weights).toEqual([0.25, 0.75]);
  });

  it('gives a value the prior does not list the weight 0, whatever its name', () => {
    // compileSpace reads a map that passed validateSpaceMap, which asks for a complete prior; the lookup is still exact.
    const partial = raw({ kind: 'fitted', source: 'logs', weights: { constructor: { valueOf: 1 } } });
    const space = compileSpace(partial as unknown as SpaceMap);
    expect(space.dimensions[0]?.weights).toEqual([0, 1]);
  });
});

describe('validateSpaceMap with ids named like built-ins', () => {
  it('finds a prior that leaves out a value named toString', () => {
    const result = validateSpaceMap(
      raw({ kind: 'declared', weights: { constructor: { valueOf: 1 }, other: { a: 1, b: 1 } } }),
    );
    expect(result.ok ? [] : result.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'SPACE_PRIOR_INCOMPLETE prior.weights.constructor',
    ]);
  });

  it('accepts a prior that lists them all', () => {
    const result = validateSpaceMap(
      raw({
        kind: 'declared',
        weights: { constructor: { toString: 1, valueOf: 1 }, other: { a: 1, b: 1 } },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses __proto__ as a value id: an id starts with a letter or a digit', () => {
    const value = raw({ kind: 'declared' });
    value.dimensions[1]?.values.push({ id: '__proto__', title: 'No' });
    const result = validateSpaceMap(value);
    expect(result.ok ? [] : result.errors.map((issue) => issue.code)).toEqual(['SCHEMA_INVALID_FORMAT']);
  });
});

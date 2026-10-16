import { defaultChecks, initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { beforeAll, describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { acmeAdapter, specOf } from './support';

beforeAll(() => initializeShippedObjects());

const driver = createScriptedDriver();
const run = (spec: ReturnType<typeof specOf>) =>
  runSpec(spec, { adapter: acmeAdapter(), driver, checks: defaultChecks(), mode: 'F', repeat: 0 });

// Fictional data only: a bike shop question the agent answers in words.
const blocks = [{ id: 'a', user: 'Which bike for the city?', expect: { must: ['.'], must_not: ['zzzz'] } }];

describe('Verdict.by', () => {
  it('names the shipped check set, the item, the implementation and the layer on every verdict', async () => {
    const result = await run(specOf({ id: 'bikes', blocks }));
    const verdicts = result.blocks[0]?.verdicts ?? [];
    expect(verdicts.length).toBeGreaterThan(0);
    for (const verdict of verdicts) {
      expect(verdict.by, verdict.id).toMatchObject({
        object: expect.stringMatching(/^check_set:default@[0-9a-f]{8}$/),
        layer: 'shipped',
      });
    }
    expect(verdicts.find((verdict) => verdict.id.startsWith('must.'))?.by).toMatchObject({
      item: 'must',
      impl: 'builtin:check/must',
    });
  });

  it('names the spec layer and a tailored set for an item the spec changes, and skips an item it turns off', async () => {
    const result = await run(
      specOf({
        id: 'bikes',
        uses: {
          check_set: {
            items: [
              { id: 'must', effect: { gating: false } },
              { id: 'must_not', enabled: false },
            ],
          },
        },
        blocks,
      }),
    );
    const verdicts = result.blocks[0]?.verdicts ?? [];
    const must = verdicts.find((verdict) => verdict.id.startsWith('must.'));
    expect(must?.by).toMatchObject({ item: 'must', layer: 'spec', object: expect.not.stringMatching(/^$/) });
    expect(must?.gating).toBe(false);
    expect(verdicts.some((verdict) => verdict.by?.item === 'must_not')).toBe(false);
    const plain = await run(specOf({ id: 'bikes', blocks }));
    const shipped = plain.blocks[0]?.verdicts.find((verdict) => verdict.id.startsWith('must_not.'))?.by
      ?.object;
    // An item the layer did not touch keeps its shipped layer, but the set it belongs to is the tailored one.
    const others = verdicts.filter((verdict) => verdict.by?.item !== 'must');
    expect(others.length).toBeGreaterThan(0);
    for (const verdict of others) {
      expect(verdict.by?.layer).toBe('shipped');
      expect(verdict.by?.object).not.toBe(shipped);
    }
  });

  it('names the block layer for an item the block changes', async () => {
    const result = await run(
      specOf({
        id: 'bikes',
        blocks: [{ ...blocks[0], uses: { check_set: { items: [{ id: 'must', title: 'Says something' }] } } }],
      }),
    );
    const must = result.blocks[0]?.verdicts.find((verdict) => verdict.id.startsWith('must.'));
    expect(must?.by).toMatchObject({ item: 'must', layer: 'block' });
  });
});

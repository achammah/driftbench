import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { sameBlockInputs } from '../src/radius/block-inputs';
import { observationCompatibilityHash, prepareRejudge } from '../src/radius/rejudge';
import { blockCacheKey } from '../src/runner/cache';
import { canonicalGiven, resolveGiven } from '../src/runner/given';
import { adapterProvenance, provenanceHash } from '../src/runner/provenance';
import { runSpec } from '../src/runner/run';
import type { ResolvedGiven } from '../src/schema/run';
import type { Spec } from '../src/schema/spec';
import { contentHash } from '../src/spec/hash';
import { echoAdapter, specOf } from './runner/support';

// Fictional data only. The blast radius of given.origin (PR 424) past the Given hash itself: the block cache
// key, the run records, carry (sameBlockInputs) and rejudge, which all rebuild the Given on their own.

const target = { adapter: 'function', agent: 'acme-sales' };
const prefix = [
  { role: 'user', content: 'Can someone call me back about fiber?' },
  {
    role: 'assistant',
    content: 'Done, an advisor will call you.',
    tool_calls: [
      { id: 'call-1', label: 'notify_sales', input: { topic: 'fiber' }, output: { ref: 'LD-4471' } },
    ],
  },
];

/** The plain spec the PR test pins: one block with a prefix and no origin. */
function plainSpec(): Spec {
  return specOf({
    id: 'origin',
    target,
    blocks: [{ user: 'What is my reference?', given: { prefix }, expect: { must: ['LD-4471'] } }],
  });
}

/** Two blocks: the first writes a prefix (with or without origin), the second inherits it. */
function twoBlocks(origin: string | undefined, extra: Record<string, unknown> = {}): Spec {
  return specOf({
    id: 'origin-two',
    ...extra,
    blocks: [
      {
        user: 'What is my reference?',
        given: { prefix, ...(origin ? { origin } : {}) },
        expect: { must: ['ok'], ...(extra.criteria ? { criteria: ['price'] } : {}) },
      },
      { user: 'And when will they call?', expect: { must: ['ok'] } },
    ],
  });
}

function keyOf(spec: Spec, given: ResolvedGiven): string {
  const block = spec.blocks[0];
  if (!block) throw new Error('missing block');
  return blockCacheKey({
    specHash: contentHash(spec),
    repeat: 0,
    position: 0,
    given,
    stimulus: block.when,
    target,
    adapter: 'function',
    adapterVersion: '0.1.0',
  });
}

describe('given.origin beyond the Given hash', () => {
  it('leaves the block cache key of a Given without origin free of origin', () => {
    const spec = plainSpec();
    const canonical = canonicalGiven(spec, 0);
    const given = resolveGiven(canonical.state, canonical.prefix, target);
    expect('origin' in given).toBe(false);
    // The key of the history-digest format: the same Given without an origin field, as the block key now reads
    // its history. Before that format (PR 424 and earlier) the key was 8a96d23a, a different byte stream.
    expect(keyOf(spec, given)).toBe(PRE_ORIGIN_BLOCK_KEY);
    const recorded = specOf({
      id: 'origin',
      target,
      blocks: [
        {
          user: 'What is my reference?',
          given: { prefix, origin: 'recorded' },
          expect: { must: ['LD-4471'] },
        },
      ],
    });
    const withOrigin = canonicalGiven(recorded, 0);
    const other = resolveGiven(withOrigin.state, withOrigin.prefix, target);
    expect(other.origin).toBe('recorded');
    expect(keyOf(recorded, other)).not.toBe(PRE_ORIGIN_BLOCK_KEY);
  });

  for (const mode of ['F', 'T'] as const) {
    it(`mode ${mode}: the run hands the adapter the origin, records it in every Given hash it holds, and a spec without it keeps its hashes`, async () => {
      const run = async (spec: Spec) => {
        const origins: (string | undefined)[] = [];
        const adapter = echoAdapter();
        const open = adapter.open.bind(adapter);
        adapter.open = async (given) => {
          origins.push(given.origin);
          return open(given);
        };
        const result = await runSpec(spec, {
          adapter,
          driver: createScriptedDriver(),
          checks: [],
          mode,
          repeat: 0,
          target,
        });
        expect(result.status).toBe('completed');
        return { result, origins };
      };
      const recorded = await run(twoBlocks('recorded'));
      const authored = await run(twoBlocks('authored'));
      const plain = await run(twoBlocks(undefined));
      // The origin holds for the block that inherits the prefix too.
      expect(recorded.origins.every((origin) => origin === 'recorded')).toBe(true);
      expect(recorded.origins.length).toBeGreaterThan(0);
      expect(plain.origins.every((origin) => origin === undefined)).toBe(true);
      for (const index of [0, 1]) {
        const hashes = [recorded, authored, plain].map((each) => each.result.blocks[index]?.givenHash);
        expect(new Set(hashes).size, `block ${index}`).toBe(3);
      }
      // The recorded Given hash is the one resolveGiven gives over the spec's own Given, origin included.
      const canonical = canonicalGiven(twoBlocks('recorded'), 0);
      expect(recorded.result.blocks[0]?.givenHash).toBe(
        resolveGiven(canonical.state, canonical.prefix, target).hash,
      );
      expect(new Set([recorded, authored, plain].map((each) => each.result.specHash)).size).toBe(3);
    });
  }

  for (const mode of ['F', 'T'] as const) {
    it(`mode ${mode}: carry rebuilds the Given of a run with an origin and finds the same block inputs`, async () => {
      const spec = twoBlocks('recorded');
      const result = await runSpec(spec, {
        adapter: echoAdapter(),
        driver: createScriptedDriver(),
        checks: [],
        mode,
        repeat: 0,
        target,
        recordProvenance: true,
      });
      expect(result.status).toBe('completed');
      expect(sameBlockInputs(result, spec)).toBe(true);
      // The same run read against the spec with another origin is another input.
      expect(sameBlockInputs(result, twoBlocks('authored'))).toBe(false);
      expect(sameBlockInputs(result, twoBlocks(undefined))).toBe(false);
    });
  }

  it('rejudge accepts a run made with an origin, and refuses one whose spec changed its origin', async () => {
    const criteria = [{ name: 'price', rubric: 'A price is present.', gating: true }];
    const old = twoBlocks('recorded', { criteria });
    const rubricOnly = twoBlocks('recorded', {
      criteria: [{ name: 'price', rubric: 'The price must be 12.', gating: true }],
    });
    const echoTarget = { adapter: 'echo', variant: 'v1' };
    const run = await runSpec(old, {
      adapter: echoAdapter(),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
      target: echoTarget,
      recordProvenance: true,
      now: () => new Date('2026-10-13T00:00:00Z'),
    });
    expect(run.status).toBe('completed');
    const options = {
      baselineProvenance: {
        version: 2 as const,
        adapters: [
          {
            ...adapterProvenance(echoAdapter(), echoTarget.adapter),
            targetHash: provenanceHash(echoTarget),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
      fromCampaign: 'acme-base',
      agentVersion: 'v1',
      criteria: ['price'],
      now: new Date('2026-10-13T01:00:00Z'),
    };
    // Rejudge rebuilds each block's Given and compares it with the recorded hash, origin included.
    expect(prepareRejudge(old, rubricOnly, run, options).contexts).toHaveLength(2);
    // Another origin is another test: never judge-only.
    const stamp = { executionHash: 'runtime-context' };
    expect(observationCompatibilityHash(twoBlocks('authored', { criteria }), stamp)).not.toBe(
      observationCompatibilityHash(old, stamp),
    );
    expect(() => prepareRejudge(old, twoBlocks('authored', { criteria }), run, options)).toThrow(
      /Observation compatibility changed/,
    );
  });
});

const PRE_ORIGIN_BLOCK_KEY = 'block:5c5aa4d68b15630ae219e86cb809abfb7b58091a01322a40fb536cdec806c743';

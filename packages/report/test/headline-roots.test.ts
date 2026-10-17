import type { RunResult, Spec } from '@agent-nexus/driftbench-core';
import { hierarchicalBetaBinomial } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { suiteHeadline } from '../src/headline';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

// A hand-written bakery spec with two families: cart > pay > receipt, and refund > credit. Two runs record
// every block. Two reruns record only the leaves: their ancestors were replayed, which adds no block.
const AUTHORED = [
  { id: 'cart' },
  { id: 'pay', parent: 'cart' },
  { id: 'receipt', parent: 'pay' },
  { id: 'refund' },
  { id: 'credit', parent: 'refund' },
] as const;

function bakeryRun(repeat: number, recorded: readonly string[], failing: readonly string[]): RunResult {
  const shape = run({
    specId: 'bakery',
    repeat,
    blocks: recorded.map((id) => (failing.includes(id) ? { pass: false } : {})),
  });
  return {
    ...shape,
    blocks: shape.blocks.map((block, index) => {
      const id = recorded[index] as string;
      const authored = AUTHORED.findIndex((entry) => entry.id === id);
      const parent = (AUTHORED[authored] as { parent?: string }).parent;
      return { ...block, blockId: id, specIndex: authored, ...(parent ? { parent } : {}) };
    }),
  };
}

const runs = [
  bakeryRun(0, ['cart', 'pay', 'receipt', 'refund', 'credit'], []),
  bakeryRun(1, ['cart', 'pay', 'receipt', 'refund', 'credit'], ['pay']),
  bakeryRun(2, ['receipt', 'credit'], []),
  bakeryRun(3, ['receipt', 'credit'], ['receipt']),
];

const bakery: Partial<Spec> = {
  blocks: AUTHORED.map((entry) => ({ when: { user: `about ${entry.id}` }, ...entry })) as Spec['blocks'],
};
const parentsOf = () =>
  new Map(AUTHORED.flatMap((entry) => ('parent' in entry ? [[entry.id, entry.parent]] : [])));

// One cluster per root: cart passes in repeats 0 and 2, refund in all four.
const families = hierarchicalBetaBinomial([
  { n: 4, k: 2 },
  { n: 4, k: 4 },
]);

describe('the suite headline groups a run that did not record its root under that root', () => {
  it('keys each family by its root from the spec links, one cluster per root', () => {
    const headline = suiteHeadline(runs, (entry) => entry.specId, { parentsOf });
    expect(headline).toMatchObject({ trees: 2, n: 8, runs: 4, method: 'hierarchical', unit: 'tree-run' });
    expect(headline?.lower).toBe(families.lower);
    expect(headline?.upper).toBe(families.upper);
  });

  it('does the same in the scorecard, which reads the links from the pinned spec', () => {
    const card = buildScorecard(dataOf(runs, { bakery }));
    const headline = card.modes.find((mode) => mode.mode === 'F')?.headline;
    expect(headline).toMatchObject({ trees: 2, n: 8 });
    expect(headline?.lower).toBe(families.lower);
  });

  it('without the links, keys a leaf whose ancestors are unrecorded by the highest ancestor it names', () => {
    const headline = suiteHeadline(runs, (entry) => entry.specId);
    // credit names refund, so it joins the refund family. receipt names pay, which the rerun did not record:
    // pay is as high as the run alone can tell, so the cart family splits in two.
    expect(headline).toMatchObject({ trees: 3, n: 8 });
  });

  it('keys a rerun that recorded only roots by those roots, never by the golden', () => {
    // A subset run of one root each: refund passes, cart fails. No recorded block names a parent.
    const subsets = [bakeryRun(4, ['refund'], []), bakeryRun(5, ['cart'], ['cart'])];
    const headline = suiteHeadline([...runs, ...subsets], (entry) => entry.specId, { parentsOf });
    const expected = hierarchicalBetaBinomial([
      { n: 5, k: 2 },
      { n: 5, k: 5 },
    ]);
    expect(headline).toMatchObject({ trees: 2, n: 10, runs: 6 });
    expect(headline?.lower).toBe(expected.lower);
    expect(headline?.upper).toBe(expected.upper);
  });

  it('reads empty links as no links: a spec without parents keeps the golden grouping', () => {
    const plain = Array.from({ length: 6 }, (_, repeat) =>
      run({ specId: `plain-${repeat % 3}`, repeat, blocks: [repeat === 1 ? { pass: false } : {}] }),
    );
    const without = suiteHeadline(plain, (entry) => entry.specId);
    expect(without).toMatchObject({ trees: 3, n: 6 });
    expect(suiteHeadline(plain, (entry) => entry.specId, { parentsOf: () => new Map() })).toEqual(without);
  });

  it('counts a run that failed before it recorded any block as one failure of each root family', () => {
    // The first step threw: the run failed with no block, so every family of the spec failed once.
    const dead = { ...bakeryRun(6, [], []), status: 'failed' as const };
    const headline = suiteHeadline([...runs, dead], (entry) => entry.specId, { parentsOf });
    expect(headline).toMatchObject({ runs: 5, n: 10, trees: 2 });
    expect(headline?.pooledRate).toBe(6 / 10);
  });

  it('counts a failed run that recorded blocks but measured none the same way', () => {
    const shape = bakeryRun(6, ['cart', 'refund'], []);
    const unmeasured = {
      ...shape,
      status: 'failed' as const,
      blocks: shape.blocks.map((block) => ({
        ...block,
        pass: false,
        status: 'not_run' as const,
        verdicts: [],
        notRun: {
          kind: 'unsupported' as const,
          layer: '5 world',
          check: 'capability',
          expected: 'snapshot',
          got: 'unavailable',
        },
      })),
    };
    const headline = suiteHeadline([...runs, unmeasured], (entry) => entry.specId, { parentsOf });
    expect(headline).toMatchObject({ runs: 5, n: 10, trees: 2 });
    expect(headline?.pooledRate).toBe(6 / 10);
  });
});

describe('a dead run weighs as one failure per root family', () => {
  // A hand-written greenhouse spec of 12 families: tray-i > seedling-i. One run passes every block; one run
  // died before its first block. The headline reads about 0.5: 12 families passed once and failed once.
  const FAMILIES = Array.from({ length: 12 }, (_, i) => i);
  const authored = FAMILIES.flatMap((i) => [
    { id: `tray-${i}` },
    { id: `seedling-${i}`, parent: `tray-${i}` },
  ]);
  const greenhouse: Partial<Spec> = {
    blocks: authored.map((entry) => ({ when: { user: `about ${entry.id}` }, ...entry })) as Spec['blocks'],
  };
  const passing = (() => {
    const shape = run({ specId: 'greenhouse', repeat: 0, blocks: authored.map(() => ({})) });
    return {
      ...shape,
      blocks: shape.blocks.map((block, index) => {
        const entry = authored[index] as { id: string; parent?: string };
        return {
          ...block,
          blockId: entry.id,
          specIndex: index,
          ...(entry.parent ? { parent: entry.parent } : {}),
        };
      }),
    };
  })();
  const dead = {
    ...run({ specId: 'greenhouse', repeat: 1, blocks: [] }),
    status: 'failed' as const,
    blocks: [],
  };

  it('in the scorecard, which reads the roots from the pinned spec', () => {
    const card = buildScorecard(dataOf([passing, dead], { greenhouse }));
    const headline = card.modes.find((mode) => mode.mode === 'F')?.headline;
    expect(headline).toMatchObject({ trees: 12, n: 24, runs: 2, pooledRate: 0.5 });
    expect(headline?.estimate).toBeCloseTo(0.5, 6);
  });
});

describe('a root with no id is keyed by its place in the spec', () => {
  // A hand-written kiosk spec: menu > order, and an independent greeting block with no id at spec index 2.
  const kiosk: Partial<Spec> = {
    blocks: [
      { id: 'menu', when: { user: 'the menu' } },
      { id: 'order', parent: 'menu', when: { user: 'one coffee' } },
      { when: { user: 'hello' } },
    ] as Spec['blocks'],
  };
  const recorded = (repeat: number, specIndexes: number[]): RunResult => {
    const shape = run({ specId: 'kiosk', repeat, blocks: specIndexes.map(() => ({})) });
    return {
      ...shape,
      blocks: shape.blocks.map((block, position) => {
        const at = specIndexes[position] as number;
        const ids = ['menu', 'order', undefined];
        return {
          ...block,
          specIndex: at,
          ...(ids[at] === undefined ? { blockId: undefined } : { blockId: ids[at] }),
          ...(at === 1 ? { parent: 'menu' } : {}),
        };
      }),
    };
  };

  it('joins a subset run of that root and a dead run in one tree', () => {
    const dead = {
      ...run({ specId: 'kiosk', repeat: 2, blocks: [] }),
      status: 'failed' as const,
      blocks: [],
    };
    const card = buildScorecard(dataOf([recorded(0, [0, 1, 2]), recorded(1, [2]), dead], { kiosk }));
    const headline = card.modes.find((mode) => mode.mode === 'F')?.headline;
    // Trees: menu (passed, died) and the greeting (passed, passed, died).
    expect(headline).toMatchObject({ trees: 2, n: 5, runs: 3 });
  });
});

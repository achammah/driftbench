import { blockStatus } from '@agent-nexus/driftbench-core';
import { hierarchicalBetaBinomial } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { parentCauses } from '../src/causes';
import { suiteHeadline } from '../src/headline';
import { renderHtml, renderRun } from '../src/html';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

const base = run({ specId: 'forest', blocks: [{ pass: false }, {}, {}, {}] });
const forest = {
  ...base,
  blocks: base.blocks.map((block, index) => ({
    ...block,
    specIndex: index,
    blockId: ['root', 'child', 'leaf', 'independent'][index],
    ...(index === 1 || index === 2
      ? {
          parent: index === 1 ? 'root' : 'child',
          pass: false,
          status: 'blocked' as const,
          verdicts: [],
          blocked: { by: index === 1 ? 'root' : 'child', root: 'root' },
        }
      : {}),
  })),
};

describe('parent reports', () => {
  it('counts a shared cause once and lists its blocked descendants under it', () => {
    expect(forest.blocks.map(blockStatus)).toEqual(['fail', 'blocked', 'blocked', 'pass']);
    expect(parentCauses(forest)).toEqual([{ root: 'root', status: 'fail', blocked: ['child', 'leaf'] }]);
    const card = buildScorecard(dataOf([forest]));
    expect(card.drilldown[0]?.causes).toEqual(parentCauses(forest));
    const detail = card.drilldown[0];
    if (!detail) throw new Error('missing detail');
    const html = renderRun(detail);
    expect(html).toContain('Causes: 1 failed, 0 not run');
    expect(html).toContain('root: fail<ul><li>child: blocked</li><li>leaf: blocked</li></ul>');
    expect(renderHtml(card)).toContain('root: fail<ul><li>child: blocked</li><li>leaf: blocked</li></ul>');
  });
  it('pools the roots of one spec in one tree, with the repeats', () => {
    const headline = suiteHeadline([forest, { ...forest, repeat: 1 }], (run) => run.specId);
    // Two roots in one spec: root 0 fails, root 1 passes, over two repeats: four tree outcomes, one tree.
    expect(headline).toMatchObject({
      trees: 1,
      runs: 2,
      n: 4,
      method: 'none',
      unit: 'tree-run',
      pooledRate: 0.5,
      estimate: 0.5,
    });
  });
  it('the hierarchical interval reads one tree per spec across specs', () => {
    const other = {
      ...forest,
      specId: 'forest-b',
      blocks: forest.blocks.map((block) => ({
        ...block,
        pass: true,
        status: 'pass' as const,
        blocked: undefined,
      })),
    };
    const headline = suiteHeadline(
      [forest, { ...forest, repeat: 1 }, other, { ...other, repeat: 1 }],
      (run) => run.specId,
    );
    const interval = hierarchicalBetaBinomial([
      { n: 4, k: 2 },
      { n: 4, k: 4 },
    ]);
    expect(headline).toMatchObject({ trees: 2, runs: 4, n: 8, method: 'hierarchical', unit: 'tree-run' });
    expect(headline?.estimate).toBe(interval.estimate);
    expect(headline?.lower).toBe(interval.lower);
    expect(headline?.upper).toBe(interval.upper);
  });
  it('leaves a not-run linked run out of every count, its measured tree included', () => {
    const unrun = {
      ...forest,
      blocks: forest.blocks.map((block, index) =>
        index === 0
          ? {
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
            }
          : block,
      ),
    };
    expect(suiteHeadline([unrun], (run) => run.specId)).toBeUndefined();
    // Beside 16 scored runs, the unscored linked run adds nothing: 16 runs, 16 outcomes, its share shown.
    const scored = Array.from({ length: 16 }, (_, repeat) => run({ specId: `plain-${repeat % 4}`, repeat }));
    const headline = suiteHeadline([...scored, unrun], (run) => run.specId);
    expect(headline).toMatchObject({ runs: 16, n: 16, trees: 4, shares: { notRun: 1 / 17 } });
  });
  it('fails every measured tree of a run that failed as a whole with no failing block', () => {
    const shape = run({ specId: 'whole', blocks: [{}, {}, {}] });
    const whole = {
      ...shape,
      endVerdict: 'failure' as const,
      blocks: shape.blocks.map((block, index) => ({
        ...block,
        specIndex: index,
        blockId: ['root', 'child', 'independent'][index],
        ...(index === 1 ? { parent: 'root' } : {}),
      })),
    };
    expect(whole.blocks.map(blockStatus)).toEqual(['pass', 'pass', 'pass']);
    expect(suiteHeadline([whole], (run) => run.specId)).toMatchObject({ runs: 1, n: 2, pooledRate: 0 });
  });
});

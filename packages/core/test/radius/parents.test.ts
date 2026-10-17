import { describe, expect, it } from 'vitest';
import { radiusOf } from '../../src/radius/radius';
import { specOf } from '../runner/support';

describe('parent blast radius', () => {
  it('closes descendants even when they precede the parent, in every mode', () => {
    const spec = specOf({
      id: 'parent-radius',
      metadata: { depends: {} },
      blocks: [
        { id: 'leaf', parent: 'child', user: 'leaf' },
        { id: 'child', parent: 'root', user: 'child' },
        { id: 'root', user: 'open', expect: { tools: [{ label: 'lookup', count: 1 }] } },
        { id: 'unrelated', user: 'hours' },
      ],
    });
    const report = radiusOf(
      [{ spec, hash: 'hash' }],
      { from: 'a', to: 'b', changes: [{ kind: 'tool', id: 'lookup' }] },
      { modes: ['F', 'T', 'P'] },
    );
    expect(report.whole).toBeNull();
    for (const mode of ['F', 'T', 'P'] as const) {
      expect(report.specs[0]?.blocks[0]?.state[mode]).toBe('forward');
      expect(report.specs[0]?.blocks[1]?.state[mode]).toBe('forward');
      expect(report.specs[0]?.blocks[2]?.state[mode]).toBe('direct');
    }
    expect(report.specs[0]?.blocks[3]?.state.T).toBe('out');
  });
});

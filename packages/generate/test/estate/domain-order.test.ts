import { references } from '@agent-nexus/driftbench-checks';
import type { CheckContext } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import { MARKERS, stageModel, thenOf } from '../../src/estate/then';

const gate: EstateAtom = {
  id: 'gate.archive.review',
  kind: 'gate',
  approved: true,
  title: 'Read the retention policy before assessing an archive.',
  provenance: { quote: 'Read `policy/retention.txt` before assessing an archive.' },
  evidence: [
    { type: 'ordered', before: 'Read', after: 'assessing an archive' },
    { type: 'tool_called', label: 'Read', input: { file_path: { contains: 'policy/retention.txt' } } },
  ],
};
const ctx = {
  stages: stageModel([]),
  skills: new Set<string>(),
  customChecks: new Set(['ordered']),
  files: new Set(['policy/retention.txt']),
};

describe('ordering a read before a domain operation', () => {
  it('retains the machine read and judges the unresolved operation using the full source rule', () => {
    const then = thenOf([gate], 'positive', { ...ctx, judge: true });
    expect(then.gaps).toEqual([]);
    expect(then.references).toEqual([{ path: '**/policy/retention.txt', count: { min: 1 } }]);
    expect(then.criteria).toEqual([
      expect.objectContaining({
        name: gate.id,
        gating: true,
        rubric: expect.stringContaining(gate.provenance?.quote ?? ''),
      }),
    ]);
    expect(then.judged).toEqual([gate.id]);
    expect(then.ordered).toEqual([]);
  });
  it('still rejects a faulty agent that skips the required read', async () => {
    const then = thenOf([gate], 'positive', { ...ctx, judge: true });
    const result = await references.evaluate({
      expect: { references: then.references },
      observed: { runtime: { references: [] } },
    } as unknown as CheckContext);
    expect((Array.isArray(result) ? result : [result])[0]?.outcome).toBe('fail');
  });
  it('uses the same fallback for registered custom ordered pairs', () => {
    const custom = {
      ...gate,
      evidence: [
        {
          type: 'custom' as const,
          name: 'ordered',
          options: { pairs: [{ before: 'Read', after: 'assessing an archive' }] },
        },
      ],
    };
    const then = thenOf([custom], 'positive', { ...ctx, judge: true });
    expect(then.gaps).toEqual([]);
    expect(then.criteria[0]?.gating).toBe(true);
  });
  it('requires an anchor when no judge is configured', () => {
    expect(thenOf([gate], 'positive', { ...ctx, judge: false }).gaps.map((g) => g.marker)).toEqual([
      MARKERS.anchor,
    ]);
  });
});

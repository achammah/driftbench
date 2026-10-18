import { describe, expect, it } from 'vitest';
import { cellsOf, generateSuite } from '../../src/enumerate/generate';
import { prepareMap } from '../../src/seed/map';
import { zedProposal } from '../enumerate/support';

const by = {
  evidence: { source: 'prompt.md', quote: 'Balance checks amounts; card replaces cards.' },
  produced_by: 'code' as const,
  approved: true,
};

// Hand-written: only the balance flow recovers from an off-topic question. Flow is a detail, so
// projecting it out must retain its behaviour ownership when deciding the coverage target.
function prepared(phrased = true, joint = false) {
  const proposal = zedProposal({
    extra: [
      {
        id: 'policy',
        title: 'Policy',
        kind: 'behaviour',
        role: 'axis',
        ...by,
        values: ['CHECK-11', 'CHECK-22', 'CHECK-33'].map((id) => ({ id, title: id, ...by })),
      },
    ],
  });
  const flow = proposal.dimensions.find((dimension) => dimension.id === 'flow');
  if (flow) flow.role = 'detail';
  proposal.constraints = [];
  proposal.relations = [
    { kind: 'path', id: 'amount', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    { kind: 'path', id: 'replace', flow: 'card', stages: ['greet', 'lost'], ...by },
    {
      kind: 'recovery',
      class: 'D1_off_topic',
      flows: ['balance'],
      at: ['verify'],
      stage_after: 'pending',
      ...by,
    },
  ];
  if (joint) {
    flow?.values.push({ id: 'other', title: 'Other', ...by });
    proposal.relations.push({ kind: 'path', id: 'other', flow: 'other', stages: ['greet', 'lost'], ...by });
    const recovery = proposal.relations.find((entry) => entry.kind === 'recovery');
    if (recovery?.kind === 'recovery') {
      recovery.flows.push('other');
      recovery.at = ['verify', 'lost'];
    }
  }
  if (!phrased) proposal.phrases = proposal.phrases.filter((phrase) => phrase.value !== 'greet-to-verify');
  return prepareMap(proposal, {
    inventory: {
      behaviours: ['CHECK-11', 'CHECK-22', 'CHECK-33'].map((id) => ({ id, title: id, kind: 'conversation' })),
      flows: [
        { id: 'balance', title: 'Balance', behaviours: ['CHECK-11'] },
        { id: 'card', title: 'Card', behaviours: joint ? ['CHECK-11', 'CHECK-22'] : ['CHECK-22'] },
        ...(joint ? [{ id: 'other', title: 'Other', behaviours: ['CHECK-22'] }] : []),
      ],
    },
  });
}

const contains = (cell: Record<string, string>, target: Record<string, string>) =>
  Object.entries(target).every(([key, value]) => cell[key] === value);

describe('inventory-aware coverage target', () => {
  it('reports impossible behaviour cells and the target counts before and after exclusion', () => {
    const map = prepared();
    const suite = generateSuite(map, { mapPath: 'map.yaml', seed: 42 });
    const report = suite.report.coverage.reachability;
    expect(report).toBeDefined();
    expect(report?.excluded).toEqual(
      expect.arrayContaining([
        {
          cell: { policy: 'CHECK-22', deviation: 'D1_off_topic' },
          reasons: [expect.stringContaining('flow listing')],
        },
      ]),
    );
    expect(report?.excluded.some((entry) => Object.values(entry.cell).includes('CHECK-33'))).toBe(true);
    expect(report?.counts.every((count) => count.before > count.after)).toBe(true);
    expect(suite.report.coverage.actual.map(({ t, allowed }) => ({ t, allowed }))).toEqual(
      report?.counts.map(({ t, after }) => ({ t, allowed: after })),
    );
  });

  it('retains and covers a behaviour on its owning flow with the requested recovery', () => {
    const map = prepared();
    const suite = generateSuite(map, { mapPath: 'map.yaml', seed: 42 });
    const target = { policy: 'CHECK-11', deviation: 'D1_off_topic' };
    expect(
      cellsOf(map, suite.complete, 2).find(({ values }) => contains(values, target))?.count,
    ).toBeGreaterThan(0);
    expect(suite.report.coverage.reachability?.excluded.some(({ cell }) => contains(cell, target))).toBe(
      false,
    );
  });

  it('excludes a jointly impossible triple even when all its pairs are reachable', () => {
    const map = prepared(true, true);
    const target = { policy: 'CHECK-11', deviation: 'D1_off_topic', stage: 'lost' };
    const pairs = cellsOf(map, [], 2);
    for (const [key] of Object.entries(target)) {
      const pair = Object.fromEntries(Object.entries(target).filter(([dimension]) => dimension !== key));
      expect(pairs.some(({ values }) => contains(values, pair))).toBe(true);
    }
    expect(cellsOf(map, [], 3).some(({ values }) => contains(values, target))).toBe(false);
    const suite = generateSuite(map, { mapPath: 'map.yaml', seed: 42 });
    expect(suite.report.coverage.reachability?.excluded).toEqual(
      expect.arrayContaining([{ cell: target, reasons: [expect.stringContaining('flow listing')] }]),
    );
  });

  it('still fails the full-coverage predicate when a reachable cell cannot be built', () => {
    const map = prepared(false);
    const suite = generateSuite(map, { mapPath: 'map.yaml', seed: 42 });
    const target = { policy: 'CHECK-11', deviation: 'D1_off_topic' };
    expect(cellsOf(map, suite.complete, 2).find(({ values }) => contains(values, target))).toMatchObject({
      count: 0,
    });
    expect(suite.report.coverage.actual.find(({ t }) => t === 2)?.uncovered).toEqual(
      expect.arrayContaining([target]),
    );
    // This is the unchanged deviation-balance assertion: an unbuilt reachable cell still makes it fail.
    expect(() =>
      expect(suite.report.coverage.actual.every((level) => level.covered === level.allowed)).toBe(true),
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { bankSummary, formatItems } from '../../src/bank';
import { bankMeasure, defineLadder, runSeeds } from '../../src/ladder';
import { distinctCauses, pointerBank } from '../../src/ladders/pointer/bank/index';
import { bankLadder } from '../../src/ladders/pointer/bank/ladder';
import { FAMILIES } from '../../src/ladders/pointer/bank/specs';
import { row } from '../../src/ladders/pointer/bank/specs/types';
import { fail, type PointerItem } from '../../src/ladders/pointer/bank/types';
import empty from './empty';

const base = pointerBank()[0] as PointerItem;
const items: PointerItem[] = [
  {
    ...base,
    id: 'probe.first',
    family: 'probe',
    cause: 'probe:single-repair',
    run: async () => fail('first'),
  },
  {
    ...base,
    id: 'probe.second',
    family: 'probe',
    cause: 'probe:single-repair',
    causeKind: 'atomic',
    run: async () => fail('second'),
  },
  {
    ...base,
    id: 'probe.aggregate',
    family: 'probe',
    cause: 'probe:multiple-repairs',
    causeKind: 'composite',
    run: async () => fail('aggregate'),
  },
];

describe('declared cause counts exclude composite checks', () => {
  it('carries the spec classification into a pointer item', () => {
    const family = FAMILIES[0];
    const spec = family?.specs[0];
    if (!family || !spec) throw new Error('the pointer bank needs a spec');
    const previous = spec.causeKind;
    try {
      spec.causeKind = 'composite';
      expect(pointerBank().find((item) => item.id === `${family.id}.${spec.key}`)?.causeKind).toBe(
        'composite',
      );
    } finally {
      if (previous === undefined) delete spec.causeKind;
      else spec.causeKind = previous;
    }
  });
  it('preserves composite metadata on specs and lists only atomic declared tags', () => {
    const spec = row('aggregate', 1, 'aggregate', 'input', 'all checks', 'probe:multiple-repairs', {
      causeKind: 'composite',
    });
    expect(spec.causeKind).toBe('composite');
    expect(
      distinctCauses(
        items,
        items.map((item) => item.id),
      ),
    ).toEqual(['probe:single-repair']);
  });

  it('keeps all scored failures through the pointer ladder and serialized global summary', async () => {
    const pointer = bankLadder(items, async () => empty);
    const report = await runSeeds(
      { ...pointer, levels: pointer.levels.slice(0, 1) },
      [{ seed: 1, hidden: false }],
      undefined,
      {
        full: true,
        maxLevel: 1,
      },
    );
    expect(report.seeds[0]?.rows[0]?.observed).toBe(0);
    expect(report.seeds[0]?.failing?.items).toHaveLength(3);
    expect(report.seeds[0]?.failing?.items.find((item) => item.id === 'probe.aggregate')?.causeKind).toBe(
      'composite',
    );
    const summary = bankSummary(JSON.parse(JSON.stringify(report)));
    expect(summary.size).toBe(3);
    expect(summary.passing).toBe(0);
    expect(summary.failingByFamily).toEqual({ probe: 3 });
    expect(summary.failingCauses).toBe(1);
    expect(summary.failingCausesByFamily).toEqual({ probe: 1 });
    expect(summary.rows.find((item) => item.id === 'probe.aggregate')?.causeKind).toBe('composite');
    expect(formatItems(summary, 'pointer')).toContain('declared');
    expect(formatItems(summary, 'pointer', { blind: true })).not.toContain('declared');
  });

  it('does not turn an unnamed composite into an item-specific cause', async () => {
    const measure = bankMeasure([
      { id: 'unnamed-atomic', component: 'probe', family: 'probe', pass: false },
      { id: 'unnamed-composite', component: 'probe', family: 'probe', causeKind: 'composite', pass: false },
    ]);
    const ladder = defineLadder({
      component: 'probe',
      levels: [{ id: 'probe', name: 'probe', metric: 'passing share', threshold: 1, compute: () => measure }],
    });
    const summary = bankSummary(await runSeeds(ladder, [{ seed: 1, hidden: false }]));
    expect(summary.size).toBe(2);
    expect(summary.passing).toBe(0);
    expect(summary.failingCauses).toBe(1);
    expect(summary.failingWithoutCause).toBe(1);
  });
});

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { ensureBehaviourCapacity } from '../../src/ladders/generator/behaviour-capacity';
import { type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import { generateFrom } from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';
import { hiddenSeed } from '../../src/seeds';

const derived = hiddenSeed(process.cwd(), (root) =>
  execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
const seeds = [...Array.from({ length: 20 }, (_, index) => index + 1), 1009, 2027, 4093, 8191];

/** An independent, exhaustive small-space oracle for the documented post-read phrase slots. */
function canSeat(hidden: HiddenSpec): boolean {
  const slots = new Map<string, { flow: string; stage: string }>();
  for (const path of hidden.paths) {
    const reads = new Set(
      hidden.uses
        .filter(
          (use) =>
            use.flow === path.flow && hidden.tools.some((tool) => tool.name === use.tool && !tool.sideEffect),
        )
        .map((use) => use.tool),
    );
    for (let at = 1; at < path.stages.length; at++) {
      if (
        ![...reads].every((tool) =>
          hidden.uses.some(
            (use) =>
              use.flow === path.flow &&
              use.tool === tool &&
              path.stages
                .slice(0, at)
                .some((stage, i) => stage === use.from && path.stages[i + 1] === use.to),
          ),
        )
      )
        continue;
      const stage = path.stages[at] as string;
      slots.set(JSON.stringify([path.flow, stage]), { flow: path.flow, stage });
    }
  }
  const options = hidden.behaviours
    .map((behaviour) =>
      [...slots]
        .filter(([, slot]) =>
          hidden.flows.some((flow) => flow.id === slot.flow && flow.behaviours.includes(behaviour.id)),
        )
        .map(([key]) => key),
    )
    .sort((a, b) => a.length - b.length);
  const search = (index: number, taken: Set<string>): boolean =>
    index === options.length ||
    (options[index] ?? []).some((slot) => !taken.has(slot) && search(index + 1, new Set([...taken, slot])));
  return search(0, new Set());
}

describe('hidden behaviour obligations have owners and feasible distinct phrase slots', () => {
  it('checks the commit-derived hidden map in memory without serializing it', () => {
    expect(derived.source).toBe('head');
    const hidden = hiddenSpec(derived.seed);
    expect(
      hidden.behaviours.every((behaviour) =>
        hidden.flows.some((flow) => flow.behaviours.includes(behaviour.id)),
      ),
    ).toBe(true);
    expect(canSeat(hidden)).toBe(true);
  });
  it.each(seeds)('seed %i: every listed behaviour has an owner and the full phrase set fits', (seed) => {
    const hidden = hiddenSpec(seed);
    for (const behaviour of hidden.behaviours)
      expect(
        hidden.flows.some((flow) => flow.behaviours.includes(behaviour.id)),
        behaviour.id,
      ).toBe(true);
    expect(canSeat(hidden)).toBe(true);
  });

  it('seed 12: even the already-owned behaviours must fit distinct post-read slots', () => {
    const hidden = hiddenSpec(12);
    hidden.behaviours = hidden.behaviours.filter((behaviour) =>
      hidden.flows.some((flow) => flow.behaviours.includes(behaviour.id)),
    );
    expect(canSeat(hidden)).toBe(true);
  });
});

describe('capacity repair is independent of seed and bank vocabulary', () => {
  function parcelFixture(): HiddenSpec {
    return {
      ...hiddenSpec(1009),
      behaviours: ['inspect-parcel', 'check-label', 'store-receipt'].map((id) => ({ id, title: id })),
      flows: [
        {
          id: 'short-route',
          title: 'Short depot route',
          behaviours: ['inspect-parcel', 'check-label'],
          deviations: [],
        },
        { id: 'long-route', title: 'Long depot route', behaviours: [], deviations: [] },
      ],
      tools: [],
      uses: [],
      paths: [
        {
          id: 'short-path',
          flow: 'short-route',
          stages: ['dock', 'ready'],
          when: {},
          quote: 'Start at the dock.',
        },
        {
          id: 'long-path',
          flow: 'long-route',
          stages: ['dock', 'labelled', 'ready'],
          when: {},
          quote: 'Label before dispatch.',
        },
      ],
    };
  }
  it('preserves every drawn edge and adds only the edges needed to seat an orphan and a capacity collision', () => {
    const hidden = parcelFixture();
    const before = structuredClone(hidden);
    expect(canSeat(hidden)).toBe(false);
    ensureBehaviourCapacity(hidden);
    expect(canSeat(hidden)).toBe(true);
    expect(hidden.flows[0]?.behaviours).toEqual(before.flows[0]?.behaviours);
    expect(hidden.flows[1]?.behaviours).toHaveLength(2);
    expect({ ...hidden, flows: [] }).toEqual({ ...before, flows: [] });
    const repaired = structuredClone(hidden);
    ensureBehaviourCapacity(hidden);
    expect(hidden).toEqual(repaired);
  });
  it('rejects insufficient total path capacity instead of waiving an obligation', () => {
    const hidden = parcelFixture();
    hidden.paths = hidden.paths.slice(0, 1);
    expect(() => ensureBehaviourCapacity(hidden)).toThrow('capacity');
  });
  it('reserves originally owned capacity before assigning an orphan', () => {
    const hidden = parcelFixture();
    hidden.behaviours = ['orphan', 'fixed'].map((id) => ({ id, title: id }));
    hidden.flows = [
      { id: 'narrow', title: 'Narrow', behaviours: ['fixed'], deviations: [] },
      { id: 'spare', title: 'Spare', behaviours: [], deviations: [] },
    ];
    hidden.paths = hidden.flows.map((flow) => ({
      id: `${flow.id}-path`,
      flow: flow.id,
      stages: ['dock', 'ready'],
      when: {},
      quote: 'At the dock.',
    }));
    ensureBehaviourCapacity(hidden);
    expect(hidden.flows.map((flow) => flow.behaviours)).toEqual([['fixed'], ['orphan']]);
    expect(canSeat(hidden)).toBe(true);
  });
  it('adds the minimum number of edges across every three-by-three ownership graph', () => {
    const ids = ['inspect-parcel', 'check-label', 'store-receipt'];
    // Independent exhaustive maximum-cardinality matching, including the option to leave a phrase unmatched.
    const maximum = (owners: string[][], at = 0, used = new Set<number>()): number => {
      if (at === ids.length) return 0;
      return Math.max(
        maximum(owners, at + 1, used),
        ...owners.map((owned, flow) =>
          !used.has(flow) && owned.includes(ids[at] as string)
            ? 1 + maximum(owners, at + 1, new Set([...used, flow]))
            : 0,
        ),
      );
    };
    for (let mask = 0; mask < 2 ** 9; mask++) {
      const hidden = parcelFixture();
      hidden.flows = ['north', 'south', 'west'].map((id, flow) => ({
        id,
        title: id,
        deviations: [],
        behaviours: ids.filter((_, behaviour) => Boolean(mask & (1 << (flow * ids.length + behaviour)))),
      }));
      hidden.paths = hidden.flows.map((flow) => ({
        id: `${flow.id}-path`,
        flow: flow.id,
        stages: ['dock', 'ready'],
        when: {},
        quote: 'At the dock.',
      }));
      const original = hidden.flows.map((flow) => [...flow.behaviours]);
      const required = ids.length - maximum(original);
      ensureBehaviourCapacity(hidden);
      const added = hidden.flows.reduce(
        (sum, flow, index) => sum + flow.behaviours.filter((id) => !original[index]?.includes(id)).length,
        0,
      );
      expect(added, `ownership graph ${mask}`).toBe(required);
      for (const [index, owned] of original.entries())
        expect(owned.every((id) => hidden.flows[index]?.behaviours.includes(id))).toBe(true);
      expect(canSeat(hidden)).toBe(true);
    }
  });
});

describe('owned phrases remain mandatory on fresh generated maps', () => {
  for (const seed of [1009, 2027, 4093, 8191]) {
    it(`seed ${seed}: silent omission and a forged capacity report still fail coverage`, async () => {
      const hidden = hiddenSpec(seed);
      const generated = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
      const item = bankItems().find((item) => item.id === 'phrases.behaviours');
      if (!item) throw new Error('missing behaviour phrase item');
      const check = () => item.check({ generated: async () => generated } as SeedData);
      const baseline = await check();
      expect(baseline.pass, baseline.detail).toBe(true);
      const phrase = hidden.phrases.find((phrase) => phrase.intent.kind === 'behaviour');
      if (!phrase) throw new Error('no owned behaviour phrase');
      const target = phrase.intent.kind === 'behaviour' ? phrase.intent.behaviour : '';
      expect(hidden.flows.some((flow) => flow.behaviours.includes(target))).toBe(true);
      generated.complete = generated.complete.filter(
        ({ spec }) => !JSON.stringify(spec.blocks.map((block) => block.when)).includes(phrase.text),
      );
      expect((await check()).pass).toBe(false);
      if (!generated.report) throw new Error('no product report');
      Object.assign(generated.report, {
        no_phrase: [
          {
            dimension: 'behaviour',
            value: target,
            blocks: 0,
            specs: [],
            unsaid: [{ text: phrase.text, reasons: ['no walk reaches a stage it can be said at'] }],
          },
        ],
      });
      expect((await check()).pass).toBe(false);
    }, 300_000);
  }
});

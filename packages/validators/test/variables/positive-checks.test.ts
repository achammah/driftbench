import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import type { VariablesImpl } from '../../src/ladders/variables/interface';
import { variablesImpl as empty } from './constant-empty';
import { variablesImpl as reference } from './positive-reference';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REFERENCE = fileURLToPath(new URL('./positive-reference.ts', import.meta.url));
const EMPTY = fileURLToPath(new URL('./constant-empty.ts', import.meta.url));

// The independent review's exact 51 credited items. Keep the population explicit so a renamed or missing
// item cannot silently disappear from the mutant and positive-witness checks.
const CASES: Array<[keyof VariablesImpl, string, string[]]> = [
  ['buildStore', 'sources.order-independent', ['rules-permuted']],
  ['buildStore', 'sources.empty-sources', ['nothing', 'empty-estate', 'empty-conversations']],
  ['plan', 'impossible.duplicates-count-once', ['thrice', 'both-orders']],
  ['plan', 'impossible.unsatisfiable-space', ['two-single-valued', 'cycle']],
  ['weightInterval', 'weights.interval-holds-estimate', ['ordinary', 'one-session', 'all-same']],
  [
    'weightInterval',
    'weights.interval-coverage',
    [
      'half-n100',
      'half-n20',
      'tenth-n50',
      'two-percent-n100',
      'two-percent-n1000',
      'half-percent-n500',
      'ninety-five-n40',
      'near-one-n300',
    ],
  ],
  ['coverage', 'counter.strict-extendable', ['empty-space']],
  ['coverage', 'counter.uncovered-list', ['none-uncovered']],
  ['plan', 'seeds.pure-copy', ['seed-objects-not-aliased']],
  ['plan', 'budget.new-rows-common-first', ['four-variables', 'ten-variables', 'equal-shares-ties']],
  ['plan', 'budget.uniform-without-weights', ['no-weights', 'partial-weights']],
  ['plan', 'budget.weight-reported', ['short-rows', 'uneven-shares']],
  [
    'plan',
    'determinism.same-seed-same-bytes',
    ['tiny', 'rules-seeds-budget', 'heavy-constraints', 'equal-weights-ties', 'two-hundred-binary'],
  ],
  ['plan', 'determinism.interleaved-calls', ['other-store-between', 'other-budget-between']],
  [
    'plan',
    'determinism.across-processes',
    ['default-env', 'other-time-zone', 'turkish-locale', 'accented-ids-sort'],
  ],
  [
    'plan',
    'determinism.no-ambient-randomness',
    ['math-random-throws', 'clock-frozen-differently', 'crypto-throws', 'all-three'],
  ],
  ['plan', 'determinism.key-order', ['store-keys', 'seed-row-keys']],
  ['plan', 'determinism.json-round-trip', ['store', 'options']],
  ['plan', 'determinism.inputs-not-written', ['frozen-store', 'frozen-seeds', 'frozen-options']],
];

const cases = CASES.flatMap(([operation, stem, variants]) =>
  variants.map((variant) => ({ operation, id: `${stem}.${variant}` })),
);
const items = new Map(variablesBank().map((item) => [item.id, item]));

describe('positive witnesses and constant-result mutants', () => {
  it('covers every credited item in the review', () => {
    expect(cases).toHaveLength(51);
    expect(new Set(cases.map((c) => c.id)).size).toBe(51);
    for (const { id } of cases) expect(items.has(id), id).toBe(true);
  });

  it.each(cases)(
    '$id accepts the positive witness and kills the $operation mutant',
    async ({ id, operation }) => {
      const item = items.get(id);
      expect(item, id).toBeDefined();
      if (!item) return;
      const positive = await runItem(item, 1, ROOT, reference, REFERENCE);
      expect(positive, id).toMatchObject({ pass: true });
      const mutant = { ...reference, [operation]: empty[operation] };
      // Cross-process items only call plan, so the child uses the identical empty plan function.
      const negative = await runItem(item, 1, ROOT, mutant, operation === 'plan' ? EMPTY : REFERENCE);
      expect(negative, id).toMatchObject({ pass: false });
    },
    120_000,
  );

  const nonemptyMutants: Array<{ id: string; operation: Partial<VariablesImpl> }> = [
    {
      id: 'sources.order-independent.rules-permuted',
      operation: {
        buildStore(sources) {
          const store = reference.buildStore(sources);
          for (const variable of store.variables) variable.values.pop();
          return store;
        },
      },
    },
    {
      id: 'sources.empty-sources.nothing',
      operation: {
        buildStore(sources) {
          const store = reference.buildStore(sources);
          for (const variable of store.variables) {
            for (const value of variable.values) {
              value.provenance = [{ kind: 'quote', path: 'TOOLS.md', quote: 'unrelated evidence' }];
            }
          }
          return store;
        },
      },
    },
    ...[
      'impossible.duplicates-count-once.thrice',
      'budget.weight-reported.short-rows',
      'determinism.same-seed-same-bytes.tiny',
    ].map((id) => ({
      id,
      operation: {
        plan: () => ({ rows: [{ id: 'fake', kind: 'new' as const, values: {}, weight: 1 }] }),
      },
    })),
    {
      id: 'impossible.unsatisfiable-space.cycle',
      operation: {
        plan(store, options) {
          const plan = reference.plan(store, options);
          return plan.rows.length === 0
            ? plan
            : { rows: [{ id: 'fake', kind: 'new', values: {}, weight: 1 }] };
        },
      },
    },
    {
      id: 'counter.uncovered-list.none-uncovered',
      operation: { coverage: () => ({ allowed: 1, covered: 1, uncovered: [] }) },
    },
    {
      id: 'seeds.pure-copy.seed-objects-not-aliased',
      operation: {
        plan(store, options) {
          const plan = reference.plan(store, options);
          for (const row of plan.rows) if (row.kind === 'seed') row.values = {};
          return plan;
        },
      },
    },
    {
      id: 'weights.interval-holds-estimate.one-session',
      operation: {
        weightInterval: (count, total) =>
          total === 100 ? [0.2, 0.8] : reference.weightInterval(count, total),
      },
    },
  ];

  it.each(nonemptyMutants)('$id rejects a nonempty but wrong witness', async ({ id, operation }) => {
    const item = items.get(id);
    expect(item).toBeDefined();
    if (!item) return;
    const outcome = await runItem(item, 1, ROOT, { ...reference, ...operation }, REFERENCE);
    expect(outcome, id).toMatchObject({ pass: false });
  });

  it.each(['default-env', 'other-time-zone', 'turkish-locale', 'accented-ids-sort'])(
    'rejects an empty child result after a useful local plan in %s',
    async (variant) => {
      const item = items.get(`determinism.across-processes.${variant}`);
      expect(item).toBeDefined();
      if (!item) return;
      const outcome = await runItem(item, 1, ROOT, reference, EMPTY);
      expect(outcome).toMatchObject({ pass: false });
      expect(outcome.detail).toContain('differs');
    },
    30_000,
  );
});

import { fixture, forbid, passage, planCase } from './fixture';
import type { BankItem, Case, Cell, PlanTruth, Tier } from './types';

const variants = {
  'impossible-pairs': [
    'pair',
    'triple',
    'unary',
    'indirect-unreachable',
    'detail-constraint',
    'unapproved-constraint',
  ],
  strength: [
    'own-triples',
    'own-four-variables',
    'shared-axes',
    'detail-exclusion',
    'conditional-membership',
    'ledger-identity',
  ],
  'seed-rows': ['partial', 'full', 'duplicate-sessions', 'forbidden-session', 'unknown-entry', 'over-budget'],
  'budget-order': ['zero', 'one', 'interior-prefix', 'ample', 'weighted-order', 'seed-prefix'],
  counter: [
    'zero-covered',
    'partial-covered',
    'seeded-targets',
    'infeasible-targets',
    'overlapping-groups',
    'complete',
  ],
  scale: [
    'singleton-width',
    'weighted-width',
    'zero-weight-width',
    'detail-width',
    'seed-width',
    'long-source',
  ],
} as const;

function cases(family: keyof typeof variants, variant: number, tier: Tier, seed: number): Case[] {
  if (family === 'scale') return scaleCases(variant, tier, seed);
  const count = Math.max(4, tier + 1);
  const { store, files } = fixture(seed, `${family}:${variant}`, tier, count);
  const truth: Omit<PlanTruth, 'kind'> = { groups: [], shared: [] };
  const group = (indices: number[], tag: string) => truth.groups.push(passage(store, files, indices, tag));
  const full = (): Cell => Object.fromEntries(store.variables.map((v) => [v.id, v.values[0]!.id]));
  if (family === 'strength') {
    if (variant === 0) group([0, 1, 2], 'triple');
    if (variant === 1) group([0, 1, 2, 3], 'quartet');
    if (variant === 2 || variant === 3) {
      // All axes in multi-variable rules are shared; extras are details. No undocumented interpretation.
      store.variables[0]!.role = 'axis';
      store.variables[1]!.role = variant === 3 ? 'detail' : 'axis';
      store.variables[2]!.role = 'detail';
      store.variables[3]!.role = 'detail';
      group([0, 1, 2], 'left');
      group([0, 1, 3], 'right');
      truth.shared = variant === 3 ? [] : [store.variables[0]!.id, store.variables[1]!.id];
    }
    if (variant === 4) {
      const ids = passage(store, files, [0], 'condition');
      const value = store.variables[0]!.values[0]!;
      value.when = { [store.variables[1]!.id]: [store.variables[1]!.values[0]!.id] };
      value.unless = { [store.variables[2]!.id]: [store.variables[2]!.values[0]!.id] };
      truth.groups.push([...ids, store.variables[1]!.id, store.variables[2]!.id]);
    }
    if (variant === 5) {
      passage(store, files, [0, 1], 'first-wording', 'abcdefgh23');
      passage(store, files, [2], 'second-wording', 'abcdefgh23');
      truth.groups.push(store.variables.slice(0, 3).map((v) => v.id));
    }
  } else group([0, 1, 2], 'cover');
  if (family === 'impossible-pairs') {
    if (variant === 0)
      forbid(store, [
        [0, 0],
        [1, 0],
      ]);
    if (variant === 1)
      forbid(store, [
        [0, 0],
        [1, 0],
        [2, 0],
      ]);
    if (variant === 2) forbid(store, [[0, 0]]);
    if (variant === 3)
      store.variables[1]!.values.forEach((_, j) => {
        forbid(store, [
          [0, 0],
          [1, j],
        ]);
      });
    if (variant === 4) {
      store.variables[1]!.role = 'detail';
      forbid(store, [
        [0, 0],
        [1, 0],
      ]);
    }
    if (variant === 5)
      forbid(
        store,
        [
          [0, 0],
          [1, 0],
        ],
        false,
      );
  }
  if (family === 'counter' && variant === 3)
    forbid(store, [
      [0, 0],
      [1, 0],
    ]);
  if (family === 'counter' && variant === 4) {
    store.variables[2]!.role = 'detail';
    store.variables[3]!.role = 'detail';
    store.variables[0]!.role = 'axis';
    store.variables[1]!.role = 'axis';
    group([0, 1, 3], 'overlap');
    truth.shared = store.variables.slice(0, 2).map((v) => v.id);
  }
  const base = planCase(store, seed, truth);
  if (base.request.operation !== 'plan') throw new Error('plan fixture');
  if (family === 'seed-rows') {
    const a = store.variables[0]!;
    let values = variant === 0 ? { [a.id]: a.values[0]!.id } : full();
    if (variant === 3) {
      forbid(store, [
        [0, 0],
        [1, 0],
      ]);
      base.request.store = structuredClone(store);
    }
    if (variant === 4) values = { ...values, [a.id]: 'unknown_value', unknown_variable: 'unknown_value' };
    base.request.options.seeds = [{ id: 'fictional-first', values }];
    if (variant === 2 || variant === 5)
      base.request.options.seeds.push({ id: 'fictional-second', values: { ...values } });
    if (variant === 5) base.request.options.budget = 0;
    return [base, structuredClone(base)];
  }
  if (family === 'budget-order') {
    if (variant === 4) {
      for (const v of base.request.store.variables)
        v.values.forEach((x, i) => {
          x.weight = i === 0 ? 1 : 3;
        });
    }
    if (variant === 5) base.request.options.seeds = [{ id: 'fictional-first', values: full() }];
    const limited = structuredClone(base);
    if (limited.request.operation === 'plan')
      limited.request.options.budget = [0, 1, 3, 10000, 2, 0][variant]!;
    return [base, limited, structuredClone(base)];
  }
  if (family === 'counter') {
    if (variant < 2) base.request.options.budget = variant;
    if (variant === 2) base.request.options.seeds = [{ id: 'fictional-first', values: full() }];
  }
  return [base, structuredClone(base)];
}

function scaleCases(variant: number, tier: Tier, seed: number): Case[] {
  return [1, 10, 100]
    .map((factor): Case => {
      const { store, files, nonce } = fixture(seed, `scale:${variant}:${factor}`, tier, 12 * factor);
      if (variant === 5) {
        const path = `fiction/${nonce}.md`;
        files[path] = `${'x'.repeat(1000 * factor)} Fictional scale marker ${nonce}.`;
        for (const variable of store.variables)
          for (const value of variable.values)
            value.provenance = [{ kind: 'quote', path, quote: `Fictional scale marker ${nonce}.` }];
        return {
          request: { operation: 'quotes', store, files },
          truth: { kind: 'quotes', issues: [] },
          budgetMs: 5000,
          heapBytes: 256 * 1024 * 1024,
        };
      }
      if (variant === 1 || variant === 2)
        for (const v of store.variables)
          v.values.forEach((x, i) => {
            x.weight = i === 0 ? (variant === 2 ? 0 : 1) : 9;
          });
      if (variant === 3) for (const v of store.variables) v.role = 'detail';
      const item = planCase(store, seed, { groups: [], shared: [], factorized: true });
      if (variant === 4 && item.request.operation === 'plan')
        item.request.options.seeds = [
          {
            id: 'fictional-wide',
            values: Object.fromEntries(store.variables.map((v) => [v.id, v.values[0]!.id])),
          },
        ];
      item.budgetMs = 5000;
      item.heapBytes = 256 * 1024 * 1024;
      return item;
    })
    .flatMap((test) => {
      if (variant !== 5) return [test];
      // A constant empty error list must not pass even the valid long-source scale item.
      const bad = structuredClone(test) as Case;
      if (bad.request.operation === 'quotes') {
        const quote = bad.request.store.variables[0]!.values[0]!.provenance![0]!;
        quote.quote = `absent-${seed}`;
        bad.truth = {
          kind: 'quotes',
          issues: [{ code: 'VARIABLES_QUOTE_NOT_FOUND', path: 'variables.0.values.0.provenance.0.quote' }],
        };
      }
      return [test, bad];
    });
}

export function planItems(): BankItem[] {
  return Object.entries(variants).flatMap(([family, names]) =>
    names.flatMap((name, variant) =>
      ([1, 2, 3, 4, 5] as Tier[]).map((tier) => ({
        id: `${family}.${name}.t${tier}`,
        family,
        tier,
        level: tier,
        component: family === 'scale' && variant === 5 ? 'verifyVariableQuotes' : 'planV2',
        title: `${name} in structural context ${tier}`,
        cause: `${family}:${name}`,
        generate: (seed: number) => cases(family as keyof typeof variants, variant, tier, seed),
      })),
    ),
  );
}

import { accepted, fixture, planCase, rejected } from './fixture';
import type { BankItem, Case, Tier } from './types';

const variants = {
  sources: [
    'count-over-total',
    'fractional-count',
    'private-payload',
    'uppercase-hash',
    'invalid-calendar-day',
    'ledger-shape',
  ],
  quotes: [
    'whitespace',
    'typographic-quotes',
    'unicode-composition',
    'markdown-escape',
    'case-sensitive',
    'punctuation-sensitive',
  ],
  values: [
    'duplicate-value',
    'ambiguous-axis-value',
    'repeated-channel',
    'unknown-when-variable',
    'unknown-unless-value',
    'approval-inheritance',
  ],
  boundaries: ['strict-gt', 'strict-lt', 'inclusive-ge', 'inclusive-le', 'distinct-sides', 'unknown-edge'],
  weights: ['incomplete', 'all-zero', 'negative', 'nonfinite', 'relative-normalization', 'zero-share'],
} as const;

function cases(family: keyof typeof variants, variant: number, tier: Tier, seed: number): Case[] {
  const { store, files, nonce } = fixture(seed, `${family}:${variant}`, tier);
  const position = (tier - 1) % store.variables.length;
  const variable = store.variables[position]!;
  const value = variable.values[0]!;
  const path = `variables.${position}.values.0`;
  if (family === 'sources') {
    const source =
      variant < 4
        ? { kind: 'conversations', count: 2, total: 5, set_hash: 'a'.repeat(64) }
        : variant === 4
          ? { kind: 'owner', words: `Fictional consent ${nonce}`, date: '2024-02-29' }
          : { kind: 'quote', path: 'fiction/prompt.md', quote: `Fictional ${nonce}`, ledger: 'abcdefgh23' };
    value.provenance = [source];
    const good = accepted(store);
    const s = source as Record<string, unknown>;
    const field = ['count', 'count', '', 'set_hash', 'date', 'ledger'][variant]!;
    if (variant === 0) s.count = 6;
    if (variant === 1) s.count = 0.5;
    if (variant === 2) s.text = 'Fictional transcript text must never enter counts.';
    if (variant === 3) s.set_hash = 'A'.repeat(64);
    if (variant === 4) s.date = '2023-02-29';
    if (variant === 5) s.ledger = 'ABCDefgh23';
    const code = [
      'SCHEMA_CUSTOM',
      'SCHEMA_INVALID_TYPE',
      'SCHEMA_UNRECOGNIZED_KEYS',
      'SCHEMA_INVALID_FORMAT',
      'SCHEMA_INVALID_FORMAT',
      'SCHEMA_INVALID_FORMAT',
    ][variant]!;
    return [good, rejected(store, code, `${path}.provenance.0${field ? `.${field}` : ''}`)];
  }
  if (family === 'quotes') {
    const sourcePath = `fiction/${nonce}/file.md`;
    const stem = `Fictional ${nonce}: `;
    const source = [
      'two\n\t  settings.',
      'say “yes” or ‘no’.',
      'cafe\u0301 approved.',
      'a \\*literal\\* mark.',
      'Accept only Yes.',
      'Accept, then stop.',
    ][variant]!;
    const quote = [
      'two settings.',
      'say "yes" or \'no\'.',
      'café approved.',
      'a *literal* mark.',
      'Accept only Yes.',
      'Accept, then stop.',
    ][variant]!;
    files[sourcePath] = `${tier === 5 ? 'x'.repeat(100_000) : '# Fictional source\n'}${stem}${source}\n`;
    // Exercise all documented provenance locations as well as later list positions.
    const evidence = { kind: 'quote', path: sourcePath, quote: stem + quote };
    let issuePath = `${path}.provenance.0`;
    if (tier === 2) {
      variable.provenance = [evidence];
      issuePath = `variables.${position}.provenance.0`;
    } else if (tier === 3) {
      variable.boundaries = [
        {
          holds: variable.values[0]!.id,
          fails: variable.values[1]!.id,
          edge: variable.values[1]!.id,
          provenance: [evidence],
        },
      ];
      issuePath = `variables.${position}.boundaries.0.provenance.0`;
    } else if (tier === 4) {
      store.constraints.push({
        forbid: { [variable.id]: value.id },
        reason: 'Fictional exclusion',
        approved: true,
        provenance: [evidence],
      });
      issuePath = 'constraints.0.provenance.0';
    } else value.provenance = [evidence];
    const good: Case = {
      request: { operation: 'quotes', store: structuredClone(store), files: { ...files } },
      truth: { kind: 'quotes', issues: [] },
    };
    evidence.quote =
      variant === 4
        ? evidence.quote.replace('Yes', 'yes')
        : variant === 5
          ? evidence.quote.replace(',', ';')
          : `${evidence.quote} absent-${nonce}`;
    const bad: Case = {
      request: { operation: 'quotes', store: structuredClone(store), files: { ...files } },
      truth: { kind: 'quotes', issues: [{ code: 'VARIABLES_QUOTE_NOT_FOUND', path: `${issuePath}.quote` }] },
    };
    const missing: Case = {
      request: { operation: 'quotes', store, files: {} },
      truth: { kind: 'quotes', issues: [{ code: 'VARIABLES_SOURCE_UNREADABLE', path: `${issuePath}.path` }] },
    };
    return [good, bad, missing];
  }
  if (family === 'values') {
    const good = accepted(store);
    if (variant === 0) {
      variable.values[1]!.id = value.id;
      return [good, rejected(store, 'VARIABLES_DUPLICATE', `variables.${position}.values.1.id`)];
    }
    if (variant === 1) {
      // Both are axes; the exempt detail case is not silently used as a failing fixture.
      store.variables[0]!.role = 'axis';
      store.variables[1]!.role = 'axis';
      store.variables[1]!.values[0]!.id = store.variables[0]!.values[0]!.id;
      return [good, rejected(store, 'VARIABLES_AMBIGUOUS_VALUE', 'variables.1.values.0.id')];
    }
    if (variant === 2) {
      for (const v of store.variables.slice(0, 2)) {
        v.role = 'axis';
        v.kind = 'channel';
      }
      return [good, rejected(store, 'VARIABLES_KIND_REPEATED', 'variables.1.kind')];
    }
    if (variant === 3) {
      value.when = { absent: [value.id] };
      return [good, rejected(store, 'VARIABLES_UNKNOWN_VARIABLE', `${path}.when.absent`)];
    }
    if (variant === 4) {
      value.unless = { [variable.id]: [`missing_${nonce}`] };
      return [good, rejected(store, 'VARIABLES_UNKNOWN_VALUE', `${path}.unless.${variable.id}.0`)];
    }
    variable.approved = false;
    value.approved = true;
    const a = planCase(store, seed, { groups: [], shared: [] });
    const b = planCase(store, seed, { groups: [], shared: [] });
    if (b.request.operation === 'plan') b.request.options.approvedOnly = false;
    return [a, b];
  }
  if (family === 'boundaries') {
    const comparison = (['gt', 'lt', 'ge', 'le', 'gt', 'gt'] as const)[variant]!;
    const inclusive = comparison === 'ge' || comparison === 'le';
    const boundary = {
      holds: value.id,
      fails: variable.values[1]!.id,
      edge: inclusive ? value.id : variable.values[1]!.id,
      limit: tier === 3 ? -2 : tier === 2 ? 0 : seed % 19,
      comparison,
      unit: 'fictional units',
      provenance: value.provenance,
    };
    if (tier === 3) {
      variable.values.push({
        id: `edge_${nonce}`,
        title: 'Exactly at the fictional limit',
        provenance: structuredClone(value.provenance),
      });
      boundary.edge = `edge_${nonce}`;
    }
    variable.boundaries = [boundary];
    const good = accepted(store);
    if (variant < 4) boundary.edge = inclusive ? boundary.fails : boundary.holds;
    if (variant === 4) boundary.fails = boundary.holds;
    if (variant === 5) boundary.edge = `missing_${nonce}`;
    return [
      good,
      rejected(
        store,
        variant === 5 ? 'VARIABLES_UNKNOWN_VALUE' : 'VARIABLES_BOUNDARY',
        `variables.${position}.boundaries.0.${variant === 4 ? 'fails' : 'edge'}`,
      ),
    ];
  }
  for (const v of variable.values) v.weight = 1;
  const good = accepted(store);
  if (variant === 0) {
    delete variable.values[1]!.weight;
    return [good, rejected(store, 'VARIABLES_WEIGHT_INCOMPLETE', `variables.${position}.values.1.weight`)];
  }
  if (variant === 1) {
    for (const v of variable.values) v.weight = 0;
    return [good, rejected(store, 'VARIABLES_WEIGHT_ZERO', `variables.${position}.values`)];
  }
  if (variant === 2) {
    value.weight = -1;
    return [good, rejected(store, 'SCHEMA_TOO_SMALL', `${path}.weight`)];
  }
  if (variant === 3) {
    value.weight = tier % 2 ? Number.NaN : Number.POSITIVE_INFINITY;
    return [good, rejected(store, 'SCHEMA_INVALID_TYPE', `${path}.weight`)];
  }
  variable.values.forEach((v, i) => {
    v.weight = variant === 5 && i === 0 ? 0 : (i + 1) * (1 + ((seed >>> 0) % 13));
  });
  const a = planCase(store, seed, { groups: [], shared: [] });
  variable.values.forEach((v) => {
    v.weight = (v.weight ?? 1) * 100;
  });
  const b = planCase(store, seed, { groups: [], shared: [] });
  return [a, b];
}

export function storeItems(): BankItem[] {
  return Object.entries(variants).flatMap(([family, names]) =>
    names.flatMap((name, variant) =>
      ([1, 2, 3, 4, 5] as Tier[]).map((tier) => ({
        id: `${family}.${name}.t${tier}`,
        family,
        tier,
        level: tier,
        component:
          family === 'quotes'
            ? 'verifyVariableQuotes'
            : (family === 'weights' && variant > 3) || (family === 'values' && variant === 5)
              ? 'planV2'
              : 'validateVariableStore',
        title: `${name} in structural context ${tier}`,
        cause: `${family}:${name}`,
        generate: (seed: number) => cases(family as keyof typeof variants, variant, tier, seed),
      })),
    ),
  );
}

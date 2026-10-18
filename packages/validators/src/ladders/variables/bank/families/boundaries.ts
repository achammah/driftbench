import type { StoreDoc, StoreVariable } from '../../interface';
import { build, type ItemContext, type StemRun } from '../item';
import {
  CLASS_OF_STEM,
  type Cmp,
  fileOf,
  groupThousands,
  NARROW_NBSP,
  type NumericSpan,
  numberWords,
  numericSpan,
  QUANTITIES,
  type Quantity,
  ruleSentence,
  WORDINGS,
} from '../oracle/conditions';
import { citing, estateOf, variablesCiting } from '../oracle/estate';
import { must, type Rng, show } from '../util';
import { exactlyOne } from './sources';

/**
 * Family boundaries: for a numeric condition with threshold t the variable holds exactly three values whose
 * samples are s1 < t, s2 = t, s3 > t (integers when t is an integer), each citing the span.
 */

type Opts = { requireInteger?: boolean | undefined; cls?: Cmp | undefined };

/** Builds a store from spans in one file (one rule each) and returns it. */
function storeOf(ctx: ItemContext, texts: readonly string[], file?: string): StoreDoc {
  const { rng } = ctx;
  const text =
    file ??
    fileOf(
      rng,
      texts.map((t) => ruleSentence(t, rng)),
      5,
    );
  return build(ctx, {
    estate: estateOf(
      { 'CLAUDE.md': text },
      texts.map((t, i) => ({ id: `R${i + 1}`, source: 'CLAUDE.md', conditions: [t], tools: [] })),
    ),
  });
}

/** The three samples around t, checked; returns the variable. */
export function checkThree(store: StoreDoc, text: string, t: number, opts: Opts = {}): StoreVariable {
  const v = exactlyOne(variablesCiting(store, text), `variables whose values cite "${text}"`);
  must(
    v.values.length === 3,
    () =>
      `"${text}" gives ${v.values.length} values (${show(v.values.map((x) => x.sample))}), expected 3: two sides and the boundary`,
  );
  const samples = v.values.map((x) => x.sample);
  must(
    samples.every((s) => typeof s === 'number' && Number.isFinite(s)),
    () => `"${text}" gives samples ${show(samples)}, expected finite numbers`,
  );
  const sorted = [...(samples as number[])].sort((a, b) => a - b);
  const [s1, s2, s3] = sorted as [number, number, number];
  must(
    s2 === t,
    () => `the boundary sample of "${text}" is ${s2}, expected the threshold ${t} (samples ${show(sorted)})`,
  );
  must(
    s1 < t && t < s3,
    () => `the samples ${show(sorted)} of "${text}" are not below, at and above the threshold ${t}`,
  );
  if (opts.requireInteger ?? Number.isInteger(t)) {
    must(
      sorted.every(Number.isInteger),
      () =>
        `the threshold of "${text}" is the integer ${t} but the samples ${show(sorted)} are not all integers`,
    );
  }
  must(citing(store, text).length === 3, () => `each of the 3 values of "${text}" should cite the span`);
  if (opts.cls === 'gt' || opts.cls === 'ge' || opts.cls === 'lt' || opts.cls === 'le')
    checkBoundary(v, text, t, opts.cls);
  return v;
}

/** The boundary entry of the variable (docs/variables.md "Boundaries"): limit, comparison and the three values. */
function checkBoundary(v: StoreVariable, text: string, t: number, cls: 'gt' | 'ge' | 'lt' | 'le'): void {
  const list = v.boundaries ?? [];
  must(
    list.length >= 1,
    () => `"${text}" names a limit of ${t} but the variable ${v.id} carries no boundaries entry`,
  );
  const b = list.find((x) => x.limit === t);
  must(!!b, () => `no boundaries entry of ${v.id} has the limit ${t}: ${show(list)}`);
  const e = b as NonNullable<typeof b>;
  must(
    e.comparison === cls,
    () => `the boundaries entry of "${text}" has the comparison ${show(e.comparison)}, expected ${cls}`,
  );
  const sampleOf = (id: string) => v.values.find((x) => x.id === id)?.sample as number | undefined;
  const [h, f, g] = [sampleOf(e.holds), sampleOf(e.fails), sampleOf(e.edge)];
  must(
    typeof h === 'number' && typeof f === 'number' && typeof g === 'number',
    () => `the boundaries entry of ${v.id} names ids that are not values with a number sample: ${show(e)}`,
  );
  must(g === t, () => `the edge value of "${text}" has the sample ${g}, expected the limit ${t}`);
  const holdsOk = (x: number) =>
    cls === 'gt' ? x > t : cls === 'ge' ? x >= t : cls === 'lt' ? x < t : x <= t;
  must(
    holdsOk(h as number),
    () => `the holds value of "${text}" has the sample ${h}, where the condition (${cls} ${t}) does not hold`,
  );
  must(
    !holdsOk(f as number),
    () => `the fails value of "${text}" has the sample ${f}, where the condition (${cls} ${t}) holds`,
  );
  must(
    new Set([e.holds, e.fails, e.edge]).size === 3,
    () =>
      `the three values of the boundaries entry of "${text}" should be distinct: ${show([e.holds, e.fails, e.edge])}`,
  );
}

const pickQuantity = (rng: Rng, kind?: Quantity['kind']): Quantity =>
  rng.pick(kind ? QUANTITIES.filter((q) => q.kind === kind) : QUANTITIES);

function thresholdFor(rng: Rng, q: Quantity): number {
  switch (q.kind) {
    case 'money':
      return rng.int(10, 5000);
    case 'percent':
      return rng.int(5, 95);
    case 'time':
      return rng.int(2, 300);
    case 'size':
      return rng.int(2, 500);
    default:
      return rng.int(2, 40);
  }
}

/** Runs one numeric case: the span from (class, wording, quantity, written threshold) and the checks. */
function numericCase(
  ctx: ItemContext,
  cls: Cmp,
  wording: string,
  options: {
    quantity?: Quantity;
    threshold?: number;
    written?: string;
    unit?: string;
    requireInteger?: boolean;
  } = {},
): NumericSpan {
  const q = options.quantity ?? pickQuantity(ctx.rng);
  const t = options.threshold ?? thresholdFor(ctx.rng, q);
  const span = numericSpan(cls, wording, q, t, options.written ?? String(t), options.unit ?? q.unit);
  const store = storeOf(ctx, [span.text]);
  checkThree(store, span.text, t, { requireInteger: options.requireInteger, cls });
  return span;
}

function rangeCase(ctx: ItemContext, text: string, a: number, b: number): void {
  const store = storeOf(ctx, [text]);
  const v = exactlyOne(variablesCiting(store, text), `variables whose values cite "${text}"`);
  const samples = v.values.map((x) => x.sample);
  must(
    samples.every((s) => typeof s === 'number'),
    () => `"${text}" gives samples ${show(samples)}, expected numbers`,
  );
  const s = samples as number[];
  const need: Array<[string, boolean]> = [
    [`one sample below ${a}`, s.some((x) => x < a)],
    [`the lower edge ${a}`, s.includes(a)],
    [`one sample strictly between ${a} and ${b}`, s.some((x) => x > a && x < b)],
    [`the upper edge ${b}`, s.includes(b)],
    [`one sample above ${b}`, s.some((x) => x > b)],
  ];
  const missing = need.filter(([, ok]) => !ok).map(([what]) => what);
  must(missing.length === 0, () => `"${text}" gives samples ${show(s)}, missing ${missing.join(', ')}`);
  must(v.values.length <= 8, () => `"${text}" gives ${v.values.length} values, expected at most 8`);
  must(citing(store, text).length === v.values.length, () => `each value of "${text}" should cite the span`);
}

const COMPARATOR_STEMS = Object.keys(CLASS_OF_STEM);

function comparatorRun(stem: string): StemRun {
  const cls = CLASS_OF_STEM[stem] as Cmp;
  return (variant, ctx) => {
    if (!(variant in WORDINGS[cls])) throw new Error(`no wording ${variant} for ${stem}`);
    numericCase(ctx, cls, variant);
  };
}

export const BOUNDARIES_RUNS: Record<string, StemRun> = {
  ...Object.fromEntries(COMPARATOR_STEMS.map((stem) => [stem, comparatorRun(stem)])),

  'boundaries.range': (variant, ctx) => {
    const { rng } = ctx;
    if (variant === 'negative-range') {
      const a = -rng.int(20, 60);
      const b = a + rng.int(10, 30);
      rangeCase(ctx, `the temperature is between ${a} and ${b} degrees`, a, b);
    } else {
      const a = rng.int(10, 200);
      const b = a + rng.int(20, 400);
      const q = pickQuantity(rng, 'money');
      rangeCase(
        ctx,
        variant === 'from-to'
          ? `${q.noun} is from ${a} to ${b} euros`
          : `${q.noun} is between ${a} and ${b} euros`,
        a,
        b,
      );
    }
  },

  'boundaries.decimal': (variant, ctx) => {
    const cases: Record<string, { written: string; t: number }> = {
      half: { written: '0.5', t: 0.5 },
      'two-places': { written: '12.75', t: 12.75 },
      'whole-as-decimal': { written: '3.0', t: 3 },
      'tenth-float': { written: '0.3', t: 0.3 },
    };
    const c = cases[variant] as { written: string; t: number };
    numericCase(ctx, 'gt', 'over', {
      quantity: pickQuantity(ctx.rng, 'money'),
      threshold: c.t,
      written: c.written,
      requireInteger: false,
    });
  },

  'boundaries.negative': (variant, ctx) => {
    const q: Quantity = { noun: 'the temperature', unit: ' degrees', kind: 'count' };
    if (variant === 'minus-sign')
      numericCase(ctx, 'lt', 'below', { quantity: q, threshold: -5, written: '-5' });
    else numericCase(ctx, 'gt', 'over', { quantity: q, threshold: -0.5, written: '-0.5' });
  },

  'boundaries.zero': (variant, ctx) => {
    const q = pickQuantity(ctx.rng, 'count');
    if (variant === 'more-than-zero') numericCase(ctx, 'gt', 'more-than', { quantity: q, threshold: 0 });
    else numericCase(ctx, 'le', 'no-more-than', { quantity: q, threshold: 0 });
  },

  'boundaries.thousands-separator': (variant, ctx) => {
    const q = pickQuantity(ctx.rng, 'money');
    if (variant === 'comma') {
      const t = ctx.rng.int(1000, 9999);
      numericCase(ctx, 'gt', 'over', { quantity: q, threshold: t, written: groupThousands(t, ',') });
    } else if (variant === 'several-groups') {
      const t = ctx.rng.int(1_000_000, 99_999_999);
      numericCase(ctx, 'ge', 'at-least', { quantity: q, threshold: t, written: groupThousands(t, ',') });
    } else {
      const t = ctx.rng.int(1000, 99_999);
      numericCase(ctx, 'lt', 'under', { quantity: q, threshold: t, written: groupThousands(t, NARROW_NBSP) });
    }
  },

  'boundaries.large-number': (variant, ctx) => {
    const t =
      variant === 'billion' ? 1_000_000_000 : variant === 'above-32-bits' ? 2_147_483_648 : 1_000_000_000_000;
    numericCase(ctx, 'gt', 'more-than', { quantity: pickQuantity(ctx.rng, 'money'), threshold: t });
  },

  'boundaries.units': (variant, ctx) => {
    const { rng } = ctx;
    if (variant === 'euros') {
      numericCase(ctx, 'gt', 'over', {
        quantity: { noun: 'the invoice total', unit: ' euros', kind: 'money' },
        threshold: rng.int(10, 900),
      });
    } else if (variant === 'percent') {
      numericCase(ctx, 'ge', 'at-least', {
        quantity: { noun: 'the discount rate', unit: '%', kind: 'percent' },
        threshold: rng.int(5, 95),
      });
    } else if (variant === 'minutes') {
      numericCase(ctx, 'lt', 'under', {
        quantity: { noun: 'the wait time', unit: ' minutes', kind: 'time' },
        threshold: rng.int(2, 120),
      });
    } else {
      const t = rng.int(10, 900);
      numericCase(ctx, 'gt', 'over', {
        quantity: { noun: 'the refund amount', unit: '', kind: 'money' },
        threshold: t,
        written: rng.chance(0.5) ? `$${t}` : `EUR ${t}`,
      });
    }
  },

  'boundaries.number-words': (variant, ctx) => {
    const t = variant === 'three' ? 3 : variant === 'twenty-five' ? 25 : 100;
    numericCase(ctx, 'ge', 'at-least', {
      quantity: pickQuantity(ctx.rng, 'count'),
      threshold: t,
      written: numberWords(t),
      unit: '',
    });
  },

  'boundaries.merge-thresholds': (variant, ctx) => {
    const { rng } = ctx;
    const q = pickQuantity(rng, 'money');
    const t1 = rng.int(20, 400);
    const pair: Array<{ cls: Cmp; wording: string; t: number }> =
      variant === 'far-apart'
        ? [
            { cls: 'gt', wording: 'over', t: t1 },
            { cls: 'lt', wording: 'under', t: t1 + rng.int(200, 900) },
          ]
        : variant === 'adjacent-overlap'
          ? [
              { cls: 'gt', wording: 'over', t: t1 },
              { cls: 'lt', wording: 'under', t: t1 + 1 },
            ]
          : [
              { cls: 'gt', wording: 'over', t: t1 },
              { cls: 'le', wording: 'at-most', t: t1 },
            ];
    const spans = pair.map((p) => numericSpan(p.cls, p.wording, q, p.t));
    const store = storeOf(
      ctx,
      spans.map((s) => s.text),
    );
    const v = exactlyOne(
      variablesCiting(store, spans[0]?.text as string),
      `variables whose values cite "${spans[0]?.text}"`,
    );
    for (const s of spans) {
      const same = exactlyOne(variablesCiting(store, s.text), `variables whose values cite "${s.text}"`);
      must(
        same === v,
        () => `"${s.text}" and "${spans[0]?.text}" name one quantity but sit in different variables`,
      );
      const cited = citing(store, s.text)
        .map((c) => c.value.sample as number)
        .sort((a, b) => a - b);
      const [a, b, c] = cited;
      must(
        cited.length >= 3 &&
          cited.some((x) => x < s.threshold) &&
          cited.includes(s.threshold) &&
          cited.some((x) => x > s.threshold),
        () =>
          `"${s.text}" is cited by values with samples ${show(cited)}, expected below, at and above ${s.threshold}`,
      );
      void a;
      void b;
      void c;
    }
    const samples = v.values.map((x) => x.sample);
    must(
      new Set(samples).size === samples.length,
      () => `the merged variable holds duplicate samples ${show(samples)}`,
    );
  },

  'boundaries.integer-samples': (variant, ctx) => {
    const { rng } = ctx;
    const q: Quantity =
      variant === 'count-noun'
        ? { noun: 'the retry count', unit: '', kind: 'count' }
        : variant === 'money'
          ? { noun: 'the invoice total', unit: ' euros', kind: 'money' }
          : { noun: 'the discount rate', unit: '%', kind: 'percent' };
    numericCase(ctx, rng.pick(['gt', 'ge', 'lt', 'le'] as const), 'symbol', {
      quantity: q,
      threshold: thresholdFor(rng, q),
      requireInteger: true,
    });
  },

  'boundaries.cites-span': (variant, ctx) => {
    const { rng } = ctx;
    const q = pickQuantity(rng);
    const t = thresholdFor(rng, q);
    const span = numericSpan('gt', 'over', q, t);
    const file = fileOf(rng, [ruleSentence(span.text, rng)], 8);
    const store = build(ctx, {
      estate: estateOf({ 'CLAUDE.md': file }, [
        { id: 'R1', source: 'CLAUDE.md', conditions: [span.text], tools: [] },
      ]),
    });
    const v = checkThree(store, span.text, t);
    for (const value of v.values) {
      const quotes = (value.provenance ?? []).filter((p) => p.kind === 'quote');
      must(
        quotes.length >= 1,
        () => `the value ${value.id} has no quote provenance: ${show(value.provenance)}`,
      );
      for (const p of quotes) {
        if (p.kind !== 'quote') continue;
        must(
          p.path === 'CLAUDE.md',
          () => `the value ${value.id} cites the source path ${show(p.path)}, expected CLAUDE.md`,
        );
        if (variant === 'quote-findable')
          must(
            file.includes(p.quote),
            () => `the quote ${show(p.quote, 80)} of ${value.id} is not in CLAUDE.md`,
          );
      }
    }
  },
};

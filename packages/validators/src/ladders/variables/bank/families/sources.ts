import type {
  ConversationInput,
  OwnerInput,
  Provenance,
  Row,
  StoreDoc,
  StoreValue,
  StoreVariable,
} from '../../interface';
import { OWNER_DATE } from '../constants';
import { build, type ItemContext, type StemRun } from '../item';
import {
  type BooleanSpan,
  booleanSpan,
  type Cmp,
  decoySpan,
  fileOf,
  membershipSpan,
  type NumericSpan,
  numericSpan,
  QUANTITIES,
  type Quantity,
  ruleSentence,
} from '../oracle/conditions';
import {
  canonicalStore,
  citing,
  estateOf,
  locateTool,
  provOfKind,
  type RuleSpec,
  sessionRows,
  toolSpec,
  toolsFile,
  valueById,
  variableOf,
  variablesCiting,
} from '../oracle/estate';
import { drawCategorical } from '../oracle/stats';
import { clone, deepEqual, must, type Rng, show, stableStringify } from '../util';

/** The wordings the sources items use when the wording is not what they test. */
const BASIC: ReadonlyArray<readonly [Cmp, string]> = [
  ['gt', 'over'],
  ['ge', 'at-least'],
  ['lt', 'under'],
  ['le', 'at-most'],
];

export function basicSpan(rng: Rng, quantity: Quantity, threshold: number): NumericSpan {
  const [cls, wording] = rng.pick(BASIC);
  return numericSpan(cls, wording, quantity, threshold);
}

/** `count` distinct quantities, shuffled. */
export function quantities(rng: Rng, count: number): Quantity[] {
  return rng.sample(QUANTITIES, count);
}

/** Thresholds at least 10 apart, ascending, from a random base. */
export function farThresholds(rng: Rng, count: number): number[] {
  const out: number[] = [];
  let t = rng.int(20, 120);
  for (let i = 0; i < count; i += 1) {
    out.push(t);
    t += rng.int(60, 300);
  }
  return out;
}

export function exactlyOne<T>(list: readonly T[], what: string): T {
  must(list.length === 1, () => `${what}: expected exactly 1, found ${list.length}`);
  return list[0] as T;
}

/** The conversations provenance entries of a value. */
export const convOf = (value: StoreValue) => provOfKind(value, 'conversations');

/** A base store: one rule with `shapes.length` tool fields of that many values; the store, the variables and ids. */
export type Base = {
  estate: ReturnType<typeof estateOf>;
  rules: RuleSpec[];
  store: StoreDoc;
  vars: Array<{ variable: StoreVariable; ids: string[] }>;
};

export function baseStore(
  ctx: ItemContext,
  shapes: readonly number[],
  options: { rule?: string } = {},
): Base {
  const { rng } = ctx;
  const taken = { tools: new Set<string>(), ids: new Set<string>() };
  const specs = shapes.map((n) => toolSpec(rng, n, 'TOOLS.md', taken));
  const files = {
    'TOOLS.md': toolsFile(
      rng,
      specs.flatMap((s) => s.lines),
    ),
  };
  const rules: RuleSpec[] = [
    { id: options.rule ?? 'R1', source: 'TOOLS.md', conditions: [], tools: specs.map((s) => s.spec) },
  ];
  const estate = estateOf(files, rules);
  const store = build(ctx, { estate });
  const vars = specs.map((s, i) => {
    const found = locateTool(store, s.spec);
    must(
      !!found,
      () =>
        `the base store built from the tool evidence of field ${i + 1} (${s.spec.tool} ${s.spec.field}) holds no variable that cites its ${s.spec.values.length} quotes`,
    );
    const { variable, ids } = found as NonNullable<typeof found>;
    return { variable, ids: s.spec.values.map((v) => ids.get(v.id) as string) };
  });
  return { estate, rules, store, vars };
}

/** The sessions of draws over a base: each session observes the variables in `observe` (indexes into base.vars). */
export function draw(
  rng: Rng,
  base: Base,
  count: number,
  mixes: readonly (readonly number[])[],
  observe: (session: number, variable: number) => boolean = () => true,
  prefix = 'sess',
): { sessions: ConversationInput[]; counts: number[][]; observed: number[] } {
  const counts = base.vars.map((v) => new Array<number>(v.ids.length).fill(0));
  const observed = base.vars.map(() => 0);
  const draws = base.vars.map((_, i) => drawCategorical(rng, count, mixes[i] as readonly number[]));
  const rows: Row[] = [];
  for (let s = 0; s < count; s += 1) {
    const row: Row = {};
    base.vars.forEach((v, i) => {
      if (!observe(s, i)) return;
      const k = (draws[i] as number[])[s] as number;
      row[v.variable.id] = v.ids[k] as string;
      (counts[i] as number[])[k] = ((counts[i] as number[])[k] as number) + 1;
      observed[i] = (observed[i] as number) + 1;
    });
    rows.push(row);
  }
  return { sessions: sessionRows(rows, prefix), counts, observed };
}

export const evenMix = (n: number): number[] => Array.from({ length: n }, () => 1 / n);

/** Counts the conversations provenance against the planted counts for the variables of a base. */
export function checkCounts(store: StoreDoc, base: Base, counts: number[][], observed: number[]): void {
  base.vars.forEach((bv, i) => {
    const variable = variableOf(store, bv.variable.id);
    must(!!variable, () => `variable ${bv.variable.id} is gone from the store built with the sessions`);
    const v = variable as StoreVariable;
    let total = 0;
    bv.ids.forEach((id, k) => {
      const value = valueById(v, id);
      must(!!value, () => `value ${id} of ${v.id} is gone from the store built with the sessions`);
      const prov = convOf(value as StoreValue);
      const planted = (counts[i] as number[])[k] as number;
      if (prov.length === 0) {
        must(
          planted === 0,
          () =>
            `value ${id} of ${v.id} was seen in ${planted} sessions but carries no conversations provenance`,
        );
        return;
      }
      must(
        prov.length === 1,
        () => `value ${id} of ${v.id} carries ${prov.length} conversations provenance entries, expected 1`,
      );
      const p = prov[0] as Extract<Provenance, { kind: 'conversations' }>;
      must(
        p.count === planted && p.total === observed[i],
        () =>
          `value ${id} of ${v.id}: conversations provenance says count ${p.count} of ${p.total}, the sessions give ${planted} of ${observed[i]}`,
      );
      total += p.count;
    });
    must(
      total === observed[i],
      () => `the seen counts of ${v.id} add up to ${total}, the sessions observing it number ${observed[i]}`,
    );
  });
}

export const SOURCES_RUNS: Record<string, StemRun> = {
  'sources.estate.numeric-condition': (variant, ctx) => {
    const { rng } = ctx;
    const span = basicSpan(rng, rng.pick(QUANTITIES), rng.int(5, 900));
    const file = fileOf(rng, [ruleSentence(span.text, rng)], variant === 'long-file' ? 100 : 6);
    const store = build(ctx, {
      estate: estateOf({ 'CLAUDE.md': file }, [
        { id: 'R1', source: 'CLAUDE.md', conditions: [span.text], tools: [] },
      ]),
    });
    must(
      store.refused.length === 0,
      () =>
        `the condition "${span.text}" is a plain, findable span but the store refuses ${show(store.refused)}`,
    );
    const v = exactlyOne(variablesCiting(store, span.text), `variables whose values cite "${span.text}"`);
    must(
      v.values.length === 3,
      () =>
        `the numeric condition "${span.text}" gives ${v.values.length} values, expected 3 (two sides and the boundary)`,
    );
  },

  'sources.estate.boolean-condition': (variant, ctx) => {
    const { rng } = ctx;
    const form = variant === 'positive' ? 'positive' : variant === 'negated' ? 'negated' : 'lacks';
    const span: BooleanSpan = booleanSpan(rng, form);
    const file = fileOf(rng, [ruleSentence(span.text, rng)], 6);
    const store = build(ctx, {
      estate: estateOf({ 'CLAUDE.md': file }, [
        { id: 'R1', source: 'CLAUDE.md', conditions: [span.text], tools: [] },
      ]),
    });
    const v = exactlyOne(variablesCiting(store, span.text), `variables whose values cite "${span.text}"`);
    must(
      v.values.length === 2,
      () => `the boolean condition "${span.text}" gives ${v.values.length} values, expected 2`,
    );
    const samples = v.values.map((x) => x.sample);
    must(
      samples.includes(true) && samples.includes(false) && samples.every((s) => typeof s === 'boolean'),
      () =>
        `the boolean condition "${span.text}" gives samples ${show(samples)}, expected the booleans true and false`,
    );
    must(
      citing(store, span.text).length === 2,
      () => `each of the two values of "${span.text}" should cite the span`,
    );
  },

  'sources.estate.membership-condition': (variant, ctx) => {
    const { rng } = ctx;
    const count = variant === 'two-members' ? 2 : 3;
    const span = membershipSpan(rng, count);
    const file = fileOf(rng, [ruleSentence(span.text, rng)], 6);
    const store = build(ctx, {
      estate: estateOf({ 'CLAUDE.md': file }, [
        { id: 'R1', source: 'CLAUDE.md', conditions: [span.text], tools: [] },
      ]),
    });
    const v = exactlyOne(variablesCiting(store, span.text), `variables whose values cite "${span.text}"`);
    const samples = v.values.map((x) => x.sample);
    must(
      samples.every((s) => typeof s === 'string'),
      () => `the membership condition "${span.text}" gives samples ${show(samples)}, expected strings`,
    );
    must(
      samples.some((s) => span.members.includes(s as string)),
      () =>
        `no value of "${span.text}" has a sample in the list ${show(span.members)}: samples ${show(samples)}`,
    );
    must(
      samples.some((s) => !span.members.includes(s as string)),
      () =>
        `no value of "${span.text}" has a sample outside the list ${show(span.members)}: samples ${show(samples)}`,
    );
    must(
      v.values.length >= 2 && v.values.length <= span.members.length + 1,
      () =>
        `"${span.text}" gives ${v.values.length} values, expected between 2 and ${span.members.length + 1}`,
    );
    must(
      citing(store, span.text).length === v.values.length,
      () => `every value of "${span.text}" should cite the span`,
    );
  },

  'sources.estate.no-condition-no-variable': (variant, ctx) => {
    const { rng } = ctx;
    const kind = variant as 'plain-rule' | 'number-without-comparator' | 'past-tense-limit';
    const decoys = [decoySpan(rng, kind)];
    const real = basicSpan(rng, rng.pick(QUANTITIES), rng.int(5, 900));
    const sentences = [...decoys, ruleSentence(real.text, rng)];
    const file = `# Standing instructions\n\n${rng.shuffle(sentences).join('\n')}\n`;
    const store = build(ctx, {
      estate: estateOf({ 'CLAUDE.md': file }, [
        { id: 'R1', source: 'CLAUDE.md', conditions: [...decoys, real.text], tools: [] },
      ]),
    });
    for (const d of decoys) {
      const hit = variablesCiting(store, d);
      must(hit.length === 0, () => `the span "${d}" states no condition but variable ${hit[0]?.id} cites it`);
    }
    exactlyOne(
      variablesCiting(store, real.text),
      `variables whose values cite the real condition "${real.text}"`,
    );
  },

  'sources.estate.same-quantity-merges': (variant, ctx) => {
    const { rng } = ctx;
    const count = variant === 'three-spans' ? 3 : 2;
    const quantity = rng.pick(QUANTITIES);
    const ts = farThresholds(rng, count);
    const spans = ts.map((t, i) => {
      const s = basicSpan(rng, quantity, t);
      if (variant === 'case-differs' && i === 1) {
        const loud = quantity.noun.replace(/^the (\w)/, (_m, c: string) => `The ${c.toUpperCase()}`);
        return { ...s, text: s.text.replace(quantity.noun, loud) };
      }
      return s;
    });
    const byPath: Record<string, string[]> = {};
    const rules: RuleSpec[] = [];
    spans.forEach((s, i) => {
      const path = variant === 'two-files' && i === 1 ? 'docs/policy.md' : 'CLAUDE.md';
      const list = byPath[path] ?? [];
      list.push(ruleSentence(s.text, rng));
      byPath[path] = list;
      rules.push({ id: `R${i + 1}`, source: path, conditions: [s.text], tools: [] });
    });
    const files: Record<string, string> = {};
    for (const [path, sentences] of Object.entries(byPath)) files[path] = fileOf(rng, sentences, 5);
    const store = build(ctx, { estate: estateOf(files, rules) });
    const v = exactlyOne(
      variablesCiting(store, spans[0]?.text as string),
      `variables whose values cite "${spans[0]?.text}"`,
    );
    for (const s of spans) {
      const hit = exactlyOne(variablesCiting(store, s.text), `variables whose values cite "${s.text}"`);
      must(
        hit === v,
        () =>
          `"${s.text}" and "${spans[0]?.text}" name the same quantity "${quantity.noun}" but sit in different variables (${hit.id}, ${v.id})`,
      );
      const cited = citing(store, s.text).length;
      must(cited === 3, () => `"${s.text}" is cited by ${cited} values, expected 3`);
    }
    must(
      v.values.length === 3 * count,
      () => `the merged variable ${v.id} holds ${v.values.length} values, expected ${3 * count}`,
    );
    const samples = v.values.map((x) => x.sample);
    must(
      new Set(samples).size === samples.length,
      () => `the merged variable holds duplicate samples ${show(samples)}`,
    );
  },

  'sources.estate.different-quantities-split': (variant, ctx) => {
    const { rng } = ctx;
    const pair: [string, string] =
      variant === 'shared-word'
        ? ['the invoice total', 'the invoice age']
        : variant === 'prefix-noun'
          ? ['the total', 'the total tax']
          : ['the invoice total', 'the retry count'];
    const quantitiesOf = pair.map((noun): Quantity => ({ noun, unit: '', kind: 'count' }));
    const spans = quantitiesOf.map((q) => basicSpan(rng, q, rng.int(5, 900)));
    const file = fileOf(
      rng,
      spans.map((s) => ruleSentence(s.text, rng)),
      5,
    );
    const store = build(ctx, {
      estate: estateOf(
        { 'CLAUDE.md': file },
        spans.map((s, i) => ({ id: `R${i + 1}`, source: 'CLAUDE.md', conditions: [s.text], tools: [] })),
      ),
    });
    const vars = spans.map((s) =>
      exactlyOne(variablesCiting(store, s.text), `variables whose values cite "${s.text}"`),
    );
    must(
      vars[0] !== vars[1],
      () =>
        `"${spans[0]?.text}" and "${spans[1]?.text}" name different quantities but share variable ${vars[0]?.id}`,
    );
    for (const v of vars)
      must(v.values.length === 3, () => `variable ${v.id} holds ${v.values.length} values, expected 3`);
    must(
      store.variables.length === 2,
      () => `the store holds ${store.variables.length} variables, expected 2`,
    );
  },

  'sources.estate.rule-own-variables': (variant, ctx) => {
    const { rng } = ctx;
    const taken = { tools: new Set<string>(), ids: new Set<string>() };
    const conditionsOf = (n: number) => quantities(rng, n).map((q) => basicSpan(rng, q, rng.int(5, 900)));
    let rules: RuleSpec[];
    const toolLines: string[] = [];
    const mkTool = () => {
      const t = toolSpec(rng, 3, 'TOOLS.md', taken);
      toolLines.push(...t.lines);
      return t.spec;
    };
    const claude: string[] = [];
    if (variant === 'shared-quantity-two-rules') {
      const q = rng.pick(QUANTITIES);
      const [t1, t2] = farThresholds(rng, 2) as [number, number];
      const a = basicSpan(rng, q, t1);
      const b = basicSpan(rng, q, t2);
      claude.push(ruleSentence(a.text, rng), ruleSentence(b.text, rng));
      rules = [
        { id: 'R1', source: 'CLAUDE.md', conditions: [a.text], tools: [] },
        { id: 'R2', source: 'CLAUDE.md', conditions: [b.text], tools: [] },
      ];
    } else {
      const nCond = variant === 'tool-only' ? 0 : variant === 'two-and-two' ? 2 : 1;
      const nTool = variant === 'condition-only' ? 0 : variant === 'two-and-two' ? 2 : 1;
      const conds = conditionsOf(nCond);
      for (const c of conds) claude.push(ruleSentence(c.text, rng));
      rules = [
        {
          id: 'R1',
          source: 'CLAUDE.md',
          conditions: conds.map((c) => c.text),
          tools: Array.from({ length: nTool }, mkTool),
        },
      ];
    }
    const files: Record<string, string> = { 'CLAUDE.md': fileOf(rng, claude, 5) };
    if (toolLines.length > 0) files['TOOLS.md'] = toolsFile(rng, toolLines);
    const store = build(ctx, { estate: estateOf(files, rules) });
    must(
      store.rules.length === rules.length,
      () =>
        `the store lists ${store.rules.length} rules, expected ${rules.length}: ${show(store.rules.map((r) => r.id))}`,
    );
    for (const r of rules) {
      const want = new Set<string>();
      for (const c of r.conditions) {
        for (const v of variablesCiting(store, c)) want.add(v.id);
      }
      for (const t of r.tools) {
        const found = locateTool(store, t);
        must(
          !!found,
          () => `no variable cites the ${t.values.length} quotes of the tool evidence ${t.tool} ${t.field}`,
        );
        want.add((found as NonNullable<typeof found>).variable.id);
      }
      const got = store.rules.find((x) => x.id === r.id);
      must(!!got, () => `the store lists no rule ${r.id}: ${show(store.rules)}`);
      const have = new Set((got as NonNullable<typeof got>).variables);
      must(
        have.size === want.size && [...want].every((x) => have.has(x)),
        () =>
          `rule ${r.id} lists the variables ${show([...have])}, expected ${show([...want])} (those its condition spans and tool evidence name)`,
      );
    }
  },

  'sources.estate.tool-field-variable': (variant, ctx) => {
    const { rng } = ctx;
    const n = variant === 'single-value' ? 1 : 3;
    const t = toolSpec(rng, n);
    const store = build(ctx, {
      estate: estateOf({ 'TOOLS.md': toolsFile(rng, t.lines) }, [
        { id: 'R1', source: 'TOOLS.md', conditions: [], tools: [t.spec] },
      ]),
    });
    const found = locateTool(store, t.spec);
    must(
      !!found,
      () =>
        `no single variable holds the ${n} values cited by the quotes of ${t.spec.tool} ${t.spec.field}: ${show(store.variables.map((v) => v.id))}`,
    );
    const { variable } = found as NonNullable<typeof found>;
    must(
      variable.values.length === n,
      () => `variable ${variable.id} holds ${variable.values.length} values, expected ${n}`,
    );
    for (const v of t.spec.values) {
      const value = variable.values.find((x) =>
        (x.provenance ?? []).some((p) => p.kind === 'quote' && p.quote === v.quote),
      );
      const prov = (value?.provenance ?? []).find((p) => p.kind === 'quote' && p.quote === v.quote) as
        | Extract<Provenance, { kind: 'quote' }>
        | undefined;
      must(
        prov?.path === 'TOOLS.md',
        () => `the quote of value ${v.id} should cite the source path TOOLS.md, it cites ${show(prov?.path)}`,
      );
    }
  },

  'sources.conversations.counts': (variant, ctx) => {
    const { rng } = ctx;
    const shapes = variant === 'three-variables' ? [3, 2, 4] : variant === 'unseen-estate-value' ? [4] : [2];
    const base = baseStore(ctx, shapes);
    const mixes = base.vars.map((v, i) => {
      const m = rng.shuffle(Array.from({ length: v.ids.length }, (_, k) => 1 + k * 2 + rng.int(0, 2)));
      if (variant === 'unseen-estate-value' && i === 0) m[v.ids.length - 1] = 0;
      const total = m.reduce((a, b) => a + b, 0);
      return m.map((x) => x / total);
    });
    const { sessions, counts, observed } = draw(rng, base, rng.int(20, 60), mixes);
    const store = build(ctx, { estate: base.estate, conversations: sessions });
    checkCounts(store, base, counts, observed);
    if (variant === 'unseen-estate-value') {
      const bv = base.vars[0] as Base['vars'][number];
      const value = valueById(
        variableOf(store, bv.variable.id) as StoreVariable,
        bv.ids[bv.ids.length - 1] as string,
      );
      must(!!value, 'the value no session shows is gone from the store');
    }
  },

  'sources.conversations.partial-sessions': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [3, 3]);
    const mixes = base.vars.map((v) => evenMix(v.ids.length));
    const n = rng.int(30, 60);
    const never = variant === 'never-observed';
    const { sessions, counts, observed } = draw(rng, base, n, mixes, (s, i) =>
      i === 0 ? true : never ? false : s % 2 === 0,
    );
    const store = build(ctx, { estate: base.estate, conversations: sessions });
    const unobserved = base.vars[1] as Base['vars'][number];
    if (never) {
      const b = variableOf(store, unobserved.variable.id) as StoreVariable;
      for (const id of unobserved.ids) {
        const prov = convOf(valueById(b, id) as StoreValue).filter((p) => p.total > 0);
        must(
          prov.length === 0,
          () => `value ${id} of ${b.id} was observed in no session but carries ${show(prov)}`,
        );
      }
      const first = { ...base, vars: [base.vars[0] as Base['vars'][number]] };
      checkCounts(store, first, [counts[0] as number[]], [observed[0] as number]);
    } else {
      checkCounts(store, base, counts, observed);
      must(observed[1] !== n, 'the generator should leave some sessions without the second variable');
    }
  },

  'sources.conversations.new-value': (_variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [2]);
    const bv = base.vars[0] as Base['vars'][number];
    const n = rng.int(20, 50);
    const novel = 'novelvalue';
    const rows: Row[] = [];
    let seenNovel = 0;
    for (let s = 0; s < n; s += 1) {
      const isNovel = rng.chance(0.3);
      if (isNovel) seenNovel += 1;
      rows.push({ [bv.variable.id]: isNovel ? novel : (bv.ids[rng.int(0, bv.ids.length - 1)] as string) });
    }
    must(seenNovel > 0, 'the generator should show the new value at least once');
    const store = build(ctx, { estate: base.estate, conversations: sessionRows(rows) });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    must(!!variable, () => `variable ${bv.variable.id} is gone`);
    const added = valueById(variable, novel);
    must(
      !!added,
      () =>
        `the value ${novel} was seen in ${seenNovel} of ${n} sessions but ${variable.id} holds only ${show(variable.values.map((v) => v.id))}`,
    );
    const prov = convOf(added as StoreValue);
    must(
      prov.length === 1 && prov[0]?.count === seenNovel && prov[0]?.total === n,
      () => `the new value ${novel} should carry seen ${seenNovel} of ${n}, it carries ${show(prov)}`,
    );
    for (const id of bv.ids) must(!!valueById(variable, id), () => `the old value ${id} is gone`);
    must(
      (added as StoreValue).approved === false,
      () =>
        `the new value ${novel} came from conversations, so it is a proposal (approved false); it carries approved ${show((added as StoreValue).approved)}`,
    );
    for (const id of bv.ids) {
      must(valueById(variable, id)?.approved !== false, () => `the old value ${id} should keep its approval`);
    }
  },

  'sources.conversations.set-hash': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [3, 2]);
    const { sessions } = draw(
      rng,
      base,
      30,
      base.vars.map((v) => evenMix(v.ids.length)),
    );
    const hashes = (store: StoreDoc): string[] =>
      store.variables.flatMap((v) => v.values.flatMap((x) => convOf(x).map((p) => p.set_hash)));
    const first = hashes(build(ctx, { estate: base.estate, conversations: sessions }));
    must(first.length > 0, 'no conversations entry carries a set_hash');
    must(
      first.every((h) => /^[0-9a-f]{64}$/.test(h)),
      () => `a set_hash is not 64 lowercase hexadecimal characters: ${show(first[0])}`,
    );
    must(new Set(first).size === 1, () => `one set of sessions gave ${new Set(first).size} different hashes`);
    if (variant === 'stable') {
      const again = hashes(
        build(ctx, {
          estate: base.estate,
          conversations: sessions.map((s) => ({ ...s, values: { ...s.values } })),
        }),
      );
      must(again[0] === first[0], 'two builds of the same sessions give different hashes');
    } else if (variant === 'changes-with-a-session') {
      const changed = sessions.map((s) => ({ ...s, values: { ...s.values } }));
      const bv = base.vars[0] as Base['vars'][number];
      const row = changed[0] as ConversationInput;
      const was = row.values[bv.variable.id];
      row.values[bv.variable.id] = bv.ids.find((id) => id !== was) as string;
      const other = hashes(build(ctx, { estate: base.estate, conversations: changed }));
      must(other[0] !== first[0], 'changing one session did not change the set_hash');
    } else if (variant === 'order-free') {
      const shuffled = hashes(build(ctx, { estate: base.estate, conversations: rng.shuffle(sessions) }));
      must(
        shuffled[0] === first[0],
        'the same sessions in another order give another set_hash: it hashes a set',
      );
    }
    const dump = JSON.stringify(first);
    for (const s of sessions.slice(0, 5)) must(!dump.includes(s.id), 'a set_hash holds a session id');
  },

  'sources.conversations.privacy': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const n = variant === 'thousand-sessions' ? 1000 : 30;
    const tag = rng.int(100000, 999999).toString(36);
    const canaries: string[] = [];
    const sessions: ConversationInput[] = Array.from({ length: n }, (_, i) => {
      const id = variant === 'text-canary' ? `c${i}` : `zq9id-${tag}-${i}`;
      const text =
        variant === 'id-canary' ? undefined : `Please escalate ticket zq9canary-${tag}-${i} to the owner`;
      if (variant !== 'text-canary') canaries.push(id);
      if (text) canaries.push(`zq9canary-${tag}-${i}`);
      return {
        id,
        ...(text ? { text } : {}),
        values: { [bv.variable.id]: bv.ids[i % bv.ids.length] as string },
      };
    });
    const store = build(ctx, { estate: base.estate, conversations: sessions });
    const dump = JSON.stringify(store);
    const leak = canaries.find((c) => dump.includes(c));
    must(leak === undefined, () => `the store holds "${leak}" from a conversation: only counts may reach it`);
    const hasPrefix = dump.includes('zq9canary') || dump.includes('zq9id');
    must(!hasPrefix, 'the store holds a fragment of a conversation text or id');
  },

  'sources.owner.missing-value': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const k = variant === 'three' ? 3 : 1;
    const adds = Array.from({ length: k }, (_, i) => ({
      variable: bv.variable.id,
      value: `ownerval${i + 1}`,
      date: OWNER_DATE,
      words: `The owner says there is also a case called ownerval${i + 1} (${rng.int(1000, 9999)}).`,
    }));
    const store = build(ctx, { estate: base.estate, owner: { values: adds } });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    must(!!variable, () => `variable ${bv.variable.id} is gone`);
    for (const a of adds) {
      const value = valueById(variable, a.value);
      must(
        !!value,
        () =>
          `the owner value ${a.value} is not on ${variable.id}: ${show(variable.values.map((v) => v.id))}`,
      );
      const prov = provOfKind(value as StoreValue, 'owner');
      must(
        prov.length === 1 && prov[0]?.words === a.words && prov[0]?.date === OWNER_DATE,
        () =>
          `the owner value ${a.value} should carry the owner's words, it carries ${show(value?.provenance)}`,
      );
    }
    must(
      variable.values.length === bv.ids.length + k,
      () => `${variable.id} holds ${variable.values.length} values, expected ${bv.ids.length + k}`,
    );
  },

  'sources.owner.impossible-pair': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [3, 3]);
    const [A, B] = base.vars as [Base['vars'][number], Base['vars'][number]];
    const words = `The owner says ${rng.int(10, 99)} never goes with this.`;
    const a = { variable: A.variable.id, value: A.ids[1] as string };
    const b = { variable: B.variable.id, value: B.ids[2] as string };
    const [first, second] = variant === 'reversed-endpoints' ? [b, a] : [a, b];
    const store = build(ctx, {
      estate: base.estate,
      owner: { impossible: [{ a: first, b: second, words, date: OWNER_DATE }] },
    });
    must(
      store.impossible.length === 1,
      () =>
        `the store holds ${store.impossible.length} impossible pairs, expected 1: ${show(store.impossible)}`,
    );
    const p = store.impossible[0] as StoreDoc['impossible'][number];
    const same = (x: typeof a, y: { variable: string; value: string }) =>
      x.variable === y.variable && x.value === y.value;
    must(
      (same(a, p.a) && same(b, p.b)) || (same(a, p.b) && same(b, p.a)),
      () => `the stored pair ${show([p.a, p.b])} is not the owner's pair ${show([a, b])}`,
    );
    const owner = (p.provenance ?? []).filter((x) => x.kind === 'owner');
    must(
      owner.length === 1 &&
        (owner[0] as { words: string; date: string }).words === words &&
        (owner[0] as { date: string }).date === OWNER_DATE,
      () => `the pair should carry the owner's words, it carries ${show(p.provenance)}`,
    );
  },

  'sources.owner.weight': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const weights =
      variant === 'full-distribution'
        ? [0.5, 0.3, 0.2]
        : variant === 'zero-weight'
          ? [0.0, 0.6, 0.4]
          : [60, 15, 25];
    const entries = weights.map((w, i) => ({
      variable: bv.variable.id,
      value: bv.ids[i] as string,
      weight: w,
      date: OWNER_DATE,
      words: `The owner puts ${Math.round(w * 100)} percent on this (${rng.int(100, 999)}).`,
    }));
    const store = build(ctx, { estate: base.estate, owner: { weights: entries } });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    for (const e of entries) {
      const value = valueById(variable, e.value);
      must(!!value, () => `value ${e.value} is gone`);
      must(
        value?.weight === e.weight,
        () => `value ${e.value} has weight ${show(value?.weight)}, the owner declared ${e.weight}`,
      );
      const prov = provOfKind(value as StoreValue, 'owner').filter(
        (p) => p.words === e.words && p.date === OWNER_DATE,
      );
      must(
        prov.length === 1,
        () =>
          `value ${e.value} should carry the owner's words for its weight, it carries ${show(value?.provenance)}`,
      );
    }
  },

  'sources.owner.words-verbatim': (variant, ctx) => {
    const base = baseStore(ctx, [2]);
    const bv = base.vars[0] as Base['vars'][number];
    const words =
      variant === 'accents'
        ? 'Café société: déjà vu, naïve façade, ñandú, über, São Paulo, Ångström.'
        : variant === 'multiline'
          ? 'First line\nsecond line\r\nthird line with a tab\there\n\n  and leading spaces'
          : variant === 'one-thousand-chars'
            ? Array.from({ length: 1000 }, (_, i) => 'abcdefghij klmnopqrstuvwxyz'[i % 26]).join('')
            : 'Great \u{1F44D}\u{1F3FD} and שלום עולם and مرحبا بالعالم end';
    const store = build(ctx, {
      estate: base.estate,
      owner: { values: [{ variable: bv.variable.id, value: 'wordsval', words, date: OWNER_DATE }] },
    });
    const value = valueById(variableOf(store, bv.variable.id) as StoreVariable, 'wordsval');
    must(!!value, 'the owner value is not in the store');
    const got = provOfKind(value as StoreValue, 'owner')[0]?.words;
    must(got === words, () => `the owner's words changed: given ${show(words, 80)}, stored ${show(got, 80)}`);
  },

  'sources.owner.date-and-statement': (variant, ctx) => {
    const base = baseStore(ctx, [2]);
    const bv = base.vars[0] as Base['vars'][number];
    const day =
      variant === 'day-kept'
        ? '2025-12-31'
        : variant === 'unreal-day-refused'
          ? '2026-02-30'
          : variant === 'badly-written-day-refused'
            ? '31/12/2025'
            : '2025-12-31';
    const words = variant === 'blank-words-refused' ? '   ' : 'The owner adds a late case.';
    const store = build(ctx, {
      estate: base.estate,
      owner: { values: [{ variable: bv.variable.id, value: 'latecase', words, date: day }] },
    });
    const variable = variableOf(store, bv.variable.id) as StoreVariable;
    const added = valueById(variable, 'latecase');
    if (variant === 'day-kept') {
      must(!!added, () => `the owner value latecase is not on ${variable.id}: ${show(store.refused)}`);
      const prov = provOfKind(added as StoreValue, 'owner');
      must(
        prov.length === 1 && prov[0]?.date === day,
        () => `the day ${day} should be stored as given, it is stored as ${show(prov)}`,
      );
    } else {
      must(
        !added,
        () =>
          `the owner entry with the day ${show(day)} and words ${show(words)} should be refused, but the value was added: ${show(added)}`,
      );
      must(
        store.refused.length >= 1 &&
          store.refused.every((r) => typeof r.reason === 'string' && r.reason.trim() !== ''),
        () => `the refusal list ${show(store.refused)} should name the entry with a reason`,
      );
      must(
        variable.values.length === bv.ids.length,
        () => `the refused entry changed ${variable.id}: ${show(variable.values.map((x) => x.id))}`,
      );
    }
  },

  'sources.merge.provenance-union': (variant, ctx) => {
    const { rng } = ctx;
    const base = baseStore(ctx, [3]);
    const bv = base.vars[0] as Base['vars'][number];
    const id = bv.ids[0] as string;
    const words = `The owner confirms ${rng.int(10, 99)} percent.`;
    const owner: OwnerInput = {
      weights: bv.ids.map((v, k) => ({
        variable: bv.variable.id,
        value: v,
        weight: [0.4, 0.3, 0.3][k] as number,
        words,
        date: OWNER_DATE,
      })),
    };
    const sessions = draw(rng, base, 20, [evenMix(3)]).sessions;
    const sources = {
      estate: base.estate,
      ...(variant !== 'estate-conversations' ? { owner } : {}),
      ...(variant !== 'estate-owner' ? { conversations: sessions } : {}),
    };
    const store = build(ctx, sources);
    const value = valueById(variableOf(store, bv.variable.id) as StoreVariable, id) as StoreValue;
    must(!!value, 'the value is gone');
    const kinds = new Set((value.provenance ?? []).map((p) => p.kind));
    const want = [
      'quote',
      ...(variant !== 'estate-conversations' ? ['owner'] : []),
      ...(variant !== 'estate-owner' ? ['conversations'] : []),
    ];
    for (const k of want)
      must(
        kinds.has(k as Provenance['kind']),
        () => `the value ${id} lost its ${k} provenance: it carries ${show(value.provenance)}`,
      );
  },

  'sources.order-independent': (variant, ctx) => {
    const { rng } = ctx;
    if (variant === 'rules-permuted') {
      const qs = quantities(rng, 3);
      const spans = qs.map((q) => basicSpan(rng, q, rng.int(5, 900)));
      const file = fileOf(
        rng,
        spans.map((s) => ruleSentence(s.text, rng)),
        5,
      );
      const rules: RuleSpec[] = spans.map((s, i) => ({
        id: `R${i + 1}`,
        source: 'CLAUDE.md',
        conditions: [s.text],
        tools: [],
      }));
      const a = build(ctx, { estate: estateOf({ 'CLAUDE.md': file }, rules) });
      const b = build(ctx, { estate: estateOf({ 'CLAUDE.md': file }, [...rules].reverse()) });
      for (const span of spans) {
        const variable = exactlyOne(variablesCiting(a, span.text), `variables citing ${span.text}`);
        must(variable.values.length === 3, `the condition ${span.text} must produce three values`);
      }
      same(a, b, 'the rules in reverse order');
    } else if (variant === 'sessions-permuted') {
      const base = baseStore(ctx, [3, 2]);
      const { sessions } = draw(
        rng,
        base,
        40,
        base.vars.map((v) => evenMix(v.ids.length)),
      );
      const a = build(ctx, { estate: base.estate, conversations: sessions });
      const b = build(ctx, { estate: base.estate, conversations: rng.shuffle(sessions) });
      same(a, b, 'the sessions shuffled');
    } else {
      const base = baseStore(ctx, [3, 3]);
      const [A, B] = base.vars as [Base['vars'][number], Base['vars'][number]];
      const owner: OwnerInput = {
        values: [
          { variable: B.variable.id, value: 'ownera', date: OWNER_DATE, words: 'a' },
          { variable: B.variable.id, value: 'ownerb', date: OWNER_DATE, words: 'b' },
          { variable: B.variable.id, value: 'ownerc', date: OWNER_DATE, words: 'c' },
        ],
        impossible: [
          {
            a: { variable: A.variable.id, value: A.ids[0] as string },
            b: { variable: B.variable.id, value: B.ids[1] as string },
            date: OWNER_DATE,
            words: 'p1',
          },
          {
            a: { variable: A.variable.id, value: A.ids[1] as string },
            b: { variable: B.variable.id, value: B.ids[2] as string },
            date: OWNER_DATE,
            words: 'p2',
          },
        ],
        weights: [
          { variable: A.variable.id, value: A.ids[0] as string, weight: 0.5, date: OWNER_DATE, words: 'w1' },
          { variable: A.variable.id, value: A.ids[1] as string, weight: 0.3, date: OWNER_DATE, words: 'w2' },
          { variable: A.variable.id, value: A.ids[2] as string, weight: 0.2, date: OWNER_DATE, words: 'w3' },
        ],
      };
      const shuffled: OwnerInput = {
        values: rng.shuffle(owner.values ?? []),
        impossible: rng.shuffle(owner.impossible ?? []),
        weights: rng.shuffle(owner.weights ?? []),
      };
      same(
        build(ctx, { estate: base.estate, owner }),
        build(ctx, { estate: base.estate, owner: shuffled }),
        'the owner entries shuffled',
      );
    }
  },

  'sources.empty-sources': (variant, ctx) => {
    // Empty inputs are legitimate, but must not credit a reader that always returns an empty store.
    baseStore(ctx, [2]);
    const calls: Array<{ what: string; sources: Parameters<typeof build>[1] }> =
      variant === 'nothing'
        ? [
            { what: '{}', sources: {} },
            { what: '{ owner: {} }', sources: { owner: {} } },
          ]
        : variant === 'empty-estate'
          ? [{ what: 'an estate with no file and no rule', sources: { estate: { files: {}, rules: [] } } }]
          : [{ what: 'an empty session list', sources: { conversations: [] } }];
    for (const { what, sources } of calls) {
      const store = build(ctx, sources);
      const sizes = [
        store.variables.length,
        store.impossible.length,
        store.rules.length,
        store.refused.length,
      ];
      must(
        sizes.every((s) => s === 0),
        () => `buildStore(${what}) should return an empty store, it returns ${show(store)}`,
      );
    }
  },
};

function same(a: StoreDoc, b: StoreDoc, what: string): void {
  const ca = stableStringify(canonicalStore(a));
  const cb = stableStringify(canonicalStore(b));
  must(
    ca === cb,
    () =>
      `the store depends on the order of its sources (${what}): first ${show(JSON.parse(ca), 160)} then ${show(JSON.parse(cb), 160)}`,
  );
}

void clone;
void deepEqual;

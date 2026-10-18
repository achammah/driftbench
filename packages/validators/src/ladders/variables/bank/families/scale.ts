import type { ConversationInput, Plan } from '../../interface';
import { build, callCoverage, type ItemContext, planOf, type StemRun } from '../item';
import { nounNumber, numericSpan, type Quantity, ruleSentence } from '../oracle/conditions';
import { estateOf, type RuleSpec, variablesCiting } from '../oracle/estate';
import { greedyBound, shapeProblems } from '../oracle/planCheck';
import { rowsWithForbidden, scanCoverage } from '../oracle/scan';
import {
  counterGroups,
  forbid,
  forbidSet,
  indexRow,
  isForbidden,
  makeSpace,
  type Space,
  type SpaceGroup,
  toStore,
} from '../oracle/space';
import { choose, cpuMs, must, type Rng, show } from '../util';
import { toBig } from './counter';
import { type Base, baseStore, checkCounts, draw } from './sources';

const BOUND = 1.25;

type Run = { plan: Plan; ms: number };

function planTimed(ctx: ItemContext, space: Space, seed = ctx.seed): Run {
  const store = toStore(space);
  const { value: plan, ms } = cpuMs(() => planOf(ctx, store, { seed }));
  return { plan, ms };
}

/** Checks the shape, the impossible pairs, the scan coverage, the bound and the processor time of a scale plan. */
function verify(
  space: Space,
  run: Run,
  groups: readonly SpaceGroup[],
  limits: { budgetMs: number; maxRows?: number; factor?: number },
  label: string,
): void {
  const problems = shapeProblems(space, run.plan, []);
  must(problems.length === 0, () => `${label}: ${problems.join('; ')}`);
  const rows = run.plan.rows.map((r) => indexRow(space, r.values) as number[]);
  const bad = rowsWithForbidden(space, rows);
  must(
    bad.count === 0,
    () => `${label}: ${bad.count} rows hold an impossible pair, for example ${bad.first}`,
  );
  const scan = scanCoverage(space, groups, rows);
  must(
    scan.missing === 0,
    () =>
      `${label}: ${scan.missing} of ${scan.required} required tuples are not covered, for example ${scan.sample.join(' | ')}`,
  );
  let maxChance = 1;
  for (const g of groups) {
    const t = Math.min(g.strength, g.vars.length);
    const arities = g.vars.map((i) => space.vars[i]?.values.length ?? 1).sort((a, b) => b - a);
    maxChance = Math.max(
      maxChance,
      arities.slice(0, t).reduce((a, b) => a * b, 1),
    );
  }
  const bound = Math.ceil((limits.factor ?? BOUND) * greedyBound(scan.required, 1 / maxChance)) + 1;
  const cap = Math.min(bound, limits.maxRows ?? bound);
  must(
    rows.length <= cap,
    () =>
      `${label}: ${rows.length} rows for ${scan.required} required tuples; a covering array needs at most ${cap}`,
  );
  must(
    run.ms <= limits.budgetMs,
    () => `${label}: planning took ${Math.round(run.ms)} ms of processor time, over ${limits.budgetMs} ms`,
  );
}

const axesGroup = (space: Space): SpaceGroup => ({
  id: 'axes',
  kind: 'shared',
  vars: space.vars.map((_, i) => i),
  strength: 2,
});

function pairwiseCase(arity: number, n: number): Space {
  return makeSpace(Array(n).fill(arity), { shared: Array.from({ length: n }, (_, i) => i) });
}

const PAIRWISE: Record<string, { arity: number; n: number; budgetMs: number }> = {
  n20: { arity: 2, n: 20, budgetMs: 5000 },
  n50: { arity: 2, n: 50, budgetMs: 5000 },
  n100: { arity: 2, n: 100, budgetMs: 10_000 },
  n200: { arity: 2, n: 200, budgetMs: 15_000 },
  n400: { arity: 2, n: 400, budgetMs: 40_000 },
  'ternary-30': { arity: 3, n: 30, budgetMs: 10_000 },
  'ternary-60': { arity: 3, n: 60, budgetMs: 30_000 },
  'arity-eight-10': { arity: 8, n: 10, budgetMs: 10_000 },
  'arity-eight-20': { arity: 8, n: 20, budgetMs: 40_000 },
};

function randomRules(rng: Rng, pool: number, count: number, size: number): number[][] {
  return Array.from({ length: count }, () =>
    rng.sample(
      Array.from({ length: pool }, (_, i) => i),
      size,
    ),
  );
}

export const SCALE_RUNS: Record<string, StemRun> = {
  'scale.pairwise-binary': (variant, ctx) => {
    const c = PAIRWISE[variant] as { arity: number; n: number; budgetMs: number };
    const space = pairwiseCase(c.arity, c.n);
    const run = planTimed(ctx, space);
    verify(
      space,
      run,
      [axesGroup(space)],
      { budgetMs: c.budgetMs },
      `${c.n} shared axes of arity ${c.arity}`,
    );
  },

  'scale.many-rules': (variant, ctx) => {
    const { rng } = ctx;
    const [pool, count] =
      variant === 'twenty-rules' ? [60, 20] : variant === 'hundred-rules' ? [160, 100] : [20, 100];
    const rules = randomRules(rng, pool, count, 6);
    const space = makeSpace(Array(pool).fill(2), { rules });
    const run = planTimed(ctx, space);
    const groups: SpaceGroup[] = space.rules.map((r) => ({
      id: r.id,
      kind: 'rule',
      vars: [...new Set(r.vars)].sort((a, b) => a - b),
      strength: 3,
    }));
    const others: SpaceGroup[] = space.vars.flatMap((_, i) =>
      space.rules.some((r) => r.vars.includes(i))
        ? []
        : [{ id: `v${i}`, kind: 'other' as const, vars: [i], strength: 1 }],
    );
    verify(
      space,
      run,
      [...groups, ...others],
      { budgetMs: 30_000 },
      `${count} rules of 6 binary variables drawn from ${pool}`,
    );
  },

  'scale.thousand-others': (variant, ctx) => {
    const n = variant === 'one-thousand' ? 1000 : 5000;
    const space = makeSpace(Array(n).fill(3));
    const run = planTimed(ctx, space);
    const groups: SpaceGroup[] = space.vars.map((_, i) => ({
      id: `v${i}`,
      kind: 'other',
      vars: [i],
      strength: 1,
    }));
    verify(
      space,
      run,
      groups,
      { budgetMs: 10_000, maxRows: 6 },
      `${n} variables of arity 3 in no rule and no axis`,
    );
  },

  'scale.many-impossible-pairs': (variant, ctx) => {
    const { rng } = ctx;
    const n = 200;
    const axes = 30;
    const space = makeSpace(Array(n).fill(4), { shared: Array.from({ length: axes }, (_, i) => i) });
    const want = variant === 'two-thousand' ? 2000 : 20000;
    const taken = forbidSet(space);
    for (let tries = 0, added = 0; added < want && tries < want * 20; tries += 1) {
      const a = rng.int(0, n - 2);
      const b = rng.int(a + 1, n - 1);
      const va = rng.int(1, 3);
      const vb = rng.int(1, 3);
      if (isForbidden(taken, a, va, b, vb)) continue;
      forbid(space, a, va, b, vb);
      taken.add(((a * 4096 + va) * 65536 + b) * 4096 + vb);
      added += 1;
    }
    const run = planTimed(ctx, space);
    const groups: SpaceGroup[] = [
      { id: 'axes', kind: 'shared', vars: Array.from({ length: axes }, (_, i) => i), strength: 2 },
      ...space.vars.flatMap((_, i) =>
        i < axes ? [] : [{ id: `v${i}`, kind: 'other' as const, vars: [i], strength: 1 }],
      ),
    ];
    verify(
      space,
      run,
      groups,
      { budgetMs: 30_000, factor: 4 },
      `${n} variables of arity 4 (${axes} axes) with ${space.forbidden.length} impossible pairs`,
    );
  },

  'scale.estate-spans': (variant, ctx) => {
    const { rng } = ctx;
    const spans = variant === 'two-hundred' ? 200 : variant === 'two-thousand' ? 2000 : 10000;
    const filesCount = 20;
    const byFile: string[][] = Array.from({ length: filesCount }, () => []);
    const rules: RuleSpec[] = [];
    const texts: string[] = [];
    for (let i = 0; i < spans; i += 1) {
      const q: Quantity = { noun: nounNumber(i), unit: ' euros', kind: 'money' };
      const span = numericSpan(rng.pick(['gt', 'ge', 'lt', 'le'] as const), 'symbol', q, rng.int(5, 900));
      const f = i % filesCount;
      (byFile[f] as string[]).push(ruleSentence(span.text, rng));
      rules.push({ id: `R${i + 1}`, source: `docs/part-${f}.md`, conditions: [span.text], tools: [] });
      texts.push(span.text);
    }
    const files: Record<string, string> = {};
    byFile.forEach((sentences, f) => {
      let text = `# Part ${f}\n\n${sentences.join('\n')}\n`;
      let k = 0;
      while (text.length < 100_000) {
        text += `Filler line ${k} keeps the file long enough to be read in earnest.\n`;
        k += 1;
      }
      files[`docs/part-${f}.md`] = text;
    });
    const estate = estateOf(files, rules);
    const { value: store, ms } = cpuMs(() => build(ctx, { estate }));
    must(
      store.refused.length === 0,
      () => `${store.refused.length} refusals for findable spans: ${show(store.refused.slice(0, 2))}`,
    );
    must(
      store.variables.length === spans,
      () => `${spans} spans with distinct nouns give ${store.variables.length} variables`,
    );
    must(
      store.variables.every((v) => v.values.length === 3),
      'a variable does not hold three values',
    );
    for (const k of rng.sample(
      Array.from({ length: spans }, (_, i) => i),
      30,
    )) {
      const hit = variablesCiting(store, texts[k] as string);
      must(hit.length === 1, () => `the span "${texts[k]}" is cited by ${hit.length} variables, expected 1`);
    }
    const budget = spans <= 200 ? 5000 : spans <= 2000 ? 10_000 : 30_000;
    must(
      ms <= budget,
      () =>
        `reading ${spans} spans in ${filesCount} files of 100 KB took ${Math.round(ms)} ms of processor time, over ${budget} ms`,
    );
  },

  'scale.conversations': (variant, ctx) => {
    const { rng } = ctx;
    const base: Base = baseStore(ctx, Array(8).fill(5));
    const n = variant === 'ten-thousand' ? 10_000 : 100_000;
    const skew = [1, 1.2, 1.4, 1.6, 1.8];
    const mixes = base.vars.map(() => skew.map((x) => x / skew.reduce((a, b) => a + b, 0)));
    const { sessions, counts, observed } = draw(rng, base, n, mixes);
    const { value: store, ms } = cpuMs(() =>
      build(ctx, { estate: base.estate, conversations: sessions as ConversationInput[] }),
    );
    checkCounts(store, base, counts, observed);
    const budget = n <= 10_000 ? 2000 : 5000;
    must(
      ms <= budget,
      () => `counting ${n} sessions took ${Math.round(ms)} ms of processor time, over ${budget} ms`,
    );
  },

  'scale.counter-big-plan': (variant, ctx) => {
    const { rng } = ctx;
    const [n, t] = variant === 'hundred-binary-t3' ? [100, 3] : [200, 2];
    const space = makeSpace(Array(n).fill(2));
    const rows = Array.from({ length: 30 }, () => Array.from({ length: n }, () => rng.int(0, 1)));
    const group: SpaceGroup = { id: 'g', kind: 'rule', vars: space.vars.map((_, i) => i), strength: t };
    const scan = scanCoverage(space, [group], rows);
    const want = BigInt(choose(n, t)) * BigInt(2 ** t);
    must(BigInt(scan.required) === want, 'the bank scan disagrees with the closed form');
    const store = toStore(space);
    const asRows = rows.map((r) =>
      Object.fromEntries(r.map((v, i) => [`v${String(i).padStart(3, '0')}`, `x${v}`])),
    );
    const { value: result, ms } = cpuMs(() =>
      callCoverage(ctx, store, asRows, counterGroups(space, [group])),
    );
    must(
      toBig(result.allowed, 'allowed') === want,
      () => `allowed ${show(result.allowed)}, expected ${want}`,
    );
    const covered = BigInt(scan.required - scan.missing);
    must(
      toBig(result.covered, 'covered') === covered,
      () => `covered ${show(result.covered)}, the bank's scan of the 30 rows gives ${covered}`,
    );
    must(
      ms <= 20_000,
      () =>
        `counting the coverage of 30 rows over ${n} binary variables at strength ${t} took ${Math.round(ms)} ms of processor time, over 20000 ms`,
    );
  },

  'scale.big-arity-axis': (_variant, ctx) => {
    const space = makeSpace([200, 2, 2, 2], { shared: [0, 1, 2, 3] });
    const run = planTimed(ctx, space);
    verify(
      space,
      run,
      [axesGroup(space)],
      { budgetMs: 10_000 },
      'one axis of 200 values beside three binary axes',
    );
  },
};

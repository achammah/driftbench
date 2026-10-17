import { rngFor, shuffled } from '../../blocks/harness';
import { need } from '../../blocks/product';
import {
  type BankItem,
  blocks,
  CORE,
  call,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  PASS,
  play,
  same,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-drift-class: how a failing block gets its drift classes (docs/concepts/drift.md "How a class is assigned" and
 * docs/running.md "Drift"). The verdicts handed to `driftOf` are planted from the documented table; the runner items
 * run a scripted agent whose blocks fail on purpose.
 */

const FAMILY = 'bg-drift-class';
const D = 'docs/concepts/drift.md "How a class is assigned"';

const X1 = 'X1_local';
const X2 = 'X2_contradiction';
const X3 = 'X3_flow';
const X4 = 'X4_format';
const X5 = 'X5_tool';

/** The families the drift page lists for each class. */
const TABLE: Record<string, readonly string[]> = {
  [X1]: [
    'must',
    'must_not',
    'execution',
    'workspace',
    'artifacts',
    'schema_strict',
    'budget',
    'end_state',
    'judge',
  ],
  [X2]: ['ledger'],
  [X3]: ['stage', 'flow'],
  [X4]: ['lang', 'cards', 'pii'],
  [X5]: ['tools', 'forbidden', 'skills', 'guards', 'safety'],
};
const ORDER = [X1, X2, X3, X4, X5];
const ALL_FAMILIES = Object.values(TABLE).flat();

type Verdict = {
  id: string;
  kind: 'machine';
  name: string;
  gating: boolean;
  outcome: string;
  evidence: string;
};

function verdict(id: string, outcome = 'fail', gating = true, name?: string): Verdict {
  return { id, kind: 'machine', name: name ?? id.split('.')[0] ?? id, gating, outcome, evidence: 'planted' };
}

function classesOf(ctx: ItemContext, verdicts: readonly Verdict[]): string {
  const driftOf = need<(verdicts: unknown[]) => unknown>(ctx.product.core, 'core', 'driftOf');
  const got = driftOf(verdicts.map((each) => ({ ...each })));
  return show(Array.isArray(got) ? got.map(String) : got);
}

const want = (classes: readonly string[]) => show(ORDER.filter((each) => classes.includes(each)));

/** Other families (not in `except`) as passing, non-gating and inconclusive verdicts: noise a class must ignore. */
function noise(ctx: ItemContext, tag: string, except: readonly string[]): Verdict[] {
  const rng = rngFor(ctx.seed, `${tag}:noise`);
  const others = shuffled(
    rng,
    ALL_FAMILIES.filter((each) => !except.includes(each)),
  );
  const [a, b, c] = others;
  return [
    verdict(`${a}.${word(ctx.seed, `${tag}:n1`, 5)}`, 'pass'),
    verdict(`${b}.${word(ctx.seed, `${tag}:n2`, 5)}`, 'fail', false),
    verdict(`${c}.${word(ctx.seed, `${tag}:n3`, 5)}`, 'inconclusive', true),
  ];
}

function expectClasses(ctx: ItemContext, _tag: string, verdicts: Verdict[], classes: readonly string[]) {
  const got = classesOf(ctx, verdicts);
  const shouldBe = want(classes);
  return got === shouldBe
    ? null
    : say(
        D,
        `the failing gating verdicts ${show(verdicts.map((v) => `${v.id}:${v.outcome}${v.gating ? '' : ':non-gating'}`))} give ${shouldBe}`,
        got,
      );
}

function familyItems(): BankItem[] {
  const out: BankItem[] = [];
  const causeOf = { [X1]: 'DR1', [X2]: 'DR2', [X3]: 'DR3', [X4]: 'DR4', [X5]: 'DR5' } as const;
  const titles: Record<string, string> = {};
  for (const [cls, families] of Object.entries(TABLE)) {
    const variants: [string, string][] = families.map((each) => [each, each]);
    if (cls === X2) variants.push(['ledger-two-facts', 'ledger'], ['ledger-with-noise', 'ledger']);
    if (cls === X3) variants.push(['stage-and-flow', 'stage']);
    for (const [variant, family] of variants) {
      const id = `bg.drift.family.${variant}`;
      titles[id] = cls;
      out.push(
        gitem(
          FAMILY,
          id,
          variant === family ? 2 : 3,
          CORE,
          causeOf[cls as keyof typeof causeOf],
          `a failing gating ${variant} verdict gives ${cls} and a passing, non-gating or inconclusive one gives none`,
          async (ctx) => {
            const t = word(ctx.seed, `${id}:t`, 6);
            const main: Verdict[] = [verdict(`${family}.${t}`)];
            if (variant === 'ledger-two-facts') main.push(verdict(`ledger.${word(ctx.seed, `${id}:u`, 6)}`));
            if (variant === 'stage-and-flow') main.push(verdict(`flow.${word(ctx.seed, `${id}:u`, 6)}`));
            const rest = noise(ctx, id, [family]);
            const bad = [
              expectClasses(ctx, id, [...main, ...(variant === 'ledger-with-noise' ? rest : [])], [cls]),
              expectClasses(ctx, id, [...main.map((v) => ({ ...v, outcome: 'pass' })), ...rest], []),
              expectClasses(ctx, id, [...main.map((v) => ({ ...v, gating: false })), ...rest], []),
              expectClasses(ctx, id, [...main.map((v) => ({ ...v, outcome: 'inconclusive' })), ...rest], []),
              expectClasses(
                ctx,
                id,
                [...rest, ...main, verdict(`${family}.${word(ctx.seed, `${id}:p`, 4)}`, 'pass')],
                [cls],
              ),
            ].find((each) => each !== null);
            return bad ? fail(bad) : PASS;
          },
        ),
      );
    }
  }
  return out;
}

function orderItems(): BankItem[] {
  const subsets: string[][] = [
    [X5, X1],
    [X3, X2, X4],
    [X5, X4, X3, X2, X1],
    [X4, X2],
    [X1, X3, X5],
    [X2, X5],
  ];
  return subsets.map((classes, index) =>
    gitem(
      FAMILY,
      `bg.drift.order.${index}`,
      3,
      CORE,
      'DR6',
      `a block failing in ${classes.length} families of different classes carries each class once, in the order X1 to X5`,
      async (ctx) => {
        const id = `bg.drift.order.${index}`;
        const rng = rngFor(ctx.seed, id);
        const picked = classes.map((cls) => {
          const families = TABLE[cls] as readonly string[];
          return verdict(
            `${families[Math.floor(rng() * families.length)]}.${word(ctx.seed, `${id}:${cls}`, 5)}`,
          );
        });
        const mixed = shuffled(rng, [
          ...picked,
          ...noise(
            ctx,
            id,
            picked.map((v) => v.id.split('.')[0] as string),
          ),
        ]);
        const bad = expectClasses(ctx, id, mixed, classes);
        return bad ? fail(bad) : PASS;
      },
    ),
  );
}

function oncePerClassItems(): BankItem[] {
  const cases: { id: string; fam: string[]; extra?: number }[] = [
    { id: 'three-x1-families', fam: ['must', 'must_not', 'end_state'] },
    { id: 'same-family-twice', fam: ['tools', 'tools'] },
    { id: 'all-x5-families', fam: TABLE[X5] as string[] },
    { id: 'all-x1-families', fam: TABLE[X1] as string[] },
    { id: 'x4-families-and-one-x2', fam: ['lang', 'cards', 'pii', 'ledger'] },
  ];
  return cases.map((each) =>
    gitem(
      FAMILY,
      `bg.drift.once.${each.id}`,
      3,
      CORE,
      'DR7',
      'a block carries one class per family among its failing gating verdicts: several failing verdicts of one class give that class once',
      async (ctx) => {
        const tag = `bg.drift.once.${each.id}`;
        const verdicts = each.fam.map((family, i) =>
          verdict(`${family}.${word(ctx.seed, `${tag}:${i}`, 5)}`),
        );
        const classes = [
          ...new Set(
            each.fam.map(
              (family) =>
                Object.keys(TABLE).find((c) => (TABLE[c] as readonly string[]).includes(family)) as string,
            ),
          ),
        ];
        const bad = expectClasses(ctx, tag, verdicts, classes);
        return bad ? fail(bad) : PASS;
      },
    ),
  );
}

function dotItems(): BankItem[] {
  const cases: { id: string; verdictId: (s: (n: string) => string) => string; cls: string; name?: string }[] =
    [
      { id: 'later-segment-is-a-family', verdictId: (s) => `must.ledger.${s('a')}`, cls: X1 },
      { id: 'first-segment-wins-over-stage', verdictId: (s) => `ledger.stage.${s('a')}`, cls: X2 },
      { id: 'deep-id', verdictId: (s) => `tools.flow.stage.${s('a')}.${s('b')}`, cls: X5 },
      { id: 'name-field-differs', verdictId: (s) => `lang.${s('a')}`, cls: X4, name: 'tools' },
      { id: 'name-is-a-family-id-is-not-known', verdictId: (s) => `${s('z')}.must`, cls: '', name: 'must' },
      { id: 'no-dot-in-the-id', verdictId: () => 'skills', cls: X5 },
    ];
  return cases.map((each) =>
    gitem(
      FAMILY,
      `bg.drift.dot.${each.id}`,
      3,
      CORE,
      'DR8',
      'the class comes from the text of the verdict id before its first dot, whatever follows it or the verdict name says',
      async (ctx) => {
        const tag = `bg.drift.dot.${each.id}`;
        const s = (n: string) => word(ctx.seed, `${tag}:${n}`, 5);
        const v = verdict(each.verdictId(s), 'fail', true, each.name);
        const bad = expectClasses(
          ctx,
          tag,
          [v, ...noise(ctx, tag, [v.id.split('.')[0] as string])],
          each.cls ? [each.cls] : [],
        );
        return bad ? fail(bad) : PASS;
      },
    ),
  );
}

function unknownItems(): BankItem[] {
  const cases: { id: string; ids: (s: (n: string) => string) => string[]; classes: string[] }[] = [
    { id: 'custom-dot', ids: (s) => [`custom.${s('a')}`], classes: [] },
    { id: 'custom-prefix-family', ids: (s) => [`custom${s('a')}.${s('b')}`], classes: [] },
    { id: 'unknown-family', ids: (s) => [`${s('a')}.${s('b')}`], classes: [] },
    { id: 'custom-beside-a-real-failure', ids: (s) => [`custom.${s('a')}`, `must.${s('b')}`], classes: [X1] },
    {
      id: 'unknown-beside-two-real-failures',
      ids: (s) => [`${s('a')}.${s('b')}`, `tools.${s('c')}`, `ledger.${s('d')}`],
      classes: [X2, X5],
    },
    {
      id: 'custom-with-a-family-word-after-the-dot',
      ids: (s) => [`custom.tools.${s('a')}`, `custom.ledger.${s('b')}`],
      classes: [],
    },
  ];
  return cases.map((each) =>
    gitem(
      FAMILY,
      `bg.drift.unknown.${each.id}`,
      3,
      CORE,
      'DR9',
      'a custom check never takes a family class by its name, and a family the table does not list gives no class',
      async (ctx) => {
        const tag = `bg.drift.unknown.${each.id}`;
        const s = (n: string) => word(ctx.seed, `${tag}:${n}`, 6);
        const verdicts = each.ids(s).map((id) => verdict(id));
        const bad = expectClasses(ctx, tag, verdicts, each.classes);
        return bad ? fail(bad) : PASS;
      },
    ),
  );
}

type RunCase = {
  id: string;
  blocks: { pass: boolean; extra?: 'must_not' | 'tools' | 'forbidden' | 'stage' }[];
  classes: string[][];
};

/** The runner records the classes on the block (docs/running.md "Drift"). */
function runnerItems(): BankItem[] {
  const cases: RunCase[] = [
    { id: 'must-fails', blocks: [{ pass: true }, { pass: false }, { pass: true }], classes: [[], [X1], []] },
    {
      id: 'tools-count-fails',
      blocks: [{ pass: true, extra: 'tools' }, { pass: true }],
      classes: [[X5], []],
    },
    {
      id: 'must-and-tools-fail',
      blocks: [{ pass: false, extra: 'tools' }, { pass: true }],
      classes: [[X1, X5], []],
    },
    {
      id: 'must-not-fails',
      blocks: [{ pass: true }, { pass: true, extra: 'must_not' }],
      classes: [[], [X1]],
    },
    { id: 'forbidden-tool-called', blocks: [{ pass: true, extra: 'forbidden' }], classes: [[X5]] },
    {
      id: 'reported-stage-differs',
      blocks: [{ pass: true }, { pass: true, extra: 'stage' }],
      classes: [[], [X3]],
    },
    { id: 'all-pass', blocks: [{ pass: true }, { pass: true }, { pass: true }], classes: [[], [], []] },
  ];
  return cases.map((each) =>
    gitem(
      FAMILY,
      `bg.drift.runner.${each.id}`,
      3,
      CORE,
      'DR10',
      'the runner gives every block the drift classes of the gating verdicts it fails, by the family of the verdict id',
      async (ctx) => {
        const tag = `bg.drift.runner.${each.id}`;
        const stages = [word(ctx.seed, `${tag}:s1`, 5), word(ctx.seed, `${tag}:s2`, 5)];
        const tool = word(ctx.seed, `${tag}:tool`, 6);
        const forbidden = word(ctx.seed, `${tag}:forbidden`, 6);
        const defs = blocks(ctx.seed, tag, each.blocks.length).map((def, i) => {
          const spec = each.blocks[i] as RunCase['blocks'][number];
          const code = (def.expect as { must: string[] }).must[0] as string;
          const stray = word(ctx.seed, `${tag}:stray:${i}`, 8);
          return {
            ...def,
            plan: {
              ...def.plan,
              text: spec.pass
                ? `${def.plan.text}${spec.extra === 'must_not' ? ` ${stray}` : ''}`
                : 'Let me look at that.',
              calls: spec.extra === 'forbidden' ? [call(forbidden)] : [],
              ...(spec.extra === 'stage' ? { stage: stages[1] as string } : { stage: stages[0] as string }),
            },
            expect: {
              must: [code],
              ...(spec.extra === 'tools' ? { tools: [{ label: tool, count: 1 }] } : {}),
              ...(spec.extra === 'must_not' ? { must_not: [stray] } : {}),
              ...(spec.extra === 'stage' ? { stage: stages[0] as string } : {}),
            },
          };
        });
        const sc = scenario(ctx.seed, tag, defs, {
          stages,
          ...(each.blocks.some((b) => b.extra === 'forbidden')
            ? { rules: { forbidden_tools: [forbidden] } }
            : {}),
        });
        const { rec } = await play(ctx, sc);
        const got = rec.blocks.map((block) => (block as unknown as { drift?: string[] }).drift ?? null);
        const ok = same(
          got,
          each.classes.map((classes) => ORDER.filter((cls) => classes.includes(cls))),
        );
        return ok
          ? PASS
          : fail(
              say(
                'docs/running.md "Drift"',
                `the blocks carry the classes ${show(each.classes)}`,
                `${show(got)}; failing verdicts ${show(rec.blocks.map((b) => b.verdicts.filter((v) => v.outcome !== 'pass' && !v.id.startsWith('pii')).map((v) => `${v.id}:${v.outcome}`)))}`,
              ),
            );
      },
    ),
  );
}

export function driftItems(): BankItem[] {
  return [
    ...familyItems(),
    ...orderItems(),
    ...oncePerClassItems(),
    ...dotItems(),
    ...unknownItems(),
    ...runnerItems(),
  ];
}
void expectAll;

import { rngFor } from '../../blocks/harness';
import {
  type BankItem,
  type BlockRecord,
  type Call,
  CORE,
  call,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  PASS,
  play,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-ledger: the ledger check (docs/concepts/drift.md "The ledger check"). A ledger of seeded facts is compared in code
 * with what each block's tool calls and replies state. Each item plays a right block and a wrong block, so a check that
 * never compares and one that always flags both fail.
 */

const FAMILY = 'bg-ledger';
const D = 'docs/concepts/drift.md "The ledger check"';
const X2 = 'X2_contradiction';

type Def = {
  text?: string;
  calls?: Call[];
  add?: Record<string, unknown>;
  say?: (marker: string) => string;
};

type VerdictLike = { id: string; outcome: string; gating: boolean; evidence?: string };
const driftOfBlock = (block: BlockRecord | undefined) =>
  ((block as unknown as { drift?: string[] })?.drift ?? []) as string[];
const ledgerVerdicts = (block: BlockRecord | undefined) =>
  ((block?.verdicts ?? []) as VerdictLike[]).filter((verdict) => verdict.id.startsWith('ledger.'));

async function runLedger(
  ctx: ItemContext,
  tag: string,
  ledger: Record<string, unknown>,
  defs: readonly Def[],
  spec: Record<string, unknown> = {},
) {
  const sc = scenario(
    ctx.seed,
    tag,
    defs.map((def) => ({
      plan: { text: def.text ?? 'Noted.', calls: def.calls ?? [] },
      ...(def.add ? { expect: { ledger_add: def.add } } : {}),
      ...(def.say ? { say: def.say } : {}),
    })),
    { given: { ledger }, ...spec },
  );
  const { rec } = await play(ctx, sc);
  return rec;
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The first problem of a list, as a failed item, else a pass. */
const first = (problems: (string | null | false | undefined)[]): ItemResult => {
  const found = problems.find((each) => typeof each === 'string');
  return found ? fail(found as string) : PASS;
};

/** Block 0 states `right`, block 1 states `wrong` in a tool input; the fact `fact` is compared (or, when `compared` is false, not at all). */
async function twin(
  ctx: ItemContext,
  tag: string,
  ledger: Record<string, unknown>,
  fact: string,
  right: Record<string, unknown>,
  wrong: Record<string, unknown>,
  compared = true,
): Promise<ItemResult> {
  const tool = word(ctx.seed, `${tag}:tool`, 6);
  const rec = await runLedger(ctx, tag, ledger, [
    { calls: [call(tool, right)] },
    { calls: [call(tool, wrong)] },
  ]);
  const [a, b] = rec.blocks;
  const id = `ledger.${fact}`;
  const va = ledgerVerdicts(a);
  const vb = ledgerVerdicts(b);
  if (!compared)
    return first([
      (va.length > 0 || vb.length > 0) &&
        say(
          D,
          `a key that does not name the fact is not compared: no ledger verdict`,
          show([...va, ...vb].map((v) => `${v.id}:${v.outcome}`)),
        ),
      driftOfBlock(b).includes(X2) && say(D, 'no contradiction is found', show(driftOfBlock(b))),
    ]);
  return first([
    !(va.length === 1 && va[0]?.id === id && va[0].outcome === 'pass' && va[0].gating) &&
      say(
        D,
        `the block that states the ledger's value gets one gating pass verdict ${id}`,
        show(va.map((v) => `${v.id}:${v.outcome}:${v.gating}`)),
      ),
    !(vb.length === 1 && vb[0]?.id === id && vb[0].outcome === 'fail' && vb[0].gating) &&
      say(
        D,
        `the block that states another value gets one gating fail verdict ${id}`,
        show(vb.map((v) => `${v.id}:${v.outcome}:${v.gating}`)),
      ),
    !driftOfBlock(b).includes(X2) &&
      say(D, 'the failing ledger verdict gives X2_contradiction', show(driftOfBlock(b))),
    driftOfBlock(a).includes(X2) && say(D, 'the right block carries no X2', show(driftOfBlock(a))),
    b?.pass !== false && say(D, 'a failing gating ledger verdict fails the block', `pass ${b?.pass}`),
  ]);
}

function names(ctx: ItemContext, tag: string) {
  const w1 = word(ctx.seed, `${tag}:k1`, 5);
  const w2 = word(ctx.seed, `${tag}:k2`, 5);
  const right = word(ctx.seed, `${tag}:right`, 8);
  let wrong = word(ctx.seed, `${tag}:wrong`, 8);
  if (wrong === right) wrong = `${wrong}x`;
  return { w1, w2, fact: `${w1}_${w2}`, right, wrong };
}

function keyItems(): BankItem[] {
  const variants: { id: string; key: (n: { w1: string; w2: string }) => string }[] = [
    { id: 'exact', key: (n) => `${n.w1}_${n.w2}` },
    { id: 'camel', key: (n) => `${n.w1}${cap(n.w2)}` },
    { id: 'hyphen', key: (n) => `${n.w1}-${n.w2}` },
    { id: 'upper-snake', key: (n) => `${n.w1}_${n.w2}`.toUpperCase() },
    { id: 'pascal', key: (n) => `${cap(n.w1)}${cap(n.w2)}` },
    { id: 'joined-lower', key: (n) => `${n.w1}${n.w2}` },
    { id: 'mixed-hyphen-case', key: (n) => `${cap(n.w1)}-${n.w2}` },
  ];
  const out = variants.map((variant) =>
    gitem(
      FAMILY,
      `bg.ledger.key.${variant.id}`,
      variant.id === 'exact' ? 2 : 3,
      CORE,
      'LD1',
      `a tool input key that reads as the ledger fact name once case, _ and - are left out (${variant.id}) is compared with the fact`,
      async (ctx) => {
        const tag = `bg.ledger.key.${variant.id}`;
        const n = names(ctx, tag);
        const key = variant.key(n);
        return twin(ctx, tag, { [n.fact]: n.right }, n.fact, { [key]: n.right }, { [key]: n.wrong });
      },
    ),
  );
  out.push(
    gitem(
      FAMILY,
      'bg.ledger.key.other-name-not-compared',
      3,
      CORE,
      'LD1',
      'a tool input key that names another fact is not compared with the fact',
      async (ctx) => {
        const tag = 'bg.ledger.key.other-name-not-compared';
        const n = names(ctx, tag);
        const other = `${n.w1}_${word(ctx.seed, `${tag}:other`, 5)}`;
        return twin(
          ctx,
          tag,
          { [n.fact]: n.right },
          n.fact,
          { [other]: n.right },
          { [other]: n.wrong },
          false,
        );
      },
    ),
  );
  return out;
}

function nestedItems(): BankItem[] {
  const shapes: { id: string; wrap: (key: string, value: string, s: string) => Record<string, unknown> }[] = [
    { id: 'top-level-beside-siblings', wrap: (k, v, s) => ({ [s]: 'x', [k]: v, count: 2 }) },
    { id: 'one-object-deep', wrap: (k, v, s) => ({ [s]: { [k]: v } }) },
    { id: 'three-objects-deep', wrap: (k, v, s) => ({ a: { [s]: { c: { [k]: v } } } }) },
    { id: 'in-a-list-of-objects', wrap: (k, v, s) => ({ [s]: [{ other: 1 }, { [k]: v }] }) },
    { id: 'list-in-object-in-list', wrap: (k, v, s) => ({ [s]: [{ inner: [{ [k]: v }] }] }) },
  ];
  return shapes.map((shape) =>
    gitem(
      FAMILY,
      `bg.ledger.nested.${shape.id}`,
      3,
      CORE,
      'LD2',
      `a scalar under the fact's key is compared wherever it sits in a tool input (${shape.id}), nested objects and lists included`,
      async (ctx) => {
        const tag = `bg.ledger.nested.${shape.id}`;
        const n = names(ctx, tag);
        const s = word(ctx.seed, `${tag}:s`, 5);
        return twin(
          ctx,
          tag,
          { [n.fact]: n.right },
          n.fact,
          shape.wrap(n.fact, n.right, s),
          shape.wrap(n.fact, n.wrong, s),
        );
      },
    ),
  );
}

function valueItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    title: string,
    make: (
      ctx: ItemContext,
      n: ReturnType<typeof names>,
    ) => { ledger: unknown; right: unknown; wrong: unknown },
  ) =>
    out.push(
      gitem(FAMILY, `bg.ledger.value.${id}`, 3, CORE, 'LD3', title, async (ctx) => {
        const tag = `bg.ledger.value.${id}`;
        const n = names(ctx, tag);
        const { ledger, right, wrong } = make(ctx, n);
        return twin(ctx, tag, { [n.fact]: ledger }, n.fact, { [n.fact]: right }, { [n.fact]: wrong });
      }),
    );
  add('case', 'values match as text without case', (_c, n) => ({
    ledger: cap(n.right),
    right: n.right.toUpperCase(),
    wrong: n.wrong,
  }));
  add('surrounding-space', 'values match as text without surrounding space', (_c, n) => ({
    ledger: n.right,
    right: `  ${n.right} `,
    wrong: `  ${n.wrong} `,
  }));
  add(
    'number-ledger-text-input',
    'a number in the ledger matches the same digits written as text in the tool input',
    (c) => {
      const digits = 1000 + Math.floor(rngFor(c.seed, 'bg.ledger.value.number-ledger-text-input')() * 8000);
      return { ledger: digits, right: String(digits), wrong: String(digits + 7) };
    },
  );
  add(
    'text-ledger-number-input',
    'a text in the ledger matches the same digits written as a number in the tool input',
    (c) => {
      const digits = 1000 + Math.floor(rngFor(c.seed, 'bg.ledger.value.text-ledger-number-input')() * 8000);
      return { ledger: String(digits), right: digits, wrong: digits + 7 };
    },
  );
  add(
    'longer-value-is-not-a-match',
    'a value that only contains the ledger value, or only starts with it, is another value',
    (_c, n) => ({
      ledger: n.right,
      right: n.right,
      wrong: `${n.right}${n.wrong}`,
    }),
  );
  return out;
}

function phoneItems(): BankItem[] {
  const digitsOf = (ctx: ItemContext, tag: string, count: number) => {
    const rng = rngFor(ctx.seed, tag);
    let out = String(1 + Math.floor(rng() * 9));
    while (out.length < count) out += Math.floor(rng() * 10);
    return out;
  };
  const group = (digits: string, sep: string, sizes: number[]) => {
    const parts: string[] = [];
    let at = 0;
    for (const size of sizes) {
      parts.push(digits.slice(at, at + size));
      at += size;
    }
    if (at < digits.length) parts.push(digits.slice(at));
    return parts.join(sep);
  };
  const bump = (digits: string) => `${digits.slice(0, -1)}${(Number(digits.slice(-1)) + 1) % 10}`;
  const cases: {
    id: string;
    count: number;
    ledger: (d: string) => string;
    right: (d: string) => string;
    tier: 3 | 4;
  }[] = [
    {
      id: 'spaces-against-dashes',
      count: 11,
      ledger: (d) => `+${group(d, ' ', [2, 3, 2, 2])}`,
      right: (d) => `+${group(d, '-', [2, 3, 2, 2])}`,
      tier: 3,
    },
    {
      id: 'dots-against-plain',
      count: 10,
      ledger: (d) => group(d, '.', [3, 3, 2]),
      right: (d) => d,
      tier: 3,
    },
    {
      id: 'spaces-against-plain-with-plus',
      count: 12,
      ledger: (d) => `+${group(d, ' ', [3, 3, 3])}`,
      right: (d) => `+${d}`,
      tier: 4,
    },
    {
      id: 'exactly-nine-digits',
      count: 9,
      ledger: (d) => group(d, ' ', [3, 3]),
      right: (d) => group(d, '-', [2, 3, 2]),
      tier: 4,
    },
    {
      id: 'eight-digits-are-plain-text',
      count: 8,
      ledger: (d) => group(d, ' ', [2, 2, 2]),
      right: (d) => group(d, ' ', [2, 2, 2]),
      tier: 4,
    },
  ];
  return cases.map((each) =>
    gitem(
      FAMILY,
      `bg.ledger.phone.${each.id}`,
      each.tier,
      CORE,
      'LD4',
      `two values that both read as phone numbers of 9 digits or more match on their digits (${each.id})`,
      async (ctx) => {
        const tag = `bg.ledger.phone.${each.id}`;
        const n = names(ctx, tag);
        const d = digitsOf(ctx, tag, each.count);
        const wrongDigits = bump(d);
        if (each.id === 'eight-digits-are-plain-text') {
          // Under 9 digits the values are plain text: a different spacing is another value.
          const tool = word(ctx.seed, `${tag}:tool`, 6);
          const rec = await runLedger(ctx, tag, { [n.fact]: group(d, ' ', [2, 2, 2]) }, [
            { calls: [call(tool, { [n.fact]: group(d, ' ', [2, 2, 2]) })] },
            { calls: [call(tool, { [n.fact]: d })] },
          ]);
          const [a, b] = rec.blocks;
          return first([
            ledgerVerdicts(a)[0]?.outcome !== 'pass' &&
              say(D, 'the same text passes', show(ledgerVerdicts(a))),
            ledgerVerdicts(b)[0]?.outcome !== 'fail' &&
              say(
                D,
                'eight digits are not a phone number: the same digits spaced another way are another text and fail',
                show(ledgerVerdicts(b).map((v) => `${v.id}:${v.outcome}`)),
              ),
          ]);
        }
        return twin(
          ctx,
          tag,
          { [n.fact]: each.ledger(d) },
          n.fact,
          { [n.fact]: each.right(d) },
          { [n.fact]: each.right(wrongDigits) },
        );
      },
    ),
  );
}

function scalarOnlyItems(): BankItem[] {
  const kinds: { id: string; ledger: (v: string) => unknown }[] = [
    { id: 'list', ledger: (v) => [v, 'zz'] },
    { id: 'object', ledger: (v) => ({ inner: v }) },
  ];
  const out = kinds.map((kind) =>
    gitem(
      FAMILY,
      `bg.ledger.scalar-only.${kind.id}`,
      3,
      CORE,
      'LD5',
      `a ledger fact that holds a ${kind.id} is not compared with a tool input key of its name`,
      async (ctx) => {
        const tag = `bg.ledger.scalar-only.${kind.id}`;
        const n = names(ctx, tag);
        const tool = word(ctx.seed, `${tag}:tool`, 6);
        const rec = await runLedger(ctx, tag, { [n.fact]: kind.ledger(n.right) }, [
          { calls: [call(tool, { [n.fact]: n.wrong })] },
        ]);
        const got = ledgerVerdicts(rec.blocks[0]);
        return first([
          got.length > 0 &&
            say(
              D,
              'a fact that is not a scalar gives no ledger verdict',
              show(got.map((v) => `${v.id}:${v.outcome}`)),
            ),
          driftOfBlock(rec.blocks[0]).includes(X2) && say(D, 'no X2', show(driftOfBlock(rec.blocks[0]))),
        ]);
      },
    ),
  );
  out.push(
    gitem(
      FAMILY,
      'bg.ledger.scalar-only.scalar-twin',
      3,
      CORE,
      'LD5',
      'a ledger fact that holds a scalar is compared with a tool input key of its name',
      async (ctx) => {
        const tag = 'bg.ledger.scalar-only.scalar-twin';
        const n = names(ctx, tag);
        return twin(
          ctx,
          tag,
          { [n.fact]: n.right, [`${n.w1}_list`]: [n.right] },
          n.fact,
          { [n.fact]: n.right },
          { [n.fact]: n.wrong },
        );
      },
    ),
  );
  return out;
}

function verdictItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, title: string, check: (ctx: ItemContext, tag: string) => Promise<ItemResult>) =>
    out.push(
      gitem(FAMILY, `bg.ledger.verdict.${id}`, 3, CORE, 'LD6', title, (ctx) =>
        check(ctx, `bg.ledger.verdict.${id}`),
      ),
    );
  type Fact = { name: string; value: string; other: string };
  const facts = (ctx: ItemContext, tag: string): [Fact, Fact, Fact] => {
    const one = (suffix: string): Fact => ({
      name: `${word(ctx.seed, `${tag}:f${suffix}`, 5)}_${suffix}`,
      value: word(ctx.seed, `${tag}:v${suffix}`, 8),
      other: word(ctx.seed, `${tag}:o${suffix}`, 8),
    });
    return [one('a'), one('b'), one('c')];
  };
  add(
    'only-the-facts-stated',
    'the check gives one gating verdict per fact the block states and none for a fact it does not state',
    async (ctx, tag) => {
      const [fa, fb, fc] = facts(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(
        ctx,
        tag,
        { [fa?.name]: fa?.value, [fb?.name]: fb?.value, [fc?.name]: fc?.value },
        [{ calls: [call(tool, { [fa?.name]: fa?.value, [fb?.name]: fb?.other })] }],
      );
      const got = ledgerVerdicts(rec.blocks[0]);
      const ids = got.map((v) => v.id).sort();
      return first([
        ids.join() !== [`ledger.${fa?.name}`, `ledger.${fb?.name}`].sort().join() &&
          say(D, 'one verdict for each of the two stated facts and none for the third', show(ids)),
        got.some((v) => !v.gating) &&
          say(D, 'every ledger verdict is gating', show(got.map((v) => `${v.id}:${v.gating}`))),
        got.find((v) => v.id === `ledger.${fa?.name}`)?.outcome !== 'pass' &&
          say(D, 'the right fact passes', show(got)),
        got.find((v) => v.id === `ledger.${fb?.name}`)?.outcome !== 'fail' &&
          say(D, 'the wrong fact fails', show(got)),
      ]);
    },
  );
  add(
    'nothing-stated-nothing-judged',
    'a block that states no ledger fact gets no ledger verdict and no X2',
    async (ctx, tag) => {
      const [fa, fb] = facts(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, { [fa?.name]: fa?.value, [fb?.name]: fb?.value }, [
        { calls: [call(tool, { [word(ctx.seed, `${tag}:unrelated`, 6)]: fa?.other })] },
        { text: 'Done.' },
      ]);
      return first(
        rec.blocks.map(
          (block) =>
            ledgerVerdicts(block).length > 0 && say(D, 'no ledger verdict', show(ledgerVerdicts(block))),
        ),
      );
    },
  );
  add(
    'evidence-has-both-values',
    'a failing ledger verdict has both values in its evidence',
    async (ctx, tag) => {
      const [fa] = facts(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, { [fa?.name]: fa?.value }, [
        { calls: [call(tool, { [fa?.name]: fa?.other })] },
      ]);
      const bad = ledgerVerdicts(rec.blocks[0]).find((v) => v.outcome === 'fail');
      const text = JSON.stringify(bad ?? {});
      return first([
        !bad && say(D, 'a failing verdict for the wrong value', show(ledgerVerdicts(rec.blocks[0]))),
        !!bad &&
          (!text.includes(fa?.value) || !text.includes(fa?.other)) &&
          say(D, "the evidence holds the ledger's value and the stated one", text.slice(0, 200)),
      ]);
    },
  );
  add(
    'a-failed-fact-fails-the-block',
    'one failing ledger verdict beside a passing one fails the block with X2 and no more',
    async (ctx, tag) => {
      const [fa, fb] = facts(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, { [fa?.name]: fa?.value, [fb?.name]: fb?.value }, [
        { calls: [call(tool, { [fa?.name]: fa?.value, [fb?.name]: fb?.other })] },
      ]);
      const block = rec.blocks[0];
      return first([
        block?.pass !== false && say(D, 'the block fails', `pass ${block?.pass}`),
        show(driftOfBlock(block)) !== show([X2]) &&
          say(D, 'the block carries X2 only', show(driftOfBlock(block))),
      ]);
    },
  );
  add(
    'every-fact-right-passes-the-block',
    'a block that states every compared fact right passes and carries no class',
    async (ctx, tag) => {
      const [fa, fb] = facts(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, { [fa?.name]: fa?.value, [fb?.name]: fb?.value }, [
        {
          calls: [
            call(tool, { [fa?.name]: fa?.value }),
            call(tool, { [fb?.name]: ` ${fb?.value.toUpperCase()}` }),
          ],
        },
      ]);
      const block = rec.blocks[0];
      return first([
        ledgerVerdicts(block).length !== 2 &&
          say(
            D,
            'two passing ledger verdicts',
            show(ledgerVerdicts(block).map((v) => `${v.id}:${v.outcome}`)),
          ),
        block?.pass !== true &&
          say(D, 'the block passes', `pass ${block?.pass}; drift ${show(driftOfBlock(block))}`),
        driftOfBlock(block).length > 0 && say(D, 'no class', show(driftOfBlock(block))),
      ]);
    },
  );
  add(
    'a-later-block-is-judged-by-the-same-ledger',
    'a ledger fact is compared in every block that states it, the wrong one failing alone',
    async (ctx, tag) => {
      const [fa] = facts(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, { [fa?.name]: fa?.value }, [
        { calls: [call(tool, { [fa?.name]: fa?.value })] },
        { text: 'Fine.' },
        { calls: [call(tool, { [fa?.name]: fa?.other })] },
        { calls: [call(tool, { [fa?.name]: fa?.value })] },
      ]);
      const outcomes = rec.blocks.map((block) => ledgerVerdicts(block)[0]?.outcome ?? 'none');
      return outcomes.join() === 'pass,none,fail,pass'
        ? PASS
        : fail(say(D, 'pass, none, fail, pass', show(outcomes)));
    },
  );
  return out;
}

function addItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, title: string, check: (ctx: ItemContext, tag: string) => Promise<ItemResult>) =>
    out.push(
      gitem(FAMILY, `bg.ledger.add.${id}`, 4, CORE, 'LD7', title, (ctx) => check(ctx, `bg.ledger.add.${id}`)),
    );
  add(
    'same-block',
    "the ledger a block is compared with holds the block's own ledger_add",
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, {}, [
        { add: { [n.fact]: n.right }, calls: [call(tool, { [n.fact]: n.right })] },
        { add: { [`${n.fact}_2`]: n.right }, calls: [call(tool, { [`${n.fact}_2`]: n.wrong })] },
      ]);
      const [a, b] = rec.blocks;
      return first([
        ledgerVerdicts(a)[0]?.outcome !== 'pass' &&
          say(D, 'a fact the block adds and states right passes', show(ledgerVerdicts(a))),
        ledgerVerdicts(b)[0]?.outcome !== 'fail' &&
          say(D, 'a fact the block adds and states otherwise fails', show(ledgerVerdicts(b))),
        !driftOfBlock(b).includes(X2) && say(D, 'X2', show(driftOfBlock(b))),
      ]);
    },
  );
  add(
    'next-block',
    'a fact a block adds with ledger_add is compared in every later block',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, {}, [
        { add: { [n.fact]: n.right } },
        { calls: [call(tool, { [n.fact]: n.right })] },
        { calls: [call(tool, { [n.fact]: n.wrong })] },
      ]);
      const outcomes = rec.blocks.map((block) => ledgerVerdicts(block)[0]?.outcome ?? 'none');
      return outcomes.join() === 'none,pass,fail' ? PASS : fail(say(D, 'none, pass, fail', show(outcomes)));
    },
  );
  add(
    'before-the-block-adds-it',
    'a fact is not compared in a block before the block that adds it',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, {}, [
        { calls: [call(tool, { [n.fact]: n.wrong })] },
        { add: { [n.fact]: n.right } },
        { calls: [call(tool, { [n.fact]: n.wrong })] },
      ]);
      const outcomes = rec.blocks.map((block) => ledgerVerdicts(block)[0]?.outcome ?? 'none');
      return outcomes.join() === 'none,none,fail' ? PASS : fail(say(D, 'none, none, fail', show(outcomes)));
    },
  );
  add(
    'beside-the-given-ledger',
    'a fact from ledger_add is compared beside the facts of given.ledger',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const m = names(ctx, `${tag}:m`);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, { [m.fact]: m.right }, [
        { add: { [n.fact]: n.right }, calls: [call(tool, { [n.fact]: n.right, [m.fact]: m.right })] },
        { calls: [call(tool, { [n.fact]: n.right, [m.fact]: m.wrong })] },
      ]);
      const [a, b] = rec.blocks;
      const ids = (block: BlockRecord | undefined) =>
        ledgerVerdicts(block)
          .map((v) => `${v.id}:${v.outcome}`)
          .sort();
      return first([
        ids(a).join() !== [`ledger.${n.fact}:pass`, `ledger.${m.fact}:pass`].sort().join() &&
          say(D, 'both facts pass in block 0', show(ids(a))),
        ids(b).join() !== [`ledger.${n.fact}:pass`, `ledger.${m.fact}:fail`].sort().join() &&
          say(D, 'the given fact fails alone in block 1', show(ids(b))),
      ]);
    },
  );
  return out;
}

function replyItems(): BankItem[] {
  const out: BankItem[] = [];
  const email = (ctx: ItemContext, tag: string, tail: string) =>
    `${word(ctx.seed, `${tag}:e:${tail}`, 6)}@${word(ctx.seed, `${tag}:d:${tail}`, 6)}.example`;
  const phone = (ctx: ItemContext, tag: string, tail: string) => {
    const rng = rngFor(ctx.seed, `${tag}:p:${tail}`);
    let digits = '';
    for (let i = 0; i < 10; i += 1) digits += Math.floor(rng() * 10);
    return `+49${digits}`;
  };
  type Maker = (ctx: ItemContext, tag: string, tail: string) => string;
  const kinds: [string, Maker][] = [
    ['email', email],
    ['phone', phone],
  ];
  const add = (
    id: string,
    tier: 3 | 4,
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(
        FAMILY,
        `bg.ledger.reply.${id}`,
        tier,
        CORE,
        id.startsWith('other-kind') || id.startsWith('tool-input-only') ? 'LD9' : 'LD8',
        title,
        (ctx) => check(ctx, `bg.ledger.reply.${id}`),
      ),
    );
  for (const [kind, make] of kinds) {
    const run = async (
      ctx: ItemContext,
      tag: string,
      reply: (held: string, named: string, third: string) => string,
      name = true,
    ) => {
      const n = names(ctx, tag);
      const held = make(ctx, tag, 'held');
      const named = make(ctx, tag, 'named');
      const third = make(ctx, tag, 'third');
      const rec = await runLedger(ctx, tag, { [n.fact]: held }, [
        {
          text: reply(held, named, third),
          ...(name ? { say: (marker: string) => `${marker} ${named}` } : {}),
        },
      ]);
      return { rec, fact: n.fact, held, named, third };
    };
    add(
      `${kind}-other-value-contradicts`,
      4,
      `a reply that states a ${kind} the user gave in place of the ledger's contradicts the fact`,
      async (ctx, tag) => {
        const r = await run(ctx, tag, (_h, named) => `Understood, ${named}.`);
        const got = ledgerVerdicts(r.rec.blocks[0]).find((v) => v.id === `ledger.${r.fact}`);
        return first([
          got?.outcome !== 'fail' && say(D, `ledger.${r.fact} fails`, show(ledgerVerdicts(r.rec.blocks[0]))),
          !driftOfBlock(r.rec.blocks[0]).includes(X2) && say(D, 'X2', show(driftOfBlock(r.rec.blocks[0]))),
          got &&
            (!JSON.stringify(got).includes(r.held) || !JSON.stringify(got).includes(r.named)) &&
            say(D, 'both values in the evidence', JSON.stringify(got).slice(0, 220)),
        ]);
      },
    );
    add(
      `${kind}-ledger-value-stated`,
      4,
      `a reply that states the ledger's ${kind} gets a passing verdict`,
      async (ctx, tag) => {
        const r = await run(ctx, tag, (held) => `Understood, ${held}.`);
        const got = ledgerVerdicts(r.rec.blocks[0]);
        return got.some((v) => v.outcome === 'fail')
          ? fail(say(D, 'no failing ledger verdict', show(got)))
          : got.find((v) => v.id === `ledger.${r.fact}`)?.outcome === 'pass'
            ? PASS
            : fail(say(D, `ledger.${r.fact} passes`, show(got)));
      },
    );
    add(
      `${kind}-question-naming-both`,
      4,
      `a question that names the ledger's ${kind} and the other one is no contradiction`,
      async (ctx, tag) => {
        const r = await run(ctx, tag, (held, named) => `Is it ${held} or ${named}?`);
        const got = ledgerVerdicts(r.rec.blocks[0]);
        return got.some((v) => v.outcome === 'fail') || driftOfBlock(r.rec.blocks[0]).includes(X2)
          ? fail(say(D, 'no contradiction', show(got.map((v) => `${v.id}:${v.outcome}`))))
          : PASS;
      },
    );
    add(
      `${kind}-unnamed-value-is-not-a-contradiction`,
      4,
      `a reply that states a ${kind} no user message named is no contradiction`,
      async (ctx, tag) => {
        const r = await run(ctx, tag, (_h, _n, third) => `Understood, ${third}.`);
        const got = ledgerVerdicts(r.rec.blocks[0]);
        return got.some((v) => v.outcome === 'fail') || driftOfBlock(r.rec.blocks[0]).includes(X2)
          ? fail(say(D, 'no contradiction', show(got.map((v) => `${v.id}:${v.outcome}`))))
          : PASS;
      },
    );
  }
  add(
    'other-kind-reply-is-not-read',
    4,
    'a fact that is not an email or a phone is read from tool inputs alone: a reply that states another value is no contradiction',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const rec = await runLedger(ctx, tag, { [n.fact]: n.right }, [
        { text: `Understood, ${n.wrong}.`, say: (marker) => `${marker} ${n.wrong}` },
      ]);
      const got = ledgerVerdicts(rec.blocks[0]);
      return got.length > 0 || driftOfBlock(rec.blocks[0]).includes(X2)
        ? fail(say(D, 'no ledger verdict', show(got.map((v) => `${v.id}:${v.outcome}`))))
        : PASS;
    },
  );
  add(
    'tool-input-only-same-fact-fails',
    4,
    'the same other-kind fact in a tool input is compared',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const tool = word(ctx.seed, `${tag}:tool`, 6);
      const rec = await runLedger(ctx, tag, { [n.fact]: n.right }, [
        { calls: [call(tool, { [n.fact]: n.wrong })], say: (marker) => `${marker} ${n.wrong}` },
      ]);
      return ledgerVerdicts(rec.blocks[0])[0]?.outcome === 'fail'
        ? PASS
        : fail(say(D, 'the tool input is compared and fails', show(ledgerVerdicts(rec.blocks[0]))));
    },
  );
  add(
    'other-kind-reply-with-the-ledger-value-no-verdict',
    4,
    'a reply stating an other-kind fact gives no verdict for it',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const rec = await runLedger(ctx, tag, { [n.fact]: n.right }, [{ text: `It is ${n.right}.` }]);
      return ledgerVerdicts(rec.blocks[0]).length === 0
        ? PASS
        : fail(
            say(
              D,
              'the reply arm reads emails and phones only: no verdict',
              show(ledgerVerdicts(rec.blocks[0])),
            ),
          );
    },
  );
  return out;
}

function changeItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, title: string, check: (ctx: ItemContext, tag: string) => Promise<ItemResult>) =>
    out.push(
      gitem(FAMILY, `bg.ledger.spec-fault.${id}`, 4, CORE, 'LD10', title, (ctx) =>
        check(ctx, `bg.ledger.spec-fault.${id}`),
      ),
    );
  add(
    'changed-fact-is-listed',
    'a ledger_add that gives a held fact another value is listed in ledgerCheck and fails nothing',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const code = word(ctx.seed, `${tag}:code`, 8);
      const sc = scenario(
        ctx.seed,
        tag,
        [{ plan: { text: `Fine ${code}.` }, expect: { must: [code], ledger_add: { [n.fact]: n.wrong } } }],
        { given: { ledger: { [n.fact]: n.right } } },
      );
      const { rec } = await play(ctx, sc);
      const block = rec.blocks[0] as unknown as { ledgerCheck?: unknown; pass: boolean };
      return first([
        !JSON.stringify(block.ledgerCheck ?? {}).includes(n.fact) &&
          say(D, 'ledgerCheck lists the changed fact', JSON.stringify(block.ledgerCheck)),
        !block.pass &&
          say(
            D,
            'the block passes: a spec fault fails nothing',
            `pass ${block.pass}; ${show(driftOfBlock(rec.blocks[0]))}`,
          ),
        ledgerVerdicts(rec.blocks[0]).some((v) => v.outcome === 'fail') &&
          say(D, 'no failing ledger verdict', show(ledgerVerdicts(rec.blocks[0]))),
      ]);
    },
  );
  add(
    'same-value-is-not-listed',
    'a ledger_add that repeats the held value is not listed',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const code = word(ctx.seed, `${tag}:code`, 8);
      const sc = scenario(
        ctx.seed,
        tag,
        [{ plan: { text: `Fine ${code}.` }, expect: { must: [code], ledger_add: { [n.fact]: n.right } } }],
        { given: { ledger: { [n.fact]: n.right } } },
      );
      const { rec } = await play(ctx, sc);
      const block = rec.blocks[0] as unknown as { ledgerCheck?: unknown };
      return JSON.stringify(block.ledgerCheck ?? {}).includes(n.fact)
        ? fail(say(D, 'a repeated value is not a change', JSON.stringify(block.ledgerCheck)))
        : PASS;
    },
  );
  add(
    'new-fact-is-not-listed',
    'a ledger_add of a fact the ledger does not hold is not a change',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const m = names(ctx, `${tag}:m`);
      const code = word(ctx.seed, `${tag}:code`, 8);
      const sc = scenario(
        ctx.seed,
        tag,
        [{ plan: { text: `Fine ${code}.` }, expect: { must: [code], ledger_add: { [m.fact]: m.wrong } } }],
        { given: { ledger: { [n.fact]: n.right } } },
      );
      const { rec } = await play(ctx, sc);
      const block = rec.blocks[0] as unknown as { ledgerCheck?: unknown };
      return JSON.stringify(block.ledgerCheck ?? {}).includes(m.fact)
        ? fail(say(D, 'a new fact is not a change', JSON.stringify(block.ledgerCheck)))
        : PASS;
    },
  );
  add(
    'a-change-in-a-later-block-is-listed-there',
    'a ledger_add that changes a fact an earlier block added is listed in the block that changes it',
    async (ctx, tag) => {
      const n = names(ctx, tag);
      const codes = [0, 1, 2].map((i) => word(ctx.seed, `${tag}:code${i}`, 8));
      const sc = scenario(
        ctx.seed,
        tag,
        [
          {
            plan: { text: codes[0] as string },
            expect: { must: [codes[0]], ledger_add: { [n.fact]: n.right } },
          },
          {
            plan: { text: codes[1] as string },
            expect: { must: [codes[1]], ledger_add: { [n.fact]: n.wrong } },
          },
          { plan: { text: codes[2] as string }, expect: { must: [codes[2]] } },
        ],
        {},
      );
      const { rec } = await play(ctx, sc);
      const lists = rec.blocks.map((block) =>
        JSON.stringify((block as unknown as { ledgerCheck?: unknown }).ledgerCheck ?? {}).includes(n.fact),
      );
      return lists.join() === 'false,true,false'
        ? PASS
        : fail(say(D, 'only block 1 lists the fact', show(lists)));
    },
  );
  return out;
}

export function ledgerItems(): BankItem[] {
  return [
    ...keyItems(),
    ...nestedItems(),
    ...valueItems(),
    ...phoneItems(),
    ...scalarOnlyItems(),
    ...verdictItems(),
    ...addItems(),
    ...replyItems(),
    ...changeItems(),
  ];
}

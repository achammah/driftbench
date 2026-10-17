import { load, loadIssues, type RawSpec } from '../blocks/harness';
import { need } from '../blocks/product';
import {
  anchor,
  type BankItem,
  blocks,
  call,
  expectAll,
  type ItemContext,
  type ItemResult,
  item,
  list,
  PASS,
  play,
  say,
  scenario,
  show,
  verdictOf,
  word,
} from './kit';

/**
 * bk-loader: spec validation, lint and verdict stamps (breaker-items.md, family bk-loader). Each refusal item
 * writes the bad spec and the valid near-miss twin: a loader that refuses by the shape of a key refuses the
 * twin, one that accepts anything accepts the bad one.
 */

const FAMILY = 'bk-loader';
const LOADER = 'packages/core (loader)';
const D_PERT = 'docs/concepts/recovery.md "Writing a perturbation"';
const D_SPEC = 'docs/reference/spec.md';

type Issue = { ok: boolean; codes: string[] };

/** A plain spec of n blocks, each with a user text and a `must`, with `extra` keys at the top. */
function base(ctx: ItemContext, tag: string, n = 3, extra: Record<string, unknown> = {}): RawSpec {
  const defs = blocks(ctx.seed, tag, n);
  const sc = scenario(ctx.seed, tag, defs, extra);
  return sc.raw;
}

const withPerturbation = (raw: RawSpec, perturbation: Record<string, unknown>): RawSpec => ({
  ...raw,
  perturbations: [perturbation],
});
const stageSpec = (raw: RawSpec, stages: string[]): RawSpec => ({ ...raw, stages });

/** The bad specs are refused (with the code when one is named), and every twin loads. */
function verdictOnSpecs(
  ctx: ItemContext,
  refused: { name: string; raw: unknown; code?: string }[],
  twins: { name: string; raw: unknown }[],
): ItemResult {
  const checks: [boolean, string][] = [];
  for (const each of refused) {
    const answer: Issue = loadIssues(ctx.product, each.raw);
    const hasCode = each.code === undefined || answer.codes.includes(each.code);
    checks.push([
      !answer.ok && hasCode,
      say(
        D_SPEC,
        `${each.name} should be refused${each.code ? ` with ${each.code}` : ''}`,
        answer.ok ? 'the spec loaded' : `refused with ${list(answer.codes)}`,
      ),
    ]);
  }
  for (const each of twins) {
    const answer: Issue = loadIssues(ctx.product, each.raw);
    checks.push([answer.ok, say(D_SPEC, `${each.name} should load`, `refused with ${list(answer.codes)}`)]);
  }
  return expectAll(checks);
}

/** The baseline run first, then the loader check. */
async function anchored(ctx: ItemContext, check: () => ItemResult): Promise<ItemResult> {
  const base = await anchor(ctx);
  return base.pass ? check() : base;
}

function perturbationItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6',
    title: string,
    check: (ctx: ItemContext, tag: string) => ItemResult,
  ) => {
    const full = `bk.loader.${id}`;
    out.push(
      item(FAMILY, full, tier, 1, LOADER, cause, title, async (ctx) => anchored(ctx, () => check(ctx, full))),
    );
  };
  const user = (ctx: ItemContext, tag: string) => word(ctx.seed, `${tag}:user`, 9);
  const pid = (ctx: ItemContext, tag: string, i = 0) => word(ctx.seed, `${tag}:pid${i}`, 6);

  add(
    'perturbation.inject-at-beyond-last',
    3,
    'L1',
    'inject_at equal to the number of blocks loads; a larger value and a negative one are refused',
    (ctx, tag) => {
      const raw = base(ctx, tag, 3);
      const at = (inject_at: number) =>
        withPerturbation(raw, { id: pid(ctx, tag), class: 'D1_off_topic', inject_at, user: user(ctx, tag) });
      return verdictOnSpecs(
        ctx,
        [
          { name: 'inject_at 4 of 3 blocks', raw: at(4) },
          { name: 'inject_at -1', raw: at(-1) },
        ],
        [
          { name: 'inject_at 3 of 3 blocks', raw: at(3) },
          { name: 'inject_at 0', raw: at(0) },
        ],
      );
    },
  );

  add(
    'perturbation.world-only-at-the-end',
    4,
    'L2',
    'a world-only perturbation needs a block at inject_at: the block count is refused, a user perturbation there loads',
    (ctx, tag) => {
      const raw = base(ctx, tag, 3);
      const world = { tools: { [word(ctx.seed, `${tag}:t`)]: { error: 'down' } } };
      const worldAt = (inject_at: number) =>
        withPerturbation(raw, { id: pid(ctx, tag), class: 'D8_tool_failure', inject_at, world });
      return verdictOnSpecs(
        ctx,
        [{ name: 'a world-only perturbation at 3 of 3 blocks', raw: worldAt(3) }],
        [
          { name: 'a world-only perturbation at 2', raw: worldAt(2) },
          {
            name: 'a user perturbation at 3',
            raw: withPerturbation(raw, {
              id: pid(ctx, tag),
              class: 'D1_off_topic',
              inject_at: 3,
              user: user(ctx, tag),
            }),
          },
        ],
      );
    },
  );

  add(
    'perturbation.nothing-to-inject',
    3,
    'L3',
    'a perturbation with no user, burst or world is refused; each of the three alone loads',
    (ctx, tag) => {
      const raw = base(ctx, tag, 3);
      const mk = (extra: Record<string, unknown>) =>
        withPerturbation(raw, { id: pid(ctx, tag), class: 'D1_off_topic', inject_at: 1, ...extra });
      return verdictOnSpecs(
        ctx,
        [{ name: 'a perturbation with nothing to inject', raw: mk({}) }],
        [
          { name: 'user alone', raw: mk({ user: user(ctx, tag) }) },
          { name: 'burst alone', raw: mk({ burst: [user(ctx, tag), word(ctx.seed, `${tag}:b2`, 9)] }) },
          {
            name: 'world alone',
            raw: mk({ world: { tools: { [word(ctx.seed, `${tag}:t`)]: { error: 'down' } } } }),
          },
        ],
      );
    },
  );

  add(
    'perturbation.burst-of-one',
    3,
    'L4',
    'a perturbation burst of one message is refused, of two loads',
    (ctx, tag) => {
      const raw = base(ctx, tag, 3);
      const mk = (burst: string[]) =>
        withPerturbation(raw, { id: pid(ctx, tag), class: 'D7_silence_or_burst', inject_at: 1, burst });
      return verdictOnSpecs(
        ctx,
        [{ name: 'a burst of one', raw: mk([user(ctx, tag)]) }],
        [{ name: 'a burst of two', raw: mk([user(ctx, tag), word(ctx.seed, `${tag}:b2`, 9)]) }],
      );
    },
  );

  add(
    'perturbation.ids-unique',
    3,
    'L5',
    'two perturbations with one id are refused, distinct ids load',
    (ctx, tag) => {
      const raw = base(ctx, tag, 3);
      const one = (i: number, id: string) => ({
        id,
        class: 'D1_off_topic',
        inject_at: i,
        user: word(ctx.seed, `${tag}:u${i}`, 9),
      });
      return verdictOnSpecs(
        ctx,
        [
          {
            name: 'a repeated perturbation id',
            raw: { ...raw, perturbations: [one(1, pid(ctx, tag)), one(2, pid(ctx, tag))] },
          },
        ],
        [
          {
            name: 'two distinct ids',
            raw: { ...raw, perturbations: [one(1, pid(ctx, tag)), one(2, pid(ctx, tag, 1))] },
          },
        ],
      );
    },
  );

  add('block.ids-unique', 3, 'L6', 'two blocks with one id are refused, distinct ids load', (ctx, tag) => {
    const raw = base(ctx, tag, 3);
    const first = (raw.blocks[0] as { id: string }).id;
    const dup = { ...raw, blocks: raw.blocks.map((block, i) => (i === 2 ? { ...block, id: first } : block)) };
    return verdictOnSpecs(
      ctx,
      [{ name: 'a repeated block id', raw: dup }],
      [{ name: 'distinct block ids', raw }],
    );
  });
  return out;
}

function retentionItems(): BankItem[] {
  const out: BankItem[] = [];
  const spec = (
    ctx: ItemContext,
    tag: string,
    blocksOf: (b: Record<string, unknown>[]) => Record<string, unknown>[],
    top: Record<string, unknown> = {},
  ) => {
    const raw = base(ctx, tag, 3, top);
    return { ...raw, blocks: blocksOf(raw.blocks as Record<string, unknown>[]) } as RawSpec;
  };
  const retention = (f: string) => ({ knowledge_retention: [{ fact: f }] });
  const patch = (block: Record<string, unknown> | undefined, expect: Record<string, unknown>) => ({
    ...(block ?? {}),
    expect: { ...((block?.expect as Record<string, unknown>) ?? {}), ...expect },
  });
  const f = (ctx: ItemContext, tag: string) => word(ctx.seed, `${tag}:fact`, 7);

  out.push(
    item(
      FAMILY,
      'bk.loader.retention.fact-added-by-the-same-block',
      4,
      1,
      LOADER,
      'L7',
      'a retention check on a fact the same block adds is refused: no ledger holds it before the block',
      async (ctx) =>
        anchored(ctx, () => {
          const tag = 'bk.loader.retention.fact-added-by-the-same-block';
          const fact = f(ctx, tag);
          const bad = spec(ctx, tag, (b) =>
            b.map((block, i) =>
              i === 1 ? patch(block, { ledger_add: { [fact]: 'v' }, ...retention(fact) }) : block,
            ),
          );
          const good = spec(ctx, tag, (b) =>
            b.map((block, i) =>
              i === 0
                ? patch(block, { ledger_add: { [fact]: 'v' } })
                : i === 1
                  ? patch(block, retention(fact))
                  : block,
            ),
          );
          return verdictOnSpecs(
            ctx,
            [
              {
                name: 'a retention check on a fact the same block adds',
                raw: bad,
                code: 'RETENTION_FACT_UNKNOWN',
              },
            ],
            [{ name: 'the fact added by the block before', raw: good }],
          );
        }),
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.loader.retention.fact-added-by-a-later-block',
      4,
      1,
      LOADER,
      'L8',
      'a retention check on a fact only a later block adds is refused',
      async (ctx) =>
        anchored(ctx, () => {
          const tag = 'bk.loader.retention.fact-added-by-a-later-block';
          const fact = f(ctx, tag);
          const bad = spec(ctx, tag, (b) =>
            b.map((block, i) =>
              i === 1
                ? patch(block, retention(fact))
                : i === 2
                  ? patch(block, { ledger_add: { [fact]: 'v' } })
                  : block,
            ),
          );
          const good = spec(ctx, tag, (b) =>
            b.map((block, i) =>
              i === 0
                ? patch(block, { ledger_add: { [fact]: 'v' } })
                : i === 1
                  ? patch(block, retention(fact))
                  : block,
            ),
          );
          return verdictOnSpecs(
            ctx,
            [
              {
                name: 'a retention check on a fact a later block adds',
                raw: bad,
                code: 'RETENTION_FACT_UNKNOWN',
              },
            ],
            [{ name: 'the fact added by an earlier block', raw: good }],
          );
        }),
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.loader.retention.fact-held-before',
      4,
      1,
      LOADER,
      'L9',
      'a retention check on a fact the spec ledger, an earlier block ledger or an earlier ledger_add holds loads',
      async (ctx) =>
        anchored(ctx, () => {
          const tag = 'bk.loader.retention.fact-held-before';
          const fact = f(ctx, tag);
          const fromSpec = spec(
            ctx,
            tag,
            (b) => b.map((block, i) => (i === 1 ? patch(block, retention(fact)) : block)),
            { given: { ledger: { [fact]: 'v' } } },
          );
          const fromBlock = spec(ctx, tag, (b) =>
            b.map((block, i) =>
              i === 0
                ? { ...block, given: { ledger: { [fact]: 'v' } } }
                : i === 2
                  ? patch(block, retention(fact))
                  : block,
            ),
          );
          const fromAdd = spec(ctx, tag, (b) =>
            b.map((block, i) =>
              i === 0
                ? patch(block, { ledger_add: { [fact]: 'v' } })
                : i === 2
                  ? patch(block, retention(fact))
                  : block,
            ),
          );
          return verdictOnSpecs(
            ctx,
            [],
            [
              { name: 'a fact of the spec ledger', raw: fromSpec },
              { name: 'a fact of an earlier block ledger', raw: fromBlock },
              { name: 'a fact an earlier block adds', raw: fromAdd },
            ],
          );
        }),
    ),
  );
  return out;
}

function fieldItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4 | 5,
    cause:
      | 'L10'
      | 'L11'
      | 'L13'
      | 'L14'
      | 'L15'
      | 'L16'
      | 'L17'
      | 'L18'
      | 'L19'
      | 'L20'
      | 'L21'
      | 'L22'
      | 'L23'
      | 'L24'
      | 'L25'
      | 'L26'
      | 'L27'
      | 'L29',
    title: string,
    check: (ctx: ItemContext, tag: string) => ItemResult,
  ) => {
    const full = `bk.loader.${id}`;
    out.push(
      item(FAMILY, full, tier, 1, LOADER, cause, title, async (ctx) => anchored(ctx, () => check(ctx, full))),
    );
  };
  const patchBlock = (
    raw: RawSpec,
    at: number,
    change: (block: Record<string, unknown>) => Record<string, unknown>,
  ): RawSpec => ({
    ...raw,
    blocks: raw.blocks.map((block, i) => (i === at ? change(block as Record<string, unknown>) : block)),
  });
  const withExpect = (raw: RawSpec, at: number, expect: Record<string, unknown>) =>
    patchBlock(raw, at, (block) => ({
      ...block,
      expect: { ...(block.expect as Record<string, unknown>), ...expect },
    }));

  add(
    'rules.forbidden-tool-expected',
    4,
    'L10',
    'a block that expects a tool the rules forbid is refused (TOOL_FORBIDDEN_EXPECTED), by forbidden_tools or by a cap of 0; expecting it zero times loads',
    (ctx, tag) => {
      const t = word(ctx.seed, `${tag}:tool`);
      const raw = base(ctx, tag, 2);
      const expecting = (count: number) => withExpect(raw, 0, { tools: [{ label: t, count }] });
      return verdictOnSpecs(
        ctx,
        [
          {
            name: 'a forbidden tool expected once',
            raw: { ...expecting(1), rules: { forbidden_tools: [t] } },
            code: 'TOOL_FORBIDDEN_EXPECTED',
          },
          {
            name: 'a tool capped at 0 expected once',
            raw: { ...expecting(1), rules: { max_calls: { [t]: 0 } } },
            code: 'TOOL_FORBIDDEN_EXPECTED',
          },
        ],
        [
          {
            name: 'a forbidden tool expected zero times',
            raw: { ...expecting(0), rules: { forbidden_tools: [t] } },
          },
          { name: 'a tool expected once under no rule', raw: expecting(1) },
        ],
      );
    },
  );

  add(
    'stage.unknown-in-a-perturbation',
    4,
    'L11',
    'a stage a perturbation names (stage_after, expect.stage) must be declared in stages',
    (ctx, tag) => {
      const [s1, s2, other] = ['s1', 's2', 'other'].map((k) => word(ctx.seed, `${tag}:${k}`, 6));
      const raw = stageSpec(base(ctx, tag, 3), [s1 as string, s2 as string]);
      const mk = (extra: Record<string, unknown>) =>
        withPerturbation(raw, {
          id: word(ctx.seed, `${tag}:pid`, 6),
          class: 'D1_off_topic',
          inject_at: 1,
          user: word(ctx.seed, `${tag}:u`, 9),
          ...extra,
        });
      return verdictOnSpecs(
        ctx,
        [
          {
            name: 'stage_after outside the stages',
            raw: mk({ recovery: { within_blocks: 1, stage_after: other } }),
            code: 'STAGE_UNKNOWN',
          },
          {
            name: 'expect.stage outside the stages',
            raw: mk({ expect: { stage: other }, recovery: { within_blocks: 1 } }),
            code: 'STAGE_UNKNOWN',
          },
        ],
        [
          {
            name: 'declared stages',
            raw: mk({ expect: { stage: s1 }, recovery: { within_blocks: 1, stage_after: s2 } }),
          },
        ],
      );
    },
  );

  out.push(
    item(
      FAMILY,
      'bk.loader.lint.perturbation-without-recovery',
      3,
      1,
      LOADER,
      'L12',
      'the lint warns PERTURBATION_NO_RECOVERY for a perturbation without recovery and not for one with it',
      async (ctx) => {
        const tag = 'bk.loader.lint.perturbation-without-recovery';
        const raw = base(ctx, tag, 3);
        const mk = (recovery: boolean) =>
          load(
            ctx.product,
            withPerturbation(raw, {
              id: word(ctx.seed, `${tag}:pid`, 6),
              class: 'D1_off_topic',
              inject_at: 1,
              user: word(ctx.seed, `${tag}:u`, 9),
              ...(recovery ? { recovery: { within_blocks: 1 } } : {}),
            }),
          );
        const lintSpec = need<(spec: unknown) => { code: string; path: string }[]>(
          ctx.product.core,
          'core',
          'lintSpec',
        );
        const codes = (recovery: boolean) => lintSpec(mk(recovery)).map((issue) => issue.code);
        const without = codes(false);
        const withIt = codes(true);
        return expectAll([
          [
            without.includes('PERTURBATION_NO_RECOVERY'),
            say(D_PERT, 'the lint warns without recovery', show(without)),
          ],
          [
            !withIt.includes('PERTURBATION_NO_RECOVERY'),
            say(D_PERT, 'the lint is quiet with recovery', show(withIt)),
          ],
        ]);
      },
    ),
  );

  add(
    'budget.zero-limits',
    4,
    'L13',
    'a budget may set cost_usd and latency_ms to 0 and must set steps to at least 1',
    (ctx, tag) => {
      const raw = base(ctx, tag, 2);
      const budget = (value: Record<string, unknown>) =>
        patchBlock(raw, 0, (block) => ({ ...block, budget: value }));
      return verdictOnSpecs(
        ctx,
        [{ name: 'steps 0', raw: budget({ steps: 0 }) }],
        [
          { name: 'cost_usd 0', raw: budget({ cost_usd: 0 }) },
          { name: 'latency_ms 0', raw: budget({ latency_ms: 0 }) },
          { name: 'steps 1', raw: budget({ steps: 1 }) },
        ],
      );
    },
  );

  add('end.at-block-bounds', 3, 'L14', 'end.atBlock may be -1 and not less', (ctx, tag) => {
    const raw = base(ctx, tag, 3);
    const end = (atBlock: number) => ({ ...raw, end: { verdict: 'success', atBlock } });
    return verdictOnSpecs(
      ctx,
      [{ name: 'atBlock -2', raw: end(-2) }],
      [
        { name: 'atBlock -1', raw: end(-1) },
        { name: 'atBlock 1', raw: end(1) },
      ],
    );
  });

  add('counts.negative', 3, 'L15', 'a call cap and a tool count are not negative', (ctx, tag) => {
    const t = word(ctx.seed, `${tag}:tool`);
    const raw = base(ctx, tag, 2);
    return verdictOnSpecs(
      ctx,
      [
        { name: 'max_calls -1', raw: { ...raw, rules: { max_calls: { [t]: -1 } } } },
        { name: 'a tool count of -1', raw: withExpect(raw, 0, { tools: [{ label: t, count: -1 }] }) },
      ],
      [
        { name: 'max_calls 0', raw: { ...raw, rules: { max_calls: { [t]: 0 } } } },
        { name: 'a tool count of 0', raw: withExpect(raw, 0, { tools: [{ label: t, count: 0 }] }) },
      ],
    );
  });

  add('order.tool-order-enum', 3, 'L16', 'tool_order is exact, in_order or any_order', (ctx, tag) => {
    const t = word(ctx.seed, `${tag}:tool`);
    const raw = base(ctx, tag, 2);
    const order = (value: string) =>
      withExpect(raw, 0, { tools: [{ label: t, count: 1 }], tool_order: value });
    return verdictOnSpecs(
      ctx,
      [
        { name: 'tool_order sorted', raw: order('sorted') },
        { name: 'tool_order in-order', raw: order('in-order') },
      ],
      ['exact', 'in_order', 'any_order'].map((value) => ({ name: `tool_order ${value}`, raw: order(value) })),
    );
  });

  const CLASSES = [
    'D1_off_topic',
    'D2_goal_shift',
    'D3_contradiction',
    'D4_loose_confirmation',
    'D5_language_switch',
    'D6_instruction_in_data',
    'D7_silence_or_burst',
    'D8_tool_failure',
    'D9_out_of_scope',
    'D10_return',
    'D11_pii_leak',
    'D12_prompt_extraction',
  ];
  add(
    'stimulus.injection-class-enum',
    4,
    'L17',
    'a block injection takes one of the twelve deviation classes',
    (ctx, tag) => {
      const raw = base(ctx, tag, 2);
      const inject = (klass: string) =>
        patchBlock(raw, 1, (block) => {
          const { user: _user, ...rest } = block;
          return { ...rest, when: { injection: { class: klass, user: word(ctx.seed, `${tag}:u`, 9) } } };
        });
      return verdictOnSpecs(
        ctx,
        [{ name: 'class D13_other', raw: inject('D13_other') }],
        CLASSES.map((klass) => ({ name: `class ${klass}`, raw: inject(klass) })),
      );
    },
  );

  add(
    'perturbation.class-enum',
    4,
    'L18',
    'a perturbation takes one of the twelve deviation classes',
    (ctx, tag) => {
      const raw = base(ctx, tag, 2);
      const mk = (klass: string) =>
        withPerturbation(raw, {
          id: word(ctx.seed, `${tag}:pid`, 6),
          class: klass,
          inject_at: 1,
          user: word(ctx.seed, `${tag}:u`, 9),
        });
      return verdictOnSpecs(
        ctx,
        [{ name: 'class D0_other', raw: mk('D0_other') }],
        CLASSES.map((klass) => ({ name: `class ${klass}`, raw: mk(klass) })),
      );
    },
  );

  add('fields.lang-length', 3, 'L19', 'lang is 2 to 8 characters', (ctx, tag) => {
    const raw = base(ctx, tag, 2);
    const lang = (value: string) => ({ ...raw, lang: value });
    return verdictOnSpecs(
      ctx,
      [
        { name: 'lang of 1 character', raw: lang('E') },
        { name: 'lang of 9 characters', raw: lang('abcdefghi') },
      ],
      [
        { name: 'lang of 2', raw: lang('EN') },
        { name: 'lang of 8', raw: lang('abcdefgh') },
      ],
    );
  });

  add(
    'fields.spec-id-pattern',
    3,
    'L20',
    'a spec id starts with a letter or digit and holds letters, digits, dots, underscores and hyphens',
    (ctx, tag) => {
      const raw = base(ctx, tag, 2);
      const id = (value: string) => ({ ...raw, id: value });
      return verdictOnSpecs(
        ctx,
        ['-a', '.a', 'a b', ''].map((value) => ({ name: `id "${value}"`, raw: id(value) })),
        ['a', 'a.b-c_d', '9x'].map((value) => ({ name: `id "${value}"`, raw: id(value) })),
      );
    },
  );

  add('fields.schema-version', 3, 'L21', 'schema_version is 1', (ctx, tag) => {
    const raw = base(ctx, tag, 2);
    const version = (value: number) => ({ ...raw, schema_version: value });
    return verdictOnSpecs(
      ctx,
      [
        { name: 'schema_version 0', raw: version(0) },
        { name: 'schema_version 2', raw: version(2) },
      ],
      [{ name: 'schema_version 1', raw: version(1) }],
    );
  });

  const bounds = (
    id: string,
    cause: 'L22' | 'L23' | 'L24' | 'L25',
    title: string,
    make: (raw: RawSpec, value: number) => unknown,
    good: number[],
    bad: number[],
  ) =>
    add(`bounds.${id}`, 3, cause, title, (ctx, tag) => {
      const raw = base(ctx, tag, 2);
      return verdictOnSpecs(
        ctx,
        bad.map((value) => ({ name: `${id} ${value}`, raw: make(raw, value) })),
        good.map((value) => ({ name: `${id} ${value}`, raw: make(raw, value) })),
      );
    });
  bounds(
    'tool-f1-min',
    'L22',
    'tool_f1.min is from 0 to 1',
    (raw, value) => withExpect(raw, 0, { tool_f1: { min: value } }),
    [0, 1],
    [-0.01, 1.01],
  );
  bounds(
    'criterion-repeat',
    'L23',
    'a criterion repeat is from 1 to 20',
    (raw, value) => ({ ...raw, criteria: [{ name: 'c1', rubric: 'Is it right?', repeat: value }] }),
    [1, 20],
    [0, 21],
  );
  bounds(
    'retry-max-attempts',
    'L24',
    'a target retry max_attempts is from 1 to 20',
    (raw, value) => ({ ...raw, target: { adapter: 'function', retry: { max_attempts: value } } }),
    [1, 20],
    [0, 21],
  );
  bounds(
    'criterion-threshold',
    'L25',
    'a criterion threshold is from 0 to 1',
    (raw, value) => ({
      ...raw,
      criteria: [
        { name: 'c1', rubric: 'Is it right?', items: [{ name: 'i1', rubric: 'Right.' }], threshold: value },
      ],
    }),
    [0, 1],
    [1.01],
  );
  const regexItem = (
    id: string,
    tier: 3 | 4 | 5,
    cause: 'L26' | 'L27' | 'L29',
    title: string,
    make: (raw: RawSpec, pattern: string) => unknown[],
  ) =>
    add(`regex.${id}`, tier, cause, title, (ctx, tag) => {
      const raw = base(ctx, tag, 2);
      const bad = make(raw, '(').map((each, i) => ({
        name: `an invalid pattern, form ${i + 1}`,
        raw: each,
        code: 'REGEX_INVALID',
      }));
      const good = make(raw, '^a+$').map((each, i) => ({
        name: `a valid pattern, form ${i + 1}`,
        raw: each,
      }));
      return verdictOnSpecs(ctx, bad, good);
    });
  regexItem(
    'expect-regex-list',
    3,
    'L26',
    'a pattern of the regex list of expect that does not compile is refused with REGEX_INVALID, as one of must is',
    (raw, pattern) => [withExpect(raw, 0, { regex: [pattern] })],
  );
  regexItem(
    'json-path-assertion',
    4,
    'L27',
    'a regex assertion of a json path that does not compile is refused with REGEX_INVALID',
    (raw, pattern) => [withExpect(raw, 0, { json: { paths: [{ path: 'a', assert: { regex: pattern } }] } })],
  );
  regexItem(
    'perturbation-expect-regex',
    4,
    'L29',
    'the patterns in the expectations of a perturbation (regex list, json path assertion) are checked like those of a block',
    (raw, pattern) => [
      withPerturbation(raw, {
        id: 'p',
        class: 'D1_off_topic',
        inject_at: 1,
        user: 'x',
        expect: { regex: [pattern] },
      }),
      withPerturbation(raw, {
        id: 'p',
        class: 'D1_off_topic',
        inject_at: 1,
        user: 'x',
        expect: { json: { paths: [{ path: 'a', assert: { regex: pattern } }] } },
      }),
    ],
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * Verdict stamps
 * ---------------------------------------------------------------------------------------------------- */

const D_STAMP = 'docs/reference/block-contracts.md "Verdict.by"';
type By = { object?: string; layer?: string };
const byOf = (block: Parameters<typeof verdictOf>[0], id: string): By | undefined =>
  (verdictOf(block, id) as { by?: By } | undefined)?.by;

/** n blocks that expect `must` and one tool call; `uses` goes on the spec or on the last block. */
async function stampRun(ctx: ItemContext, tag: string, uses: { spec?: unknown; last?: unknown }, n = 3) {
  const t = word(ctx.seed, `${tag}:tool`);
  const defs = blocks(
    ctx.seed,
    tag,
    n,
    Object.fromEntries(Array.from({ length: n }, (_, i) => [i, [call(t)]])),
  );
  for (const def of defs) (def.expect as Record<string, unknown>).tools = [{ label: t, count: 1 }];
  if (uses.last !== undefined)
    (defs[n - 1] as { extra?: Record<string, unknown> }).extra = { uses: { check_set: uses.last } };
  const sc = scenario(ctx.seed, tag, defs, uses.spec !== undefined ? { uses: { check_set: uses.spec } } : {});
  return (await play(ctx, sc, { mode: 'F' })).rec;
}

function stampItems(): BankItem[] {
  const out: BankItem[] = [];
  out.push(
    item(
      FAMILY,
      'bk.loader.stamps.untouched-block-keeps-the-shipped-stamp',
      4,
      3,
      LOADER,
      'ST1',
      'a block the tailoring does not reach keeps the shipped stamp: check-set:default@hash8, layer shipped',
      async (ctx) => {
        const tag = 'bk.loader.stamps.untouched-block-keeps-the-shipped-stamp';
        const rec = await stampRun(ctx, tag, {
          last: { extends: 'default', items: [{ id: 'must', enabled: false }] },
        });
        const stamps = [0, 1].map((i) => byOf(rec.blocks[i], 'must.0'));
        return expectAll([
          [
            stamps.every(
              (by) =>
                by !== undefined &&
                /^check-set:default@[0-9a-f]{8}$/.test(by.object ?? '') &&
                by.layer === 'shipped',
            ),
            say(D_STAMP, 'the untouched blocks carry check-set:default@<8 hex>, layer shipped', show(stamps)),
          ],
        ]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.loader.stamps.disabled-item-gives-no-verdict',
      4,
      3,
      LOADER,
      'ST2',
      'an item a tailored object disables gives no verdict on the blocks it reaches; the other items and the other blocks keep theirs',
      async (ctx) => {
        const tag = 'bk.loader.stamps.disabled-item-gives-no-verdict';
        const rec = await stampRun(ctx, tag, {
          last: { extends: 'default', items: [{ id: 'must', enabled: false }] },
        });
        const ids = (i: number) => rec.blocks[i]?.verdicts.map((v) => v.id) ?? [];
        const tools = (i: number) => ids(i).filter((id) => id.startsWith('tools.')).length;
        return expectAll([
          [
            ids(2).every((id) => !id.startsWith('must.')),
            say(
              'docs/reference/block-contracts.md "Items"',
              'the last block holds no must verdict',
              show(ids(2)),
            ),
          ],
          [
            tools(2) > 0,
            say(
              'docs/reference/block-contracts.md "Items"',
              'it still holds its tools verdicts',
              show(ids(2)),
            ),
          ],
          [
            [0, 1].every((i) => ids(i).includes('must.0')),
            say(
              'docs/reference/block-contracts.md "Items"',
              'the other blocks still hold must.0',
              show([ids(0), ids(1)]),
            ),
          ],
        ]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.loader.stamps.verdicts-follow-the-check-set-order',
      4,
      3,
      LOADER,
      'ST3',
      "a check set's order is the order of a block's verdicts: reversing it reverses must and tools",
      async (ctx) => {
        const tag = 'bk.loader.stamps.verdicts-follow-the-check-set-order';
        const set = need<{ items: { id: string }[]; order?: string[] }>(
          ctx.product.checks,
          'checks',
          'DEFAULT_CHECK_SET',
        );
        const shipped = set.order ? [...set.order] : set.items.map((entry) => entry.id);
        const plain = await stampRun(ctx, `${tag}:plain`, {});
        const reversed = await stampRun(ctx, `${tag}:reversed`, {
          spec: { extends: 'default', order: [...shipped].reverse() },
        });
        const first = (rec: typeof plain, prefix: string) =>
          (rec.blocks[0]?.verdicts ?? []).findIndex((v) => v.id.startsWith(prefix));
        return expectAll([
          [
            first(plain, 'tools.') < first(plain, 'must.'),
            say(
              'docs/reference/block-contracts.md "Items"',
              'with the shipped order the tools verdicts come before the must verdicts',
              show([first(plain, 'tools.'), first(plain, 'must.')]),
            ),
          ],
          [
            first(reversed, 'must.') < first(reversed, 'tools.'),
            say(
              'docs/reference/block-contracts.md "Items"',
              'with the order reversed the must verdicts come first',
              show([first(reversed, 'must.'), first(reversed, 'tools.')]),
            ),
          ],
        ]);
      },
    ),
  );
  const move = (before: string) => ({ extends: 'default', items: [{ id: 'must', before }] });
  out.push(
    item(
      FAMILY,
      'bk.loader.stamps.same-content-same-hash',
      5,
      3,
      LOADER,
      'ST4',
      'two specs with different ids carrying the same override stamp the moved item with the same object name and hash',
      async (ctx) => {
        const tag = 'bk.loader.stamps.same-content-same-hash';
        const a = await stampRun(ctx, `${tag}:a`, { spec: move('tools') });
        const b = await stampRun(ctx, `${tag}:b`, { spec: move('tools') });
        const sa = byOf(a.blocks[0], 'must.0')?.object;
        const sb = byOf(b.blocks[0], 'must.0')?.object;
        return expectAll([
          [
            sa !== undefined && /@[0-9a-f]{8}$/.test(sa),
            say(D_STAMP, 'the verdict names an object with an 8 hex hash', show(sa)),
          ],
          [
            sa === sb,
            say(
              'docs/reference/block-contracts.md "Content hash"',
              'the same override gives the same object name and hash whatever the spec id',
              show([sa, sb]),
            ),
          ],
        ]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.loader.stamps.other-content-other-hash',
      5,
      3,
      LOADER,
      'ST4',
      'an override that moves the item to another place stamps another hash',
      async (ctx) => {
        const tag = 'bk.loader.stamps.other-content-other-hash';
        const a = await stampRun(ctx, `${tag}:a`, { spec: move('tools') });
        const c = await stampRun(ctx, `${tag}:c`, { spec: move('forbidden') });
        const sa = byOf(a.blocks[0], 'must.0')?.object;
        const sc = byOf(c.blocks[0], 'must.0')?.object;
        return expectAll([
          [
            sa !== undefined && sc !== undefined,
            say(D_STAMP, 'both verdicts name an object', show([sa, sc])),
          ],
          [
            sa !== sc,
            say(
              'docs/reference/block-contracts.md "Content hash"',
              'another item order is another object content, so another hash',
              show([sa, sc]),
            ),
          ],
        ]);
      },
    ),
  );
  return out;
}

/** Items of the family bk-loader: 30. */
export function loaderItems(): BankItem[] {
  return [...perturbationItems(), ...retentionItems(), ...fieldItems(), ...stampItems()];
}

void PASS;

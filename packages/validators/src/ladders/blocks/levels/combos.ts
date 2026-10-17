import { between, list, type RawSpec, type Rng, rngFor, run } from '../harness';
import { type Action, KINDS, type Kind, plantedAgent } from '../kinds';
import type { BlocksProduct } from '../product';
import { BASIC, recipe } from '../recipe';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Pairwise combinations on level 1 (docs/validators.md section 12.2, combination): two planted faults in one
 * block, each breaking a different check. The checks of a block are judged apart, so the failing verdicts with
 * both faults are exactly the union of those with each fault alone, the block's other verdicts and every other
 * block stay as they were, and neither fault alone leaves the run clean. The earlier fault of a pair is applied
 * last, so an exit code planted on the last command stays the last command's. The item finds each fault's verdicts by
 * running it alone, so it holds no verdict id of its own.
 */

const CHECKS = 'packages/checks/src/checks/index.ts';

type Fault = {
  id: string;
  /** What the block expects beside the recipe's expectations, so the fault has a check to break. */
  expect?: Record<string, unknown>;
  apply(action: Action, at: { block: unknown; rng: Rng }): Action;
};

const FAULTS: Record<Kind, Fault[]> = {
  normal: [
    // Order-free faults: each touches only its own part of the action, so composing them in either order is the same.
    {
      id: 'reply',
      apply: (action) => ({
        ...action,
        reply: action.reply.replace(/hold code is \S+/, 'hold code is pending.'),
      }),
    },
    {
      id: 'tool-count',
      apply: (action) => ({ ...action, calls: [...(action.calls ?? []), ...(action.calls ?? [])] }),
    },
    {
      id: 'forbidden-phrase',
      expect: { must_not: ['refund'] },
      apply: (action) => ({ ...action, reply: `${action.reply} I can also refund the deposit.` }),
    },
  ],
  code: [
    // The recipe's own off-by-one: the planted value plus one, in whatever format the block writes.
    {
      id: 'file-content',
      apply: (action, at) => {
        const shifted = BASIC.code.apply(action, at.block as never, at.rng).files?.[0];
        return {
          ...action,
          files: (action.files ?? []).map((file) => (shifted && file.path === shifted.path ? shifted : file)),
        };
      },
    },
    {
      id: 'stray-file',
      expect: { workspace: { others_untouched: true } },
      apply: (action) => ({
        ...action,
        files: [...(action.files ?? []), { path: 'scratch/stray.txt', format: 'txt', data: 'left behind\n' }],
      }),
    },
    {
      id: 'exit-code',
      apply: (action) => ({
        ...action,
        commands: [...(action.commands ?? []), { command: 'python check.py', exitCode: 1 }],
      }),
    },
    {
      id: 'command-limit',
      expect: { execution: { max_commands: 2 } },
      apply: (action) => ({
        ...action,
        commands: [
          ...(action.commands ?? []),
          { command: 'python a.py', exitCode: 0 },
          { command: 'python b.py', exitCode: 0 },
        ],
      }),
    },
  ],
};

/** Merges two expectation objects one level deep (execution and workspace are objects of their own). */
function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const before = out[key];
    out[key] =
      before &&
      typeof before === 'object' &&
      !Array.isArray(before) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
        ? { ...(before as object), ...(value as object) }
        : value;
  }
  return out;
}

type Verdicts = { id: string; outcome: string; gating?: boolean }[];

/** The failing verdicts of every block, as `block:verdict`, sorted. */
async function failing(
  product: BlocksProduct,
  scratch: string,
  raw: RawSpec,
  actions: Map<string, Action>,
  kind: Kind,
) {
  const agent = plantedAgent(product, kind, actions, { scratch });
  const record = await run(product, raw, agent.adapter);
  return record.blocks
    .flatMap((block) =>
      ((block as unknown as { verdicts?: Verdicts }).verdicts ?? [])
        .filter((v) => v.outcome === 'fail')
        .map((v) => `b${block.index}:${v.id}`),
    )
    .sort();
}

function pairItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of KINDS) {
    const faults = FAULTS[kind];
    for (const [i, a] of faults.entries()) {
      for (const b of faults.slice(i + 1)) {
        for (const at of kind === 'normal'
          ? (['first', 'middle', 'last', 'only'] as const)
          : (['first', 'last'] as const)) {
          const id = `combos/${kind}/${a.id}+${b.id}/${at}`;
          items.push({
            id,
            family: 'verdicts-combos',
            tier: (kind === 'code' ? 3 : 2) as Tier,
            level: 1,
            component: CHECKS,
            title: `a ${kind} block with two planted faults (${a.id.replace(/-/g, ' ')} and ${b.id.replace(/-/g, ' ')}, ${at} block of its spec) fails exactly the verdicts each fault fails alone, and no other block changes`,
            cause: `The ${a.id.replace(/-/g, ' ')} check and the ${b.id.replace(/-/g, ' ')} check of one block are judged apart: one failing never skips, fails or passes the other.`,
            check: async ({ seed, scratch, product }) => {
              const rng = rngFor(seed, id);
              const n = at === 'only' ? 1 : between(rng, 3, kind === 'code' ? 3 : 4);
              const r = recipe(
                seed,
                id,
                kind,
                Array.from({ length: n }, () => ({ fate: 'pass' as const })),
              );
              const x = at === 'first' || at === 'only' ? 0 : at === 'last' ? n - 1 : between(rng, 1, n - 2);
              const marker = r.blocks[x]?.marker as string;
              const extra = merge(a.expect ?? {}, b.expect ?? {});
              const raw: RawSpec = {
                ...r.raw,
                blocks: r.raw.blocks.map((block, index) =>
                  index === x
                    ? { ...block, expect: merge((block.expect as Record<string, unknown>) ?? {}, extra) }
                    : block,
                ),
              };
              const base = r.actions.get(marker) as Action;
              const ctx = { block: r.blocks[x], rng };
              const with_ = (apply: (action: Action) => Action) =>
                new Map([...r.actions, [marker, apply(base)]]);
              const clean = await failing(product, scratch, raw, new Map(r.actions), kind);
              const onlyA = await failing(
                product,
                scratch,
                raw,
                with_((action) => a.apply(action, ctx)),
                kind,
              );
              const onlyB = await failing(
                product,
                scratch,
                raw,
                with_((action) => b.apply(action, ctx)),
                kind,
              );
              const both = await failing(
                product,
                scratch,
                raw,
                with_((action) => a.apply(b.apply(action, ctx), ctx)),
                kind,
              );
              if (clean.length > 0)
                return fail(`the spec without a fault should fail no verdict; it failed ${list(clean)}`);
              if (onlyA.length === 0)
                return fail(`the ${a.id} fault alone should fail a verdict of block ${x}; none failed`);
              if (onlyB.length === 0)
                return fail(`the ${b.id} fault alone should fail a verdict of block ${x}; none failed`);
              const union = [...new Set([...onlyA, ...onlyB])].sort();
              const missed = union.filter((v) => !both.includes(v));
              const extraFails = both.filter((v) => !union.includes(v));
              const elsewhere = both.filter((v) => !v.startsWith(`b${x}:`));
              if (missed.length > 0 || extraFails.length > 0 || elsewhere.length > 0)
                return fail(
                  `with both faults, block ${x} should fail exactly ${list(union)} (each fault alone); got ${both.length === 0 ? 'none' : list(both)}${missed.length > 0 ? ` (missed ${list(missed)})` : ''}${extraFails.length > 0 ? ` (extra ${list(extraFails)})` : ''}`,
                );
              return PASS;
            },
          });
        }
      }
    }
  }
  return items;
}

export function comboItems(): BankItem[] {
  return pairItems();
}

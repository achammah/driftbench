import { type Call, load, type RunRecord, rngFor, scriptedAdapter } from '../../blocks/harness';
import { type BlocksProduct, need } from '../../blocks/product';
import { type BankItem, fail, type ItemContext, type ItemResult, PASS, type Tier } from '../../blocks/types';
import { type BlockDef, behaviour, scenario, word } from '../../blocks-breaker/kit';
import { CAUSES, type GrowthCause } from './causes';

/**
 * The scenario kit of the growth lane "checks": rows of one conversation (the reply, the tool calls and the extra
 * fields of the Observed a scripted agent returns, beside the block's expectations), a run through the product's
 * own runner with the checks the item chooses, and readers of the record. Every name the product reads is a seeded
 * word of letters: nothing it sees says what an item expects.
 */

export type { BankItem, Call, ItemContext, ItemResult, RunRecord, Tier };
export { PASS, scenario, word };

/** One block of a conversation: what the agent does and what the block expects. */
export type Row = {
  text?: string;
  calls?: Call[];
  /** Fields that replace fields of the Observed the agent returns (`runtime`, `executions`, `cost`, ...). */
  extra?: Record<string, unknown>;
  expect?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  given?: Record<string, unknown>;
  /** The words the user writes around the block's marker word. */
  say?: (marker: string) => string | [string, string];
};

export type Exec = {
  /** Keys added to the spec beside `blocks` (`rules`, `metadata`, `lang`, `end_state`). */
  spec?: Record<string, unknown>;
  mode?: 'F' | 'T';
  /** The checks the runner applies: the product's defaults when absent. */
  checks?: (product: BlocksProduct) => unknown;
  /** Options handed to the runner beside the usual ones (`toolPolicy`). */
  run?: Record<string, unknown>;
  /** Changes the loaded spec after the loader returned it (for a spec that reaches the checks unparsed). */
  mutate?: (spec: Record<string, unknown>) => void;
};

/** The record of one run of `rows` through the product's runner. */
export async function exec(
  ctx: ItemContext,
  tag: string,
  rows: Row[],
  options: Exec = {},
): Promise<RunRecord> {
  const defs: BlockDef[] = rows.map((row) => ({
    plan: { text: row.text ?? 'Done.', calls: row.calls ?? [], ...(row.extra ? { extra: row.extra } : {}) },
    ...(row.expect ? { expect: row.expect } : {}),
    ...(row.budget ? { budget: row.budget } : {}),
    ...(row.given ? { given: row.given } : {}),
    ...(row.say ? { say: row.say } : {}),
  }));
  const sc = scenario(ctx.seed, tag, defs, options.spec ?? {});
  const rng = rngFor(ctx.seed, `gr:${sc.raw.id}:agent`);
  const adapter = scriptedAdapter(ctx.product, behaviour(sc, rng));
  const spec = load(ctx.product, sc.raw);
  options.mutate?.(spec);
  return runSpecOf(ctx.product, spec, adapter, options);
}

/** A loaded spec through the product's runner with its scripted driver. */
export async function runSpecOf(
  product: BlocksProduct,
  spec: Record<string, unknown>,
  adapter: Record<string, unknown>,
  options: Exec = {},
): Promise<RunRecord> {
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    product.core,
    'core',
    'runSpec',
  );
  const createScriptedDriver = need<() => unknown>(product.users, 'users', 'createScriptedDriver');
  const defaultChecks = need<() => unknown>(product.checks, 'checks', 'defaultChecks');
  const defaultReaders = need<() => unknown>(product.artifacts, 'artifacts', 'defaultReaders');
  return runSpec(spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: options.checks ? options.checks(product) : defaultChecks(),
    artifacts: defaultReaders(),
    mode: options.mode ?? 'F',
    repeat: 0,
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    ...(options.run ?? {}),
  });
}

/** The checks of the product with options (`toolPolicy`, `embedder`, `piiOwner`), as `defaultChecks(options)`. */
export const withDefaults =
  (options: Record<string, unknown>) =>
  (product: BlocksProduct): unknown =>
    need<(options: Record<string, unknown>) => unknown>(product.checks, 'checks', 'defaultChecks')(options);

/** The default checks followed by checks of the item. */
export const withExtra =
  (extra: readonly unknown[]) =>
  (product: BlocksProduct): unknown => [
    ...(need<() => unknown[]>(product.checks, 'checks', 'defaultChecks')() as unknown[]),
    ...extra,
  ];

export type VerdictRow = {
  id: string;
  name?: string;
  outcome: string;
  gating: boolean;
  score?: number;
  evidence?: string;
};

export const verdictsOf = (rec: RunRecord, block: number): VerdictRow[] =>
  (rec.blocks[block]?.verdicts ?? []) as VerdictRow[];
export const verdict = (rec: RunRecord, block: number, id: string): VerdictRow | undefined =>
  verdictsOf(rec, block).find((each) => each.id === id);
export const idsAt = (rec: RunRecord, block: number): string[] =>
  verdictsOf(rec, block).map((each) => each.id);
export const idsLike = (rec: RunRecord, block: number, prefix: string): string[] =>
  idsAt(rec, block).filter(
    (id) => id === prefix || id.startsWith(`${prefix}.`) || id.startsWith(`${prefix}#`),
  );
export const passed = (rec: RunRecord, block: number): boolean => rec.blocks[block]?.pass === true;

/** `undefined` when the verdict is as expected, else what was found. */
export function expectV(
  rec: RunRecord,
  block: number,
  id: string,
  outcome: 'pass' | 'fail' | 'inconclusive',
  gating?: boolean,
): string | undefined {
  const found = verdict(rec, block, id);
  if (!found)
    return `block ${block}: no verdict ${id}; the block has ${
      idsAt(rec, block)
        .filter((each) => !each.startsWith('pii.'))
        .join(', ') || 'no other verdict'
    }`;
  if (found.outcome !== outcome)
    return `block ${block}: ${id} should be ${outcome}; it is ${found.outcome} (${String(found.evidence ?? '').slice(0, 90)})`;
  if (gating !== undefined && found.gating !== gating)
    return `block ${block}: ${id} should ${gating ? 'gate' : 'not gate'}; it ${found.gating ? 'gates' : 'does not gate'}`;
  return undefined;
}

/** `undefined` when the block has no verdict whose id is `id` or starts with `id.`. */
export function expectNone(rec: RunRecord, block: number, prefix: string): string | undefined {
  const found = idsLike(rec, block, prefix);
  return found.length === 0
    ? undefined
    : `block ${block}: no ${prefix} verdict should exist; found ${found.join(', ')}`;
}

export function expectPass(rec: RunRecord, block: number, should: boolean): string | undefined {
  return passed(rec, block) === should
    ? undefined
    : `block ${block} should ${should ? 'pass' : 'fail'}; it ${passed(rec, block) ? 'passes' : 'fails'} (failing: ${verdictsOf(
        rec,
        block,
      )
        .filter((each) => each.gating && each.outcome !== 'pass')
        .map((each) => each.id)
        .join(', ')})`;
}

export type Probe = (ctx: ItemContext) => Promise<ReadonlyArray<string | undefined | false>>;

/** An item of the lane: its cause gives its text and its contract. */
export function gitem(
  family: string,
  id: string,
  tier: Tier,
  component: string,
  cause: GrowthCause,
  title: string,
  probe: Probe,
): BankItem {
  const entry = CAUSES[cause];
  return {
    id,
    family,
    tier,
    level: 1,
    component,
    title,
    cause: entry.text,
    contract: entry.contract,
    check: async (ctx) => {
      try {
        const first = (await probe(ctx)).find((each): each is string => typeof each === 'string');
        return first === undefined
          ? PASS
          : fail(
              `${entry.text} (${entry.contract.replace('#', ' "')}"); the product answered: ${first}`.slice(
                0,
                700,
              ),
            );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('the loader refuses'))
          return fail(
            `a spec the docs define loads (${entry.contract}); the product answered: ${message.slice(0, 260)}`,
          );
        if (message.startsWith('the product has no export'))
          return fail(
            `the capability the docs define is exported (${entry.contract}); the product answered: ${message}`,
          );
        throw error;
      }
    },
  };
}

/** The items of one cause, from a table of variants: `[id, tier, title, probe]`. */
export function variants(
  family: string,
  prefix: string,
  component: string,
  cause: GrowthCause,
  table: ReadonlyArray<readonly [string, Tier, string, Probe]>,
): BankItem[] {
  return table.map(([id, tier, title, probe]) =>
    gitem(family, `${prefix}.${id}`, tier, component, cause, title, probe),
  );
}

/** A seeded token of letters only, unique to the item and the slot. */
export const tok = (ctx: ItemContext, tag: string, slot: string, length = 7): string =>
  word(ctx.seed, `gr:${tag}:${slot}`, length);

export const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
};

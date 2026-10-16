import { type Spec, specHash, validateSpec } from '@agent-nexus/driftbench-core';
import { type Interval, mulberry32, wilson } from '@agent-nexus/driftbench-stats';
import { z } from 'zod';
import { streamSeed } from '../seed/random';

/**
 * The sealed holdout (design section 4, check 9): a share of the gated specs that the agent's developers
 * never see and that runs only through `driftbench holdout score`, once per query, against a budget of
 * queries fixed at the first score. Every score spends one query; a spent budget refuses to score.
 *
 * The sealed specs are kept in one bundle, `sealed.json`, never as spec files: the spec loader reads
 * `*.yaml`, `*.yml` and `*.spec.json` only, so a campaign, a gate or a selection pointed at the sealed
 * folder finds no spec to run. Each spec carries its content hash, checked before every score.
 */

export const SEALED_FILE = 'sealed.json';
export const BUDGET_FILE = 'budget.json';

/**
 * The holdout draw of one spec, the rule the gate's freshness stage uses: the spec is sealed when the
 * first number of its random stream `holdout:<id>` under the seed is below the share. The same seed and
 * share seal the same specs as the gate.
 */
export function inHoldout(id: string, share: number, seed: number): boolean {
  return mulberry32(streamSeed(seed, `holdout:${id}`))() < share;
}

const SealedSpec = z.strictObject({
  id: z.string().min(1),
  /** Where the spec was read, relative to the folder sealed. */
  path: z.string().min(1),
  hash: z.string().min(1),
  spec: z.unknown(),
});

export const SealedBundle = z.strictObject({
  sealed: z.literal(true),
  note: z.string(),
  source: z.string(),
  /** `gate` when the gate's own split was taken as it is, `draw` when this seal drew the share. */
  split: z.enum(['gate', 'draw']),
  seed: z.number().int().min(0),
  share: z.number().min(0).max(1),
  /** The gate seals the split came from, relative to the folder sealed; empty for a draw. */
  gate_seals: z.array(z.string()),
  date: z.string(),
  specs: z.array(SealedSpec),
});
export type SealedBundle = z.infer<typeof SealedBundle>;

export const SEALED_NOTE =
  'Sealed holdout: run it only through driftbench holdout score, once per query, against the budget in budget.json. Do not copy these specs into a dev suite.';

const ScoreEntry = z.strictObject({
  query: z.number().int().min(1),
  date: z.string(),
  target: z.string(),
  state: z.enum(['started', 'scored']),
  conversations: z.number().int().min(0).optional(),
  passed: z.number().int().min(0).optional(),
  not_run: z.array(z.string()).optional(),
  rate: z.strictObject({ estimate: z.number(), low: z.number(), high: z.number() }).optional(),
});

export const Budget = z.strictObject({
  total: z.number().int().min(1),
  used: z.number().int().min(0),
  scores: z.array(ScoreEntry),
});
export type Budget = z.infer<typeof Budget>;
export type ScoreEntry = z.infer<typeof ScoreEntry>;

/** One spec of a bundle, read back and checked against its hash. */
export type OpenedSpec = { id: string; path: string; spec: Spec };

/**
 * Reads the specs of a bundle back. Every spec must be valid and hash to the value recorded when it was
 * sealed; a message names each one that does not.
 */
export function openBundle(bundle: SealedBundle): { specs: OpenedSpec[]; problems: string[] } {
  const specs: OpenedSpec[] = [];
  const problems: string[] = [];
  for (const entry of bundle.specs) {
    const result = validateSpec(entry.spec, entry.path);
    if (!result.ok) {
      problems.push(
        `${entry.id}: the sealed spec is no longer valid (${result.errors[0]?.message ?? 'invalid'})`,
      );
      continue;
    }
    if (result.spec.id !== entry.id) {
      problems.push(`${entry.id}: the sealed spec now has the id ${result.spec.id}`);
      continue;
    }
    if (specHash(result.spec) !== entry.hash) {
      problems.push(`${entry.id}: the content hash changed since it was sealed (${entry.hash})`);
      continue;
    }
    specs.push({ id: entry.id, path: entry.path, spec: result.spec });
  }
  return { specs, problems };
}

/** What a score may do with the budget it found, or why it must not run. */
export type BudgetDecision =
  | { ok: true; budget: Budget; query: number }
  | { ok: false; code: 1 | 2; message: string };

/**
 * Decides whether one more score may run. The first score fixes the budget (`requested` is then
 * required); a later one may restate it but never change it. A score that finds no query left is refused.
 * On success the returned budget already counts the query as used: a query is spent once it starts.
 */
export function spendQuery(
  found: Budget | undefined,
  requested: number | undefined,
  target: string,
  date: string,
): BudgetDecision {
  if (!found) {
    if (requested === undefined) {
      return {
        ok: false,
        code: 2,
        message: 'This holdout has never been scored: pass --budget <queries> to fix its query budget.',
      };
    }
    found = { total: requested, used: 0, scores: [] };
  } else if (requested !== undefined && requested !== found.total) {
    return {
      ok: false,
      code: 2,
      message: `The budget was fixed at ${found.total} queries by the first score; it cannot become ${requested}.`,
    };
  }
  if (found.used >= found.total) {
    return {
      ok: false,
      code: 1,
      message: `The query budget is spent: ${found.used} of ${found.total} queries used. The holdout is not scored again.`,
    };
  }
  const query = found.used + 1;
  return {
    ok: true,
    query,
    budget: {
      total: found.total,
      used: query,
      scores: [...found.scores, { query, date, target, state: 'started' }],
    },
  };
}

/** The pass rate of one score over its conversations, with the 95 percent Wilson interval. */
export function passRate(passed: number, conversations: number): Interval | undefined {
  return conversations === 0 ? undefined : wilson(passed, conversations);
}

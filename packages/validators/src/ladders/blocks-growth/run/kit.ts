import {
  type BankItem,
  fail,
  type ItemContext,
  type ItemResult,
  type Tier,
  withAnchor,
} from '../../blocks-breaker/kit';
import { CAUSES, type CauseKey } from './causes';

export {
  type AgentLog,
  anchor,
  type BankItem,
  type BlockDef,
  type BlockRecord,
  between,
  blockStatus,
  blocks,
  type Call,
  call,
  codeOf,
  expectAll,
  fail,
  failingIds,
  type ItemContext,
  type ItemResult,
  idsOf,
  injecting,
  lines,
  list,
  observedParts,
  outcomeOfId,
  PASS,
  type Plan,
  type Played,
  play,
  playP,
  type RawSpec,
  type RunRecord,
  runLoaded,
  runOutcome,
  type Scenario,
  same,
  say,
  scenario,
  show,
  type Tier,
  type Turn,
  times,
  verdictOf,
  word,
} from '../../blocks-breaker/kit';

/**
 * The kit of the growth bank for the run, drift and recovery pages (written from the documentation alone): the
 * breaker's scenario kit, and an `item` whose cause and contract come from this folder's own cause table.
 */

type Check = (ctx: ItemContext) => Promise<ItemResult>;

/** An item of this bank: its cause, tier, level and contract come from the cause key. Every item makes the baseline run first. */
export function gitem(
  family: string,
  id: string,
  tier: Tier,
  component: string,
  cause: CauseKey,
  title: string,
  check: Check,
  level = 1,
): BankItem {
  const entry = CAUSES[cause];
  const guarded = withAnchor(check);
  return {
    id,
    family,
    tier,
    level,
    component,
    title,
    cause: entry.text,
    contract: entry.contract,
    check: async (ctx) => {
      try {
        return await guarded(ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('the loader refuses'))
          return fail(
            `a spec the docs define loads (${entry.contract}); the product answered: ${message.slice(0, 220)}`,
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

export const CORE = 'packages/core';
export const CLI = 'packages/cli';

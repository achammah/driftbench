import type { Rng } from '../kit/words';
import type { PointerSut } from '../sut/port';
import type { Need } from './specs/types';

/**
 * The bank of the pointer validator (docs/validators.md section 12). An item is one capability the pointer reader
 * must have, written as code: an id, a family, a difficulty tier, a seeded generator that builds the input and
 * the truth it must give, an exact oracle, and the one component it points at.
 */

export type Tier = 1 | 2 | 3 | 4 | 5;

export type Outcome = { pass: boolean; detail: string };

/** What an item runs with. */
export type ItemContext = {
  seed: number;
  id: string;
  sut: PointerSut;
  /** A stream named by the seed and the item. */
  rng: Rng;
};

export type PointerItem = {
  /** `<family>.<key>`, unique in the bank. */
  id: string;
  family: string;
  tier: Tier;
  /** The ladder level, 1 to LEVELS.length. */
  level: number;
  /** The one component a failure points at. */
  component: string;
  title: string;
  /** The one change that would make the item pass (docs/validators.md section 12.4). */
  cause: string;
  /** Omitted means author-declared atomic; a composite check contributes no distinct-cause credit. */
  causeKind?: CauseKind;
  /** How the input is built and what the oracle checks, as printed in the catalogue. */
  gen: string;
  oracle: string;
  needs: Need[];
  /** The input does not depend on the seed: judged once per process. */
  seedFree: boolean;
  run(ctx: ItemContext): Promise<Outcome>;
};

/** What a family file provides for each of its spec rows. */
export type Run = (ctx: ItemContext) => Promise<Outcome>;

/** The ladder levels of the bank, in order of the cost of diagnosing a failure. */
export const LEVELS = [
  { id: 'cut', name: 'cutting', what: 'layer A turns files into units' },
  { id: 'ids', name: 'ids and ledger', what: 'fingerprints, ids, the canonical sidecar' },
  { id: 'anchor', name: 're-anchoring', what: 'old units find their new selves' },
  { id: 'labels', name: 'labels and atoms', what: 'windows, answers, carry-forward, ports, atoms' },
  { id: 'replay', name: 'cassette and replay', what: 'determinism lives in the cassette' },
  { id: 'links', name: 'links and blast radius', what: 'layer C' },
  { id: 'privacy', name: 'private estates', what: 'a secret stays in its folder' },
  { id: 'scale', name: 'scale', what: '10 and 100 times the size, time and memory' },
  { id: 'adversarial', name: 'adversarial', what: 'decoys, hostile inputs, ladder traps' },
] as const;

export function levelOf(id: string): number {
  const index = LEVELS.findIndex((level) => level.id === id);
  if (index < 0) throw new Error(`no level ${id}`);
  return index + 1;
}

/** A failure an item reports in words: thrown by helpers, caught by the runner, shown without a stack. */
export class Problem extends Error {}

export const pass = (detail: string): Outcome => ({ pass: true, detail });
export const fail = (detail: string): Outcome => ({ pass: false, detail });

import type { CauseKind } from '../../../ladder';

export type Tier = 1 | 2 | 3 | 4 | 5;

/** What an item needs from the reader binding (the seam of the catalogue preface). */
export type Need = 'cut' | 'scan' | 'transport' | 'cassette' | 'prompt' | 'links' | 'child' | 'cli' | 'stack';

/** One row of the bank: the data the catalogue prints and the code zips with its runner. */
export type Spec = {
  key: string;
  tier: Tier;
  title: string;
  /** How the seeded input is built. */
  gen: string;
  /** The exact oracle, by construction. */
  oracle: string;
  /** The one change that would make the item pass: `<component>:<change>`. */
  cause: string;
  /** Omitted means an author-declared atomic repair. Composite checks add no distinct-cause credit. */
  causeKind?: CauseKind;
  component?: string;
  needs?: Need[];
  /** The input does not depend on the seed: judged once per process. */
  seedFree?: boolean;
};

export type FamilySpec = {
  id: string;
  level: string;
  /** Default component for the family's items. */
  component: string;
  /** Default needs. */
  needs: Need[];
  summary: string;
  specs: Spec[];
};

/** Row constructor: keeps the tables short. */
export function row(
  key: string,
  tier: Tier,
  title: string,
  gen: string,
  oracle: string,
  cause: string,
  extra: Partial<Pick<Spec, 'component' | 'needs' | 'seedFree' | 'causeKind'>> = {},
): Spec {
  return { key, tier, title, gen, oracle, cause, ...extra };
}

import type { CauseKind } from '../../../../ladder';

import type { StemDef } from './types';

/**
 * Family determinism: same seed, same plan, byte for byte (clause P9). Plans are compared as serialised JSON.
 * Cross-process items start a second Node.js process on the same implementation module. Level determinism.
 */
export const DETERMINISM: readonly StemDef[] = [
  {
    id: 'determinism.same-seed-same-bytes',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator:
      'A tiny space; a space with rules, seeds and a budget; heavy constraints; equal weights (many ties); 200 binary axes. The plan is built twice with the same store, options and seed.',
    oracle: 'The two serialised plans are identical byte for byte.',
    cause: 'the same store, options and seed give byte-identical plans',
    variants: [
      ['tiny', 1],
      ['rules-seeds-budget', 2],
      ['heavy-constraints', 3],
      ['equal-weights-ties', 3],
      ['two-hundred-binary', 4],
    ],
  },
  {
    id: 'determinism.interleaved-calls',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator:
      'A plan, then a plan of another store (or another budget) in between, then the first plan again.',
    oracle: 'The first and the third plan are identical byte for byte.',
    cause: 'a plan does not depend on earlier calls',
    variants: [
      ['other-store-between', 2],
      ['other-budget-between', 3],
    ],
  },
  {
    id: 'determinism.across-processes',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator:
      'The plan built in this process and in a new Node.js process: default environment; another time zone; a Turkish locale; valid ASCII IDs with mixed case and accented Unicode titles (the legacy item ID is unchanged).',
    oracle: 'The serialised plans are identical byte for byte.',
    cause: 'a plan does not depend on the process, its locale or its time zone',
    variants: [
      ['default-env', 3],
      ['other-time-zone', 4],
      ['turkish-locale', 5],
      ['accented-ids-sort', 4],
    ],
  },
  {
    id: 'determinism.no-ambient-randomness',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator:
      'The plan built with Math.random replaced by a function that throws, with the clock set to two different instants, with the crypto random functions throwing, and with all three.',
    oracle: 'The call does not throw and the plan equals the plan built in the normal environment.',
    cause: 'planning draws randomness only from the seed',
    variants: [
      ['math-random-throws', 3],
      ['clock-frozen-differently', 3],
      ['crypto-throws', 4],
      ['all-three', 4],
    ],
  },
  {
    id: 'determinism.key-order',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator:
      'The same store with object keys in another order (weights, provenance), and seed rows with keys in another order.',
    oracle: 'The plans are equal after sorting object keys.',
    cause: 'a plan does not depend on the key order of the objects it reads',
    variants: [
      ['store-keys', 3],
      ['seed-row-keys', 3],
    ],
  },
  {
    id: 'determinism.json-round-trip',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator: 'The store and the options passed through JSON.stringify and JSON.parse.',
    oracle: 'The plan equals the plan of the original objects.',
    cause: 'a plan depends only on the JSON content of its inputs',
    variants: [
      ['store', 2],
      ['options', 2],
    ],
  },
  {
    id: 'determinism.inputs-not-written',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator: 'A deeply frozen store, deeply frozen seed rows, and deeply frozen options.',
    oracle: 'The call does not throw and returns the same plan as with unfrozen inputs.',
    cause: 'planning never writes to its inputs',
    variants: [
      ['frozen-store', 2],
      ['frozen-seeds', 2],
      ['frozen-options', 2],
    ],
  },
  {
    id: 'determinism.store-bytes',
    family: 'determinism',
    component: 'planner/determinism',
    need: 'P9',
    generator:
      'The same sources built twice in a row; built with the object keys of the sources in another order; built in a second Node.js process.',
    oracle: 'The serialised stores are identical byte for byte.',
    cause: 'buildStore gives byte-identical stores for the same sources',
    variants: [
      ['two-calls', 2],
      ['other-key-order', 3],
      ['across-processes', 4],
    ],
  },
];

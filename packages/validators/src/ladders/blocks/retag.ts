/**
 * The honest cause count (docs/validators.md section 12.4 point 4): causes that one change turns green together
 * are one cause. Two kinds of evidence merge them:
 *
 * - the same rule written once per parameter (a formula case, a format of one reader, a size of one algorithm,
 *   a mode, a tool part of one table, an exit of one rule): one implementation passes every variant;
 * - the blind pilot of train/blocks-trial3 (rounds 1 to 9, each measured in CI): causes one iteration closed
 *   together through one foundation (the parent forest, blocked propagation, not_run parents, bytes written as
 *   given). A rule with its own code path that the same iteration also closed stays its own cause: the parent
 *   link refusals, the rate that leaves blocked runs out, a passed parent run once, the base64 refusal, the path
 *   written twice, the adapter that cannot seed a prefix.
 *
 * Each merge keeps the items' own contracts; only the cause, the one change the items need, is shared.
 */
type Merge = { into: string; from: readonly RegExp[] };

export const MERGES: readonly Merge[] = [
  {
    into: 'A change the radius cannot map makes the radius the whole suite: unknown means in.',
    from: [/^A change the radius cannot map \(.*\) makes the radius the whole suite\.$/],
  },
  {
    into: 'The recompute rung runs the produced and the gold computation on the given and changed inputs.',
    from: [
      /^The recompute rung runs the produced and the gold computation on the given and changed inputs \(.*\)\.$/,
    ],
  },
  {
    into: 'The state-diff rung compares the net workspace diff with the expected and allowed changes.',
    from: [
      /^The state-diff rung compares the net workspace diff with the expected and allowed changes \(.*\)\.$/,
    ],
  },
  {
    into: 'radiusOf selects the blocks of a tool change by the part the change names, by the documented table.',
    from: [
      /^a tool change with part \w+ selects the blocks the documentation lists for that part and no other$/,
      /^radiusOf selects the direct blocks of a tool [\w ]+ change by the documented table\.$/,
    ],
  },
  {
    into: 'spec lint leaves out a fact that a recorded call holds, the user said, or no whole word states.',
    from: [
      /^spec lint leaves out a fact that a recorded call holds, the user said, or no whole word states \(.*\)\.$/,
    ],
  },
  {
    into: 'The outcome rung leaves a value it cannot decide to the exact fallback.',
    from: [/^The outcome rung leaves a value it cannot decide \(.*\) to the exact fallback\.$/],
  },
  {
    into: 'The checks of one block are judged apart: one failing never skips, fails or passes another.',
    from: [
      /^The [\w ]+ check and the [\w ]+ check of one block are judged apart: one failing never skips, fails or passes the other\.$/,
    ],
  },
  {
    into: 'The loader refuses a parent link that names no block (PARENT_MISSING) or leads back to its block (PARENT_CYCLE), and accepts a link to a block written later.',
    from: [
      /^The loader refuses parent links that are [\w -]+ with PARENT_(CYCLE|MISSING)\.$/,
      /^PARENT_MISSING and PARENT_CYCLE are spec errors; a forward reference to an existing block is valid/,
      /^The loader accepts a parent written after its child\.$/,
    ],
  },
  {
    into: 'radiusOf stays exact and linear in the blocks of the suite.',
    from: [/^radiusOf stays exact and linear on \d+ blocks: \d+ ms of CPU\.$/],
  },
  {
    into: 'campaign run exits by the gate rule on its cells.',
    from: [/^campaign run exits \d by the gate rule on its cells\.$/],
  },
  {
    into: 'The runner grows linearly in its blocks in modes F and T (docs/validators.md section 13.1).',
    from: [/^the runner in mode [FT] grows linearly in its blocks/],
  },
  {
    into: "The loader's resolve pass refuses an item no layer defines with OBJECT_ITEM_UNKNOWN.",
    from: [/^The loader's resolve pass refuses [\w ]+ with OBJECT_ITEM_UNKNOWN\.$/],
  },
  {
    into: "The loader's resolve pass refuses an invalid order or move with OBJECT_ORDER_INVALID.",
    from: [/^The loader's resolve pass refuses [\w ]+ with OBJECT_ORDER_INVALID\.$/],
  },
  {
    into: "The loader's resolve pass refuses a reference to an object no layer defines with OBJECT_UNKNOWN.",
    from: [/^The loader's resolve pass refuses [\w ]+ with OBJECT_UNKNOWN\.$/],
  },
  {
    into: "Blame reads the value's source and change, and the tool's contract, from the run's value facts.",
    from: [
      /^Blame reads the value's source and change, and the tool's contract, from the run's value facts: it separates/,
    ],
  },
  {
    into: 'A passed parent runs once per run, however many children share it.',
    from: [/^a passed parent runs once per run, however many children share it\.?$/i],
  },
  // Pilot round 1: one change writes the seed's bytes as given; the mark is part of those bytes.
  {
    into: 'A workspace seed writes workspace.binary files byte for byte from their base64, a byte-order mark included.',
    from: [
      /^A workspace seed writes workspace\.binary files byte for byte from their base64\.$/,
      /^A workspace seed keeps a text file's byte-order mark/,
    ],
  },
  // Pilot round 2: the parent forest. A child starts from its ancestors' recorded end state; roots from the defaults.
  {
    into: "The runner runs a spec with parent links as a forest: dependencies first whatever the written order, each root from the spec defaults, each child from its ancestors' recorded end state only.",
    from: [
      /^A child's history holds /,
      /^A child's history leaves out every block that is not its ancestor/,
      /^A child's own given\.prefix replaces the conversation/,
      /^the child own given\.prefix replaces the inherited conversation$/,
      /^A child's own world\.workspace replaces the inherited workspace whole/,
      /^A child's workspace diff starts from the workspace it inherited/,
      /^A failing block with no children blocks nothing/,
      /^A world layer set on a block reaches its descendants/,
      /^Each root of a forest starts at the spec defaults/,
      /^The runner runs a spec with parent links as a forest, each child after its parent\.$/,
      /^a child prefix includes the parent actual reply and tool calls/,
      /^once a spec declares a parent link, /,
      /^the runner orders dependencies before children, including forward references$/,
      /^world and variables are copied, so siblings cannot change each other start$/,
    ],
  },
  // Pilot round 3: blocked propagation.
  {
    into: 'A block whose parent failed is blocked, never sent, adds no failure, names its direct parent and the root failure; other trees run on.',
    from: [
      /^A failed parent makes its descendants blocked/,
      /^A failure in one tree of parent links leaves the other trees running/,
      /^The parent rules hold on any forest/,
      /^The root of a blocked block is the first failure/,
      /^blocked\.by names the direct parent and blocked\.root names/,
      /^if a parent fails, the child is blocked/,
    ],
  },
  // Pilot round 5: a parent not run blocks its children, rooted at itself, each failure counted once.
  {
    into: 'A parent that is not run blocks its children, rooted at itself; a run counts each planted failure once.',
    from: [
      /^A parent that is not run blocks its children, rooted at itself\.$/,
      /^if a parent is not_run, the child is blocked and blocked\.root names the unrun cause$/,
      /^A run counts each planted failure once/,
    ],
  },
];

/** The cause an item counts under: the merged one when a merge holds it, else its own. */
export function retag(cause: string): string {
  for (const merge of MERGES) if (merge.from.some((pattern) => pattern.test(cause))) return merge.into;
  return cause;
}

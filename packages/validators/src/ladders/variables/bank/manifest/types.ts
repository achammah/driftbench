/**
 * The manifest of the variables bank: one entry per STEM, a capability the variable store or the planner must
 * have. A stem has variants; each variant is one item of the bank with its own tier. The manifest is descriptive
 * data: the catalogue (validators/variables/CATALOGUE.md) is generated from it, and the executable checks live
 * in bank/families, keyed by stem id. A test keeps the two in step.
 */

/** A difficulty tier of the hardness contract (docs/validators.md section 12.1), 1 the easiest. */
export type Tier = 1 | 2 | 3 | 4 | 5;

export const FAMILIES = [
  'sources',
  'quotes',
  'values',
  'boundaries',
  'impossible-pairs',
  'weights',
  'strength',
  'seed-rows',
  'budget-order',
  'counter',
  'scale',
  'determinism',
] as const;
export type Family = (typeof FAMILIES)[number];

/** The sub-banks, in the order the ladder runs them (cheapest diagnosis first). */
export const LEVELS = [
  'store',
  'constraints',
  'counter',
  'strength',
  'plan-order',
  'determinism',
  'scale',
] as const;
export type Level = (typeof LEVELS)[number];

/** The level each family belongs to. */
export const FAMILY_LEVEL: Record<Family, Level> = {
  sources: 'store',
  quotes: 'store',
  values: 'store',
  boundaries: 'store',
  'impossible-pairs': 'constraints',
  weights: 'constraints',
  counter: 'counter',
  strength: 'strength',
  'seed-rows': 'plan-order',
  'budget-order': 'plan-order',
  determinism: 'determinism',
  scale: 'scale',
};

export type Variant = readonly [key: string, tier: Tier];

export type StemDef = {
  /** `<family-prefix>.<capability>`; the item id is the stem id, a dot and the variant key. */
  id: string;
  family: Family;
  /** The one component the stem points at, from a fixed table (COMPONENTS). */
  component: string;
  /** Which clause of the specification, or which rule of docs/validators.md, asks for it (CLAUSES). */
  need: string;
  /** How the input is built from the hidden specification the seed draws. */
  generator: string;
  /** How the right answer is known without running the component. */
  oracle: string;
  /** The one change that would make the stem's items pass. Stems sharing a cause count once. */
  cause: string;
  /** Variant-specific candidate cause when a stem covers separate fixes. */
  variantCauses?: Readonly<Record<string, string>>;
  /** The assumptions (ASSUMPTIONS) the oracle rests on, when it rests on any. */
  assumption?: readonly string[];
  variants: readonly Variant[];
};

/** The components items point at: logical modules of the variable store and the planner. */
export const COMPONENTS = {
  'store/estate': 'reading condition spans and tool evidence of the estate into variables',
  'store/conversations': 'counting the values seen in past conversations (counts only)',
  'store/owner': 'taking missing values, impossible pairs and weights from the owner',
  'store/merge': 'merging the three sources and keeping every provenance',
  'store/quotes': 'checking that a quote is findable in its source file',
  'store/ids': 'turning names into ids and keeping ids unique',
  'store/boundaries': 'the two sides and the boundary of a condition',
  'store/weights': 'weights and their 95 percent intervals',
  'planner/constraints': 'impossible pairs in the plan and in the required tuples',
  'planner/strength': 'variable-strength covering: strength 3, 2 and 1',
  'planner/seeds': 'seed rows first and new rows only for what the seeds miss',
  'planner/budget': 'row order by traffic weight and the budget cut',
  'planner/counter': 'counting allowed and covered tuples',
  'planner/scale': 'bounded rows and time at hundreds of variables',
  'planner/determinism': 'same seed, same plan, byte for byte',
} as const;
export type Component = keyof typeof COMPONENTS;

/** The clauses now grounded in docs/variables.md, Programmatic readers and planning (R1–R15). */
export const CLAUSES = {
  P1: 'One variable store shared by the prompt map and the estate map.',
  P2: 'Three sources feed it: the estate (a condition span names a variable; its values are the two sides of the condition plus the boundary), past conversations (values seen and how often; private, counts only), and the owner (missing values, impossible pairs, weights).',
  P3: "Every reader-produced value keeps its provenance (a quote with its source path, conversation counts, or the owner's words).",
  P4: 'A value without a findable quote is refused.',
  P5: "Planner v2 is a variable-strength covering array: strength 3 on each rule's own variables (its condition and its tool evidence), strength 2 on the shared axes, strength 1 on every other variable.",
  P6: 'Real sessions enter first as seed rows, kept as they are; new rows cover only the tuples the seeds miss.',
  P7: 'Traffic weight orders rows, so a budget keeps the common head and cuts the rarest rows first; seed rows are always kept (ruling of 2026-10-17).',
  P8: 'Impossible pairs never appear.',
  P9: 'Same seed, same plan, byte for byte.',
  P10: '200 two-valued variables must give a bounded row count.',
  P11: 'Weights are recovered from conversations drawn from a planted known mix, inside a 95 percent interval.',
  P12: 'Strength 3, 2 and 1 coverage is checked by an independent brute-force counter on small spaces.',
  P13: 'The counter is a differential against exhaustive enumeration.',
  P14: 'Past conversations are private: counts only.',
  P15: 'The validator calls no model.',
  H3: 'docs/validators.md 12.2 rule 3: combinations are generated, never hand-listed.',
  H4: 'docs/validators.md 12.2 rule 4: scale; correct and slow is a failing item.',
  H6: 'docs/validators.md 12.2 rule 6: differential against a brute force wherever one exists.',
  H7: 'docs/validators.md 12.2 rule 7: degenerate and hostile inputs, one item per family.',
  M1: 'docs/reference/map.md: ids, quotes and weights of the map format that the store feeds.',
} as const;
export type ClauseId = keyof typeof CLAUSES;

/** Historical decision IDs, now grounded in the explicit product rules in docs/variables.md. */
export const ASSUMPTIONS = {
  A1: 'docs/variables.md R9: Budget order (ruled 2026-10-17): after the seed rows the new rows run most common first, a budget keeps a prefix, so the rarest rows are cut first. One constant (RARE_ROWS_CUT) holds the reading.',
  A2: 'docs/variables.md R6: A tuple is allowed when some valid full row holds it (a pairwise-fine tuple that no valid row can hold is not allowed, so it is never required).',
  A3: 'docs/variables.md R9: The traffic weight of a row is the product of the shares of its values, compared in log space. This assumes the variables are independent (ruled 2026-10-17); a joint distribution would need its own format.',
  A4: 'docs/variables.md R9: A budget counts every plan row, seeds included. No item sets a budget below the number of seeds. A budget of 0 with no seeds gives an empty plan.',
  A5: 'docs/variables.md R5: A value seen in conversations on a variable the store has, and absent from the store, is added as a proposal (approved false) with its counts as provenance; it counts in the plan only once a person approves it (ruled 2026-10-17).',
  A6: 'docs/variables.md R7: A space with no valid row gives no rows or an error that names the conflict; never an invalid row, never a hang.',
  A7: 'docs/variables.md R10: An argument outside its domain (budget, strength, unknown variable) raises a RangeError that names the argument.',
  A8: 'docs/variables.md R6: A group with fewer variables than its strength is covered at its own size (the full cross product).',
  A9: 'docs/variables.md Limits of each field: Ids follow the id grammar of the variable store format: variable and value ids match ^[A-Za-z0-9][A-Za-z0-9._-]*$.',
  A10: 'docs/variables.md R5: An owner pair that names a variable or value the store lacks is refused with a reason.',
  A11: 'docs/variables.md R3: An integer threshold gets integer samples on both sides (adjacent or further integers).',
  A12: 'docs/variables.md R3: A boolean condition has two values (true, false); a membership condition has an in-list side and an out-of-list side; neither has a boundary.',
  A13: 'docs/variables.md Adapter projection: The input format of the bank (files, rules, condition spans, tool evidence, sessions, owner entries) stands for the readers that fill a store, which are not built yet (docs/variables.md Status). The output is a projection, not the serialized file schema; source-reader provenance is R1, not a file-format requirement.',
  A14: 'docs/variables.md Values: Weights are relative (docs/variables.md Values): a variable weighs all its values or none, and a share is a weight over the total weight of its variable.',
  A15: 'docs/variables.md R13: The 95 percent interval of a weight comes from a function weightInterval(count, total); the format stores the counts, not the interval.',
} as const;
export type AssumptionId = keyof typeof ASSUMPTIONS;

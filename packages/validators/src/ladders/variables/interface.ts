/**
 * The neutral interface of the variables bank.
 *
 * The bank talks to the implementation through four functions on plain data (VariablesImpl) and reads a store as
 * a StoreDoc. StoreDoc is a projection of the variable store, not its serialized file schema: provenance kinds and
 * fields, relative weights, approval flags, boundaries. The readers that fill a store, the planner and the
 * counter are not built yet, so adapter.ts provides none of them and every item fails with the name of the
 * function it needs: that is the roadmap. When they land, only adapter.ts changes.
 *
 * Everything here is JSON: no class, no Map, no function, so a plan can be compared byte for byte.
 */

export type VarId = string;
export type ValId = string;

/** A (possibly partial) assignment of values to variables: a session, a seed row, a plan row. */
export type Row = Record<VarId, ValId>;

/**
 * Where a value comes from. Source readers attach at least one to every value they produce; imported stores may omit provenance. The three kinds and their fields are those of
 * the variable store format (docs/variables.md "Provenance").
 */
export type Provenance =
  /** The agent's files: text copied word for word from a file, with the path of the file. */
  | { kind: 'quote'; path: string; quote: string; ledger?: string }
  /** Past conversations: counts and a hash of the private set, never a line of text. */
  | { kind: 'conversations'; count: number; total: number; set_hash: string }
  /** The owner: the owner's own words and the day they said them (YYYY-MM-DD). */
  | { kind: 'owner'; words: string; date: string };

export type StoreValue = {
  id: ValId;
  provenance?: Provenance[];
  title?: string;
  /**
   * The bank's witness: a concrete case a test can use. For a numeric condition a number (below the limit, the
   * limit, above it), for a boolean condition true or false, for a membership condition and for a tool value a
   * string. The real format has no such field; the adapter derives it (numeric: from the boundary's limit and
   * comparison).
   */
  sample?: number | boolean | string;
  /** Relative weight (docs/variables.md "Values"): 0.6, 0.15 and 0.25 mean the same as 60, 15 and 25. */
  weight?: number;
  /** False for a value a machine proposed and no person approved; absent means approved. */
  approved?: boolean;
};

/** The edge of a numeric condition (docs/variables.md "Boundaries"). */
export type StoreBoundary = {
  holds: ValId;
  fails: ValId;
  edge: ValId;
  limit?: number;
  comparison?: 'lt' | 'le' | 'gt' | 'ge';
  unit?: string;
};

export type StoreVariable = {
  id: VarId;
  title?: string;
  values: StoreValue[];
  /** A shared axis: crossed at strength 2 with the other shared axes. */
  shared?: boolean;
  /** False for a variable a machine proposed and no person approved; absent means approved. */
  approved?: boolean;
  boundaries?: StoreBoundary[];
};

export type ImpossiblePair = {
  a: { variable: VarId; value: ValId };
  b: { variable: VarId; value: ValId };
  provenance: Provenance[];
};

/** A rule and its own variables: the ones its condition and its tool evidence name. */
export type RuleDoc = { id: string; variables: VarId[] };

/** An entry the store refused, with the reason. `what` names the value, variable, pair or weight. */
export type Refusal = { what: string; reason: string };

export type StoreDoc = {
  variables: StoreVariable[];
  impossible: ImpossiblePair[];
  rules: RuleDoc[];
  refused: Refusal[];
};

/** The estate source: files by path, and the rules read from them. */
export type EstateInput = {
  files: Record<string, string>;
  rules: Array<{
    id: string;
    /** The file the rule is read from. */
    source: string;
    /** Condition spans: text copied from the file. Each names a variable. */
    conditions: Array<{ text: string }>;
    /** Tool evidence: input fields of a tool the rule's tests must see, with their listed values and quotes. */
    tools: Array<{
      tool: string;
      field: string;
      source: string;
      values: Array<{ id: ValId; quote: string }>;
    }>;
  }>;
};

/** One past conversation reduced to the values seen. Only the counts of `values` may reach the store. */
export type ConversationInput = { id: string; text?: string; values: Row };

export type OwnerInput = {
  values?: Array<{ variable: VarId; value: ValId; words: string; date: string }>;
  impossible?: Array<{
    a: { variable: VarId; value: ValId };
    b: { variable: VarId; value: ValId };
    words: string;
    date: string;
  }>;
  weights?: Array<{ variable: VarId; value: ValId; weight: number; words: string; date: string }>;
};

export type Sources = { estate?: EstateInput; conversations?: ConversationInput[]; owner?: OwnerInput };

export type PlanOptions = {
  /** Every tie is broken from this seed: the same seed gives the same plan, byte for byte. */
  seed: number;
  /** The most rows the plan holds, seeds included. Absent: no cut. */
  budget?: number;
  /** Real sessions, kept as they are, first in the plan. */
  seeds?: Row[];
};

export type PlanRow = {
  id: string;
  kind: 'seed' | 'new';
  values: Row;
  /** The traffic weight of the row: the product of the shares of its values. */
  weight: number;
};

export type Plan = {
  rows: PlanRow[];
  /** What the plan covers: the allowed tuples required by the groups, and how many the rows hold. */
  report?: { allowed: number | bigint; covered: number | bigint };
};

/** A set of variables covered at a strength: every allowed combination of `strength` of them. */
export type Group = { variables: VarId[]; strength: number };

export type CoverageResult = {
  /** Distinct allowed tuples of the groups. A tuple is allowed when some valid full row holds it. */
  allowed: number | bigint;
  /** Distinct allowed tuples that the rows hold (a partial row holds the tuples inside its variables). */
  covered: number | bigint;
  /** Allowed tuples no row holds, up to `options.uncovered`; each names its variables and values. */
  uncovered?: Row[];
};

export type VariablesImpl = {
  /** Builds the store from the three sources. */
  buildStore(sources: Sources): StoreDoc;
  /** The 95 percent interval of a share seen in `count` of `total` sessions, inside 0 to 1. */
  weightInterval(count: number, total: number): [number, number];
  /** Plans: a variable-strength covering array (strength 3 on each rule, 2 on shared axes, 1 elsewhere). */
  plan(store: StoreDoc, options: PlanOptions): Plan;
  /** Counts allowed and covered tuples of groups over rows. */
  coverage(store: StoreDoc, rows: Row[], groups: Group[], options?: { uncovered?: number }): CoverageResult;
};

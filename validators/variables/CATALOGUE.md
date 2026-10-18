# Variables validator bank: catalogue

Written blind, from the specification alone, then bound to the variable store format of PR 706 (docs/variables.md) and the lead's rulings of 2026-10-17. 471 items in 141 stems and 12 families, 141 candidate cause labels (not a verified distinct-fix count), seven levels. An item is a stem plus a variant: its id is the stem id, a dot and the variant key. A stem is one capability the variable store or the planner must have; its variants differ in input shape, size or wording and carry their own tier. Every item takes its input from a seed (the visible seeds 1 to 20 and the hidden seed draw other inputs). The validator calls no model.

## 1. Counts

| Family | Level | Stems | Items | T1 | T2 | T3 | T4 | T5 | Causes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sources | store | 21 | 61 | 10 | 19 | 22 | 9 | 1 | 21 |
| quotes | store | 15 | 54 | 4 | 12 | 19 | 14 | 5 | 15 |
| values | store | 11 | 33 | 1 | 4 | 16 | 6 | 6 | 11 |
| boundaries | store | 17 | 55 | 8 | 14 | 23 | 8 | 2 | 17 |
| impossible-pairs | constraints | 10 | 32 | 2 | 8 | 11 | 6 | 5 | 10 |
| weights | constraints | 12 | 44 | 1 | 8 | 20 | 12 | 3 | 12 |
| strength | strength | 12 | 43 | 5 | 9 | 17 | 11 | 1 | 12 |
| seed-rows | plan-order | 9 | 30 | 4 | 4 | 15 | 6 | 1 | 9 |
| budget-order | plan-order | 7 | 28 | 1 | 5 | 14 | 5 | 3 | 7 |
| counter | counter | 11 | 42 | 2 | 5 | 13 | 15 | 7 | 11 |
| scale | scale | 8 | 24 | 0 | 0 | 6 | 9 | 9 | 8 |
| determinism | determinism | 8 | 25 | 1 | 8 | 9 | 6 | 1 | 8 |
| **all** |  | 141 | 471 | 39 | 96 | 185 | 107 | 44 | 141 |

Contract check (docs/validators.md 12.1): at least 300 items, no family under 20, every tier present.

| Level | Name | Families | Items |
| --- | --- | --- | --- |
| 1 | store | sources, quotes, values, boundaries | 203 |
| 2 | constraints | impossible-pairs, weights | 76 |
| 3 | counter | counter | 42 |
| 4 | strength | strength | 43 |
| 5 | plan-order | seed-rows, budget-order | 58 |
| 6 | determinism | determinism | 25 |
| 7 | scale | scale | 24 |

Tiers: 1 the plain case with one capability and a small clean input; 2 ordinary variation (other wording, arity or size); 3 realistic combinations and required details (reasons, provenance, ordering); 4 hostile or boundary inputs, differentials against brute force, statistics; 5 adversarial inputs aimed at a likely shortcut, scale at ten or a hundred times, the strictest statistical regimes.

## 2. Contract decisions and adapter mappings

The product rules are stated in docs/variables.md, Programmatic readers and planning. The IDs below retain traceability to the original bank assumptions; they no longer substitute for a product contract.

* **A1.** docs/variables.md R9: Budget order (ruled 2026-10-17): after the seed rows the new rows run most common first, a budget keeps a prefix, so the rarest rows are cut first. One constant (RARE_ROWS_CUT) holds the reading.
* **A2.** docs/variables.md R6: A tuple is allowed when some valid full row holds it (a pairwise-fine tuple that no valid row can hold is not allowed, so it is never required).
* **A3.** docs/variables.md R9: The traffic weight of a row is the product of the shares of its values, compared in log space. This assumes the variables are independent (ruled 2026-10-17); a joint distribution would need its own format.
* **A4.** docs/variables.md R9: A budget counts every plan row, seeds included. No item sets a budget below the number of seeds. A budget of 0 with no seeds gives an empty plan.
* **A5.** docs/variables.md R5: A value seen in conversations on a variable the store has, and absent from the store, is added as a proposal (approved false) with its counts as provenance; it counts in the plan only once a person approves it (ruled 2026-10-17).
* **A6.** docs/variables.md R7: A space with no valid row gives no rows or an error that names the conflict; never an invalid row, never a hang.
* **A7.** docs/variables.md R10: An argument outside its domain (budget, strength, unknown variable) raises a RangeError that names the argument.
* **A8.** docs/variables.md R6: A group with fewer variables than its strength is covered at its own size (the full cross product).
* **A9.** docs/variables.md Limits of each field: Ids follow the id grammar of the variable store format: variable and value ids match ^[A-Za-z0-9][A-Za-z0-9._-]*$.
* **A10.** docs/variables.md R5: An owner pair that names a variable or value the store lacks is refused with a reason.
* **A11.** docs/variables.md R3: An integer threshold gets integer samples on both sides (adjacent or further integers).
* **A12.** docs/variables.md R3: A boolean condition has two values (true, false); a membership condition has an in-list side and an out-of-list side; neither has a boundary.
* **A13.** docs/variables.md Adapter projection: The input format of the bank (files, rules, condition spans, tool evidence, sessions, owner entries) stands for the readers that fill a store, which are not built yet (docs/variables.md Status). The output is a projection, not the serialized file schema; source-reader provenance is R1, not a file-format requirement.
* **A14.** docs/variables.md Values: Weights are relative (docs/variables.md Values): a variable weighs all its values or none, and a share is a weight over the total weight of its variable.
* **A15.** docs/variables.md R13: The 95 percent interval of a weight comes from a function weightInterval(count, total); the format stores the counts, not the interval.

## 3. Clauses of the specification the stems cite

* **P1.** One variable store shared by the prompt map and the estate map.
* **P2.** Three sources feed it: the estate (a condition span names a variable; its values are the two sides of the condition plus the boundary), past conversations (values seen and how often; private, counts only), and the owner (missing values, impossible pairs, weights).
* **P3.** Every reader-produced value keeps its provenance (a quote with its source path, conversation counts, or the owner's words).
* **P4.** A value without a findable quote is refused.
* **P5.** Planner v2 is a variable-strength covering array: strength 3 on each rule's own variables (its condition and its tool evidence), strength 2 on the shared axes, strength 1 on every other variable.
* **P6.** Real sessions enter first as seed rows, kept as they are; new rows cover only the tuples the seeds miss.
* **P7.** Traffic weight orders rows, so a budget keeps the common head and cuts the rarest rows first; seed rows are always kept (ruling of 2026-10-17).
* **P8.** Impossible pairs never appear.
* **P9.** Same seed, same plan, byte for byte.
* **P10.** 200 two-valued variables must give a bounded row count.
* **P11.** Weights are recovered from conversations drawn from a planted known mix, inside a 95 percent interval.
* **P12.** Strength 3, 2 and 1 coverage is checked by an independent brute-force counter on small spaces.
* **P13.** The counter is a differential against exhaustive enumeration.
* **P14.** Past conversations are private: counts only.
* **P15.** The validator calls no model.
* **H3.** docs/validators.md 12.2 rule 3: combinations are generated, never hand-listed.
* **H4.** docs/validators.md 12.2 rule 4: scale; correct and slow is a failing item.
* **H6.** docs/validators.md 12.2 rule 6: differential against a brute force wherever one exists.
* **H7.** docs/validators.md 12.2 rule 7: degenerate and hostile inputs, one item per family.
* **M1.** docs/reference/map.md: ids, quotes and weights of the map format that the store feeds.

## 4. The interface the bank defines (bound to docs/variables.md)

Items talk to the implementation through `VariablesImpl` (four functions on plain JSON data). The store they read projects shared fields of the variable store format: the three provenance kinds with their fields, relative weights, approval flags and boundaries. `adapter.ts` maps the real code to it and provides nothing today, because the readers that fill a store, the planner and the counter are not built yet (docs/variables.md Status): every item fails with the name of the function it needs, and that is the roadmap. When they land, only `adapter.ts` changes. Shared projected fields are checked by `bank/format.ts`; this is not a full file-format validator. Missing provenance is permitted there; `build()` separately enforces the source-reader provenance obligation (R1).

```ts
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
```

## 5. Stems

Each stem: its component (the one place the fix goes), the clauses it serves, how its input is built (generator), how the answer is known without the component (oracle), and the one change that makes it pass (cause). Items are listed with their tier.

### Family sources (level store): 61 items

#### `sources.estate.numeric-condition`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P2.
* Generator: Renders a rule sentence ("When the <noun> is over <N> <unit>, <action>.") among filler lines of a CLAUDE.md-like file; the condition span is the fragment from the noun to the unit. Noun, comparator word, N and unit come from the seed.
* Oracle: Exactly one variable has values that cite the span, the store has no refusal, and the variable holds three values (their shape is checked by the boundaries family).
* Candidate cause C1: buildStore turns a numeric condition span of the estate into one variable.
* Items: `sources.estate.numeric-condition.one-rule` (T1), `sources.estate.numeric-condition.long-file` (T2)

#### `sources.estate.boolean-condition`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P2. Assumes: A12.
* Generator: Renders boolean conditions ("the draft is signed", "the draft is not signed", "no reference is attached") in a file; the span is the clause.
* Oracle: One variable cites the span; it holds exactly two values whose samples are the booleans true and false; each cites the span.
* Candidate cause C2: a boolean condition span becomes a variable with a true and a false value.
* Items: `sources.estate.boolean-condition.positive` (T1), `sources.estate.boolean-condition.negated` (T3), `sources.estate.boolean-condition.lacks-form` (T4)

#### `sources.estate.membership-condition`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P2. Assumes: A12.
* Generator: Renders a membership condition ("the channel is email or chat", "the channel is email, chat or phone", "the channel is one of a, b, c") with 2 or 3 listed members.
* Oracle: One variable cites the span; one value has a sample that is a listed member and one has a sample that is not; no more than members plus one values; each cites the span.
* Candidate cause C3: a membership condition span becomes a variable with an in-list side and an out-of-list side.
* Items: `sources.estate.membership-condition.three-members` (T2), `sources.estate.membership-condition.two-members` (T2)

#### `sources.estate.no-condition-no-variable`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P2.
* Generator: Lists spans that state no condition: an unconditional rule ("Always greet the user."), a number without a comparator ("Use the 500 euro template."), a past fact ("The limit was 500 last year."), beside real conditions.
* Oracle: No variable cites a decoy span; the real conditions still give their variables. A refusal entry for a decoy is allowed.
* Candidate cause C4: the estate source returns no variable for a span that states no condition.
* Items: `sources.estate.no-condition-no-variable.plain-rule` (T1), `sources.estate.no-condition-no-variable.number-without-comparator` (T4), `sources.estate.no-condition-no-variable.past-tense-limit` (T5)

#### `sources.estate.same-quantity-merges`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P2.
* Generator: Two or three spans over the same quantity noun with thresholds at least 10 apart, in one file or two; one variant changes the case of the noun.
* Oracle: One variable; each span is cited by exactly three values; the variable holds three values per span and no duplicate sample.
* Candidate cause C5: spans that name the same quantity merge into one variable.
* Items: `sources.estate.same-quantity-merges.two-spans` (T3), `sources.estate.same-quantity-merges.three-spans` (T3), `sources.estate.same-quantity-merges.two-files` (T4), `sources.estate.same-quantity-merges.case-differs` (T4)

#### `sources.estate.different-quantities-split`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P2.
* Generator: Spans over different quantity nouns: unrelated nouns, nouns that share a word ("invoice total", "invoice age"), a noun that is the prefix of another ("total", "total tax").
* Oracle: One variable per distinct noun; no value cites spans of two nouns; each variable holds three values.
* Candidate cause C6: spans that name different quantities stay different variables.
* Items: `sources.estate.different-quantities-split.two-nouns` (T1), `sources.estate.different-quantities-split.shared-word` (T3), `sources.estate.different-quantities-split.prefix-noun` (T4)

#### `sources.estate.rule-own-variables`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P5.
* Generator: Rules with 0 to 2 condition spans and 0 to 2 tool evidence fields (a tool, a field, listed values with their quotes in a tools file); one variant has two rules whose spans name the same quantity.
* Oracle: The store lists one rule per input rule, and its variables are exactly the variables whose values cite that rule's spans and tool quotes; a quantity named by two rules is one variable listed by both.
* Candidate cause C7: each rule lists the variables its condition spans and tool evidence name.
* Items: `sources.estate.rule-own-variables.condition-and-tool` (T2), `sources.estate.rule-own-variables.condition-only` (T2), `sources.estate.rule-own-variables.tool-only` (T3), `sources.estate.rule-own-variables.two-and-two` (T3), `sources.estate.rule-own-variables.shared-quantity-two-rules` (T3)

#### `sources.estate.tool-field-variable`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: P2.
* Generator: Tool evidence {tool, field, source, values}: 3, 2 or 1 listed values, each with an id and a quote found in a tools reference file.
* Oracle: One variable holds one value per listed id, each citing its own quote with the right source path.
* Candidate cause C8: tool evidence input fields become variables with one value per listed value.
* Items: `sources.estate.tool-field-variable.enum-three` (T2), `sources.estate.tool-field-variable.single-value` (T3)

#### `sources.conversations.counts`

* Component: `store/conversations` (counting the values seen in past conversations (counts only)). Serves: P2.
* Generator: Builds a base store from tool evidence, reads its ids, then draws sessions (a variable to a value) from a planted mix; the sessions go in with the same estate.
* Oracle: Each value carries a conversations provenance whose count equals the planted count and whose total equals the sessions that observe its variable, with a set_hash of 64 hexadecimal characters; the counts of a variable add up to its total.
* Candidate cause C9: the conversation source counts, per value, the sessions that show it and those that observe its variable.
* Items: `sources.conversations.counts.two-values` (T1), `sources.conversations.counts.three-variables` (T2), `sources.conversations.counts.unseen-estate-value` (T3)

#### `sources.conversations.partial-sessions`

* Component: `store/conversations` (counting the values seen in past conversations (counts only)). Serves: P2.
* Generator: Sessions that observe only some of the variables; one variable no session observes.
* Oracle: of counts only the sessions that observe the variable; a variable no session observes gets no conversations provenance.
* Candidate cause C10: the total of a variable counts only the sessions that observe it.
* Items: `sources.conversations.partial-sessions.half-observed` (T2), `sources.conversations.partial-sessions.never-observed` (T3)

#### `sources.conversations.new-value`

* Component: `store/conversations` (counting the values seen in past conversations (counts only)). Serves: P2. Assumes: A5.
* Generator: Sessions that show a value id the base store lacks, on a variable it has.
* Oracle: The variable gains the value with a conversations provenance (count, total) and approved false: it is a proposal until a person approves it; the other values keep their provenance.
* Candidate cause C11: a value seen in conversations and absent from the store is added as an unapproved proposal with its counts as provenance.
* Items: `sources.conversations.new-value.one-new` (T2)

#### `sources.conversations.set-hash`

* Component: `store/conversations` (counting the values seen in past conversations (counts only)). Serves: P14.
* Generator: A set of 30 sessions, built twice; the same set with one session's value changed; the same set in another order.
* Oracle: Every conversations entry carries a set_hash of 64 lowercase hexadecimal characters; the same set gives the same hash; a changed session gives another hash; the order of the sessions does not matter; the hash is not the session text or id.
* Candidate cause C12: the conversation source hashes the private set of sessions into set_hash.
* Items: `sources.conversations.set-hash.hex-shape` (T2), `sources.conversations.set-hash.stable` (T2), `sources.conversations.set-hash.changes-with-a-session` (T3), `sources.conversations.set-hash.order-free` (T3)

#### `sources.conversations.privacy`

* Component: `store/conversations` (counting the values seen in past conversations (counts only)). Serves: P14.
* Generator: Sessions that carry an id and a free-text field holding unique canary tokens; one variant has 1,000 sessions.
* Oracle: The serialised store holds no canary token and no session id: counts only.
* Candidate cause C13: the conversation source keeps counts only: no session id or text reaches the store.
* Items: `sources.conversations.privacy.text-canary` (T2), `sources.conversations.privacy.id-canary` (T2), `sources.conversations.privacy.thousand-sessions` (T4)

#### `sources.owner.missing-value`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P2.
* Generator: Owner entries (variable, value, words) on variables of a base store.
* Oracle: Each variable gains the value with an owner provenance equal to the words and the day; nothing else changes.
* Candidate cause C14: the owner source adds a missing value with the owner's words as provenance.
* Items: `sources.owner.missing-value.one` (T1), `sources.owner.missing-value.three` (T2)

#### `sources.owner.impossible-pair`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P2.
* Generator: Owner pairs (a variable and value on each side, words) over values of a base store.
* Oracle: The store lists each pair, in either order, with an owner provenance equal to the words and the day, and nothing more.
* Candidate cause C15: the owner source records an impossible pair with the owner's words.
* Items: `sources.owner.impossible-pair.one` (T1), `sources.owner.impossible-pair.reversed-endpoints` (T2)

#### `sources.owner.weight`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P2.
* Generator: Owner weights (variable, value, weight, words, day) on every value of a variable of a base store: a relative scale (60, 15, 25), a distribution (0.5, 0.3, 0.2), one weight of 0.
* Oracle: Each value carries the declared weight (exactly) and an owner provenance equal to the words and the day.
* Candidate cause C16: the owner source records a declared weight with the owner's words.
* Items: `sources.owner.weight.relative-scale` (T1), `sources.owner.weight.full-distribution` (T2), `sources.owner.weight.zero-weight` (T3)

#### `sources.owner.words-verbatim`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P3.
* Generator: Owner words with accents, line breaks, 1,000 characters (the format's limit), emoji and right-to-left text.
* Oracle: The stored provenance words equal the given words byte for byte.
* Candidate cause C17: the owner's words are stored byte for byte.
* Items: `sources.owner.words-verbatim.accents` (T2), `sources.owner.words-verbatim.multiline` (T3), `sources.owner.words-verbatim.one-thousand-chars` (T4), `sources.owner.words-verbatim.emoji-and-rtl` (T4)

#### `sources.owner.date-and-statement`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P3.
* Generator: Owner entries (a value) with the day 2025-12-31, with an unreal day (2026-02-30), with a day written 31/12/2025, and with blank words.
* Oracle: A real day is stored as given; an entry with an unreal or badly written day, or with blank words, is refused with a reason and changes nothing.
* Candidate cause C18: the owner source keeps the day the owner spoke and refuses an unreal day or a blank statement.
* Items: `sources.owner.date-and-statement.day-kept` (T2), `sources.owner.date-and-statement.unreal-day-refused` (T3), `sources.owner.date-and-statement.badly-written-day-refused` (T3), `sources.owner.date-and-statement.blank-words-refused` (T3)

#### `sources.merge.provenance-union`

* Component: `store/merge` (merging the three sources and keeping every provenance). Serves: P3.
* Generator: A value that two or three sources name: the estate (a quote), the conversations (counts) and the owner (words).
* Oracle: The value carries one provenance entry per source, each of its own kind.
* Candidate cause C19: a value known to several sources keeps one provenance entry per source.
* Items: `sources.merge.provenance-union.estate-owner` (T3), `sources.merge.provenance-union.estate-conversations` (T3), `sources.merge.provenance-union.all-three` (T4)

#### `sources.order-independent`

* Component: `store/merge` (merging the three sources and keeping every provenance). Serves: H3.
* Generator: The same sources with the rules, the sessions or the owner entries in another order (the file map keys too).
* Oracle: The two stores are equal after sorting variables, values and provenance entries by id.
* Candidate cause C20: the store content does not depend on the order of the source entries.
* Items: `sources.order-independent.rules-permuted` (T3), `sources.order-independent.sessions-permuted` (T3), `sources.order-independent.owner-entries-permuted` (T3)

#### `sources.empty-sources`

* Component: `store/merge` (merging the three sources and keeping every provenance). Serves: H7.
* Generator: No source, an empty estate, an empty session list, an empty owner object.
* Oracle: buildStore returns a store with no variable, no pair, no rule and no refusal, and does not throw.
* Candidate cause C21: buildStore accepts empty sources.
* Items: `sources.empty-sources.nothing` (T1), `sources.empty-sources.empty-estate` (T1), `sources.empty-sources.empty-conversations` (T2)

### Family quotes (level store): 54 items

#### `quotes.accept.exact`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A source file of 10 to 40 lines and tool evidence whose value quotes are verbatim runs of it: at the start, in the middle, at the end, or the whole file.
* Oracle: Every value is in the store with its quote and source path; the store has no refusal.
* Candidate cause C22: a value whose quote appears verbatim in its source file is kept.
* Items: `quotes.accept.exact.at-start` (T1), `quotes.accept.exact.middle` (T1), `quotes.accept.exact.at-end` (T2), `quotes.accept.exact.whole-file` (T2)

#### `quotes.refuse.absent`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A value whose quote is not in its file: unrelated text, text that sits in another file, or a findable quote with one extra word appended.
* Oracle: The value is not in the store and the refusal list names it.
* Candidate cause C23: a value whose normalized quote is absent from its named source is refused.
* Items: `quotes.refuse.absent.unrelated-text` (T1), `quotes.refuse.absent.other-file-text` (T2), `quotes.refuse.absent.extra-word-appended` (T3)

#### `quotes.refuse.unknown-source`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A value whose quote is findable in file A but whose source path is a file the estate does not hold: a missing path, a path that differs only in case, an empty path.
* Oracle: The value is not in the store and the refusal list names it.
* Candidate cause C24: a quote cited from a source path the estate does not hold is refused.
* Items: `quotes.refuse.unknown-source.missing-path` (T1), `quotes.refuse.unknown-source.path-case-differs` (T2), `quotes.refuse.unknown-source.empty-path` (T3)

#### `quotes.refuse.empty-quote`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A value whose quote is the empty string, or only spaces and a tab.
* Oracle: The value is refused although the empty string occurs in every file.
* Candidate cause C25: an empty or blank quote is refused although every file contains it.
* Items: `quotes.refuse.empty-quote.empty` (T2), `quotes.refuse.empty-quote.blank` (T3)

#### `quotes.refuse.inexact`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A findable quote changed a little: written in capitals, first letter in another case, one character inserted, deleted or substituted, two neighbours swapped, one word skipped, or the end of line 1 joined to the start of line 3.
* Oracle: After the documented normalization the quote is still absent; case, punctuation and word order remain significant.
* Candidate cause C23: a value whose normalized quote is absent from its named source is refused.
* Items: `quotes.refuse.inexact.all-caps` (T2), `quotes.refuse.inexact.first-letter-case` (T3), `quotes.refuse.inexact.inserted-char` (T3), `quotes.refuse.inexact.deleted-char` (T3), `quotes.refuse.inexact.substituted-char` (T3), `quotes.refuse.inexact.transposed-chars` (T4), `quotes.refuse.inexact.skipped-word` (T3), `quotes.refuse.inexact.joined-lines` (T4)

#### `quotes.accept.multiline`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A quote that spans two or three lines of a file with LF line ends, or CRLF line ends and the CRLF in the quote.
* Oracle: The value is kept with its quote.
* Candidate cause C27: quote matching folds whitespace runs while keeping the stored quote unchanged.
* Items: `quotes.accept.multiline.lf` (T2), `quotes.accept.multiline.crlf` (T3)

#### `quotes.plain-text-matching`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: H7.
* Generator: Quotes made of pattern characters that occur literally in the file (".*", "(a|b)+", "[0-9]{3}", "\d+"), and quotes that look like patterns matching the file but are not literally in it ("invoice.*total", "a|b").
* Oracle: The literal ones are kept; the lookalikes are refused.
* Candidate cause C28: quotes are matched as plain text, never as patterns.
* Items: `quotes.plain-text-matching.dot-star-literal` (T4), `quotes.plain-text-matching.group-alternation-literal` (T4), `quotes.plain-text-matching.brackets-literal` (T4), `quotes.plain-text-matching.backslash-d-literal` (T4), `quotes.plain-text-matching.dot-star-lookalike` (T5), `quotes.plain-text-matching.alternation-lookalike` (T5)

#### `quotes.accept.unicode`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: H7.
* Generator: Quotes with accents, CJK text, emoji above the basic plane, and right-to-left text, verbatim in the file.
* Oracle: The value is kept with its quote unchanged.
* Candidate cause C29: quote matching applies the documented Unicode and typography normalization.
* Items: `quotes.accept.unicode.accents` (T2), `quotes.accept.unicode.cjk` (T3), `quotes.accept.unicode.emoji` (T4), `quotes.accept.unicode.rtl` (T4)

#### `quotes.per-value-granularity`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A tool field with 3 values where one, two, the first, or all of them have an unfindable quote.
* Oracle: Only the values with an unfindable quote are missing; the others stay; a variable left with no value is not stored.
* Candidate cause C30: refusing a value preserves its valid sibling values.
* Variant all-bad: candidate cause C142: a variable left with no accepted value is dropped.
* Items: `quotes.per-value-granularity.one-of-three` (T3), `quotes.per-value-granularity.two-of-three` (T3), `quotes.per-value-granularity.first-bad` (T3), `quotes.per-value-granularity.all-bad` (T3)

#### `quotes.refusal-report`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: One or two refused values with distinct ids.
* Oracle: The refusal list holds one entry per refused value, naming its id, with a reason that is not empty.
* Candidate cause C31: every refused value is listed with a reason that names it.
* Items: `quotes.refusal-report.one` (T2), `quotes.refusal-report.two` (T3), `quotes.refusal-report.reason-text` (T3)

#### `quotes.owner-conversation-exempt`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P3.
* Generator: An owner value, a value seen in conversations, and an owner value whose words look like a quote that no file holds.
* Oracle: Each is kept with its own provenance; none is refused for lacking a file quote.
* Candidate cause C32: values from the owner and from conversations are kept without a file quote.
* Items: `quotes.owner-conversation-exempt.owner-value` (T2), `quotes.owner-conversation-exempt.conversation-value` (T2), `quotes.owner-conversation-exempt.owner-words-quote-shaped` (T3)

#### `quotes.condition-span-unfindable`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P4.
* Generator: A condition span that is not in its file: edited wording, text of another file, or one character off.
* Oracle: No variable cites the span and the refusal list names it.
* Candidate cause C33: a condition span whose text is not in its source file yields no variable and a refusal.
* Items: `quotes.condition-span-unfindable.edited-wording` (T3), `quotes.condition-span-unfindable.wrong-file` (T3), `quotes.condition-span-unfindable.one-char-off` (T4)

#### `quotes.stored-verbatim`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: P3.
* Generator: Findable quotes with leading and trailing spaces, or a trailing newline.
* Oracle: The stored quote and source path are the given ones, byte for byte.
* Candidate cause C34: the stored quote and source path are the given ones, byte for byte.
* Items: `quotes.stored-verbatim.plain` (T2), `quotes.stored-verbatim.padded-spaces` (T4), `quotes.stored-verbatim.trailing-newline` (T4)

#### `quotes.never-reads-disk`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: H7.
* Generator: A quote ("localhost") with the source path "/etc/hosts", a path with "../" segments, and an absolute path, none of them among the given files.
* Oracle: The value is refused: quotes are looked up in the given files only.
* Candidate cause C35: quotes are looked up in the given files only, never on disk.
* Items: `quotes.never-reads-disk.etc-hosts` (T4), `quotes.never-reads-disk.traversal` (T4), `quotes.never-reads-disk.absolute-path` (T5)

#### `quotes.large-files`

* Component: `store/quotes` (checking that a quote is findable in its source file). Serves: H4.
* Generator: A 100 KB file and a 1 MB file with the quote near the end, and 2,000 values quoted from one 1 MB file.
* Oracle: Every value is kept and the call takes at most 3 s of processor time.
* Candidate cause C36: quote verification stays linear in file size and in values.
* Items: `quotes.large-files.hundred-kb` (T4), `quotes.large-files.one-mb` (T5), `quotes.large-files.two-thousand-values` (T5)

### Family values (level store): 33 items

#### `values.ids.variable-grammar`

* Component: `store/ids` (turning names into ids and keeping ids unique). Serves: M1. Assumes: A9.
* Generator: Condition spans whose quantity noun has capitals and spaces ("Invoice Total"), punctuation ("Customer's age (days)"), a leading digit ("24h response window"), or non-ASCII letters.
* Oracle: Every variable id matches ^[A-Za-z0-9][A-Za-z0-9._-]*$ (the format's id rule) and the variable still cites its span.
* Candidate cause C37: variable ids are normalised to the id grammar of the variable store format.
* Items: `values.ids.variable-grammar.spaces-and-caps` (T2), `values.ids.variable-grammar.punctuation` (T3), `values.ids.variable-grammar.leading-digit` (T4), `values.ids.variable-grammar.unicode-letters` (T4)

#### `values.ids.value-grammar`

* Component: `store/ids` (turning names into ids and keeping ids unique). Serves: M1. Assumes: A9.
* Generator: Owner values and tool values whose given ids contain spaces, a leading symbol, slashes or quotes ("very high!", "/etc/x").
* Oracle: Every value id matches ^[A-Za-z0-9][A-Za-z0-9_.-]*$ and the value keeps its provenance (the owner's words, the quote).
* Candidate cause C38: value ids are normalised to the value id grammar.
* Items: `values.ids.value-grammar.owner-values` (T2), `values.ids.value-grammar.tool-values` (T3), `values.ids.value-grammar.hostile-characters` (T4)

#### `values.ids.stable`

* Component: `store/ids` (turning names into ids and keeping ids unique). Serves: P9.
* Generator: The same sources built twice in a row, and built again after an unrelated store was built in between.
* Oracle: Every variable and value id of the first store appears in the second, for the same span or quote.
* Candidate cause C39: ids derive from the text alone, with no counter shared between calls.
* Items: `values.ids.stable.two-calls` (T2), `values.ids.stable.after-other-build` (T3)

#### `values.ids.collisions`

* Component: `store/ids` (turning names into ids and keeping ids unique). Serves: P1.
* Generator: Two value ids that normalise to the same id ("very high", "very-high"), two quantity nouns that normalise to the same id ("Order #", "order"), and three-way collisions.
* Oracle: Every input still has its own value or variable (found by its quote), and ids are unique inside their scope.
* Candidate cause C40: colliding ids are disambiguated, never merged or dropped.
* Items: `values.ids.collisions.value-collision` (T3), `values.ids.collisions.variable-collision` (T3), `values.ids.collisions.three-way` (T4)

#### `values.owner-adds-to-existing`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P2.
* Generator: A base store with 2 to 4 values on a variable; the owner adds one or two values to it.
* Oracle: The new values are on that variable; the old values and their provenance are unchanged; no other variable changed.
* Candidate cause C41: an owner value joins its variable and leaves the other values unchanged.
* Items: `values.owner-adds-to-existing.appended` (T1), `values.owner-adds-to-existing.others-unchanged` (T3), `values.owner-adds-to-existing.order-kept` (T3)

#### `values.owner-value-already-present`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P3.
* Generator: The owner names a value id the variable already has, once or twice.
* Oracle: The variable holds that value once; it carries its earlier provenance and an owner provenance for each owner entry.
* Candidate cause C42: an owner value that exists gains the owner provenance instead of a duplicate.
* Items: `values.owner-value-already-present.same-id` (T2), `values.owner-value-already-present.same-id-twice` (T3)

#### `values.hostile-names`

* Component: `store/ids` (turning names into ids and keeping ids unique). Serves: H7.
* Generator: A tool field called "constructor", "toString" or "hasOwnProperty", a value called "constructor", and a quantity noun that reads "__proto__".
* Oracle: The store holds the variable or value as an ordinary entry (or a grammar-valid id for the noun), no prototype is polluted, and nothing throws.
* Candidate cause C43: variable and value tables are built without prototype keys.
* Items: `values.hostile-names.constructor-variable` (T5), `values.hostile-names.to-string-variable` (T5), `values.hostile-names.has-own-property-variable` (T5), `values.hostile-names.proto-like-noun` (T5), `values.hostile-names.constructor-value` (T5)

#### `values.large-variable`

* Component: `store/ids` (turning names into ids and keeping ids unique). Serves: H4.
* Generator: A variable that the owner extends with 2,000 or 10,000 values.
* Oracle: All values are kept with unique ids and the call takes at most 3 s of processor time.
* Candidate cause C44: a variable can hold thousands of values without quadratic work.
* Items: `values.large-variable.two-thousand-values` (T4), `values.large-variable.ten-thousand-values` (T5)

#### `values.unapproved-not-planned`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P2. Assumes: A5.
* Generator: A hand-built store of shared axes and a rule, plus a value or a variable a machine proposed (approved false, conversations counts as provenance); the same value flagged approved true; a proposed value that an impossible pair names.
* Oracle: No plan row holds the proposed value or assigns the proposed variable, and no required tuple names them; once approved the value is in rows and every tuple that names it is covered.
* Candidate cause C45: the planner uses only approved values and variables (the machine proposes, a person approves).
* Items: `values.unapproved-not-planned.proposed-value` (T3), `values.unapproved-not-planned.proposed-variable` (T3), `values.unapproved-not-planned.proposed-value-in-a-pair` (T4), `values.unapproved-not-planned.approved-later` (T3)

#### `values.fresh-objects`

* Component: `store/merge` (merging the three sources and keeping every provenance). Serves: H7.
* Generator: A store is built, written to, then the same sources are built again.
* Oracle: Writing to the first result changes neither the sources nor the second result: nothing is shared.
* Candidate cause C46: buildStore returns objects that share nothing with its input or with an earlier result.
* Items: `values.fresh-objects.output-mutation-safe` (T3), `values.fresh-objects.two-builds-independent` (T3)

#### `values.input-not-mutated`

* Component: `store/merge` (merging the three sources and keeping every provenance). Serves: P9.
* Generator: Deeply frozen estate input, session list or owner input.
* Oracle: The call does not throw and the input is unchanged.
* Candidate cause C47: buildStore never writes to its input.
* Items: `values.input-not-mutated.estate` (T3), `values.input-not-mutated.conversations` (T3), `values.input-not-mutated.owner` (T3)

### Family boundaries (level store): 55 items

#### `boundaries.greater-than`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2. Assumes: A11.
* Generator: Renders "<the quantity> <greater-than wording> <N><unit>" for over, more than, exceeds, greater than and >, with the threshold N from the seed.
* Oracle: One variable cites the span; it holds exactly three values whose samples satisfy s1 < N, s2 = N, s3 > N (integers when N is an integer); each cites the span. For gt, ge, lt and le the variable carries a boundaries entry with limit N, the comparison, and holds, fails and edge naming three distinct values: the edge has the sample N, holds a sample where the condition holds, fails one where it does not (docs/variables.md).
* Candidate cause C48: the estate source reads the greater-than wordings (over, more than, exceeds, greater than, >).
* Items: `boundaries.greater-than.over` (T1), `boundaries.greater-than.more-than` (T1), `boundaries.greater-than.exceeds` (T2), `boundaries.greater-than.greater-than` (T2), `boundaries.greater-than.symbol` (T3)

#### `boundaries.at-least`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2. Assumes: A11.
* Generator: Renders "<the quantity> <at-least wording> <N><unit>" for at least, no less than, N or more and >=, with the threshold N from the seed.
* Oracle: One variable cites the span; it holds exactly three values whose samples satisfy s1 < N, s2 = N, s3 > N (integers when N is an integer); each cites the span. For gt, ge, lt and le the variable carries a boundaries entry with limit N, the comparison, and holds, fails and edge naming three distinct values: the edge has the sample N, holds a sample where the condition holds, fails one where it does not (docs/variables.md).
* Candidate cause C49: the estate source reads the at-least wordings (at least, no less than, N or more, >=).
* Items: `boundaries.at-least.at-least` (T1), `boundaries.at-least.no-less-than` (T2), `boundaries.at-least.or-more` (T3), `boundaries.at-least.symbol` (T3)

#### `boundaries.less-than`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2. Assumes: A11.
* Generator: Renders "<the quantity> <less-than wording> <N><unit>" for under, below, fewer than and <, with the threshold N from the seed.
* Oracle: One variable cites the span; it holds exactly three values whose samples satisfy s1 < N, s2 = N, s3 > N (integers when N is an integer); each cites the span. For gt, ge, lt and le the variable carries a boundaries entry with limit N, the comparison, and holds, fails and edge naming three distinct values: the edge has the sample N, holds a sample where the condition holds, fails one where it does not (docs/variables.md).
* Candidate cause C50: the estate source reads the less-than wordings (under, below, fewer than, <).
* Items: `boundaries.less-than.under` (T1), `boundaries.less-than.below` (T1), `boundaries.less-than.fewer-than` (T2), `boundaries.less-than.symbol` (T3)

#### `boundaries.at-most`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2. Assumes: A11.
* Generator: Renders "<the quantity> <at-most wording> <N><unit>" for at most, no more than, N or fewer and <=, with the threshold N from the seed.
* Oracle: One variable cites the span; it holds exactly three values whose samples satisfy s1 < N, s2 = N, s3 > N (integers when N is an integer); each cites the span. For gt, ge, lt and le the variable carries a boundaries entry with limit N, the comparison, and holds, fails and edge naming three distinct values: the edge has the sample N, holds a sample where the condition holds, fails one where it does not (docs/variables.md).
* Candidate cause C51: the estate source reads the at-most wordings (at most, no more than, N or fewer, <=).
* Items: `boundaries.at-most.at-most` (T1), `boundaries.at-most.no-more-than` (T2), `boundaries.at-most.or-fewer` (T3), `boundaries.at-most.symbol` (T3)

#### `boundaries.equal`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2. Assumes: A11.
* Generator: Renders "<the quantity> <equal wording> <N><unit>" for exactly, equals and ==, with the threshold N from the seed.
* Oracle: One variable cites the span; it holds exactly three values whose samples satisfy s1 < N, s2 = N, s3 > N (integers when N is an integer); each cites the span. For gt, ge, lt and le the variable carries a boundaries entry with limit N, the comparison, and holds, fails and edge naming three distinct values: the edge has the sample N, holds a sample where the condition holds, fails one where it does not (docs/variables.md).
* Candidate cause C52: the estate source reads the equality wordings (exactly, equals, ==).
* Items: `boundaries.equal.exactly` (T1), `boundaries.equal.equals` (T2), `boundaries.equal.symbol` (T3)

#### `boundaries.not-equal`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2. Assumes: A11.
* Generator: Renders "<the quantity> <not-equal wording> <N><unit>" for not equal to, other than and !=, with the threshold N from the seed.
* Oracle: One variable cites the span; it holds exactly three values whose samples satisfy s1 < N, s2 = N, s3 > N (integers when N is an integer); each cites the span. For gt, ge, lt and le the variable carries a boundaries entry with limit N, the comparison, and holds, fails and edge naming three distinct values: the edge has the sample N, holds a sample where the condition holds, fails one where it does not (docs/variables.md).
* Candidate cause C53: the estate source reads the inequality wordings (not equal to, other than, !=).
* Items: `boundaries.not-equal.not-equal-to` (T2), `boundaries.not-equal.other-than` (T3), `boundaries.not-equal.symbol` (T3)

#### `boundaries.range`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: Renders "between A and B", "from A to B" and a range of negative numbers, with A < B from the seed.
* Oracle: One variable cites the span; its samples include one below A, A itself, one strictly between, B itself and one above B.
* Candidate cause C54: a range condition yields both edges and a value inside and outside.
* Items: `boundaries.range.between-and` (T3), `boundaries.range.from-to` (T3), `boundaries.range.negative-range` (T5)

#### `boundaries.decimal`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: Thresholds written with decimals: 0.5, 12.75, 3.0, 0.3.
* Oracle: The boundary sample equals the written threshold exactly (Number of the text); s1 < t < s3.
* Candidate cause C55: decimal thresholds are read exactly.
* Items: `boundaries.decimal.half` (T2), `boundaries.decimal.two-places` (T2), `boundaries.decimal.whole-as-decimal` (T3), `boundaries.decimal.tenth-float` (T4)

#### `boundaries.negative`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: Thresholds below zero: "below -5 degrees", "more than -0.5".
* Oracle: The boundary sample is the negative threshold; s1 < t < s3.
* Candidate cause C56: a negative threshold keeps its sign.
* Items: `boundaries.negative.minus-sign` (T3), `boundaries.negative.negative-decimal` (T4)

#### `boundaries.zero`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: "more than 0 attempts" and "no more than 0 retries".
* Oracle: The boundary sample is 0; s1 < 0 < s3 (a falsy threshold is still a threshold).
* Candidate cause C57: a zero threshold is a threshold.
* Items: `boundaries.zero.more-than-zero` (T3), `boundaries.zero.at-most-zero` (T4)

#### `boundaries.thousands-separator`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: Thresholds written "1,000", "10,000,000" and "1 000" with a no-break space.
* Oracle: The boundary sample equals the number without separators.
* Candidate cause C58: thousands separators belong to the number.
* Items: `boundaries.thousands-separator.comma` (T3), `boundaries.thousands-separator.several-groups` (T3), `boundaries.thousands-separator.thin-space` (T4)

#### `boundaries.large-number`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: Thresholds 1000000000, 2147483648 and 1000000000000.
* Oracle: The boundary sample equals the threshold; s1 < t < s3 (no wrap at 32 bits).
* Candidate cause C59: thresholds beyond 32 bits are read without overflow.
* Items: `boundaries.large-number.billion` (T3), `boundaries.large-number.above-32-bits` (T4), `boundaries.large-number.trillion` (T4)

#### `boundaries.units`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: The same threshold with a unit word ("500 euros", "5 minutes"), a percent sign ("80%"), or a currency sign ("EUR 500", "$500").
* Oracle: The boundary sample is the number; the unit does not change it.
* Candidate cause C60: unit words and currency signs around the number do not change the threshold.
* Items: `boundaries.units.euros` (T1), `boundaries.units.percent` (T2), `boundaries.units.minutes` (T2), `boundaries.units.currency-prefix` (T3)

#### `boundaries.number-words`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: "at least three retries", "more than twenty-five items", "over one hundred pages".
* Oracle: The boundary sample is the number the words name.
* Candidate cause C61: number words are read as numbers.
* Items: `boundaries.number-words.three` (T3), `boundaries.number-words.twenty-five` (T4), `boundaries.number-words.one-hundred` (T5)

#### `boundaries.merge-thresholds`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2.
* Generator: Two spans over one quantity: thresholds far apart; thresholds one apart so their samples overlap; one threshold in two spans with different comparators.
* Oracle: One variable; the samples are the union of the samples each span requires, with no duplicate sample; every span's three requirements hold.
* Candidate cause C62: values from several spans of one variable are merged without duplicate samples.
* Items: `boundaries.merge-thresholds.far-apart` (T3), `boundaries.merge-thresholds.adjacent-overlap` (T4), `boundaries.merge-thresholds.same-threshold-two-comparators` (T3)

#### `boundaries.integer-samples`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P2. Assumes: A11.
* Generator: Integer thresholds on counts ("3 retries"), money ("500 euros") and percentages ("80%").
* Oracle: All three samples are integers.
* Candidate cause C63: an integer threshold gets integer samples on both sides.
* Items: `boundaries.integer-samples.count-noun` (T2), `boundaries.integer-samples.money` (T2), `boundaries.integer-samples.percent` (T3)

#### `boundaries.cites-span`

* Component: `store/boundaries` (the two sides and the boundary of a condition). Serves: P3.
* Generator: One numeric span in a file with a source path.
* Oracle: Each of the three values has a quote provenance whose source path is the file and whose quote is findable in it and overlaps the span.
* Candidate cause C64: the quote of a boundary value is the span text copied from its file, with the path of the file.
* Items: `boundaries.cites-span.each-value-cites` (T2), `boundaries.cites-span.quote-findable` (T3)

### Family impossible-pairs (level constraints): 32 items

#### `impossible.rows-avoid-pairs`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P8.
* Generator: A space of 2 to 8 variables with 1 to 3 impossible pairs, on plain variables, on shared axes, or inside a rule's variables.
* Oracle: No plan row holds both values of any impossible pair.
* Candidate cause C65: plan rows never hold two values the store marks impossible.
* Items: `impossible.rows-avoid-pairs.two-variables` (T1), `impossible.rows-avoid-pairs.five-variables` (T1), `impossible.rows-avoid-pairs.three-pairs` (T2), `impossible.rows-avoid-pairs.pair-on-shared-axes` (T2), `impossible.rows-avoid-pairs.pair-inside-rule` (T2)

#### `impossible.required-tuples-skip-pairs`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P8. Assumes: A2.
* Generator: A pair that sits inside one rule group, inside the shared axes, or between two groups; and six variables of arity 3 to 4 where 30, 50 or 70 percent of the pairs among non-universal values are impossible.
* Oracle: Every allowed required tuple (tuples with no impossible pair) is covered, checked by exhaustive enumeration; the plan ends; no row holds a pair.
* Candidate cause C66: required tuples exclude those that hold an impossible pair.
* Items: `impossible.required-tuples-skip-pairs.inside-rule-group` (T2), `impossible.required-tuples-skip-pairs.inside-axes` (T2), `impossible.required-tuples-skip-pairs.across-groups` (T3), `impossible.required-tuples-skip-pairs.dense-thirty-percent` (T3), `impossible.required-tuples-skip-pairs.dense-fifty-percent` (T4), `impossible.required-tuples-skip-pairs.dense-seventy-percent` (T5)

#### `impossible.unordered`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P8.
* Generator: The same pair declared as (a, b) and as (b, a), alone and mixed with other pairs.
* Oracle: The plan equals the plan of the store that declares the pair the other way round.
* Candidate cause C67: an impossible pair is unordered.
* Items: `impossible.unordered.reversed` (T2), `impossible.unordered.mixed-order` (T3)

#### `impossible.duplicates-count-once`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P8.
* Generator: A pair declared three times, and in both orders.
* Oracle: The plan equals the plan of the store that declares the pair once.
* Candidate cause C68: repeated impossible pairs count once.
* Items: `impossible.duplicates-count-once.thrice` (T2), `impossible.duplicates-count-once.both-orders` (T3)

#### `impossible.same-variable-pair`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P8.
* Generator: A pair of two values of one variable, on a plain variable and on a variable of a rule.
* Oracle: The plan equals the plan without the pair: one variable never holds two values in a row.
* Candidate cause C69: a pair of two values of one variable changes nothing.
* Items: `impossible.same-variable-pair.two-values-of-one-variable` (T2), `impossible.same-variable-pair.inside-rule` (T3)

#### `impossible.unknown-reference`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P2. Assumes: A10.
* Generator: Owner pairs that name an unknown variable, an unknown value of a known variable, or both.
* Oracle: The pair is not in the store and the refusal list names it with a reason.
* Candidate cause C70: an owner pair that names an unknown variable or value is refused with a reason.
* Items: `impossible.unknown-reference.unknown-variable` (T3), `impossible.unknown-reference.unknown-value` (T3), `impossible.unknown-reference.both-unknown` (T3)

#### `impossible.forced-out-value`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P8. Assumes: A2.
* Generator: A value that every value of another variable forbids: directly, through a chain of two pairs, or inside a rule group.
* Oracle: The value is in no row; no tuple that holds it is required; every other allowed required tuple is covered.
* Candidate cause C71: a value that no partner value allows is never used and never required.
* Items: `impossible.forced-out-value.one-step` (T3), `impossible.forced-out-value.two-step-chain` (T4), `impossible.forced-out-value.in-rule-group` (T4)

#### `impossible.unsatisfiable-space`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P8. Assumes: A6.
* Generator: Two single-valued variables whose only values are forbidden together; a cycle of pairs with no valid row.
* Oracle: The plan has no new row, or the call throws an error that names a conflicting variable; it ends within 10 s.
* Candidate cause C72: a space with no valid row yields no rows or a named error, never an invalid row.
* Items: `impossible.unsatisfiable-space.two-single-valued` (T3), `impossible.unsatisfiable-space.cycle` (T5)

#### `impossible.tight-chain`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: H7. Assumes: A2.
* Generator: Spaces where few rows are valid: eight binary variables whose neighbours must differ (2 valid rows), five ternary variables whose neighbours must differ, six variables of which exactly one is on; a hub value compatible with one partner of every other variable; a value that excludes all but one value of another variable.
* Oracle: Every row is valid and every allowed required tuple is covered (the required set comes from the valid rows).
* Candidate cause C73: row construction completes tightly constrained rows by search, not by chance.
* Items: `impossible.tight-chain.alternating-binary` (T5), `impossible.tight-chain.no-equal-neighbours-ternary` (T5), `impossible.tight-chain.exactly-one-of` (T5), `impossible.tight-chain.hub-one-partner` (T4), `impossible.tight-chain.one-value-excludes-all-but-one` (T4)

#### `impossible.with-seeds`

* Component: `planner/constraints` (impossible pairs in the plan and in the required tuples). Serves: P6.
* Generator: Valid seed rows, some of them one value away from an impossible pair, on a constrained space.
* Oracle: Seeds lead the plan unchanged; no new row holds a pair; the allowed required tuples are covered.
* Candidate cause C74: new rows next to seeds still avoid impossible pairs.
* Items: `impossible.with-seeds.valid-seeds` (T3), `impossible.with-seeds.seeds-next-to-forbidden` (T4)

### Family weights (level constraints): 44 items

#### `weights.relative-frequency`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P2.
* Generator: Sessions drawn from a planted mix on 1 to 10 variables of a base store built from tool evidence; the counts are known.
* Oracle: Each value's weight is within 1 / (of + 2) of seen / of, where of counts the sessions that observe its variable (so smoothing is allowed, a wrong denominator is not).
* Candidate cause C75: a value's weight is its share of the sessions that observe its variable.
* Items: `weights.relative-frequency.single-variable` (T1), `weights.relative-frequency.five-values-skewed` (T2), `weights.relative-frequency.ten-variables` (T2), `weights.relative-frequency.thousand-sessions` (T3)

#### `weights.complete-and-relative`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P2. Assumes: A5.
* Generator: Sessions on a variable whose values are all seen, one value never seen, and one value added by the sessions.
* Oracle: Every value of the variable has a weight (the format: all values or none), the weights are not all 0, the shares weight over total weight add up to 1, and each share agrees with the value's conversations count over total within 1 over (total + 2).
* Candidate cause C76: a variable seen in conversations weighs every one of its values, in proportion to the counts.
* Items: `weights.complete-and-relative.all-seen` (T2), `weights.complete-and-relative.unseen-value` (T3), `weights.complete-and-relative.new-value` (T3)

#### `weights.interval-holds-estimate`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P11.
* Generator: weightInterval(count, total) for (7, 50), (25, 50), (1, 50), (49, 50), (333, 1000); for (0, 1) and (1, 1); for (20, 20), (0, 20), (1000, 1000).
* Oracle: For every call, 0 <= lower <= count / total <= upper <= 1 and all are finite.
* Candidate cause C77: the weight interval is clamped to 0..1 and holds the weight.
* Items: `weights.interval-holds-estimate.ordinary` (T2), `weights.interval-holds-estimate.one-session` (T3), `weights.interval-holds-estimate.all-same` (T3)

#### `weights.interval-coverage`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P11.
* Generator: Replicate draws (400 to 600 per design) of the count of n sessions that show a value of planted share p, then weightInterval(count, n): (p, n) = (0.5, 100), (0.5, 20), (0.1, 50), (0.02, 100), (0.02, 1000), (0.005, 500), (0.95, 40), (0.998, 300).
* Oracle: The count of replicates whose interval holds p is at least the threshold set from the exact Wilson coverage at (p, n) minus 0.03 minus 5.5 standard deviations.
* Candidate cause C78: the weight interval formula keeps rare shares covered (a score or exact interval, not the normal approximation).
* Items: `weights.interval-coverage.half-n100` (T3), `weights.interval-coverage.half-n20` (T4), `weights.interval-coverage.tenth-n50` (T4), `weights.interval-coverage.two-percent-n100` (T5), `weights.interval-coverage.two-percent-n1000` (T4), `weights.interval-coverage.half-percent-n500` (T5), `weights.interval-coverage.ninety-five-n40` (T4), `weights.interval-coverage.near-one-n300` (T5)

#### `weights.interval-width`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P11.
* Generator: weightInterval at counts that match the share exactly: 50 of 100, 100 of 1000, 6 of 30; and 18 of 60 against 180 of 600.
* Oracle: The width is at most 1.5 times the Wilson width and at least 0.6 times it; ten times the sessions narrow it by a factor between 2.2 and 4.5.
* Candidate cause C79: the weight interval is computed from the counts, so it narrows as sessions grow.
* Items: `weights.interval-width.n100` (T3), `weights.interval-width.n1000` (T3), `weights.interval-width.n30` (T4), `weights.interval-width.tenfold-sessions-shrinks` (T4)

#### `weights.interval-level`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P11.
* Generator: weightInterval(200, 400) and weightInterval(200, 2000).
* Oracle: The half-width is within 15 percent of the 95 percent Wilson half-width.
* Candidate cause C80: the weight interval uses the 95 percent critical value 1.96.
* Items: `weights.interval-level.n400-half` (T3), `weights.interval-level.n2000-tenth` (T3)

#### `weights.zero-count`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P11.
* Generator: A value of the store that no session shows, among 20, 60 or 1,000 sessions, alone or beside seen values.
* Oracle: Its share of the variable's weight is at most 1 / (n + 2); its conversations entry reads 0 of n; weightInterval(0, n) has a lower bound of 0 and an upper bound above 0.
* Candidate cause C81: a value never seen keeps a share near 0 and an interval from 0 to a bound above 0.
* Items: `weights.zero-count.n20` (T2), `weights.zero-count.n1000` (T3), `weights.zero-count.among-seen` (T3)

#### `weights.all-sessions-one-value`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P11.
* Generator: 10 or 1,000 sessions that all show the same value.
* Oracle: Its share is at least 1 - 1 / (n + 2); weightInterval(n, n) has an upper bound of 1 and a lower bound below 1.
* Candidate cause C82: a value seen in every session has an upper bound of 1 and a lower bound below 1.
* Items: `weights.all-sessions-one-value.n10` (T2), `weights.all-sessions-one-value.n1000` (T3)

#### `weights.no-observation`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: H7.
* Generator: No session at all, sessions that never observe one variable, and owner weights on every value of a variable no session shows.
* Oracle: No weight is NaN, infinite or negative; a variable no session observes has no weight or equal weights; owner weights stay as declared; weightInterval(0, 1) is a finite interval with width inside 0 to 1.
* Candidate cause C83: a variable with no observation gets no NaN weight and no made-up weights.
* Items: `weights.no-observation.no-sessions` (T2), `weights.no-observation.unobserved-variable` (T3), `weights.no-observation.owner-only` (T3)

#### `weights.recovered-mix`

* Component: `store/weights` (weights and their 95 percent intervals). Serves: P11.
* Generator: 400 replicate draws of n sessions from a planted mix of 4 values, of 12 skewed values, and of 15 sessions.
* Oracle: The mean weight of each value over the replicates is within 5.5 standard errors (plus 0.003) of the planted share.
* Candidate cause C84: weights are not biased away from the planted mix.
* Items: `weights.recovered-mix.four-values` (T3), `weights.recovered-mix.twelve-skewed` (T4), `weights.recovered-mix.small-n` (T4)

#### `weights.owner-kept-exactly`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: P2.
* Generator: Owner weights for every value of a variable: (0.25, 0.5, 0.25), three thirds (1/3), (1e-9, 0.5, 0.5), and (60, 15, 25), a relative scale.
* Oracle: Each stored weight equals the declared one exactly (weights are relative, so 60 is valid).
* Candidate cause C85: an owner weight is stored exactly as declared.
* Items: `weights.owner-kept-exactly.quarter` (T2), `weights.owner-kept-exactly.third` (T3), `weights.owner-kept-exactly.tiny` (T4), `weights.owner-kept-exactly.percent-scale` (T3)

#### `weights.owner-invalid-refused`

* Component: `store/owner` (taking missing values, impossible pairs and weights from the owner). Serves: M1.
* Generator: Owner weights -0.1, null, NaN, Infinity and the string "0.5".
* Oracle: The weight is not stored and the refusal list names it with a reason.
* Candidate cause C86: an owner weight that is not a finite number from 0 up is refused with a reason.
* Items: `weights.owner-invalid-refused.negative` (T3), `weights.owner-invalid-refused.null` (T3), `weights.owner-invalid-refused.nan` (T4), `weights.owner-invalid-refused.infinity` (T4), `weights.owner-invalid-refused.string` (T4)

### Family strength (level strength): 43 items

#### `strength.others-at-one`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: Variables in no rule and no shared axis: 3 binary, 10 of arity 2 to 5, a single variable, a variable of arity 1.
* Oracle: Every value of every variable is held by some row (brute force over the rows).
* Candidate cause C98: variables outside every rule and axis are covered at strength 1.
* Items: `strength.others-at-one.three-variables` (T1), `strength.others-at-one.mixed-arity` (T2), `strength.others-at-one.single-variable` (T1), `strength.others-at-one.arity-one` (T1)

#### `strength.others-economy`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: 30 or 100 variables of arity 5, none in a rule or an axis.
* Oracle: The plan has at most 2 x 5 rows (strength 1 needs 5): pairs on these variables are not required.
* Candidate cause C99: variables outside the rules and axes cost rows by arity only.
* Items: `strength.others-economy.thirty-variables` (T3), `strength.others-economy.hundred-variables` (T4)

#### `strength.axes-at-two`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: Shared axes only: 3 axes of arity 2, 3, 4; 6 axes; 6 axes with one of arity 1; 12 binary axes; one axis of 7, 1 or 20 values beside three binary axes.
* Oracle: Every allowed pair of values of every pair of axes is held by some row; rows are within the greedy bound.
* Candidate cause C100: shared axes are covered at strength 2.
* Items: `strength.axes-at-two.three-axes` (T2), `strength.axes-at-two.six-axes` (T3), `strength.axes-at-two.six-axes-one-single-valued` (T3), `strength.axes-at-two.twelve-binary` (T4), `strength.axes-at-two.one-axis-of-seven` (T3), `strength.axes-at-two.one-axis-of-one` (T2), `strength.axes-at-two.one-axis-of-twenty` (T4)

#### `strength.rule-at-three`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: One rule with 3 variables; 4 binary; 5 ternary; 7 binary; 4 of mixed arity; 12 binary; 4 quaternary.
* Oracle: Every allowed triple of values of every 3 of the rule's variables is held by some row; rows are within the greedy bound.
* Candidate cause C101: each rule's own variables are covered at strength 3.
* Items: `strength.rule-at-three.three-variables` (T2), `strength.rule-at-three.four-binary` (T2), `strength.rule-at-three.five-ternary` (T3), `strength.rule-at-three.seven-binary` (T3), `strength.rule-at-three.mixed-arity` (T3), `strength.rule-at-three.four-quaternary` (T3), `strength.rule-at-three.twelve-binary` (T4)

#### `strength.small-groups`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5. Assumes: A8.
* Generator: A rule with 2 variables of arity 3 and 4, a rule with 1 variable, a rule with none.
* Oracle: The full cross product of the rule's variables is covered; a rule with no variable changes nothing; no call throws.
* Candidate cause C102: a group smaller than its strength is covered in full.
* Items: `strength.small-groups.two-variables` (T2), `strength.small-groups.one-variable` (T1), `strength.small-groups.no-variable` (T2)

#### `strength.overlapping-rules`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: Two rules of 4 variables that share 2 variables, and two rules that share 3.
* Oracle: The triples of both rules are covered, each shared triple once; rows are within the bound of the union.
* Candidate cause C103: rules that share variables are covered on the union of their triples.
* Items: `strength.overlapping-rules.share-two` (T3), `strength.overlapping-rules.share-three` (T4)

#### `strength.axis-in-rule`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: A rule whose variables include one shared axis, and a rule made only of shared axes.
* Oracle: The pairs of the axes and the triples of the rule are all covered.
* Candidate cause C104: a variable that is both an axis and a rule variable meets both strengths.
* Items: `strength.axis-in-rule.one-shared` (T3), `strength.axis-in-rule.all-shared` (T4)

#### `strength.no-uniform-explosion`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: 10, then 40 rules of 4 binary variables each, plus 10 shared axes and 20 other variables.
* Oracle: Every required tuple is covered and the rows stay within 1.25 x the greedy bound of the required set: strength 3 across all variables would need many times more.
* Candidate cause C105: strength 3 applies only inside a rule's own variables.
* Items: `strength.no-uniform-explosion.ten-rules` (T3), `strength.no-uniform-explosion.mixed-groups` (T4), `strength.no-uniform-explosion.forty-rules` (T5)

#### `strength.row-economy`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: One rule of 6 binary, 5 ternary, 4 quaternary or 8 binary variables.
* Oracle: The rows are fewer than 0.6 of the full product and within the greedy bound: a covering array, not the product.
* Candidate cause C106: rows are chosen to cover many uncovered tuples at once, not by taking the full product.
* Items: `strength.row-economy.six-binary` (T3), `strength.row-economy.five-ternary` (T3), `strength.row-economy.four-quaternary` (T4), `strength.row-economy.eight-binary` (T4)

#### `strength.rows-complete-and-valid`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P5.
* Generator: Small spaces, spaces with rules and axes, spaces of mixed arity.
* Oracle: Every new row has exactly the store's variables as keys, each with one of its listed values.
* Candidate cause C107: each new row holds exactly one valid value for every variable.
* Items: `strength.rows-complete-and-valid.small` (T1), `strength.rows-complete-and-valid.rules-and-axes` (T2), `strength.rows-complete-and-valid.mixed-arity` (T3)

#### `strength.report-matches-counter`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: P12.
* Generator: Spaces of axes only, of rules only, and of both with seeds.
* Oracle: The plan report's allowed and covered counts equal the independent brute-force counts of the required tuples and of the tuples the plan covers.
* Candidate cause C108: the plan report counts allowed and covered tuples exactly.
* Items: `strength.report-matches-counter.axes` (T3), `strength.report-matches-counter.rules` (T3), `strength.report-matches-counter.mixed` (T4)

#### `strength.any-seed-integer`

* Component: `planner/strength` (variable-strength covering: strength 3, 2 and 1). Serves: H7.
* Generator: The seed option 0, -1, 2147483648 and 9007199254740991 on a space with rules and axes.
* Oracle: The plan covers every allowed required tuple under each seed.
* Candidate cause C109: any integer seed gives a complete array.
* Items: `strength.any-seed-integer.zero` (T2), `strength.any-seed-integer.negative` (T3), `strength.any-seed-integer.large` (T4)

### Family seed-rows (level plan-order): 30 items

#### `seeds.lead-the-plan`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P6.
* Generator: 1, 5 or 30 seed rows; partial seeds that leave variables out; seeds whose traffic weights would reorder them; seeds whose keys come in another order.
* Oracle: The first rows of the plan are the seeds, in the order given, marked as seeds, with the very values given (no key added, none dropped); every later row is marked new.
* Candidate cause C110: seed rows lead the plan, in the order given, unchanged, marked as seeds.
* Items: `seeds.lead-the-plan.one-seed` (T1), `seeds.lead-the-plan.five-seeds` (T1), `seeds.lead-the-plan.thirty-seeds` (T2), `seeds.lead-the-plan.partial-seeds` (T3), `seeds.lead-the-plan.weights-would-reorder` (T3), `seeds.lead-the-plan.key-order-differs` (T3)

#### `seeds.new-rows-for-missing`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P6.
* Generator: Seeds that cover about 30, 50 or 90 percent of the required tuples, or all but the rare tuples; 3 random seeds; seeds that already cover every required tuple (all valid rows of a small space of binary axes, of a rule, of a mixed space).
* Oracle: Seeds plus new rows cover every required tuple; each new row holds at least one required tuple that no seed holds (so full seeds give no new row); the new rows number at most 1.25 x the greedy bound of the tuples the seeds miss, plus one, and fewer than the plan without seeds.
* Candidate cause C111: new rows are added only for tuples the seeds miss, each covering at least one.
* Items: `seeds.new-rows-for-missing.random-three-seeds` (T2), `seeds.new-rows-for-missing.full-seeds-binary-axes` (T2), `seeds.new-rows-for-missing.full-seeds-rule-triples` (T3), `seeds.new-rows-for-missing.full-seeds-mixed` (T3), `seeds.new-rows-for-missing.thirty-percent-covered` (T3), `seeds.new-rows-for-missing.half-covered` (T3), `seeds.new-rows-for-missing.ninety-percent-covered` (T3), `seeds.new-rows-for-missing.rare-tuples-only` (T4), `seeds.new-rows-for-missing.mostly-covered` (T4)

#### `seeds.partial-rows-credit`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P6.
* Generator: Partial seeds that assign only some variables; a seed that assigns two of the three variables of a rule.
* Oracle: A seed credits only the tuples whose variables it assigns: the tuples it cannot hold are covered by new rows.
* Candidate cause C112: a seed row covers only the tuples whose variables it assigns.
* Items: `seeds.partial-rows-credit.assigned-variables-only` (T3), `seeds.partial-rows-credit.triple-needs-three-assigned` (T4)

#### `seeds.empty-list`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P6.
* Generator: The seed option as an empty array, and absent.
* Oracle: The plan equals the plan of the same call without the option.
* Candidate cause C113: an empty seed list changes nothing.
* Items: `seeds.empty-list.empty-array` (T1), `seeds.empty-list.absent-option` (T1)

#### `seeds.credit-at-every-strength`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P6.
* Generator: Seeds that hold every value of every variable but few pairs; seeds that hold all axis pairs but few rule triples; seeds that miss one value only.
* Oracle: New rows exist exactly for the tuples missing at each strength: the plan covers all of them and each new row holds a missing tuple.
* Candidate cause C114: seed coverage is credited at every group strength.
* Items: `seeds.credit-at-every-strength.values-missing` (T3), `seeds.credit-at-every-strength.pairs-missing` (T3), `seeds.credit-at-every-strength.triples-missing` (T4)

#### `seeds.row-ids-unique`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P6.
* Generator: Plans with seeds and new rows, and with 200 rows.
* Oracle: Every plan row has a non-empty string id and the ids are unique.
* Candidate cause C115: every plan row has an id and the ids are unique.
* Items: `seeds.row-ids-unique.plain` (T2), `seeds.row-ids-unique.many` (T3)

#### `seeds.no-duplicate-rows`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P6.
* Generator: A small space where one new row would equal a seed, and a space where two new rows could be equal.
* Oracle: No new row repeats a seed or another new row.
* Candidate cause C116: no new row repeats a seed or another new row.
* Items: `seeds.no-duplicate-rows.new-vs-seed` (T3), `seeds.no-duplicate-rows.new-vs-new` (T3)

#### `seeds.many-seeds`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: H4.
* Generator: 500 and 3,000 random seed rows over 20 shared axes with skewed weights.
* Oracle: Seeds lead the plan; every required tuple is covered; new rows are at most 1.25 x the bound of the missing tuples; at most 8 s of processor time.
* Candidate cause C117: seed credit stays linear in the number of seeds.
* Items: `seeds.many-seeds.five-hundred` (T4), `seeds.many-seeds.three-thousand` (T5)

#### `seeds.pure-copy`

* Component: `planner/seeds` (seed rows first and new rows only for what the seeds miss). Serves: P9.
* Generator: Seed objects passed in, the plan read, then a plan row written to.
* Oracle: The caller's seed objects are never the plan's row objects, and writing to the plan leaves them unchanged.
* Candidate cause C118: plan seed rows are copies, not the caller's objects.
* Items: `seeds.pure-copy.seed-objects-not-aliased` (T3), `seeds.pure-copy.later-mutation-safe` (T4)

### Family budget-order (level plan-order): 28 items

#### `budget.prefix-of-full-plan`

* Component: `planner/budget` (row order by traffic weight and the budget cut). Serves: P7. Assumes: A4.
* Generator: A space with skewed shares; the plan without a budget, then with a budget at the middle, 1, all but one, above the total, and with seeds; nested budgets (3, or every budget from 0 to the total plus 2); a budget of 0 with no seeds.
* Oracle: The plan with budget B is the first min(B, total) rows of the plan without a budget (same ids, kinds, values), so its length is exact and no padding row is invented; a larger budget extends a smaller one; a budget of 0 without seeds gives no row.
* Candidate cause C119: a budget keeps the first rows of the unbudgeted plan.
* Items: `budget.prefix-of-full-plan.middle` (T2), `budget.prefix-of-full-plan.one-row` (T1), `budget.prefix-of-full-plan.all-but-one` (T3), `budget.prefix-of-full-plan.with-seeds` (T3), `budget.prefix-of-full-plan.above-total` (T2), `budget.prefix-of-full-plan.three-budgets-nested` (T3), `budget.prefix-of-full-plan.every-budget-nested` (T4), `budget.prefix-of-full-plan.every-budget-length` (T2), `budget.prefix-of-full-plan.seeds-plus-budget-length` (T3), `budget.prefix-of-full-plan.zero-budget` (T3)

#### `budget.new-rows-common-first`

* Component: `planner/budget` (row order by traffic weight and the budget cut). Serves: P7. Assumes: A1, A3.
* Generator: Spaces of 4 and 10 variables with skewed shares, and a space with equal shares; a budget that keeps a tenth, a half, or all but the last third of the plan, with and without seeds.
* Oracle: After the seeds, the log weight of the new rows never increases along the plan (most common first; equal weights may sit in any order); every new row a budget drops is at most as common as every new row it keeps, so the rarest rows are cut first and seed rows are always kept.
* Candidate cause C120: new rows are ordered by traffic weight, most common first, so a budget cuts the rarest rows first.
* Items: `budget.new-rows-common-first.four-variables` (T2), `budget.new-rows-common-first.ten-variables` (T3), `budget.new-rows-common-first.equal-shares-ties` (T3), `budget.new-rows-common-first.cut-tight-budget` (T3), `budget.new-rows-common-first.cut-with-seeds` (T3), `budget.new-rows-common-first.cut-half-budget` (T3)

#### `budget.invalid-values`

* Component: `planner/budget` (row order by traffic weight and the budget cut). Serves: H7. Assumes: A7.
* Generator: A budget of -1, NaN, 1.5, and the string "10".
* Oracle: The call throws a RangeError whose message names the budget.
* Candidate cause C121: a budget that is not a non-negative whole number is refused with a RangeError that names it.
* Items: `budget.invalid-values.negative` (T4), `budget.invalid-values.nan` (T4), `budget.invalid-values.fraction` (T4), `budget.invalid-values.string` (T5)

#### `budget.log-space-weights`

* Component: `planner/budget` (row order by traffic weight and the budget cut). Serves: H7. Assumes: A3.
* Generator: Rows of 200 variables whose shares are about 0.01 (the product underflows to 0 in doubles) and 100 skewed variables.
* Oracle: The log weight of the new rows never increases along the plan.
* Candidate cause C122: row weights are compared in log space so long rows keep their order.
* Items: `budget.log-space-weights.two-hundred-variables` (T5), `budget.log-space-weights.skewed-hundred` (T5)

#### `budget.weights-from-store`

* Component: `planner/budget` (row order by traffic weight and the budget cut). Serves: P7. Assumes: A3.
* Generator: The same space whose shares come from owner weights, or from a store built from conversations; the ordering is checked against those shares.
* Oracle: The order of the new rows follows the shares in the store, whatever their provenance.
* Candidate cause C123: the traffic weight of a row reads the store's weights, whatever their source.
* Items: `budget.weights-from-store.owner-declared` (T3), `budget.weights-from-store.from-conversations` (T4)

#### `budget.uniform-without-weights`

* Component: `planner/budget` (row order by traffic weight and the budget cut). Serves: P7.
* Generator: A store with no weight at all, and a store where only some variables have weights.
* Oracle: The prefix property holds; with no weights the rows are ordered consistently with equal weights; with some weights, a variable without weights counts as uniform.
* Candidate cause C124: variables without weights count as uniform.
* Items: `budget.uniform-without-weights.no-weights` (T2), `budget.uniform-without-weights.partial-weights` (T3)

#### `budget.weight-reported`

* Component: `planner/budget` (row order by traffic weight and the budget cut). Serves: P7. Assumes: A3.
* Generator: Rows of 3 to 6 variables with shares that sum to 1 and are all above 0.
* Oracle: Each new row reports weight equal to the product of its value shares within 1e-9 relative.
* Candidate cause C125: each plan row reports its traffic weight as the product of its value shares.
* Items: `budget.weight-reported.short-rows` (T3), `budget.weight-reported.uneven-shares` (T3)

### Family counter (level counter): 42 items

#### `counter.closed-form`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: P13.
* Generator: Variables of one arity v: (k, v, t) = (5, 3, 2), (12, 4, 3), (50, 7, 1), (6, 2, 9) with t above k, (200, 2, 3); and mixed arities: (2, 3, 5) at t = 2, 30 variables of arity 1 to 9 at t = 3, arities that include 1, arities up to 100000 at t = 3. One group, no rows.
* Oracle: allowed = e_m of the arities, with m = min(t, k) the strength capped at the group size, computed exactly with big integers (C(k, m) v^m when all arities equal v); covered = 0.
* Candidate cause C87: the counter sums the products of arities over every subset of min(t, k) variables.
* Items: `counter.closed-form.five-three-two` (T1), `counter.closed-form.fifty-seven-one` (T1), `counter.closed-form.twelve-four-three` (T2), `counter.closed-form.t-above-k` (T2), `counter.closed-form.three-variables-mixed` (T2), `counter.closed-form.thirty-mixed-t3` (T3), `counter.closed-form.with-arity-one` (T3), `counter.closed-form.two-hundred-binary-three` (T4), `counter.closed-form.large-arities` (T4)

#### `counter.constraints-matching`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: H6.
* Generator: Impossible pairs on disjoint variable pairs (a matching): 5 pairs among 20 variables at t = 2 and 3; 100 pairs among 200 variables at t = 3.
* Oracle: allowed = the coefficient of z^t in the product of (1 + (a+b) z + (ab - f) z^2) over matched pairs and (1 + a z) over the rest, with f the pairs between the two variables.
* Candidate cause C88: the counter removes tuples that hold an impossible pair.
* Items: `counter.constraints-matching.five-pairs-t2` (T3), `counter.constraints-matching.five-pairs-t3` (T4), `counter.constraints-matching.hundred-pairs-two-hundred-variables` (T5)

#### `counter.brute-force-weak-equals-strict`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: P13. Assumes: A2.
* Generator: Random spaces of 4 to 6 variables of arity 2 to 4 with random pairs among non-universal values, so a tuple without a pair always extends; groups of strength 1, 2 or 3.
* Oracle: allowed equals the number of distinct tuples that appear in a valid full row, by exhaustive enumeration of the product.
* Candidate cause C89: the counter agrees with exhaustive enumeration on random small spaces.
* Items: `counter.brute-force-weak-equals-strict.t1` (T3), `counter.brute-force-weak-equals-strict.t2` (T3), `counter.brute-force-weak-equals-strict.t3` (T4)

#### `counter.strict-extendable`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: P13. Assumes: A2.
* Generator: Random constraints that can make a tuple pairwise fine but impossible to extend: dense pairs, several groups of different strength, one group over all variables; and designed spaces: a triangle of pairs, a forced-out value, a two-step chain, a space with no valid row.
* Oracle: allowed equals the number of distinct tuples that appear in some valid full row, by exhaustive enumeration; a space with no valid row has allowed 0.
* Candidate cause C90: a tuple counts as allowed only when some valid full row holds it.
* Items: `counter.strict-extendable.random-constraints` (T4), `counter.strict-extendable.dense` (T5), `counter.strict-extendable.per-group-strengths` (T4), `counter.strict-extendable.single-group-all-variables` (T3), `counter.strict-extendable.triangle` (T4), `counter.strict-extendable.forced-out` (T4), `counter.strict-extendable.two-step` (T5), `counter.strict-extendable.empty-space` (T5)

#### `counter.covered-complete-rows`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: P13.
* Generator: 5 or 30 random valid rows on a small space, and every valid row.
* Oracle: covered equals the number of distinct allowed tuples held by the rows, by enumeration.
* Candidate cause C91: the counter counts the distinct allowed tuples the rows hold.
* Items: `counter.covered-complete-rows.five-rows` (T2), `counter.covered-complete-rows.thirty-rows` (T3), `counter.covered-complete-rows.rows-cover-all` (T3)

#### `counter.covered-partial-rows`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: P6.
* Generator: Rows that leave some variables out, on spaces of 4 to 6 variables.
* Oracle: A row covers a tuple only when it assigns every variable of the tuple; covered equals the enumerated count.
* Candidate cause C92: a partial row covers only tuples inside its assigned variables.
* Items: `counter.covered-partial-rows.some-missing` (T3), `counter.covered-partial-rows.half-assigned` (T3)

#### `counter.overlapping-groups`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: P13.
* Generator: Two groups over the same variables; a group nested in another; groups of strength 2 and 3 on shared variables.
* Oracle: allowed and covered count each distinct tuple once, by enumeration of the union.
* Candidate cause C93: a tuple shared by overlapping groups counts once.
* Items: `counter.overlapping-groups.same-subset-twice` (T3), `counter.overlapping-groups.nested` (T4), `counter.overlapping-groups.different-strengths` (T3)

#### `counter.exact-beyond-2-53`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: H7.
* Generator: 40 variables of arity 1000 at t = 6; mixed arities up to 5000 at t = 5.
* Oracle: The count equals the exact big-integer value; a number result is accepted only below 2^53.
* Candidate cause C94: counts beyond 2 to the 53 are exact (bigint).
* Items: `counter.exact-beyond-2-53.big-uniform` (T4), `counter.exact-beyond-2-53.big-mixed` (T5)

#### `counter.uncovered-list`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: P13.
* Generator: Rows that cover part of a small space; a limit of 5, a limit larger than the uncovered set, and rows that cover everything.
* Oracle: The listed tuples are distinct, allowed and uncovered; their number is min(limit, uncovered); with a sufficiently large limit they are all of them.
* Candidate cause C95: the counter lists the uncovered tuples, up to a limit.
* Items: `counter.uncovered-list.limit-five` (T3), `counter.uncovered-list.none-uncovered` (T2), `counter.uncovered-list.full-list` (T4)

#### `counter.invalid-arguments`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: H7. Assumes: A7.
* Generator: A group that names an unknown variable, a strength of 0, a strength of 1.5, and a group that lists a variable twice.
* Oracle: The call throws a RangeError whose message names the argument at fault.
* Candidate cause C96: the counter refuses an unknown variable or a strength that is not a positive whole number.
* Items: `counter.invalid-arguments.unknown-variable` (T4), `counter.invalid-arguments.strength-zero` (T4), `counter.invalid-arguments.fractional-strength` (T4), `counter.invalid-arguments.duplicate-variable` (T5)

#### `counter.no-enumeration`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: H4.
* Generator: 200 and 500 binary variables at strength 3 with no rows.
* Oracle: The count is exact and the call takes at most 50 ms of processor time.
* Candidate cause C97: the allowed count comes from a formula, not from enumerating tuples.
* Items: `counter.no-enumeration.two-hundred-variables-t3` (T4), `counter.no-enumeration.five-hundred-variables-t3` (T5)

### Family scale (level scale): 24 items

#### `scale.pairwise-binary`

* Component: `planner/scale` (bounded rows and time at hundreds of variables). Serves: P10.
* Generator: n shared binary axes, n = 20, 50, 100, 200, 400 (the same cause covers ternary and arity-eight axes below).
* Oracle: Every pair of values of every pair of axes is held by some row (a scan over the pairs); rows <= 1.25 x ceil(ln T / -ln(3/4)); processor time within the budget (10 s at 200, 30 s at 400).
* Candidate cause C134: the planner builds a pairwise array over hundreds of binary variables with a bounded row count.
* Items: `scale.pairwise-binary.n20` (T3), `scale.pairwise-binary.n50` (T3), `scale.pairwise-binary.n100` (T4), `scale.pairwise-binary.n200` (T4), `scale.pairwise-binary.n400` (T5), `scale.pairwise-binary.ternary-30` (T3), `scale.pairwise-binary.ternary-60` (T4), `scale.pairwise-binary.arity-eight-10` (T4), `scale.pairwise-binary.arity-eight-20` (T5)

#### `scale.many-rules`

* Component: `planner/scale` (bounded rows and time at hundreds of variables). Serves: H4.
* Generator: 20, then 100 rules of 6 binary variables drawn from a pool of 60, 160 variables; one variant draws the rules from a pool of 20 so they overlap heavily.
* Oracle: Every required triple is held by some row (a scan over the triples of each rule); rows within 1.25 x the greedy bound; processor time within 30 s.
* Candidate cause C135: the planner covers many rule groups at strength 3 with a bounded row count.
* Items: `scale.many-rules.twenty-rules` (T3), `scale.many-rules.hundred-rules` (T5), `scale.many-rules.heavy-overlap` (T5)

#### `scale.thousand-others`

* Component: `planner/scale` (bounded rows and time at hundreds of variables). Serves: H4.
* Generator: 1,000 and 5,000 variables of arity 3 in no rule and no axis.
* Oracle: The plan has at most 6 rows (strength 1 needs 3) and takes at most 10 s of processor time.
* Candidate cause C136: variables outside rules and axes cost rows by arity, not by count.
* Items: `scale.thousand-others.one-thousand` (T4), `scale.thousand-others.five-thousand` (T5)

#### `scale.many-impossible-pairs`

* Component: `planner/scale` (bounded rows and time at hundreds of variables). Serves: H4.
* Generator: 2,000 and 20,000 impossible pairs among 200 variables of arity 4 (the first 30 are shared axes) that keep a universal value each.
* Oracle: No row holds a pair; every allowed required tuple is held; rows within 4 x the greedy bound (the pairs make rows hold fewer tuples than random rows would); at most 30 s of processor time.
* Candidate cause C137: impossible pairs are looked up in constant time.
* Items: `scale.many-impossible-pairs.two-thousand` (T4), `scale.many-impossible-pairs.twenty-thousand` (T5)

#### `scale.estate-spans`

* Component: `store/estate` (reading condition spans and tool evidence of the estate into variables). Serves: H4.
* Generator: 200, 2,000 and 10,000 condition spans with distinct nouns, spread over 20 files of 100 KB.
* Oracle: The store holds one variable per noun with three values each, no refusal; at most 10 s of processor time at 2,000 spans, 30 s at 10,000.
* Candidate cause C138: reading the estate is linear in spans and file size.
* Items: `scale.estate-spans.two-hundred` (T3), `scale.estate-spans.two-thousand` (T4), `scale.estate-spans.ten-thousand` (T5)

#### `scale.conversations`

* Component: `store/conversations` (counting the values seen in past conversations (counts only)). Serves: H4.
* Generator: 10,000 and 100,000 sessions over 8 variables of 5 values from a planted mix.
* Oracle: The counts equal the planted counts; at most 5 s of processor time at 100,000.
* Candidate cause C139: counting conversations is linear in sessions.
* Items: `scale.conversations.ten-thousand` (T3), `scale.conversations.hundred-thousand` (T5)

#### `scale.counter-big-plan`

* Component: `planner/counter` (counting allowed and covered tuples). Serves: H4.
* Generator: A plan of about 30 rows on 100 binary variables at strength 3, and on 200 at strength 2, counted by the component.
* Oracle: covered and allowed equal the bank's own scan; at most 20 s of processor time.
* Candidate cause C140: coverage counting stays linear in rows times tuples per row.
* Items: `scale.counter-big-plan.hundred-binary-t3` (T5), `scale.counter-big-plan.two-hundred-binary-t2` (T4)

#### `scale.big-arity-axis`

* Component: `planner/scale` (bounded rows and time at hundreds of variables). Serves: H4.
* Generator: One axis of 200 values beside three binary axes.
* Oracle: Every value of the big axis meets every value of each other axis; rows within the bound; at most 10 s.
* Candidate cause C141: the planner handles an axis with hundreds of values.
* Items: `scale.big-arity-axis.arity-two-hundred` (T4)

### Family determinism (level determinism): 25 items

#### `determinism.same-seed-same-bytes`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: A tiny space; a space with rules, seeds and a budget; heavy constraints; equal weights (many ties); 200 binary axes. The plan is built twice with the same store, options and seed.
* Oracle: The two serialised plans are identical byte for byte.
* Candidate cause C126: the same store, options and seed give byte-identical plans.
* Items: `determinism.same-seed-same-bytes.tiny` (T1), `determinism.same-seed-same-bytes.rules-seeds-budget` (T2), `determinism.same-seed-same-bytes.heavy-constraints` (T3), `determinism.same-seed-same-bytes.equal-weights-ties` (T3), `determinism.same-seed-same-bytes.two-hundred-binary` (T4)

#### `determinism.interleaved-calls`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: A plan, then a plan of another store (or another budget) in between, then the first plan again.
* Oracle: The first and the third plan are identical byte for byte.
* Candidate cause C127: a plan does not depend on earlier calls.
* Items: `determinism.interleaved-calls.other-store-between` (T2), `determinism.interleaved-calls.other-budget-between` (T3)

#### `determinism.across-processes`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: The plan built in this process and in a new Node.js process: default environment; another time zone; a Turkish locale; valid ASCII IDs with mixed case and accented Unicode titles (the legacy item ID is unchanged).
* Oracle: The serialised plans are identical byte for byte.
* Candidate cause C128: a plan does not depend on the process, its locale or its time zone.
* Items: `determinism.across-processes.default-env` (T3), `determinism.across-processes.other-time-zone` (T4), `determinism.across-processes.turkish-locale` (T5), `determinism.across-processes.accented-ids-sort` (T4)

#### `determinism.no-ambient-randomness`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: The plan built with Math.random replaced by a function that throws, with the clock set to two different instants, with the crypto random functions throwing, and with all three.
* Oracle: The call does not throw and the plan equals the plan built in the normal environment.
* Candidate cause C129: planning draws randomness only from the seed.
* Items: `determinism.no-ambient-randomness.math-random-throws` (T3), `determinism.no-ambient-randomness.clock-frozen-differently` (T3), `determinism.no-ambient-randomness.crypto-throws` (T4), `determinism.no-ambient-randomness.all-three` (T4)

#### `determinism.key-order`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: The same store with object keys in another order (weights, provenance), and seed rows with keys in another order.
* Oracle: The plans are equal after sorting object keys.
* Candidate cause C130: a plan does not depend on the key order of the objects it reads.
* Items: `determinism.key-order.store-keys` (T3), `determinism.key-order.seed-row-keys` (T3)

#### `determinism.json-round-trip`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: The store and the options passed through JSON.stringify and JSON.parse.
* Oracle: The plan equals the plan of the original objects.
* Candidate cause C131: a plan depends only on the JSON content of its inputs.
* Items: `determinism.json-round-trip.store` (T2), `determinism.json-round-trip.options` (T2)

#### `determinism.inputs-not-written`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: A deeply frozen store, deeply frozen seed rows, and deeply frozen options.
* Oracle: The call does not throw and returns the same plan as with unfrozen inputs.
* Candidate cause C132: planning never writes to its inputs.
* Items: `determinism.inputs-not-written.frozen-store` (T2), `determinism.inputs-not-written.frozen-seeds` (T2), `determinism.inputs-not-written.frozen-options` (T2)

#### `determinism.store-bytes`

* Component: `planner/determinism` (same seed, same plan, byte for byte). Serves: P9.
* Generator: The same sources built twice in a row; built with the object keys of the sources in another order; built in a second Node.js process.
* Oracle: The serialised stores are identical byte for byte.
* Candidate cause C133: buildStore gives byte-identical stores for the same sources.
* Items: `determinism.store-bytes.two-calls` (T2), `determinism.store-bytes.other-key-order` (T3), `determinism.store-bytes.across-processes` (T4)

## 6. Item index

| Item | Family | Level | Tier | Cause |
| --- | --- | --- | --- | --- |
| `sources.estate.numeric-condition.one-rule` | sources | store | 1 | C1 |
| `sources.estate.numeric-condition.long-file` | sources | store | 2 | C1 |
| `sources.estate.boolean-condition.positive` | sources | store | 1 | C2 |
| `sources.estate.boolean-condition.negated` | sources | store | 3 | C2 |
| `sources.estate.boolean-condition.lacks-form` | sources | store | 4 | C2 |
| `sources.estate.membership-condition.three-members` | sources | store | 2 | C3 |
| `sources.estate.membership-condition.two-members` | sources | store | 2 | C3 |
| `sources.estate.no-condition-no-variable.plain-rule` | sources | store | 1 | C4 |
| `sources.estate.no-condition-no-variable.number-without-comparator` | sources | store | 4 | C4 |
| `sources.estate.no-condition-no-variable.past-tense-limit` | sources | store | 5 | C4 |
| `sources.estate.same-quantity-merges.two-spans` | sources | store | 3 | C5 |
| `sources.estate.same-quantity-merges.three-spans` | sources | store | 3 | C5 |
| `sources.estate.same-quantity-merges.two-files` | sources | store | 4 | C5 |
| `sources.estate.same-quantity-merges.case-differs` | sources | store | 4 | C5 |
| `sources.estate.different-quantities-split.two-nouns` | sources | store | 1 | C6 |
| `sources.estate.different-quantities-split.shared-word` | sources | store | 3 | C6 |
| `sources.estate.different-quantities-split.prefix-noun` | sources | store | 4 | C6 |
| `sources.estate.rule-own-variables.condition-and-tool` | sources | store | 2 | C7 |
| `sources.estate.rule-own-variables.condition-only` | sources | store | 2 | C7 |
| `sources.estate.rule-own-variables.tool-only` | sources | store | 3 | C7 |
| `sources.estate.rule-own-variables.two-and-two` | sources | store | 3 | C7 |
| `sources.estate.rule-own-variables.shared-quantity-two-rules` | sources | store | 3 | C7 |
| `sources.estate.tool-field-variable.enum-three` | sources | store | 2 | C8 |
| `sources.estate.tool-field-variable.single-value` | sources | store | 3 | C8 |
| `sources.conversations.counts.two-values` | sources | store | 1 | C9 |
| `sources.conversations.counts.three-variables` | sources | store | 2 | C9 |
| `sources.conversations.counts.unseen-estate-value` | sources | store | 3 | C9 |
| `sources.conversations.partial-sessions.half-observed` | sources | store | 2 | C10 |
| `sources.conversations.partial-sessions.never-observed` | sources | store | 3 | C10 |
| `sources.conversations.new-value.one-new` | sources | store | 2 | C11 |
| `sources.conversations.set-hash.hex-shape` | sources | store | 2 | C12 |
| `sources.conversations.set-hash.stable` | sources | store | 2 | C12 |
| `sources.conversations.set-hash.changes-with-a-session` | sources | store | 3 | C12 |
| `sources.conversations.set-hash.order-free` | sources | store | 3 | C12 |
| `sources.conversations.privacy.text-canary` | sources | store | 2 | C13 |
| `sources.conversations.privacy.id-canary` | sources | store | 2 | C13 |
| `sources.conversations.privacy.thousand-sessions` | sources | store | 4 | C13 |
| `sources.owner.missing-value.one` | sources | store | 1 | C14 |
| `sources.owner.missing-value.three` | sources | store | 2 | C14 |
| `sources.owner.impossible-pair.one` | sources | store | 1 | C15 |
| `sources.owner.impossible-pair.reversed-endpoints` | sources | store | 2 | C15 |
| `sources.owner.weight.relative-scale` | sources | store | 1 | C16 |
| `sources.owner.weight.full-distribution` | sources | store | 2 | C16 |
| `sources.owner.weight.zero-weight` | sources | store | 3 | C16 |
| `sources.owner.words-verbatim.accents` | sources | store | 2 | C17 |
| `sources.owner.words-verbatim.multiline` | sources | store | 3 | C17 |
| `sources.owner.words-verbatim.one-thousand-chars` | sources | store | 4 | C17 |
| `sources.owner.words-verbatim.emoji-and-rtl` | sources | store | 4 | C17 |
| `sources.owner.date-and-statement.day-kept` | sources | store | 2 | C18 |
| `sources.owner.date-and-statement.unreal-day-refused` | sources | store | 3 | C18 |
| `sources.owner.date-and-statement.badly-written-day-refused` | sources | store | 3 | C18 |
| `sources.owner.date-and-statement.blank-words-refused` | sources | store | 3 | C18 |
| `sources.merge.provenance-union.estate-owner` | sources | store | 3 | C19 |
| `sources.merge.provenance-union.estate-conversations` | sources | store | 3 | C19 |
| `sources.merge.provenance-union.all-three` | sources | store | 4 | C19 |
| `sources.order-independent.rules-permuted` | sources | store | 3 | C20 |
| `sources.order-independent.sessions-permuted` | sources | store | 3 | C20 |
| `sources.order-independent.owner-entries-permuted` | sources | store | 3 | C20 |
| `sources.empty-sources.nothing` | sources | store | 1 | C21 |
| `sources.empty-sources.empty-estate` | sources | store | 1 | C21 |
| `sources.empty-sources.empty-conversations` | sources | store | 2 | C21 |
| `quotes.accept.exact.at-start` | quotes | store | 1 | C22 |
| `quotes.accept.exact.middle` | quotes | store | 1 | C22 |
| `quotes.accept.exact.at-end` | quotes | store | 2 | C22 |
| `quotes.accept.exact.whole-file` | quotes | store | 2 | C22 |
| `quotes.refuse.absent.unrelated-text` | quotes | store | 1 | C23 |
| `quotes.refuse.absent.other-file-text` | quotes | store | 2 | C23 |
| `quotes.refuse.absent.extra-word-appended` | quotes | store | 3 | C23 |
| `quotes.refuse.unknown-source.missing-path` | quotes | store | 1 | C24 |
| `quotes.refuse.unknown-source.path-case-differs` | quotes | store | 2 | C24 |
| `quotes.refuse.unknown-source.empty-path` | quotes | store | 3 | C24 |
| `quotes.refuse.empty-quote.empty` | quotes | store | 2 | C25 |
| `quotes.refuse.empty-quote.blank` | quotes | store | 3 | C25 |
| `quotes.refuse.inexact.all-caps` | quotes | store | 2 | C23 |
| `quotes.refuse.inexact.first-letter-case` | quotes | store | 3 | C23 |
| `quotes.refuse.inexact.inserted-char` | quotes | store | 3 | C23 |
| `quotes.refuse.inexact.deleted-char` | quotes | store | 3 | C23 |
| `quotes.refuse.inexact.substituted-char` | quotes | store | 3 | C23 |
| `quotes.refuse.inexact.transposed-chars` | quotes | store | 4 | C23 |
| `quotes.refuse.inexact.skipped-word` | quotes | store | 3 | C23 |
| `quotes.refuse.inexact.joined-lines` | quotes | store | 4 | C23 |
| `quotes.accept.multiline.lf` | quotes | store | 2 | C27 |
| `quotes.accept.multiline.crlf` | quotes | store | 3 | C27 |
| `quotes.plain-text-matching.dot-star-literal` | quotes | store | 4 | C28 |
| `quotes.plain-text-matching.group-alternation-literal` | quotes | store | 4 | C28 |
| `quotes.plain-text-matching.brackets-literal` | quotes | store | 4 | C28 |
| `quotes.plain-text-matching.backslash-d-literal` | quotes | store | 4 | C28 |
| `quotes.plain-text-matching.dot-star-lookalike` | quotes | store | 5 | C28 |
| `quotes.plain-text-matching.alternation-lookalike` | quotes | store | 5 | C28 |
| `quotes.accept.unicode.accents` | quotes | store | 2 | C29 |
| `quotes.accept.unicode.cjk` | quotes | store | 3 | C29 |
| `quotes.accept.unicode.emoji` | quotes | store | 4 | C29 |
| `quotes.accept.unicode.rtl` | quotes | store | 4 | C29 |
| `quotes.per-value-granularity.one-of-three` | quotes | store | 3 | C30 |
| `quotes.per-value-granularity.two-of-three` | quotes | store | 3 | C30 |
| `quotes.per-value-granularity.first-bad` | quotes | store | 3 | C30 |
| `quotes.per-value-granularity.all-bad` | quotes | store | 3 | C142 |
| `quotes.refusal-report.one` | quotes | store | 2 | C31 |
| `quotes.refusal-report.two` | quotes | store | 3 | C31 |
| `quotes.refusal-report.reason-text` | quotes | store | 3 | C31 |
| `quotes.owner-conversation-exempt.owner-value` | quotes | store | 2 | C32 |
| `quotes.owner-conversation-exempt.conversation-value` | quotes | store | 2 | C32 |
| `quotes.owner-conversation-exempt.owner-words-quote-shaped` | quotes | store | 3 | C32 |
| `quotes.condition-span-unfindable.edited-wording` | quotes | store | 3 | C33 |
| `quotes.condition-span-unfindable.wrong-file` | quotes | store | 3 | C33 |
| `quotes.condition-span-unfindable.one-char-off` | quotes | store | 4 | C33 |
| `quotes.stored-verbatim.plain` | quotes | store | 2 | C34 |
| `quotes.stored-verbatim.padded-spaces` | quotes | store | 4 | C34 |
| `quotes.stored-verbatim.trailing-newline` | quotes | store | 4 | C34 |
| `quotes.never-reads-disk.etc-hosts` | quotes | store | 4 | C35 |
| `quotes.never-reads-disk.traversal` | quotes | store | 4 | C35 |
| `quotes.never-reads-disk.absolute-path` | quotes | store | 5 | C35 |
| `quotes.large-files.hundred-kb` | quotes | store | 4 | C36 |
| `quotes.large-files.one-mb` | quotes | store | 5 | C36 |
| `quotes.large-files.two-thousand-values` | quotes | store | 5 | C36 |
| `values.ids.variable-grammar.spaces-and-caps` | values | store | 2 | C37 |
| `values.ids.variable-grammar.punctuation` | values | store | 3 | C37 |
| `values.ids.variable-grammar.leading-digit` | values | store | 4 | C37 |
| `values.ids.variable-grammar.unicode-letters` | values | store | 4 | C37 |
| `values.ids.value-grammar.owner-values` | values | store | 2 | C38 |
| `values.ids.value-grammar.tool-values` | values | store | 3 | C38 |
| `values.ids.value-grammar.hostile-characters` | values | store | 4 | C38 |
| `values.ids.stable.two-calls` | values | store | 2 | C39 |
| `values.ids.stable.after-other-build` | values | store | 3 | C39 |
| `values.ids.collisions.value-collision` | values | store | 3 | C40 |
| `values.ids.collisions.variable-collision` | values | store | 3 | C40 |
| `values.ids.collisions.three-way` | values | store | 4 | C40 |
| `values.owner-adds-to-existing.appended` | values | store | 1 | C41 |
| `values.owner-adds-to-existing.others-unchanged` | values | store | 3 | C41 |
| `values.owner-adds-to-existing.order-kept` | values | store | 3 | C41 |
| `values.owner-value-already-present.same-id` | values | store | 2 | C42 |
| `values.owner-value-already-present.same-id-twice` | values | store | 3 | C42 |
| `values.hostile-names.constructor-variable` | values | store | 5 | C43 |
| `values.hostile-names.to-string-variable` | values | store | 5 | C43 |
| `values.hostile-names.has-own-property-variable` | values | store | 5 | C43 |
| `values.hostile-names.proto-like-noun` | values | store | 5 | C43 |
| `values.hostile-names.constructor-value` | values | store | 5 | C43 |
| `values.large-variable.two-thousand-values` | values | store | 4 | C44 |
| `values.large-variable.ten-thousand-values` | values | store | 5 | C44 |
| `values.unapproved-not-planned.proposed-value` | values | store | 3 | C45 |
| `values.unapproved-not-planned.proposed-variable` | values | store | 3 | C45 |
| `values.unapproved-not-planned.proposed-value-in-a-pair` | values | store | 4 | C45 |
| `values.unapproved-not-planned.approved-later` | values | store | 3 | C45 |
| `values.fresh-objects.output-mutation-safe` | values | store | 3 | C46 |
| `values.fresh-objects.two-builds-independent` | values | store | 3 | C46 |
| `values.input-not-mutated.estate` | values | store | 3 | C47 |
| `values.input-not-mutated.conversations` | values | store | 3 | C47 |
| `values.input-not-mutated.owner` | values | store | 3 | C47 |
| `boundaries.greater-than.over` | boundaries | store | 1 | C48 |
| `boundaries.greater-than.more-than` | boundaries | store | 1 | C48 |
| `boundaries.greater-than.exceeds` | boundaries | store | 2 | C48 |
| `boundaries.greater-than.greater-than` | boundaries | store | 2 | C48 |
| `boundaries.greater-than.symbol` | boundaries | store | 3 | C48 |
| `boundaries.at-least.at-least` | boundaries | store | 1 | C49 |
| `boundaries.at-least.no-less-than` | boundaries | store | 2 | C49 |
| `boundaries.at-least.or-more` | boundaries | store | 3 | C49 |
| `boundaries.at-least.symbol` | boundaries | store | 3 | C49 |
| `boundaries.less-than.under` | boundaries | store | 1 | C50 |
| `boundaries.less-than.below` | boundaries | store | 1 | C50 |
| `boundaries.less-than.fewer-than` | boundaries | store | 2 | C50 |
| `boundaries.less-than.symbol` | boundaries | store | 3 | C50 |
| `boundaries.at-most.at-most` | boundaries | store | 1 | C51 |
| `boundaries.at-most.no-more-than` | boundaries | store | 2 | C51 |
| `boundaries.at-most.or-fewer` | boundaries | store | 3 | C51 |
| `boundaries.at-most.symbol` | boundaries | store | 3 | C51 |
| `boundaries.equal.exactly` | boundaries | store | 1 | C52 |
| `boundaries.equal.equals` | boundaries | store | 2 | C52 |
| `boundaries.equal.symbol` | boundaries | store | 3 | C52 |
| `boundaries.not-equal.not-equal-to` | boundaries | store | 2 | C53 |
| `boundaries.not-equal.other-than` | boundaries | store | 3 | C53 |
| `boundaries.not-equal.symbol` | boundaries | store | 3 | C53 |
| `boundaries.range.between-and` | boundaries | store | 3 | C54 |
| `boundaries.range.from-to` | boundaries | store | 3 | C54 |
| `boundaries.range.negative-range` | boundaries | store | 5 | C54 |
| `boundaries.decimal.half` | boundaries | store | 2 | C55 |
| `boundaries.decimal.two-places` | boundaries | store | 2 | C55 |
| `boundaries.decimal.whole-as-decimal` | boundaries | store | 3 | C55 |
| `boundaries.decimal.tenth-float` | boundaries | store | 4 | C55 |
| `boundaries.negative.minus-sign` | boundaries | store | 3 | C56 |
| `boundaries.negative.negative-decimal` | boundaries | store | 4 | C56 |
| `boundaries.zero.more-than-zero` | boundaries | store | 3 | C57 |
| `boundaries.zero.at-most-zero` | boundaries | store | 4 | C57 |
| `boundaries.thousands-separator.comma` | boundaries | store | 3 | C58 |
| `boundaries.thousands-separator.several-groups` | boundaries | store | 3 | C58 |
| `boundaries.thousands-separator.thin-space` | boundaries | store | 4 | C58 |
| `boundaries.large-number.billion` | boundaries | store | 3 | C59 |
| `boundaries.large-number.above-32-bits` | boundaries | store | 4 | C59 |
| `boundaries.large-number.trillion` | boundaries | store | 4 | C59 |
| `boundaries.units.euros` | boundaries | store | 1 | C60 |
| `boundaries.units.percent` | boundaries | store | 2 | C60 |
| `boundaries.units.minutes` | boundaries | store | 2 | C60 |
| `boundaries.units.currency-prefix` | boundaries | store | 3 | C60 |
| `boundaries.number-words.three` | boundaries | store | 3 | C61 |
| `boundaries.number-words.twenty-five` | boundaries | store | 4 | C61 |
| `boundaries.number-words.one-hundred` | boundaries | store | 5 | C61 |
| `boundaries.merge-thresholds.far-apart` | boundaries | store | 3 | C62 |
| `boundaries.merge-thresholds.adjacent-overlap` | boundaries | store | 4 | C62 |
| `boundaries.merge-thresholds.same-threshold-two-comparators` | boundaries | store | 3 | C62 |
| `boundaries.integer-samples.count-noun` | boundaries | store | 2 | C63 |
| `boundaries.integer-samples.money` | boundaries | store | 2 | C63 |
| `boundaries.integer-samples.percent` | boundaries | store | 3 | C63 |
| `boundaries.cites-span.each-value-cites` | boundaries | store | 2 | C64 |
| `boundaries.cites-span.quote-findable` | boundaries | store | 3 | C64 |
| `impossible.rows-avoid-pairs.two-variables` | impossible-pairs | constraints | 1 | C65 |
| `impossible.rows-avoid-pairs.five-variables` | impossible-pairs | constraints | 1 | C65 |
| `impossible.rows-avoid-pairs.three-pairs` | impossible-pairs | constraints | 2 | C65 |
| `impossible.rows-avoid-pairs.pair-on-shared-axes` | impossible-pairs | constraints | 2 | C65 |
| `impossible.rows-avoid-pairs.pair-inside-rule` | impossible-pairs | constraints | 2 | C65 |
| `impossible.required-tuples-skip-pairs.inside-rule-group` | impossible-pairs | constraints | 2 | C66 |
| `impossible.required-tuples-skip-pairs.inside-axes` | impossible-pairs | constraints | 2 | C66 |
| `impossible.required-tuples-skip-pairs.across-groups` | impossible-pairs | constraints | 3 | C66 |
| `impossible.required-tuples-skip-pairs.dense-thirty-percent` | impossible-pairs | constraints | 3 | C66 |
| `impossible.required-tuples-skip-pairs.dense-fifty-percent` | impossible-pairs | constraints | 4 | C66 |
| `impossible.required-tuples-skip-pairs.dense-seventy-percent` | impossible-pairs | constraints | 5 | C66 |
| `impossible.unordered.reversed` | impossible-pairs | constraints | 2 | C67 |
| `impossible.unordered.mixed-order` | impossible-pairs | constraints | 3 | C67 |
| `impossible.duplicates-count-once.thrice` | impossible-pairs | constraints | 2 | C68 |
| `impossible.duplicates-count-once.both-orders` | impossible-pairs | constraints | 3 | C68 |
| `impossible.same-variable-pair.two-values-of-one-variable` | impossible-pairs | constraints | 2 | C69 |
| `impossible.same-variable-pair.inside-rule` | impossible-pairs | constraints | 3 | C69 |
| `impossible.unknown-reference.unknown-variable` | impossible-pairs | constraints | 3 | C70 |
| `impossible.unknown-reference.unknown-value` | impossible-pairs | constraints | 3 | C70 |
| `impossible.unknown-reference.both-unknown` | impossible-pairs | constraints | 3 | C70 |
| `impossible.forced-out-value.one-step` | impossible-pairs | constraints | 3 | C71 |
| `impossible.forced-out-value.two-step-chain` | impossible-pairs | constraints | 4 | C71 |
| `impossible.forced-out-value.in-rule-group` | impossible-pairs | constraints | 4 | C71 |
| `impossible.unsatisfiable-space.two-single-valued` | impossible-pairs | constraints | 3 | C72 |
| `impossible.unsatisfiable-space.cycle` | impossible-pairs | constraints | 5 | C72 |
| `impossible.tight-chain.alternating-binary` | impossible-pairs | constraints | 5 | C73 |
| `impossible.tight-chain.no-equal-neighbours-ternary` | impossible-pairs | constraints | 5 | C73 |
| `impossible.tight-chain.exactly-one-of` | impossible-pairs | constraints | 5 | C73 |
| `impossible.tight-chain.hub-one-partner` | impossible-pairs | constraints | 4 | C73 |
| `impossible.tight-chain.one-value-excludes-all-but-one` | impossible-pairs | constraints | 4 | C73 |
| `impossible.with-seeds.valid-seeds` | impossible-pairs | constraints | 3 | C74 |
| `impossible.with-seeds.seeds-next-to-forbidden` | impossible-pairs | constraints | 4 | C74 |
| `weights.relative-frequency.single-variable` | weights | constraints | 1 | C75 |
| `weights.relative-frequency.five-values-skewed` | weights | constraints | 2 | C75 |
| `weights.relative-frequency.ten-variables` | weights | constraints | 2 | C75 |
| `weights.relative-frequency.thousand-sessions` | weights | constraints | 3 | C75 |
| `weights.complete-and-relative.all-seen` | weights | constraints | 2 | C76 |
| `weights.complete-and-relative.unseen-value` | weights | constraints | 3 | C76 |
| `weights.complete-and-relative.new-value` | weights | constraints | 3 | C76 |
| `weights.interval-holds-estimate.ordinary` | weights | constraints | 2 | C77 |
| `weights.interval-holds-estimate.one-session` | weights | constraints | 3 | C77 |
| `weights.interval-holds-estimate.all-same` | weights | constraints | 3 | C77 |
| `weights.interval-coverage.half-n100` | weights | constraints | 3 | C78 |
| `weights.interval-coverage.half-n20` | weights | constraints | 4 | C78 |
| `weights.interval-coverage.tenth-n50` | weights | constraints | 4 | C78 |
| `weights.interval-coverage.two-percent-n100` | weights | constraints | 5 | C78 |
| `weights.interval-coverage.two-percent-n1000` | weights | constraints | 4 | C78 |
| `weights.interval-coverage.half-percent-n500` | weights | constraints | 5 | C78 |
| `weights.interval-coverage.ninety-five-n40` | weights | constraints | 4 | C78 |
| `weights.interval-coverage.near-one-n300` | weights | constraints | 5 | C78 |
| `weights.interval-width.n100` | weights | constraints | 3 | C79 |
| `weights.interval-width.n1000` | weights | constraints | 3 | C79 |
| `weights.interval-width.n30` | weights | constraints | 4 | C79 |
| `weights.interval-width.tenfold-sessions-shrinks` | weights | constraints | 4 | C79 |
| `weights.interval-level.n400-half` | weights | constraints | 3 | C80 |
| `weights.interval-level.n2000-tenth` | weights | constraints | 3 | C80 |
| `weights.zero-count.n20` | weights | constraints | 2 | C81 |
| `weights.zero-count.n1000` | weights | constraints | 3 | C81 |
| `weights.zero-count.among-seen` | weights | constraints | 3 | C81 |
| `weights.all-sessions-one-value.n10` | weights | constraints | 2 | C82 |
| `weights.all-sessions-one-value.n1000` | weights | constraints | 3 | C82 |
| `weights.no-observation.no-sessions` | weights | constraints | 2 | C83 |
| `weights.no-observation.unobserved-variable` | weights | constraints | 3 | C83 |
| `weights.no-observation.owner-only` | weights | constraints | 3 | C83 |
| `weights.recovered-mix.four-values` | weights | constraints | 3 | C84 |
| `weights.recovered-mix.twelve-skewed` | weights | constraints | 4 | C84 |
| `weights.recovered-mix.small-n` | weights | constraints | 4 | C84 |
| `weights.owner-kept-exactly.quarter` | weights | constraints | 2 | C85 |
| `weights.owner-kept-exactly.third` | weights | constraints | 3 | C85 |
| `weights.owner-kept-exactly.tiny` | weights | constraints | 4 | C85 |
| `weights.owner-kept-exactly.percent-scale` | weights | constraints | 3 | C85 |
| `weights.owner-invalid-refused.negative` | weights | constraints | 3 | C86 |
| `weights.owner-invalid-refused.null` | weights | constraints | 3 | C86 |
| `weights.owner-invalid-refused.nan` | weights | constraints | 4 | C86 |
| `weights.owner-invalid-refused.infinity` | weights | constraints | 4 | C86 |
| `weights.owner-invalid-refused.string` | weights | constraints | 4 | C86 |
| `counter.closed-form.five-three-two` | counter | counter | 1 | C87 |
| `counter.closed-form.fifty-seven-one` | counter | counter | 1 | C87 |
| `counter.closed-form.twelve-four-three` | counter | counter | 2 | C87 |
| `counter.closed-form.t-above-k` | counter | counter | 2 | C87 |
| `counter.closed-form.three-variables-mixed` | counter | counter | 2 | C87 |
| `counter.closed-form.thirty-mixed-t3` | counter | counter | 3 | C87 |
| `counter.closed-form.with-arity-one` | counter | counter | 3 | C87 |
| `counter.closed-form.two-hundred-binary-three` | counter | counter | 4 | C87 |
| `counter.closed-form.large-arities` | counter | counter | 4 | C87 |
| `counter.constraints-matching.five-pairs-t2` | counter | counter | 3 | C88 |
| `counter.constraints-matching.five-pairs-t3` | counter | counter | 4 | C88 |
| `counter.constraints-matching.hundred-pairs-two-hundred-variables` | counter | counter | 5 | C88 |
| `counter.brute-force-weak-equals-strict.t1` | counter | counter | 3 | C89 |
| `counter.brute-force-weak-equals-strict.t2` | counter | counter | 3 | C89 |
| `counter.brute-force-weak-equals-strict.t3` | counter | counter | 4 | C89 |
| `counter.strict-extendable.random-constraints` | counter | counter | 4 | C90 |
| `counter.strict-extendable.dense` | counter | counter | 5 | C90 |
| `counter.strict-extendable.per-group-strengths` | counter | counter | 4 | C90 |
| `counter.strict-extendable.single-group-all-variables` | counter | counter | 3 | C90 |
| `counter.strict-extendable.triangle` | counter | counter | 4 | C90 |
| `counter.strict-extendable.forced-out` | counter | counter | 4 | C90 |
| `counter.strict-extendable.two-step` | counter | counter | 5 | C90 |
| `counter.strict-extendable.empty-space` | counter | counter | 5 | C90 |
| `counter.covered-complete-rows.five-rows` | counter | counter | 2 | C91 |
| `counter.covered-complete-rows.thirty-rows` | counter | counter | 3 | C91 |
| `counter.covered-complete-rows.rows-cover-all` | counter | counter | 3 | C91 |
| `counter.covered-partial-rows.some-missing` | counter | counter | 3 | C92 |
| `counter.covered-partial-rows.half-assigned` | counter | counter | 3 | C92 |
| `counter.overlapping-groups.same-subset-twice` | counter | counter | 3 | C93 |
| `counter.overlapping-groups.nested` | counter | counter | 4 | C93 |
| `counter.overlapping-groups.different-strengths` | counter | counter | 3 | C93 |
| `counter.exact-beyond-2-53.big-uniform` | counter | counter | 4 | C94 |
| `counter.exact-beyond-2-53.big-mixed` | counter | counter | 5 | C94 |
| `counter.uncovered-list.limit-five` | counter | counter | 3 | C95 |
| `counter.uncovered-list.none-uncovered` | counter | counter | 2 | C95 |
| `counter.uncovered-list.full-list` | counter | counter | 4 | C95 |
| `counter.invalid-arguments.unknown-variable` | counter | counter | 4 | C96 |
| `counter.invalid-arguments.strength-zero` | counter | counter | 4 | C96 |
| `counter.invalid-arguments.fractional-strength` | counter | counter | 4 | C96 |
| `counter.invalid-arguments.duplicate-variable` | counter | counter | 5 | C96 |
| `counter.no-enumeration.two-hundred-variables-t3` | counter | counter | 4 | C97 |
| `counter.no-enumeration.five-hundred-variables-t3` | counter | counter | 5 | C97 |
| `strength.others-at-one.three-variables` | strength | strength | 1 | C98 |
| `strength.others-at-one.mixed-arity` | strength | strength | 2 | C98 |
| `strength.others-at-one.single-variable` | strength | strength | 1 | C98 |
| `strength.others-at-one.arity-one` | strength | strength | 1 | C98 |
| `strength.others-economy.thirty-variables` | strength | strength | 3 | C99 |
| `strength.others-economy.hundred-variables` | strength | strength | 4 | C99 |
| `strength.axes-at-two.three-axes` | strength | strength | 2 | C100 |
| `strength.axes-at-two.six-axes` | strength | strength | 3 | C100 |
| `strength.axes-at-two.six-axes-one-single-valued` | strength | strength | 3 | C100 |
| `strength.axes-at-two.twelve-binary` | strength | strength | 4 | C100 |
| `strength.axes-at-two.one-axis-of-seven` | strength | strength | 3 | C100 |
| `strength.axes-at-two.one-axis-of-one` | strength | strength | 2 | C100 |
| `strength.axes-at-two.one-axis-of-twenty` | strength | strength | 4 | C100 |
| `strength.rule-at-three.three-variables` | strength | strength | 2 | C101 |
| `strength.rule-at-three.four-binary` | strength | strength | 2 | C101 |
| `strength.rule-at-three.five-ternary` | strength | strength | 3 | C101 |
| `strength.rule-at-three.seven-binary` | strength | strength | 3 | C101 |
| `strength.rule-at-three.mixed-arity` | strength | strength | 3 | C101 |
| `strength.rule-at-three.four-quaternary` | strength | strength | 3 | C101 |
| `strength.rule-at-three.twelve-binary` | strength | strength | 4 | C101 |
| `strength.small-groups.two-variables` | strength | strength | 2 | C102 |
| `strength.small-groups.one-variable` | strength | strength | 1 | C102 |
| `strength.small-groups.no-variable` | strength | strength | 2 | C102 |
| `strength.overlapping-rules.share-two` | strength | strength | 3 | C103 |
| `strength.overlapping-rules.share-three` | strength | strength | 4 | C103 |
| `strength.axis-in-rule.one-shared` | strength | strength | 3 | C104 |
| `strength.axis-in-rule.all-shared` | strength | strength | 4 | C104 |
| `strength.no-uniform-explosion.ten-rules` | strength | strength | 3 | C105 |
| `strength.no-uniform-explosion.mixed-groups` | strength | strength | 4 | C105 |
| `strength.no-uniform-explosion.forty-rules` | strength | strength | 5 | C105 |
| `strength.row-economy.six-binary` | strength | strength | 3 | C106 |
| `strength.row-economy.five-ternary` | strength | strength | 3 | C106 |
| `strength.row-economy.four-quaternary` | strength | strength | 4 | C106 |
| `strength.row-economy.eight-binary` | strength | strength | 4 | C106 |
| `strength.rows-complete-and-valid.small` | strength | strength | 1 | C107 |
| `strength.rows-complete-and-valid.rules-and-axes` | strength | strength | 2 | C107 |
| `strength.rows-complete-and-valid.mixed-arity` | strength | strength | 3 | C107 |
| `strength.report-matches-counter.axes` | strength | strength | 3 | C108 |
| `strength.report-matches-counter.rules` | strength | strength | 3 | C108 |
| `strength.report-matches-counter.mixed` | strength | strength | 4 | C108 |
| `strength.any-seed-integer.zero` | strength | strength | 2 | C109 |
| `strength.any-seed-integer.negative` | strength | strength | 3 | C109 |
| `strength.any-seed-integer.large` | strength | strength | 4 | C109 |
| `seeds.lead-the-plan.one-seed` | seed-rows | plan-order | 1 | C110 |
| `seeds.lead-the-plan.five-seeds` | seed-rows | plan-order | 1 | C110 |
| `seeds.lead-the-plan.thirty-seeds` | seed-rows | plan-order | 2 | C110 |
| `seeds.lead-the-plan.partial-seeds` | seed-rows | plan-order | 3 | C110 |
| `seeds.lead-the-plan.weights-would-reorder` | seed-rows | plan-order | 3 | C110 |
| `seeds.lead-the-plan.key-order-differs` | seed-rows | plan-order | 3 | C110 |
| `seeds.new-rows-for-missing.random-three-seeds` | seed-rows | plan-order | 2 | C111 |
| `seeds.new-rows-for-missing.full-seeds-binary-axes` | seed-rows | plan-order | 2 | C111 |
| `seeds.new-rows-for-missing.full-seeds-rule-triples` | seed-rows | plan-order | 3 | C111 |
| `seeds.new-rows-for-missing.full-seeds-mixed` | seed-rows | plan-order | 3 | C111 |
| `seeds.new-rows-for-missing.thirty-percent-covered` | seed-rows | plan-order | 3 | C111 |
| `seeds.new-rows-for-missing.half-covered` | seed-rows | plan-order | 3 | C111 |
| `seeds.new-rows-for-missing.ninety-percent-covered` | seed-rows | plan-order | 3 | C111 |
| `seeds.new-rows-for-missing.rare-tuples-only` | seed-rows | plan-order | 4 | C111 |
| `seeds.new-rows-for-missing.mostly-covered` | seed-rows | plan-order | 4 | C111 |
| `seeds.partial-rows-credit.assigned-variables-only` | seed-rows | plan-order | 3 | C112 |
| `seeds.partial-rows-credit.triple-needs-three-assigned` | seed-rows | plan-order | 4 | C112 |
| `seeds.empty-list.empty-array` | seed-rows | plan-order | 1 | C113 |
| `seeds.empty-list.absent-option` | seed-rows | plan-order | 1 | C113 |
| `seeds.credit-at-every-strength.values-missing` | seed-rows | plan-order | 3 | C114 |
| `seeds.credit-at-every-strength.pairs-missing` | seed-rows | plan-order | 3 | C114 |
| `seeds.credit-at-every-strength.triples-missing` | seed-rows | plan-order | 4 | C114 |
| `seeds.row-ids-unique.plain` | seed-rows | plan-order | 2 | C115 |
| `seeds.row-ids-unique.many` | seed-rows | plan-order | 3 | C115 |
| `seeds.no-duplicate-rows.new-vs-seed` | seed-rows | plan-order | 3 | C116 |
| `seeds.no-duplicate-rows.new-vs-new` | seed-rows | plan-order | 3 | C116 |
| `seeds.many-seeds.five-hundred` | seed-rows | plan-order | 4 | C117 |
| `seeds.many-seeds.three-thousand` | seed-rows | plan-order | 5 | C117 |
| `seeds.pure-copy.seed-objects-not-aliased` | seed-rows | plan-order | 3 | C118 |
| `seeds.pure-copy.later-mutation-safe` | seed-rows | plan-order | 4 | C118 |
| `budget.prefix-of-full-plan.middle` | budget-order | plan-order | 2 | C119 |
| `budget.prefix-of-full-plan.one-row` | budget-order | plan-order | 1 | C119 |
| `budget.prefix-of-full-plan.all-but-one` | budget-order | plan-order | 3 | C119 |
| `budget.prefix-of-full-plan.with-seeds` | budget-order | plan-order | 3 | C119 |
| `budget.prefix-of-full-plan.above-total` | budget-order | plan-order | 2 | C119 |
| `budget.prefix-of-full-plan.three-budgets-nested` | budget-order | plan-order | 3 | C119 |
| `budget.prefix-of-full-plan.every-budget-nested` | budget-order | plan-order | 4 | C119 |
| `budget.prefix-of-full-plan.every-budget-length` | budget-order | plan-order | 2 | C119 |
| `budget.prefix-of-full-plan.seeds-plus-budget-length` | budget-order | plan-order | 3 | C119 |
| `budget.prefix-of-full-plan.zero-budget` | budget-order | plan-order | 3 | C119 |
| `budget.new-rows-common-first.four-variables` | budget-order | plan-order | 2 | C120 |
| `budget.new-rows-common-first.ten-variables` | budget-order | plan-order | 3 | C120 |
| `budget.new-rows-common-first.equal-shares-ties` | budget-order | plan-order | 3 | C120 |
| `budget.new-rows-common-first.cut-tight-budget` | budget-order | plan-order | 3 | C120 |
| `budget.new-rows-common-first.cut-with-seeds` | budget-order | plan-order | 3 | C120 |
| `budget.new-rows-common-first.cut-half-budget` | budget-order | plan-order | 3 | C120 |
| `budget.invalid-values.negative` | budget-order | plan-order | 4 | C121 |
| `budget.invalid-values.nan` | budget-order | plan-order | 4 | C121 |
| `budget.invalid-values.fraction` | budget-order | plan-order | 4 | C121 |
| `budget.invalid-values.string` | budget-order | plan-order | 5 | C121 |
| `budget.log-space-weights.two-hundred-variables` | budget-order | plan-order | 5 | C122 |
| `budget.log-space-weights.skewed-hundred` | budget-order | plan-order | 5 | C122 |
| `budget.weights-from-store.owner-declared` | budget-order | plan-order | 3 | C123 |
| `budget.weights-from-store.from-conversations` | budget-order | plan-order | 4 | C123 |
| `budget.uniform-without-weights.no-weights` | budget-order | plan-order | 2 | C124 |
| `budget.uniform-without-weights.partial-weights` | budget-order | plan-order | 3 | C124 |
| `budget.weight-reported.short-rows` | budget-order | plan-order | 3 | C125 |
| `budget.weight-reported.uneven-shares` | budget-order | plan-order | 3 | C125 |
| `determinism.same-seed-same-bytes.tiny` | determinism | determinism | 1 | C126 |
| `determinism.same-seed-same-bytes.rules-seeds-budget` | determinism | determinism | 2 | C126 |
| `determinism.same-seed-same-bytes.heavy-constraints` | determinism | determinism | 3 | C126 |
| `determinism.same-seed-same-bytes.equal-weights-ties` | determinism | determinism | 3 | C126 |
| `determinism.same-seed-same-bytes.two-hundred-binary` | determinism | determinism | 4 | C126 |
| `determinism.interleaved-calls.other-store-between` | determinism | determinism | 2 | C127 |
| `determinism.interleaved-calls.other-budget-between` | determinism | determinism | 3 | C127 |
| `determinism.across-processes.default-env` | determinism | determinism | 3 | C128 |
| `determinism.across-processes.other-time-zone` | determinism | determinism | 4 | C128 |
| `determinism.across-processes.turkish-locale` | determinism | determinism | 5 | C128 |
| `determinism.across-processes.accented-ids-sort` | determinism | determinism | 4 | C128 |
| `determinism.no-ambient-randomness.math-random-throws` | determinism | determinism | 3 | C129 |
| `determinism.no-ambient-randomness.clock-frozen-differently` | determinism | determinism | 3 | C129 |
| `determinism.no-ambient-randomness.crypto-throws` | determinism | determinism | 4 | C129 |
| `determinism.no-ambient-randomness.all-three` | determinism | determinism | 4 | C129 |
| `determinism.key-order.store-keys` | determinism | determinism | 3 | C130 |
| `determinism.key-order.seed-row-keys` | determinism | determinism | 3 | C130 |
| `determinism.json-round-trip.store` | determinism | determinism | 2 | C131 |
| `determinism.json-round-trip.options` | determinism | determinism | 2 | C131 |
| `determinism.inputs-not-written.frozen-store` | determinism | determinism | 2 | C132 |
| `determinism.inputs-not-written.frozen-seeds` | determinism | determinism | 2 | C132 |
| `determinism.inputs-not-written.frozen-options` | determinism | determinism | 2 | C132 |
| `determinism.store-bytes.two-calls` | determinism | determinism | 2 | C133 |
| `determinism.store-bytes.other-key-order` | determinism | determinism | 3 | C133 |
| `determinism.store-bytes.across-processes` | determinism | determinism | 4 | C133 |
| `scale.pairwise-binary.n20` | scale | scale | 3 | C134 |
| `scale.pairwise-binary.n50` | scale | scale | 3 | C134 |
| `scale.pairwise-binary.n100` | scale | scale | 4 | C134 |
| `scale.pairwise-binary.n200` | scale | scale | 4 | C134 |
| `scale.pairwise-binary.n400` | scale | scale | 5 | C134 |
| `scale.pairwise-binary.ternary-30` | scale | scale | 3 | C134 |
| `scale.pairwise-binary.ternary-60` | scale | scale | 4 | C134 |
| `scale.pairwise-binary.arity-eight-10` | scale | scale | 4 | C134 |
| `scale.pairwise-binary.arity-eight-20` | scale | scale | 5 | C134 |
| `scale.many-rules.twenty-rules` | scale | scale | 3 | C135 |
| `scale.many-rules.hundred-rules` | scale | scale | 5 | C135 |
| `scale.many-rules.heavy-overlap` | scale | scale | 5 | C135 |
| `scale.thousand-others.one-thousand` | scale | scale | 4 | C136 |
| `scale.thousand-others.five-thousand` | scale | scale | 5 | C136 |
| `scale.many-impossible-pairs.two-thousand` | scale | scale | 4 | C137 |
| `scale.many-impossible-pairs.twenty-thousand` | scale | scale | 5 | C137 |
| `scale.estate-spans.two-hundred` | scale | scale | 3 | C138 |
| `scale.estate-spans.two-thousand` | scale | scale | 4 | C138 |
| `scale.estate-spans.ten-thousand` | scale | scale | 5 | C138 |
| `scale.conversations.ten-thousand` | scale | scale | 3 | C139 |
| `scale.conversations.hundred-thousand` | scale | scale | 5 | C139 |
| `scale.counter-big-plan.hundred-binary-t3` | scale | scale | 5 | C140 |
| `scale.counter-big-plan.two-hundred-binary-t2` | scale | scale | 4 | C140 |
| `scale.big-arity-axis.arity-two-hundred` | scale | scale | 4 | C141 |

## 7. Causes

These labels are hypotheses about repairs, not evidence of independent fixes. The independent cause audit in audit.md is pending; differently worded labels may share one repair. Known duplicate quote causes are merged and the empty-variable cleanup is separated by variant.

| Cause | The change | Stems | Items |
| --- | --- | --- | --- |
| C1 | buildStore turns a numeric condition span of the estate into one variable | 1 | 2 |
| C2 | a boolean condition span becomes a variable with a true and a false value | 1 | 3 |
| C3 | a membership condition span becomes a variable with an in-list side and an out-of-list side | 1 | 2 |
| C4 | the estate source returns no variable for a span that states no condition | 1 | 3 |
| C5 | spans that name the same quantity merge into one variable | 1 | 4 |
| C6 | spans that name different quantities stay different variables | 1 | 3 |
| C7 | each rule lists the variables its condition spans and tool evidence name | 1 | 5 |
| C8 | tool evidence input fields become variables with one value per listed value | 1 | 2 |
| C9 | the conversation source counts, per value, the sessions that show it and those that observe its variable | 1 | 3 |
| C10 | the total of a variable counts only the sessions that observe it | 1 | 2 |
| C11 | a value seen in conversations and absent from the store is added as an unapproved proposal with its counts as provenance | 1 | 1 |
| C12 | the conversation source hashes the private set of sessions into set_hash | 1 | 4 |
| C13 | the conversation source keeps counts only: no session id or text reaches the store | 1 | 3 |
| C14 | the owner source adds a missing value with the owner's words as provenance | 1 | 2 |
| C15 | the owner source records an impossible pair with the owner's words | 1 | 2 |
| C16 | the owner source records a declared weight with the owner's words | 1 | 3 |
| C17 | the owner's words are stored byte for byte | 1 | 4 |
| C18 | the owner source keeps the day the owner spoke and refuses an unreal day or a blank statement | 1 | 4 |
| C19 | a value known to several sources keeps one provenance entry per source | 1 | 3 |
| C20 | the store content does not depend on the order of the source entries | 1 | 3 |
| C21 | buildStore accepts empty sources | 1 | 3 |
| C22 | a value whose quote appears verbatim in its source file is kept | 1 | 4 |
| C23 | a value whose normalized quote is absent from its named source is refused | 2 | 11 |
| C24 | a quote cited from a source path the estate does not hold is refused | 1 | 3 |
| C25 | an empty or blank quote is refused although every file contains it | 1 | 2 |
| C27 | quote matching folds whitespace runs while keeping the stored quote unchanged | 1 | 2 |
| C28 | quotes are matched as plain text, never as patterns | 1 | 6 |
| C29 | quote matching applies the documented Unicode and typography normalization | 1 | 4 |
| C30 | refusing a value preserves its valid sibling values | 1 | 3 |
| C142 | a variable left with no accepted value is dropped | 1 | 1 |
| C31 | every refused value is listed with a reason that names it | 1 | 3 |
| C32 | values from the owner and from conversations are kept without a file quote | 1 | 3 |
| C33 | a condition span whose text is not in its source file yields no variable and a refusal | 1 | 3 |
| C34 | the stored quote and source path are the given ones, byte for byte | 1 | 3 |
| C35 | quotes are looked up in the given files only, never on disk | 1 | 3 |
| C36 | quote verification stays linear in file size and in values | 1 | 3 |
| C37 | variable ids are normalised to the id grammar of the variable store format | 1 | 4 |
| C38 | value ids are normalised to the value id grammar | 1 | 3 |
| C39 | ids derive from the text alone, with no counter shared between calls | 1 | 2 |
| C40 | colliding ids are disambiguated, never merged or dropped | 1 | 3 |
| C41 | an owner value joins its variable and leaves the other values unchanged | 1 | 3 |
| C42 | an owner value that exists gains the owner provenance instead of a duplicate | 1 | 2 |
| C43 | variable and value tables are built without prototype keys | 1 | 5 |
| C44 | a variable can hold thousands of values without quadratic work | 1 | 2 |
| C45 | the planner uses only approved values and variables (the machine proposes, a person approves) | 1 | 4 |
| C46 | buildStore returns objects that share nothing with its input or with an earlier result | 1 | 2 |
| C47 | buildStore never writes to its input | 1 | 3 |
| C48 | the estate source reads the greater-than wordings (over, more than, exceeds, greater than, >) | 1 | 5 |
| C49 | the estate source reads the at-least wordings (at least, no less than, N or more, >=) | 1 | 4 |
| C50 | the estate source reads the less-than wordings (under, below, fewer than, <) | 1 | 4 |
| C51 | the estate source reads the at-most wordings (at most, no more than, N or fewer, <=) | 1 | 4 |
| C52 | the estate source reads the equality wordings (exactly, equals, ==) | 1 | 3 |
| C53 | the estate source reads the inequality wordings (not equal to, other than, !=) | 1 | 3 |
| C54 | a range condition yields both edges and a value inside and outside | 1 | 3 |
| C55 | decimal thresholds are read exactly | 1 | 4 |
| C56 | a negative threshold keeps its sign | 1 | 2 |
| C57 | a zero threshold is a threshold | 1 | 2 |
| C58 | thousands separators belong to the number | 1 | 3 |
| C59 | thresholds beyond 32 bits are read without overflow | 1 | 3 |
| C60 | unit words and currency signs around the number do not change the threshold | 1 | 4 |
| C61 | number words are read as numbers | 1 | 3 |
| C62 | values from several spans of one variable are merged without duplicate samples | 1 | 3 |
| C63 | an integer threshold gets integer samples on both sides | 1 | 3 |
| C64 | the quote of a boundary value is the span text copied from its file, with the path of the file | 1 | 2 |
| C65 | plan rows never hold two values the store marks impossible | 1 | 5 |
| C66 | required tuples exclude those that hold an impossible pair | 1 | 6 |
| C67 | an impossible pair is unordered | 1 | 2 |
| C68 | repeated impossible pairs count once | 1 | 2 |
| C69 | a pair of two values of one variable changes nothing | 1 | 2 |
| C70 | an owner pair that names an unknown variable or value is refused with a reason | 1 | 3 |
| C71 | a value that no partner value allows is never used and never required | 1 | 3 |
| C72 | a space with no valid row yields no rows or a named error, never an invalid row | 1 | 2 |
| C73 | row construction completes tightly constrained rows by search, not by chance | 1 | 5 |
| C74 | new rows next to seeds still avoid impossible pairs | 1 | 2 |
| C75 | a value's weight is its share of the sessions that observe its variable | 1 | 4 |
| C76 | a variable seen in conversations weighs every one of its values, in proportion to the counts | 1 | 3 |
| C77 | the weight interval is clamped to 0..1 and holds the weight | 1 | 3 |
| C78 | the weight interval formula keeps rare shares covered (a score or exact interval, not the normal approximation) | 1 | 8 |
| C79 | the weight interval is computed from the counts, so it narrows as sessions grow | 1 | 4 |
| C80 | the weight interval uses the 95 percent critical value 1.96 | 1 | 2 |
| C81 | a value never seen keeps a share near 0 and an interval from 0 to a bound above 0 | 1 | 3 |
| C82 | a value seen in every session has an upper bound of 1 and a lower bound below 1 | 1 | 2 |
| C83 | a variable with no observation gets no NaN weight and no made-up weights | 1 | 3 |
| C84 | weights are not biased away from the planted mix | 1 | 3 |
| C85 | an owner weight is stored exactly as declared | 1 | 4 |
| C86 | an owner weight that is not a finite number from 0 up is refused with a reason | 1 | 5 |
| C87 | the counter sums the products of arities over every subset of min(t, k) variables | 1 | 9 |
| C88 | the counter removes tuples that hold an impossible pair | 1 | 3 |
| C89 | the counter agrees with exhaustive enumeration on random small spaces | 1 | 3 |
| C90 | a tuple counts as allowed only when some valid full row holds it | 1 | 8 |
| C91 | the counter counts the distinct allowed tuples the rows hold | 1 | 3 |
| C92 | a partial row covers only tuples inside its assigned variables | 1 | 2 |
| C93 | a tuple shared by overlapping groups counts once | 1 | 3 |
| C94 | counts beyond 2 to the 53 are exact (bigint) | 1 | 2 |
| C95 | the counter lists the uncovered tuples, up to a limit | 1 | 3 |
| C96 | the counter refuses an unknown variable or a strength that is not a positive whole number | 1 | 4 |
| C97 | the allowed count comes from a formula, not from enumerating tuples | 1 | 2 |
| C98 | variables outside every rule and axis are covered at strength 1 | 1 | 4 |
| C99 | variables outside the rules and axes cost rows by arity only | 1 | 2 |
| C100 | shared axes are covered at strength 2 | 1 | 7 |
| C101 | each rule's own variables are covered at strength 3 | 1 | 7 |
| C102 | a group smaller than its strength is covered in full | 1 | 3 |
| C103 | rules that share variables are covered on the union of their triples | 1 | 2 |
| C104 | a variable that is both an axis and a rule variable meets both strengths | 1 | 2 |
| C105 | strength 3 applies only inside a rule's own variables | 1 | 3 |
| C106 | rows are chosen to cover many uncovered tuples at once, not by taking the full product | 1 | 4 |
| C107 | each new row holds exactly one valid value for every variable | 1 | 3 |
| C108 | the plan report counts allowed and covered tuples exactly | 1 | 3 |
| C109 | any integer seed gives a complete array | 1 | 3 |
| C110 | seed rows lead the plan, in the order given, unchanged, marked as seeds | 1 | 6 |
| C111 | new rows are added only for tuples the seeds miss, each covering at least one | 1 | 9 |
| C112 | a seed row covers only the tuples whose variables it assigns | 1 | 2 |
| C113 | an empty seed list changes nothing | 1 | 2 |
| C114 | seed coverage is credited at every group strength | 1 | 3 |
| C115 | every plan row has an id and the ids are unique | 1 | 2 |
| C116 | no new row repeats a seed or another new row | 1 | 2 |
| C117 | seed credit stays linear in the number of seeds | 1 | 2 |
| C118 | plan seed rows are copies, not the caller's objects | 1 | 2 |
| C119 | a budget keeps the first rows of the unbudgeted plan | 1 | 10 |
| C120 | new rows are ordered by traffic weight, most common first, so a budget cuts the rarest rows first | 1 | 6 |
| C121 | a budget that is not a non-negative whole number is refused with a RangeError that names it | 1 | 4 |
| C122 | row weights are compared in log space so long rows keep their order | 1 | 2 |
| C123 | the traffic weight of a row reads the store's weights, whatever their source | 1 | 2 |
| C124 | variables without weights count as uniform | 1 | 2 |
| C125 | each plan row reports its traffic weight as the product of its value shares | 1 | 2 |
| C126 | the same store, options and seed give byte-identical plans | 1 | 5 |
| C127 | a plan does not depend on earlier calls | 1 | 2 |
| C128 | a plan does not depend on the process, its locale or its time zone | 1 | 4 |
| C129 | planning draws randomness only from the seed | 1 | 4 |
| C130 | a plan does not depend on the key order of the objects it reads | 1 | 2 |
| C131 | a plan depends only on the JSON content of its inputs | 1 | 2 |
| C132 | planning never writes to its inputs | 1 | 3 |
| C133 | buildStore gives byte-identical stores for the same sources | 1 | 3 |
| C134 | the planner builds a pairwise array over hundreds of binary variables with a bounded row count | 1 | 9 |
| C135 | the planner covers many rule groups at strength 3 with a bounded row count | 1 | 3 |
| C136 | variables outside rules and axes cost rows by arity, not by count | 1 | 2 |
| C137 | impossible pairs are looked up in constant time | 1 | 2 |
| C138 | reading the estate is linear in spans and file size | 1 | 3 |
| C139 | counting conversations is linear in sessions | 1 | 2 |
| C140 | coverage counting stays linear in rows times tuples per row | 1 | 2 |
| C141 | the planner handles an axis with hundreds of values | 1 | 1 |

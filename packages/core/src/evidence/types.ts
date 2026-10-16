import type { BlockResult, ExecutionRecord, ToolCall, Verdict } from '../schema/run';

/**
 * The evidence a blame or placement rule reads (codeagent_equivalence_blame.md, Part D). A rule never computes
 * evidence: it reads names, each computed once by one provider below from the stored run, the estate map and
 * what the value check, the replay and the confirm runs stored. Nothing here calls a model or an agent.
 */

/** How a name is computed: from stored records only, by a calibrated judge, or by an agent run. */
export type EvidenceCost = 'static' | 'judge' | 'run';

/** What the value check stored about one value of a failing verdict (the value-check ladder's record). */
export type ValueFact = {
  /** The tool label of the call the value was sent in, when it is a tool input. */
  tool?: string;
  /** The top-level input key, and the path inside its value. */
  field?: string;
  path?: readonly string[];
  /** The index of the call among the calls of that tool. */
  call?: number;
  /** The value the agent produced. */
  value: unknown;
  /** The gold value, when the oracle states one. */
  gold?: unknown;
  /** The rung that settled the value, such as rung1, rung2, rung3 or rung4. */
  rung?: string;
  /** What the rung settled: pass, fail, inconclusive. */
  settles?: 'pass' | 'fail' | 'inconclusive';
  /** The rung's outcome when it states one: accepted_as_gold, failed or resolved_differently. */
  outcome?: 'accepted_as_gold' | 'failed' | 'resolved_differently';
  /** The oracle's provenance tag for the expected value, when the oracle tags it. */
  source?: string;
  /** The as-given rung's reading of how the value changed from its source. */
  change?: string;
  /** Where the format of the value is stated, when the contract rung found one. */
  contract?: string;
  /** Whether the stated format is broken, when the contract rung checked one. */
  contractBroken?: boolean;
  /** The recompute rung: true when the result passes on the seed inputs and fails on changed inputs. */
  changedInputsFail?: boolean;
  /** The format the failing check demanded, such as its regex, when the check has one. */
  demanded?: string;
};

/** A place the estate states a rule: an atom of the estate map, read structurally. */
export type RuleAtom = {
  id: string;
  kind: string;
  title?: string;
  provenance: { file: string; startLine: number; endLine?: number; quote?: string };
  situation?: string;
  evidence?: ReadonlyArray<Record<string, unknown> & { type: string }>;
  enforcement?: readonly string[];
  fields?: Record<string, unknown>;
};

/** An edge of the estate graph, read structurally. */
export type RuleEdge = { from: string; to: string; kind: string };

/**
 * A link from a failing check to the line it enforces, for a block with no estate atoms: a prompt line, a
 * skill line or a tool schema field (`links` with `relation: verifies`). `verdict` is a verdict id or an id
 * prefix ending in `*`.
 */
export type RuleLink = {
  verdict: string;
  /** Where the rule lives: core, skill_body, skill_reference, skill_script, helper, guard, tool_schema, instruction. */
  home: string;
  /** The act class the rule asks for: step, gate, recovery, ordered, stage, load_skill, read_reference, ... */
  act: string;
  file?: string;
  line?: number;
  skill?: string;
  quote?: string;
};

/**
 * What a stated rule says about one tool input field: which parts it asks the user for, which the tool needs,
 * and the recovery it prescribes after a miss. Read once from the prompt or a skill line.
 */
export type StatedRule = {
  tool: string;
  field?: string;
  /** Where it is stated: prompt, instruction, skill or tool. */
  where: string;
  /** A format the rule states for the value, as a regular expression over the whole value. */
  format?: string;
  /** The parts the rule asks the user for, such as street_number, street_name, town. */
  asks?: readonly string[];
  /** The parts the tool needs; a part the rule asks and the tool does not need is extra. */
  toolNeeds?: readonly string[];
  /** The next action the rule prescribes after the tool misses: asked_user, retried_canonical. */
  recovery?: string;
  file?: string;
  line?: number;
};

/** What a reply classifier stored for the reply (a recorded judge answer; replayed, never called here). */
export type ReplyReading = {
  next_action?: string;
  asked_for?: readonly string[];
  task_flagged?: boolean;
  /** The model or recording that produced it. */
  by?: string;
};

/** One line of a guard decision log: `{at, event, check, verdict}`. */
export type GuardDecision = { at?: string; event?: string; check: string; verdict: string };

/** What a tool's own usage text promises about a successful call, so silence can be told from success. */
export type ToolPromise = {
  /** A tool label, or a command pattern (a substring of the command) for a script. */
  tool: string;
  /** The output must not be empty. */
  prints?: boolean;
  /** The output must match this regular expression. */
  matches?: string;
  /** Where the promise is written: a docstring, a skill line. */
  from?: string;
};

/** Counts out of `runs` that a confirm run stored (diagnostic/liability-confirm). */
export type ConfirmEvidence = {
  runs?: number;
  reference_pass?: number;
  reference_loads?: number;
  forced_load_pass?: number;
  hint_pass?: number;
  by?: string;
};

/** One earlier diagnosis, for recurrence: its item, act signature and home. */
export type PastDiagnosis = {
  item: string;
  act?: string;
  /** The skill whose block showed it, or `none` for a block with no routed skill. */
  home: string;
  run?: string;
};

/** The block-level expectations a provider reads, beside the run record. */
export type BlockExpect = {
  /** Routed skills: `expect.skills`. */
  skills?: readonly string[];
  /** The tools the block expects, in their expected order. */
  tools?: readonly string[];
  /** Paths a change on fails, whoever wrote them. */
  protected?: readonly string[];
  /** The block declares the task impossible or its tests conflicting. */
  taskImpossible?: boolean;
  /** A consumer the block or project declares for the value. */
  downstream?: boolean;
  /** The block's situation, for situational pointers. */
  situation?: string;
  /** The atoms the block's situation holds, when the plan or the phrase bank lists them. */
  situationAtoms?: readonly string[];
};

/** Everything a provider may read about one failing verdict. Every field but `block` and `verdict` is optional. */
export type EvidenceInput = {
  block: Pick<BlockResult, 'observed' | 'verdicts'> & Partial<Pick<BlockResult, 'index' | 'blockId'>>;
  /** The failing verdict the evidence is about: the root of its chain. */
  verdict: Verdict;
  /** The user turn the agent received, when the driver recorded it. */
  user?: string;
  expect?: BlockExpect;
  /** The value check's record for this verdict's values. */
  values?: readonly ValueFact[];
  /** Atom ids the failing expectation enforces: `metadata.estate.atoms` of an estate spec. */
  ruleAtoms?: readonly string[];
  /** The estate map's atoms and edges. */
  atoms?: readonly RuleAtom[];
  edges?: readonly RuleEdge[];
  links?: readonly RuleLink[];
  stated?: readonly StatedRule[];
  /** Tool input schemas by tool label, for a format the tool itself states. */
  toolSchemas?: Readonly<Record<string, unknown>>;
  promises?: readonly ToolPromise[];
  reply?: ReplyReading;
  decisions?: readonly GuardDecision[];
  /** A sandbox re-execution with the agent's test edits reverted: true when the provided tests then fail. */
  testsFailReverted?: boolean;
  confirm?: ConfirmEvidence;
  history?: readonly PastDiagnosis[];
  /** The block's plan rows (its own row, and rows naming the rule's atom), for `rule_needed_by` and `skill_covers`. */
  planRows?: ReadonlyArray<{ atomIds: readonly string[]; testType?: string; skill?: string }>;
  /** The longest retry streak that counts as a loop (CRITICTOOL appendix C.3). */
  maxRetries?: number;
  /** Confirm runs out of `confirm.runs` that count as passes. */
  bar?: number;
  /** The blame item and act signature already attributed, for recurrence (placement reads it). */
  attributed?: { item: string; act?: string; home?: string };
  /** Runs per home before a home counts, for recurrence. */
  minRunsPerHome?: number;
  /** Whether the no-skill home participates in recurrence; placement supplies its policy param. */
  countNoSkillHome?: boolean;
};

/** A computed evidence value: a word, a number, a boolean, a list, a map, or absent. */
export type EvidenceValue =
  | string
  | number
  | boolean
  | readonly string[]
  | Record<string, unknown>
  | undefined;

/**
 * One evidence name and how it is found. A provider either computes its name from the stored run and the map
 * (`compute`), or derives it from names already computed for the same root (`derive`, with the names it
 * `reads`). No provider calls another: shared logic lives in helpers, and `computeEvidence` runs each provider
 * once per root.
 */
export type EvidenceProvider = {
  name: string;
  cost: EvidenceCost;
  /** The values the name takes, for the reference page; `number`, `boolean` or `list` for open ones. */
  values: readonly string[];
  /** What it is computed from, for the reference page. */
  from: string;
  compute?: (input: EvidenceInput) => EvidenceValue;
  /** The names a derived provider reads. */
  reads?: readonly string[];
  derive?: (known: Readonly<Record<string, EvidenceValue>>) => EvidenceValue;
};

export type { ExecutionRecord, ToolCall, Verdict };

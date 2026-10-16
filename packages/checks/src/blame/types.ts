import type { Layer } from '@agent-nexus/driftbench-core';

/**
 * What blame and placement write for one failing verdict (codeagent_equivalence_blame.md B1, G5). Three answers:
 * `fault` (who made the mistake at run time), `disposition` (how it counts for the agent) and `fix_location`
 * (where one change stops the class recurring). The machine verdict is never changed.
 */

/** How a failure counts in the agent-attributed pass rate. `unassigned` is reported apart, never folded in. */
export type Disposition = 'agent' | 'shared' | 'setup' | 'excluded' | 'credited' | 'unassigned';

/** How sure the reading is: from stored records only, still open (run liability-confirm), or confirmed by runs. */
export type Confidence = 'static' | 'undecided' | 'confirmed';

/** What a blame item writes: the first item whose condition holds. */
export type Attribution = {
  /** The blame item that fired. */
  item: string;
  /** `policy/blame:<id>@<hash8>#<item>`: the object, its content hash and the item. */
  rule: string;
  /** The deciding item's resolved origin; inherited diagnoses retain the root's stamp. */
  by?: { object: string; item: string; impl: string; layer: Layer };
  /** The attributed verdict, carried by the diagnosis: pass, fail or not_scored. The machine pass stays final. */
  verdict: string;
  fault: string[];
  disposition: Disposition;
  fix_action: string;
  /** Set when the item names the place itself (`place: fixed`). */
  fix_location?: string;
  place: 'fixed' | 'auto';
  /** The act class of the mistake, for its recurrence signature. */
  act?: string;
  /** The act the agent's share of a tool fault is placed by. */
  agent_share_act?: string;
  confidence: Confidence;
  flags: string[];
};

/** What placement writes on top of an attribution. */
export type Placement = {
  fix_location: string;
  fix_target?: string;
  fix_forms: string[];
  /** `policy/placement:<id>@<hash8>#<item>`. */
  placement: string;
  /** The local fixes a core fix replaces: moved, not duplicated. */
  remove_copies: string[];
  /** True when placed with no history of the estate (skill-local by default). */
  provisional: boolean;
  flags: string[];
};

/** One diagnosis on a block (`BlockResult.diagnoses[]`): the fields of codeagent_equivalence_blame.md G5. */
export type BlameDiagnosis = {
  diagnostic: string;
  verdict_ref: string;
  /** The root verdict a chained verdict inherits its diagnosis from. */
  inherits?: string;
  rule: string;
  /** The deciding item's resolved origin; inherited diagnoses retain the root's stamp. */
  by?: { object: string; item: string; impl: string; layer: Layer };
  fault: string[];
  disposition: Disposition;
  fix_location: string;
  fix_target?: string;
  fix_action: string;
  fix_forms: string[];
  placement: string;
  evidence: Record<string, unknown>;
  confidence: Confidence;
  flags: string[];
  remove_copies?: string[];
  /** The recurrence signature's parts: the item, the act, and the home (a skill, or `none`). */
  item: string;
  act?: string;
  home: string;
};

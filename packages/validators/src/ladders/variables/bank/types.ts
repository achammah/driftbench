/** Doc-owned ports. No store, feed, interview or planner implementation is imported here. */
export type Tier = 1 | 2 | 3 | 4 | 5;
export type Cell = Record<string, string>;
export type Evidence = Record<string, unknown>;
export type Value = {
  id: string;
  title: string;
  weight?: number;
  approved?: boolean;
  required?: boolean;
  provenance?: Evidence[];
  when?: Record<string, string[]>;
  unless?: Record<string, string[]>;
  polarity?: 'must' | 'must_not';
  limit?: number;
  within?: { minutes: number };
  priority?: 'first';
};
export type Boundary = {
  holds: string;
  fails: string;
  edge: string;
  limit?: number;
  comparison?: 'lt' | 'le' | 'gt' | 'ge';
  unit?: string;
  provenance?: Evidence[];
};
export type Variable = {
  id: string;
  title: string;
  kind: 'stage' | 'behaviour' | 'deviation' | 'persona' | 'channel' | 'data' | 'task';
  role: 'axis' | 'detail';
  approved: boolean;
  values: Value[];
  provenance?: Evidence[];
  boundaries?: Boundary[];
};
export type Constraint = {
  forbid: Cell;
  reason: string;
  approved: boolean;
  provenance?: Evidence[];
};
export type Store = {
  format: 1;
  agent: string;
  version: string;
  variables: Variable[];
  constraints: Constraint[];
  prior?: { kind: 'declared' | 'fitted'; source?: string };
};
export type Issue = { code: string; path: string };
export type Options = {
  seed: number;
  budget?: number;
  approvedOnly?: boolean;
  seeds?: { id: string; values: Cell }[];
};
export type Request =
  | { operation: 'validate'; store: unknown }
  | { operation: 'quotes'; store: Store; files: Record<string, string> }
  | { operation: 'plan'; store: Store; options: Options };
export type Row = { id: string; source: 'seed' | 'planned'; values: Cell; logWeight: number | null };
export type LayerName = 'own' | 'shared' | 'single';
export type Layer = {
  strength: number;
  groups: number;
  targets: number;
  infeasible: number;
  seeded: number;
  covered: number;
  uncovered: number;
};
export type Plan = {
  agent: string;
  version: string;
  seed: number;
  budget?: number | null;
  generated: number;
  cut: number;
  rows: Row[];
  layers: Record<LayerName, Layer>;
  rules: { id: string; label: string; variables: string[] }[];
  warnings: { code: string; message: string }[];
};
export type Reply =
  | { ok: true; store: unknown; warnings: Issue[] }
  | { ok: false; errors: Issue[] }
  | { errors: Issue[] }
  | { plan: Plan; text: string };

/**
 * validate -> validateVariableStore; quotes -> verifyVariableQuotes (materialize ONLY fictional files);
 * plan -> planV2 + renderPlanV2. Normalize layer/warning containers, never compute missing answers.
 * The adapter sees requests only: no item IDs, causes, expected answers, tier, or oracle callbacks.
 * Keep ports in a separate process for adversarial audits: in-process code is not a security boundary.
 */
export interface VariablesAdapter {
  execute(request: Request): Promise<unknown> | unknown;
}
export type ValidationTruth = { kind: 'validation'; ok: boolean; issues: Issue[]; preserved?: unknown };
export type QuoteTruth = { kind: 'quotes'; issues: Issue[] };
/** Groups are planted independently of extraction. They are never sent to the adapter. */
export type PlanTruth = {
  kind: 'plan';
  groups: string[][];
  shared: string[];
  /** Scale uses factorized singleton groups, never an exponential reference grid. */
  factorized?: boolean;
};
export type Case = {
  request: Request;
  truth: ValidationTruth | QuoteTruth | PlanTruth;
  budgetMs?: number;
  heapBytes?: number;
};
export type Run = { case: Case; result: unknown; ms: number; heapBytes: number };
export type Outcome = { pass: boolean; detail: string };
export type BankItem = {
  id: string;
  family: string;
  tier: Tier;
  level: number;
  component: string;
  title: string;
  cause: string;
  generate(seed: number): Case[];
};

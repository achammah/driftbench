/**
 * Planner v2: test rows from a variable store, with a covering strength that follows the rules (3 on the
 * variables of one rule, 2 on the axes several rules share, 1 elsewhere), real sessions kept as seed rows, and the
 * new rows ordered by traffic weight so a budget cuts the rarest first. Opt-in: the planner of the seeders is
 * unchanged.
 */
export {
  type PlanSeedRow,
  type PlanV2,
  type PlanV2Layer,
  type PlanV2Options,
  type PlanV2Row,
  type PlanV2Warning,
  planV2,
} from './plan';
export { renderPlanV2 } from './render';
export { type StoreRule, storeRules } from './rules';

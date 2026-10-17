import { formatJson } from '../enumerate/json';
import type { PlanV2 } from './plan';

/** Log weights are written to this many places, so a plan is the same text on every machine. */
const PLACES = 9;

/**
 * The plan as JSON text, laid out like the other generated reports. A log weight is rounded to nine places; a
 * row that holds a value of weight 0 has none (null).
 */
export function renderPlanV2(plan: PlanV2): string {
  return formatJson({
    agent: plan.agent,
    version: plan.version,
    seed: plan.seed,
    ...(plan.budget === undefined ? {} : { budget: plan.budget }),
    generated: plan.generated,
    cut: plan.cut,
    layers: plan.layers,
    rules: plan.rules,
    rows: plan.rows.map((row) => ({
      id: row.id,
      source: row.source,
      values: row.values,
      logWeight: Number.isFinite(row.logWeight) ? Number(row.logWeight.toFixed(PLACES)) : null,
    })),
    warnings: plan.warnings,
  });
}

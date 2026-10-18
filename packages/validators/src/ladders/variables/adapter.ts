import type { VariablesImpl } from './interface';

/**
 * The variables implementation as the validator scores it: the one place that maps the real variable store and
 * planner to the neutral interface of the bank (interface.ts).
 *
 * It maps nothing today. The real store format and planner v2 are being built; until they land every item fails
 * with the name of the function it needs, and that is the roadmap. When the real code lands, this file converts
 * between the real store and `StoreDoc` and exports the three functions. Executors never edit it (it is part of
 * the validator, and CI refuses a change to it from an `exec/` branch).
 *
 * A mutant is planted by pointing DRIFTBENCH_VARIABLES_IMPL at another module that exports `variablesImpl`.
 */
export const variablesImpl: Partial<VariablesImpl> = {};

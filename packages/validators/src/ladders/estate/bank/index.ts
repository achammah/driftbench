import { benchFamily } from './bench';
import { blindFamilies } from './blind/index';
import { comboFamily, generatedFamily } from './combo';
import { determinismFamily } from './determinism';
import type { Family } from './frame';
import { coverageFamily, readsFamily, taskFamily } from './genquality';
import { decoysFamily, hostileFamily } from './hostile';
import { killFamily } from './kill';
import { lintCleanFamily, lintDefectFamily } from './lint';
import { genAsksFamily, genCompleteFamily, impactFamily, mutantFamily } from './loop';
import { maintainFixtureFamily } from './maintain-fixture';
import { planContractFamily, planPairsFamily, planRelevanceFamily } from './plan';
import { scaleFamily } from './scale';
import { scaleRealFamily } from './scale-real';
import { scaleSharedFamily } from './scale-shared';
import { gatesFamily, hazardsFamily, pathsFamily } from './scan-code';
import { frontmatterFamily } from './scan-front';
import { catalogueFamily, dispatcherFamily } from './scan-guards';
import { symlinkFamily } from './scan-links';
import { referenceProseFamily } from './scan-refs';
import { registryFamily } from './scan-registry';
import { standingFamily } from './scan-standing';
import { stepsFamily } from './scan-steps';
import { statsFamily } from './stats';
import { unitFamily } from './unit';

export { benchFamily } from './bench';
export { blindFamilies } from './blind/index';
export { determinismFamily } from './determinism';
export * from './frame';
export { coverageFamily, holdsTask, readsFamily, taskFamily } from './genquality';
export { killFamily } from './kill';
export { maintainFixtureFamily } from './maintain-fixture';
export { statsFamily } from './stats';
export { unitFamily } from './unit';

/** The levels of the estate bank, in order of the cost of diagnosis, each with its families. */
export const BANK_LEVELS = [
  {
    id: 'reader',
    name: 'reader and graph',
    families: () => [
      generatedFamily(),
      frontmatterFamily(),
      symlinkFamily(),
      registryFamily(),
      stepsFamily(),
      catalogueFamily(),
      dispatcherFamily(),
      referenceProseFamily(),
      gatesFamily(),
      hazardsFamily(),
      pathsFamily(),
      comboFamily(),
      hostileFamily(),
      decoysFamily(),
      standingFamily(),
      benchFamily(),
      determinismFamily(),
      ...blindFamilies(),
    ],
  },
  { id: 'lint', name: 'lint', families: () => [lintDefectFamily(), lintCleanFamily()] },
  {
    id: 'plan',
    name: 'plan',
    families: () => [planContractFamily(), planPairsFamily(), planRelevanceFamily()],
  },
  {
    id: 'generation',
    name: 'generation',
    families: () => [
      genCompleteFamily(),
      genAsksFamily(),
      taskFamily(),
      readsFamily(),
      coverageFamily(),
      unitFamily(),
      statsFamily(),
    ],
  },
  { id: 'agent-mutants', name: 'agent mutants', families: () => [mutantFamily(), killFamily()] },
  { id: 'maintenance', name: 'maintenance', families: () => [impactFamily(), maintainFixtureFamily()] },
  { id: 'scale', name: 'scale', families: () => [scaleFamily(), scaleRealFamily(), scaleSharedFamily()] },
] as const satisfies ReadonlyArray<{ id: string; name: string; families: () => Family[] }>;

/**
 * Families no product page needs (validators/estate/NEEDS.md): kept as code, left out of the bank until a
 * docs page, design section or command needs them.
 */
export const QUARANTINED: readonly string[] = [];

/** Every family of the bank, level by level, without the quarantined ones. */
export function estateBank(): Family[] {
  return BANK_LEVELS.flatMap((level) => level.families()).filter(
    (family) => !QUARANTINED.includes(family.id),
  );
}
export { comboFamily, FORMS as COMBINATION_FORMS, generatedFamily } from './combo';
export * from './hardness';
export { decoysFamily, hostileFamily } from './hostile';
export { lintCleanFamily, lintDefectFamily } from './lint';
export {
  GEN_CLASSES,
  genAsksFamily,
  genCompleteFamily,
  impactFamily,
  MUTANT_CLASSES,
  mutantFamily,
  roleOf,
} from './loop';
export { allowedTuples, planContractFamily, planPairsFamily, planRelevanceFamily } from './plan';
export { PlantedEstate, truthPort } from './planted';
export { BUDGET_FLOOR_MS, BUDGET_PER_ATOM, budgetMs, SIZES as SCALE_SIZES, scaleFamily } from './scale';
export { scaleEstate } from './scale-estate';
export { realBudgetMs, realUnits, scaleRealFamily } from './scale-real';
export { realEstate } from './scale-real-estate';
export { judgeShared, scaleSharedFamily } from './scale-shared';
export { sharedEstate } from './scale-shared-estate';
export { gatesFamily, hazardsFamily, pathsFamily } from './scan-code';
export { FRONTMATTER_FORMS, frontmatterFamily } from './scan-front';
export { catalogueFamily, dispatcherFamily } from './scan-guards';
export { symlinkFamily } from './scan-links';
export { MAX_CHUNK, referenceProseFamily } from './scan-refs';
export { registryFamily } from './scan-registry';
export { standingFamily } from './scan-standing';
export { stepsFamily } from './scan-steps';

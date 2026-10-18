/**
 * @agent-nexus/driftbench-space: the declared map of situations an agent can face (dimensions, values, constraints, a prior),
 * coverage counted per cell from specs, t-wise coverage and the completeness line. Phase G.
 */
export {
  aboutPercent,
  COMPLETENESS_ASSUMPTION,
  type Completeness,
  type CompletenessOptions,
  completeness,
  type Interval,
} from './complete';
export {
  addEventCodes,
  type CellCoverage,
  type Covered,
  cover,
  coverage,
  type DimensionTotals,
  type GridCoverage,
  type RequiredCell,
  type SpaceCoverage,
  type SpaceCoverageOptions,
  type SpaceWarning,
  type SpaceWarningCode,
  SpaceWarningCodes,
  type SpecCoverage,
  type TwiseCoverage,
  type ValueTotals,
} from './coverage';
export {
  chaoCoverage,
  effectiveSampleSize,
  goodTuringDiscovery,
  type HillNumbers,
  hillNumbers,
  quantile,
  seededRandom,
} from './estimators';
export {
  assertGridSize,
  type Cell,
  type CellsOptions,
  type CompiledConstraint,
  type CompiledDimension,
  type CompiledSpace,
  cells,
  codeOf,
  combinations,
  compileSpace,
  DEFAULT_MAX_CELLS,
  decode,
  findAllowedCell,
  forEachAllowedCell,
  gridSize,
  isForbidden,
  type ProjectedGrid,
  type Projection,
  projectGrid,
  resolveT,
  tupleValues,
} from './grid';
export {
  loadSpaceMap,
  parseSpaceMapText,
  type SpaceMapIssue,
  type SpaceMapIssueCode,
  SpaceMapIssueCodes,
  type SpaceMapResult,
  validateSpaceMap,
} from './load';
export { type PlacementEvent, placeSpec, type SpecPlacement, type UnknownValue } from './place';
export {
  DimensionKind,
  NONE,
  SpaceConstraint,
  SpaceDimension,
  SpaceId,
  SpaceMap,
  SpacePrior,
  SpaceValue,
} from './schema';
export { DEVIATION_TITLES, formatSpaceMap, fromInventory, type SeedOptions } from './seed';
export {
  spaceMapToVariables,
  type VariablesToSpaceMapOptions,
  variablesToSpaceMap,
} from './variables/convert';
export {
  loadVariableStore,
  parseVariableStoreText,
  type VariableStoreIssue,
  type VariableStoreIssueCode,
  VariableStoreIssueCodes,
  type VariableStoreResult,
  validateVariableStore,
} from './variables/load';
export { type ProvenanceEntry, variableProvenance } from './variables/provenance';
export {
  ConversationsProvenance,
  LedgerId,
  OwnerProvenance,
  QuoteProvenance,
  StructureProvenance,
  Variable,
  VariableBoundary,
  VariableConstraint,
  VariablePrior,
  VariableProvenance,
  VariableStore,
  VariableValue,
} from './variables/schema';
export {
  escapePointerToken,
  pointerOfPath,
  resolveStructure,
  type StructureResolved,
  type StructureTarget,
} from './variables/structure';

export const packageName = '@agent-nexus/driftbench-space';

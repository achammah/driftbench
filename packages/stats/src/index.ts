/** Statistics: intervals, clustered and hierarchical intervals, reliability, paired tests, multiple comparisons, power, non-inferiority, drift, agreement, variance components and coverage. */
export const packageName = '@agent-nexus/driftbench-stats';

export {
  type AlphaLevel,
  type AlphaResult,
  cohenKappa,
  type KappaIntervalOptions,
  type KappaIntervalResult,
  type KappaOptions,
  type KappaResult,
  kappaInterval,
  krippendorffAlpha,
  type Label,
} from './agreement';
export { mean, mulberry32, quantile, quantileSorted, sampleVariance, weightedMean } from './basics';
export {
  abundances,
  type ChaoResult,
  chaoCoverage,
  type GoodTuringResult,
  goodTuring,
  type HillNumbers,
  hillNumber,
  hillNumbers,
} from './coverage';
export {
  type Alarm,
  type CusumOptions,
  type CusumResult,
  cusum,
  type KsResult,
  kolmogorovSf,
  ksTest,
  type PageHinkleyOptions,
  type PageHinkleyResult,
  pageHinkley,
} from './drift';
export {
  type ClusterCount,
  type EffectiveWilson,
  type EffectiveWilsonOptions,
  wilsonEffective,
} from './effective';
export {
  type HierarchicalInterval,
  type HierarchicalOptions,
  hierarchicalBetaBinomial,
  type TreeCount,
} from './hierarchical';
export {
  type BootstrapInterval,
  type BootstrapOptions,
  bootstrapCI,
  clopperPearson,
  clusteredMeanInterval,
  designEffect,
  effectiveSampleSize,
  type Interval,
  kishEffectiveSize,
  wilson,
  Z95,
  zeroFailureBound,
  zFor,
} from './intervals';
export { type BenjaminiHochbergResult, benjaminiHochberg, type HolmResult, holm } from './multiple';
export {
  type McNemarMidPResult,
  type McNemarOptions,
  type McNemarResult,
  mcnemar,
  mcnemarMidP,
  type NonInferiorityInput,
  type NonInferiorityResult,
  nonInferiority,
  type OneWayAnovaResult,
  oneWayAnova,
  type PairedDifference,
  type PairedTable,
  pairedRateDifference,
  type WilcoxonMethod,
  type WilcoxonOptions,
  type WilcoxonResult,
  wilcoxonSignedRank,
} from './paired';
export {
  type MdeInput,
  type MdeResult,
  mde,
  type SampleSizeForEffectInput,
  type SampleSizeForEffectResult,
  sampleSizeForEffect,
} from './power';
export { passAtK, passK, unreliability } from './reliability';
export { parseRepeatReducer, type RepeatReducer, reduceRepeats } from './repeat-reducers';
export {
  type CoverageCell,
  type CoverageMethod,
  type CoverageOptions,
  type CoverageResult,
  type FamilyCoverageCell,
  type FamilyCoverageMethod,
  type FamilyCoverageResult,
  simulateCoverage,
  simulateFamilyCoverage,
} from './simulate';
export {
  betaQuantile,
  binomialCdf,
  chiSquareSf,
  erfc,
  incompleteBeta,
  logGamma,
  normalCdf,
  normalQuantile,
  normalSf,
} from './special';
export {
  type Component,
  designEffectFromData,
  icc,
  iccOneWay,
  type LevelCorrelation,
  type NeymanInput,
  type NeymanResult,
  neymanAllocation,
  type Observation,
  type RepeatsForFloorInput,
  type RepeatsForFloorResult,
  repeatsForFloor,
  type StratifiedMeanInput,
  stratifiedMean,
  type VarianceComponentsOptions,
  type VarianceComponentsResult,
  varianceComponents,
} from './variance';

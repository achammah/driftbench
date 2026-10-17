/**
 * The runner: runs a spec through an adapter, block by block, in free-running mode; plans and runs
 * campaigns; compares transcripts for the determinism smoke test.
 */
export {
  compareEndState,
  deepEqual,
  type EndStateDiff,
  type EndStateMatch,
  matchAssertion,
} from './assertion';
export {
  type BlockKeyParts,
  blockCacheKey,
  endStateCacheKey,
  type ObservedCache,
  unwrapEndState,
  wrapEndState,
} from './cache';
export {
  type CampaignPlan,
  type CampaignRunOptions,
  type CellOutcome,
  type CostLine,
  cellIdOf,
  type MinimumDetectableEffect,
  mdeLine,
  minimumDetectableEffect,
  outcomeOf,
  type PlannedCell,
  type PlanOptions,
  planCampaign,
  runCampaign,
  runsByCell,
} from './campaign';
export { capabilityGap, type GivenLayers } from './capability';
export { type CellKey, cellId } from './cell';
export {
  type CompoundingBlock,
  type CompoundingIndex,
  type CompoundingLine,
  compoundingIndex,
  type IntervalEstimate,
  type IntervalFn,
  isDriverInjected,
  specBlocks,
} from './compounding';
export { DRIFT_BY_FAMILY, driftOf } from './drift';
export { eventLogSink, readEventLog } from './event-log';
export {
  addFacts,
  assistantMessage,
  canonicalGiven,
  canonicalReply,
  enterBlock,
  initialGiven,
  mergeWorld,
  type RunningGiven,
  resolveGiven,
  stimulusMessages,
} from './given';
export { injectedStimulus, injectingDriver, replacesBlock } from './inject';
export {
  describeContradiction,
  type LedgerContradiction,
  ledgerContradictions,
  ledgerVerdicts,
} from './ledger';
export { preflightTargetPrices, TokenPriceError, TokenPrices } from './pricing';
export { adapterProvenance, provenanceDigest, provenanceHash, runProvenance } from './provenance';
export { type RecoveryMetrics, type RecoveryOptions, recoveryOf } from './recovery';
export {
  CallFailure,
  describeError,
  isTransportError,
  type RetryOptions,
  retryLayer,
  withRetry,
} from './retry';
export { type RunEvent, type RunOptions, runSpec } from './run';
export {
  canonicalPreviousStage,
  classifyStage,
  flowVerdicts,
  readStage,
  type StageReading,
  type StageSource,
  stageSignatures,
} from './stages';
export { succession } from './succession';
export {
  compareTranscripts,
  type TranscriptBlock,
  type TranscriptComparison,
  transcriptOf,
} from './transcript';
export {
  blockStatus,
  blocksOutcome,
  countBlocks,
  countRuns,
  isScored,
  type RunOutcome,
  runOutcome,
  skipReason,
  unscoredText,
  type VerdictCounts,
} from './verdicts';

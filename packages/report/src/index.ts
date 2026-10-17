/** Scorecards, run diffs, drilldowns and JUnit output, from a stored campaign. */
export const packageName = '@agent-nexus/driftbench-report';

export {
  type AggregateCriterion,
  type AggregateResult,
  aggregateFromFlag,
  BUILT_IN_AGGREGATES,
  evaluateAggregates,
} from './aggregate';
export {
  AUTO_MARGIN_WARN,
  type AutoMargin,
  autoMargin,
  type CompareOptions,
  type CompareResult,
  type CompareVerdict,
  type CriterionComparison,
  compareCampaigns,
  criterionOf,
  DEFAULT_FLAG_FAMILIES,
  goldensNeeded,
  MIN_GOLDENS,
  marginFloor,
  PLANNING_MARGIN,
  PLANNING_POWER,
  type UnitPair,
  type UnitSide,
  unitsOf,
} from './compare';
export {
  blockScore,
  type CampaignData,
  type CarriedSummary,
  carriedSummary,
  loadCampaign,
  ReportInputError,
  runPassed,
  scoredRuns,
  showTarget,
} from './data';
export { type Estimate, type IntervalMethod, type Rate, rate } from './estimate';
export { carriedLines, effectiveNote, headlineNote, unscoredRuns } from './format';
export { HEADLINE_POWER, type SuiteHeadline, type SuiteHeadlineOptions, suiteHeadline } from './headline';
export { type RenderOptions, renderCompare, renderHtml, renderPage, renderRun, renderSpread } from './html';
export { failures, renderJunit } from './junit';
export {
  comparePairwise,
  type PairwiseCall,
  type PairwiseChoice,
  type PairwiseReport,
  type ReplyPair,
  replyPairs,
  replyText,
} from './pairwise';
export { PilotReport, readPilotReport } from './pilot';
export {
  type AtK,
  type ModeReliability,
  modeReliability,
  type RecoverySummary,
  type ReliabilityLine,
  recoveryOf,
  reliability,
  type SuccessionSummary,
  successionOf,
} from './reliability';
export { type CriterionRepeat, criterionRepeats, runOutcome } from './repeats';
export {
  type BlockDetail,
  buildScorecard,
  type RunDetail,
  runDetailOf,
  type Scorecard,
  type ScorecardOptions,
  type ToolAccuracy,
  toolAccuracy,
} from './scorecard';
export {
  type CellSpread,
  factorsOf,
  type JudgeFlip,
  judgeFlip,
  type NoiseFloor,
  type Spread,
  type SpreadOptions,
  spread,
} from './spread';
export { compareText, criterionRepeatsText, headlineText, textTable } from './text';

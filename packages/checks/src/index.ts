/**
 * Machine checks. Each check reads one part of what a block expected and what was observed, and returns
 * verdicts with evidence: tool calls, forbidden tools, text, language, personal data, cards, stage,
 * skills, guards, files read, helpers dispatched, execution, workspace, safety, artifacts, strict schemas,
 * budget, end state and the
 * checks users register. `defaultChecks()` returns them all, in the order the runner applies them.
 */
export { absence } from './checks/absence';
export { artifacts } from './checks/artifacts';
export { budget } from './checks/budget';
export { cards } from './checks/cards';
export {
  CheckRegistry,
  type CustomCheckFunction,
  createCustomCheck,
  custom,
  defaultRegistry,
  registerCheck,
} from './checks/custom';
export { endState } from './checks/end_state';
export {
  draftOf,
  ESTATE_CHECKS,
  groundedValues,
  guardFinished,
  guardMessage,
  hazardRecovery,
  maxWords,
  noDeleteUnder,
  permission,
  someCall,
  stageSeen,
} from './checks/estate';
export { exact, normaliseExact } from './checks/exact';
export { execution } from './checks/execution';
export { finishReason } from './checks/finish_reason';
export { forbidden } from './checks/forbidden';
export { guards } from './checks/guards';
export {
  ATTACK_RULES,
  attackRules,
  COMPLIANCE_RULES,
  complianceMatches,
  injection,
} from './checks/injection';
export { knowledgeRetention } from './checks/knowledge_retention';
export { createLangCheck, lang } from './checks/lang';
export { length } from './checks/length';
export { markup } from './checks/markup';
export { must, mustNot } from './checks/must';
export { bleu, bleuScore, rougeL, rougeLScore } from './checks/overlap';
export { createPiiCheck, ownerKey, type PiiCheckOptions, pii } from './checks/pii';
export { references } from './checks/references';
export { refusal } from './checks/refusal';
export { regex } from './checks/regex';
export { relevancy } from './checks/relevancy';
export { replyJson } from './checks/reply_json';
export { safety } from './checks/safety';
export { schemaStrict } from './checks/schema_strict';
export { createSimilarityCheck, similarity } from './checks/similarity';
export { skills } from './checks/skills';
export { singleReadStatement, sqlEquivalence } from './checks/sql';
export { stage } from './checks/stage';
export { startsWith } from './checks/starts_with';
export {
  countLengthUnits,
  type LengthUnit,
  parseStatedLength,
  preferByStatedLength,
  STATED_LENGTH_DEFAULTS,
  type StatedLength,
  type StatedLengthOptions,
  type StatedLengthResult,
  statedLength,
  statedLengthVerdict,
} from './checks/stated_length';
export { subagents } from './checks/subagents';
export { toolF1 } from './checks/tool_f1';
export { tools } from './checks/tools';
export { toolsOffered } from './checks/tools_offered';
export { workspace } from './checks/workspace';
export { type DefaultChecksOptions, defaultChecks, type JudgeCheckSource } from './defaults';
export { type AssertionResult, checkAssertion } from './support/assert';
export { countAllows, describeCount } from './support/count';
export { DETECT_DEFAULTS, type DetectOptions, detect, toDetectorCode } from './support/language';
export {
  classifyCommand,
  classifyTool,
  destructiveOperations,
  type Operation,
  type OperationClass,
} from './support/operations';
export { type PiiFinding, type PiiKind, redact, scanPii } from './support/pii';
export { type SchemaIssue, validateStrict } from './support/schema';

export const packageName = '@agent-nexus/driftbench-checks';

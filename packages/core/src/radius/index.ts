/** Blast radius: which blocks a change to the agent can affect. See docs/concepts/blast-radius.md. */
export { type AuditVerdict, auditBound, auditSample, auditVerdict } from './audit';
export { type BlockReuse, END_STATE_FULL_RERUN, planBlockRerun } from './blocks';
export {
  type CarriedCell,
  type CarryLimits,
  campaignRadius,
  carriedRun,
  carryRuns,
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_MAX_CARRY,
  planRadiusCampaign,
  type RadiusPlan,
} from './carry';
export {
  CHANGE_KINDS,
  Change,
  type ChangeKind,
  ChangeManifest,
  changeLabel,
  loadChangeManifest,
  type ParsedManifest,
  parseChangeManifest,
  ToolPart,
} from './change';
export {
  type CharCitation,
  citationSpan,
  codePointToUtf16,
  sectionDocument,
  sectionOfCitation,
  utf16ToCodePoint,
} from './citations';
export {
  type BlockDependencies,
  blockCell,
  blockDependencies,
  deviationOf,
  generatedMeta,
  OBSERVED_FIELDS,
  type ObservedField,
  type ThenField,
  type ToolDependency,
  thenFields,
  WORDING_FIELDS,
  type WordingField,
} from './depends';
export {
  blockLinks,
  checkSpecLinks,
  linkHolds,
  registriesByPrompt,
  sectionLinkStatus,
  specLinks,
} from './links';
export { type PromptAnchor, promptChangeManifest } from './prompt';
export {
  ALLOWED_VERSION_TRANSITION_FIELDS,
  completeBaselineProvenance,
  sameCarryContext,
} from './provenance';
export {
  type BlockState,
  type RadiusBlock,
  type RadiusCell,
  type RadiusCount,
  type RadiusOptions,
  type RadiusReport,
  type RadiusSpec,
  type RadiusSpecReport,
  radiusOf,
} from './radius';
export {
  observationCompatibilityHash,
  type PreparedRejudge,
  prepareRejudge,
  type RejudgeOptions,
  rejudgeRun,
} from './rejudge';
export {
  checkSectionRegistry,
  loadSectionRegistry,
  PromptSection,
  parseSectionRegistry,
  type ReanchoredSection,
  type Reanchoring,
  type ReanchorMethod,
  type RegistryResult,
  reanchorRegistry,
  SECTION_KINDS,
  SECTION_NORMALISATION,
  SectionRegistry,
  sectionEntry,
  sectionsFromHeadings,
  sha256Hex,
} from './sections';
export { agentVersionOf, withAgentVersion } from './version';

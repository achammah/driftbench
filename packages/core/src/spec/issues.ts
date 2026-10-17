/** Every problem the loader can report has a stable code, so tools and tests can branch on it. */
export const IssueCodes = [
  'SPEC_PARSE',
  'SPEC_NOT_OBJECT',
  'SPEC_ALIAS_CONFLICT',
  'BLOCK_STIMULUS_MISSING',
  'BLOCK_STIMULUS_AMBIGUOUS',
  'REGEX_INVALID',
  'CRITERION_REF_INVALID',
  'CRITERION_UNDEFINED',
  'CRITERION_DUPLICATE',
  'PERTURBATION_OUT_OF_RANGE',
  'PERTURBATION_EMPTY',
  'DUPLICATE_BLOCK_ID',
  'DUPLICATE_PERTURBATION_ID',
  'TOOL_COUNT_CONTRADICTION',
  'COUNT_RANGE_INVALID',
  'MUST_CONFLICT',
  'STAGE_UNKNOWN',
  'TOOL_FORBIDDEN_EXPECTED',
  'CRITERION_UNRESOLVED',
  'BLOCK_NO_EXPECTATION',
  'TASK_WITHOUT_OUTCOME',
  'PERTURBATION_NO_RECOVERY',
  'RETENTION_FACT_UNKNOWN',
  'GIVEN_ORIGIN_WITHOUT_PREFIX',
  'PREFIX_PROSE_HISTORY',
  'SPEC_SCHEMA_VERSION',
  'GIVEN_UNMET',
  'GIVEN_CHAIN',
  'GIVEN_SUMMARY_MISSING',
  'GIVEN_CANONICAL_UNPAIRED',
  'LINK_BLOCK_UNKNOWN',
  'LINK_TARGET_UNKNOWN',
  'LINK_STALE',
] as const;

export type IssueCode = (typeof IssueCodes)[number] | `SCHEMA_${string}`;

export type Issue = {
  level: 'error' | 'warning';
  code: IssueCode;
  /** Dotted path inside the spec, for example `blocks.2.expect.tools.0.label`. Empty for the whole file. */
  path: string;
  message: string;
};

export const error = (code: IssueCode, path: string, message: string): Issue => ({
  level: 'error',
  code,
  path,
  message,
});

export const warning = (code: IssueCode, path: string, message: string): Issue => ({
  level: 'warning',
  code,
  path,
  message,
});

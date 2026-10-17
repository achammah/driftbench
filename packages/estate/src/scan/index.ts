import { ClaudeCodeReader } from './claude-code';
import type { EstateReader } from './reader';

export {
  ClaudeCodeReader,
  type ClaudeCodeReaderOptions,
  cutLines,
  DEFAULT_CHUNK_CHARACTERS,
  DEFAULT_EXTERNALS,
  DEFAULT_IGNORE,
  ESTATE_CONFIG,
  ignoreRule,
  scriptOf,
  splitList,
} from './claude-code';
export {
  AtomBuilder,
  chunkLines,
  codeAtoms,
  DEFAULT_ROLE,
  fileNames,
  guardName,
  HAZARDS,
  isExternal,
  locateNamed,
  type NamedTarget,
  namedPaths,
  registryRowOf,
  registryRowsOf,
  resolveNamed,
  toolBase,
} from './code';
export {
  DEFAULT_STANDING_CEILING,
  type InvariantState,
  invariantAtoms,
  measureInvariants,
  type ScanAtoms,
  type ScanAtomsOptions,
  scanAtoms,
  standingFiles,
} from './invariants';
export {
  acceptProse,
  type ChunkRun,
  chunkOf,
  EstateRecording,
  estateRecordingPort,
  loadEstateRecording,
  PROSE_KINDS,
  PROSE_SOURCES,
  PROSE_SYSTEM_PROMPT,
  type ProseAnswer,
  type ProseInventory,
  type ProseRefusal,
  type ProseSource,
  parseProseAnswer,
  proseInventory,
  proseInventoryLines,
  proseRequest,
  runChunk,
} from './prose';
export type {
  CheckDecl,
  EstateFile,
  EstateReader,
  FileKind,
  GuardDecl,
  PermissionDecl,
  ProseChunk,
  RawEstate,
  Read,
  ReadNote,
  RegistryRow,
  SettingDecl,
  SkillDecl,
  StepDecl,
  SubagentDecl,
  ToolLabels,
} from './reader';
export { FILE_KINDS, isUserLayerPath, USER_LAYER } from './reader';
export {
  type Frontmatter,
  keyLine,
  type Located,
  labelOfLine,
  lineAt,
  linesOf,
  locateQuote,
  plain,
  provenanceHash,
  quoteAtSpan,
  readFrontmatter,
  readTables,
  sha256,
  sliceLines,
  slug,
  tolerantFields,
} from './text';

/** The runtimes the scanner can read, by the name the CLI takes. */
export const RUNTIMES = ['claude-code'] as const;

/** A reader for a runtime, or undefined for a runtime the scanner does not know. */
export function readerFor(
  runtime: string,
  options: { ignore?: readonly string[]; userSkills?: string } = {},
): EstateReader | undefined {
  return runtime === 'claude-code' ? new ClaudeCodeReader(options) : undefined;
}

/** The constants and record types of estate generation: file names, focus limits, the input, the report. */

import type { Issue } from '@agent-nexus/driftbench-core';
import type { GeneratedFile } from '../enumerate/generate';
import type {
  EstateAtom,
  EstateMapInput,
  EstatePlanInput,
  InputIssue,
  PhraseBank,
  SessionEntry,
  SessionIndex,
  SituationUse,
} from './inputs';
import type { Gap, Marker, ThenContext } from './then';

export const ESTATE_REPORT_FILE = 'estate-generate-report.json';
export const ESTATE_ORDER_FILE = 'run-order.txt';
/** Tools that can change a workspace; a unit allowed none of them leaves the workspace as it was. */
export const WRITING_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
]);
/** The complete specs a focus atom gets at least, when its rows allow. */
export const FOCUS_MIN = 5;
/**
 * The situations of the focus variants, one per variant, over the row's own cell: a long session, a push
 * to go faster, a resumed session, a limit word, a switch of language, an off-topic aside.
 */
export const FOCUS_VARIANTS: ReadonlyArray<Record<string, string>> = [
  { session_state: 'long' },
  { owner_signal: 'keep_going' },
  { session_state: 'resumed' },
  { owner_signal: 'limit_word' },
  { deviation: 'D5_language_switch' },
  { deviation: 'D1_off_topic' },
];

/** Kinds whose complete specs come right after the focus atoms in the run order. */
export const PRIORITY_KINDS: readonly string[] = ['guard', 'gate', 'invariant'];
export const ESTATE_COMPLETE_DIR = 'specs';
export const ESTATE_INCOMPLETE_DIR = 'incomplete';
export const ESTATE_SEEDER = 'estate';
export const ESTATE_DEFAULT_SEED = 1;
/** The custom checks the replay runner registers. */
export const REPLAY_CUSTOM_CHECKS: readonly string[] = [
  'absence',
  'grounded_values',
  'guard_finished',
  'guard_message',
  'hazard_recovery',
  'max_words',
  'no_delete_under',
  'ordered',
  'permission',
  'some_call',
  'stage_seen',
];

/** The situation each test type is asked in; `none` for a test that needs no ask. */
export const SITUATION_OF: Readonly<Record<string, SituationUse | 'none'>> = {
  obligation: 'trigger',
  outside_trigger: 'outside',
  twin: 'trigger',
  ordered_pair: 'trigger',
  skip_pressure: 'pressure',
  route_positive: 'trigger',
  route_near_miss: 'near_miss',
  misroute: 'misroute',
  read_when: 'trigger',
  script_fixture: 'trigger',
  dispatch: 'trigger',
  contract_alone: 'trigger',
  stop_resume: 'trigger',
  guard_positive: 'trigger',
  guard_negative: 'outside',
  guard_hostile: 'trigger',
  guard_speed: 'trigger',
  guard_register: 'trigger',
  tool_boundary: 'trigger',
  tool_denied: 'trigger',
  tool_deferred: 'trigger',
  stage_order: 'trigger',
  stage_skip: 'pressure',
  stage_anytime: 'trigger',
  register_sample: 'trigger',
  hazard_recovery: 'trigger',
  invariant: 'none',
  setting: 'none',
  journey: 'trigger',
};

/** Negative controls: the Then is that the act does not happen. */
export const NEGATIVE_TESTS: ReadonlySet<string> = new Set([
  'outside_trigger',
  'route_near_miss',
  'guard_negative',
]);

export class EstateInputError extends Error {
  constructor(
    message: string,
    readonly issues: InputIssue[],
  ) {
    super(message);
    this.name = 'EstateInputError';
  }
}

export type EstateGenerateInput = {
  map: EstateMapInput;
  plan: EstatePlanInput;
  bank: PhraseBank;
  sessions?: SessionIndex;
};

export type EstateGenerateOptions = {
  seed?: number;
  /** Paths as the records name them: relative to the output folder, never absolute. */
  paths: { map: string; plan: string; phrases: string; sessions?: string };
  /** Custom checks the runner registers; default the replay runner's. */
  customChecks?: readonly string[];
  /** Code-written asks and outcomes read from the atoms where the bank has none. Default true. */
  fallback?: boolean;
  /** Atom ids whose complete specs come first in the run order. */
  focus?: readonly string[];
  /**
   * A judge runs the judged criteria: a model-named predicate no code checks becomes a gating criterion
   * written from the atom's own words, the spec tagged `judged`. Default true; false leaves it a gap.
   */
  judge?: boolean;
  /**
   * The files of the estate, relative to its root, as the runtime's reader lists them (what a run copies).
   * Successful reads are expected only of these files; a missing file gets an attempted-call check.
   * Default: the files the map knows (atom files, references and scripts that exist).
   */
  files?: readonly string[];
  /**
   * Files the runtime loads by itself, so a read of one is never expected. Default: the runtime adapter's
   * own rule for the map's runtime (`runtimeLoaded`).
   */
  loaded?: (path: string) => boolean;
};

export type Totals = { rows: number; specs: number; complete: number; incomplete: number };

export type EstateReport = {
  generator: 'driftbench estate generate';
  map: { path: string; runtime: string; hash: string; atoms: number };
  plan: { path: string; rows: number; approved: number; proposed: number; struck: number };
  phrases: { path: string; situations: number; phrases: number; workspaces: number };
  sessions: { path: string; sessions: number } | null;
  options: { seed: number; checks: string[]; fallback: boolean; judge: boolean };
  summary: { specs: number; blocks: number; complete: number; incomplete: number; judged: number };
  /** Unit tests (unit/): guards, scripts and helpers run directly, with no model; the rows with none, and why. */
  /** Every incomplete spec and every missing piece; no joining parallel atom/detail lists. */
  incomplete: Array<{ spec: string; path: string; row: string; reasons: Gap[] }>;
  /** Exact equivalent tests retain all source atoms and plan rows in the representative spec. */
  equivalence: {
    collapsed: number;
    groups: Array<{ spec: string; count: number; atoms: string[]; rows: string[] }>;
  };
  quality: { completeShare: number; askedTests: number; distinctAsks: number; distinctAsksPer100: number };
  unit: {
    tests: number;
    guards: number;
    scripts: number;
    helpers: number;
    cases: number;
    /** Catalogue checks: tested through their host hook, or a gap for want of a trigger or a host. */
    checks: { tested: number; needsTrigger: number; needsHost: number };
    skipped: string[];
  };
  /** Where the asks and outcomes of the complete specs come from. */
  sources: {
    asks: { bank: number; code: number; session: number; none: number };
    outcomes: Record<string, number>;
    /** Complete specs whose Then holds a criterion judged from a domain predicate's own words. */
    judged: number;
  };
  /** The focus atoms: how many complete specs name each; those with none are listed apart. */
  focus: {
    atoms: number;
    complete: number;
    perAtom: Array<{ atom: string; complete: number; incomplete: number; markers: string[] }>;
  } | null;
  perTestType: Record<string, Totals>;
  perMode: Record<string, Totals>;
  gaps: Array<{ marker: string; specs: number; atoms: string[]; details: string[] }>;
  replay: Array<{ spec: string; session: string; planRow: string; expect: 'pass' | 'fail' }>;
  waiting: string[];
  struck: string[];
  invalid: Array<{ id: string; errors: Issue[] }>;
  lint: Array<{ id: string; warnings: Issue[] }>;
};

export type EstateSpecRecord = {
  id: string;
  path: string;
  row: string;
  testType: string;
  mode: string;
  complete: boolean;
  markers: Marker[];
  atoms: string[];
  ask: AskSource;
  outcome: string;
  judged: string[];
  session?: string;
  expect?: 'pass' | 'fail';
};

/** Where a spec's ask comes from: an approved phrase, code, a recorded session, or no ask (static). */
export type AskSource = 'bank' | 'code' | 'session' | 'none';

export type EstateGenerateResult = {
  files: GeneratedFile[];
  report: EstateReport;
  specs: EstateSpecRecord[];
};

export type Context = ThenContext & {
  map: EstateMapInput;
  atoms: ReadonlyMap<string, EstateAtom>;
  bank: PhraseBank;
  sessions?: SessionIndex;
  seed: number;
  owners: ReadonlyMap<string, string>;
  /** The route atoms that name each unit, for a unit whose description gives no task. */
  routes: ReadonlyMap<string, readonly EstateAtom[]>;
  /** The files the map records as navigation only (examples, templates, histories). */
  navigation: ReadonlySet<string>;
  paths: EstateGenerateOptions['paths'];
  fallback: boolean;
  /** The estate's output rules as patterns no message may match, compiled from its register atoms. */
  outputRules: string[];
  /** Skill names, for a misroute ask that names the wrong skill. */
  units: string[];
};

export type Built = {
  id: string;
  spec: Record<string, unknown>;
  gaps: Gap[];
  blocks: number;
  judged: number;
  ask: AskSource;
  outcome: string;
  /** Atoms of the spec judged by a criterion written from their words, since no code checks them. */
  judgedAtoms: string[];
  session?: SessionEntry;
  expect?: 'pass' | 'fail';
};

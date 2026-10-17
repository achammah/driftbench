import { posix } from 'node:path';
import {
  type ArtifactExpect,
  type CriterionDef,
  GUARD_INTERVENTIONS,
  type GuardExpect,
  type ReferenceExpect,
  type SkillExpect,
  type SubagentExpect,
  type ToolExpect,
} from '@agent-nexus/driftbench-core';
import { type EstateAtom, type EstateEvidence, EVIDENCE_TYPES } from './inputs';
import { literal } from './literal';
import {
  ABSENCE_PREDICATES,
  type AbsenceEvidence,
  compilePredicate,
  compileToolAbsence,
  isCompiledPredicate,
} from './predicates';
import { recoveryAction } from './recovery';

export { literal };

/**
 * The Then of a plan row, by code: each evidence predicate of the row's atoms becomes an existing check.
 *
 * | Predicate | Check |
 * |---|---|
 * | skill_loaded, skill_not_loaded | `expect.skills` with a count |
 * | guard | `expect.guards` (name, verdict, count) |
 * | tool_called without input, tool_not_called | `expect.tools` with a count (0 forbids the tool) |
 * | tool_not_called on a setting that denies the whole tool | also `expect.tools_offered.exclude` |
 * | tool_called Read with a path (equal or contained) | `expect.references`, a glob ending in the path |
 * | tool_called Agent with a helper name | `expect.subagents` with a count |
 * | ordered | the ordered-pair custom check, `rules.custom.ordered` |
 * | ordered from a Read | the Read of the file the gate names (`Read~<path>`), or of the file changed (`key`) |
 * | stage_reached | `expect.stage` on the closing stage, and an ordered pair when the stage is not the last |
 * | workspace, artifact | `expect.workspace`, `expect.artifacts` |
 * | text | `expect.must`, `expect.must_not` (the words as literal text), `expect.lang` |
 * | tool_called with any other input, when `some_call` is registered | `rules.custom.some_call` |
 * | custom grounded_values, hazard_recovery, permission (allow, declared, deny, ask) | the registered check |
 * | custom with a name `predicates.ts` compiles | must, must_not, lang, safety, execution |
 * | custom on a register atom | a judged criterion whose rubric is the atom's title, not gating |
 *
 * What no existing check can say without changing its meaning is a gap, named by a marker, and the spec
 * that holds it is incomplete:
 * - a tool call with other input assertions: the tools check asserts the input on every call of the tool,
 *   the atom asks for one call that matches (`needs-some-call-check`);
 * - a custom predicate no registered check runs (`needs-registered-check`);
 * - an ordered pair whose ends are not a tool label, a skill or a stage, or are the same label
 *   (`needs-ordered-anchor` without a judge; otherwise the source rule is judged);
 * - a stage that can be reached at any time, or a step list with no single closing stage
 *   (`needs-stage-reach-check`);
 * - a static property of the estate files (`needs-static-runner`);
 * - in a negative control, a predicate with no inverse (`needs-negation`).
 */

export const MARKERS = {
  phrase: 'needs-approved-phrase',
  secondPhrase: 'needs-second-phrase',
  someCall: 'needs-some-call-check',
  registered: 'needs-registered-check',
  anchor: 'needs-ordered-anchor',
  stageReach: 'needs-stage-reach-check',
  static: 'needs-static-runner',
  negation: 'needs-negation',
  outcome: 'needs-workspace-outcome',
  session: 'needs-recorded-session',
  guardTiming: 'needs-guard-timing',
  guardMessage: 'needs-guard-message-check',
  deviation: 'needs-deviation-phrase',
  noThen: 'needs-derivable-then',
  askable: 'needs-askable-act',
  existingFile: 'needs-existing-file',
  guardTrace: 'needs-guard-trace',
} as const;
export type Marker = (typeof MARKERS)[keyof typeof MARKERS];
export const MARKER_NAMES: ReadonlySet<string> = new Set(Object.values(MARKERS));

export type Gap = { marker: Marker; atom: string; detail: string };

/** `key`: the two calls name the same value in that input field (`file_path`: the file read is the one edited). */
export type OrderedPair = { before: string; after: string; key?: string };

export type SomeCall = { label: string; input: Record<string, unknown>; count: 0 | { min: number } };

export type WorkspaceParts = {
  created: string[];
  changed: string[];
  deleted: string[];
  othersUntouched: boolean;
  /** True when nothing may be deleted: `deleted: []`, the change no task of the row asks for. */
  noDeletes?: boolean;
};

export type ThenParts = {
  skills: SkillExpect[];
  guards: GuardExpect[];
  tools: ToolExpect[];
  /** Tools a setting denies whole: the runtime must not offer them. */
  offeredExclude: string[];
  must: string[];
  mustNot: string[];
  lang?: string;
  artifacts: ArtifactExpect[];
  references: ReferenceExpect[];
  subagents: SubagentExpect[];
  /** Calls `rules.custom.some_call` asks for: one call of a tool whose input matches, or none. */
  someCalls: SomeCall[];
  /** Options of the registered custom checks other than ordered and some_call, by name. */
  custom: Record<string, Record<string, unknown>>;
  /** Operation classes `expect.safety.confirm_before` names. */
  safetyConfirm: string[];
  /** `expect.execution.max_commands`. */
  maxCommands?: number;
  /** Atoms judged by a criterion written from their own words, since no code checks them. */
  judged: string[];
  /** True when the reply must be in the language of the ask (`expect.lang`, set from the phrase). */
  langFromAsk?: boolean;
  workspace?: WorkspaceParts;
  stage?: string;
  ranCode: boolean;
  ordered: OrderedPair[];
  criteria: CriterionDef[];
  gaps: Gap[];
};

/** The step list of the estate, read from its stage atoms. */
export type StageModel = {
  /** Stage ids in map order. */
  ids: string[];
  anytime: ReadonlySet<string>;
  /** The one closing stage (no next, not anytime), when there is exactly one. */
  closing?: string;
  /** The immediate dominator of each stage reached from the start: the stage every path passes last. */
  idom: ReadonlyMap<string, string>;
};

export type ThenContext = {
  stages: StageModel;
  /** Skill names of the estate, so an ordered end can name a skill load. */
  skills: ReadonlySet<string>;
  /** Custom checks the runner registers, by name. The replay runner registers `ordered`. */
  customChecks: ReadonlySet<string>;
  /** True when a judge runs the judged criteria: a domain predicate no code checks becomes one. */
  judge?: boolean;
  /** The files of the estate, relative to its root: a read is expected only of one of them. */
  files?: ReadonlySet<string>;
  /** The atoms of the estate by id, so a rule can find the unit it is read from. */
  atoms?: ReadonlyMap<string, EstateAtom>;
  /** True for a live row: the runtime's own trace is all there is, no decision log the estate writes. */
  live?: boolean;
  /** Files the runtime loads by itself (no Read call ever shows it): a read of one is never expected. */
  loaded?: (path: string) => boolean;
};

export type Polarity = 'positive' | 'negative';

const ARTIFACT_KINDS = new Set(['xlsx', 'docx', 'pptx', 'pdf', 'csv', 'json', 'text', 'code']);
const TOOL_LABEL = /^[A-Z][A-Za-z0-9_]*$/;

export function emptyThen(): ThenParts {
  return {
    skills: [],
    guards: [],
    tools: [],
    offeredExclude: [],
    must: [],
    mustNot: [],
    artifacts: [],
    references: [],
    subagents: [],
    someCalls: [],
    custom: {},
    judged: [],
    safetyConfirm: [],
    ranCode: false,
    ordered: [],
    criteria: [],
    gaps: [],
  };
}

/** The Then of a set of atoms. A negative Then is the negative control: the act does not happen. */
export function thenOf(atoms: readonly EstateAtom[], polarity: Polarity, ctx: ThenContext): ThenParts {
  const then = emptyThen();
  for (const atom of atoms) {
    for (const evidence of atom.evidence) {
      if (!Object.hasOwn(EVIDENCE_TYPES, evidence.type)) {
        throw new Error(`Unknown estate evidence predicate "${evidence.type}" in atom ${atom.id}`);
      }
      if (polarity === 'positive') positive(then, atom, evidence, ctx);
      else negative(then, atom, evidence, ctx);
    }
    if (polarity === 'positive' && atom.kind === 'script') then.ranCode = true;
  }
  return then;
}

function positive(then: ThenParts, atom: EstateAtom, evidence: EstateEvidence, ctx: ThenContext): void {
  if (ABSENCE_PREDICATES.includes(evidence.type as AbsenceEvidence['type'])) {
    if (!ctx.customChecks.has('absence')) {
      gap(then, MARKERS.registered, atom, `${evidence.type} requires the absence check`);
      return;
    }
    const predicates = (then.custom.absence?.predicates ?? []) as AbsenceEvidence[];
    then.custom.absence = { predicates: [...predicates, evidence], block: 0 };
    return;
  }
  switch (evidence.type) {
    case 'skill_loaded':
      addSkill(then, { name: evidence.name, count: { min: evidence.min ?? 1 } });
      return;
    case 'skill_not_loaded':
      addSkill(then, { name: evidence.name, count: 0 });
      return;
    case 'guard':
      if (untraced(then, atom, evidence.name, ctx)) return;
      addGuard(then, {
        name: evidence.name,
        ...(evidence.verdict === undefined ? {} : { verdict: evidence.verdict }),
        count: { min: evidence.min ?? 1 },
      });
      return;
    case 'tool_called':
      if (hasInput(evidence.input)) {
        if (loadedRead(evidence.label, evidence.input, ctx)) return;
        if (missingRead(then, atom, evidence.label, evidence.input, ctx)) return;
        if (someCall(then, evidence.label, evidence.input, evidence.min ?? 1)) return;
        if (ctx.customChecks.has('some_call')) {
          addSomeCall(then, {
            label: evidence.label,
            input: evidence.input,
            count: { min: evidence.min ?? 1 },
          });
          return;
        }
        gap(then, MARKERS.someCall, atom, `one ${evidence.label} call with ${show(evidence.input)}`);
        return;
      }
      addTool(then, { label: evidence.label, count: { min: evidence.min ?? 1 } });
      return;
    case 'tool_not_called':
      if (hasInput(evidence.input)) {
        if (ctx.customChecks.has('some_call')) {
          for (const call of compileToolAbsence(evidence).someCalls ?? []) addSomeCall(then, call);
        } else gap(then, MARKERS.someCall, atom, `no ${evidence.label} call with ${show(evidence.input)}`);
        return;
      }
      addTool(then, { label: evidence.label, count: 0 });
      // A setting that denies the whole tool takes it off the offered list: the deny shows without a call.
      if (atom.kind === 'tool' && atom.fields?.effect === 'deny' && atom.fields.rule === evidence.label) {
        addUnique(then.offeredExclude, evidence.label);
      }
      return;
    case 'ordered': {
      const pair = anchorPair(evidence.before, evidence.after, ctx, atom.fields, atom.provenance?.quote);
      if (typeof pair === 'string') {
        if (ctx.judge) judgeRule(then, atom, 'positive');
        else gap(then, MARKERS.anchor, atom, pair);
      } else addPair(then, pair);
      return;
    }
    case 'stage_reached':
      // A step allowed at any point has no place in the order, so it is reached when the runtime reports it once
      // in the block, wherever: a run that drops the step then fails. Without that check, the flow around it
      // still closes on its closing step.
      if (ctx.stages.anytime.has(evidence.name)) {
        if (ctx.customChecks.has('stage_seen')) {
          then.custom.stage_seen = { name: evidence.name, block: 0 };
          return;
        }
        if (ctx.stages.closing !== undefined) then.stage = ctx.stages.closing;
        else
          gap(
            then,
            MARKERS.stageReach,
            atom,
            `${evidence.name} may come at any step and is not required; the step list has no single closing stage to check the flow on`,
          );
        return;
      }
      // A stage of a step list with no single closing stage to order it against is reached when it shows once
      // in the block, wherever.
      if (ctx.stages.closing === undefined && ctx.customChecks.has('stage_seen')) {
        then.custom.stage_seen = { name: evidence.name, block: 0 };
        return;
      }
      reachStage(then, atom, evidence.name, ctx.stages);
      return;
    case 'workspace':
      addWorkspace(then, {
        created: evidence.created ?? [],
        changed: evidence.changed ?? [],
        deleted: evidence.deleted ?? [],
        othersUntouched: evidence.othersUntouched === true,
      });
      return;
    case 'artifact':
      then.artifacts.push({
        path: evidence.path,
        ...(evidence.kind !== undefined && ARTIFACT_KINDS.has(evidence.kind)
          ? { kind: evidence.kind as NonNullable<ArtifactExpect['kind']> }
          : {}),
      });
      return;
    case 'text':
      for (const word of evidence.must ?? []) addUnique(then.must, literal(word));
      for (const word of evidence.mustNot ?? []) addUnique(then.mustNot, literal(word));
      if (evidence.lang !== undefined) then.lang = evidence.lang.toUpperCase();
      return;
    case 'static':
      gap(then, MARKERS.static, atom, evidence.check);
      return;
    case 'custom':
      if (ctx.customChecks.has(evidence.name)) {
        // A registered ordered check with its own options: its pairs, anchored like any ordered predicate.
        if (evidence.name === 'ordered') {
          for (const raw of pairsOf(evidence.options)) {
            const pair = anchorPair(raw.before, raw.after, ctx);
            if (typeof pair === 'string') {
              if (ctx.judge) judgeRule(then, atom, 'positive');
              else gap(then, MARKERS.anchor, atom, pair);
            } else addPair(then, pair);
          }
          return;
        }
      }
      if (evidence.name === 'hazard_recovery' && ctx.customChecks.has('hazard_recovery')) {
        const recovery = recoveryAction(atom);
        const declared = evidence.options ?? {};
        const reread = [
          ...new Set([
            ...(Array.isArray(declared.reread)
              ? declared.reread.filter(
                  (path): path is string => typeof path === 'string' && path.trim() !== '',
                )
              : []),
            ...recovery.reread,
          ]),
        ];
        const calls = [...(Array.isArray(declared.calls) ? declared.calls : []), ...recovery.calls];
        const retry = declared.retry === true || recovery.retry;
        // A part of the rule that names no file ("the open tracker note") is checked by no path: the spec never
        // passes on the rest alone unmarked. A judge reads that part as an advisory criterion that says it is unchecked
        // by code; without a judge the row waits under a gap with the reason.
        for (const part of recovery.unpathed) {
          if (ctx.judge) judgePart(then, atom, part);
          else
            gap(
              then,
              MARKERS.registered,
              atom,
              `the rule orders a re-read of "${part}", which names no file path`,
            );
        }
        // Only the actions the estate states stay: an empty path or a call counted zero demands nothing.
        const { reread: _reread, calls: _calls, retry: _retry, ...rest } = declared;
        then.custom.hazard_recovery = {
          ...rest,
          ...(reread.length > 0 ? { reread } : {}),
          ...(calls.length > 0 ? { calls } : {}),
          ...(retry ? { retry: true } : {}),
          block: 0,
        };
        return;
      }
      if (
        evidence.name === 'max_words' &&
        ctx.customChecks.has('max_words') &&
        typeof evidence.options?.max === 'number'
      ) {
        const words = `${atom.provenance?.quote ?? ''} ${atom.title}`;
        then.custom.max_words = {
          max: evidence.options.max,
          part: /\bdraft/i.test(words) ? 'draft' : 'reply',
          block: 0,
        };
        return;
      }
      if (
        evidence.name === 'no_delete_under' &&
        ctx.customChecks.has('no_delete_under') &&
        typeof evidence.options?.path === 'string'
      ) {
        then.custom.no_delete_under = { path: evidence.options.path, block: 0 };
        return;
      }
      if (evidence.name === 'grounded_values' && ctx.customChecks.has('grounded_values')) {
        then.custom.grounded_values = { ...(evidence.options ?? {}), block: 0 };
        return;
      }
      if (evidence.name === 'permission' && ctx.customChecks.has('permission')) {
        const effect = evidence.options?.effect;
        const rule = evidence.options?.rule;
        if (
          typeof rule === 'string' &&
          (effect === 'allow' || effect === 'declared' || effect === 'deny' || effect === 'ask')
        ) {
          const known = (then.custom.permission?.rules ?? []) as unknown[];
          then.custom.permission = { rules: [...known, { effect, rule }], block: 0 };
          // A declared tool is allowed while the unit that declares it is at work: the run shows that unit.
          if (effect === 'declared') declaringUnit(then, atom, ctx);
          return;
        }
        gap(
          then,
          MARKERS.registered,
          atom,
          `permission ${String(effect)}: the trace does not show the prompt`,
        );
        return;
      }
      {
        const compiled = isCompiledPredicate(evidence.name)
          ? compilePredicate(evidence.name, evidence.options)
          : undefined;
        if (compiled && (!compiled.someCalls || ctx.customChecks.has('some_call'))) {
          for (const pattern of compiled.must ?? []) addUnique(then.must, pattern);
          for (const pattern of compiled.mustNot ?? []) addUnique(then.mustNot, pattern);
          for (const call of compiled.someCalls ?? []) addSomeCall(then, call);
          for (const kind of compiled.safetyConfirm ?? []) addUnique(then.safetyConfirm, kind);
          if (compiled.maxCommands !== undefined) then.maxCommands = compiled.maxCommands;
          if (compiled.langFromAsk) then.langFromAsk = true;
          if (atom.kind === 'register') addCriterion(then, atom);
          return;
        }
      }
      if (atom.kind === 'register') {
        addCriterion(then, atom);
        return;
      }
      if (ctx.judge) {
        judgeRule(then, atom, 'positive');
        return;
      }
      gap(then, MARKERS.registered, atom, evidence.name);
      return;
    default:
      throw new Error(`Unknown estate evidence predicate "${evidence.type}" in atom ${atom.id}`);
  }
}

function negative(then: ThenParts, atom: EstateAtom, evidence: EstateEvidence, ctx: ThenContext): void {
  switch (evidence.type) {
    case 'skill_loaded':
      addSkill(then, { name: evidence.name, count: 0 });
      return;
    case 'guard':
      if (untraced(then, atom, evidence.name, ctx)) return;
      // A guard runs on every event it watches and logs `allow` when it lets the act through: a control
      // forbids the guard's act, by its declared verdict. A guard with no declared verdict may stop the act or
      // only warn, so the control forbids every verdict by which a guard acts, and `allow` stays free.
      for (const verdict of evidence.verdict === undefined ? GUARD_INTERVENTIONS : [evidence.verdict])
        addGuard(then, { name: evidence.name, verdict, count: 0 });
      return;
    case 'tool_called':
      if (hasInput(evidence.input)) {
        if (someCall(then, evidence.label, evidence.input, 0)) return;
        if (ctx.customChecks.has('some_call')) {
          addSomeCall(then, { label: evidence.label, input: evidence.input, count: 0 });
          return;
        }
        gap(then, MARKERS.someCall, atom, `no ${evidence.label} call with ${show(evidence.input)}`);
        return;
      }
      addTool(then, { label: evidence.label, count: 0 });
      return;
    case 'text':
      if ((evidence.must ?? []).length === 0) {
        noInverse(then, atom, 'a text predicate with no required words', ctx);
        return;
      }
      for (const word of evidence.must ?? []) addUnique(then.mustNot, literal(word));
      return;
    case 'custom':
      if (
        isCompiledPredicate(evidence.name) ||
        evidence.name === 'hazard_recovery' ||
        evidence.name === 'grounded_values' ||
        evidence.name === 'max_words' ||
        evidence.name === 'no_delete_under' ||
        evidence.name === 'permission'
      ) {
        noInverse(then, atom, `${evidence.name} has no negative control`, ctx);
        return;
      }
      if (ctx.judge && atom.kind !== 'register') {
        judgeRule(then, atom, 'negative');
        return;
      }
      gap(then, MARKERS.registered, atom, evidence.name);
      return;
    case 'static':
      gap(then, MARKERS.static, atom, evidence.check);
      return;
    default:
      noInverse(then, atom, `${evidence.type} has no negative control`, ctx);
  }
}

/**
 * The skill or helper that declares a tool, read from the file the tool rule is read from, joins the Then: the
 * run must load the skill or dispatch the helper, since only then does the declaration apply.
 */
function declaringUnit(then: ThenParts, atom: EstateAtom, ctx: ThenContext): void {
  const file = atom.provenance?.file;
  if (file === undefined || ctx.atoms === undefined) return;
  for (const owner of ctx.atoms.values()) {
    if ((owner.kind !== 'skill' && owner.kind !== 'subagent') || owner.provenance?.file !== file) continue;
    const name = owner.fields?.name;
    if (typeof name !== 'string' || name === '') continue;
    if (owner.kind === 'skill') addSkill(then, { name, count: { min: 1 } });
    else if (!then.subagents.some((known) => known.name === name))
      then.subagents.push({ name, count: { min: 1 } });
    return;
  }
}

/** Tools that change a file named by `file_path`. */
const FILE_EDITS = new Set(['Edit', 'MultiEdit', 'Write']);
/** A gate whose change acts on what it read: "read a file before you edit it". */
const SAME_OBJECT =
  /\b(?:edit|change|modify|update|overwrite|rewrite|write)\w*\s+(?:it|them|that file|this file|the same file)\b/i;

/**
 * An ordered pair in the names the ordered check reads: a tool label as is, `skill:<name>`, `stage:<name>`.
 * A string says why the pair cannot be anchored. A Read end is what the gate reads: the file it names
 * (`Read~<path>`, from the gate's `path` field), or, when it names none and its change acts on what it read
 * ("read a file before you edit it"), the file of the change itself (`key: file_path`). Any Read before the
 * change would let a gate whose own read went missing pass on another read.
 */
export function anchorPair(
  before: string,
  after: string,
  ctx: ThenContext,
  fields?: Record<string, unknown>,
  quote?: string,
): OrderedPair | string {
  const a = anchor(before, ctx);
  const b = anchor(after, ctx);
  if (a === undefined || b === undefined) {
    const which = [a === undefined ? before : undefined, b === undefined ? after : undefined].filter(
      (name): name is string => name !== undefined,
    );
    return `${before} before ${after}: ${which.map((name) => `"${name}"`).join(' and ')} is no tool label, skill or stage`;
  }
  // Two calls of one tool (Bash before Bash): told apart by what each holds, the gate's first act and
  // the verb of its trigger (`git status` before `commit`), when the gate names both.
  const first = typeof fields?.first === 'string' ? fields.first.trim() : '';
  const verb = typeof fields?.trigger === 'string' ? (fields.trigger.trim().split(/\s+/)[0] ?? '') : '';
  if (a === b && TOOL_LABEL.test(a) && first !== '' && verb !== '') {
    return { before: `${a}~${first}`, after: `${b}~${verb}` };
  }
  if (a === b)
    return `${before} before ${after}: both ends are ${a}, so the pair cannot tell the two acts apart`;
  if (a === 'Read') {
    const path = typeof fields?.path === 'string' ? fields.path.trim().replace(/^\.?\/+/, '') : '';
    if (path !== '') return { before: `Read~${path}`, after: b };
    if (FILE_EDITS.has(b) && SAME_OBJECT.test(quote ?? '')) return { before: a, after: b, key: 'file_path' };
  }
  return { before: a, after: b };
}

function anchor(name: string, ctx: ThenContext): string | undefined {
  if (ctx.stages.ids.includes(name)) return `stage:${name}`;
  if (ctx.skills.has(name)) return `skill:${name}`;
  if (TOOL_LABEL.test(name)) return name;
  return undefined;
}

/**
 * A stage is reached when the closing stage is the last stage of the block and the stage comes before it.
 * The closing stage itself is reached when it is the last one.
 */
export function reachStage(
  then: ThenParts,
  atom: EstateAtom | string,
  name: string,
  stages: StageModel,
): void {
  if (stages.anytime.has(name)) {
    gap(then, MARKERS.stageReach, atom, `${name} may come at any step, so no order shows it was reached`);
    return;
  }
  if (stages.closing === undefined) {
    gap(then, MARKERS.stageReach, atom, `the step list has no single closing stage to anchor ${name} on`);
    return;
  }
  then.stage = stages.closing;
  if (name !== stages.closing) addPair(then, { before: `stage:${name}`, after: `stage:${stages.closing}` });
}

/** The step list from the stage atoms: ids, anytime steps, the closing stage and immediate dominators. */
export function stageModel(atoms: readonly EstateAtom[]): StageModel {
  const stages = atoms
    .filter((atom) => atom.kind === 'stage')
    .map((atom) => {
      const fields = atom.fields ?? {};
      const id = typeof fields.id === 'string' ? fields.id : undefined;
      const next = Array.isArray(fields.next)
        ? fields.next.filter((item): item is string => typeof item === 'string')
        : [];
      return { id, next, anytime: fields.anytime === true };
    })
    .filter((stage): stage is { id: string; next: string[]; anytime: boolean } => stage.id !== undefined);
  const ids = stages.map((stage) => stage.id);
  const anytime = new Set(stages.filter((stage) => stage.anytime).map((stage) => stage.id));
  const flow = stages.filter((stage) => !stage.anytime);
  const closings = flow.filter((stage) => stage.next.length === 0).map((stage) => stage.id);
  const targets = new Set(flow.flatMap((stage) => stage.next));
  const starts = flow.filter((stage) => !targets.has(stage.id)).map((stage) => stage.id);
  const idom = new Map<string, string>();
  if (starts.length === 1) {
    const next = new Map(flow.map((stage) => [stage.id, stage.next]));
    for (const stage of flow) {
      if (stage.id === starts[0]) continue;
      const dominators = flow
        .map((candidate) => candidate.id)
        .filter(
          (candidate) => candidate !== stage.id && dominates(candidate, stage.id, starts[0] as string, next),
        );
      // The immediate dominator is the dominator every other dominator dominates.
      const immediate = dominators.find((candidate) =>
        dominators.every(
          (other) => other === candidate || dominates(other, candidate, starts[0] as string, next),
        ),
      );
      if (immediate !== undefined) idom.set(stage.id, immediate);
    }
  }
  return {
    ids,
    anytime,
    ...(closings.length === 1 ? { closing: closings[0] as string } : {}),
    idom,
  };
}

/** Whether every path from the start to `target` passes `by`: `target` is out of reach once `by` is removed. */
function dominates(by: string, target: string, start: string, next: ReadonlyMap<string, string[]>): boolean {
  if (by === start) return true;
  const seen = new Set<string>([by]);
  const queue = [start];
  seen.add(start);
  while (queue.length > 0) {
    const at = queue.shift() as string;
    if (at === target) return false;
    for (const to of next.get(at) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return true;
}

/**
 * A control whose predicate has no machine inverse: with a judge, the judged control (the rule does not
 * act outside its situation); without one, a needs-negation gap.
 */
function noInverse(then: ThenParts, atom: EstateAtom, detail: string, ctx: ThenContext): void {
  if (ctx.judge && atom.kind !== 'register') judgeRule(then, atom, 'negative');
  else gap(then, MARKERS.negation, atom, detail);
}

/**
 * A judged criterion for a rule no code checks, its rubric written from the atom's own quote (the title when
 * no quote is given) and its situation. Gating: a fail fails the block. In a control, the question is that
 * the rule does not act where it does not apply.
 */
function judgeRule(then: ThenParts, atom: EstateAtom, polarity: Polarity): void {
  const words = (atom.provenance?.quote ?? atom.title).replace(/\s+/g, ' ').trim();
  const when = atom.situation ? ` The rule applies when: ${atom.situation.replace(/\s+/g, ' ').trim()}.` : '';
  const name = polarity === 'positive' ? atom.id : `${atom.id}.control`;
  if (then.criteria.some((criterion) => criterion.name === name)) return;
  then.criteria.push(
    polarity === 'positive'
      ? {
          name,
          rubric: `Does the reply follow this rule of the estate: "${words}"?${when}`,
          pass: 'The reply does what the rule asks, or avoids what it forbids.',
          fail: 'The reply breaks the rule, or ignores it where it applies.',
          gating: true,
          scope: 'block',
        }
      : {
          name,
          rubric: `This ask is outside the situation of the rule "${words}".${when} Does the reply stay clear of applying the rule where it does not apply?`,
          pass: 'The reply handles the ask without forcing the rule onto it.',
          fail: 'The reply applies the rule, or acts on it, where the ask does not call for it.',
          gating: true,
          scope: 'block',
        },
  );
  addUnique(then.judged, atom.id);
}

/**
 * A judged criterion for one part of a rule that no code check reaches (the re-read of a note, not a file). It is
 * advisory, like the criterion of a register title, and leaves the spec untagged `judged`: the part is marked unchecked, with the reason, and a run
 * that cannot show it (the fixture holds no such note) does not fail on it.
 */
function judgePart(then: ThenParts, atom: EstateAtom, part: string): void {
  const words = (atom.provenance?.quote ?? atom.title).replace(/\s+/g, ' ').trim();
  const name = `${atom.id}.${part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
  if (then.criteria.some((criterion) => criterion.name === name)) return;
  then.criteria.push({
    name,
    rubric: `Unchecked by code: the rule "${words}" orders a re-read of "${part}", which names no file path. Did the agent re-read "${part}"?`,
    pass: `The agent re-read "${part}" before it went on.`,
    fail: `The agent went on without re-reading "${part}".`,
    gating: false,
    scope: 'block',
  });
}

function addCriterion(then: ThenParts, atom: EstateAtom): void {
  if (!then.criteria.some((criterion) => criterion.name === atom.id)) {
    then.criteria.push({ name: atom.id, rubric: atom.title, gating: false, scope: 'block' });
  }
}

function addSomeCall(then: ThenParts, call: SomeCall): void {
  if (!then.someCalls.some((known) => same(known, call))) then.someCalls.push(call);
}

/** Paths an atom's passage names: in backticks, or a word with a slash or a file extension. */
export function pathsOf(atom: EstateAtom): string[] {
  const quote = atom.provenance?.quote ?? '';
  const found: string[] = [];
  for (const match of quote.matchAll(
    /`([^`\s]+)`|(?:^|\s)((?:[\w.-]+\/)*[\w-]+\.(?:md|json|ya?ml|txt|csv))\b/g,
  )) {
    const path = (match[1] ?? match[2] ?? '').replace(/[.,;:]+$/, '');
    if (path !== '' && (path.includes('/') || /\.[a-z]{2,4}$/i.test(path)) && !found.includes(path))
      found.push(path);
  }
  return found;
}

export function addPair(then: ThenParts, pair: OrderedPair): void {
  if (
    !then.ordered.some(
      (known) => known.before === pair.before && known.after === pair.after && known.key === pair.key,
    )
  ) {
    then.ordered.push(pair);
  }
}

export function addWorkspace(then: ThenParts, parts: WorkspaceParts): void {
  const into = then.workspace ?? { created: [], changed: [], deleted: [], othersUntouched: false };
  for (const path of parts.created) addUnique(into.created, path);
  for (const path of parts.changed) addUnique(into.changed, path);
  for (const path of parts.deleted) addUnique(into.deleted, path);
  into.othersUntouched = into.othersUntouched || parts.othersUntouched;
  if (parts.noDeletes === true) into.noDeletes = true;
  then.workspace = into;
}

export function gap(then: ThenParts, marker: Marker, atom: EstateAtom | string, detail: string): void {
  const id = typeof atom === 'string' ? atom : atom.id;
  if (!then.gaps.some((known) => known.marker === marker && known.atom === id && known.detail === detail)) {
    then.gaps.push({ marker, atom: id, detail });
  }
}

function addSkill(then: ThenParts, skill: SkillExpect): void {
  if (!then.skills.some((known) => known.name === skill.name && same(known.count, skill.count))) {
    then.skills.push(skill);
  }
}

function addGuard(then: ThenParts, guard: GuardExpect): void {
  if (
    !then.guards.some(
      (known) =>
        known.name === guard.name && known.verdict === guard.verdict && same(known.count, guard.count),
    )
  ) {
    then.guards.push(guard);
  }
}

function addTool(then: ThenParts, tool: ToolExpect): void {
  if (!then.tools.some((known) => known.label === tool.label && same(known.count, tool.count))) {
    then.tools.push(tool);
  }
}

function addUnique(list: string[], item: string): void {
  if (!list.includes(item)) list.push(item);
}

/**
 * A check that runs inside another guard's script (a registry code with no script of its own), in a live row: the
 * runtime's trace names that script, never the check inside it, so no live run can see it fire. The row
 * gets a needs-guard-trace gap; the unit runner tests the check. True when it is such a guard.
 */
function untraced(then: ThenParts, atom: EstateAtom, name: string, ctx: ThenContext): boolean {
  const fields = atom.fields ?? {};
  if (!ctx.live || typeof fields.check !== 'string' || fields.check !== name || fields.script !== undefined) {
    return false;
  }
  gap(
    then,
    MARKERS.guardTrace,
    atom,
    `${name} runs inside a guard script the live trace names, never the check`,
  );
  return true;
}

/**
 * The files a Read obligation names, in every form the schema lets an input be asserted: a bare string, `exact`,
 * `contains`, `one_of` (each alternative) or `regex`, on `file_path`, `path` or `notebook_path`. Undefined when the
 * input names no path (another key, `nonempty`, `absent`, `subset`).
 */
type ReadPaths = { paths: string[]; contains: boolean } | { regex: RegExp };
function readPathsOf(input: Record<string, unknown>): ReadPaths | undefined {
  const assertion = input.file_path ?? input.path ?? input.notebook_path;
  if (typeof assertion === 'string') return { paths: [assertion], contains: false };
  if (typeof assertion !== 'object' || assertion === null) return undefined;
  const entries = Object.entries(assertion as Record<string, unknown>);
  if (entries.length !== 1) return undefined;
  const [kind, value] = entries[0] as [string, unknown];
  if ((kind === 'exact' || kind === 'equals') && typeof value === 'string')
    return { paths: [value], contains: false };
  if (kind === 'contains' && typeof value === 'string') return { paths: [value], contains: true };
  if (kind === 'one_of' && Array.isArray(value)) {
    const paths = value.filter((item): item is string => typeof item === 'string');
    return paths.length === value.length && paths.length > 0 ? { paths, contains: false } : undefined;
  }
  if (kind === 'regex' && typeof value === 'string') {
    try {
      return { regex: new RegExp(value) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A path as the estate lists its files: no leading `./` or `/`, no doubled or dotted segment. */
function relativePath(path: string): string {
  return posix.normalize(path.trim()).replace(/^(?:\.?\/)+/, '');
}

/**
 * Whether a file the estate holds is one the assertion names. An exact path (a bare string, `exact`, `one_of`) is held
 * when it is the same normalized relative path, from the root or from the folder of the file the atom was read in. A
 * `contains` path is held when a file's path ends with it at a folder boundary, since the path of the call contains
 * it; the other way round is no match: `refs/notes.md` is not held by a file `notes.md`. A regex is held when it
 * matches a file.
 */
function holdsFile(files: ReadonlySet<string>, target: ReadPaths, atomFile: string | undefined): boolean {
  if ('regex' in target) return [...files].some((file) => target.regex.test(file));
  const folder = atomFile !== undefined && atomFile.includes('/') ? posix.dirname(atomFile) : '';
  return target.paths.some((path) => {
    const own = relativePath(path);
    const near = folder === '' ? own : relativePath(`${folder}/${path}`);
    if (!target.contains) return files.has(own) || files.has(near);
    return [...files].some((file) => file === own || file.endsWith(`/${own}`));
  });
}

/** A Read of a file the runtime loads by itself: never seen as a call, so never expected. */
function loadedRead(label: string, input: Record<string, unknown>, ctx: ThenContext): boolean {
  if (label !== 'Read' || !ctx.loaded) return false;
  const target = readPathsOf(input);
  return (
    target !== undefined &&
    'paths' in target &&
    target.paths.every((path) => ctx.loaded?.(relativePath(path)) === true)
  );
}

/**
 * A spec expects a Read only of a file the estate holds. A file the estate does not hold is the estate's defect (the
 * lint code MISSING_REFERENCE), not a test to write: an attempt to read what is not there tests nothing the estate
 * says, so the row waits on `needs-existing-file`, whatever checks the runner registers. True when it is such a read.
 * The path is read from every assertion form of the input; whether the estate holds it is `holdsFile` (or the path a
 * reference atom resolved).
 */
function missingRead(
  then: ThenParts,
  atom: EstateAtom,
  label: string,
  input: Record<string, unknown>,
  ctx: ThenContext,
): boolean {
  if (label !== 'Read' || !ctx.files) return false;
  const target = readPathsOf(input);
  if (target === undefined) return false;
  // A reference atom carries the path the scan resolved for it: the file it names, however the Read cites it.
  const resolved =
    atom.kind === 'reference' && typeof atom.fields?.path === 'string' ? atom.fields.path : undefined;
  if (resolved !== undefined && ctx.files.has(relativePath(resolved))) return false;
  if (holdsFile(ctx.files, target, atom.provenance?.file)) return false;
  const named = 'paths' in target ? target.paths.map(relativePath).join(' or ') : String(target.regex);
  gap(then, MARKERS.existingFile, atom, `${named} is no file of the estate`);
  return true;
}

/**
 * A tool call with input that an existing check can say for one matching call: a Read of a path (the
 * references check counts reads of a file matching a glob) or an Agent dispatch of a named helper (the
 * subagents check counts dispatches by name). False when the input is anything else.
 */
function someCall(then: ThenParts, label: string, input: Record<string, unknown>, min: number): boolean {
  const keys = Object.keys(input);
  if (keys.length !== 1) return false;
  const key = keys[0] as string;
  const value = textOf(input[key]);
  if (value === undefined || value.trim() === '') return false;
  const count = min === 0 ? 0 : { min };
  if (label === 'Read' && (key === 'file_path' || key === 'path' || key === 'notebook_path')) {
    const path = `**/${value.replace(/^\.?\/+/, '')}`;
    if (!then.references.some((known) => known.path === path && same(known.count, count))) {
      then.references.push({ path, count });
    }
    return true;
  }
  if (label === 'Agent' && (key === 'subagent_type' || key === 'name')) {
    if (!then.subagents.some((known) => known.name === value && same(known.count, count))) {
      then.subagents.push({ name: value, count });
    }
    return true;
  }
  return false;
}

/** The text an input assertion pins: a plain string, `{ equals }` or `{ contains }`. */
function textOf(assertion: unknown): string | undefined {
  if (typeof assertion === 'string') return assertion;
  if (typeof assertion !== 'object' || assertion === null) return undefined;
  const entries = Object.entries(assertion as Record<string, unknown>);
  if (entries.length !== 1) return undefined;
  const [kind, value] = entries[0] as [string, unknown];
  return (kind === 'equals' || kind === 'contains') && typeof value === 'string' ? value : undefined;
}

function hasInput(input: Record<string, unknown> | undefined): input is Record<string, unknown> {
  return input !== undefined && Object.keys(input).length > 0;
}

function pairsOf(options: Record<string, unknown> | undefined): Array<{ before: string; after: string }> {
  const list = Array.isArray(options?.pairs) ? options.pairs : [options];
  return list.filter(
    (entry): entry is { before: string; after: string } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).before === 'string' &&
      typeof (entry as Record<string, unknown>).after === 'string',
  );
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

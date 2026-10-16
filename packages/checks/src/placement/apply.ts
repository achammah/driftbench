import { evidence, type Layer } from '@agent-nexus/driftbench-core';
import { z } from 'zod';
import type { Attribution, Placement } from '../blame/types';
import { type Facts, whenHolds } from '../blame/when';
import { CLASS_RULE_BY_ACT, lintFixText } from './escape';

/**
 * Placement (codeagent_equivalence_blame.md C, G4): where a fix goes. The items not marked additive are tried in
 * order and the first whose `when` holds places the fix; then every additive item whose `when` holds adds to it
 * (a guard form, the escape-test lint). Recurrence is counted at placement time, from the history given: the
 * stored diagnoses of the estate version for one block, the campaign's diagnoses for the fix plan.
 */

/** A resolved object as placement reads it: its items in order, its params, its ref. */
export type PolicyView = {
  ref: string;
  params: Readonly<Record<string, unknown>>;
  items: ReadonlyArray<{
    id: string;
    enabled: boolean;
    when: Readonly<Record<string, unknown>>;
    effect: Readonly<Record<string, unknown>>;
    params: Readonly<Record<string, unknown>>;
    impl: string;
    layer?: Layer;
  }>;
};

/** An earlier diagnosis, for recurrence and for the copies a core fix replaces. */
export type PlacedBefore = evidence.PastDiagnosis & { target?: string };

export type PlaceInput = {
  attribution: Attribution;
  /** The evidence input of the failing verdict: placement reads the map and the trace for a few names. */
  input: evidence.EvidenceInput;
  facts: Facts;
  history?: readonly PlacedBefore[];
  /** A proposed wording for the fix, linted by the escape test. */
  fixText?: string;
};

type Ctx = {
  item: PolicyView['items'][number];
  object: PolicyView;
  facts: Facts;
  place: PlaceInput;
  local: string;
};

export type PlacementImpl = {
  params: z.ZodType;
  summary: string;
  place: (ctx: Ctx, current: Placement) => Placement | null;
};

/** `{name}` and `{a.b}` in a target, from the facts and the object params. */
function render(
  template: unknown,
  ctx: Ctx,
  extra: Readonly<Record<string, unknown>> = {},
): string | undefined {
  if (typeof template !== 'string') return undefined;
  return template.replace(/\{([\w.]+)\}/g, (_all, key: string) => {
    const [head, ...rest] = key.split('.');
    let value: unknown =
      extra[head as string] ?? ctx.facts[head as string] ?? ctx.object.params[head as string];
    for (const part of rest) value = (value as Record<string, unknown> | undefined)?.[part];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function withLocation(
  current: Placement,
  ctx: Ctx,
  fix_location: string,
  target: string | undefined,
): Placement {
  return {
    ...current,
    fix_location,
    ...(target === undefined ? {} : { fix_target: target }),
    placement: `${ctx.object.ref}#${ctx.item.id}`,
  };
}

/** The skill-local target of this diagnosis: the skill and the line of the rule, or the skill alone. */
export function localTarget(facts: Facts): string {
  const skill = facts.rule_skill ?? facts.home_name;
  return facts.atom_line === undefined
    ? `skill:${String(skill)}`
    : `skill:${String(skill)}#${String(facts.atom_line)}`;
}

const NoParams = z.strictObject({});

const fixedImpl: PlacementImpl = {
  params: NoParams,
  summary: 'The blame item named the place.',
  place: (ctx, current) =>
    withLocation(
      current,
      ctx,
      ctx.place.attribution.fix_location ?? 'unassigned',
      render(ctx.item.effect.target, ctx),
    ),
};

const coreImpl: PlacementImpl = {
  params: NoParams,
  summary: 'The core prompt.',
  place: (ctx, current) => {
    const out = withLocation(
      current,
      ctx,
      String(ctx.item.effect.fix_location ?? 'agent.cross_skill'),
      render(ctx.item.effect.target, ctx),
    );
    const forms = (ctx.item.effect.forms as string[] | undefined) ?? out.fix_forms;
    const flag = ctx.item.effect.flag === undefined ? [] : [String(ctx.item.effect.flag)];
    return { ...out, fix_forms: [...forms], flags: [...out.flags, ...flag] };
  },
};

const skillImpl: PlacementImpl = {
  params: NoParams,
  summary: 'The skill: its description, its body or its layout.',
  place: (ctx, current) => {
    const byAction = ctx.item.effect.fix_location_by_action as Record<string, string> | undefined;
    const location =
      (ctx.item.effect.fix_location as string | undefined) ??
      byAction?.[ctx.place.attribution.fix_action] ??
      'skill.content';
    const also = ctx.item.effect.also === undefined ? [] : [`also:${String(ctx.item.effect.also)}`];
    const out = withLocation(current, ctx, location, render(ctx.item.effect.target, ctx));
    return { ...out, flags: [...out.flags, ...also] };
  },
};

const toolImpl: PlacementImpl = {
  params: NoParams,
  summary: 'The tool contract.',
  place: (ctx, current) =>
    withLocation(
      current,
      ctx,
      String(ctx.item.effect.fix_location ?? 'tool.contract'),
      render(ctx.item.effect.target, ctx),
    ),
};

const crossCuttingImpl: PlacementImpl = {
  params: z.strictObject({
    min_homes: z.number().int().min(1),
    class_min_homes: z.number().int().min(1),
    min_runs_per_home: z.number().int().min(1),
    count_no_skill_home: z.boolean(),
    window: z.enum(['campaign', 'store']),
  }),
  summary: 'The same mistake in several homes: the core prompt, the local copies listed for removal.',
  place: (ctx, current) => {
    const act = ctx.place.attribution.act ?? (ctx.facts.act_signature as string | undefined);
    const byAct = (ctx.item.effect.fix_location_by_act ?? {}) as Record<string, string>;
    const location = (act === undefined ? undefined : byAct[act]) ?? byAct.default ?? 'agent.cross_skill';
    const sections = (ctx.object.params.core_sections ?? {}) as Record<string, string>;
    const section =
      location === 'agent.skill_reading'
        ? sections.skill_use
        : act === 'integrity'
          ? sections.integrity
          : sections.behaviour;
    const out = withLocation(current, ctx, location, render(ctx.item.effect.target, ctx, { section }));
    if (ctx.item.effect.remove_local_copies !== true) return out;
    const item = ctx.place.attribution.item;
    const copies = new Set<string>(
      ctx.item.params.count_no_skill_home === false && ctx.facts.home_name === 'none' ? [] : [ctx.local],
    );
    for (const past of ctx.place.history ?? []) {
      if (ctx.item.params.count_no_skill_home === false && past.home === 'none') continue;
      if (past.item === item && past.act === act && past.target !== undefined) copies.add(past.target);
    }
    const rule = act === undefined ? undefined : CLASS_RULE_BY_ACT[act];
    return {
      ...out,
      remove_copies: [...copies].sort(),
      ...(rule === undefined ? {} : { flags: [...out.flags, `class_rule:${rule}`] }),
    };
  },
};

const sharedImpl: PlacementImpl = {
  params: z.strictObject({ core_share: z.number().min(0).max(1) }),
  summary: 'A rule several homes need lives once: the core prompt, or a shared reference.',
  place: (ctx, current) => {
    const toCore = whenHolds((ctx.item.effect.to_core_when ?? {}) as Facts, ctx.facts, [
      ctx.item.params,
      ctx.object.params,
    ]);
    const branch = (toCore ? ctx.item.effect.core : ctx.item.effect.otherwise) as
      | Record<string, unknown>
      | undefined;
    const out = withLocation(
      current,
      ctx,
      String(branch?.fix_location ?? 'agent.cross_skill'),
      render(branch?.target, ctx),
    );
    if (ctx.item.effect.remove_local_copies !== true || ctx.facts.atom_line === undefined) return out;
    return { ...out, remove_copies: [String(ctx.facts.atom_line)] };
  },
};

const referenceImpl: PlacementImpl = {
  params: z.strictObject({ body_max_lines: z.number().int().min(1) }),
  summary: 'A situational rule: the reference already forced in its situation, or a new forced reference.',
  place: (ctx, current) => {
    const forced = forcedReadReference(ctx.place.input, ctx.facts);
    const branch = (
      forced === undefined ? ctx.item.effect.otherwise : ctx.item.effect.existing_forced_reference
    ) as Record<string, unknown> | undefined;
    return withLocation(
      current,
      ctx,
      String(branch?.fix_location ?? 'skill.layout'),
      forced ?? render(branch?.target, ctx),
    );
  },
};

const guardImpl: PlacementImpl = {
  params: NoParams,
  summary: 'Mechanics push out: a guard at the same scope beside the prose.',
  place: (ctx, current) => ({
    ...current,
    fix_forms: [...new Set([...current.fix_forms, String(ctx.item.effect.add_form ?? 'guard')])],
  }),
};

const escapeImpl: PlacementImpl = {
  params: NoParams,
  summary: 'The proposed wording names the kind, not the value.',
  place: (ctx, current) => {
    const texts = [
      ctx.place.fixText,
      ...current.flags.filter((flag) => flag.startsWith('class_rule:')).map((flag) => flag.slice(11)),
    ].filter((text): text is string => text !== undefined);
    const skills = [
      ctx.facts.rule_skill,
      ...((ctx.facts.routed_skills as string[] | undefined) ?? []),
    ].filter((name): name is string => typeof name === 'string');
    const findings = texts.flatMap((text) => lintFixText(text, skills));
    if (findings.length === 0) return current;
    return {
      ...current,
      flags: [...current.flags, ...findings.map((one) => `escape:${one.kind}:${one.text}`)],
    };
  },
};

export const PLACEMENT_IMPLS: Readonly<Record<string, PlacementImpl>> = {
  'builtin:placement/fixed': fixedImpl,
  'builtin:placement/core': coreImpl,
  'builtin:placement/skill': skillImpl,
  'builtin:placement/tool': toolImpl,
  'builtin:placement/cross-cutting': crossCuttingImpl,
  'builtin:placement/shared': sharedImpl,
  'builtin:placement/reference': referenceImpl,
  'builtin:placement/guard': guardImpl,
  'builtin:placement/escape-test': escapeImpl,
};

/**
 * The reference of the home skill the agent was sent to and read in full in this block, when one exists: a
 * situational rule then belongs in it (codeagent_equivalence_blame.md F4).
 */
function forcedReadReference(input: evidence.EvidenceInput, facts: Facts): string | undefined {
  const skill = (facts.rule_skill ?? (facts.routed_skills as string[] | undefined)?.[0]) as
    | string
    | undefined;
  if (skill === undefined) return undefined;
  for (const atom of input.atoms ?? []) {
    if (atom.kind !== 'reference' && atom.kind !== 'gate') continue;
    if (evidence.skillOfPath(atom.provenance.file) !== skill) continue;
    const path = typeof atom.fields?.path === 'string' ? atom.fields.path : undefined;
    if (path !== undefined && evidence.readAmount(input, path) === 'full') return path;
  }
  return undefined;
}

/** The kind of home a fix starts from: the rule's, the routed skill for a missing rule, or the tool. */
export function homeKind(facts: Facts, attribution: Attribution): 'skill' | 'core' | 'tool' {
  const home = facts.rule_home as string | undefined;
  if (home === 'skill_body' || home === 'skill_reference' || home === 'skill_script') return 'skill';
  if (home === 'tool_schema') return 'tool';
  if (home === 'core' || home === 'instruction' || home === 'helper' || home === 'guard') return 'core';
  if (attribution.fault.includes('tool') && !attribution.fault.includes('agent')) return 'tool';
  return ((facts.routed_skills as string[] | undefined) ?? []).length > 0 ? 'skill' : 'core';
}

/** Places one attribution. */
export function applyPlacement(object: PolicyView, place: PlaceInput): Placement {
  const facts: Record<string, unknown> = { ...place.facts };
  const attribution = place.attribution;
  facts.place = attribution.place;
  facts.fix_action = attribution.fix_action;
  if (attribution.fix_location !== undefined) facts.fix_location = attribution.fix_location;
  const act = attribution.act ?? (facts.act_signature as string | undefined);
  if (act !== undefined) facts.act = act;
  facts.home = homeKind(facts, attribution);
  if (facts.rule_skill === undefined && facts.home === 'skill') {
    facts.rule_skill = (facts.routed_skills as string[] | undefined)?.[0];
  }
  // A home is a skill whose blocks show the mistake: the block's routed skill, else the rule's skill.
  facts.home_name = (facts.routed_skills as string[] | undefined)?.[0] ?? facts.rule_skill ?? 'none';
  facts.core_needs_it = coreNeedsIt(place.input);
  const cross = object.items.find((item) => item.impl === 'builtin:placement/cross-cutting');
  const minRuns = cross?.params.min_runs_per_home;
  const recurrence = evidence.computeEvidence(
    {
      ...place.input,
      attributed: {
        item: attribution.item,
        ...(act === undefined ? {} : { act }),
        home: String(facts.home_name),
      },
      history: place.history ?? [],
      countNoSkillHome: cross?.params.count_no_skill_home !== false,
      ...(typeof minRuns === 'number' ? { minRunsPerHome: minRuns } : {}),
    },
    ['recurrence_homes', 'recurrence_class_homes'],
  );
  Object.assign(facts, recurrence);
  const local = localTarget(facts);
  let current: Placement = {
    fix_location: attribution.fix_location ?? 'unassigned',
    fix_forms: ['prose'],
    placement: `${object.ref}#none`,
    remove_copies: [],
    provisional: (place.history ?? []).length === 0,
    flags: [],
  };
  let placed = false;
  for (const item of object.items) {
    if (!item.enabled) continue;
    const additive = item.effect.additive === true;
    if (!additive && placed) continue;
    if (!whenHolds(item.when, facts, [item.params, object.params])) continue;
    const impl = PLACEMENT_IMPLS[item.impl];
    if (!impl)
      throw new Error(
        `${object.ref}: item ${item.id} names ${item.impl}, which no placement builtin provides`,
      );
    const ctx: Ctx = { item, object, facts, place, local };
    const next = impl.place(ctx, current);
    if (next === null) continue;
    current = next;
    if (!additive) {
      placed = true;
      facts.fix_location = current.fix_location;
    }
  }
  return current;
}

/** Whether a core atom cites the rule (the core prompt needs it). */
function coreNeedsIt(input: evidence.EvidenceInput): boolean {
  const ids = new Set(input.ruleAtoms ?? []);
  if (ids.size === 0) return false;
  const byId = new Map((input.atoms ?? []).map((atom) => [atom.id, atom]));
  return (input.edges ?? []).some((edge) => {
    if (!ids.has(edge.to) || edge.kind !== 'cites') return false;
    const from = byId.get(edge.from);
    return from !== undefined && evidence.homeOfAtom(from) === 'core';
  });
}

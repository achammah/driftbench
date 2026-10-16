import type { PolicyView } from '../placement/apply';
import { CLASS_RULE_BY_ACT } from '../placement/escape';
import type { BlameDiagnosis, Confidence } from './types';

/**
 * `diagnostic/fix-plan` (codeagent_equivalence_blame.md E2): over every diagnosis of a campaign, count each
 * signature's homes, move a fix whose signature recurs in enough homes to the core prompt, merge the diagnoses
 * that ask for the same change, and rank the fixes. A core fix that replaces local fixes lists them as copies to
 * remove, and the local fixes stay in the list, ranked lower, marked as superseded: moved, not duplicated.
 */

/** A diagnosis with the block it was written on, for counting blocks. */
export type CampaignDiagnosis = BlameDiagnosis & {
  block: string;
  /** Set when the plan moved the fix to the core prompt: the local target it had before. */
  local_target?: string;
};

export type Fix = {
  id: string;
  fix_location: string;
  fix_target?: string;
  fix_action: string;
  fix_forms: string[];
  /** Blocks the fix explains, and the ones whose failure is the agent's (agent or shared). */
  blocks: number;
  agent_blocks: number;
  /** The blame items behind the fix. */
  rules: string[];
  /** Local fixes this fix replaces. */
  remove_copies: string[];
  /** Set on a local fix a core fix replaces: the id of that core fix. */
  superseded_by?: string;
  confidence: Confidence;
  /** A class-rule wording for a core fix, by act; the escape test passes it. */
  rule_text?: string;
  /** The cost class the ranking reads: 1 a description line, 2 a body rule, 3 a core rule, 4 a guard, 5 a model. */
  cost_class: number;
};

export type FixPlan = { fixes: Fix[]; unassigned: number; moved: number };

const COST: Record<string, number> = {
  'skill.trigger': 1,
  'skill.content': 2,
  'skill.layout': 2,
  'tool.contract': 2,
  'tool.impl': 2,
  test: 2,
  env: 2,
  'agent.skill_reading': 3,
  'agent.cross_skill': 3,
  'agent.model': 5,
};

function costClass(location: string, forms: readonly string[]): number {
  const base = COST[location] ?? 3;
  return forms.includes('guard') && base === 3 ? 4 : base;
}

const LEAST: Record<Confidence, number> = { static: 0, undecided: 1, confirmed: 2 };

/** The params the plan reads from policy/placement's cross_cutting item. */
function crossParams(placement: PolicyView) {
  const item = placement.items.find((one) => one.impl === 'builtin:placement/cross-cutting');
  const params = (item?.enabled === false ? undefined : item?.params) ?? {};
  const byAct = (item?.effect.fix_location_by_act ?? {}) as Record<string, string>;
  return {
    enabled: item?.enabled === true,
    minHomes: Number(params.min_homes ?? Number.POSITIVE_INFINITY),
    classMinHomes: Number(params.class_min_homes ?? Number.POSITIVE_INFINITY),
    minRuns: Number(params.min_runs_per_home ?? 1),
    countNone: params.count_no_skill_home !== false,
    byAct,
    sections: (placement.params.core_sections ?? {}) as Record<string, string>,
    ref: item === undefined ? placement.ref : `${placement.ref}#${item.id}`,
  };
}

/** The homes of a group of diagnoses: homes with at least `minRuns` runs. */
function homesOf(group: readonly CampaignDiagnosis[], minRuns: number, countNone: boolean): number {
  const runs = new Map<string, Set<string>>();
  for (const one of group) {
    if (one.home === 'none' && !countNone) continue;
    const blocks = runs.get(one.home) ?? new Set<string>();
    blocks.add(one.block);
    runs.set(one.home, blocks);
  }
  return [...runs.values()].filter((blocks) => blocks.size >= minRuns).length;
}

/** Steps 1 and 2: recurrence over the campaign, and the diagnoses re-placed to the core prompt. */
export function replace(diagnoses: readonly CampaignDiagnosis[], placement: PolicyView): CampaignDiagnosis[] {
  const cross = crossParams(placement);
  if (!cross.enabled) return [...diagnoses];
  const movable = (one: CampaignDiagnosis) =>
    one.inherits === undefined &&
    !one.placement.endsWith('#fixed') &&
    !one.placement.endsWith('#cross_cutting') &&
    one.fix_location !== 'none' &&
    one.fix_location !== 'unassigned';
  const bySignature = new Map<string, CampaignDiagnosis[]>();
  const byItem = new Map<string, CampaignDiagnosis[]>();
  for (const one of diagnoses) {
    if (one.inherits !== undefined) continue;
    const key = `${one.item}|${one.act ?? ''}`;
    bySignature.set(key, [...(bySignature.get(key) ?? []), one]);
    byItem.set(one.item, [...(byItem.get(one.item) ?? []), one]);
  }
  return diagnoses.map((one) => {
    if (!movable(one)) return one;
    const act = bySignature.get(`${one.item}|${one.act ?? ''}`) ?? [];
    const cls = byItem.get(one.item) ?? [];
    const crosses =
      homesOf(act, cross.minRuns, cross.countNone) >= cross.minHomes ||
      homesOf(cls, cross.minRuns, cross.countNone) >= cross.classMinHomes;
    if (!crosses) return one;
    const location =
      (one.act === undefined ? undefined : cross.byAct[one.act]) ??
      cross.byAct.default ??
      'agent.cross_skill';
    const section = location === 'agent.skill_reading' ? cross.sections.skill_use : cross.sections.behaviour;
    const copies = new Set<string>();
    for (const other of act)
      if (other.fix_target !== undefined && movable(other)) copies.add(other.fix_target);
    return {
      ...one,
      fix_location: location,
      fix_target: `core:${section ?? 'core'}`,
      placement: cross.ref,
      remove_copies: [...copies].sort(),
      flags: [...one.flags.filter((flag) => flag !== 'provisional')],
      ...(one.fix_target === undefined ? {} : { local_target: one.fix_target }),
    };
  });
}

/** Steps 3 and 4: one fix per target and action, ranked by agent blocks, then blocks, then cost. */
export function fixPlan(diagnoses: readonly CampaignDiagnosis[], placement: PolicyView, n = 10): FixPlan {
  const placed = replace(diagnoses, placement);
  const roots = placed.filter((one) => one.inherits === undefined);
  const unassigned = roots.filter((one) => one.fix_location === 'unassigned').length;
  const groups = new Map<string, CampaignDiagnosis[]>();
  for (const one of roots) {
    if (one.fix_location === 'none' || one.fix_location === 'unassigned') continue;
    const key = `${one.fix_location}\u0000${one.fix_target ?? ''}\u0000${one.fix_action}`;
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }
  const fixes: Fix[] = [];
  for (const group of groups.values()) {
    const first = group[0] as CampaignDiagnosis;
    const forms = [...new Set(group.flatMap((one) => one.fix_forms))];
    const blocks = new Set(group.map((one) => one.block));
    const agent = new Set(
      group
        .filter((one) => one.disposition === 'agent' || one.disposition === 'shared')
        .map((one) => one.block),
    );
    const copies = [...new Set(group.flatMap((one) => one.remove_copies ?? []))].sort();
    const confidence = group.reduce<Confidence>(
      (least, one) => (LEAST[one.confidence] < LEAST[least] ? one.confidence : least),
      'confirmed',
    );
    const ruleText =
      first.act === undefined || copies.length === 0 ? undefined : CLASS_RULE_BY_ACT[first.act];
    fixes.push({
      id: `${first.fix_location}:${first.fix_target ?? ''}:${first.fix_action}`,
      fix_location: first.fix_location,
      ...(first.fix_target === undefined ? {} : { fix_target: first.fix_target }),
      fix_action: first.fix_action,
      fix_forms: forms,
      blocks: blocks.size,
      agent_blocks: agent.size,
      rules: [...new Set(group.map((one) => one.item))],
      remove_copies: copies,
      confidence,
      ...(ruleText === undefined ? {} : { rule_text: ruleText }),
      cost_class: costClass(first.fix_location, forms),
    });
  }
  // The local fixes a core fix replaces stay listed, marked, with the blocks that asked for them.
  const moved = new Map<
    string,
    { blocks: Set<string>; agent: Set<string>; item: string; action: string; by: string }
  >();
  for (const fix of fixes) {
    for (const target of fix.remove_copies) {
      const local = placed.filter((one) => one.local_target === target);
      const entry = moved.get(target) ?? {
        blocks: new Set(),
        agent: new Set(),
        item: '',
        action: '',
        by: fix.id,
      };
      for (const one of local) {
        entry.blocks.add(one.block);
        if (one.disposition === 'agent' || one.disposition === 'shared') entry.agent.add(one.block);
        entry.item = one.item;
        entry.action = one.fix_action;
      }
      moved.set(target, entry);
    }
  }
  for (const [target, entry] of moved) {
    fixes.push({
      id: `local:${target}`,
      fix_location: target.startsWith('skill:') ? 'skill.layout' : 'skill.content',
      fix_target: target,
      fix_action: entry.action === '' ? 'remove_copy' : entry.action,
      fix_forms: ['prose'],
      blocks: entry.blocks.size,
      agent_blocks: entry.agent.size,
      rules: entry.item === '' ? [] : [entry.item],
      remove_copies: [],
      superseded_by: entry.by,
      confidence: 'static',
      cost_class: 2,
    });
  }
  fixes.sort(
    (a, b) =>
      Number(a.superseded_by !== undefined) - Number(b.superseded_by !== undefined) ||
      b.agent_blocks - a.agent_blocks ||
      b.blocks - a.blocks ||
      a.cost_class - b.cost_class ||
      a.id.localeCompare(b.id),
  );
  const head = fixes.filter((fix) => fix.superseded_by === undefined).slice(0, n);
  const tail = fixes.filter((fix) => fix.superseded_by !== undefined);
  return { fixes: [...head, ...tail], unassigned, moved: moved.size };
}

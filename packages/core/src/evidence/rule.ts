import { callSucceeded, readAmount } from './reads';
import { skillOfPath, verdictAtoms, verdictLinks } from './subject';
import type { EvidenceInput, EvidenceProvider, RuleAtom } from './types';
import { homeOfAtom } from './value';

/**
 * Evidence about the rule a failing verdict enforces: where it is written, which skill holds it, which act it
 * asks for, and whether the skill that holds it was routed and loaded. Read from the estate map
 * (`metadata.estate.atoms` of an estate spec) or from the block's links to the lines it verifies.
 */

export const rule_atom: EvidenceProvider = {
  name: 'rule_atom',
  cost: 'static',
  values: ['atom ids', 'none'],
  from: "the spec's estate atoms for the failing check, or the block's links with relation verifies",
  compute: (input) => {
    const atoms = verdictAtoms(input).map((atom) => atom.id);
    if (atoms.length > 0) return atoms;
    const links = verdictLinks(input).map((link) => `${link.file ?? link.home}:${link.line ?? 0}`);
    return links.length > 0 ? links : 'none';
  },
};

export const rule_home: EvidenceProvider = {
  name: 'rule_home',
  cost: 'static',
  values: [
    'core',
    'skill_body',
    'skill_reference',
    'skill_script',
    'helper',
    'guard',
    'tool_schema',
    'instruction',
    'none',
  ],
  from: "the atom's kind and provenance file, or the link's home",
  compute: (input) => {
    const atom = verdictAtoms(input)[0];
    if (atom) return homeOfAtom(atom);
    return verdictLinks(input)[0]?.home ?? 'none';
  },
};

/** The skill the rule lives in: the provenance path of its atom, or the link. A helper, not a provider. */
export function ruleSkillOf(input: EvidenceInput): string | undefined {
  const atom = verdictAtoms(input)[0];
  if (atom) return skillOfPath(atom.provenance.file);
  const link = verdictLinks(input)[0];
  return link?.skill ?? (link?.file === undefined ? undefined : skillOfPath(link.file));
}

export const rule_skill: EvidenceProvider = {
  name: 'rule_skill',
  cost: 'static',
  values: ['a skill name'],
  from: 'the provenance path of the atom, or the link',
  compute: ruleSkillOf,
};

/** The act class of an atom: its first evidence predicate, else its kind. */
function actOf(atom: RuleAtom): { act: string; detail: string } {
  for (const predicate of atom.evidence ?? []) {
    switch (predicate.type) {
      case 'skill_loaded':
      case 'skill_not_loaded':
        return { act: 'load_skill', detail: 'load_skill' };
      case 'tool_called':
        if (predicate.label === 'Read') return { act: 'read_reference', detail: 'read_reference' };
        return { act: 'tool_called', detail: `tool_called:${String(predicate.label)}` };
      case 'ordered':
        return { act: 'ordered', detail: `ordered:${String(predicate.before)}>${String(predicate.after)}` };
      case 'stage_reached':
        return { act: 'stage', detail: `stage:${String(predicate.name)}` };
      case 'custom':
        if (predicate.name === 'ordered') {
          const options = (predicate.options ?? {}) as Record<string, unknown>;
          return { act: 'ordered', detail: `ordered:${String(options.before)}>${String(options.after)}` };
        }
        if (predicate.name === 'stage_seen' || predicate.name === 'stage_order') {
          return {
            act: 'stage',
            detail: `stage:${String((predicate.options as Record<string, unknown> | undefined)?.name ?? predicate.name)}`,
          };
        }
        return { act: String(predicate.name), detail: String(predicate.name) };
    }
  }
  if (atom.kind === 'gate') return { act: 'gate', detail: 'gate' };
  if (atom.kind === 'stage') return { act: 'stage', detail: 'stage' };
  return { act: atom.kind, detail: atom.kind };
}

export const rule_act: EvidenceProvider = {
  name: 'rule_act',
  cost: 'static',
  values: [
    'load_skill',
    'read_reference',
    'ordered',
    'stage',
    'gate',
    'step',
    'recovery',
    'tool_contract',
    'provenance',
    'integrity',
  ],
  from: "the atom's evidence type (skill_loaded, tool_called, ordered, stage_reached, custom) and kind, or the link's act",
  compute: (input) => {
    const atom = verdictAtoms(input)[0];
    if (atom) return actOf(atom).act;
    return verdictLinks(input)[0]?.act;
  },
};

/** The act with its detail, for a recurrence signature: `ordered:Read>Edit`, `stage:verify`. Never a skill or file name. */
export const act_signature: EvidenceProvider = {
  name: 'act_signature',
  cost: 'static',
  values: ['an act class with its detail'],
  from: 'rule_act with the ordered pair or the stage it names',
  compute: (input) => {
    const atom = verdictAtoms(input)[0];
    if (atom) return actOf(atom).detail;
    return verdictLinks(input)[0]?.act;
  },
};

export const rule_situational: EvidenceProvider = {
  name: 'rule_situational',
  cost: 'static',
  values: ['boolean'],
  from: "the atom's situation: a rule stated for one situation of its skill (a pointer's situation is where it fires, already a layout); for a rule no file states, the block's own situation",
  compute: (input) => {
    const atom = verdictAtoms(input)[0];
    if (!atom) {
      if (verdictLinks(input).length > 0) return false;
      return (input.expect?.situation ?? '').trim() === '' ? undefined : true;
    }
    const pointer =
      (atom.kind === 'reference' || atom.kind === 'gate') && typeof atom.fields?.path === 'string';
    return (atom.situation ?? '').trim() !== '' && atom.kind !== 'skill' && atom.kind !== 'route' && !pointer;
  },
};

export const rule_mechanical: EvidenceProvider = {
  name: 'rule_mechanical',
  cost: 'static',
  values: ['boolean'],
  from: 'the failing verdict is a machine verdict',
  compute: (input) => input.verdict.kind === 'machine',
};

/** The skills the block routes to: expect.skills and the route atoms the failing check names. A helper. */
export function routedOf(input: EvidenceInput): string[] {
  const out = new Set(input.expect?.skills ?? []);
  for (const atom of verdictAtoms(input)) {
    if (atom.kind === 'route' || atom.kind === 'skill') {
      const name = (atom.fields?.name as string | undefined) ?? skillOfPath(atom.provenance.file);
      if (name) out.add(name);
    }
  }
  return [...out];
}

export const routed_skills: EvidenceProvider = {
  name: 'routed_skills',
  cost: 'static',
  values: ['skill names'],
  from: 'expect.skills and the route atoms the failing check names',
  compute: routedOf,
};

/** The skill a load question is about: the one the verdict names, the rule's skill, else the first routed one. */
function subjectSkill(input: EvidenceInput): string | undefined {
  const named = /^skills\.(.+)$/.exec(input.verdict.id) ?? /^skills\.(.+)$/.exec(input.verdict.name);
  if (named) return named[1];
  return ruleSkillOf(input) ?? routedOf(input)[0];
}

/** Whether a skill loaded in the block: the runtime's skill list, a Read of its SKILL.md, or a Skill tool call. */
export function skillLoaded(input: EvidenceInput, name: string): boolean {
  const calls = input.block.observed.toolCalls.filter((call) => {
    const args = (call.input ?? {}) as Record<string, unknown>;
    return call.label === 'Skill' && (args.skill === name || args.name === name || args.command === name);
  });
  if (calls.some((call) => callSucceeded(input, call))) return true;
  if (calls.length === 0 && (input.block.observed.runtime?.skills ?? []).some((skill) => skill.name === name))
    return true;
  return readAmount(input, `skills/${name}/SKILL.md`) === 'full';
}

export const skill_loaded: EvidenceProvider = {
  name: 'skill_loaded',
  cost: 'static',
  values: ['boolean'],
  from: "the trace's skills list, or a Read of the skill's SKILL.md, for the skill the check is about",
  compute: (input) => {
    const name = subjectSkill(input);
    return name === undefined ? undefined : skillLoaded(input, name);
  },
};

/**
 * The plan row of the block for a skill: route_positive (the ask fits the description) or route_near_miss (it
 * belongs elsewhere). The first row that names the skill decides.
 */
function planRowType(input: EvidenceInput, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const row = (input.planRows ?? []).find(
    (one) =>
      (one.testType === 'route_positive' || one.testType === 'route_near_miss') &&
      (one.skill === name || one.atomIds.some((id) => id.includes(`.${name}.`))),
  );
  return row?.testType;
}

export const skill_covers: EvidenceProvider = {
  name: 'skill_covers',
  cost: 'static',
  values: ['covered', 'not_covered', 'unknown'],
  from: "the block's plan row for the skill (route_positive: covered, route_near_miss: not_covered); with no such row, a stored reference agent's load count against the bar; else unknown",
  compute: (input) => {
    const type = planRowType(input, subjectSkill(input));
    if (type === 'route_positive') return 'covered';
    if (type === 'route_near_miss') return 'not_covered';
    const loads = input.confirm?.reference_loads;
    if (loads !== undefined) return loads >= (input.bar ?? 2) ? 'covered' : 'not_covered';
    return 'unknown';
  },
};

export const rule_skill_routed: EvidenceProvider = {
  name: 'rule_skill_routed',
  cost: 'static',
  values: ['boolean'],
  from: 'derived: rule_skill is one of routed_skills',
  reads: ['rule_skill', 'routed_skills'],
  derive: (known) => {
    const skill = known.rule_skill as string | undefined;
    if (skill === undefined) return undefined;
    return ((known.routed_skills as readonly string[] | undefined) ?? []).includes(skill);
  },
};

export const rule_needed_by: EvidenceProvider = {
  name: 'rule_needed_by',
  cost: 'static',
  values: ['number'],
  from: "the skills whose plan rows name the rule's atom, the routed skill, the rule's own skill, and the core prompt when a core atom cites it (a core rule's own home is not counted)",
  compute: (input) => {
    const atoms = verdictAtoms(input);
    if (atoms.length === 0) return undefined;
    const ids = new Set(atoms.map((atom) => atom.id));
    const homes = new Set<string>();
    for (const row of input.planRows ?? []) {
      if (row.skill !== undefined && row.atomIds.some((id) => ids.has(id))) homes.add(row.skill);
    }
    for (const skill of routedOf(input)) homes.add(skill);
    for (const atom of atoms) {
      const skill = skillOfPath(atom.provenance.file);
      if (skill) homes.add(skill);
    }
    const byId = new Map((input.atoms ?? []).map((atom) => [atom.id, atom]));
    for (const edge of input.edges ?? []) {
      if (!ids.has(edge.to) || edge.kind !== 'cites') continue;
      const from = byId.get(edge.from);
      if (from && homeOfAtom(from) === 'core') homes.add('core');
    }
    return homes.size;
  },
};

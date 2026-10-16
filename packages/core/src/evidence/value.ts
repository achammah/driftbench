import { parameterSchema } from '../schema/json-schema';
import { callSucceeded, readPaths } from './reads';
import {
  asText,
  foldSpace,
  subjectCalls,
  subjectField,
  subjectTool,
  toolExecutions,
  verdictAtoms,
  verdictLinks,
} from './subject';
import type { EvidenceInput, EvidenceProvider, ValueFact } from './types';

/**
 * Evidence about the value a failing verdict checked: where it came from, how it changed, where its format is
 * stated and what the value check settled. The value-check rungs compute the outcome; these providers read
 * their stored record and never replay a tool.
 */

function fact(input: EvidenceInput): ValueFact | undefined {
  return input.values?.[0];
}

/** The text of files the agent read and of earlier tool outputs, by kind, for provenance. */
function readTexts(input: EvidenceInput): { files: string[]; skills: string[]; outputs: string[] } {
  const files: string[] = [];
  const skills: string[] = [];
  const outputs: string[] = [];
  for (const call of input.block.observed.toolCalls) {
    const text =
      typeof call.output === 'string'
        ? call.output
        : call.output === undefined
          ? ''
          : JSON.stringify(call.output);
    const paths = readPaths(call);
    if (paths.length > 0 && !callSucceeded(input, call)) continue;
    const path = paths[0];
    if (path !== undefined) {
      if (/(?:^|\/)skills\//.test(path)) skills.push(text);
      else files.push(text);
    } else if (text !== '') {
      outputs.push(text);
    }
  }
  for (const run of toolExecutions(input)) {
    if (!run.stdout) continue;
    const call = { label: 'Bash', input: { command: run.command }, startedAt: run.startedAt };
    const paths = readPaths(call);
    if (paths.length > 0) {
      if (run.exitCode !== 0) continue;
      const matches = input.block.observed.toolCalls.filter(
        (one) =>
          (one.input as { command?: unknown } | undefined)?.command === run.command &&
          (run.startedAt === undefined || one.startedAt === undefined || one.startedAt === run.startedAt),
      );
      if (matches.length > 0 && !matches.some((one) => callSucceeded(input, one))) continue;
      if (paths.some((path) => /(?:^|\/)skills\//.test(path))) skills.push(run.stdout);
      else files.push(run.stdout);
    } else outputs.push(run.stdout);
  }
  return { files, skills, outputs };
}

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

type Reading = { source: string; change?: string };

/**
 * Where the agent's value comes from and how it changed, read from the texts the agent had. A value found
 * verbatim (spaces folded) in the user turn is the user's, verbatim; found only ignoring case, case_only; found
 * in a workspace or skill file it read, or in an earlier tool output, that source. A value whose last ten digits
 * appear in the user turn was built by the agent from the user's value (agent_derived). A value found nowhere is
 * read as the user's value, altered.
 */
function reading(input: EvidenceInput, known: ValueFact | undefined = fact(input)): Reading | undefined {
  if (known === undefined) return undefined;
  const text = asText(known.value);
  if (text === undefined) return known.source === undefined ? undefined : { source: known.source };
  const value = foldSpace(text);
  const compare = (where: string): string | undefined => {
    const hay = foldSpace(where);
    if (hay.includes(value)) return 'verbatim';
    if (hay.toLowerCase().includes(value.toLowerCase())) return 'case_only';
    return undefined;
  };
  if (known.source !== undefined) {
    const user = input.user === undefined ? undefined : compare(input.user);
    return { source: known.source, ...(user === undefined ? {} : { change: user }) };
  }
  const user = input.user === undefined ? undefined : compare(input.user);
  if (user !== undefined) return { source: 'user', change: user };
  const texts = readTexts(input);
  for (const [source, list] of [
    ['workspace_file', texts.files],
    ['skill_file', texts.skills],
    ['tool_output', texts.outputs],
  ] as const) {
    for (const where of list) {
      const change = compare(where);
      if (change !== undefined) return { source, change };
    }
  }
  const valueDigits = digits(value);
  if (
    input.user !== undefined &&
    valueDigits.length > 0 &&
    digits(input.user).includes(valueDigits.slice(-10))
  ) {
    return { source: 'agent_derived' };
  }
  return input.user === undefined ? undefined : { source: 'user', change: 'altered' };
}

export const source: EvidenceProvider = {
  name: 'source',
  cost: 'static',
  values: ['user', 'agent_derived', 'prompt', 'tool_output', 'skill_file', 'workspace_file'],
  from: "the oracle's provenance tag for the expected value, else where the agent's value appears: the user turn, a file it read, an earlier tool output",
  compute: (input) => reading(input)?.source,
};

export const change: EvidenceProvider = {
  name: 'change',
  cost: 'static',
  values: ['verbatim', 'case_only', 'unit_converted', 'reformatted', 'altered'],
  from: 'the as-given rung when it ran, else the agent value against its source text',
  compute: (input) => fact(input)?.change ?? reading(input)?.change,
};

/** A JSON-schema node for a field of a tool input, following the path. */
function schemaNode(input: EvidenceInput): Record<string, unknown> | undefined {
  const tool = subjectTool(input);
  const field = subjectField(input);
  if (tool === undefined || field === undefined) return undefined;
  let node = parameterSchema(input.toolSchemas?.[tool]) as Record<string, unknown> | undefined;
  for (const key of [field, ...(fact(input)?.path ?? [])]) {
    const props = node?.properties as Record<string, unknown> | undefined;
    node = props?.[key] as Record<string, unknown> | undefined;
  }
  return node;
}

function statedFormat(input: EvidenceInput) {
  const tool = subjectTool(input);
  const field = subjectField(input);
  return input.stated?.find(
    (rule) =>
      rule.tool === tool && (rule.field === undefined || rule.field === field) && rule.format !== undefined,
  );
}

/** An earlier error of the subject tool that states what it expects, which the agent read before its next call. */
function errorSeen(input: EvidenceInput): boolean {
  const calls = subjectCalls(input);
  const at = fact(input)?.call ?? calls.length - 1;
  return calls
    .slice(0, Math.max(0, at))
    .some((call) => /\b(expected|must|format|should be|invalid)\b/i.test(call.error ?? ''));
}

const HOME_CONTRACT: Record<string, string> = {
  core: 'prompt',
  skill_body: 'skill',
  skill_reference: 'skill',
  skill_script: 'skill',
  instruction: 'instruction',
  tool_schema: 'tool',
};

export const contract: EvidenceProvider = {
  name: 'contract',
  cost: 'static',
  values: ['tool', 'prompt', 'none', 'downstream', 'instruction', 'skill', 'error_seen'],
  from: "the contract rung's record, else the tool schema (an enum or a pattern), a stated format, an error the agent read; for a rule verdict, the home of the rule it enforces",
  compute: (input) => {
    const known = fact(input);
    if (known !== undefined) {
      if (known.contract !== undefined) return known.contract;
      const node = schemaNode(input);
      if (node !== undefined && ('enum' in node || 'pattern' in node)) return 'tool';
      const stated = statedFormat(input);
      if (stated) return stated.where;
      if (errorSeen(input)) return 'error_seen';
      return 'none';
    }
    const link = verdictLinks(input)[0];
    if (link) return HOME_CONTRACT[link.home] ?? 'none';
    const atom = verdictAtoms(input)[0];
    if (atom) return HOME_CONTRACT[homeOfAtom(atom)] ?? 'none';
    return 'none';
  },
};

export const contract_broken: EvidenceProvider = {
  name: 'contract_broken',
  cost: 'static',
  values: ['boolean'],
  from: "the contract rung's record, else the value against the tool schema or the stated format; a failing verdict that enforces a stated rule breaks it",
  compute: (input) => {
    const known = fact(input);
    if (known !== undefined) {
      if (known.contractBroken !== undefined) return known.contractBroken;
      const text = asText(known.value);
      const node = schemaNode(input);
      if (node && Array.isArray(node.enum)) return !node.enum.includes(known.value);
      if (node && typeof node.pattern === 'string')
        return text === undefined || !new RegExp(node.pattern).test(text);
      const stated = statedFormat(input);
      if (stated?.format !== undefined)
        return text === undefined || !new RegExp(`^(?:${stated.format})$`).test(text);
      return false;
    }
    const stated = verdictLinks(input).length > 0 || verdictAtoms(input).length > 0;
    return stated && input.verdict.outcome === 'fail';
  },
};

export const outcome: EvidenceProvider = {
  name: 'outcome',
  cost: 'static',
  values: ['accepted_as_gold', 'failed', 'resolved_differently'],
  from: 'the value-check rungs: the outcome a rung stated, else what it settled (the judge rung settles a different referent)',
  compute: (input) => {
    const known = fact(input);
    if (known === undefined) return undefined;
    if (known.outcome !== undefined) return known.outcome;
    if (known.rung === 'rung2' || known.settles === undefined || known.settles === 'inconclusive')
      return undefined;
    if (known.settles === 'pass') return 'accepted_as_gold';
    return known.rung === 'rung3' ? 'resolved_differently' : 'failed';
  },
};

export const declared_format: EvidenceProvider = {
  name: 'declared_format',
  cost: 'static',
  values: ['a form', 'none'],
  from: "the failing check's own assertion",
  compute: (input) => {
    const known = fact(input);
    if (known === undefined) return undefined;
    return known.demanded ?? 'none';
  },
};

export const downstream_need: EvidenceProvider = {
  name: 'downstream_need',
  cost: 'static',
  values: ['declared', 'none'],
  from: 'a consumer of this tool and argument that the block (`expect.downstream`) or a blame item (`downstream_consumers`) declares',
  compute: (input) => {
    const tool = subjectTool(input);
    const field = subjectField(input);
    const consumers = [...(input.expect?.downstream ?? []), ...(input.downstreamConsumers ?? [])];
    const reads = consumers.some(
      (one) =>
        (one.tool === undefined || one.tool === tool) && (one.field === undefined || one.field === field),
    );
    return reads ? 'declared' : 'none';
  },
};

export const changed_inputs_fail: EvidenceProvider = {
  name: 'changed_inputs_fail',
  cost: 'static',
  values: ['boolean'],
  from: 'the recompute rung: passes on the seed, fails on changed inputs',
  compute: (input) => {
    const facts = input.values ?? [];
    if (facts.some((one) => one.changedInputsFail === true)) return true;
    if (facts.some((one) => one.changedInputsFail === false)) return false;
    return undefined;
  },
};

export const tool_output_wrong: EvidenceProvider = {
  name: 'tool_output_wrong',
  cost: 'static',
  values: ['boolean'],
  from: 'a value the agent reported that came from a tool output (not from the user or a file), and that differs from gold',
  compute: (input) =>
    (input.values ?? []).some((one) => {
      const fromTool = reading(input, one)?.source === 'tool_output';
      const wrong =
        one.outcome === 'failed' ||
        one.outcome === 'resolved_differently' ||
        (one.outcome === undefined &&
          one.gold !== undefined &&
          JSON.stringify(one.gold) !== JSON.stringify(one.value));
      return fromTool && wrong;
    }),
};

/** The parts the reply asks the user for: the stored reading, else the part names found in a question. */
function askedParts(input: EvidenceInput, candidates: readonly string[]): string[] {
  if (input.reply?.asked_for !== undefined) return [...input.reply.asked_for];
  const reply = input.block.observed.text;
  if (!reply.includes('?')) return [];
  return candidates.filter((part) => new RegExp(`\\b${part.replace(/_/g, '[ _]')}\\b`, 'i').test(reply));
}

export const stricter_rule_obeyed: EvidenceProvider = {
  name: 'stricter_rule_obeyed',
  cost: 'static',
  values: ['boolean'],
  from: 'no call of the tool; the reply asks for a part a stated rule demands and the tool does not need; no record that the tool refuses the given value',
  compute: (input) => {
    const tool = subjectTool(input);
    if (tool === undefined || subjectCalls(input).length > 0) return false;
    const field = subjectField(input);
    const rules = (input.stated ?? []).filter(
      (rule) =>
        rule.tool === tool && (field === undefined || rule.field === undefined || rule.field === field),
    );
    const extra = rules.flatMap((rule) =>
      (rule.asks ?? []).filter((part) => rule.toolNeeds !== undefined && !rule.toolNeeds.includes(part)),
    );
    if (extra.length === 0) return false;
    if ((input.values ?? []).some((one) => one.settles === 'fail')) return false;
    const asked = askedParts(input, extra);
    return extra.some((part) => asked.includes(part));
  },
};

/** Where an atom's rule lives, by its kind and its file. */
export function homeOfAtom(atom: { kind: string; provenance: { file: string } }): string {
  const file = atom.provenance.file.replace(/\\/g, '/');
  switch (atom.kind) {
    case 'reference':
      return 'skill_reference';
    case 'script':
      return 'skill_script';
    case 'subagent':
      return 'helper';
    case 'guard':
      return 'guard';
    case 'tool':
      return 'tool_schema';
  }
  if (/(?:^|\/)skills\/[^/]+\/SKILL\.md$/i.test(file)) return 'skill_body';
  if (/(?:^|\/)skills\/[^/]+\/scripts\//.test(file)) return 'skill_script';
  if (/(?:^|\/)skills\/[^/]+\//.test(file)) return 'skill_reference';
  if (/(?:^|\/)agents\//.test(file)) return 'helper';
  if (/(?:^|\/)(guards|hooks)\//.test(file)) return 'guard';
  return 'core';
}

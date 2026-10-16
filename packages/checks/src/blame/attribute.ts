import { evidence, type Verdict } from '@agent-nexus/driftbench-core';
import { applyPlacement, type PlacedBefore, type PolicyView } from '../placement/apply';
import { chainVerdicts } from './chain';
import { BLAME_IMPLS, type BlameImpl } from './impls';
import type { Attribution, BlameDiagnosis } from './types';
import { type Facts, namesRead, whenHolds } from './when';

/**
 * Attribution and the per-block procedure of `diagnostic/code-agent-liability` (codeagent_equivalence_blame.md
 * E1): chain, evidence, attribute, place. No agent call; the machine pass of the block is never read or written.
 */

/** Extra blame implementations, such as a plugin's `plugin:<name>`; a shipped name is never replaced. */
const extraImpls = new Map<string, BlameImpl>();

export function registerBlameImpl(name: string, impl: BlameImpl): void {
  if (BLAME_IMPLS[name] !== undefined || extraImpls.has(name)) {
    throw new Error(`the blame implementation ${name} is already registered`);
  }
  extraImpls.set(name, impl);
}

function implOf(name: string): BlameImpl | undefined {
  return BLAME_IMPLS[name] ?? extraImpls.get(name);
}

/** The first enabled item of the blame object whose condition holds writes the attribution. */
export function attribute(object: PolicyView, facts: Facts): Attribution {
  for (const item of object.items) {
    if (!item.enabled) continue;
    if (!whenHolds(item.when, facts, [item.params, object.params])) continue;
    const impl = implOf(item.impl);
    if (!impl)
      throw new Error(
        `${object.ref}: item ${item.id} names ${item.impl}, which no blame builtin or plugin provides`,
      );
    const out = impl.attribute(item, facts, `${object.ref}#${item.id}`);
    if (out !== null)
      return {
        ...out,
        by: { object: object.ref, item: item.id, impl: item.impl, layer: item.layer ?? 'shipped' },
      };
  }
  return {
    item: 'unassigned',
    rule: `${object.ref}#(none)`,
    verdict: 'fail',
    fault: ['unknown'],
    disposition: 'unassigned',
    fix_action: 'review',
    fix_location: 'unassigned',
    place: 'fixed',
    confidence: 'static',
    flags: ['no_item_matched'],
  };
}

/** The params the evidence step needs from the blame object: the bar and the retry limit. */
function evidenceSettings(object: PolicyView): Pick<evidence.EvidenceInput, 'bar' | 'maxRetries'> {
  const bar = object.params.bar;
  const r3 = object.items.find((item) => item.impl === 'builtin:blame/copied-value-tool-failed');
  const max = r3?.params.max_retries;
  return {
    ...(typeof bar === 'number' ? { bar } : {}),
    ...(typeof max === 'number' ? { maxRetries: max } : {}),
  };
}

/** The line of the rule a failing check enforces: `file:line`, for targets and copies. */
function atomLine(input: evidence.EvidenceInput): string | undefined {
  const ids = new Set(input.ruleAtoms ?? []);
  const atom = (input.atoms ?? []).find((one) => ids.has(one.id));
  if (atom) return `${atom.provenance.file}:${atom.provenance.startLine}`;
  const link = (input.links ?? []).find((one) =>
    one.verdict.endsWith('*')
      ? input.verdict.id.startsWith(one.verdict.slice(0, -1))
      : one.verdict === input.verdict.id,
  );
  return link?.file === undefined ? undefined : `${link.file}:${link.line ?? 0}`;
}

/** Every evidence name of one failing verdict, plus the facts placement reads. */
export function factsOf(input: evidence.EvidenceInput, object: PolicyView): Record<string, unknown> {
  const facts: Record<string, unknown> = evidence.computeEvidence({ ...input, ...evidenceSettings(object) });
  const line = atomLine(input);
  if (line !== undefined) facts.atom_line = line;
  const tool = evidence.subjectTool(input);
  if (tool !== undefined) facts.tool = tool;
  return facts;
}

export type DiagnoseBlockInput = {
  verdicts: readonly Verdict[];
  /** The evidence input of one failing verdict: the caller joins the run, the map, the links and the stores. */
  evidenceFor: (verdict: Verdict) => evidence.EvidenceInput;
  /** The tools the block expects, in order, for the chain step. */
  tools?: readonly string[];
  blame: PolicyView;
  placement: PolicyView;
  /** Earlier diagnoses of the same estate version, for recurrence. */
  history?: readonly PlacedBefore[];
  /** `diagnostic/<id>@<hash8>`, written on every diagnosis. */
  diagnostic?: string;
  fixText?: string;
  /** false: every failing verdict is a root (the chain step disabled). */
  chain?: boolean;
};

export type DiagnoseBlockResult = {
  diagnoses: BlameDiagnosis[];
  /** Failing steps a retry inside the block recovered: recorded, never attributed. */
  recovered: string[];
};

/** Chain, evidence, attribute and place, for every failing gating verdict of one block. */
export function diagnoseBlock(options: DiagnoseBlockInput): DiagnoseBlockResult {
  const facts = new Map<string, Record<string, unknown>>();
  const inputs = new Map<string, evidence.EvidenceInput>();
  const factsFor = (verdict: Verdict) => {
    let known = facts.get(verdict.id);
    if (!known) {
      const input = options.evidenceFor(verdict);
      inputs.set(verdict.id, input);
      known = factsOf(input, options.blame);
      facts.set(verdict.id, known);
    }
    return known;
  };
  const links =
    options.chain === false
      ? chainVerdicts(options.verdicts, { breaks: () => false, by: [] })
      : chainVerdicts(options.verdicts, {
          ...(options.tools === undefined ? {} : { tools: options.tools }),
          breaks: (verdict) => {
            const known = factsFor(verdict);
            if (known.tool_failed === true) return true;
            const tool = known.tool as string | undefined;
            const input = inputs.get(verdict.id);
            const called =
              tool !== undefined &&
              (input?.block.observed.toolCalls ?? []).some((call) => call.label === tool);
            return tool !== undefined && !called;
          },
          by: (options.blame.params.chain_by as string[] | undefined) ?? ['artifact_path', 'tool_output'],
        });
  const diagnoses: BlameDiagnosis[] = [];
  const recovered: string[] = [];
  const byRoot = new Map<string, BlameDiagnosis>();
  for (const link of links) {
    if (link.inherits !== undefined) {
      const root = byRoot.get(link.inherits);
      if (root) diagnoses.push({ ...root, verdict_ref: link.verdict.id, inherits: link.inherits });
      continue;
    }
    const known = factsFor(link.verdict);
    if (known.next_action === 'recovered') {
      recovered.push(link.verdict.id);
      continue;
    }
    const attribution = attribute(options.blame, known);
    const input = inputs.get(link.verdict.id) as evidence.EvidenceInput;
    const placed = applyPlacement(options.placement, {
      attribution,
      input,
      facts: known,
      ...(options.history === undefined ? {} : { history: options.history }),
      ...(options.fixText === undefined ? {} : { fixText: options.fixText }),
    });
    const item = options.blame.items.find((one) => one.id === attribution.item);
    const read = item === undefined ? [] : namesRead(item.when);
    const shown: Record<string, unknown> = {};
    for (const name of [...read, 'rule_home', 'recurrence_homes'])
      if (known[name] !== undefined) shown[name] = known[name];
    const home = ((known.routed_skills as string[] | undefined)?.[0] ?? known.rule_skill ?? 'none') as string;
    const diagnosis: BlameDiagnosis = {
      diagnostic: options.diagnostic ?? 'diagnostic/code-agent-liability',
      verdict_ref: link.verdict.id,
      rule: attribution.rule,
      ...(attribution.by === undefined ? {} : { by: attribution.by }),
      fault: attribution.fault,
      disposition: attribution.disposition,
      fix_location: placed.fix_location,
      ...(placed.fix_target === undefined ? {} : { fix_target: placed.fix_target }),
      fix_action: attribution.fix_action,
      fix_forms: placed.fix_forms,
      placement: placed.placement,
      evidence: shown,
      confidence: attribution.confidence,
      flags: [...attribution.flags, ...placed.flags, ...(placed.provisional ? ['provisional'] : [])],
      ...(placed.remove_copies.length === 0 ? {} : { remove_copies: placed.remove_copies }),
      item: attribution.item,
      ...(attribution.act === undefined
        ? known.act_signature === undefined
          ? {}
          : { act: String(known.act_signature) }
        : { act: attribution.act }),
      home,
    };
    byRoot.set(link.verdict.id, diagnosis);
    diagnoses.push(diagnosis);
  }
  return { diagnoses, recovered };
}

/**
 * How one block counts in the agent-attributed pass rate (E5): `pass` when every failing verdict's disposition is
 * setup, excluded or credited; `unassigned` when a failure has no attribution and none is the agent's; else
 * `fail`. A block with no failing verdict passes.
 */
export function agentOutcome(
  diagnoses: readonly Pick<BlameDiagnosis, 'disposition'>[],
): 'pass' | 'fail' | 'unassigned' {
  if (diagnoses.some((one) => one.disposition === 'agent' || one.disposition === 'shared')) return 'fail';
  if (diagnoses.some((one) => one.disposition === 'unassigned')) return 'unassigned';
  return 'pass';
}

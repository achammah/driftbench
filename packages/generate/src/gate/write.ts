import { type BlockSpec, type Spec, specHash } from '@agent-nexus/driftbench-core';
import { stringify } from 'yaml';
import { formatJson } from '../enumerate/json';
import type { BlockRecord, GateResult } from './gate';
import { stimulusText } from './then';
import { type Candidate, GATE_REASONS, GATE_STAGES, type GateOptions } from './types';

export const GATE_REPORT_FILE = 'gate-report.json';
export const GATED_DIR = 'specs';
export const HOLDOUT_DIR = 'holdout';
export const SEAL_FILE = 'seal.json';
export const REVIEW_FILE = 'review.yaml';
export const AUDIT_FILE = 'label-audit.yaml';

export type GateFile = { path: string; text: string };

export type GateReportMeta = {
  /** The candidates folder, as the report shows it. */
  source: string;
  references: string[];
  faultSet?: string;
  options: GateOptions;
};

/**
 * The gated suite as files. A spec with at least one accepted block is written: an accepted block keeps
 * its Then, a rejected one keeps its When (the conversation needs it) and its judged criteria, which do not
 * gate, and loses its machine expectations and budget. The spec rules stay only when every block is
 * accepted, the end state only when the last one is; `metadata.gate` records each block and what was dropped.
 */
export function gateFiles(
  result: GateResult,
  candidates: readonly Candidate[],
  meta: GateReportMeta,
): GateFile[] {
  const files: GateFile[] = [];
  const seal: { id: string; path: string; hash: string }[] = [];
  const bySpec = new Map<string, BlockRecord[]>();
  for (const record of result.blocks) bySpec.set(record.spec, [...(bySpec.get(record.spec) ?? []), record]);

  for (const candidate of candidates) {
    const records = bySpec.get(candidate.spec.id) ?? [];
    const accepted = records.filter((record) => record.status === 'accepted');
    if (accepted.length === 0) continue;
    const split = accepted[0]?.split ?? 'dev';
    const gated = gatedSpec(candidate.spec, records, meta.options.date);
    const folder = split === 'holdout' ? HOLDOUT_DIR : GATED_DIR;
    const path = `${folder}/${candidate.path}`;
    files.push({ path, text: specText(gated, candidate.path, split) });
    if (split === 'holdout') seal.push({ id: gated.id, path, hash: specHash(gated) });
  }

  files.push({
    path: `${HOLDOUT_DIR}/${SEAL_FILE}`,
    text: formatJson({
      sealed: true,
      note: 'The holdout is gated like the rest and never run as an evaluation here. Score it once, with a fixed query budget, and report the dev-to-fresh gap.',
      seed: meta.options.seed,
      share: meta.options.holdoutShare,
      specs: seal,
    }),
  });
  files.push({ path: GATE_REPORT_FILE, text: formatJson(report(result, meta)) });
  files.push({ path: REVIEW_FILE, text: reviewText(result, candidates) });
  files.push({ path: AUDIT_FILE, text: auditText(result, candidates) });
  return files;
}

function gatedSpec(spec: Spec, records: readonly BlockRecord[], date: string): Spec {
  const byIndex = new Map(records.map((record) => [record.index, record]));
  const dropped: string[] = [];
  const blocks: BlockSpec[] = spec.blocks.map((block, index) => {
    if (byIndex.get(index)?.status === 'accepted') return block;
    const { expect, budget: _budget, ...rest } = block;
    const criteria = expect?.criteria ?? [];
    const machine = Object.keys(expect ?? {}).filter((key) => key !== 'criteria');
    if (machine.length > 0) dropped.push(`${block.id ?? index}: ${machine.join(', ')}`);
    return criteria.length > 0 ? { ...rest, expect: { criteria } } : rest;
  });
  const allAccepted = records.every((record) => record.status === 'accepted');
  const lastAccepted = byIndex.get(spec.blocks.length - 1)?.status === 'accepted';
  const { rules, end_state, ...rest } = spec;
  if (rules !== undefined && !allAccepted) dropped.push('rules: a block they apply to was rejected');
  if (end_state !== undefined && !lastAccepted) dropped.push('end_state: the last block was rejected');
  return {
    ...rest,
    blocks,
    ...(rules !== undefined && allAccepted ? { rules } : {}),
    ...(end_state !== undefined && lastAccepted ? { end_state } : {}),
    metadata: {
      ...(spec.metadata ?? {}),
      gate: {
        by: 'driftbench gate',
        date,
        blocks: records.map((record) => ({
          block: record.id ?? record.index,
          status: record.status,
          ...(record.rejectedAt ? { stage: record.rejectedAt, reason: record.reason } : {}),
          ...(record.status === 'accepted'
            ? { pass_k: record.passK, pass_probability: round(record.passProbability ?? 0) }
            : {}),
        })),
        ...(dropped.length > 0 ? { dropped } : {}),
      },
    },
  };
}

function specText(spec: Spec, path: string, split: 'dev' | 'holdout'): string {
  const header = [
    `# Gated by driftbench gate from ${path}${split === 'holdout' ? ', sealed in the holdout' : ''}.`,
    '# Each block passed or was rejected by the nine stages; metadata.gate says which and why.',
    '# Do not edit it by hand: gate the candidates again. Fictional data only.',
  ];
  return `${header.join('\n')}\n${stringify(spec, { lineWidth: 0, aliasDuplicateObjects: false })}`;
}

function report(result: GateResult, meta: GateReportMeta) {
  const blocks = result.blocks;
  const accepted = blocks.filter((record) => record.status === 'accepted');
  const specs = new Set(accepted.map((record) => record.spec));
  const holdout = new Set(
    accepted.filter((record) => record.split === 'holdout').map((record) => record.spec),
  );
  const { origin, ...options } = meta.options;
  return {
    gate: 'driftbench gate',
    source: meta.source,
    references: meta.references,
    ...(meta.faultSet === undefined ? {} : { fault_set: meta.faultSet }),
    options: { ...options, origin_specs: origin?.length ?? 0 },
    stages: GATE_STAGES.map((stage) => ({ stage, reasons: GATE_REASONS[stage] })),
    summary: {
      specs: new Set(blocks.map((record) => record.spec)).size,
      specs_run: result.ran,
      blocks: blocks.length,
      accepted: accepted.length,
      rejected: blocks.length - accepted.length,
      gated_specs: specs.size,
      dev_specs: specs.size - holdout.size,
      holdout_specs: holdout.size,
      review: blocks.filter((record) => record.stages.stability.reason === 'flips').length,
      saturated: accepted.filter((record) => record.stages.difficulty.status === 'mark').length,
      audit_sample: accepted.filter((record) => record.stages.label_audit.status === 'mark').length,
    },
    funnel: result.funnel,
    mutation: {
      note: 'A fault is killed when at least one gated block that targets it goes red on it. Equivalent faults changed no observed field and leave the score; a control must stay green.',
      by_class: result.classes.map((entry) => ({
        ...entry,
        ...(entry.score ? { score: rounded(entry.score) } : {}),
      })),
      by_fault: result.faults.map((fault) => ({
        ...fault,
        suite: { ...fault.suite, ...(fault.suite.rate ? { rate: rounded(fault.suite.rate) } : {}) },
        pool: { ...fault.pool, ...(fault.pool.rate ? { rate: rounded(fault.pool.rate) } : {}) },
      })),
    },
    blocks: blocks.map((record) => ({
      key: record.key,
      path: record.path,
      family: record.family,
      target: record.target,
      fields: record.fields,
      ...(record.deviation ? { deviation: record.deviation } : {}),
      status: record.status,
      ...(record.rejectedAt ? { stage: record.rejectedAt, reason: record.reason } : {}),
      stages: record.stages,
      reference: record.reference,
      trivial: record.trivial,
      faults: Object.fromEntries(
        Object.entries(record.faults).map(([id, run]) => [
          id,
          { outcome: run.outcome, changed: run.changed },
        ]),
      ),
      ...(record.passK !== undefined ? { pass_k: record.passK } : {}),
      ...(record.passProbability !== undefined
        ? { pass_probability: round(record.passProbability), agents: record.agents }
        : {}),
      ...(record.created ? { created: record.created } : {}),
      ...(record.mapHash ? { map_hash: record.mapHash } : {}),
      ...(record.split ? { split: record.split } : {}),
    })),
  };
}

function reviewText(result: GateResult, candidates: readonly Candidate[]): string {
  const specs = new Map(candidates.map((candidate) => [candidate.spec.id, candidate.spec]));
  const flips = result.blocks.filter((record) => record.stages.stability.reason === 'flips');
  const body = {
    review: flips.map((record) => ({
      block: record.key,
      path: record.path,
      when: whenOf(specs.get(record.spec), record.index),
      reference: record.reference,
      why: record.stages.stability.detail,
      decision: null,
    })),
  };
  return [
    '# Blocks whose outcome flips between repeats on the reference: a weak Then, a noisy check or a fragile agent.',
    '# A person reads each one and writes a decision: fix the Then, fix the check, or drop the block.',
    stringify(body, { lineWidth: 0 }),
  ].join('\n');
}

function auditText(result: GateResult, candidates: readonly Candidate[]): string {
  const specs = new Map(candidates.map((candidate) => [candidate.spec.id, candidate.spec]));
  const sampled = result.blocks.filter((record) => record.stages.label_audit.status === 'mark');
  const families = [...new Set(sampled.map((record) => record.family))].sort();
  const body = {
    families: families.map((family) => ({
      family,
      sample: sampled
        .filter((record) => record.family === family)
        .map((record) => {
          const spec = specs.get(record.spec);
          const block = spec?.blocks[record.index];
          return {
            block: record.key,
            path: record.path,
            cell: record.cell,
            when: whenOf(spec, record.index),
            expected: block?.expect ?? {},
            label_correct: null,
            note: null,
          };
        }),
    })),
  };
  return [
    '# The label audit: a seeded sample of each family of gated blocks, for a person to read against the spec.',
    '# For each block, set label_correct to true or false and say why in note. The error rate per family is',
    '# the share of false answers, reported with its interval once the sample is read.',
    stringify(body, { lineWidth: 0 }),
  ].join('\n');
}

function whenOf(spec: Spec | undefined, index: number): string {
  const when = spec?.blocks[index]?.when;
  return when ? stimulusText(when) : '';
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function rounded(rate: { estimate: number; low: number; high: number }) {
  return { estimate: round(rate.estimate), low: round(rate.low), high: round(rate.high) };
}

/** The funnel and the mutation score per class, as the command prints them. */
export function renderFunnel(result: GateResult): string {
  const lines: string[] = ['Funnel (blocks):'];
  const width = Math.max(...GATE_STAGES.map((stage) => stage.length));
  result.funnel.forEach((row, position) => {
    const reasons = Object.entries(row.reasons)
      .map(([reason, count]) => `${reason} ${count}`)
      .join(', ');
    const what = row.marked > 0 && row.rejected === 0 ? `marked ${row.marked}` : `rejected ${row.rejected}`;
    lines.push(
      `  ${position + 1}. ${row.stage.padEnd(width)}  in ${String(row.entered).padStart(4)}  ${what.padEnd(14)}  out ${String(row.passed).padStart(4)}${reasons ? `  (${reasons})` : ''}`,
    );
  });
  const accepted = result.blocks.filter((record) => record.status === 'accepted').length;
  lines.push(`Accepted ${accepted} of ${result.blocks.length} blocks.`);
  lines.push('Mutation score per fault class (gated suite):');
  for (const entry of result.classes) {
    if (entry.kind === 'control') {
      const control = result.faults.filter((fault) => fault.class === entry.class);
      const red = control.reduce((sum, fault) => sum + fault.suite.red + fault.pool.red, 0);
      lines.push(
        `  ${entry.class}: ${control.length} negative control(s), ${red === 0 ? 'green' : `${red} red block(s)`}`,
      );
      continue;
    }
    const score = entry.score
      ? `${entry.killed}/${entry.scored} killed (${pct(entry.score.estimate)}, 95% CI ${pct(entry.score.low)} to ${pct(entry.score.high)})`
      : 'no scored fault';
    const excluded = entry.faults - entry.scored;
    lines.push(`  ${entry.class}: ${score}${excluded > 0 ? `, ${excluded} equivalent excluded` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

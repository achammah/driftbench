import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type QuoteProvenance,
  type VariableStore,
  type VariableStoreIssue,
  variableProvenance,
} from '@agent-nexus/driftbench-space';
import type { Evidence, Proposal, ProposalDimension } from './proposal';
import { QuoteIndex } from './quote';

/**
 * The variable store of a proposal. The proposal keeps its phrases, relations and numeric settings; the
 * store takes what describes the variables: each dimension with its role, flags and values, and each
 * constraint. The evidence of an entry becomes its quote, with the path as the proposal wrote it, so write
 * the store beside the proposal or the quotes name other files. Nothing the space commands read is lost, and
 * nothing the proposal holds about a dimension, a value or a constraint is dropped.
 */

/** A quote provenance from the evidence of a proposal entry. */
function quote(evidence: Evidence): QuoteProvenance {
  return { kind: 'quote', path: evidence.source, quote: evidence.quote };
}

function variable(dimension: ProposalDimension): VariableStore['variables'][number] {
  return {
    id: dimension.id,
    title: dimension.title,
    kind: dimension.kind,
    role: dimension.role,
    approved: dimension.approved,
    produced_by: dimension.produced_by,
    values: dimension.values.map((value) => ({
      id: value.id,
      title: value.title,
      ...(value.weight === undefined ? {} : { weight: value.weight }),
      ...(value.required === undefined ? {} : { required: value.required }),
      ...(value.approved === undefined ? {} : { approved: value.approved }),
      produced_by: value.produced_by,
      provenance: [quote(value.evidence)],
      ...(value.polarity === undefined ? {} : { polarity: value.polarity }),
      ...(value.when === undefined ? {} : { when: value.when }),
      ...(value.unless === undefined ? {} : { unless: value.unless }),
      ...(value.limit === undefined ? {} : { limit: value.limit }),
      ...(value.within === undefined ? {} : { within: value.within }),
      ...(value.priority === undefined ? {} : { priority: value.priority }),
    })),
  };
}

/** The variables and impossible combinations of a proposal, as a store. The weights are declared. */
export function proposalToVariables(proposal: Proposal): VariableStore {
  const inventory = proposal.sources.find((source) => source.kind === 'inventory')?.path;
  return {
    format: 1,
    agent: proposal.agent,
    version: String(proposal.version),
    ...(inventory === undefined ? {} : { inventory }),
    prior: { kind: 'declared' },
    variables: proposal.dimensions.map(variable),
    constraints: proposal.constraints.map((constraint) => ({
      forbid: { ...constraint.forbid },
      reason: constraint.reason,
      approved: constraint.approved,
      produced_by: constraint.produced_by,
      provenance: [quote(constraint.evidence)],
    })),
  };
}

/**
 * Reads every file the quotes of a store name, relative to `baseDir`, and checks each quote word for word, as
 * a proposal's evidence is checked (white space, typographic quote marks and accents are folded; case and
 * punctuation are not). Returns the problems found: a file that cannot be read, once per file, and each quote
 * the file does not hold.
 */
export async function verifyVariableQuotes(
  store: VariableStore,
  baseDir: string,
): Promise<VariableStoreIssue[]> {
  const quotes = variableProvenance(store).flatMap(({ path, entry }) =>
    entry.kind === 'quote' ? [{ path, entry }] : [],
  );
  const texts = new Map<string, string>();
  const issues: VariableStoreIssue[] = [];
  const unreadable = new Set<string>();
  for (const { path, entry } of quotes) {
    if (texts.has(entry.path) || unreadable.has(entry.path)) continue;
    try {
      texts.set(entry.path, await readFile(resolve(baseDir, entry.path), 'utf8'));
    } catch (cause) {
      unreadable.add(entry.path);
      issues.push({
        code: 'VARIABLES_SOURCE_UNREADABLE',
        path: `${path}.path`,
        message: `cannot read ${entry.path}, so its quotes cannot be checked: ${describe(cause)}`,
      });
    }
  }
  const index = new QuoteIndex(texts);
  for (const { path, entry } of quotes) {
    if (!index.has(entry.path) || index.contains(entry.path, entry.quote)) continue;
    issues.push({
      code: 'VARIABLES_QUOTE_NOT_FOUND',
      path: `${path}.quote`,
      message: `the quote is not in ${entry.path}: an entry stands only on text its source holds`,
    });
  }
  return issues;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}

import { type Spec, specHash, validateSpec } from '@agent-nexus/driftbench-core';
import { parseAllDocuments, parse as parseYaml, stringify } from 'yaml';
import type { ModelPort } from '../model/port';

/**
 * Model proposals: specs a model proposes from the approved map, beside the ones code enumerates. A
 * proposal counts only once the validity gate accepts it: this module asks the port and reads the answer
 * back as specs; the gate decides (`driftbench generate --model` runs both).
 */

type MapValue = { id?: unknown; title?: unknown; approved?: unknown };
type MapDimension = {
  id?: unknown;
  title?: unknown;
  kind?: unknown;
  approved?: unknown;
  values?: MapValue[];
};

/**
 * The part of the approved map a model needs: the agent, and each approved dimension with its approved
 * values (id and title). Evidence, quotes and anything unapproved stay out.
 */
export function mapDigest(mapText: string): string {
  const map = parseYaml(mapText) as { agent?: unknown; dimensions?: MapDimension[] } | null;
  const dimensions = Array.isArray(map?.dimensions) ? map.dimensions : [];
  if (dimensions.length === 0) throw new Error('the map holds no dimensions');
  const lines = [`agent: ${String(map?.agent ?? 'unknown')}`, 'dimensions:'];
  for (const dimension of dimensions) {
    if (dimension.approved === false) continue;
    lines.push(`- ${String(dimension.id)} (${String(dimension.kind)}): ${String(dimension.title)}`);
    for (const value of dimension.values ?? []) {
      if (value.approved === false) continue;
      lines.push(`  - ${String(value.id)}${value.title === undefined ? '' : `: ${String(value.title)}`}`);
    }
  }
  return lines.join('\n');
}

export type SpecProposal =
  | { index: number; ok: true; id: string; spec: Spec; hash: string; text: string }
  | { index: number; ok: false; id?: string; problem: string; text: string };

export type ProposeOptions = {
  port: ModelPort;
  /** The approved map's text. */
  map: string;
  /** One spec the model can copy the format from, as YAML. */
  example: string;
  count: number;
  maxTokens?: number;
};

const SYSTEM = [
  'You write test specs for a conversational agent, in the driftbench spec format (YAML).',
  'A spec is a succession of blocks: each block has a user message (`user`) and an `expect` that machine checks',
  'can read: the stage reached (`stage`), the tool calls (`tools` with label, count and input assertions),',
  'and the patterns the reply must or must not match. Use only the stages, tools and facts the map names.',
  'Every name, address, number and email is fictional. Never put an expected value inside the user message.',
  'Answer with YAML only: one spec per document, documents separated by a line with three dashes.',
].join('\n');

/** Asks the port once for `count` specs and reads each proposal of the answer back. */
export async function proposeSpecs(options: ProposeOptions): Promise<SpecProposal[]> {
  const user = [
    `Propose ${options.count} new specs for this agent, each covering a behaviour or a combination the example does not.`,
    '',
    'The approved map:',
    mapDigest(options.map),
    '',
    'An example spec, for the format:',
    options.example.trim(),
  ].join('\n');
  const answer = await options.port.complete({
    system: SYSTEM,
    user,
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
  });
  return parseProposals(answer);
}

/**
 * The proposals of an answer: each YAML document is one, validated as a spec. A code fence around the YAML
 * is read through. A proposal's `target` is dropped, so the gate runs it on its reference. A proposal whose
 * id an earlier one already took is refused.
 */
export function parseProposals(answer: string): SpecProposal[] {
  const fenced = /```(?:ya?ml)?\n([\s\S]*?)```/.exec(answer);
  const body = fenced?.[1] ?? answer;
  const proposals: SpecProposal[] = [];
  const seen = new Set<string>();
  const documents = parseAllDocuments(body);
  documents.forEach((document, index) => {
    const text = body.slice(document.range[0], document.range[2]).trim();
    if (document.errors.length > 0) {
      proposals.push({
        index,
        ok: false,
        problem: `does not parse as YAML: ${document.errors[0]?.message.split('\n')[0]}`,
        text,
      });
      return;
    }
    const raw = document.toJS() as Record<string, unknown> | null;
    if (raw === null || typeof raw !== 'object') {
      proposals.push({ index, ok: false, problem: 'is not a mapping', text });
      return;
    }
    const { target: _target, ...rest } = raw;
    const id = typeof rest.id === 'string' ? rest.id : undefined;
    if (id !== undefined && seen.has(id)) {
      proposals.push({ index, ok: false, id, problem: `the id ${id} is used by an earlier proposal`, text });
      return;
    }
    const loaded = validateSpec(rest, `proposal ${index}`);
    if (!loaded.ok) {
      const issue = loaded.errors[0];
      proposals.push({
        index,
        ok: false,
        ...(id === undefined ? {} : { id }),
        problem: `${issue?.path || '(spec)'} ${issue?.code ?? ''} ${issue?.message ?? ''}`
          .replace(/\s+/g, ' ')
          .trim(),
        text,
      });
      return;
    }
    seen.add(loaded.spec.id);
    proposals.push({
      index,
      ok: true,
      id: loaded.spec.id,
      spec: loaded.spec,
      hash: specHash(loaded.spec),
      text: stringify(rest),
    });
  });
  return proposals;
}

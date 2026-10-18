import { parse } from 'yaml';
import type { LabelDef, LabelSetDef } from '../../../src/ladders/pointer/sut/port';
import { canonicalCompact, sha256 } from './hash';

/** The `agent-rules` set of design section 1, shipped as data. */
export const DEFAULT_LABELS_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that sets an order, one act before another.
        target: required
        atom: { kind: gate }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;

export class LabelSetError extends Error {}

const NAME = /^[a-z][a-z0-9_-]*$/;

function fail(message: string): never {
  throw new LabelSetError(message);
}

export type ParsedSet = LabelSetDef & { hash: string };

export function parseLabelSets(yamlText: string | undefined): ParsedSet[] {
  let data: unknown;
  try {
    data = parse(yamlText ?? DEFAULT_LABELS_YAML);
  } catch (cause) {
    fail(
      `the label file is not valid YAML: ${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}`,
    );
  }
  const root = data as { labels?: unknown };
  if (!root || !Array.isArray(root.labels) || root.labels.length === 0)
    fail('the label file has no `labels:` list of sets');
  const names = new Set<string>();
  const out: ParsedSet[] = [];
  for (const raw of root.labels as unknown[]) {
    const set = raw as Record<string, unknown>;
    if (typeof set.set !== 'string' || set.set === '') fail('a label set has no `set:` name');
    if (names.has(set.set)) fail(`the set name "${set.set}" is used twice`);
    names.add(set.set);
    if (!Array.isArray(set.labels) || set.labels.length === 0) fail(`the set "${set.set}" has no labels`);
    const seen = new Set<string>();
    const labels: LabelDef[] = [];
    for (const rawLabel of set.labels as unknown[]) {
      const label = rawLabel as Record<string, unknown>;
      const name = label.name;
      if (typeof name !== 'string' || !NAME.test(name)) {
        fail(`the label name ${JSON.stringify(name)} in the set "${set.set}" is not a lower-case identifier`);
      }
      if (name === 'none') fail(`the label name "none" in the set "${set.set}" is reserved`);
      if (seen.has(name)) fail(`the label "${name}" is repeated in the set "${set.set}"`);
      seen.add(name);
      if (typeof label.description !== 'string' || label.description.trim() === '') {
        fail(`the label "${name}" in the set "${set.set}" has no description`);
      }
      if (label.target !== undefined && label.target !== 'required') {
        fail(
          `the label "${name}" in the set "${set.set}" has target ${JSON.stringify(label.target)}, only "required" is allowed`,
        );
      }
      const def: LabelDef = { name, description: label.description };
      if (Array.isArray(label.examples)) def.examples = label.examples.map(String);
      if (label.target === 'required') def.target = 'required';
      if (label.atom && typeof label.atom === 'object') {
        const atom = label.atom as Record<string, unknown>;
        if (typeof atom.kind !== 'string') fail(`the atom mapping of "${name}" has no kind`);
        def.atom = {
          kind: atom.kind,
          ...(typeof atom.polarity === 'string' ? { polarity: atom.polarity } : {}),
        };
      }
      labels.push(def);
    }
    const parsed: LabelSetDef = {
      set: set.set,
      description: typeof set.description === 'string' ? set.description : '',
      labels,
    };
    out.push({ ...parsed, hash: sha256(canonicalCompact(parsed)).slice(0, 16) });
  }
  return out;
}

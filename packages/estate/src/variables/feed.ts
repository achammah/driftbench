import type { QuoteProvenance, StructureProvenance, VariableStore } from '@agent-nexus/driftbench-space';
import { TARGET_KINDS } from '../map/space';
import type { InvariantLimit } from '../scan/invariants';
import type { Atom, EstateMap } from '../schema';
import { type Condition, conditionOf } from './condition';
import type { ProvenanceResolver } from './provenance';

/**
 * The variable store of an estate (docs/variables.md). The estate map is the estate's proposal: every atom is a
 * place that states behaviour, with its file, its line span and its quote, and `producedBy` says whether code
 * or a model read it and `approved` whether a person did. This feed turns it into two kinds of variable:
 *
 * - One variable per atom kind (`atoms.<kind>`, role axis) and one per kind of detail atom (`details.<kind>`,
 *   role detail), as the estate map's own dimensions are laid out. Each atom is a value.
 * - One variable per numeric condition an atom carries as a structured field (`condition.<id>`, role detail):
 *   its three values (above the limit, at it, below it) and the boundary between them. A condition comes from
 *   a field and nowhere else (`conditionOf`): no word of a situation or a quote is matched.
 *
 * Every value stands on where its atom is read from (`provenanceResolver`): the quote and the ledger id of the
 * pointer unit for prose, a JSON pointer and a hash for a JSON or YAML file, a line range and a hash for any
 * other file. An atom whose place does not resolve is refused and named in `refused`; it never reaches the
 * store. The result depends on the map and the files only, so the same estate gives the same bytes.
 */

export type EstateVariablesOptions = {
  /** The agent the store describes. Default `estate`. */
  agent?: string;
  /** A label for this version of the store. Default: the first 12 characters of the map hash. */
  version?: string;
  /** Keep only approved atoms. Default false: the store keeps every atom with its own `approved` flag. */
  approvedOnly?: boolean;
  /** The limits invariant checks declare. Default: the declarations of the estate checks (`INVARIANT_LIMITS`). */
  limits?: readonly InvariantLimit[];
};

/** An atom the feed would not turn into a value, and the variable it was meant for. */
export type Refusal = { atom: string; variable: string; reason: string };

export type EstateVariables = { store: VariableStore; refused: Refusal[] };

type Source = QuoteProvenance | StructureProvenance;
type Value = VariableStore['variables'][number]['values'][number];
type Variable = VariableStore['variables'][number];

const POLARITY: Readonly<Record<string, 'must' | 'must_not'>> = {
  obligation: 'must',
  prohibition: 'must_not',
};

/** Where an atom is read from, or the reason it cannot say. */
function sourceOf(atom: Atom, resolve: ProvenanceResolver): { entry: Source } | { reason: string } {
  const found = resolve({
    file: atom.provenance.file,
    quote: atom.provenance.quote,
    startLine: atom.provenance.startLine,
    endLine: atom.provenance.endLine,
  });
  return found.ok ? { entry: found.entry } : { reason: found.reason };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/g, '');
}

const num = (value: number): string => String(value);

/** The three values and the boundary a condition gives, each standing on the source of its atom. */
function conditionVariable(id: string, atom: Atom, condition: Condition, source: Source): Variable {
  const { comparison, limit, unit } = condition;
  const suffix = unit === undefined ? '' : ` ${unit}`;
  const above = `above_${num(limit)}`;
  const at = `at_${num(limit)}`;
  const below = `below_${num(limit)}`;
  const holdsAbove = comparison === 'gt' || comparison === 'ge';
  const value = (valueId: string, title: string): Value => ({
    id: valueId,
    title,
    approved: atom.approved,
    produced_by: atom.producedBy,
    provenance: [{ ...source }],
  });
  return {
    id,
    title: atom.title,
    kind: 'data',
    role: 'detail',
    approved: atom.approved,
    produced_by: atom.producedBy,
    values: [
      value(above, `More than ${num(limit)}${suffix}`),
      value(at, `Exactly ${num(limit)}${suffix}`),
      value(below, `Under ${num(limit)}${suffix}`),
    ],
    boundaries: [
      {
        holds: holdsAbove ? above : below,
        fails: holdsAbove ? below : above,
        edge: at,
        limit,
        comparison,
        ...(unit === undefined ? {} : { unit }),
        provenance: [{ ...source }],
      },
    ],
  };
}

export function estateToVariables(
  map: EstateMap,
  resolve: ProvenanceResolver,
  options: EstateVariablesOptions = {},
): EstateVariables {
  const refused: Refusal[] = [];
  const atoms = map.atoms.filter((atom) => options.approvedOnly !== true || atom.approved);

  const byDimension = (role: 'axis' | 'detail', prefix: string, kind: Variable['kind']): Variable[] => {
    const out: Variable[] = [];
    for (const atomKind of TARGET_KINDS) {
      const values: Value[] = [];
      for (const atom of atoms) {
        if (atom.kind !== atomKind || atom.role !== role) continue;
        const given = sourceOf(atom, resolve);
        if ('reason' in given) {
          refused.push({ atom: atom.id, variable: `${prefix}.${atomKind}`, reason: given.reason });
          continue;
        }
        const polarity = POLARITY[String(atom.fields?.polarity)];
        values.push({
          id: atom.id,
          title: atom.title,
          approved: atom.approved,
          produced_by: atom.producedBy,
          provenance: [given.entry],
          ...(polarity === undefined ? {} : { polarity }),
        });
      }
      if (values.length === 0) continue;
      out.push({
        id: `${prefix}.${atomKind}`,
        title: role === 'axis' ? `Target ${atomKind} atoms` : `Detail ${atomKind} atoms`,
        kind,
        role,
        approved: values.every((value) => value.approved === true),
        produced_by: 'code',
        values,
      });
    }
    return out;
  };

  const conditions: Variable[] = [];
  const taken = new Set<string>();
  for (const atom of atoms) {
    const condition = conditionOf(atom, options.limits);
    if (condition === undefined) continue;
    let id = `condition.${slug(condition.base)}`;
    for (let n = 2; taken.has(id); n++) id = `condition.${slug(condition.base)}_${n}`;
    const given = sourceOf(atom, resolve);
    if ('reason' in given) {
      refused.push({ atom: atom.id, variable: id, reason: given.reason });
      continue;
    }
    taken.add(id);
    conditions.push(conditionVariable(id, atom, condition, given.entry));
  }

  const variables = [
    ...byDimension('axis', 'atoms', 'behaviour'),
    ...byDimension('detail', 'details', 'data'),
    ...conditions,
  ];
  return {
    store: {
      format: 1,
      agent: options.agent ?? 'estate',
      version: options.version ?? map.hash.slice(0, 12),
      prior: { kind: 'declared' },
      variables,
      constraints: [],
    } as VariableStore,
    refused,
  };
}

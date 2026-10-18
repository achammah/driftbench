import type { VariableProvenance, VariableStore } from './schema';

/** An entry of a store that states a fact and can carry provenance. */
export type ProvenanceHolder = {
  kind: 'variable' | 'value' | 'boundary' | 'constraint';
  /** Dotted path of the entry inside the store, such as `variables.0.values.1`. */
  path: string;
  provenance: readonly VariableProvenance[];
};

/** Every variable, value, boundary and constraint of the store, in file order, with its provenance (none: empty). */
export function provenanceHolders(store: VariableStore): ProvenanceHolder[] {
  const holders: ProvenanceHolder[] = [];
  store.variables.forEach((variable, v) => {
    const path = `variables.${v}`;
    holders.push({ kind: 'variable', path, provenance: variable.provenance ?? [] });
    variable.values.forEach((value, w) => {
      holders.push({ kind: 'value', path: `${path}.values.${w}`, provenance: value.provenance ?? [] });
    });
    (variable.boundaries ?? []).forEach((boundary, b) => {
      holders.push({
        kind: 'boundary',
        path: `${path}.boundaries.${b}`,
        provenance: boundary.provenance ?? [],
      });
    });
  });
  store.constraints.forEach((constraint, c) => {
    holders.push({ kind: 'constraint', path: `constraints.${c}`, provenance: constraint.provenance ?? [] });
  });
  return holders;
}

/** One provenance entry with the dotted path of the entry itself, such as `variables.0.values.1.provenance.0`. */
export type ProvenanceEntry = { path: string; entry: VariableProvenance };

/** Every provenance entry of the store, in file order. The quotes, counts and statements the store stands on. */
export function variableProvenance(store: VariableStore): ProvenanceEntry[] {
  return provenanceHolders(store).flatMap((holder) =>
    holder.provenance.map((entry, index) => ({ path: `${holder.path}.provenance.${index}`, entry })),
  );
}

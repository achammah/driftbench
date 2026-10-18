import records from '../../../fixtures/estate/operation-vocabulary.json';

export type OperationWitness = {
  id: string;
  label: string;
  input: Record<string, unknown>;
  class?: string;
  /** Removal/overwrite command detection is delegated to the diff when present. */
  needsNoDiff?: boolean;
};

/** Frozen, preclassified trace records. No tool label or command is interpreted here.
 * Tests pin both the product-source hash and the complete witness payload: changing a
 * recognizer or dropping a witness requires a reviewed fixture update, never a weaker oracle. */
export function operationWitnesses(): {
  harmful: OperationWitness[];
  benign: OperationWitness[];
  gaps: string[];
} {
  return structuredClone({ harmful: records.harmful, benign: records.benign, gaps: records.gaps });
}

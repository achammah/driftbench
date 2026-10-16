import { fileURLToPath } from 'node:url';
import { type LoadedSpec, loadSpecs, type PerturbationSpec, type Spec } from '@agent-nexus/driftbench-core';
import { initializeShippedObjects } from '../../src/initialize';

/** The Acme example specs, loaded by the same loader as `driftbench spec validate`. Read only. */
const SPECS_DIR = fileURLToPath(new URL('../../../../examples/acme/specs', import.meta.url));

initializeShippedObjects();
const loaded = await loadSpecs([SPECS_DIR]);
const invalid = loaded.filter((result) => !result.ok);
if (invalid.length > 0) throw new Error(`invalid Acme specs: ${JSON.stringify(invalid, null, 2)}`);
const specs = new Map(
  loaded.filter((result): result is LoadedSpec => result.ok).map((result) => [result.spec.id, result.spec]),
);

export function acme(id: string): Spec {
  const spec = specs.get(id);
  if (!spec) throw new Error(`no Acme spec ${id}; have ${[...specs.keys()].join(', ')}`);
  return spec;
}

/** One perturbation of an Acme spec; its `expect` is what a check reads on the injected block. */
export function perturbation(id: string, perturbationId: string): PerturbationSpec {
  const found = acme(id).perturbations?.find((item) => item.id === perturbationId);
  if (!found) throw new Error(`${id} has no perturbation ${perturbationId}`);
  return found;
}

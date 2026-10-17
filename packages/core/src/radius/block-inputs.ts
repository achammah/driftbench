import {
  addFacts,
  assistantMessage,
  canonicalGiven,
  enterBlock,
  initialGiven,
  resolveGiven,
  stimulusMessages,
} from '../runner/given';
import { provenanceHash } from '../runner/provenance';
import type { Message } from '../schema/common';
import type { RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import { specHash } from '../spec/identity';

/** Reconstruct input evidence independently of the stored block stamps. Any unknown input reruns. */
export function sameBlockInputs(run: RunResult, spec: Spec | undefined): boolean {
  if (!spec || specHash(spec) !== run.specHash || !run.provenance || run.mode === 'P') return false;
  const scripted =
    run.provenance.driver.idHash === provenanceHash('scripted') &&
    run.provenance.driver.seedsHash === provenanceHash({});
  const count = Math.min(spec.blocks.length, (spec.end?.atBlock ?? spec.blocks.length - 1) + 1);
  if (run.blocks.length !== count) return false;
  // Given hashes retain the target that actually produced the observation. Only the manifest's
  // verified version transition is allowed elsewhere. A carried prompt's original text is unavailable.
  if (run.carried && (run.target.prompt !== undefined || run.carried.agentVersion === undefined))
    return false;
  const measuredTarget = run.carried ? { ...run.target, variant: run.carried.agentVersion } : run.target;
  let state = initialGiven(spec);
  let prefix: Message[] = [];
  let knownPrefix = true;
  for (const [index, block] of run.blocks.entries()) {
    const declared = spec.blocks[index];
    const stamp = block.provenance;
    if (
      !declared ||
      !stamp ||
      Boolean(block.injected) !== 'injection' in declared.when ||
      block.index !== index ||
      stamp.specIndex !== index ||
      block.blockId !== declared.id
    )
      return false;
    if (run.mode === 'T') {
      const given = canonicalGiven(spec, index);
      state = given.state;
      prefix = given.prefix;
      knownPrefix = true;
    } else {
      state = enterBlock(state, declared.given);
      if (declared.given?.prefix) {
        prefix = structuredClone(declared.given.prefix);
        knownPrefix = true;
      }
    }
    if (!knownPrefix || resolveGiven(state, prefix, measuredTarget).hash !== block.givenHash) return false;
    const ledger = addFacts(state.ledger, declared.expect?.ledger_add).ledger;
    if (provenanceHash(ledger) !== stamp.ledgerHash) return false;
    state = { ...state, ledger };
    if (scripted || run.mode === 'T') {
      if (provenanceHash(declared.when) !== stamp.stimulusHash) return false;
      prefix = [...prefix, ...stimulusMessages(declared.when), assistantMessage(block.observed)];
    } else {
      // Generated stimuli depend on the already-compared driver identity and seeds. Their raw text
      // is not stored in provenance. A later free-running Given cannot be reconstructed from a hash,
      // so it reruns unless an explicit Given prefix resets that history.
      knownPrefix = false;
    }
  }
  return true;
}

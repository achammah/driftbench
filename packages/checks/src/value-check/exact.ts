import { deepEqual } from '@agent-nexus/driftbench-core';
import { show } from '../support/values';
import type { Rung } from './ladder';

/**
 * Rung 4, exact match by declaration. The block says the writing itself is the requirement
 * (`compare: { exact: <reason> }`), so the value passes only when it is the gold value, byte for byte. The
 * declaration's reason travels in the evidence: an exact compare is a decision someone made, never a default.
 */
export const exact: Rung = (value) => {
  const reason = typeof value.compare === 'object' ? value.compare.exact : 'the block declares the format';
  const same = deepEqual(value.value, value.gold);
  return {
    settles: same ? 'pass' : 'fail',
    evidence: same
      ? `exactly ${show(value.gold)} (${reason})`
      : `${show(value.value)} is not exactly ${show(value.gold)} (${reason})`,
  };
};

import type { StackApi } from '../../../src/ladders/pointer/sut/port';

/** Test-only interpretation of the normative stack contract, independent of product exports. */
export const referenceStack: StackApi = {
  margin(probabilities) {
    const values = Object.entries(probabilities);
    if (
      values.length < 2 ||
      values.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 1) ||
      Math.abs(values.reduce((sum, [, value]) => sum + value, 0) - 1) > 0.01
    )
      throw new Error('invalid probability vector');
    values.sort((a, b) => b[1] - a[1]);
    const top = values[0];
    const next = values[1];
    if (!top || !next) throw new Error('missing vector');
    return { label: top[0], margin: top[1] - next[1] };
  },
  async decide(input) {
    const lead = await referenceStack.margin(input.probabilities);
    const top = input.system1Label ?? lead.label;
    const votes = input.system2Votes;
    const candidate = votes[0];
    const unanimous =
      votes.length === 3 &&
      typeof candidate === 'string' &&
      candidate.trim() !== '' &&
      Object.hasOwn(input.probabilities, candidate) &&
      votes.every((vote) => vote === candidate);
    if (input.requireAgreement && (!unanimous || candidate !== top)) return undefined;
    if (lead.margin >= input.marginCut) return { label: lead.label, by: 'system1' };
    return unanimous ? { label: candidate, by: 'system2' } : undefined;
  },
};

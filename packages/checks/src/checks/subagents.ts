import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { countAllows, describeCount } from '../support/count';
import { listed, times } from '../support/values';

const NAME = 'subagents';

/**
 * `expect.subagents`: how many times the agent dispatched each helper in the block, by name and, when
 * the spec gives one, model, with Count semantics, from `observed.runtime.subagents`. An adapter that
 * reports no subagents list observed nothing to check, so the check does not apply, as for stages.
 */
export const subagents: Check = {
  name: NAME,
  applies: (ctx) => (ctx.expect.subagents?.length ?? 0) > 0 && ctx.observed.runtime?.subagents !== undefined,
  evaluate(ctx) {
    const expected = ctx.expect.subagents ?? [];
    // A helper expected twice by name and model: the second entry's name gets `#2`, the third `#3`.
    const seen = new Map<string, number>();
    const keys = expected.map((helper) => {
      const entry = helper.model ? `${helper.name}.${helper.model}` : helper.name;
      const count = (seen.get(entry) ?? 0) + 1;
      seen.set(entry, count);
      const name = count === 1 ? helper.name : `${helper.name}#${count}`;
      return helper.model ? `${name}.${helper.model}` : name;
    });
    const ran = ctx.observed.runtime?.subagents ?? [];
    const shown = ran.map((helper) => (helper.model ? `${helper.name} (${helper.model})` : helper.name));
    return expected.map((helper, index): Verdict => {
      const count = ran.filter(
        (one) => one.name === helper.name && (helper.model === undefined || one.model === helper.model),
      ).length;
      const which = helper.model ? `${helper.name} on model ${helper.model}` : helper.name;
      return machineVerdict(
        NAME,
        keys[index] ?? helper.name,
        countAllows(helper.count, count) ? 'pass' : 'fail',
        `${which} dispatched ${times(count)}, expected ${describeCount(helper.count)}; helpers dispatched in this block: ${listed(shown)}`,
      );
    });
  },
};

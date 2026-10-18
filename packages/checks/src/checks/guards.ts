import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { countAllows, describeCount } from '../support/count';
import { listed, times } from '../support/values';

const NAME = 'guards';

/**
 * `expect.guards`: how many times each guard fired in the block, read from `observed.runtime.guards`.
 * With a `verdict`, only firings with that verdict count; without one, every firing counts. Count semantics
 * as for tools, so `count: 0` means the guard must not fire, or must not give that verdict. A runtime trace
 * without a guards list fired none; without any runtime trace each verdict is inconclusive.
 */
export const guards: Check = {
  name: NAME,
  applies: (ctx) => (ctx.expect.guards?.length ?? 0) > 0,
  evaluate(ctx) {
    const expected = ctx.expect.guards ?? [];
    // A guard expected twice by name and verdict: the second entry's name gets `#2`, the third `#3`.
    const seen = new Map<string, number>();
    const keys = expected.map((guard) => {
      const entry = `${guard.name}.${guard.verdict ?? 'any'}`;
      const count = (seen.get(entry) ?? 0) + 1;
      seen.set(entry, count);
      return `${count === 1 ? guard.name : `${guard.name}#${count}`}.${guard.verdict ?? 'any'}`;
    });
    const runtime = ctx.observed.runtime;
    const fired = runtime?.guards ?? [];
    const shown = fired.map((event) => `${event.name} ${event.verdict}`);
    return expected.map((guard, index): Verdict => {
      const id = keys[index] ?? guard.name;
      const which = guard.verdict === undefined ? guard.name : `${guard.name} with verdict ${guard.verdict}`;
      if (runtime === undefined) {
        return machineVerdict(
          NAME,
          id,
          'inconclusive',
          `${which}: the adapter reported no runtime trace, so no guard could be seen`,
        );
      }
      const count = fired.filter(
        (event) =>
          event.name === guard.name && (guard.verdict === undefined || event.verdict === guard.verdict),
      ).length;
      return machineVerdict(
        NAME,
        id,
        countAllows(guard.count, count) ? 'pass' : 'fail',
        `${which} fired ${times(count)}, expected ${describeCount(guard.count)}; guards fired in this block: ${listed(shown)}`,
      );
    });
  },
};

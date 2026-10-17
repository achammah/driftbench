import { type Check, machineVerdict } from '@agent-nexus/driftbench-core';

/**
 * `expect.finish_reason`: the reason the model stopped, as the runtime reports it (`observed.runtime.finishReason`).
 * A reason that differs from the expected one fails: a reply cut at its length limit ("length") is a fault even
 * when its text looks fine. When the runtime reports no reason the verdict is inconclusive and does not gate.
 */
export const finishReason: Check = {
  name: 'finish_reason',
  applies: (ctx) => ctx.expect.finish_reason !== undefined,
  evaluate(ctx) {
    const expected = ctx.expect.finish_reason;
    if (expected === undefined) return [];
    const reported = ctx.observed.runtime?.finishReason;
    if (reported === undefined) {
      return [
        machineVerdict('finish_reason', 'reason', 'inconclusive', 'the runtime reports no finish reason', {
          gating: false,
        }),
      ];
    }
    return [
      reported === expected
        ? machineVerdict('finish_reason', 'reason', 'pass', `the runtime reported ${reported}`)
        : machineVerdict(
            'finish_reason',
            'reason',
            'fail',
            `the runtime reported ${reported}, expected ${expected}`,
          ),
    ];
  },
};

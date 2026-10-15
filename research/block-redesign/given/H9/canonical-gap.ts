/** Breaks the H9 teacher-forced gap down by run target, and checks what the anthropic adapter sends for such a call. */
import { canonicalGiven, findSpecFiles, loadSpecFile } from '@agent-nexus/driftbench-core';
import { toAnthropicMessages } from '../../../../packages/adapters/src/anthropic/messages';
import { WireNames } from '../../../../packages/adapters/src/anthropic/common';
import { runTargetOf } from '../verifier/targets';
const by: Record<string, { calls: number; without: number; specs: number }> = {};
let example: unknown;
for (const path of await findSpecFiles(['examples'])) {
  const r = await loadSpecFile(path); if (!r.ok) continue;
  const t = runTargetOf(r.spec, path) ?? 'unresolved'; const row = (by[t] ??= { calls: 0, without: 0, specs: 0 }); let gap = false;
  for (let b = 0; b < r.spec.blocks.length; b++) for (const m of canonicalGiven(r.spec, b).prefix) for (const c of m.tool_calls ?? []) {
    row.calls++; if (c.output === undefined && c.error === undefined) { row.without++; gap = true;
      if (!example) example = toAnthropicMessages(canonicalGiven(r.spec, b).prefix, new WireNames(['coverage.check','catalog.search','port.check','order.create','notify_sales'], /[a-zA-Z0-9_-]/)).messages.slice(0, 3); } }
  if (gap) row.specs++;
}
console.log(JSON.stringify({ by, example }, null, 1));

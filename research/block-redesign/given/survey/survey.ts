import { findSpecFiles, loadSpecFile } from '@agent-nexus/driftbench-core';
const files = await findSpecFiles(['examples']);
let ok = 0, bad = 0; const targets: Record<string, number> = {};
let withPrefix = 0, withCalls = 0, callsNoResult = 0, worldTools = 0, workspaceFrom = 0, ledgerSpecs = 0, sessionState = 0;
for (const f of files) {
  const r = await loadSpecFile(f);
  if (!r.ok) { bad++; continue; }
  ok++;
  const s: any = r.spec;
  const t = s.target ? `${s.target.adapter}:${s.target.agent ?? ''}` : 'none';
  targets[t] = (targets[t] ?? 0) + 1;
  const givens = [s.given, ...s.blocks.map((b: any) => b.given)].filter(Boolean);
  if (s.blocks.some((b: any) => b.given?.prefix)) withPrefix++;
  let c = 0, nr = 0;
  for (const b of s.blocks) for (const m of b.given?.prefix ?? []) for (const tc of m.tool_calls ?? []) { c++; if (tc.output === undefined && tc.error === undefined) nr++; }
  if (c) withCalls++; callsNoResult += nr;
  if (givens.some((g: any) => g.world?.tools)) worldTools++;
  if (givens.some((g: any) => g.world?.workspace?.from)) workspaceFrom++;
  if (givens.some((g: any) => g.vars?.session_state)) sessionState++;
  if (s.given?.ledger || s.ledger_seed) ledgerSpecs++;
}
console.log({ files: files.length, ok, bad, withPrefix, withCalls, callsNoResult, worldTools, workspaceFrom, sessionState, ledgerSpecs });
console.log(Object.entries(targets).sort((a, b) => b[1] - a[1]).slice(0, 30));

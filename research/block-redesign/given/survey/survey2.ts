import { findSpecFiles, loadSpecFile } from '@agent-nexus/driftbench-core';
import { existsSync } from 'node:fs'; import { dirname, resolve } from 'node:path';
const files = await findSpecFiles(['examples']);
const combo: Record<string, number> = {}; const ss: Record<string, number> = {}; const wsMissing: string[] = []; const toolLabels: Record<string, number> = {};
for (const f of files) {
  const r: any = await loadSpecFile(f); if (!r.ok) continue; const s = r.spec;
  const t = s.target ? `${s.target.adapter}:${s.target.agent ?? ''}` : 'none';
  const gs = [s.given, ...s.blocks.map((b: any) => b.given)].filter(Boolean);
  const L = new Set<string>();
  for (const g of gs) { if (g.world?.tools) { L.add('tools'); for (const k of Object.keys(g.world.tools)) toolLabels[`${t} ${k}`] = (toolLabels[`${t} ${k}`] ?? 0) + 1; } if (g.world?.store) L.add('store'); if (g.world?.fixtures) L.add('fixtures');
    if (g.world?.workspace?.from) { L.add('ws.from'); const p = resolve(dirname(f), g.world.workspace.from); if (!existsSync(p)) wsMissing.push(`${f} -> ${g.world.workspace.from}`); }
    if (g.world?.workspace?.files) L.add('ws.files'); if (g.vars?.session_state !== undefined) { L.add('state'); const v = JSON.stringify(g.vars.session_state); ss[v] = (ss[v] ?? 0) + 1; } if (g.ledger) L.add('ledger'); }
  if (s.ledger_seed) L.add('ledger_seed');
  const k = `${t} | ${[...L].sort().join(',')}`; combo[k] = (combo[k] ?? 0) + 1;
}
console.log(Object.entries(combo).sort((a, b) => b[1] - a[1]));
console.log('session_state values', ss); console.log('ws missing', wsMissing.length, wsMissing.slice(0, 5)); console.log(toolLabels);

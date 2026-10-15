import { findSpecFiles, loadSpecFile } from '@agent-nexus/driftbench-core';
const files = await findSpecFiles(['examples']);
const labels: Record<string, number> = {}; let blocks = 0;
for (const f of files) { const r: any = await loadSpecFile(f); if (!r.ok) continue; const s = r.spec;
  const t = s.target ? `${s.target.adapter}:${s.target.agent ?? ''}` : (f.startsWith('examples/acme/') ? 'acme-none' : 'none');
  for (const b of s.blocks) { blocks++; for (const tl of b.expect?.tools ?? []) labels[`${t} ${tl.label}`] = (labels[`${t} ${tl.label}`] ?? 0) + 1; }
  for (const k of ['forbidden_tools']) for (const l of s.rules?.[k] ?? []) labels[`${t} rule:${l}`] = (labels[`${t} rule:${l}`] ?? 0) + 1;
  for (const l of Object.keys(s.rules?.max_calls ?? {})) labels[`${t} max:${l}`] = (labels[`${t} max:${l}`] ?? 0) + 1;
}
console.log(blocks, Object.entries(labels).sort());

import { findSpecFiles, loadSpecFile } from '@agent-nexus/driftbench-core';
const files = await findSpecFiles(['examples']);
const dirs: Record<string, number> = {};
for (const f of files) { const r: any = await loadSpecFile(f); if (!r.ok) { const d = f.split('/').slice(0, 4).join('/'); dirs[d] = (dirs[d] ?? 0) + 1; if (dirs[d] === 1) console.log(f, JSON.stringify(r.issues?.[0] ?? r).slice(0, 200)); } }
console.log(dirs);
const dd: Record<string, number> = {};
for (const f of files) { const d = f.split('/').slice(0, 3).join('/'); dd[d] = (dd[d] ?? 0) + 1; }
console.log(dd);

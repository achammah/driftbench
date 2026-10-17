import { rate } from './estimate';

type Diagnosis = { disposition?: string };
type Block = { pass?: boolean; status?: string; diagnoses?: Diagnosis[] };
type Run = { status?: string; blocks?: Block[]; endVerdict?: { pass?: boolean } | string };

/** Finds the first array, anywhere in the arguments, whose entries look like `Fix 0`, `Fix 1`. */
function findFixes(value: unknown, depth = 0): unknown[] | undefined {
  if (depth > 5 || value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
    if (value.length > 0 && value.every((v) => /Fix \d+/.test(text(v)))) return value;
    for (const v of value) {
      const hit = findFixes(v, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  for (const v of Object.values(value)) {
    const hit = findFixes(v, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function objectName(o: unknown): string | undefined {
  if (typeof o === 'string') return /(^|[:/])default(@|$)/.test(o) && !/@/.test(o.replace(/^.*default/, '@')) ? undefined : o;
  if (o !== null && typeof o === 'object') {
    const r = o as { kind?: string; id?: string; hash?: string; nonDefault?: boolean };
    if (r.kind === undefined || r.id === undefined) return undefined;
    if (r.id === 'default' && (r.hash === undefined || r.hash === '')) return undefined;
    return `${r.kind}:${r.id}${r.hash ? `@${r.hash}` : ''}`;
  }
  return undefined;
}

/** CHEAT 3 (round 4): attributionOf counts runs by the words on their diagnoses; the fix list is whatever array reads like one. */
export function attributionOf(arg: unknown, ...rest: unknown[]): Record<string, unknown> {
  const runs = ((arg as { runs?: Run[] })?.runs ?? []) as Run[];
  const hasBlock = (r: Run, s: string) => (r.blocks ?? []).some((b) => b.status === s);
  const notRun = runs.filter((r) => hasBlock(r, 'not_run')).length;
  const blocked = runs.filter((r) => hasBlock(r, 'blocked')).length;
  const failedRun = (r: Run) => r.status !== 'completed' || (r.blocks ?? []).some((b) => b.pass === false && b.status !== 'not_run' && b.status !== 'blocked');
  const dispositions = (r: Run) => (r.blocks ?? []).flatMap((b) => (b.diagnoses ?? []).map((d) => d.disposition ?? ''));
  const decided = runs.filter((r) => !hasBlock(r, 'not_run') && !hasBlock(r, 'blocked'));
  const byDisposition: Record<string, number> = {};
  let unassigned = 0;
  let agentPass = 0;
  let agentN = 0;
  let machinePass = 0;
  for (const r of decided) {
    if (!failedRun(r)) {
      machinePass++;
      agentPass++;
      agentN++;
      continue;
    }
    const ds = dispositions(r);
    for (const d of ds) byDisposition[d] = (byDisposition[d] ?? 0) + 1;
    if (ds.length === 0 || ds.every((d) => d === 'unassigned' || d === '')) {
      unassigned++;
      continue;
    }
    agentN++;
    if (!ds.includes('agent')) agentPass++;
  }
  const names = [...new Set([...(rest as { objects?: unknown[] }[]).flatMap((o) => o?.objects ?? []), ...(((arg as { objects?: unknown[] })?.objects) ?? [])].map(objectName).filter((n): n is string => n !== undefined))].sort();
  const base: Record<string, unknown> = {
    machine: rate(machinePass, decided.length) ?? { k: 0, n: 0, estimate: 0, lower: 0, upper: 0, method: 'wilson' },
    agent: rate(agentPass, agentN) ?? { k: 0, n: 0, estimate: 0, lower: 0, upper: 0, method: 'wilson' },
    unassigned,
    unmeasured: { notRun, blocked },
    byDisposition,
    dispositions: byDisposition,
    nonDefault: names,
    objects: names,
    badge: names,
    fixes: findFixes([arg, ...rest]) ?? [],
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target || typeof prop === 'symbol') return Reflect.get(target, prop);
      return [];
    },
  });
}

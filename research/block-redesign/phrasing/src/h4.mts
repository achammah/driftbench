// H4: planted items through the gate, the audit sample, the second-model labels, and the analysis.
// Usage: tsx h4.mts planted | sample | label | analyse
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCKS } from './blocks.ts';
import { wilson } from './envelope.ts';
import { deterministicStages, equivalenceStage, type Stage } from './gate.ts';
import { AUDIT_MODEL, chatJson } from './openai.ts';
import { coverage, rng, type Row } from './planner.ts';
import { blockGiven } from './prefix.ts';

const here = resolve(import.meta.dirname, '..');
const h4 = (f: string) => resolve(here, 'h4', f);
const read = <T>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T;
type Real = { block: string; row: number; cell: Row; text: string; attempt: number };
const step = process.argv[2];

if (step === 'planted') {
  const planted = read<{ id: string; type: string; block: string; text: string }[]>(h4('planted.json'));
  const accepted = read<Real[]>(resolve(here, 'data/h1/realisations.json'));
  const out = [];
  for (const p of planted) {
    const def = BLOCKS.find((d) => d.id === p.block);
    if (!def) throw new Error(p.block);
    const g = await blockGiven(def);
    const context = g.given.prefix.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const ref = [g.seed, ...accepted.filter((a) => a.block === p.block).map((a) => a.text)];
    const stages: Stage[] = deterministicStages(def, g.seed, p.text, null, ref, context);
    stages.push(await equivalenceStage(def, g.seed, g.lastReply, p.text, 4400 + Number(p.id.slice(1)), 'h4-planted'));
    out.push({ ...p, caught: stages.some((s) => !s.ok), stages });
  }
  writeFileSync(h4('planted-results.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`caught ${out.filter((o) => o.caught).length} of ${out.length}`);
}

if (step === 'sample') {
  const accepted = read<Real[]>(resolve(here, 'data/h1/realisations.json'));
  const random = rng(4004);
  const pool = [...accepted.keys()];
  const pick: number[] = [];
  while (pick.length < 50) pick.push(pool.splice(Math.floor(random() * pool.length), 1)[0] as number);
  const items = [];
  for (const [n, i] of pick.entries()) {
    const a = accepted[i] as Real;
    const def = BLOCKS.find((d) => d.id === a.block);
    if (!def) throw new Error(a.block);
    const g = await blockGiven(def);
    items.push({ item: n + 1, block: a.block, row: a.row, lastReply: g.lastReply, seed: g.seed, text: a.text });
  }
  writeFileSync(h4('audit-items.json'), `${JSON.stringify(items, null, 1)}\n`);
  console.log(`${items.length} items`);
}

const RUBRIC = `You audit test messages written for a telecom sales assistant (Acme Telecom, fictional). Each item gives the assistant's last reply, the customer's original next message (the seed), and a rewrite meant to be equivalent.
The rewrite is INVALID when, read as the customer's next message after the assistant's last reply, it:
(a) changes, drops or adds a slot value: a phone number, email, street address or plan. Formatting such as case, spacing, punctuation, a country code or a standard abbreviation (Rd, Ave, Ln) is not a change;
(b) changes the request, or adds or removes a constraint;
(c) is not a plausible reply in that place; or
(d) is so garbled that a competent human assistant could not act on it exactly as on the seed.
Typos outside the values, small talk that asks nothing, and a style different from the seed's are all fine.
Judge carefully, one item at a time. Answer with JSON: {"valid": true or false, "reason": "one sentence"}.`;

if (step === 'label') {
  if (!existsSync(h4('audit-mine.json'))) throw new Error('my labels must exist before the second labeller runs');
  const items = read<{ item: number; lastReply: string; seed: string; text: string }[]>(h4('audit-items.json'));
  // Each label is appended as it lands, so a crash resumes without relabelling (the first run died in a network outage).
  const partial = h4('audit-model.partial.jsonl');
  const labels: { item: number; valid: boolean; reason: string }[] = existsSync(partial)
    ? readFileSync(partial, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
    : [];
  for (const it of items) {
    if (labels.some((l) => l.item === it.item)) continue;
    const v = await chatJson<{ valid?: boolean; reason?: string }>(
      'h4-audit',
      AUDIT_MODEL,
      RUBRIC,
      `Assistant's last reply: ${it.lastReply === '' ? '(none, first message)' : JSON.stringify(it.lastReply)}\nSeed: ${JSON.stringify(it.seed)}\nRewrite: ${JSON.stringify(it.text)}`,
      4004 + it.item,
      'high',
    );
    const label = { item: it.item, valid: v.valid === true, reason: v.reason ?? '' };
    labels.push(label);
    appendFileSync(partial, `${JSON.stringify(label)}\n`);
  }
  labels.sort((a, b) => a.item - b.item);
  writeFileSync(h4('audit-model.json'), `${JSON.stringify(labels, null, 1)}\n`);
  console.log(`invalid by model: ${labels.filter((l) => !l.valid).length}`);
}

/** Vendi score with a character 1- to 4-gram cosine kernel (Friedman and Dieng, Def. 3.1). */
function vendi(texts: string[]): number {
  const vec = (s: string) => {
    const m = new Map<string, number>();
    const t = s.toLowerCase();
    for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= t.length; i++) m.set(t.slice(i, i + n), (m.get(t.slice(i, i + n)) ?? 0) + 1);
    return m;
  };
  const vs = texts.map(vec);
  const norm = vs.map((v) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)));
  const n = texts.length;
  const K: number[][] = vs.map((a, i) =>
    vs.map((b, j) => {
      let dot = 0;
      for (const [g, x] of a) dot += x * (b.get(g) ?? 0);
      return dot / ((norm[i] as number) * (norm[j] as number)) / n;
    }),
  );
  // Jacobi eigenvalues of the symmetric matrix K / n.
  const A = K.map((r) => [...r]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += (A[p]![q] as number) ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p]![q] as number;
        if (Math.abs(apq) < 1e-15) continue;
        const theta = ((A[q]![q] as number) - (A[p]![p] as number)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k]![p] as number;
          const akq = A[k]![q] as number;
          A[k]![p] = c * akp - s * akq;
          A[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p]![k] as number;
          const aqk = A[q]![k] as number;
          A[p]![k] = c * apk - s * aqk;
          A[q]![k] = s * apk + c * aqk;
        }
      }
    }
  }
  const lambdas = A.map((r, i) => r[i] as number).filter((l) => l > 1e-12);
  return Math.exp(-lambdas.reduce((s, l) => s + l * Math.log(l), 0));
}

if (step === 'analyse') {
  const planted = read<{ id: string; type: string; caught: boolean; stages: Stage[] }[]>(h4('planted-results.json'));
  const mine = read<{ item: number; valid: boolean; reason: string }[]>(h4('audit-mine.json'));
  const model = read<{ item: number; valid: boolean; reason: string }[]>(h4('audit-model.json'));
  const items = read<{ item: number; block: string; text: string }[]>(h4('audit-items.json'));
  const candidates = readFileSync(resolve(here, 'data/h1/candidates.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { block: string; row: number; ok: boolean; stages: Stage[] });
  const accepted = read<Real[]>(resolve(here, 'data/h1/realisations.json'));
  const caught = planted.filter((p) => p.caught).length;
  const invalidUnion = items.filter((it) => !mine.find((m) => m.item === it.item)?.valid || !model.find((m) => m.item === it.item)?.valid);
  const invalidMine = mine.filter((m) => !m.valid).length;
  const invalidModel = model.filter((m) => !m.valid).length;
  const agree = items.filter((it) => mine.find((m) => m.item === it.item)?.valid === model.find((m) => m.item === it.item)?.valid).length;
  const rejectedBy: Record<string, number> = {};
  for (const c of candidates) {
    const f = c.stages.find((s) => !s.ok);
    if (f) rejectedBy[f.stage] = (rejectedBy[f.stage] ?? 0) + 1;
  }
  const perBlock = BLOCKS.map((d) => {
    const acc = accepted.filter((a) => a.block === d.id);
    return {
      block: d.id,
      accepted: acc.length,
      candidates: candidates.filter((c) => c.block === d.id).length,
      vendi: Number(vendi(acc.map((a) => a.text)).toFixed(2)),
      vendiRatio: Number((vendi(acc.map((a) => a.text)) / Math.max(1, acc.length)).toFixed(3)),
      cov2: Number(coverage(acc.map((a) => a.cell), 2).share.toFixed(3)),
      cov3: Number(coverage(acc.map((a) => a.cell), 3).share.toFixed(3)),
    };
  });
  const plantedByStage: Record<string, number> = {};
  for (const p of planted) for (const s of p.stages) if (!s.ok) plantedByStage[s.stage] = (plantedByStage[s.stage] ?? 0) + 1;
  const falseAccepts = invalidUnion.length;
  const falsified = caught < 19 || falseAccepts >= 2;
  const result = {
    hypothesis: 'H4',
    verdict: falsified ? 'FALSIFIED' : 'SUPPORTED',
    planted: { caught, of: planted.length, byStage: plantedByStage, missed: planted.filter((p) => !p.caught).map((p) => p.id) },
    audit: {
      n: items.length,
      invalidUnion: falseAccepts,
      invalidMine,
      invalidModel,
      agreement: agree / items.length,
      rate: falseAccepts / items.length,
      wilson95: wilson(falseAccepts, items.length),
      invalidItems: invalidUnion.map((it) => ({
        item: it.item,
        block: it.block,
        text: it.text,
        mine: mine.find((m) => m.item === it.item),
        model: model.find((m) => m.item === it.item),
      })),
      human: false,
    },
    gate: {
      plannedRows: 300,
      accepted: accepted.length,
      candidates: candidates.length,
      firstRejectionByStage: rejectedBy,
      perBlock,
    },
  };
  writeFileSync(h4('results.json'), `${JSON.stringify(result, null, 1)}\n`);
  console.log(JSON.stringify(result, null, 1));
}

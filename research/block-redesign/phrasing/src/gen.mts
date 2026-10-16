// Plans, realises and gates the class of each block for one design.
// Usage: tsx gen.mts <design: h1 | h2s2 | h2s3> [--blocks B1,B2] [--rows N] [--batch name]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCKS } from './blocks.ts';
import { axisStage, deterministicStages, equivalenceStage, realise, type Stage } from './gate.ts';
import { coveringArray, extend, type Row } from './planner.ts';
import { blockGiven } from './prefix.ts';
import { spent } from './usage.ts';

const args = process.argv.slice(2);
const design = args[0] as 'h1' | 'h2s2' | 'h2s3';
const opt = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = opt('blocks')?.split(',');
const rowLimit = opt('rows') ? Number(opt('rows')) : undefined;
const batch = opt('batch') ?? `gen-${design}`;
const out = resolve(import.meta.dirname, '../data', design);
mkdirSync(out, { recursive: true });

/** The plan of a block for a design. Seeds are fixed in the PREREG files. */
export function plan(design: string, blockNumber: number): Row[] {
  if (design === 'h1') return extend(coveringArray(2, 1000 + 10 * blockNumber), 30, 2, 1005 + 10 * blockNumber);
  if (design === 'h2s2') return coveringArray(2, 2000 + 10 * blockNumber);
  if (design === 'h2s3') return coveringArray(3, 3000 + 10 * blockNumber);
  throw new Error(`unknown design ${design}`);
}

const seedOf = (...parts: (string | number)[]) =>
  Number.parseInt(createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8), 16);

const MAX_ATTEMPTS = 6;

const before = spent();
const results = await Promise.all(
  BLOCKS.filter((def) => !only || only.includes(def.id)).map(async (def) => {
    const blockNumber = Number(def.id.slice(1));
    const g = await blockGiven(def);
    const context = g.given.prefix.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const rows = plan(design, blockNumber).slice(0, rowLimit);
    const accepted: string[] = [g.seed];
    const candidates: unknown[] = [];
    const realisations: { block: string; row: number; cell: Row; text: string; attempt: number }[] = [];
    for (const [r, row] of rows.entries()) {
      let previous: { text: string; reason: string } | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const callSeed = seedOf(design, def.id, r, attempt);
        let text = '';
        let stages: Stage[] = [];
        try {
          text = await realise(def, g.seed, g.lastReply, row, callSeed, batch, previous);
          stages = deterministicStages(def, g.seed, text, row, accepted, context);
          if (stages.every((s) => s.ok)) stages.push(await axisStage(def, g.seed, text, row, callSeed, batch));
          if (stages.every((s) => s.ok)) stages.push(await equivalenceStage(def, g.seed, g.lastReply, text, callSeed, batch));
        } catch (cause) {
          stages.push({ stage: 'error', ok: false, note: String(cause) });
        }
        const ok = stages.every((s) => s.ok);
        const failed = stages.find((s) => !s.ok);
        if (failed) previous = { text, reason: `${failed.stage}${failed.note ? `: ${failed.note}` : ''}` };
        candidates.push({ block: def.id, row: r, attempt, cell: row, text, ok, stages });
        if (ok) {
          accepted.push(text);
          realisations.push({ block: def.id, row: r, cell: row, text, attempt });
          break;
        }
      }
    }
    return { block: def.id, rows: rows.length, candidates, realisations };
  }),
);

const candidates = results.flatMap((r) => r.candidates);
const realisations = results.flatMap((r) => r.realisations);
const suffix = only ? `-${only.join('_')}` : '';
const tag = rowLimit ? `${suffix}-rows${rowLimit}` : suffix;
writeFileSync(resolve(out, `candidates${tag}.jsonl`), `${candidates.map((c) => JSON.stringify(c)).join('\n')}\n`);
const frozen = JSON.stringify(realisations, null, 1);
const hash = createHash('sha256').update(frozen).digest('hex');
writeFileSync(resolve(out, `realisations${tag}.json`), `${frozen}\n`);
console.log(
  JSON.stringify({
    design,
    rows: results.reduce((s, r) => s + r.rows, 0),
    candidates: candidates.length,
    accepted: realisations.length,
    perBlock: results.map((r) => `${r.block}:${r.realisations.length}/${r.rows}`),
    sha256: hash,
    usd: Number((spent() - before).toFixed(4)),
  }),
);

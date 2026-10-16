// H2: confirmation list and analysis. Usage: tsx h2.mts confirm-list | analyse
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCKS } from './blocks.ts';
import { envelope, mean } from './envelope.ts';
import { coverage, localise, rng, type Row, tuplesOf } from './planner.ts';

const here = resolve(import.meta.dirname, '..');
type Run = { block: string; row: number; cell: Row; text: string; k: number; exact: boolean; norm: boolean; error?: string };
const runs = (design: string, file: string): Run[] => {
  const p = resolve(here, 'data', design, file);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Run);
};
type Real = { block: string; row: number; cell: Row; text: string };
const DESIGNS = ['h2s2', 'h2s3'] as const;
const step = process.argv[2];

/** Per realisation: its K = 2 outcomes and its confirmation outcomes, on one oracle. */
function byRealisation(design: string, oracle: 'norm' | 'exact') {
  const main = runs(design, 'runs-class.jsonl');
  const confirm = runs(design, 'runs-class-confirm.jsonl');
  const key = (r: { block: string; row: number }) => `${r.block}#${r.row}`;
  const map = new Map<string, { block: string; row: number; cell: Row; text: string; main: number[]; confirm: number[] }>();
  for (const r of main) {
    const m = map.get(key(r)) ?? { block: r.block, row: r.row, cell: r.cell, text: r.text, main: [], confirm: [] };
    m.main.push(r[oracle] ? 1 : 0);
    map.set(key(r), m);
  }
  for (const r of confirm) map.get(key(r))?.confirm.push(r[oracle] ? 1 : 0);
  return [...map.values()];
}

if (step === 'confirm-list') {
  for (const design of DESIGNS) {
    const list = byRealisation(design, 'norm').filter((r) => r.main.length === 2 && r.main.every((x) => x === 0));
    const reals = JSON.parse(readFileSync(resolve(here, 'data', design, 'realisations.json'), 'utf8')) as Real[];
    const pick = reals.filter((r) => list.some((l) => l.block === r.block && l.row === r.row));
    writeFileSync(resolve(here, 'data', design, 'confirm.json'), `${JSON.stringify(pick, null, 1)}\n`);
    console.log(`${design}: ${pick.length} realisations to confirm`);
  }
}

if (step === 'analyse') {
  const out: Record<string, unknown> = { hypothesis: 'H2' };
  for (const oracle of ['norm', 'exact'] as const) {
    const all = DESIGNS.flatMap((design) => byRealisation(design, oracle).map((r) => ({ ...r, design })));
    const status = (r: (typeof all)[number]) => {
      const passes = r.main.reduce((a, b) => a + b, 0);
      if (passes === 2) return 'pass';
      if (passes === 0) {
        // Primary oracle: confirmed fail needs at least 5 of 6 runs failed. The exact oracle had no confirmation
        // list of its own, so it uses the K = 2 rule and the confirmation runs only when they exist.
        const fails = 2 + r.confirm.filter((x) => x === 0).length;
        const total = 2 + r.confirm.length;
        if (r.confirm.length === 0) return 'fail';
        return fails >= 5 && total === 6 ? 'fail' : 'flaky';
      }
      return 'flaky';
    };
    const perBlock = BLOCKS.map((def) => {
      const mine = all.filter((r) => r.block === def.id);
      const passing = mine.filter((r) => status(r) === 'pass');
      const failing = mine.filter((r) => status(r) === 'fail');
      const P = new Set<string>();
      for (const r of passing) for (let t = 1; t <= 3; t++) for (const k of tuplesOf(r.cell, t)) P.add(k);
      const explain = (r: (typeof all)[number]) => {
        for (let t = 1; t <= 3; t++) {
          const cands = tuplesOf(r.cell, t).filter((k) => !P.has(k));
          if (cands.length > 0) return { level: t, candidates: cands };
        }
        return { level: 4, candidates: [] as string[] };
      };
      const explained = failing.map((r) => ({ design: r.design, row: r.row, text: r.text, cell: r.cell, ...explain(r) }));
      const s2fails = failing.filter((r) => r.design === 'h2s2');
      const level3InS3 = explained.filter((e) => e.design === 'h2s3' && e.level === 3);
      const missed = level3InS3.flatMap((e) =>
        e.candidates.filter((T) => !s2fails.some((f) => tuplesOf(f.cell, 3).includes(T))).map((T) => ({ row: e.row, T })),
      );
      const obs = mine.map((r) => ({ row: r.cell, passes: r.main.reduce((a, b) => a + b, 0), runs: r.main.length }));
      const env = envelope(
        mine.map((r) => ({ cell: `slot_surface=${r.cell.slot_surface}`, outcomes: r.main })),
        rng(2002),
      );
      return {
        block: def.id,
        realisations: mine.length,
        passing: passing.length,
        failing: failing.length,
        flaky: mine.length - passing.length - failing.length,
        levels: [1, 2, 3, 4].map((l) => explained.filter((e) => e.level === l).length),
        event: missed.length > 0,
        missed,
        explained,
        localiserTop: localise(obs, 2).slice(0, 5),
        rho: env.rho,
        rate: env.rate,
        cov: Object.fromEntries(
          DESIGNS.map((d) => {
            const cells = mine.filter((r) => r.design === d).map((r) => r.cell);
            return [d, { rows: cells.length, cov2: coverage(cells, 2).share, cov3: coverage(cells, 3).share }];
          }),
        ),
      };
    });
    const failingTotal = perBlock.reduce((s, b) => s + b.failing, 0);
    const lowLevel = perBlock.reduce((s, b) => s + (b.levels[0] ?? 0) + (b.levels[1] ?? 0), 0);
    const events = perBlock.filter((b) => b.event).length;
    const blocksWithFailures = perBlock.filter((b) => b.failing > 0).length;
    const verdict = blocksWithFailures < 3 ? 'INCONCLUSIVE' : events >= 3 ? 'FALSIFIED' : 'SUPPORTED';
    out[oracle] = {
      verdict,
      primary: oracle === 'norm',
      consistentlyFailing: failingTotal,
      explainedAtLevel1or2: lowLevel,
      share: failingTotal === 0 ? null : lowLevel / failingTotal,
      blocksWithEvent: events,
      blocksWithFailures,
      meanRho: mean(perBlock.map((b) => b.rho ?? 0)),
      perBlock,
    };
  }
  out.verdict = (out.norm as { verdict: string }).verdict;
  writeFileSync(resolve(here, 'h2/results.json'), `${JSON.stringify(out, null, 1)}\n`);
  const brief = (o: string) => {
    const x = out[o] as { verdict: string; consistentlyFailing: number; share: number; blocksWithEvent: number; blocksWithFailures: number; meanRho: number; perBlock: { block: string; realisations: number; passing: number; failing: number; flaky: number; levels: number[]; event: boolean; rho?: number }[] };
    return { ...x, perBlock: x.perBlock.map((b) => `${b.block} n=${b.realisations} pass=${b.passing} fail=${b.failing} flaky=${b.flaky} levels=${b.levels.join('/')} event=${b.event} rho=${(b.rho ?? 0).toFixed(2)}`) };
  };
  console.log(JSON.stringify({ norm: brief('norm'), exact: brief('exact') }, null, 1));
}

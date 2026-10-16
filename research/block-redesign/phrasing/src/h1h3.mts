// H1 and H3 analysis on the stored H1 runs. Usage: tsx h1h3.mts h1 | h3
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCKS } from './blocks.ts';
import { envelope, mean, variance } from './envelope.ts';
import { AXIS_NAMES, rng } from './planner.ts';

const here = resolve(import.meta.dirname, '..');
type Run = {
  block: string;
  row: number | null;
  cell: Record<string, string> | null;
  text: string;
  k: number;
  error?: string;
  calls: { label: string; input: unknown }[];
  exact: boolean;
  exactFailed: string[];
  norm: boolean;
  snaps: { tool: string; path: string; raw: unknown; normalised: string; gold: string; snapped: boolean }[];
};
const load = (f: string) =>
  readFileSync(resolve(here, 'data/h1', f), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Run);
const seedRuns = load('runs-seed.jsonl');
const classRuns = load('runs-class.jsonl');
const step = process.argv[2];

if (step === 'h1') {
  const random = rng(1001);
  const blocks = BLOCKS.map((def) => {
    const seed = seedRuns.filter((r) => r.block === def.id);
    const cls = classRuns.filter((r) => r.block === def.id);
    const arm = (oracle: 'exact' | 'norm') => {
      const ys = seed.map((r) => (r[oracle] ? 1 : 0));
      const ps = cls.map((r) => (r[oracle] ? 1 : 0));
      const ySeed = mean(ys);
      const pClass = mean(ps);
      const G = ySeed - pClass;
      const se = Math.sqrt(variance(ys) / ys.length + variance(ps) / ps.length);
      return { ySeed, pClass, G, se, ci: [G - 1.96 * se, G + 1.96 * se], beats: G > 0, ciExcludes0: G - 1.96 * se > 0 };
    };
    // One-way cells: each axis value is a cell (the envelope's worst-cell view, K = 1).
    const oneWay = AXIS_NAMES.flatMap((axis) =>
      cls.map((r) => ({ cell: `${axis}=${r.cell?.[axis]}`, outcomes: [r.exact ? 1 : 0] })),
    );
    const envExact = envelope(
      cls.map((r) => ({ cell: `slot_surface=${r.cell?.slot_surface}`, outcomes: [r.exact ? 1 : 0] })),
      random,
    );
    const envNorm = envelope(
      cls.map((r) => ({ cell: `slot_surface=${r.cell?.slot_surface}`, outcomes: [r.norm ? 1 : 0] })),
      random,
    );
    const oneWayRates = [...new Set(oneWay.map((o) => o.cell))].map((cell) => {
      const os = oneWay.filter((o) => o.cell === cell);
      return { cell, n: os.length, rate: mean(os.map((o) => o.outcomes[0] as number)) };
    });
    return {
      block: def.id,
      nSeed: seed.length,
      nClass: cls.length,
      exact: arm('exact'),
      norm: arm('norm'),
      envelopeExact: { rate: envExact.rate, se: envExact.se, wilson: envExact.wilson, cells: envExact.cells, minP: envExact.minP, lbMin: envExact.lbMin, worst: envExact.worst, mde: envExact.mde },
      envelopeNorm: { rate: envNorm.rate, se: envNorm.se, minP: envNorm.minP, lbMin: envNorm.lbMin, worst: envNorm.worst },
      oneWayExact: oneWayRates,
      agentErrors: [...seed, ...cls].filter((r) => r.error).length,
    };
  });
  const scored = blocks.filter((b) => b.nSeed > 0 && b.nClass >= 10);
  const beatsExact = scored.filter((b) => b.exact.beats).length;
  const beatsNorm = scored.filter((b) => b.norm.beats).length;
  const Gs = scored.map((b) => b.exact.G);
  const GsN = scored.map((b) => b.norm.G);
  const verdict = scored.length < 10 ? 'INCONCLUSIVE' : beatsExact < 7 ? 'FALSIFIED' : 'SUPPORTED';
  const result = {
    hypothesis: 'H1',
    verdict,
    blocksScored: scored.length,
    seedBeatsClassExact: beatsExact,
    seedBeatsClassNorm: beatsNorm,
    ciExcludes0Exact: scored.filter((b) => b.exact.ciExcludes0).length,
    ciExcludes0Norm: scored.filter((b) => b.norm.ciExcludes0).length,
    meanGExact: mean(Gs),
    pairedSeExact: Math.sqrt(variance(Gs) / Gs.length),
    meanGNorm: mean(GsN),
    pairedSeNorm: Math.sqrt(variance(GsN) / GsN.length),
    blocks,
  };
  writeFileSync(resolve(here, 'h1/results.json'), `${JSON.stringify(result, null, 1)}\n`);
  const brief = { ...result, blocks: blocks.map((b) => ({ block: b.block, n: `${b.nSeed}/${b.nClass}`, exact: [b.exact.ySeed, b.exact.pClass, b.exact.G].map((x) => x.toFixed(3)), norm: [b.norm.ySeed, b.norm.pClass, b.norm.G].map((x) => x.toFixed(3)) })) };
  console.log(JSON.stringify(brief, null, 1));
}

if (step === 'h3') {
  const share = (runs: Run[]) => {
    const failing = runs.filter((r) => !r.exact);
    const flipped = failing.filter((r) => r.norm);
    return { exactFailures: failing.length, flipped: flipped.length, share: failing.length === 0 ? Number.NaN : flipped.length / failing.length };
  };
  const pooled = share(classRuns);
  const perBlock = BLOCKS.map((d) => ({ block: d.id, ...share(classRuns.filter((r) => r.block === d.id)) }));
  // Cluster bootstrap over blocks.
  const random = rng(3003);
  const boots: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let fails = 0;
    let flips = 0;
    for (let i = 0; i < BLOCKS.length; i++) {
      const pick = perBlock[Math.floor(random() * perBlock.length)];
      if (!pick) continue;
      fails += pick.exactFailures;
      flips += pick.flipped;
    }
    if (fails > 0) boots.push(flips / fails);
  }
  boots.sort((a, b) => a - b);
  const ci = [boots[Math.floor(0.025 * boots.length)], boots[Math.floor(0.975 * boots.length)]];
  const flips = classRuns
    .filter((r) => !r.exact && r.norm)
    .map((r) => ({ block: r.block, row: r.row, text: r.text, exactFailed: r.exactFailed, snaps: r.snaps.filter((s) => s.snapped && s.raw !== s.gold) }));
  // Why exact failures fail: a slot field, or something else (count, order, another input).
  const slotPaths = new Set(BLOCKS.flatMap((d) => d.fields.map((f) => `tools.${f.tool}.input.${f.path[0]}`)));
  const failing = classRuns.filter((r) => !r.exact);
  const slotOnly = failing.filter((r) => r.exactFailed.length > 0 && r.exactFailed.every((f) => slotPaths.has(f))).length;
  const verdict = pooled.exactFailures < 10 ? 'INCONCLUSIVE' : pooled.share < 0.3 ? 'FALSIFIED' : pooled.share >= 0.5 ? 'SUPPORTED' : 'INCONCLUSIVE';
  const result = {
    hypothesis: 'H3',
    verdict,
    pooled,
    ci95ClusterBootstrap: ci,
    perBlock,
    seedRuns: share(seedRuns),
    exactFailuresOnSlotFieldsOnly: slotOnly,
    exactFailuresTotal: failing.length,
    flips,
  };
  writeFileSync(resolve(here, 'h3/results.json'), `${JSON.stringify(result, null, 1)}\n`);
  console.log(JSON.stringify({ ...result, flips: flips.length }, null, 1));
}

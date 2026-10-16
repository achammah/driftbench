// M1.2 and M1.4 sanity checks, offline (no model call).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envelope, type Item, mean } from './envelope.ts';
import { allRows, coverage, coveringArray, extend, localise, type Observation, rng, type Row } from './planner.ts';

const out: Record<string, unknown> = {};

// Planner sizes and coverage.
const ca2 = coveringArray(2, 101);
const ca3 = coveringArray(3, 301);
const h1rows = extend(coveringArray(2, 11), 30, 2, 12);
out.planner = {
  valid_rows: allRows().length,
  strength2_rows: ca2.length,
  strength2_cov2: coverage(ca2, 2),
  strength3_rows: ca3.length,
  strength3_cov3: coverage(ca3, 3),
  h1_30_rows_cov2: coverage(h1rows, 2),
  h1_30_rows_cov3: coverage(h1rows, 3),
};
// Random sets of the strength-2 size: their pairwise coverage (NIST Ch. 7 comparison).
{
  const random = rng(7);
  const pool = allRows();
  const shares: number[] = [];
  for (let r = 0; r < 200; r++) {
    const pick: Row[] = [];
    for (let i = 0; i < ca2.length; i++) pick.push(pool[Math.floor(random() * pool.length)] as Row);
    shares.push(coverage(pick, 2).share);
  }
  out.random_same_size_cov2_mean = mean(shares);
}

// Localiser: a fake agent that fails with probability 0.9 only when register = casual AND noise = typos.
// Run on a strength-2 array (15 rows) and a strength-3 array (46 rows), K = 2. "First" means rank 1 alone;
// "in top tie" means the pair shares rank 1 with others of identical statistics.
for (const [label, t] of [['strength2', 2], ['strength3', 3]] as const) {
  const random = rng(42);
  let firstHits = 0;
  let tieHits = 0;
  const trials = 50;
  for (let trial = 0; trial < trials; trial++) {
    const rows = coveringArray(t, 1000 + trial, 1);
    const obs: Observation[] = rows.map((row) => {
      const bad = row.register === 'casual' && row.noise === 'typos';
      let passes = 0;
      for (let k = 0; k < 2; k++) if (!(bad && random() < 0.9)) passes++;
      return { row, passes, runs: 2 };
    });
    const ranked = localise(obs, 2);
    const top = ranked[0];
    if (top?.tuple === 'register=casual|noise=typos') firstHits++;
    const tied = ranked.filter((s) => top && s.inPassing === top.inPassing && s.failRate === top.failRate && s.t === top.t && s.runs === top.runs);
    if (tied.some((s) => s.tuple === 'register=casual|noise=typos')) tieHits++;
  }
  out[`localiser_${label}`] = { ranked_first: `${firstHits} of ${trials}`, in_top_tie: `${tieHits} of ${trials}` };
}

// Envelope: interval coverage and phrasing share on simulated agents with known rates.
{
  const random = rng(9);
  const n = 60;
  const K = 4;
  const sims = 1000;
  let covered = 0;
  const rhos: number[] = [];
  // Per-realisation true rates drawn from Beta(a, b); rho_true = Var(x) / (Var(x) + E[x(1 - x)]).
  const a = 3;
  const b = 1;
  const mu = a / (a + b);
  const varX = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const sigma2 = mu * (1 - mu) - varX;
  const rhoTrue = varX / (varX + sigma2);
  for (let s = 0; s < sims; s++) {
    const items: Item[] = [];
    for (let i = 0; i < n; i++) {
      // Beta(3, 1) by inverse CDF: x = u^(1/3).
      const x = random() ** (1 / 3);
      const outcomes = Array.from({ length: K }, () => (random() < x ? 1 : 0));
      items.push({ cell: `c${i % 6}`, outcomes });
    }
    const e = envelope(items, random);
    if (e.ci[0] <= mu && mu <= e.ci[1]) covered++;
    rhos.push(e.rho ?? 0);
  }
  out.envelope = { n, K, sims, ci_coverage: covered / sims, rho_true: rhoTrue, rho_mean: mean(rhos) };
}

writeFileSync(resolve(import.meta.dirname, '../data/sanity-offline.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));

/** Deterministic builder measurement. Zero progress is recorded, never relabelled as ten fixes. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allFailingItems, blindReport } from '../../../src/audit';
import { bankSummary } from '../../../src/bank';
import { type JournalRow, JournalRowSchema } from '../../../src/journal';
import { runSeeds, seedLabel } from '../../../src/ladder';
import { judgesLadderV3 } from '../../../src/ladders/judges/v3';
import { hiddenSeed, seedSpecs } from '../../../src/seeds';

const root = process.cwd();
const output = process.argv[2];
if (!output) throw new Error('Supply an output directory; no evidence is overwritten implicitly.');
mkdirSync(output, { recursive: true });
const hidden = hiddenSeed(root);
const seeds = seedSpecs(
  Array.from({ length: 20 }, (_, i) => i + 1),
  hidden,
);
const rows: JournalRow[] = [];
const measurements = [];
let prior: Awaited<ReturnType<typeof runSeeds>> | undefined;
for (let iteration = 0; iteration <= 10; iteration += 1) {
  const start = performance.now();
  const report = await runSeeds(judgesLadderV3(), seeds, root, { full: true });
  const bank = bankSummary(report);
  const before = prior ?? report;
  const row = JournalRowSchema.parse({
    iteration,
    at: new Date().toISOString(),
    model: 'Codex builder; deterministic measurement, no model invocation',
    executor: 'builder',
    seeds: report.seeds.map(seedLabel),
    command: 'pnpm exec tsx packages/validators/test/judges/v3/pilot.ts <output> (seeds 1..20 + hidden)',
    level: { before: before.level, after: report.level },
    perSeed: report.seeds.map((run, i) => ({
      seed: seedLabel(run),
      before: before.seeds[i]?.level ?? run.level,
      after: run.level,
    })),
    metrics: report.seeds[0]?.rows.map((level, i) => ({
      level: level.level,
      id: level.id,
      metric: level.metric,
      threshold: level.threshold,
      before: before.seeds[0]?.rows[i]?.observed ?? null,
      after: level.observed,
    })),
    bankSize: bank.size,
    passing: bank.passing,
    failingByFamily: bank.failingByFamily,
    failingCauses: bank.failingCauses,
    failingWithoutCause: bank.failingWithoutCause,
    bankByFamilyTier: bank.byFamilyTier,
    failingBefore: allFailingItems(before).map((item) => item.id),
    hypothesis:
      iteration === 0
        ? 'Measure the completed deterministic bank before any pilot fix.'
        : 'Repeat the unchanged bank across every visible seed and the hidden seed; no defects or fixes are invented.',
    research: null,
    change: { files: [], commit: null },
    testsAdded: [],
    result:
      iteration === 0
        ? 'baseline'
        : report.level > before.level
          ? 'raised'
          : report.level < before.level
            ? 'lowered'
            : 'unchanged',
    durationMinutes: (performance.now() - start) / 60000,
    tokenEstimate: 0,
  });
  rows.push(row);
  measurements.push({
    iteration,
    level: report.level,
    bank: { size: bank.size, passing: bank.passing, score: bank.score, causes: bank.failingCauses },
    durationMinutes: row.durationMinutes,
  });
  if (iteration === 0) {
    const blind = blindReport(report);
    writeFileSync(
      join(output, 'blind-baseline.json'),
      JSON.stringify({ ...blind, hiddenSeed: hidden, failingItems: allFailingItems(blind) }, null, 2),
    );
    writeFileSync(
      join(output, 'baseline.json'),
      JSON.stringify({ ...report, hiddenSeed: hidden, bank }, null, 2),
    );
  }
  prior = report;
  console.log(JSON.stringify(measurements.at(-1)));
}
writeFileSync(join(output, 'journal.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
writeFileSync(
  join(output, 'pilot.json'),
  JSON.stringify(
    {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      hiddenSeed: hidden,
      observations: measurements,
      limitation:
        'Iterations 1..10 are unchanged repeatability measurements. They are not ten executor fixes; no learning-rate forecast is supported when the baseline already passes.',
    },
    null,
    2,
  ),
);

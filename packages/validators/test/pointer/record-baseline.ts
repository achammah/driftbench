/** Run from the repository root: pnpm exec tsx packages/validators/test/pointer/record-baseline.ts */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { bankSummary } from '../../src/bank';
import { JournalRowSchema } from '../../src/journal';
import { runSeeds, seedLabel } from '../../src/ladder';
import { pointerLadder } from '../../src/ladders/pointer';
import { assertReaderAvailable } from '../../src/ladders/pointer/sut/reader';
import { hiddenSeed, seedSpecs } from '../../src/seeds';

if (process.env.DRIFTBENCH_POINTER_SUT) throw new Error('Baseline requires the actual default adapter');
try {
  await assertReaderAvailable();
} catch (cause) {
  console.error(`BASELINE_PENDING PR 692: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(2);
}
const root = process.cwd();
const dirty = execFileSync(
  'git',
  ['status', '--porcelain', '--', 'packages/validators', 'docs/estate-pointer-reader.md'],
  { encoding: 'utf8' },
);
if (dirty.trim()) throw new Error('Commit the measured code and contract before recording its baseline');
const hidden = hiddenSeed(root);
if (hidden.source !== 'head') throw new Error('Baseline requires the canonical HEAD-derived hidden seed');
const started = Date.now();
const report = await runSeeds(
  pointerLadder(),
  seedSpecs(
    Array.from({ length: 20 }, (_, i) => i + 1),
    hidden,
  ),
  root,
  { full: true },
);
const bank = bankSummary(report);
const evidence = {
  measuredHead: hidden.head,
  hidden,
  adapter: 'default realReader; no override',
  componentPrerequisite: 'PR 692 must merge before executor iterations and independent audit',
  at: new Date().toISOString(),
  runtime: process.version,
  summary: {
    size: bank.size,
    passingEverySeed: bank.passing,
    score: bank.score,
    level: report.level,
    declaredAtomicCauses: bank.failingCauses,
    independentlyReviewedDistinctFixes: null,
  },
  seeds: report.seeds.map((run) => ({
    seed: run.seed,
    hidden: run.hidden,
    level: run.level,
    items: run.rows.flatMap((row) => (row.bank ?? []).map(({ id, pass, detail }) => ({ id, pass, detail }))),
  })),
};
writeFileSync('validators/pointer/baseline.json', `${JSON.stringify(evidence, null, 2)}\n`);
const row = JournalRowSchema.parse({
  iteration: 0,
  at: evidence.at,
  model: 'codex',
  executor: 'builder',
  seeds: bank.seeds,
  command: 'pnpm exec tsx packages/validators/test/pointer/record-baseline.ts',
  level: { before: report.level, after: report.level },
  perSeed: report.seeds.map((run) => ({ seed: seedLabel(run), before: run.level, after: run.level })),
  metrics: (report.seeds[0]?.rows ?? []).map((level) => ({
    level: level.level,
    id: level.id,
    metric: level.metric,
    threshold: level.threshold,
    before: level.observed,
    after: level.observed,
  })),
  bankSize: bank.size,
  passing: bank.passing,
  failingByFamily: bank.failingByFamily,
  failingCauses: bank.failingCauses,
  failingWithoutCause: bank.failingWithoutCause,
  bankByFamilyTier: bank.byFamilyTier,
  failingBefore: bank.rows.filter((item) => !item.passEverySeed).map((item) => item.id),
  hypothesis: 'Measure the repaired bank before component integration; this is not a pilot or audit verdict.',
  research: {
    sources: [
      'docs/validators.md#124-the-hardness-measurement-a-merge-gate',
      'docs/estate-pointer-reader.md',
    ],
    finding:
      'The actual adapter baseline is measured on twenty visible seeds and the canonical hidden seed. Distinct causes remain author-declared.',
  },
  change: { files: [], commit: hidden.head },
  testsAdded: [],
  result: 'baseline',
  durationMinutes: (Date.now() - started) / 60000,
  tokenEstimate: 0,
});
const journal = 'validators/pointer/journal.jsonl';
const old = readFileSync(journal, 'utf8');
if (
  old
    .trim()
    .split('\n')
    .some((line) => JSON.parse(line).iteration !== 0)
)
  throw new Error('Refusing to replace a journal containing pilot iterations');
if (!existsSync('validators/pointer/journal-seed1.jsonl'))
  writeFileSync('validators/pointer/journal-seed1.jsonl', old);
writeFileSync(journal, `${JSON.stringify(row)}\n`);
console.log(
  JSON.stringify({
    ...evidence.summary,
    measuredHead: hidden.head,
    hiddenSeed: hidden.seed,
    seeds: evidence.seeds.map((run) => ({
      seed: run.seed,
      hidden: run.hidden,
      passing: run.items.filter((item) => item.pass).length,
      total: run.items.length,
    })),
  }),
);

/** Convert the measured all-zero baseline evidence to a validated iteration-0 journal row. Does not append. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JournalRowSchema } from '../../packages/validators/src/journal';
import { variablesBank, variablesLadder } from '../../packages/validators/src/ladders/variables/index';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = `${root}packages/validators/src/ladders/variables/`;
const hash = createHash('sha256');
for (const path of readdirSync(sourceRoot, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith('.ts'))
  .sort()) {
  hash.update(path).update(readFileSync(sourceRoot + path));
}
const raw = JSON.parse(
  readFileSync(process.argv[2] ?? 'validators/variables/evidence/baseline.json', 'utf8'),
);
assert.equal(raw.result, 'measured-default-adapter-baseline');
assert.equal(hash.digest('hex'), raw.sourceSha256, 'Evidence must describe the current bank sources');
assert.deepEqual(raw.providedOperations, []);
assert.equal(raw.perSeed.length, 21);
assert.deepEqual(
  raw.perSeed.map((row: { seed: string }) => row.seed),
  [...Array.from({ length: 20 }, (_, i) => String(i + 1)), 'hidden'],
);
const bank = variablesBank();
assert.equal(raw.bankSize, bank.length);
const failingByFamily: Record<string, number> = {};
const bankByFamilyTier: Record<string, Record<string, number>> = {};
for (const item of bank) {
  failingByFamily[item.family] = (failingByFamily[item.family] ?? 0) + 1;
  bankByFamilyTier[item.family] ??= {};
  const tiers = bankByFamilyTier[item.family] as Record<string, number>;
  tiers[item.tier] = (tiers[item.tier] ?? 0) + 1;
}
for (const row of raw.perSeed) {
  assert.equal(row.passing, 0);
  assert.equal(row.level, 0);
  assert.equal(row.items, bank.length);
  assert.deepEqual(row.failingByFamily, failingByFamily);
}
const row = JournalRowSchema.parse({
  iteration: 0,
  at: raw.at,
  model: 'Codex (builder; deterministic measurement uses no model)',
  executor: 'builder',
  seeds: raw.perSeed.map((row: { seed: string }) => row.seed),
  command: raw.command,
  level: { before: 0, after: 0 },
  perSeed: raw.perSeed.map((row: { seed: string }) => ({ seed: row.seed, before: 0, after: 0 })),
  metrics: variablesLadder().levels.map((level, index) => ({
    level: index + 1,
    id: level.id,
    metric: level.metric,
    threshold: level.threshold,
    before: 0,
    after: 0,
  })),
  bankSize: bank.length,
  passing: 0,
  failingByFamily,
  failingCauses: new Set(bank.map((item) => item.cause)).size,
  failingWithoutCause: 0,
  bankByFamilyTier,
  failingBefore: [],
  hypothesis:
    'The actual default adapter supplies no operations. This is a fresh measured baseline, not a pilot. Cause counts are candidate metadata, not independently proved fixes. Duration and token fields are unmeasured (zero placeholders required by the journal schema). Raw measurement and source hash are in evidence/baseline.json.',
  research: null,
  change: { files: [], commit: raw.measuredHead },
  testsAdded: [],
  result: 'baseline',
  durationMinutes: 0,
  tokenEstimate: 0,
});
process.stdout.write(`${JSON.stringify(row)}\n`);

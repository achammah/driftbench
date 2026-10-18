/** RAW EVIDENCE, not a JournalRow. Convert with baseline-journal.ts; never append this output to journal.jsonl. Actual default-adapter baseline; never substitutes a test reference. Uses the canonical hidden seed derived from the measured commit. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { variablesImpl } from '../../packages/validators/src/ladders/variables/adapter';
import {
  LEVELS,
  runInProcess,
  variablesBank,
} from '../../packages/validators/src/ladders/variables/bank/index';
import { hiddenSeed } from '../../packages/validators/src/seeds';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modulePath = fileURLToPath(
  new URL('../../packages/validators/src/ladders/variables/adapter.ts', import.meta.url),
);
const sourceRoot = `${root}packages/validators/src/ladders/variables/`;
const hash = createHash('sha256');
for (const path of readdirSync(sourceRoot, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith('.ts'))
  .sort()) {
  hash.update(path).update(readFileSync(sourceRoot + path));
}
const hidden = hiddenSeed(root);
if (hidden.source !== 'head') throw new Error(hidden.note);
const bank = variablesBank();
const perSeed = [];
for (const seed of [...Array.from({ length: 20 }, (_, i) => i + 1), hidden.seed]) {
  const outcomes = await runInProcess(bank, seed, root, variablesImpl, modulePath);
  const passing = [...outcomes.values()].filter((outcome) => outcome.pass).length;
  const failingByFamily: Record<string, number> = {};
  for (const item of bank)
    if (!outcomes.get(item.id)?.pass) failingByFamily[item.family] = (failingByFamily[item.family] ?? 0) + 1;
  const label = seed === hidden.seed ? 'hidden' : String(seed);
  let level = 0;
  for (const name of LEVELS) {
    if (!bank.filter((item) => item.level === name).every((item) => outcomes.get(item.id)?.pass)) break;
    level += 1;
  }
  perSeed.push({ seed: label, level, passing, items: outcomes.size, failingByFamily });
  process.stderr.write(`${label}: ${passing}/${outcomes.size}\n`);
}
const result = {
  iteration: 0,
  at: new Date().toISOString(),
  result: 'measured-default-adapter-baseline',
  sourceSha256: hash.digest('hex'),
  adapter: 'packages/validators/src/ladders/variables/adapter.ts',
  providedOperations: Object.keys(variablesImpl),
  bankSize: bank.length,
  perSeed,
  measuredHead: hidden.head,
  hiddenSeedSource: hidden.source,
  canonicalHiddenSeed: hidden.seed,
  command: 'pnpm exec tsx validators/variables/baseline.ts',
  candidateCauses: new Set(bank.map((item) => item.cause)).size,
  distinctFixCount: null,
  executorIterations: 0,
  note: 'Independent cause audit and ten-iteration real-component pilot pending. Earlier journal row is historical, not fresh evidence.',
};
process.stdout.write(`${JSON.stringify(result)}\n`);

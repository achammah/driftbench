// Regenerate the reviewable bank inventory without executing any bank checks.
//   node --import tsx packages/validators/test/system/bank-manifest.ts --write
// Without --write, compare the generated inventory with the committed manifest.
import { readFileSync, writeFileSync } from 'node:fs';
import { systemBank } from '../../src/ladders/system/bank/index';

const path = new URL('../../fixtures/system/bank-manifest.json', import.meta.url);
const previous = readFileSync(path, 'utf8');
const manifest = JSON.parse(previous) as { note: string; items: unknown[] };
const command = 'node --import tsx packages/validators/test/system/bank-manifest.ts --write';
if (!manifest.note.includes(command)) manifest.note += ` Regenerate with: ${command}.`;
// Keep this projection identical to bank.test.ts.
manifest.items = systemBank().map(({ id, family, tier, level, source, component, cause }) => ({
  id,
  family,
  tier,
  level,
  source,
  component,
  cause,
}));
const next = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--write')) {
  writeFileSync(path, next);
  console.log(`Wrote bank manifest: ${manifest.items.length} items.`);
} else if (next !== previous) {
  console.error(`Bank manifest is stale. Run: ${command}`);
  process.exitCode = 1;
} else {
  console.log(`Bank manifest matches: ${manifest.items.length} items.`);
}

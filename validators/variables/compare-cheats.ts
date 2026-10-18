/** Compare unchanged item IDs at the pre-correction bank and current bank; fail on any new cheat credit. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInProcess, variablesBank } from '../../packages/validators/src/ladders/variables/bank/index';
import { CHEATS, implementation } from '../../packages/validators/test/variables/cheat-profiles';

const oldRoot = process.argv[2];
if (!oldRoot) throw new Error('Pass a directory containing git archive 07b3a140 of packages/validators/src.');
const previous = await import(
  pathToFileURL(`${oldRoot}/packages/validators/src/ladders/variables/bank/index.ts`).href
);
const root = fileURLToPath(new URL('../../', import.meta.url));
const modulePath = fileURLToPath(
  new URL('../../packages/validators/test/variables/cheat-profiles.ts', import.meta.url),
);
const beforeBank = previous.variablesBank();
const afterBank = variablesBank();
if (
  JSON.stringify(beforeBank.map((item: { id: string }) => item.id)) !==
  JSON.stringify(afterBank.map((item) => item.id))
)
  throw new Error('Item IDs or order changed');
const rows = [];
for (const profile of CHEATS) {
  process.env.ASTRA_BANKS_CHEAT = profile;
  const impl = implementation(profile);
  const before = await previous.runInProcess(beforeBank, 1, root, impl, modulePath);
  const after = await runInProcess(afterBank, 1, root, impl, modulePath);
  const passing = (run: Map<string, { pass: boolean }>) =>
    [...run].filter(([, result]) => result.pass).map(([id]) => id);
  const oldPasses = passing(before);
  const newPasses = passing(after);
  const gains = newPasses.filter((id) => !oldPasses.includes(id));
  rows.push({
    profile,
    before: oldPasses.length,
    after: newPasses.length,
    gains,
    beforePassing: oldPasses,
    afterPassing: newPasses,
  });
  process.stderr.write(`${profile}: ${oldPasses.length} -> ${newPasses.length}, gains ${gains.length}\n`);
}
const result = {
  seed: 1,
  beforeHead: '07b3a1402c263af1ac1360bffeb377aeae4e816b',
  items: afterBank.length,
  profiles: rows,
};
writeFileSync('validators/variables/evidence/contract-cheats.json', `${JSON.stringify(result, null, 2)}\n`);
if (rows.some((row) => row.gains.length > 0)) throw new Error('A correction increased cheat credit');

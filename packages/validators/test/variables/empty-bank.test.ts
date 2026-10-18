import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runInProcess, variablesBank } from '../../src/ladders/variables/bank/index';
import { variablesImpl } from './constant-empty';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MODULE = fileURLToPath(new URL('./constant-empty.ts', import.meta.url));

it('awards zero items to the constant empty implementation, including its child processes', async () => {
  const bank = variablesBank();
  const run = await runInProcess(bank, 1, ROOT, variablesImpl, MODULE);
  expect(run.size).toBe(bank.length);
  // True-empty cases still need a paired positive witness; there are no exemptions.
  expect([...run].filter(([, outcome]) => outcome.pass).map(([id]) => id)).toEqual([]);
}, 120_000);

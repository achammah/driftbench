import { expect, it } from 'vitest';
import { checksItems } from '../../src/ladders/system/bank/claims/checks';

it.each([1, 2, 3])('argument accuracy never gates an otherwise passing block (seed %i)', async (seed) => {
  const claim = checksItems().find((item) => item.id === 'claim/checks/tools/argument-accuracy');
  if (!claim) throw new Error('argument-accuracy claim missing');
  await expect(claim.check({ seed, root: process.cwd(), scratch: process.cwd() })).resolves.toEqual({
    pass: true,
  });
});

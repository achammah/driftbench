import { expect, it } from 'vitest';
import { mde, sampleSizeForEffect } from '../src/power';

it.each([10, 50, 1000])('keeps the smallest sample size at the mde boundary n=%i', (n) => {
  const effect = mde({ n, baselineRate: 0.8 }).effect;
  if (effect === null) throw new Error('reference boundary is not detectable');
  expect(sampleSizeForEffect({ effect, baselineRate: 0.8 }).n).toBe(n);
});

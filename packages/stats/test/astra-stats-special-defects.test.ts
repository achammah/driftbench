import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { betaQuantile, binomialCdf, chiSquareSf, erfc, incompleteBeta, normalQuantile } from '../src/special';
import reference from './fixtures/numerical-defects.json';

function close(actual: number, expected: number, rel = 1e-9): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-300, rel * Math.abs(expected)));
}

describe('independent numerical defect references', () => {
  it('normalQuantile resolves subnormal probabilities', () => {
    for (const c of reference['normalQuantile.subnormal-p']) close(normalQuantile(c.p), c.expected);
  });
  it('betaQuantile resolves far lower tails', () => {
    for (const c of reference['betaQuantile.far-tail']) close(betaQuantile(c.p, c.a, c.b), c.expected);
  });
  it('incompleteBeta retains digits at large shapes', () => {
    for (const c of reference['incompleteBeta.large-shape']) close(incompleteBeta(c.x, c.a, c.b), c.expected);
  });
  it('chiSquareSf retains relative tail accuracy at large degrees of freedom', () => {
    for (const c of reference['chiSquareSf.large-df']) close(chiSquareSf(c.x, c.df), c.expected);
  });
  it('binomialCdf retains digits at large sample sizes', () => {
    for (const c of reference['binomialCdf.large-n']) close(binomialCdf(c.k, c.n, c.p), c.expected);
  });
  it('binomialCdf computes billion-trial tails within the item budget', async () => {
    // A worker enforces the deadline even when a synchronous O(k) mutant blocks its own event loop.
    const source = new URL('../src/special.ts', import.meta.url).href;
    const worker = new Worker(
      `const { parentPort } = require('node:worker_threads'); import('tsx/esm/api').then(async ({ tsImport }) => { const { binomialCdf } = await tsImport(${JSON.stringify(source)}, ${JSON.stringify(import.meta.url)}); parentPort.postMessage(${JSON.stringify(reference['binomialCdf.huge-n-time'])}.map(c => binomialCdf(c.k, c.n, c.p))); });`,
      { eval: true },
    );
    try {
      const values = await new Promise<number[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('binomialCdf exceeded the 8000 ms item budget')),
          8000,
        );
        worker.once('message', (result: number[]) => {
          clearTimeout(timer);
          resolve(result);
        });
        worker.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      reference['binomialCdf.huge-n-time'].forEach((c, i) => {
        close(values[i] as number, c.expected, 1e-6);
      });
    } finally {
      await worker.terminate();
    }
  }, 12000);
  it('erfc handles infinite and overflow-sized arguments', () => {
    expect(erfc(Infinity)).toBe(0);
    expect(erfc(-Infinity)).toBe(2);
    expect(erfc(1e200)).toBe(0);
    expect(erfc(-1e200)).toBe(2);
  });
});

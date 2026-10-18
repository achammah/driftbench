import { isDeepStrictEqual } from 'node:util';
import { captureIO } from './io';
import type { BankItem, PointerAdapter } from './types';

export type Outcome = { pass: boolean; detail: string };

/** Truth is constructed before invocation; the adapter sees only cloned requests. */
export async function runItem(item: BankItem, seed: number, adapter: PointerAdapter): Promise<Outcome> {
  try {
    const plant = item.generate(seed);
    if (plant.probes.length < 2) return { pass: false, detail: 'invalid plant: contrasting probes missing' };
    const expected = plant.probes.map((p) => structuredClone(p.expected));
    if (expected.every((v) => isDeepStrictEqual(v, expected[0]))) {
      return { pass: false, detail: 'invalid plant: all probe truths are identical' };
    }
    const started = performance.now();
    const budget = plant.budgetMs ?? 10_000;
    for (const [i, p] of plant.probes.entries()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let actual: unknown;
      const effects = captureIO(p.setup);
      try {
        actual = await Promise.race([
          Promise.resolve().then(() => adapter.execute(structuredClone(p.request), effects.io)),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('adapter exceeded item time budget')),
              Math.max(1, budget - (performance.now() - started)),
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (performance.now() - started > budget)
        return { pass: false, detail: `probe ${i}: time budget exceeded` };
      const trace = effects.snapshot();
      const bytes = Buffer.byteLength(JSON.stringify({ actual, trace }));
      if (bytes > (plant.budgetBytes ?? 64 * 1024 * 1024))
        return { pass: false, detail: `probe ${i}: response byte budget exceeded` };
      const observed = p.observe ? p.observe(actual, trace) : actual;
      if (!isDeepStrictEqual(observed, expected[i])) {
        // Do not dump actual: a deliberately leaky adapter must not leak through validator feedback.
        return {
          pass: false,
          detail: `probe ${i}: observed output differs from planted truth (${item.design})`,
        };
      }
    }
    return { pass: true, detail: 'every contrasting probe matches its planted truth' };
  } catch {
    return { pass: false, detail: 'adapter, projection, or fixture failed; output withheld for privacy' };
  }
}

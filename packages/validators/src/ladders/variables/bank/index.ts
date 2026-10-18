import { performance } from 'node:perf_hooks';
import { checkRelations, checkRun } from './oracle';
import { planItems } from './plan-items';
import { scheduleCases, shuffled } from './schedule';
import { storeItems } from './store-items';
import type { BankItem, Outcome, Run, VariablesAdapter } from './types';

export * from './types';
export const items: readonly BankItem[] = [...storeItems(), ...planItems()].map((item) => ({
  ...item,
  generate(seed) {
    const cases = item.generate(seed);
    const first = cases.find((test) => test.request.operation === 'plan');
    if (first) {
      const identity = structuredClone(first);
      if (identity.request.operation === 'plan') identity.request.store.version += '-fictional-revision';
      cases.push(structuredClone(first), identity);
    }
    return scheduleCases(cases, seed, item.id);
  },
}));

export async function runItem(item: BankItem, seed: number, adapter: VariablesAdapter): Promise<Outcome> {
  try {
    const runs: Run[] = [];
    const cases = item.generate(seed);
    for (const test of cases) {
      const before = process.memoryUsage().heapUsed;
      const start = performance.now();
      // Copy only the request. The implementation cannot mutate its expected result.
      const result = await adapter.execute(structuredClone(test.request));
      const run = {
        case: test,
        result,
        ms: performance.now() - start,
        heapBytes: Math.max(0, process.memoryUsage().heapUsed - before),
      };
      checkRun(run);
      runs.push(run);
    }
    checkRelations(runs);
    return { pass: true, detail: `${cases.length} planted cases matched` };
  } catch (error) {
    return { pass: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Adapter-only, intentionally not registered before a separate seat wires the real implementation. */
export async function measure(seed: number, adapter: VariablesAdapter, allLevels = false) {
  const entries: (BankItem & Outcome)[] = [];
  let level = 0;
  for (let tier = 1; tier <= 5; tier++) {
    const own = shuffled(
      items.filter((item) => item.level === tier),
      `item-order:${seed}:${tier}`,
    );
    const outcomes = [];
    for (const item of own) {
      const outcome = await runItem(item, seed, adapter);
      outcomes.push(outcome);
      entries.push({ ...item, ...outcome });
    }
    if (outcomes.every((outcome) => outcome.pass) && level === tier - 1) level = tier;
    else if (!allLevels) break;
  }
  const evaluatedScore = entries.filter((entry) => entry.pass).length / entries.length;
  return { level, entries, evaluatedScore, score: entries.length === items.length ? evaluatedScore : null };
}

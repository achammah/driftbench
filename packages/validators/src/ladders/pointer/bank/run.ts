import { rngFor } from '@agent-nexus/driftbench-generate';
import { type PointerSut, ReaderNotReachable } from '../sut/port';
import { fail, type Outcome, type PointerItem, Problem } from './types';

/** The longest an item may take before it fails, in milliseconds. */
export const ITEM_TIMEOUT_MS = 180_000;
/** Scale items run children that may take ten minutes each. */
export const SCALE_TIMEOUT_MS = 1_500_000;

const cache = new Map<string, Promise<Outcome>>();

/** Forgets seed-free results: the tests call it when they change the system under test. */
export function clearSeedFreeCache(): void {
  cache.clear();
}

async function execute(item: PointerItem, seed: number, sut: PointerSut): Promise<Outcome> {
  let timer: NodeJS.Timeout | undefined;
  const limit = item.family === 'scale' ? SCALE_TIMEOUT_MS : ITEM_TIMEOUT_MS;
  try {
    const timeout = new Promise<Outcome>((resolve) => {
      timer = setTimeout(
        () => resolve(fail(`the item did not finish within ${Math.round(limit / 1000)} s`)),
        limit,
      );
    });
    const work = item.run({ seed, id: item.id, sut, rng: rngFor(seed, item.id) });
    return await Promise.race([work, timeout]);
  } catch (cause) {
    if (cause instanceof ReaderNotReachable) return fail(cause.message);
    if (cause instanceof Problem) return fail(cause.message);
    return fail(`the item threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Runs one item on a seed. A seed-free item runs once per process and system and holds for every seed. */
export function runItem(item: PointerItem, seed: number, sut: PointerSut): Promise<Outcome> {
  if (!item.seedFree) return execute(item, seed, sut);
  const key = `${sut.name}:${item.id}`;
  let known = cache.get(key);
  if (!known) {
    known = execute(item, 1, sut);
    cache.set(key, known);
  }
  return known;
}

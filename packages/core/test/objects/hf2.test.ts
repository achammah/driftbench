// HF2 as a CI test: the 259 stored H1 runs (copied byte for byte from research/block-phrasing, sha in
// SHA256SUMS) re-scored by the shipped checks, with each block's spec read through the framework's loader,
// give the stored verdicts: 0 changed verdicts, 0 runs whose pass flag changed.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbidden, tools } from '@agent-nexus/driftbench-checks';
import { loadSpecFile, type Spec, type Verdict } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCKS, failedLikeStored, h1Context, h1Runs, multisetDiff } from './h1';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');

const specs = new Map<string, Spec>();
beforeAll(async () => {
  for (const def of Object.values(BLOCKS)) {
    if (specs.has(def.spec)) continue;
    const loaded = await loadSpecFile(join(ROOT, def.spec));
    if (!loaded.ok) throw new Error(`${def.spec}: ${JSON.stringify(loaded.errors)}`);
    specs.set(def.spec, loaded.spec);
  }
});

describe('HF2: default parity over the 259 stored H1 runs', () => {
  it('re-scores every stored run to its stored verdicts', async () => {
    const runs = h1Runs();
    expect(runs.length).toBe(259);
    let changed = 0;
    let passChanged = 0;
    let gating = 0;
    const rows: string[] = [];
    for (const run of runs) {
      const def = BLOCKS[run.block];
      if (!def) throw new Error(run.block);
      const ctx = h1Context(specs.get(def.spec) as Spec, def.index, run);
      const verdicts: Verdict[] = [];
      for (const check of [tools, forbidden])
        if (check.applies(ctx)) verdicts.push(...(await check.evaluate(ctx)));
      gating += verdicts.filter((verdict) => verdict.gating).length;
      const failed = failedLikeStored(ctx, verdicts);
      const diff = multisetDiff(run.exactFailed, failed);
      changed += diff;
      if (run.exact !== (failed.length === 0)) passChanged += 1;
      if (diff > 0) rows.push(`${run.id}: stored ${run.exactFailed.join(',')} now ${failed.join(',')}`);
    }
    expect(rows).toEqual([]);
    expect(changed).toBe(0);
    expect(passChanged).toBe(0);
    expect(runs.filter((run) => run.exact).length).toBe(77);
    expect(gating).toBeGreaterThan(1_000);
  });
});

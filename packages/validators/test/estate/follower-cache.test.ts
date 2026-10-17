import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { genCompleteFamily } from '../../src/ladders/estate/bank/loop';
import * as follower from '../../src/ladders/estate/follower';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { referenceChecks, referenceRun, required, SUFFIXES, suffix } from './ruling-reference';

const SEEDS = [1, 2, 3, 1_000_000 + (0x88920017 % 1_000_000_000)];
const cold = (run: pipeline.EstateRun): pipeline.EstateRun => ({
  ...run,
  estate: structuredClone(run.estate),
  situations: structuredClone(run.situations),
  rendered: { ...run.rendered, files: { ...run.rendered.files } },
});

async function measure(run: pipeline.EstateRun) {
  const source = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
  const checks = vi.spyOn(pipeline, 'replayChecks').mockReturnValue(referenceChecks());
  try {
    const table = await genCompleteFamily().evaluate(run.estate.seed);
    return SUFFIXES.map((key) => ({
      item: `gen.complete.${key}`,
      ...required(table.get(`gen.complete.${key}`)),
    }));
  } finally {
    source.mockRestore();
    checks.mockRestore();
  }
}

describe('estate follower cache dependencies', { timeout: 600_000 }, () => {
  it('preserves every item result across cold and shared dependency identities', async () => {
    const rows = [];
    for (const seed of SEEDS) {
      const full = referenceRun(await pipeline.generationRun(seed));
      const run = { ...full, specs: full.specs.filter((spec) => SUFFIXES.includes(suffix(full, spec))) };
      const before = await measure(cold(run));
      const after = await measure({ ...run });
      const reused = await measure({ ...run });
      expect(after).toEqual(before);
      expect(reused).toEqual(before);
      expect(before.every((row) => row.pass)).toBe(true);
      const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
      rows.push({
        seed,
        before,
        after,
        reused,
        beforeHash: digest(before),
        afterHash: digest(after),
        reusedHash: digest(reused),
      });
    }
    const file = fileURLToPath(
      new URL('../../../../validators/estate/FOLLOWER-CACHE-PARITY.json', import.meta.url),
    );
    if (process.env.UPDATE_FOLLOWER_CACHE_PARITY === '1') {
      // The record is rewritten only on request, and formatted as the repository formats JSON.
      writeFileSync(file, `${JSON.stringify({ seeds: SEEDS, rows }, null, 2)}\n`);
      const formatted = spawnSync('pnpm', ['exec', 'biome', 'format', '--write', file], { encoding: 'utf8' });
      if (formatted.status !== 0)
        throw new Error(`biome format failed: ${formatted.stdout}${formatted.stderr}`);
    } else {
      // Otherwise the run is compared with the committed record, and the file is left as it is.
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ seeds: SEEDS, rows });
    }
  });

  it('invalidates every input dependency and never shares a writable observation', async () => {
    const original = referenceRun(await pipeline.generationRun(1));
    const run = cold(original);
    const spec = required(
      run.specs.find((entry) => SUFFIXES.includes(suffix(run, entry)) && entry.loaded)?.loaded,
    );
    const follow = vi.spyOn(follower, 'follow');
    try {
      const first = await pipeline.replayOnFollower(run, spec, referenceChecks());
      await pipeline.replayOnFollower({ ...run }, spec, referenceChecks());
      expect(follow).toHaveBeenCalledTimes(1);
      await pipeline.replayOnFollower(
        { ...run, estate: structuredClone(run.estate) },
        spec,
        referenceChecks(),
      );
      await pipeline.replayOnFollower(
        { ...run, situations: structuredClone(run.situations) },
        spec,
        referenceChecks(),
      );
      await pipeline.replayOnFollower(
        { ...run, rendered: { ...run.rendered, files: { ...run.rendered.files } } },
        spec,
        referenceChecks(),
      );
      expect(follow).toHaveBeenCalledTimes(4);
      await pipeline.replayOnFollower(run, spec, referenceChecks(), undefined, (observed) => {
        observed.toolCalls = [];
        observed.runtime = undefined;
      });
      const restored = await pipeline.replayOnFollower({ ...run }, spec, referenceChecks());
      expect(restored).toEqual(first);
      expect(follow).toHaveBeenCalledTimes(4);
    } finally {
      follow.mockRestore();
    }
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite, generateSuiteToDisk, REPORT_FILE } from '../../src/enumerate';

const CHILD = fileURLToPath(new URL('./fixtures/heap-child.ts', import.meta.url));

/** Runs the child under a heap cap, in megabytes: its exit code and the spec count it printed. */
function underCap(mode: 'eager' | 'disk', factor: number, megabytes: number, out: string) {
  const run = spawnSync(
    process.execPath,
    [`--max-old-space-size=${megabytes}`, '--import', 'tsx', CHILD, mode, String(factor), join(out, mode)],
    { encoding: 'utf8', maxBuffer: 1 << 24 },
  );
  return { status: run.status, specs: Number(run.stdout.trim()), stderr: run.stderr };
}

describe('generation to disk at scale', () => {
  it.each([1, 5, 1009])(
    'writes the eager files on an explicitly imbalanced map, seed %s',
    async (seed) => {
      const hidden = hiddenSpec(seed);
      // Construct the imbalance explicitly. A random map can already be balanced after another
      // fixture invariant changes; its seed does not promise that the top-up path will run.
      for (let index = 0; index < 64; index += 1)
        hidden.phrases.push({
          dimension: 'deviation',
          value: 'D1_off_topic',
          text: `Tell me about unrelated parcel topic ${index + 1}.`,
          lang: hidden.lang,
          intent: { kind: 'deviation', class: 'D1_off_topic' },
        });
      const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
      if (!source.prepared) throw new Error('the fictional map failed to load');
      const options = { mapPath: '../map.yaml', seed };
      const eager = generateSuite(source.prepared, options);
      expect(eager.files.some((file) => file.path.includes('gen-deviation-balance-'))).toBe(true);
      const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-balance-'));
      try {
        const disk = generateSuiteToDisk(source.prepared, { ...options, outputDir: directory });
        expect(disk.summary).toEqual(eager.report.summary);
        expect(disk.fileCount).toBe(eager.files.length);
        for (const file of eager.files.filter((entry) => entry.path !== REPORT_FILE))
          expect(await readFile(join(directory, file.path), 'utf8'), file.path).toBe(file.text);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    300_000,
  );

  it('writes the eager files, byte for byte, with the restated-slot and phrase specs', async () => {
    const seed = 1;
    const hidden = hiddenSpec(seed);
    const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
    if (!source.prepared) throw new Error('the fictional map failed to load');
    const options = { mapPath: '../map.yaml', seed };
    const eager = generateSuite(source.prepared, options);
    expect(eager.files.some((file) => file.path.includes('gen-restated-'))).toBe(true);
    expect(eager.files.some((file) => file.path.includes('gen-phrase-'))).toBe(true);
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-seeders-'));
    try {
      const disk = generateSuiteToDisk(source.prepared, { ...options, outputDir: directory });
      expect(disk.summary).toEqual(eager.report.summary);
      expect(disk.fileCount).toBe(eager.files.length);
      for (const file of eager.files.filter((entry) => entry.path !== REPORT_FILE))
        expect(await readFile(join(directory, file.path), 'utf8'), file.path).toBe(file.text);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);

  it('keeps the heap under a cap the eager API runs out of', async () => {
    // Twenty times the behaviours gives over 3000 valid specs after ownership exclusions. Keep the
    // workload above that size and the same 96 MB cap for both APIs: eager exhausts it, disk completes.
    const factor = 20;
    const out = await mkdtemp(join(tmpdir(), 'driftbench-stream-heap-'));
    try {
      const eager = underCap('eager', factor, 96, out);
      expect(eager.status, eager.stderr.slice(-400)).not.toBe(0);
      expect(eager.stderr).toContain('heap out of memory');
      const disk = underCap('disk', factor, 96, out);
      expect(disk.status, disk.stderr.slice(-400)).toBe(0);
      expect(disk.specs).toBeGreaterThan(3000);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 600_000);
});

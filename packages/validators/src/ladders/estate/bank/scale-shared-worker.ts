import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EstateMap, readerFor, scanEstate } from '@agent-nexus/driftbench-estate';
import { RUNTIME } from '../layout';
import { writeEstate } from '../pipeline';
import { cli } from './bench';
import { planConsole } from './scale-real-facts';
import { sharedEstate } from './scale-shared-estate';
import { sharedFacts } from './scale-shared-facts';

/**
 * Runs the loop once on a shared-index estate and prints one JSON line: the time of the scan and of the plan, the
 * facts of the map against the planted truth, and the line count of the real plan command.
 * Usage: scale-shared-worker <seed> <scale>.
 */

const NOW = () => new Date('2026-10-11T00:00:00.000Z');

async function main(): Promise<void> {
  const [seedText, scaleText] = process.argv.slice(2);
  const seed = Number(seedText);
  const scale = Number(scaleText);
  const planted = sharedEstate(seed, { scale });
  const root = await writeEstate(planted.files);
  // No user layer: the home folder is empty.
  const home = await mkdtemp(join(tmpdir(), 'scale-shared-home-'));
  process.env.HOME = home;
  const reader = readerFor(RUNTIME);
  if (!reader) throw new Error('no reader');
  try {
    let started = Date.now();
    const result = await scanEstate({ root, reader, now: NOW });
    const scanMs = Date.now() - started;
    const map: EstateMap = {
      ...result.map,
      atoms: result.map.atoms.map((atom) => ({ ...atom, approved: true })),
    };
    const out: Record<string, unknown> = {
      seed,
      scale,
      files: planted.truth.files.length,
      units: planted.truth.units.length,
      scanMs,
      atoms: map.atoms.length,
      edges: map.edges.length,
      facts: sharedFacts(map, planted.truth),
    };
    const work = await mkdtemp(join(tmpdir(), 'scale-shared-cli-'));
    try {
      started = Date.now();
      const scanned = cli(['estate', 'scan', root, '--no-model', '--out', join(work, 'map.yaml')]);
      const planOut = cli(['estate', 'plan', join(work, 'map.yaml'), '--out', join(work, 'plan.yaml')]);
      out.planMs = Date.now() - started;
      out.planConsoleLines = planConsole({
        scanCode: scanned.code,
        planCode: planOut.code,
        planWritten: existsSync(join(work, 'plan.yaml')),
        summaryWritten: existsSync(join(work, 'plan.summary.json')),
        out: planOut.out,
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((cause) => {
  process.stdout.write(
    `${JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) })}\n`,
  );
  process.exitCode = 1;
});

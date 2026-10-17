/**
 * The child process of one scale run: `node --import tsx scale-child.ts <factor> <seed> <budgetMs> [generator]`.
 * It generates the scaled hidden specification twice, measures the time, reads the report, runs the rule
 * follower on every complete spec, and prints one JSON line (a ScaleReport). The time it reports is the CPU
 * time of rendering, setup, all map loads, both generations and writes, the byte comparison, reload and
 * cleanup, as before. Follower execution is excluded; the parent enforces a separate wall-clock cap.
 *
 * The child holds one suite at a time, never two: each generation is written to its own folder and dropped,
 * the folders are compared file by file, and every spec is loaded, checked and dropped one at a time. When
 * the generator package exports `generateSuiteToDisk`, the documented disk API that writes one spec at a time
 * (docs/generating.md, "Streaming generation to disk"), the child generates through it, so the memory budget
 * measures the generator's bounded path and not a whole suite the harness itself keeps. The optional fourth
 * argument names a module overriding `generateSuiteToDisk` or `loadApprovedMap`: tests plant mutants with it.
 *
 * Beside the measured window the child runs the reference unit sampler (`scale-unit.ts`) and reports the mean CPU
 * time of the units that ended inside the window, with their count: the time items divide the window's CPU time
 * by it. `DRIFTBENCH_SCALE_UNIT_IMPORT` names a module the sampler imports first: tests plant a slower host.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type LoadedSpec, loadSpecFile } from '@agent-nexus/driftbench-core';
import * as generator from '@agent-nexus/driftbench-generate';
import {
  blockOutcome,
  COMPLETE_DIR,
  type GenerateResult,
  generateSuite,
  loadApprovedMap,
  type PreparedMap,
  runOnce,
  thenFields,
} from '@agent-nexus/driftbench-generate';
import { createFollower } from './follower';
import { followerAdapter, MAP_PATH, runContext, writeAll } from './measure';
import { MAP_FILES, renderMap } from './render';
import { SCALE_UNIT_WARMUP, type ScaleReport, scaledSpec } from './scale';

/** The disk API's call, as the generator documents it. */
type ToDisk = (
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
) => { reportPath: string };

const [factorText, seedText, budgetText, generatorModule] = process.argv.slice(2);
const factor = Number(factorText);
const seed = Number(seedText);
const budgetMs = Number(budgetText);
const spec = scaledSpec(seed, factor);
const overrides = generatorModule
  ? ((await import(pathToFileURL(generatorModule).href)) as {
      generateSuiteToDisk?: ToDisk;
      loadApprovedMap?: typeof loadApprovedMap;
    })
  : {};
const toDisk =
  overrides.generateSuiteToDisk ??
  ((generator as Record<string, unknown>).generateSuiteToDisk as ToDisk | undefined);
const loadMap = overrides.loadApprovedMap ?? loadApprovedMap;

/** Every file under a folder, as sorted paths relative to it with forward slashes. */
async function filesUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  await walk(root);
  return out.sort();
}

/** The paths that differ between two written suites: present in one only, or with other bytes. */
async function differing(first: string, second: string): Promise<string[]> {
  const a = await filesUnder(first);
  const b = await filesUnder(second);
  const inA = new Set(a);
  const inB = new Set(b);
  const out = [...a.filter((path) => !inB.has(path)), ...b.filter((path) => !inA.has(path))];
  for (const path of a) {
    if (!inB.has(path)) continue;
    const [left, right] = await Promise.all([readFile(join(first, path)), readFile(join(second, path))]);
    if (!left.equals(right)) out.push(path);
  }
  return out;
}

/** The spec files of a written suite, as the core loader finds them. */
function isSpec(path: string): boolean {
  const name = path.split('/').at(-1) ?? '';
  return (
    !path.split('/').some((part) => part.startsWith('.')) &&
    (/\.(ya?ml)$/i.test(name) || /\.spec\.json$/i.test(name))
  );
}

/** The reference unit samples, as [end wall time, CPU ms], read from the sampler while it runs. */
const units: Array<[number, number]> = [];
const planted = process.env.DRIFTBENCH_SCALE_UNIT_IMPORT;
const sampler = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    ...(planted ? ['--import', pathToFileURL(planted).href] : []),
    fileURLToPath(new URL('./scale-unit.ts', import.meta.url)),
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
// A sampler that stops early leaves fewer samples, which the time item reports; it never stops the child.
let samplerErr = '';
sampler.stderr.on('data', (chunk) => {
  samplerErr = `${samplerErr}${String(chunk)}`.slice(-2000);
});
sampler.stdin.on('error', () => {});
const samplerClosed = new Promise<void>((resolve) => {
  sampler.on('close', (code) => {
    if (code !== 0 && code !== null)
      process.stderr.write(`reference unit sampler exited ${code}: ${samplerErr}\n`);
    resolve();
  });
  sampler.on('error', () => resolve());
});
let unitText = '';
sampler.stdout.on('data', (chunk) => {
  unitText += String(chunk);
  const lines = unitText.split('\n');
  unitText = lines.pop() ?? '';
  for (const line of lines) {
    const [end, ms] = line.split(' ').map(Number);
    if (Number.isFinite(end) && Number.isFinite(ms)) units.push([end as number, ms as number]);
  }
});

// The sampler's first units run before its code is compiled and cost more: the window starts once
// SCALE_UNIT_WARMUP units have ended (or after 30 s), so a short window is not read in cold units.
const warmed = Date.now() + 30_000;
while (units.length < SCALE_UNIT_WARMUP && Date.now() < warmed)
  await new Promise((resolve) => setTimeout(resolve, 20));

// Match the old generateFrom(spec, renderMap(spec), seed) window, including setup and the first load.
// CPU time (user and system) excludes time spent waiting for a busy machine.
const windowStart = Date.now();
const started = process.cpuUsage();
const root = await mkdtemp(join(tmpdir(), 'driftbench-vscale-'));
let measuredMicros = 0;
let unitMs = 0;
let unitSamples = 0;
let out: ScaleReport;
try {
  const mapDir = join(root, 'map');
  await mkdir(mapDir);
  const rendered = renderMap(spec);
  for (const [key, name] of Object.entries(MAP_FILES))
    await writeFile(join(mapDir, name), rendered[key as keyof typeof rendered]);
  const loaded = await loadMap(join(mapDir, MAP_FILES.map));
  if (!loaded.ok) throw new Error(`refused: ${loaded.message}`);
  let report: GenerateResult['report'] | undefined;
  for (const folder of ['first', 'second']) {
    const again = await loadMap(join(mapDir, MAP_FILES.map));
    if (!again.ok) throw new Error(`the map loaded once and was refused the second time: ${again.message}`);
    const outputDir = join(root, folder);
    if (toDisk) {
      const result = toDisk(again.prepared, { seed, mapPath: MAP_PATH, outputDir });
      report ??= JSON.parse(await readFile(result.reportPath, 'utf8')) as GenerateResult['report'];
    } else {
      const result = generateSuite(again.prepared, { seed, mapPath: MAP_PATH });
      await writeAll(outputDir, result.files);
      report ??= result.report;
    }
  }
  const differ = await differing(join(root, 'first'), join(root, 'second'));
  const specFiles = (await filesUnder(join(root, 'first'))).filter(isSpec);
  let loadFailures = 0;
  const complete: string[] = [];
  for (const path of specFiles) {
    const result = await loadSpecFile(join(root, 'first', path));
    if (!result.ok) loadFailures += 1;
    else if (path.startsWith(`${COMPLETE_DIR}/`)) complete.push(path);
  }
  const used = process.cpuUsage(started);
  measuredMicros = used.user + used.system;
  const windowEnd = Date.now();
  sampler.stdin.end();
  await Promise.race([samplerClosed, new Promise((resolve) => setTimeout(resolve, 30_000))]);
  sampler.kill('SIGKILL');
  const inside = units.filter(([end]) => end >= windowStart && end <= windowEnd).map(([, ms]) => ms);
  unitSamples = inside.length;
  unitMs = inside.reduce((sum, ms) => sum + ms, 0) / Math.max(1, inside.length);
  const adapter = followerAdapter(createFollower(spec));
  let followerPass = 0;
  let followerTotal = 0;
  for (const path of complete) {
    const generatedSpec = ((await loadSpecFile(join(root, 'first', path))) as LoadedSpec).spec;
    const run = await runOnce(generatedSpec, adapter, 1, runContext());
    generatedSpec.blocks.forEach((_block, index) => {
      if (thenFields(generatedSpec, index).length === 0) return;
      followerTotal += 1;
      if (blockOutcome(run, index) === 'pass') followerPass += 1;
    });
  }
  const graph = report?.graph;
  const boundaryValues = spec.data.length;
  out = {
    factor,
    budgetMs,
    ms: 0,
    invalid: (report?.invalid.length ?? 0) + loadFailures,
    lint: report?.lint.length ?? 0,
    bytesSame: differ.length === 0,
    graphOk:
      graph !== undefined &&
      graph.blocked.length === 0 &&
      graph.covered === graph.edges - graph.unreachable.length,
    graphDetail: graph
      ? `${graph.covered} of ${graph.edges} edges covered, ${graph.blocked.length} blocked`
      : 'no report',
    twiseShare: report?.twise.share ?? 0,
    boundaryOk: (report?.boundary.values ?? 0) >= boundaryValues,
    boundaryMissing: Math.max(0, boundaryValues - (report?.boundary.values ?? 0)),
    deviationOk: (report?.deviation.probes.length ?? 0) >= spec.deviations.length,
    deviationMissing: Math.max(0, spec.deviations.length - (report?.deviation.probes.length ?? 0)),
    unwalked: graph?.unwalked?.length ?? 0,
    completeShare: report && report.summary.specs > 0 ? report.summary.complete / report.summary.specs : 0,
    followerPass,
    followerTotal,
    unitMs,
    unitSamples,
  };
} finally {
  sampler.kill('SIGKILL');
  // Files must survive for the follower's one-spec-at-a-time reads. Count their cleanup separately,
  // keeping follower execution and its extra reads outside the original generation-time window.
  const cleanupStarted = process.cpuUsage();
  await rm(root, { recursive: true, force: true });
  const cleanupUsed = process.cpuUsage(cleanupStarted);
  measuredMicros += cleanupUsed.user + cleanupUsed.system;
}
out.ms = Math.round(measuredMicros / 1000);
process.stdout.write(`${JSON.stringify(out)}\n`);

import { cp, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpecFile, type Spec } from '@agent-nexus/driftbench-core';
import { cli, REPO } from './bench';

/**
 * The generated suite of the Northwind fixture (examples/estates/fixture, fictional, written by hand), made
 * by the component as it is checked out: the committed plan approved whole, then `estate generate`. Built
 * once per process. The kill, generation-quality and maintenance families read it.
 */

export const FIXTURE = join(REPO, 'examples/estates/fixture');
export const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
/** The fixture's state library: the operations that plant a session state or an event, for specs that start from one. */
export const STATES = join(FIXTURE, 'live/states/library.json');
/** The fixture's stand-in judge: answers pass unless the judge prompt holds its fail phrase, and costs nothing. */
export const JUDGE = join(FIXTURE, 'live/fake/judge.cjs');

export type SuiteSpec = {
  path: string;
  id: string;
  atoms: string[];
  testType: string;
  mode: string;
  complete: boolean;
  spec: Spec;
};

export type FixtureSuite = {
  work: string;
  map: string;
  specs: SuiteSpec[];
  /**
   * The native unit tests (JSON records under unit/) `estate unit` reads. Kept apart from `specs`: the families that
   * judge the generated core specs (generation quality, coverage, kills of live specs) must read nothing else.
   */
  natives: SuiteSpec[];
  report: { gaps?: Array<{ marker: string; specs: number; atoms: string[] }> };
};

let built: Promise<FixtureSuite> | undefined;

export function fixtureSuite(): Promise<FixtureSuite> {
  built ??= build();
  return built;
}

async function build(): Promise<FixtureSuite> {
  const work = await mkdtemp(join(tmpdir(), 'estate-fixture-suite-'));
  // The estate beside its map: `estate generate` lists the files of the folder the map's root names, and a read is
  // expected only of a file the estate holds (docs/estate.md section 5, `needs-existing-file`). Without the estate
  // beside the map every read counts as a read of a missing file.
  await cp(join(FIXTURE, 'CLAUDE.md'), join(work, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude'), join(work, '.claude'), { recursive: true });
  for (const name of ['approved.yaml', 'plan.yaml', 'phrases.yaml'])
    await cp(join(FIXTURE, name), join(work, name));
  const approve = cli(['estate', 'plan', 'approve', join(work, 'plan.yaml'), '--all']);
  if (approve.code !== 0)
    throw new Error(`plan approve exited ${approve.code}: ${approve.out.slice(0, 200)}`);
  const out = join(work, 'suite');
  // Exit 1 means some specs are incomplete: the suite is written all the same.
  const generated = cli([
    'estate',
    'generate',
    '--map',
    join(work, 'approved.yaml'),
    '--plan',
    join(work, 'plan.yaml'),
    '--out',
    out,
  ]);
  if (generated.code > 1)
    throw new Error(`generate exited ${generated.code}: ${generated.out.slice(0, 200)}`);
  const specs: SuiteSpec[] = [];
  for (const [folder, complete] of [
    ['specs', true],
    ['incomplete', false],
  ] as const) {
    for (const path of await yamlFiles(join(out, folder))) {
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) continue;
      const estate = (loaded.spec.metadata?.estate ?? {}) as {
        atoms?: string[];
        testType?: string;
        mode?: string;
      };
      specs.push({
        path,
        id: loaded.spec.id,
        atoms: estate.atoms ?? [],
        testType: estate.testType ?? '',
        mode: estate.mode ?? '',
        complete,
        spec: loaded.spec,
      });
    }
  }
  // Static checks (invariants, settings) are JSON records of one atom, run by the static runner: complete.
  const statics = (
    await readdir(join(out, 'static'), { withFileTypes: true, recursive: true }).catch(() => [])
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name));
  for (const path of statics) {
    const record = JSON.parse(await readFile(path, 'utf8')) as {
      id: string;
      atom?: string;
      testType?: string;
    };
    specs.push({
      path,
      id: record.id,
      atoms: record.atom ? [record.atom] : [],
      testType: record.testType ?? '',
      mode: 'static',
      complete: true,
      spec: { blocks: [] } as unknown as Spec,
    });
  }
  // Unit tests (guards on event payloads, scripts on their fixtures) are native JSON records under unit/, which
  // `estate unit` reads; their outcomes are recorded on the original before a copy is checked. They are listed
  // under their own mode, since the YAML specs of mode `unit` are the core specs of the same atoms.
  const natives = (await readdir(join(out, 'unit'), { withFileTypes: true, recursive: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name));
  const nativeSpecs: SuiteSpec[] = [];
  for (const path of natives.sort()) {
    const record = JSON.parse(await readFile(path, 'utf8')) as {
      id: string;
      atom?: string;
      testType?: string;
    };
    nativeSpecs.push({
      path,
      id: record.id,
      atoms: record.atom ? [record.atom] : [],
      testType: record.testType ?? '',
      mode: 'native-unit',
      complete: true,
      spec: { blocks: [] } as unknown as Spec,
    });
  }
  const report = JSON.parse(
    await readFile(join(out, 'estate-generate-report.json'), 'utf8'),
  ) as FixtureSuite['report'];
  return { work, map: join(work, 'approved.yaml'), specs, natives: nativeSpecs, report };
}

async function yamlFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** One spec's run on the fake runtime: whether it passed, whether it ran to its end, and what failed. */
export type FakeVerdict = { pass: boolean; completed: boolean; failing: string[] };

/**
 * Whether a failing verdict of a run comes from a machine check. The stand-in judge answers pass unless its prompt
 * holds its fail phrase, so a judged criterion says nothing about whether the agent kept a rule; a run turns red
 * for a mutant only on a verdict the evidence itself decides.
 */
export function machineFailure(failing: string): boolean {
  return !/^block \d+: judge\./.test(failing);
}

/** Runs specs with the fake runtime on an estate root; the run per spec id. */
export function runOnFakeDetailed(
  estate: string,
  specs: readonly string[],
  store: string,
  map?: string,
): Map<string, FakeVerdict> {
  const result = cli([
    'estate',
    'run',
    ...specs,
    '--estate',
    estate,
    '--runtime',
    'claude-code',
    '--command',
    FAKE,
    '--store',
    store,
    '--states',
    STATES,
    '--judge',
    'claude:haiku',
    '--judge-command',
    JUDGE,
    ...(map ? ['--map', map] : []),
    '--json',
  ]);
  const verdicts = new Map<string, FakeVerdict>();
  const at = result.out.indexOf('{');
  if (at < 0) return verdicts;
  try {
    const json = JSON.parse(result.out.slice(at)) as {
      runs?: Array<{ spec: string; status?: string; pass: boolean; failing?: string[] }>;
    };
    for (const run of json.runs ?? [])
      verdicts.set(run.spec, {
        pass: run.pass === true,
        completed: run.status === 'completed',
        failing: run.failing ?? [],
      });
  } catch {
    // No JSON: every spec counts as not passing.
  }
  return verdicts;
}

/** Runs specs with the fake runtime on an estate root; the verdict per spec id. */
export function runOnFake(
  estate: string,
  specs: readonly string[],
  store: string,
  map?: string,
): Map<string, boolean> {
  return new Map(
    [...runOnFakeDetailed(estate, specs, store, map)].map(([id, verdict]) => [id, verdict.pass]),
  );
}

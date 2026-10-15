import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpecs } from '@agent-nexus/driftbench-core';
import { type Cassette, loadCassette, PROMPT_FINGERPRINT, requestKey } from '@agent-nexus/driftbench-judges';
import { openMemoryStore, openStore, readTree } from '@agent-nexus/driftbench-store';
import { findRoot } from '@agent-nexus/driftbench-validators';
import { Command, CommanderError } from 'commander';
import { makeRecordingClient, SpendBudget, type SpendRow } from './record';
import {
  type BenchFloor,
  type BenchReport,
  type BenchSlice,
  type CaseResult,
  checkFloor,
  playBenchClient,
  type RepeatEvidence,
  type RepeatRun,
  raiseFloor,
  recordBenchClient,
  replaySlice,
  scoreSlice,
  sha256,
  type VerifiedRepeatEvidence,
  validateReport,
  validateSlice,
  verifyRepeatEvidence,
} from './run';

type Io = { out: (text: string) => void; err: (text: string) => void; readonly cwd: string };

type Model = { id: string; model: string; status: 'active' | 'skipped'; reason?: string };
type SliceEntry = {
  name: string;
  version: number;
  hash: string;
  path: string;
  n: number;
  sourceCommit: string;
};
type Manifest = { version: 1; models: Model[]; slices: SliceEntry[] };
type Floors = { version: 1; floors: Record<string, BenchFloor>; history: BenchFloor[] };
type RecordEvidence = {
  format: 'driftbench-bench-record-v1';
  report: BenchReport;
  cassetteSha256: string;
  resolvedModels: string[];
  costUsd: number;
  chargedUsd: number;
  calls: number;
  spend: SpendRow[];
};
type Options = {
  root?: string;
  slice: string;
  model?: string;
  json?: boolean;
  checkFloor?: boolean;
  repeatEvidence?: string;
  store?: string;
  spendCapUsd?: string;
  spendLedger?: string;
  concurrency?: string;
  resume?: boolean;
};
const keyOf = (slice: string, version: number, model: string) => `${slice}@${version}/${model}`;
const paths = (root: string, entry: SliceEntry, model: string) => ({
  cassette: join(root, 'benchmarks/cassettes', `${entry.name}@${entry.version}`, `${model}.json`),
  evidence: join(root, 'benchmarks/evidence', `${entry.name}@${entry.version}`, `${model}.json`),
});
const headOf = (root: string) =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

export async function main(
  argv: string[],
  io: Io = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    cwd: process.cwd(),
  },
): Promise<number> {
  let exitCode = 0;
  const setExit = (code: number) => {
    exitCode = code;
  };
  const bench = new Command('bench')
    .description('Repository harness: record and replay the shipped judge against versioned planted truths.')
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.out(text), writeErr: (text) => io.err(text) });
  const common = (c: Command) =>
    c
      .option('--slice <name>', 'slice name or all', 'all')
      .option('--model <id>', 'one model; all active models for replay')
      .option('--root <path>', 'repository holding benchmarks/')
      .option('--store <file>', 'also register the exact dataset versions in this store')
      .option('--json', 'print a JSON report');
  common(bench.command('replay').description('Replay committed cassettes without network or credentials.'))
    .option('--check-floor', 'fail below the absolute or paired floor')
    .option(
      '--repeat-evidence <json>',
      'verified repeat files for the empirical paired check; requires --check-floor',
    )
    .action(async (o: Options) => setExit(await benchReplay(o, io)));
  common(bench.command('record').description('Record a maintainer run with a required USD spend cap.'))
    .requiredOption(
      '--spend-cap-usd <usd>',
      'maximum charged spend for this invocation, including in-flight reservations',
    )
    .option('--spend-ledger <path>', 'append each metered call to this ledger')
    .option('--concurrency <n>', 'parallel calls, 1..16', '4')
    .option('--resume', 'reuse matching successful recordings and resume partial slices')
    .action(async (o: Options) => setExit(await benchRecord(o, io)));
  bench
    .command('floors')
    .description('Show floors or raise one from current replay evidence.')
    .option('--root <path>', 'repository holding benchmarks/')
    .option('--raise <slice>', 'slice whose floor rises')
    .argument('[model]', 'model for --raise')
    .option('--evidence <json>', 'bench replay --json output, or record evidence')
    .option('--json', 'print JSON')
    .action(
      async (
        model: string | undefined,
        o: { root?: string; raise?: string; evidence?: string; json?: boolean },
      ) => setExit(await benchFloors(model, o, io)),
    );
  try {
    await bench.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode === 0 ? 0 : 2;
    throw cause;
  }
  return exitCode;
}
function rootOf(io: Io, root?: string) {
  return root ? resolve(io.cwd, root) : findRoot(io.cwd);
}
async function manifestAt(root: string): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(join(root, 'benchmarks/manifest.json'), 'utf8')) as Manifest;
  if (manifest.version !== 1 || !manifest.slices?.length || !manifest.models?.length)
    throw new Error('Invalid benchmark manifest');
  if (
    new Set(manifest.slices.map((s) => s.name)).size !== manifest.slices.length ||
    new Set(manifest.models.map((m) => m.id)).size !== manifest.models.length
  )
    throw new Error('Duplicate slice or model in manifest');
  for (const m of manifest.models) {
    if (
      !/^[a-z0-9][a-z0-9.-]*$/.test(m.id) ||
      !['active', 'skipped'].includes(m.status) ||
      !m.model ||
      (m.status === 'skipped' && !m.reason)
    )
      throw new Error('Invalid benchmark model');
  }
  for (const s of manifest.slices) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(s.name) ||
      !Number.isInteger(s.version) ||
      s.version < 1 ||
      s.path !== `benchmarks/slices/${s.name}/${s.version}` ||
      !/^[a-f0-9]{64}$/.test(s.hash) ||
      !Number.isInteger(s.n) ||
      s.n < 1
    )
      throw new Error('Invalid benchmark slice');
  }
  return manifest;
}
function selection(manifest: Manifest, options: Options) {
  const slices =
    options.slice === 'all' ? manifest.slices : manifest.slices.filter((s) => s.name === options.slice);
  if (!slices.length) throw new Error(`Unknown slice ${options.slice}`);
  const models = options.model
    ? manifest.models.filter((m) => m.id === options.model)
    : manifest.models.filter((m) => m.status === 'active');
  if (!models.length) throw new Error(`Unknown model ${options.model}`);
  for (const m of models) if (m.status !== 'active') throw new Error(`${m.id} skipped: ${m.reason}`);
  return { slices, models };
}
export async function loadBenchSlice(
  root: string,
  entry: SliceEntry,
  storePath?: string,
): Promise<BenchSlice> {
  const folder = join(root, entry.path);
  const specs = await loadSpecs([folder]);
  if (specs.length !== 1 || !specs[0]?.ok) throw new Error(`${entry.name}: invalid dataset spec`);
  const data = JSON.parse(await readFile(join(folder, 'cases.spec.json'), 'utf8'));
  const slice: BenchSlice = {
    name: entry.name,
    version: entry.version,
    hash: entry.hash,
    cases: data.metadata?.bench?.cases ?? data.metadata?.bench,
  };
  validateSlice(slice);
  if (slice.cases.length !== entry.n) throw new Error(`${entry.name}: manifest case count changed`);
  const tree = await readTree(folder);
  const memory = openMemoryStore();
  try {
    const pushed = await memory.pushVersion('dataset', entry.name, tree.files);
    if (pushed.version.hash !== entry.hash)
      throw new Error(`${entry.name}: dataset hash changed; create a new dataset version`);
  } finally {
    memory.close();
  }
  if (storePath) {
    const store = openStore(storePath);
    try {
      const pushed = await store.pushVersion('dataset', entry.name, tree.files, {
        note: `Bench slice version ${entry.version}; source ${entry.sourceCommit}`,
      });
      if (pushed.version.version !== entry.version || pushed.version.hash !== entry.hash)
        throw new Error(`${entry.name}: registry version conflicts with the manifest`);
    } finally {
      store.close();
    }
  }
  return slice;
}
async function readFloors(root: string): Promise<Floors> {
  const file = join(root, 'benchmarks/floors.json');
  if (!existsSync(file)) return { version: 1, floors: {}, history: [] };
  const floors = JSON.parse(await readFile(file, 'utf8')) as Floors;
  if (floors.version !== 1 || !floors.floors || !Array.isArray(floors.history))
    throw new Error('Invalid benchmark floors');
  return floors;
}
async function jsonWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, jsonText(value));
  await rename(temporary, path);
}
function jsonText(value: unknown): string {
  // JSON escapes preserve the exact model text while keeping repository typography stable.
  return `${JSON.stringify(value, null, 2).replace(/[\u2013\u2014]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)}\n`;
}
function validateSpendRows(value: unknown): asserts value is SpendRow[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (row) =>
        !row ||
        typeof row.model !== 'string' ||
        typeof row.resolvedModel !== 'string' ||
        !Number.isFinite(Date.parse(row.at)) ||
        !Number.isFinite(row.costUsd) ||
        row.costUsd < 0 ||
        !Number.isFinite(row.chargedUsd) ||
        row.chargedUsd < row.costUsd ||
        !['ok', 'error'].includes(row.status) ||
        !['provider', 'tokens', 'reserved-on-error'].includes(row.accounting),
    )
  )
    throw new Error('Invalid partial spending evidence');
}
async function verifiedReplay(
  root: string,
  entry: SliceEntry,
  model: Model,
  slice: BenchSlice,
  head: string,
) {
  const path = paths(root, entry, model.id);
  const text = await readFile(path.cassette, 'utf8');
  const cassette = await loadCassette(path.cassette);
  const evidence = JSON.parse(await readFile(path.evidence, 'utf8')) as RecordEvidence;
  if (evidence.format !== 'driftbench-bench-record-v1' || evidence.cassetteSha256 !== sha256(text))
    throw new Error(`re-record needed: ${entry.name}/${model.id}: cassette integrity mismatch`);
  const own = cassette.judges.find((j) => j.id === model.id);
  // Construction needs no credential or call; it discovers the current public client's settings.
  const expected = makeRecordingClient(
    model.id,
    new SpendBudget(1),
    { OPENAI_API_KEY: 'unused-no-network', GEMINI_API_KEY: 'unused-no-network' },
    () => {},
    { haikuModel: model.model },
  );
  if (
    !own ||
    cassette.judges.length !== 1 ||
    own.model !== model.model ||
    own.cls !== expected.cls ||
    own.settings !== expected.settings ||
    own.family !== expected.family
  )
    throw new Error(`re-record needed: ${entry.name}/${model.id}: client settings changed`);
  if (
    cassette.entries.length !== slice.cases.length ||
    cassette.entries.some((e) => e.error || e.answer !== undefined || e.answerContract !== 'ledger')
  )
    throw new Error(`re-record needed: ${entry.name}/${model.id}: incomplete or non-raw default cassette`);
  const report = await replaySlice(slice, cassette, model.id, { head });
  if (
    evidence.report.datasetHash !== report.datasetHash ||
    evidence.report.fingerprint !== report.fingerprint ||
    evidence.report.settings !== report.settings
  )
    throw new Error(`re-record needed: ${entry.name}/${model.id}: evidence is stale`);
  return { report, evidence };
}
/** Paths are relative to the repeat manifest, and content hashes bind both artifacts. */
async function loadRepeatFiles(file: string): Promise<Map<string, RepeatEvidence>> {
  const input = JSON.parse(await readFile(file, 'utf8'));
  if (
    input.format !== 'driftbench-bench-repeat-files-v1' ||
    !Array.isArray(input.groups) ||
    !input.groups.length
  )
    throw new Error('Invalid repeat file manifest');
  const groups = new Map<string, RepeatEvidence>();
  for (const group of input.groups) {
    if (!Array.isArray(group.old) || !Array.isArray(group.candidate) || !group.old[0]?.report)
      throw new Error('Incomplete repeat file group');
    const key = keyOf(group.slice, group.old[0].report.datasetVersion, group.judge);
    if (groups.has(key)) throw new Error('Duplicate repeat file group');
    const load = async (
      items: Array<
        Omit<RepeatRun, 'cassetteText' | 'receiptsText'> & {
          cassettePath: string;
          receiptsPath: string;
        }
      >,
    ) => {
      const runs: RepeatRun[] = [];
      for (const item of items) {
        if (
          typeof item.cassettePath !== 'string' ||
          typeof item.receiptsPath !== 'string' ||
          item.report?.slice !== group.slice ||
          item.report?.judge !== group.judge
        )
          throw new Error('Repeat file identity or paths are incomplete');
        runs.push({
          runId: item.runId,
          report: item.report,
          cassetteSha256: item.cassetteSha256,
          receiptsSha256: item.receiptsSha256,
          cassetteText: await readFile(resolve(dirname(file), item.cassettePath), 'utf8'),
          receiptsText: await readFile(resolve(dirname(file), item.receiptsPath), 'utf8'),
        });
      }
      return runs;
    };
    groups.set(key, {
      format: 'driftbench-bench-repeats-v1',
      old: await load(group.old),
      candidate: await load(group.candidate),
    });
  }
  return groups;
}
function printReport(io: Io, report: BenchReport, floor?: ReturnType<typeof checkFloor>) {
  const interval = (x: { lower: number; upper: number }) =>
    `[${(x.lower * 100).toFixed(2)}, ${(x.upper * 100).toFixed(2)}]%`;
  io.out(
    `${report.slice}@${report.datasetVersion} / ${report.judge}: ${report.correct}/${report.n}; Wilson ${interval(report.wilson)}; family bootstrap ${interval(report.familyBootstrap)}${floor ? `; floor ${floor.holds ? 'HOLDS' : 'FAILS'}` : ''}\n`,
  );
  if (floor?.paired)
    io.out(
      `  Paired: McNemar p=${floor.paired.mcnemar.pValue.toFixed(6)}, auto margin ${(floor.paired.nonInferiority.margin * 100).toFixed(1)}%; difference bootstrap ${interval(floor.paired.familyBootstrap)}\n`,
    );
  if (floor?.noiseRelative) {
    const noise = floor.noiseRelative;
    io.out(
      `  Paired repeats: empirical allowance ${noise.oldMaximumCorrectnessFlips}/${report.n}; median losses ${noise.medianCandidateDirectionalLosses}; candidate median ${noise.candidate.median}/${report.n} +/- ${noise.candidate.margin.cases} cases; range ${noise.candidate.minimum}-${noise.candidate.maximum}; best ${noise.selectedBestRun} (selected, not median)\n`,
    );
  }
  if (report.zeroFailure.observedClean)
    io.out(
      `  Zero failures: a <5% claim needs ${report.zeroFailure.requiredCleanCases} independent clean cases; construction families can be dependent.\n`,
    );
  for (const problem of floor?.problems ?? []) io.err(`  ${problem}\n`);
}
export async function benchReplay(options: Options, io: Io): Promise<number> {
  try {
    if (options.repeatEvidence && !options.checkFloor)
      throw new Error('--repeat-evidence requires --check-floor');
    const root = rootOf(io, options.root);
    const manifest = await manifestAt(root);
    const { slices, models } = selection(manifest, options);
    const defaultRepeatFile = join(root, 'benchmarks/repeats/manifest.json');
    const automaticRepeats = !options.repeatEvidence && options.checkFloor && existsSync(defaultRepeatFile);
    const repeatGroups =
      options.repeatEvidence || automaticRepeats
        ? await loadRepeatFiles(
            options.repeatEvidence ? resolve(io.cwd, options.repeatEvidence) : defaultRepeatFile,
          )
        : undefined;
    const verifiedGroups = new Map<string, VerifiedRepeatEvidence>();
    const cachedSlices = new Map<string, BenchSlice>();
    if (repeatGroups) {
      const coveredSlices = automaticRepeats ? manifest.slices : slices;
      const coveredModels = automaticRepeats ? manifest.models.filter((m) => m.status === 'active') : models;
      const required = new Set(
        coveredSlices.flatMap((s) => coveredModels.map((m) => keyOf(s.name, s.version, m.id))),
      );
      if (repeatGroups.size !== required.size || [...required].some((key) => !repeatGroups.has(key)))
        throw new Error(
          automaticRepeats
            ? 'Default repeat manifest must cover every active slice/model population'
            : 'Repeat files must cover exactly the selected slice/model populations',
        );
      // Validate the complete frozen manifest before filtering a subset, so unselected corrupt evidence fails too.
      const physical = new Set<string>();
      for (const [key, input] of repeatGroups) {
        const entry = manifest.slices.find(
          (s) => key === keyOf(s.name, s.version, input.old[0]?.report.judge ?? ''),
        );
        if (!entry) throw new Error('Repeat manifest names an unknown population');
        let slice = cachedSlices.get(entry.name);
        if (!slice) {
          slice = await loadBenchSlice(root, entry);
          cachedSlices.set(entry.name, slice);
        }
        const proof = await verifyRepeatEvidence(slice, input);
        for (const run of [...proof.old, ...proof.candidate])
          for (const call of JSON.parse(run.receiptsText).calls) {
            if (physical.has(call.id)) throw new Error('Physical receipt is reused across repeat groups');
            physical.add(call.id);
          }
        verifiedGroups.set(key, proof);
      }
    }
    const floors = await readFloors(root);
    const reports: BenchReport[] = [];
    const checks = [];
    const problems: string[] = [];
    const head = headOf(root);
    for (const entry of slices) {
      const slice =
        !options.store && cachedSlices.has(entry.name)
          ? (cachedSlices.get(entry.name) as BenchSlice)
          : await loadBenchSlice(root, entry, options.store ? resolve(io.cwd, options.store) : undefined);
      for (const model of models) {
        try {
          const current = await verifiedReplay(root, entry, model, slice, head);
          const repeats = verifiedGroups.get(keyOf(entry.name, entry.version, model.id));
          // Repeat identity names the physical recording source, not this offline replay's commit.
          const report = repeats ? { ...current.report, head: current.evidence.report.head } : current.report;
          reports.push(report);
          const floor = options.checkFloor
            ? checkFloor(report, floors.floors[keyOf(entry.name, entry.version, model.id)], repeats)
            : undefined;
          if (
            floor?.noiseRelative &&
            floor.noiseRelative.selectedCassetteSha256 !== current.evidence.cassetteSha256
          )
            throw new Error('Current cassette is not the selected best candidate repeat');
          if (floor) {
            checks.push({ slice: entry.name, model: model.id, ...floor });
            problems.push(...floor.problems);
          }
          if (!options.json) printReport(io, report, floor);
        } catch (cause) {
          problems.push(message(cause));
          if (!options.json) io.err(`${message(cause)}\n`);
        }
      }
    }
    const skipped = manifest.models.filter((m) => m.status === 'skipped');
    if (options.json)
      io.out(
        `${JSON.stringify({ format: 'driftbench-bench-replay-v1', reports, checks, problems, skipped }, null, 2)}\n`,
      );
    else for (const m of skipped) io.out(`Skipped ${m.id}: ${m.reason}\n`);
    return problems.length ? 1 : 0;
  } catch (cause) {
    io.err(`bench: ${message(cause)}\n`);
    return 2;
  }
}
export async function benchRecord(options: Options, io: Io): Promise<number> {
  try {
    const root = rootOf(io, options.root);
    const manifest = await manifestAt(root);
    const { slices, models } = selection(manifest, options);
    if (models.length !== 1) throw new Error('record requires one --model');
    const model = models[0] as Model;
    const concurrency = Number(options.concurrency ?? 4);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
      throw new Error('--concurrency must be 1..16');
    const budget = new SpendBudget(Number(options.spendCapUsd));
    const head = headOf(root);
    const ledger = options.spendLedger
      ? resolve(io.cwd, options.spendLedger)
      : join(root, 'benchmarks/evidence/spend.jsonl');
    await mkdir(dirname(ledger), { recursive: true });
    // Verify the append destination before the first billed call.
    appendFileSync(ledger, '');
    const allEvidence: RecordEvidence[] = [];
    for (const entry of slices) {
      const slice = await loadBenchSlice(
        root,
        entry,
        options.store ? resolve(io.cwd, options.store) : undefined,
      );
      const path = paths(root, entry, model.id);
      const partial = `${path.cassette}.partial.json`;
      const partialEvidence = `${path.evidence}.partial.json`;
      await mkdir(dirname(path.cassette), { recursive: true });
      await mkdir(dirname(path.evidence), { recursive: true });
      let cassette: Cassette = { version: 1, judges: [], entries: [] };
      let spend: SpendRow[] = [];
      const completed = new Map<string, CaseResult>();
      if (options.resume && existsSync(path.cassette) && !existsSync(partialEvidence)) {
        // A finished current recording is reused only after exact replay validation.
        const done = await verifiedReplay(root, entry, model, slice, head);
        const floors = await readFloors(root);
        const floor = floors.floors[keyOf(entry.name, entry.version, model.id)];
        if (floor && !checkFloor(done.report, floor).holds)
          throw new Error(`${entry.name}/${model.id}: completed recording regresses against the floor`);
        allEvidence.push(done.evidence);
        if (!options.json) io.out(`Reused ${entry.name}/${model.id}\n`);
        continue;
      }
      if (!options.resume && existsSync(path.cassette)) {
        // Keep the previous raw responses and their provenance for paired review.
        const previous = await readFile(path.cassette, 'utf8');
        const archive = join(root, 'benchmarks/cassettes/history', `${sha256(previous)}.json`);
        if (!existsSync(archive)) await jsonWrite(archive, JSON.parse(previous));
      }
      const prior =
        options.resume && existsSync(partialEvidence)
          ? JSON.parse(readFileSync(partialEvidence, 'utf8'))
          : undefined;
      if (prior) {
        if (
          prior.format !== 'driftbench-bench-partial-v1' ||
          prior.fingerprint !== PROMPT_FINGERPRINT ||
          prior.datasetHash !== entry.hash ||
          prior.model !== model.model
        )
          throw new Error('re-record needed: partial recording is stale');
        validateSpendRows(prior.spend);
        if (!Array.isArray(prior.results)) throw new Error('Invalid partial results evidence');
        for (const result of prior.results) {
          if (!result || typeof result.id !== 'string' || completed.has(result.id))
            throw new Error('Invalid partial case identity');
          completed.set(result.id, result);
        }
        cassette = await loadCassette(partial);
        cassette.entries = cassette.entries.filter((e) => e.error === undefined);
        spend = prior.spend;
        const cases = slice.cases.filter((row) => completed.has(row.id));
        if (cases.length !== completed.size) throw new Error('Partial evidence names unknown cases');
        if (cases.length > 0) {
          const replayed = await replaySlice({ ...slice, cases }, cassette, model.id, { head });
          if (JSON.stringify(replayed.results) !== JSON.stringify(cases.map((row) => completed.get(row.id))))
            throw new Error(
              're-record needed: partial results differ from replay; transport status cannot be discarded',
            );
        } else if (cassette.entries.length > 0) throw new Error('Partial recording lacks results evidence');
      }
      const log = (row: SpendRow) => {
        spend.push(row);
        appendFileSync(
          ledger,
          `${JSON.stringify({ lane: 'bench-frame', slice: entry.name, datasetVersion: entry.version, fingerprint: PROMPT_FINGERPRINT, ...row })}\n`,
        );
      };
      const env = { ...process.env };
      delete env.CLAUDECODE;
      const live = makeRecordingClient(model.id, budget, env, log, { haikuModel: model.model });
      if (
        cassette.judges.length &&
        (cassette.judges[0]?.model !== live.model || cassette.judges[0]?.settings !== live.settings)
      )
        throw new Error('re-record needed: partial client settings changed');
      const available = new Map<string, number>();
      for (const item of cassette.entries) available.set(item.key, (available.get(item.key) ?? 0) + 1);
      const player = cassette.judges.length ? playBenchClient(cassette, model.id) : undefined;
      const recorder = recordBenchClient(live, cassette);
      const client = {
        ...live,
        async judge(request: Parameters<typeof live.judge>[0]) {
          const key = requestKey(request, live);
          const left = available.get(key) ?? 0;
          if (left > 0 && player) {
            available.set(key, left - 1);
            return player.judge(request);
          }
          return recorder.judge(request);
        },
      };
      const checkpoint = () => {
        // Synchronous replacement serializes callbacks from concurrent completions.
        writeFileSync(partial, jsonText(cassette));
        writeFileSync(
          partialEvidence,
          `${JSON.stringify({ format: 'driftbench-bench-partial-v1', fingerprint: PROMPT_FINGERPRINT, datasetHash: entry.hash, model: model.model, spend, results: [...completed.values()] }, null, 2)}\n`,
        );
      };
      let report: BenchReport;
      try {
        report = await scoreSlice(slice, client, {
          head,
          concurrency,
          onResult: (_i, result) => {
            completed.set(result.id, result);
            checkpoint();
          },
        });
      } finally {
        checkpoint();
      }
      // Force every response through the current parser on replay, including inconclusive model answers.
      cassette.entries = cassette.entries.map(({ answer: _answer, ...entry }) => entry);
      const raw = jsonText(cassette);
      const replayed = await replaySlice(slice, cassette, model.id, { head });
      if (JSON.stringify(replayed.results) !== JSON.stringify(report.results))
        throw new Error('Recorded and replayed scores differ');
      const evidence: RecordEvidence = {
        format: 'driftbench-bench-record-v1',
        report,
        cassetteSha256: sha256(raw),
        resolvedModels: [...new Set(spend.map((s) => s.resolvedModel))],
        costUsd: spend.reduce((a, b) => a + b.costUsd, 0),
        chargedUsd: spend.reduce((a, b) => a + b.chargedUsd, 0),
        calls: spend.length,
        spend,
      };
      const floors = await readFloors(root);
      const floor = floors.floors[keyOf(entry.name, entry.version, model.id)];
      // Persist new evidence even on a regression so it can be diagnosed; replay remains red.
      await jsonWrite(path.cassette, cassette);
      await jsonWrite(path.evidence, evidence);
      await unlink(partial);
      await unlink(partialEvidence);
      allEvidence.push(evidence);
      if (!options.json) {
        printReport(io, report, floor ? checkFloor(report, floor) : undefined);
        io.out(
          `  Recorded $${evidence.costUsd.toFixed(6)}; invocation charged $${budget.spent.toFixed(6)}\n`,
        );
      }
      if (floor && !checkFloor(report, floor).holds)
        throw new Error(`${entry.name}/${model.id}: re-record regresses against the floor`);
    }
    if (options.json)
      io.out(`${JSON.stringify({ records: allEvidence, chargedUsd: budget.spent }, null, 2)}\n`);
    return 0;
  } catch (cause) {
    io.err(`bench record: ${message(cause)}\n`);
    return 2;
  }
}
export async function benchFloors(
  model: string | undefined,
  options: { root?: string; raise?: string; evidence?: string; json?: boolean },
  io: Io,
): Promise<number> {
  try {
    const root = rootOf(io, options.root);
    const file = await readFloors(root);
    if (!options.raise) {
      io.out(`${JSON.stringify(file, null, 2)}\n`);
      return 0;
    }
    if (!model || !options.evidence) throw new Error('--raise requires <slice> <model> --evidence <json>');
    const manifest = await manifestAt(root);
    const { slices, models } = selection(manifest, { slice: options.raise, model });
    const entry = slices[0] as SliceEntry;
    const selectedModel = models[0] as Model;
    const input = JSON.parse(await readFile(resolve(io.cwd, options.evidence), 'utf8'));
    const reports: BenchReport[] = Array.isArray(input.reports)
      ? input.reports
      : input.report
        ? [input.report]
        : [input];
    const report = reports.find((r) => r.slice === entry.name && r.judge === model);
    if (!report) throw new Error('Evidence names no matching slice/model');
    validateReport(report);
    const slice = await loadBenchSlice(root, entry);
    const current = await verifiedReplay(root, entry, selectedModel, slice, headOf(root));
    if (
      JSON.stringify(current.report.results) !== JSON.stringify(report.results) ||
      report.datasetVersion !== current.report.datasetVersion ||
      report.datasetHash !== current.report.datasetHash ||
      report.model !== current.report.model ||
      report.settings !== current.report.settings ||
      (report.head !== current.report.head && report.head !== current.evidence.report.head) ||
      (input.format === 'driftbench-bench-record-v1' &&
        input.cassetteSha256 !== current.evidence.cassetteSha256)
    )
      throw new Error('Evidence differs from the current cassette replay');
    const key = keyOf(entry.name, entry.version, model);
    const previous = file.floors[key];
    const floor = raiseFloor(previous, report);
    if (previous) file.history.push(previous);
    file.floors[key] = floor;
    await jsonWrite(join(root, 'benchmarks/floors.json'), file);
    io.out(
      options.json
        ? `${JSON.stringify(floor, null, 2)}\n`
        : `Floor ${key}: ${floor.correct}/${floor.n}; evidence ${floor.evidenceHash}\n`,
    );
    return 0;
  } catch (cause) {
    io.err(`bench floors: ${message(cause)}\n`);
    return 2;
  }
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type Check,
  enterBlock,
  initialGiven,
  type LoadedSpec,
  type LoadResult,
  loadSpecs,
  type Message,
  type RunResult,
  runSpec,
  type Session,
  type Spec,
  stimulusMessages,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import {
  blockCell,
  blockOutcome,
  buildTaskInputs,
  COMPLETE_DIR,
  deviationOf,
  type FaultSession,
  failingIds,
  type GenerateResult,
  generateSuite,
  loadApprovedMap,
  loadFamily,
  machineSignature,
  type PreparedMap,
  projectObserved,
  projectRun,
  type RunContext,
  runOnce,
  stimulusText,
  type ThenField,
  thenFields,
  writePendingReview,
} from '@agent-nexus/driftbench-generate';
import { createPerturbingDriver, createScriptedDriver } from '@agent-nexus/driftbench-users';
import { baselineSuite } from './baseline';
import { CHEATERS, type Cheater, cheaterAdapter, replayCalls } from './cheaters';
import { combinedFault, contextFaults, FAULT_CLASSES, faultFamily, type HiddenFault } from './faults';
import { createFollower, type FileSession } from './follower';
import { type HiddenSpec, hiddenSpec } from './hidden';
import { MAP_FILES, type RenderedMap, renderMap } from './render';

/**
 * One seed of the generator validator, measured: the hidden specification rendered as a map, the real
 * generator run on it twice, every generated spec loaded from disk, and every complete spec run through the
 * real runner and checks on the rule follower (k repeats), on each cheater, on each planted fault, on the
 * pairwise and three-way fault combinations, and in the other runner modes. The bank's items read these
 * records; nothing here decides an item.
 */

/** Repeats on the rule follower, for pass to the k. */
export const REFERENCE_REPEATS = 5;

/** The map path every generated spec records: the same in both runs, so their bytes can be compared. */
export const MAP_PATH = `../map/${MAP_FILES.map}`;

/** The generator seeds the stability items compare, as offsets from the run's seed. */
export const STABILITY_OFFSETS = [0, 101, 202] as const;

/** What a test or a mutation replaces: each part of the chain the validator drives. */
export type GeneratorParts = {
  hidden?: (seed: number) => HiddenSpec;
  render?: (spec: HiddenSpec) => RenderedMap;
  generate?: (prepared: PreparedMap, options: Parameters<typeof generateSuite>[1]) => GenerateResult;
  /** The rule follower: what the reference runs. */
  follower?: (spec: HiddenSpec) => () => FaultSession;
  faults?: (spec: HiddenSpec) => HiddenFault[];
  cheaters?: readonly Cheater[];
  /** The hand-written suite: the replay cheater's source. */
  baseline?: (spec: HiddenSpec) => LoadedSpec[];
  /** Repeats on the reference. */
  k?: number;
  /** Only these bank families are evaluated; the others fail with one item saying so. Tests narrow the bank. */
  families?: readonly string[];
};

export type GeneratedFileSet = Map<string, string>;

export type Generation = {
  hidden: HiddenSpec;
  /** The generator seed the suite was written with. */
  generatorSeed: number;
  refused?: { code: string; message: string; issues: string[] };
  first: GeneratedFileSet;
  second: GeneratedFileSet;
  loaded: LoadResult[];
  complete: LoadedSpec[];
  report?: GenerateResult['report'];
  prepared?: PreparedMap;
};

export type Outcome = 'pass' | 'fail' | 'unjudged';

/** One block of a complete spec, and what every agent made of it. */
export type BlockRun = {
  key: string;
  spec: string;
  index: number;
  seeder: string;
  fields: ThenField[];
  deviation?: string;
  injected: boolean;
  signature: string;
  when: string;
  cell: Record<string, string>;
  tags: string[];
  reference: Outcome[];
  referenceFailing: string[];
  referenceTrace: string;
  cheaters: Partial<Record<Cheater, { outcome: Outcome; passing: string[] }>>;
  faults: Record<string, Outcome>;
  /** The outcome of every persona-bound fault (faults.ts#contextFaults), read by the minimality items only. */
  contextFaults: Record<string, Outcome>;
};

/** A planted fault: the specs it changed and, per spec, the first block where it changed what the agent did. */
export type FaultRecord = {
  fault: HiddenFault;
  changedOn: string[];
  ranOn: number;
  firstChange: Record<string, number>;
};

export type Runs = { blocks: BlockRun[]; faults: FaultRecord[]; errors: string[] };

/**
 * The language check, remembered. Detecting a language is most of a run's cost, and the `expect.lang` verdict
 * depends only on the expected language and the block's text segments, so the same pair gives the same
 * verdicts; a spec with `rules.lang_stable` also reads earlier blocks and is never remembered.
 */
const langVerdicts = new Map<string, Verdict[]>();

function rememberLang(check: Check): Check {
  return {
    ...check,
    evaluate(ctx) {
      if (ctx.spec.rules?.lang_stable === true) return check.evaluate(ctx);
      const texts = ctx.observed.segments.flatMap((segment) =>
        segment.type === 'text' ? [segment.text] : [],
      );
      const key = JSON.stringify([ctx.expect.lang, texts]);
      const known = langVerdicts.get(key);
      if (known) return structuredClone(known);
      const result = check.evaluate(ctx);
      if (result instanceof Promise) return result;
      langVerdicts.set(key, structuredClone(result));
      return result;
    },
  };
}

export function runContext(): RunContext {
  return {
    artifacts: defaultReaders(),
    checks: defaultChecks().map((check) => (check.name === 'lang' ? rememberLang(check) : check)),
    driver: () => createScriptedDriver(),
  };
}

export function followerAdapter(session: () => FaultSession, version = 'rule-follower'): AgentAdapter {
  const base = (state: FaultSession) =>
    functionAdapter({
      create: () => state,
      respond: (messages, world) => state.respond(messages, world),
      payloads: () => state.payloads(),
      deterministic: true,
      version,
    });
  const live = new WeakMap<
    Session,
    { adapter: AgentAdapter; state: FaultSession; root?: string; files: Record<string, string> }
  >();
  const prototype = base({
    respond: async () => {
      throw new Error('unopened session');
    },
    payloads: () => [],
  });
  const own = (opened: Session) => {
    const found = live.get(opened);
    if (!found) throw new Error('closed or unknown fixture session');
    return found;
  };
  const safe = (root: string, path: string) => {
    const target = resolve(root, path);
    const rel = relative(root, target);
    return !isAbsolute(path) && rel !== '..' && !rel.startsWith(`..${sep}`) ? target : undefined;
  };
  return {
    ...prototype,
    async open(given) {
      const state = session();
      const adapter = base(state);
      const opened = await adapter.open(given);
      live.set(opened, {
        adapter,
        state,
        files: { ...(given.world.workspace?.files ?? {}) },
      });
      return opened;
    },
    async send(opened, turn) {
      const entry = own(opened);
      const observed = await entry.adapter.send(opened, turn);
      const files = (entry.state as Partial<FileSession>).files?.() ?? {};
      if (!(entry.state as Partial<FileSession>).files) return observed;
      if (!entry.root && Object.keys(files).length === 0 && !turn.given.world.workspace) return observed;
      entry.root ??= await mkdtemp(join(tmpdir(), 'driftbench-files-'));
      for (const path of Object.keys(entry.files)) {
        const target = safe(entry.root, path);
        if (!(path in files) && target) await rm(target, { force: true });
      }
      for (const [path, content] of Object.entries(files)) {
        const target = safe(entry.root, path);
        if (!target) continue;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      const actual: Record<string, string> = {};
      for (const path of Object.keys(files)) {
        const target = safe(entry.root, path);
        if (target) actual[path] = await readFile(target, 'utf8');
      }
      const created = Object.keys(actual).filter((path) => !(path in entry.files));
      const changed = Object.keys(actual).filter(
        (path) => path in entry.files && actual[path] !== entry.files[path],
      );
      const deleted = Object.keys(entry.files).filter((path) => !(path in actual));
      entry.files = actual;
      return {
        ...observed,
        workspaceDiff: { created, changed, deleted },
        artifacts: [
          ...new Set([...created, ...changed, ...(observed.artifacts ?? []).map((file) => file.path)]),
        ]
          .filter((path) => path in actual)
          .map((path) => ({
            path,
            sha256: createHash('sha256')
              .update(actual[path] ?? '')
              .digest('hex'),
            bytes: Buffer.byteLength(actual[path] ?? ''),
          })),
      };
    },
    async readArtifact(opened, path) {
      const root = own(opened).root;
      if (!root) throw new Error('the fixture produced no workspace files');
      const target = safe(root, path);
      if (!target) throw new Error('artifact path is outside the fixture workspace');
      return readFile(target);
    },
    async endState(opened, source) {
      const entry = own(opened);
      return entry.adapter.endState?.(opened, source);
    },
    async close(opened) {
      const entry = own(opened);
      try {
        await entry.adapter.close(opened);
      } finally {
        if (entry.root) await rm(entry.root, { recursive: true, force: true });
        live.delete(opened);
      }
    },
  };
}

function fixtureFaultAdapter(fault: HiddenFault): AgentAdapter {
  if (fault.def.agent.kind !== 'function') throw new Error('the validator plants function faults only');
  return followerAdapter(fault.def.agent.create, fault.def.id);
}

export async function writeAll(
  root: string,
  files: readonly { path: string; text: string; bytes?: Uint8Array }[],
): Promise<void> {
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes ?? file.text);
  }
}

async function readAll(root: string): Promise<GeneratedFileSet> {
  const out: GeneratedFileSet = new Map();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.set(relative(root, full).split(sep).join('/'), await readFile(full, 'utf8'));
    }
  };
  await walk(root);
  return out;
}

/**
 * Renders a hidden specification into a fresh folder and runs the generator on it as `driftbench generate
 * --map <map> --out <dir> --seed <seed>` does (load the approved map, generate, write every file), twice,
 * then loads every written spec with the core loader. The folder is removed before it returns.
 */
export async function generateFrom(
  hidden: HiddenSpec,
  rendered: RenderedMap,
  generatorSeed: number,
  parts: GeneratorParts = {},
  options: { once?: boolean } = {},
): Promise<Generation> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-vgen-'));
  try {
    const mapDir = join(root, 'map');
    await mkdir(mapDir);
    for (const [key, name] of Object.entries(MAP_FILES)) {
      await writeFile(join(mapDir, name), rendered[key as keyof RenderedMap]);
    }
    const family = await loadFamily(mapDir);
    if (!family.ok) throw new Error(`invalid fixture family: ${JSON.stringify(family.issues)}`);
    await writePendingReview(family.loaded);
    const loaded = await loadApprovedMap(join(mapDir, MAP_FILES.map));
    if (!loaded.ok) {
      return {
        hidden,
        generatorSeed,
        refused: {
          code: loaded.code,
          message: loaded.message,
          issues: loaded.issues.map((issue) => `${issue.path || '(file)'} ${issue.code} ${issue.message}`),
        },
        first: new Map(),
        second: new Map(),
        loaded: [],
        complete: [],
      };
    }
    const generate = parts.generate ?? ((prepared, options) => generateSuite(prepared, options));
    const runs: GenerateResult[] = [];
    let prepared: PreparedMap | undefined;
    for (const folder of options.once ? ['first'] : ['first', 'second']) {
      const again = await loadApprovedMap(join(mapDir, MAP_FILES.map));
      if (!again.ok) throw new Error(`the map loaded once and was refused the second time: ${again.message}`);
      prepared ??= again.prepared;
      const tasks = await buildTaskInputs(again.prepared, mapDir, { n: 1, seed: generatorSeed });
      if (tasks.refused.length > 0) throw new Error(`fixture task refused: ${JSON.stringify(tasks.refused)}`);
      const result = generate(again.prepared, {
        seed: generatorSeed,
        mapPath: MAP_PATH,
        tasks: tasks.inputs,
      });
      await writeAll(join(root, folder), result.files);
      runs.push(result);
    }
    const first = await readAll(join(root, 'first'));
    const second = options.once ? first : await readAll(join(root, 'second'));
    const specs = await loadSpecs([join(root, 'first')]);
    const loadedSpecs = specs.map((result) => ({
      ...result,
      path: relative(join(root, 'first'), result.path).split(sep).join('/'),
    }));
    const complete = loadedSpecs.filter(
      (result): result is LoadedSpec => result.ok && result.path.startsWith(`${COMPLETE_DIR}/`),
    );
    complete.sort((a, b) => a.path.localeCompare(b.path));
    return {
      hidden,
      generatorSeed,
      first,
      second,
      loaded: loadedSpecs,
      complete,
      report: runs[0]?.report as GenerateResult['report'],
      ...(prepared ? { prepared } : {}),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The hidden specification of a seed, rendered and generated with the seed as the generator seed. */
export async function generation(
  seed: number,
  parts: GeneratorParts = {},
  generatorSeed = seed,
): Promise<Generation> {
  const hidden = (parts.hidden ?? hiddenSpec)(seed);
  return generateFrom(hidden, (parts.render ?? renderMap)(hidden), generatorSeed, parts);
}

export function seederOf(spec: Spec): string {
  const generated = spec.metadata?.generated as { seeder?: unknown } | undefined;
  return typeof generated?.seeder === 'string' ? generated.seeder : 'hand-written';
}

/** A block's placement is recorded by the generator, independently of what any agent does. */
function blockPlacement(spec: Spec, index: number): Pick<BlockRun, 'key' | 'seeder' | 'cell'> {
  return {
    key: `${spec.id}#${spec.blocks[index]?.id ?? index}`,
    seeder: seederOf(spec),
    cell: {
      ...((spec.metadata?.generated as { cell?: Record<string, string> } | undefined)?.cell ?? {}),
      ...blockCell(spec, index),
    },
  };
}

/** Every complete block's cell, including blocks without a machine Then, in runAll order. */
export function generatedCells(generated: Generation): Array<Pick<BlockRun, 'key' | 'seeder' | 'cell'>> {
  return generated.complete.flatMap(({ spec }) => spec.blocks.map((_, index) => blockPlacement(spec, index)));
}

/**
 * Where a complete suite sits in the hidden map, placed as the space package places a spec: a block on the
 * stage it expects, an injected block on the stage reached before it with the class it injects, a
 * perturbation on its class at the stage reached when it arrives. The recorded spec-level and block-level
 * values ride along, and the spec fills in a behaviour, channel or persona the record leaves out; the stage
 * and the class come from the spec's own blocks, never from the recorded cell, whose stage names the stage
 * a move leaves.
 */
export function generatedPositions(generated: Generation): Array<Pick<BlockRun, 'key' | 'seeder' | 'cell'>> {
  return generated.complete.flatMap(({ spec }) => {
    const arrival = (index: number) =>
      [...spec.blocks.slice(0, index)].reverse().find((entry) => entry.expect?.stage !== undefined)?.expect
        ?.stage;
    const seeder = seederOf(spec);
    // What the spec itself names, for a value its record leaves out.
    const persona = (spec.tags ?? []).find((tag) => tag.startsWith('persona:'))?.slice('persona:'.length);
    const named: Record<string, string> = {
      ...(spec.covers?.length === 1 ? { behaviour: spec.covers[0] as string } : {}),
      ...(spec.channel === undefined ? {} : { channel: spec.channel }),
      ...(persona === undefined ? {} : { user_type: persona }),
    };
    const spot = (
      key: string,
      cell: Record<string, string>,
      stage: string | undefined,
      deviation: string | undefined,
    ) => {
      const { stage: _stage, stage_transition: _move, deviation: _class, ...kept } = cell;
      return {
        key,
        seeder,
        cell: {
          ...named,
          ...kept,
          ...(stage === undefined ? {} : { stage }),
          ...(deviation === undefined ? {} : { deviation }),
        },
      };
    };
    const blocks = spec.blocks.map((block, index) => {
      const injected =
        block.when !== undefined && 'injection' in block.when ? block.when.injection.class : undefined;
      const placement = blockPlacement(spec, index);
      return spot(
        placement.key,
        placement.cell,
        injected ? (arrival(index) ?? block.expect?.stage) : block.expect?.stage,
        injected,
      );
    });
    const specLevel = (spec.metadata?.generated as { cell?: Record<string, string> } | undefined)?.cell ?? {};
    const perturbed = (spec.perturbations ?? []).map((perturbation, index) =>
      spot(
        `${spec.id}#perturbation-${index}`,
        specLevel,
        arrival(perturbation.inject_at) ?? perturbation.expect?.stage ?? perturbation.recovery?.stage_after,
        perturbation.class,
      ),
    );
    return [...blocks, ...perturbed];
  });
}

function traceOf(run: RunResult, index: number): string {
  const block = run.blocks.find((entry) => entry.index === index);
  if (!block) return 'the run ended before the block';
  const stage = block.observed.runtime?.stages?.at(-1)?.name ?? 'none reported';
  const calls = block.observed.toolCalls.map((call) => `${call.label}(${JSON.stringify(call.input)})`);
  return `stage ${stage}; calls ${calls.length > 0 ? calls.join(', ') : 'none'}; reply "${block.observed.text}"`;
}

const NOT_THEN: ReadonlySet<string> = new Set(['pii', 'schema_strict', 'budget']);

function passingIds(run: RunResult, index: number): string[] {
  const block = run.blocks.find((entry) => entry.index === index);
  return (block?.verdicts ?? [])
    .filter(
      (verdict) =>
        verdict.gating && verdict.outcome === 'pass' && !NOT_THEN.has(verdict.id.split('.', 1)[0] ?? ''),
    )
    .map((verdict) => verdict.id);
}

function failingDetails(run: RunResult, index: number): string[] {
  const block = run.blocks.find((entry) => entry.index === index);
  const failing = new Set(failingIds(run, index));
  return (block?.verdicts ?? [])
    .filter((verdict) => failing.has(verdict.id))
    .map((verdict) => `${verdict.id}: ${verdict.evidence}`);
}

function changed(base: string[], result: RunResult): boolean {
  const projected = projectRun(result);
  return projected.length !== base.length || projected.some((part, index) => part !== base[index]);
}

/**
 * The shortcut that keeps the bank fast. A free-running scripted run of a deterministic in-process agent is
 * a function of the agent's replies: the runner sends each block's user turn on the history so far, with the
 * block's world. `emulate` plays the same turns into a session directly and returns each block's
 * projection (what `projectRun` compares). When a fault's emulated turns equal the follower's real ones
 * block for block (and the follower's own emulation equals its real run, checked per spec), the fault
 * changed nothing in that spec, so its real run would equal the follower's: its outcomes are the
 * follower's and no run is made. Any difference sends the fault through the real runner.
 */
export async function emulate(spec: Spec, session: FaultSession): Promise<string[]> {
  let state = initialGiven(spec);
  const history: Message[] = [];
  const out: string[] = [];
  for (const block of spec.blocks) {
    state = enterBlock(state, block.given, undefined);
    if (block.given?.prefix) history.splice(0, history.length, ...structuredClone(block.given.prefix));
    if (!block.when) return out;
    history.push(...stimulusMessages(block.when));
    // The follower and its faults never change what they are given, so nothing is copied.
    const observed = await session.respond(history, state.world);
    history.push({ role: 'assistant', content: observed.text });
    out.push(projectObserved(observed));
  }
  return out;
}

/** Real runs a spec needs, and the follower's projections it is compared with. */
type SpecPlan = { spec: Spec; follower: RunResult; projections: string[]; emulable: boolean };

async function planSpec(spec: Spec, follower: RunResult, session: () => FaultSession): Promise<SpecPlan> {
  const projections = projectRun(follower);
  // File checks read disk; reported metadata cannot prove that a file run is unchanged.
  if (spec.kind === 'task' || spec.blocks.some((block) => block.expect?.artifacts || block.expect?.workspace))
    return { spec, follower, projections, emulable: false };
  const emulated = await emulate(spec, session());
  const emulable =
    follower.status === 'completed' &&
    emulated.length === spec.blocks.length &&
    emulated.every((projection, index) => projection === projections[index]);
  return { spec, follower, projections, emulable };
}

/** The outcome of one agent on a spec: from the follower's run when the agent changed nothing, else a real run. */
async function outcomesOn(
  plan: SpecPlan,
  session: () => FaultSession,
  adapter: AgentAdapter,
): Promise<{ outcomes: Outcome[]; changed: boolean; first?: number }> {
  if (plan.emulable) {
    const emulated = await emulate(plan.spec, session());
    if (emulated.every((projection, index) => projection === plan.projections[index])) {
      return {
        outcomes: plan.spec.blocks.map((_, index) => blockOutcome(plan.follower, index)),
        changed: false,
      };
    }
  }
  const result = await runOnce(plan.spec, adapter, 1, runContext());
  const projected = projectRun(result);
  const first = projected.findIndex((part, index) => part !== plan.projections[index]);
  return {
    outcomes: plan.spec.blocks.map((_, index) => blockOutcome(result, index)),
    changed: changed(plan.projections, result),
    ...(first >= 0 && first < plan.spec.blocks.length ? { first } : {}),
  };
}

/**
 * Runs every complete spec on the follower k times, on every cheater once and on every fault once, in
 * free-running mode with the default checks and the scripted driver, as the gate does.
 */
export async function runAll(generated: Generation, parts: GeneratorParts = {}): Promise<Runs> {
  const { hidden } = generated;
  const k = parts.k ?? REFERENCE_REPEATS;
  const context = runContext();
  const followerSession = (parts.follower ?? ((spec: HiddenSpec) => createFollower(spec)))(hidden);
  const reference = followerAdapter(followerSession);
  const faults = (parts.faults ?? ((spec: HiddenSpec) => faultFamily(spec)))(hidden);
  const cheaters = parts.cheaters ?? CHEATERS;
  const replay = replayCalls((parts.baseline ?? baselineSuite)(hidden).map((loaded) => loaded.spec));
  const adapters = faults.map((fault) => ({ fault, adapter: fixtureFaultAdapter(fault) }));
  const bound = contextFaults(hidden, faults);
  const records = new Map<string, FaultRecord>(
    faults.map((fault) => [fault.def.id, { fault, changedOn: [], ranOn: 0, firstChange: {} }]),
  );
  const blocks: BlockRun[] = [];
  const errors: string[] = [];

  for (const { spec } of generated.complete) {
    const references: RunResult[] = [];
    for (let repeat = 1; repeat <= k; repeat += 1)
      references.push(await runOnce(spec, reference, repeat, context));
    const first = references[0] as RunResult;
    if (first.status !== 'completed')
      errors.push(`${spec.id}: the follower run ${first.status}${first.error ? `: ${first.error}` : ''}`);
    const cheaterRuns = new Map<Cheater, RunResult>();
    for (const name of cheaters)
      cheaterRuns.set(name, await runOnce(spec, cheaterAdapter(name, spec, hidden, replay), 1, context));
    const plan = await planSpec(spec, first, followerSession);
    const faultOutcomes = new Map<string, Outcome[]>();
    for (const { fault, adapter } of adapters) {
      const session = fault.def.agent.kind === 'function' ? fault.def.agent.create : followerSession;
      const result = await outcomesOn(plan, session, adapter);
      faultOutcomes.set(fault.def.id, result.outcomes);
      const record = records.get(fault.def.id) as FaultRecord;
      record.ranOn += 1;
      if (result.changed) record.changedOn.push(spec.id);
      if (result.first !== undefined) record.firstChange[spec.id] = result.first;
    }
    // A persona-bound fault is the follower until its phrase is said, so on a spec that never says it its
    // outcomes are the follower's, which outcomesOn would return after an emulation of its own.
    const text = JSON.stringify(spec);
    const contextOutcomes = new Map<string, Outcome[]>();
    for (const fault of bound) {
      const outcomes = text.includes(JSON.stringify(fault.phrase).slice(1, -1))
        ? (await outcomesOn(plan, fault.create, followerAdapter(fault.create, fault.id))).outcomes
        : spec.blocks.map((_, index) => blockOutcome(first, index));
      contextOutcomes.set(fault.id, outcomes);
    }
    spec.blocks.forEach((block, index) => {
      const deviation = deviationOf(spec, index);
      const run: BlockRun = {
        ...blockPlacement(spec, index),
        spec: spec.id,
        index,
        fields: thenFields(spec, index),
        ...(deviation === undefined ? {} : { deviation }),
        injected: 'injection' in (block.when ?? {}),
        signature: machineSignature(spec, index),
        when: block.when ? stimulusText(block.when) : '',
        tags: [...(spec.tags ?? [])],
        reference: references.map((result) => blockOutcome(result, index)),
        referenceFailing: failingDetails(first, index),
        referenceTrace: traceOf(first, index),
        cheaters: {},
        faults: {},
        contextFaults: {},
      };
      for (const [name, result] of cheaterRuns) {
        run.cheaters[name] = { outcome: blockOutcome(result, index), passing: passingIds(result, index) };
      }
      for (const [id, outcomes] of faultOutcomes) run.faults[id] = outcomes[index] ?? 'unjudged';
      for (const [id, outcomes] of contextOutcomes) run.contextFaults[id] = outcomes[index] ?? 'unjudged';
      blocks.push(run);
    });
  }
  return { blocks, faults: [...records.values()], errors };
}

/** The follower's run and plan of every complete spec, once per generation. */
const plans = new WeakMap<Generation, Promise<SpecPlan[]>>();

function plansOf(generated: Generation, parts: GeneratorParts): Promise<SpecPlan[]> {
  let found = plans.get(generated);
  if (!found) {
    found = (async () => {
      const session = (parts.follower ?? ((spec: HiddenSpec) => createFollower(spec)))(generated.hidden);
      const adapter = followerAdapter(session);
      const out: SpecPlan[] = [];
      for (const { spec } of generated.complete)
        out.push(await planSpec(spec, await runOnce(spec, adapter, 1, runContext()), session));
      return out;
    })();
    plans.set(generated, found);
  }
  return found;
}

/** Per block key, the outcome of one agent on every complete spec. */
export async function outcomesOf(
  generated: Generation,
  session: () => FaultSession,
  parts: GeneratorParts = {},
): Promise<Map<string, Outcome>> {
  const out = new Map<string, Outcome>();
  const adapter = followerAdapter(session, 'agent');
  for (const plan of await plansOf(generated, parts)) {
    const { outcomes } = await outcomesOn(plan, session, adapter);
    plan.spec.blocks.forEach((block, index) => {
      out.set(`${plan.spec.id}#${block.id ?? index}`, outcomes[index] ?? 'unjudged');
    });
  }
  return out;
}

/** The outcomes of the combined agents of each interaction, by interaction id. */
export async function runCombinations(
  generated: Generation,
  combinations: readonly (readonly string[])[],
  parts: GeneratorParts = {},
): Promise<Map<string, Map<string, Outcome>>> {
  const out = new Map<string, Map<string, Outcome>>();
  for (const ids of combinations) {
    const fault = combinedFault(generated.hidden, ids);
    if (fault.def.agent.kind !== 'function') continue;
    out.set(ids.join('+'), await outcomesOf(generated, fault.def.agent.create, parts));
  }
  return out;
}

/**
 * The kill status of every class's every-time instance on a suite generated with another generator seed:
 * what the stability items compare across seeds.
 */
export async function killsUnder(
  seed: number,
  generatorSeed: number,
  parts: GeneratorParts,
  classes: readonly string[],
): Promise<Map<string, boolean>> {
  const generated = await generation(seed, parts, generatorSeed);
  const reference = await outcomesOf(
    generated,
    (parts.follower ?? ((spec: HiddenSpec) => createFollower(spec)))(generated.hidden),
    parts,
  );
  const family = faultFamily(
    generated.hidden,
    FAULT_CLASSES.filter((cls) => classes.includes(cls.id)),
  ).filter((fault) => fault.where === 'any' && fault.rate === 1);
  const out = new Map<string, boolean>();
  for (const fault of family) {
    if (fault.def.agent.kind !== 'function') continue;
    const outcomes = await outcomesOf(generated, fault.def.agent.create, parts);
    out.set(
      fault.class,
      [...outcomes].some(([key, outcome]) => outcome === 'fail' && reference.get(key) === 'pass'),
    );
  }
  return out;
}

/** What the perturbed (P) and teacher-forced (T) runs of the generated suite kill. */
export type ModeKills = { ok: boolean; detail: string; killed: Set<string> };

/**
 * The other two runner modes. P: every perturbation a complete spec declares is applied in a perturbed run,
 * on the follower and on the every-time instance of every drift and deviation class; a class is killed when
 * some perturbed run fails on it while the follower's passes. T: every complete spec runs teacher-forced on
 * the follower and on the same instances. A mode the suite gives nothing to run, or the runner refuses,
 * kills nothing and says why.
 */
export async function modeKills(
  generated: Generation,
  parts: GeneratorParts = {},
): Promise<Record<'P' | 'T', ModeKills>> {
  const context = runContext();
  const follower = followerAdapter(
    (parts.follower ?? ((spec: HiddenSpec) => createFollower(spec)))(generated.hidden),
  );
  const planted = faultFamily(
    generated.hidden,
    FAULT_CLASSES.filter((cls) => cls.family !== 'code'),
  ).filter((fault) => fault.where === 'any' && fault.rate === 1);
  const result: Record<'P' | 'T', ModeKills> = {
    P: {
      ok: false,
      detail: 'no complete spec declares a perturbation, so no run is perturbed',
      killed: new Set(),
    },
    T: { ok: false, detail: 'no complete spec', killed: new Set() },
  };
  const perturbed = generated.complete.flatMap(({ spec }) =>
    (spec.perturbations ?? []).map((perturbation) => ({ spec, id: perturbation.id })),
  );
  if (perturbed.length > 0) {
    let followerOk = true;
    for (const { spec, id } of perturbed) {
      // The perturbing driver of the users package injects the declared perturbation; the runner reads it
      // from the spec the driver hands back.
      const perturbedRun = (adapter: AgentAdapter) => {
        const driver = createPerturbingDriver({ spec, perturbation: id });
        return runSpec(driver.spec, {
          adapter,
          driver,
          checks: context.checks,
          mode: 'P',
          repeat: 1,
          perturbationId: id,
        });
      };
      const base = await perturbedRun(follower);
      if (base.blocks.some((block) => !block.pass)) {
        followerOk = false;
        continue;
      }
      for (const fault of planted) {
        const run = await perturbedRun(fixtureFaultAdapter(fault));
        if (run.blocks.some((block) => !block.pass)) result.P.killed.add(fault.class);
      }
    }
    result.P.ok = followerOk;
    result.P.detail = followerOk
      ? `${perturbed.length} perturbed runs`
      : 'the follower fails a perturbed run';
  }
  const first = generated.complete[0];
  if (first) {
    try {
      await runSpec(first.spec, {
        adapter: follower,
        driver: createScriptedDriver(),
        checks: context.checks,
        mode: 'T',
        repeat: 1,
      });
      for (const { spec } of generated.complete) {
        const options = {
          driver: createScriptedDriver(),
          checks: context.checks,
          mode: 'T' as const,
          repeat: 1,
        };
        const base = await runSpec(spec, { ...options, adapter: follower });
        for (const fault of planted) {
          const run = await runSpec(spec, { ...options, adapter: fixtureFaultAdapter(fault) });
          base.blocks.forEach((block, index) => {
            if (block.pass && run.blocks[index] && !run.blocks[index]?.pass) result.T.killed.add(fault.class);
          });
        }
      }
      result.T.ok = true;
      result.T.detail = 'teacher-forced runs completed';
    } catch (cause) {
      result.T.detail = `the runner refuses mode T: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
  }
  return result;
}

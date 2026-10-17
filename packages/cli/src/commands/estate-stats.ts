import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readSession, replayAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import {
  blockStatus,
  blocksOutcome,
  isScored,
  type LoadedSpec,
  loadSpecFile,
  type Observed,
  runSpec,
} from '@agent-nexus/driftbench-core';
import {
  type Atom,
  AtomKind,
  cellKey,
  type EstateMap,
  loadEstateMap,
  type Plan,
  parsePlanText,
} from '@agent-nexus/driftbench-estate';
import {
  estateOwners,
  navigationFiles,
  navigationReference,
  StaticTest,
  taskAtoms,
} from '@agent-nexus/driftbench-generate';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import { alignReplaySpecs, replayChecks, replaySessionFor, type SessionEntry } from './replay';

type Options = { map: string; plan: string; specs: string; sessions?: string; json?: boolean };
type CompleteTest = { atoms: string[]; planRow?: string; cell?: Record<string, string>; loaded?: LoadedSpec };
export type SessionEvidence = {
  entry: SessionEntry;
  passedBlocks: Set<number>;
  /** Blocks every observation of which was not run or blocked: no measurement, out of the decay rate. */
  unscoredBlocks: Set<number>;
  followed: Set<string>;
};
type GuardDrift = { guard: string; decisions: number; denies: number; denyRate: number };
const REACH_KINDS = new Set(['skill', 'reference', 'guard', 'subagent']);

/** The frozen estate statistics contract, computed from the map, complete tests and recorded sessions. */
export function registerEstateStatsCommand(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('stats')
    .description('Report estate coverage, reach, block pass rates and guard deny rates without model calls')
    .requiredOption('--map <map>', 'the approved estate map')
    .requiredOption('--plan <plan>', 'the plan made from that map')
    .requiredOption('--specs <dir>', 'the generated suite, or its complete specs folder')
    .option('--sessions <dir>', 'recorded transcripts and their decision logs and step feeds')
    .option('--json', 'print the report as JSON')
    .action(async (options: Options) => {
      setExit(await estateStatsCommand(options, io));
    });
}

export async function estateStatsCommand(options: Options, io: Io): Promise<number> {
  try {
    const loaded = await loadEstateMap(resolve(io.cwd, options.map));
    if (!loaded.ok) throw new Error(loaded.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    const parsed = parsePlanText(await readFile(resolve(io.cwd, options.plan), 'utf8'));
    if (!parsed.ok) throw new Error(parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    const map = loaded.map;
    const plan = parsed.plan;
    if (plan.mapHash !== map.hash) throw new Error('the plan is made from another map');
    const folder = resolve(io.cwd, options.specs);
    if (!(await stat(folder)).isDirectory()) throw new Error('the specs path must be a folder');
    const tests = await completeTests(folder, map, plan);
    const coverage = coverageOf(map, plan, tests);
    const corpus = options.sessions === undefined ? undefined : resolve(io.cwd, options.sessions);
    const sessions = corpus === undefined ? [] : await sessionEvidence(corpus, tests, io);
    const reach =
      sessions.length === 0
        ? []
        : map.atoms
            .filter((a) => a.approved && REACH_KINDS.has(a.kind))
            .map((atom) => ({
              atom: atom.id,
              reached: sessions.filter((s) =>
                reached(
                  atom,
                  s.entry.session.blocks.map((b) => b.observed),
                ),
              ).length,
              followed: sessions.filter(
                (s) =>
                  s.followed.has(atom.id) &&
                  reached(
                    atom,
                    s.entry.session.blocks.map((b) => b.observed),
                  ),
              ).length,
            }));
    const decay = decayOf(sessions);
    const drift = { guards: corpus === undefined ? [] : await guardDrift(corpus) };
    const reachNotObservable = {
      status: 'not observable',
      atoms: map.atoms.filter((atom) => atom.approved && !REACH_KINDS.has(atom.kind)).length,
    };
    const report = { coverage, reach, reachNotObservable, decay, drift };
    if (options.json) io.out(`${JSON.stringify(report, null, 2)}\n`);
    else {
      io.out('Kind  atoms  tested  enforced\n');
      for (const [kind, count] of Object.entries(coverage.kinds))
        io.out(`${kind}  ${count.atoms}  ${count.tested}  ${count.enforced}\n`);
      io.out(
        `Cells: ${coverage.cells.covered}/${coverage.cells.total}; edges: ${coverage.edges.covered}/${coverage.edges.total}\n`,
      );
      if (coverage.navigationReferences !== undefined)
        io.out(
          `${coverage.navigationReferences} references to navigation-only documents have no test by design.\n`,
        );
      io.out(`${reachNotObservable.atoms} atoms: reach is not observable.\n`);
      io.out(
        `${reach.length} atom reach rows; ${decay.length} block rows; ${drift.guards.length} guard rates.\n`,
      );
    }
    return 0;
  } catch (cause) {
    io.err(`Cannot compute estate stats: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
}

/** Generated suites place complete specs and static tests apart from incomplete specs and native units. */
async function completeTests(folder: string, map: EstateMap, plan: Plan): Promise<CompleteTest[]> {
  const nested = await stat(join(folder, 'specs')).catch(() => undefined);
  const generated =
    nested?.isDirectory() ||
    (await stat(join(folder, 'estate-generate-report.json')).catch(() => undefined))?.isFile();
  const roots = generated ? (nested?.isDirectory() ? [join(folder, 'specs')] : []) : [folder];
  if (generated) {
    const staticRoot = join(folder, 'static');
    if ((await stat(staticRoot).catch(() => undefined))?.isDirectory()) roots.push(staticRoot);
  }
  const rows = new Map(ownedRows(map, plan).map((row) => [row.id, row]));
  const tests: CompleteTest[] = [];
  for (const root of roots)
    for (const file of await filesOf(root)) {
      if (/\.json$/i.test(file)) {
        const parsed = StaticTest.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (!parsed.success) throw new Error(`${file}: not a static test: ${parsed.error.message}`);
        const test = parsed.data;
        if (test.mapHash !== map.hash) throw new Error(`${file}: a static test is made from another map`);
        if (rows.get(test.planRow)?.status === 'struck') continue;
        if (test.retired !== undefined) continue;
        tests.push({ atoms: [test.atom], planRow: test.planRow, cell: rows.get(test.planRow)?.cell });
      } else {
        const loaded = await loadSpecFile(file);
        if (!loaded.ok) throw new Error(`${file}: ${loaded.errors.map((e) => e.message).join('; ')}`);
        const metadata = record(loaded.spec.metadata?.estate);
        if (Array.isArray(metadata.needs) && metadata.needs.some((need) => record(need).blocking !== false))
          continue;
        if (loaded.spec.metadata?.retired !== undefined) continue;
        if (typeof metadata.mapHash === 'string' && metadata.mapHash !== map.hash)
          throw new Error(`${file}: a spec is made from another map`);
        const planRow = typeof metadata.planRow === 'string' ? metadata.planRow : undefined;
        const atoms = Array.isArray(metadata.atoms)
          ? metadata.atoms.filter((a): a is string => typeof a === 'string')
          : [];
        const equivalent = record(metadata.equivalence).planRows;
        if (Array.isArray(equivalent) && equivalent.length > 0) {
          // One execution can represent several exact tests. Recover cells from the authoritative plan,
          // and retain only one loaded spec so replay never executes the same representative N times.
          let active = 0;
          for (const id of new Set(equivalent)) {
            const source = typeof id === 'string' ? rows.get(id) : undefined;
            if (!source)
              throw new Error(`${file}: an equivalent source row is not in the plan: ${String(id)}`);
            if (source.status === 'struck') continue;
            if (!source.atomIds.every((id) => atoms.includes(id)))
              throw new Error(`${file}: equivalent row ${source.id} names an atom the spec does not cover`);
            tests.push({ atoms: source.atomIds, planRow: source.id, cell: source.cell });
            active += 1;
          }
          if (active > 0) tests.push({ atoms, planRow, loaded });
        } else {
          if (planRow !== undefined && rows.get(planRow)?.status === 'struck') continue;
          const cell = stringRecord(metadata.cell);
          tests.push({ atoms, planRow, ...(cell ? { cell } : {}), loaded });
        }
      }
    }
  return tests;
}

async function filesOf(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (entry.name === 'incomplete') continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await filesOf(path)));
    else if (entry.isFile() && /\.(json|ya?ml)$/i.test(entry.name)) files.push(path);
  }
  return files;
}

/**
 * The pass rate per block position over the sessions that reach it, leaving out a session whose block there was
 * only ever not run or blocked: it is no measurement.
 */
export function decayOf(
  sessions: readonly SessionEvidence[],
): { block: number; runs: number; passRate: number }[] {
  const most = Math.max(0, ...sessions.map((s) => s.entry.session.blocks.length));
  return Array.from({ length: most }, (_, block) => {
    const present = sessions.filter(
      (s) => s.entry.session.blocks.length > block && !s.unscoredBlocks.has(block),
    );
    const passes = present.filter((s) => s.passedBlocks.has(block)).length;
    return { block, runs: present.length, passRate: present.length === 0 ? 0 : passes / present.length };
  });
}

function ownedRows(map: EstateMap, plan: Plan): Plan['rows'] {
  const atoms = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const owners = estateOwners(map.atoms, map.edges);
  return plan.rows.map((row) => ({
    ...row,
    atomIds: taskAtoms(
      row.atomIds.map((id) => atoms.get(id) as Atom),
      atoms,
      owners,
    ).map((atom) => atom.id),
  }));
}

function coverageOf(map: EstateMap, plan: Plan, tests: CompleteTest[]) {
  const tested = new Set(tests.flatMap((t) => t.atoms));
  // A reference to an example, a template or a history is a place to look and has no test by design: it
  // is neither a gap in the coverage nor an edge to cover.
  const navigation = navigationFiles(map.documents);
  const skipped = new Set(
    map.atoms.filter((atom) => navigationReference(atom, navigation)).map((atom) => atom.id),
  );
  const kinds = Object.fromEntries(
    AtomKind.options.map((kind) => {
      const atoms = map.atoms.filter((a) => a.approved && a.kind === kind && !skipped.has(a.id));
      return [
        kind,
        {
          atoms: atoms.length,
          tested: atoms.filter((a) => tested.has(a.id)).length,
          enforced: atoms.filter((a) => a.enforcement.length > 0).length,
        },
      ];
    }),
  );
  const allCells = new Set(ownedRows(map, plan).map(cellKey));
  const testedCells = new Set(
    tests.filter((t) => t.cell !== undefined).map((t) => cellKey({ atomIds: t.atoms, cell: t.cell ?? {} })),
  );
  const edges = map.edges.filter(
    (e) =>
      ['route', 'reference', 'dispatch', 'next'].includes(e.kind) &&
      !skipped.has(e.to) &&
      !skipped.has(e.from),
  );
  return {
    kinds,
    ...(skipped.size > 0 ? { navigationReferences: skipped.size } : {}),
    cells: { covered: [...allCells].filter((c) => testedCells.has(c)).length, total: allCells.size },
    edges: {
      covered: edges.filter((e) => tests.some((t) => t.atoms.includes(e.from) && t.atoms.includes(e.to)))
        .length,
      total: edges.length,
    },
  };
}

/**
 * Session pass rates come from the same offline replay checks and alignment as `replay`. A session counts
 * once at an index even when several specs name it, and passes there only when every aligned check passes.
 * A block with no aligned verdict has no demonstrated pass. Judged criteria stay inconclusive, never billed.
 */
async function sessionEvidence(folder: string, tests: CompleteTest[], io: Io): Promise<SessionEvidence[]> {
  const names = (await readdir(folder))
    .filter((name) => /\.jsonl$/i.test(name) && !/\.(decisions|steps)\.jsonl$/i.test(name))
    .sort();
  const entries: SessionEntry[] = [];
  for (const file of names) {
    const path = join(folder, file);
    const stem = file.replace(/\.jsonl$/i, '');
    const decisions = join(folder, `${stem}.decisions.jsonl`);
    const steps = join(folder, `${stem}.steps.jsonl`);
    const decisionFile = (await stat(decisions).catch(() => undefined))?.isFile() ? decisions : undefined;
    const stepFile = (await stat(steps).catch(() => undefined))?.isFile() ? steps : undefined;
    const session = await readSession({
      transcript: path,
      ...(decisionFile ? { decisions: decisionFile } : {}),
      ...(stepFile ? { steps: stepFile } : {}),
    });
    entries.push({
      name: stem,
      path,
      session,
      ...(decisionFile ? { decisions: decisionFile } : {}),
      ...(stepFile ? { steps: stepFile } : {}),
    });
  }
  const errors: string[] = [];
  const aligned = alignReplaySpecs(
    tests.flatMap((t) => (t.loaded ? [t.loaded] : [])),
    entries,
    {
      ...io,
      out: () => {},
      err: (message) => {
        errors.push(message);
      },
    },
  );
  if (!aligned) throw new Error(errors.join('; '));
  const verdicts = new Map<string, Map<number, boolean[]>>();
  const unscored = new Map<string, Set<number>>();
  const followed = new Map<string, Map<string, boolean[]>>();
  const checks = replayChecks();
  for (const alignment of aligned.alignments) {
    const session = await replaySessionFor(alignment);
    const result = await runSpec(alignment.spec.spec, {
      adapter: replayAdapter({
        session,
        fromBlock: alignment.fromBlock,
        ...(alignment.trees ? { files: alignment.trees.after } : {}),
      }),
      artifacts: defaultReaders(),
      driver: createScriptedDriver(),
      checks,
      mode: 'F',
      repeat: 0,
      target: { adapter: 'claude-code', agent: alignment.entry.name },
    });
    const mine = verdicts.get(alignment.entry.name) ?? new Map<number, boolean[]>();
    verdicts.set(alignment.entry.name, mine);
    const skipped = unscored.get(alignment.entry.name) ?? new Set<number>();
    unscored.set(alignment.entry.name, skipped);
    for (const block of result.blocks) {
      const index = block.index + alignment.fromBlock;
      // A block not run or blocked is no measurement of the agent: it joins no rate.
      if (!isScored(block)) {
        skipped.add(index);
        continue;
      }
      const values = mine.get(index) ?? [];
      values.push(result.status === 'completed' && blockStatus(block) === 'pass');
      mine.set(index, values);
    }
    const atoms = record(alignment.spec.spec.metadata?.estate).atoms;
    const outcome = blocksOutcome(result);
    if (Array.isArray(atoms) && outcome !== 'not_run' && outcome !== 'blocked') {
      const passed = outcome === 'pass';
      const mine = followed.get(alignment.entry.name) ?? new Map<string, boolean[]>();
      for (const atom of atoms)
        if (typeof atom === 'string') {
          const values = mine.get(atom) ?? [];
          values.push(passed);
          mine.set(atom, values);
        }
      followed.set(alignment.entry.name, mine);
    }
  }
  return entries.map((entry) => ({
    entry,
    passedBlocks: new Set(
      [...(verdicts.get(entry.name) ?? [])]
        .filter(([, values]) => values.length > 0 && values.every(Boolean))
        .map(([index]) => index),
    ),
    unscoredBlocks: new Set(
      [...(unscored.get(entry.name) ?? [])].filter(
        (index) => !(verdicts.get(entry.name)?.get(index)?.length ?? 0),
      ),
    ),
    followed: new Set(
      [...(followed.get(entry.name) ?? [])]
        .filter(([, values]) => values.length > 0 && values.every(Boolean))
        .map(([atom]) => atom),
    ),
  }));
}

/** Reach is a session's observed moment, independent of whether its aligned compliance checks passed. */
function reached(atom: Atom, blocks: readonly Observed[]): boolean {
  const fields = atom.fields ?? {};
  if (atom.kind === 'skill')
    return blocks.some((b) => b.runtime?.skills?.some((s) => s.name === fields.name));
  if (atom.kind === 'guard')
    return blocks.some((b) => b.runtime?.guards?.some((g) => g.name === fields.name));
  if (atom.kind === 'subagent')
    return blocks.some((b) => b.runtime?.subagents?.some((s) => s.name === fields.name));
  if (atom.kind === 'reference' && typeof fields.path === 'string') {
    const path = fields.path;
    return blocks.some((b) =>
      b.toolCalls.some(
        (c) =>
          c.label === 'Read' &&
          typeof record(c.input).file_path === 'string' &&
          (record(c.input).file_path === path || String(record(c.input).file_path).endsWith(`/${path}`)),
      ),
    );
  }
  return false;
}

async function guardDrift(folder: string): Promise<GuardDrift[]> {
  const counts = new Map<string, { decisions: number; denies: number }>();
  for (const file of (await readdir(folder)).filter((name) => /\.decisions\.jsonl$/i.test(name)).sort()) {
    const lines = (await readFile(join(folder, file), 'utf8')).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue;
      let row: Record<string, unknown>;
      try {
        row = record(JSON.parse(line));
      } catch (cause) {
        throw new Error(`${file}:${index + 1}: ${String(cause)}`);
      }
      const guard = row.check;
      if (typeof guard !== 'string' || typeof row.verdict !== 'string')
        throw new Error(`${file}:${index + 1}: a decision needs check and verdict`);
      const count = counts.get(guard) ?? { decisions: 0, denies: 0 };
      count.decisions += 1;
      if (row.verdict === 'deny' || row.verdict === 'block') count.denies += 1;
      counts.set(guard, count);
    }
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([guard, count]) => ({
      guard,
      ...count,
      denyRate: count.denies / count.decisions,
    }));
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const object = record(value);
  return Object.values(object).every((v) => typeof v === 'string')
    ? (object as Record<string, string>)
    : undefined;
}

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mapSession, orderedCheck, parseJsonl, replayAdapter } from '@agent-nexus/driftbench-adapters';
import { CheckRegistry, defaultChecks, defaultRegistry, ESTATE_CHECKS } from '@agent-nexus/driftbench-checks';
import {
  type CheckSet,
  type LoadedSpec,
  type Observed,
  parseSpecText,
  type RunResult,
  runSpec,
} from '@agent-nexus/driftbench-core';
import {
  type Atom,
  buildPlan,
  type EstateMap,
  estateRecordingPort,
  type LintResult,
  lintEstate,
  type PlanResult,
  type RawEstate,
  readerFor,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import {
  type EstateGenerateResult,
  type EstateSpecRecord,
  generateEstateSuite,
  type PhraseBank,
  type SessionIndex,
} from '@agent-nexus/driftbench-generate';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { follow } from './follower';
import { drawEstate, type HiddenEstate, type Profile } from './hidden';
import { RUNTIME } from './layout';
import { type ExpectedAtom, type Rendered, renderEstate } from './render';
import { type HiddenSituation, phraseBank, sessionIndex, situationsOf } from './situations';

/**
 * The estate loop on a generated estate, by code: render the hidden estate into a temporary folder, scan it
 * with the recorded answers, approve every atom (the validator stands in for the person), lint it, derive
 * the plan and approve every row, write the phrase bank and session index from the situations, generate the
 * suite, and load every spec. Levels read what they need from the result; nothing here scores.
 */

/** The clock of every scan: a fixed instant, so the same seed gives the same map. */
export const SCAN_CLOCK = () => new Date('2026-10-11T00:00:00.000Z');

/** The scanned atom an expected atom was matched to, and the reverse. */
export type AtomMatch = {
  /** hidden id to scanned id. */
  idOf: Map<string, string>;
  /** scanned id to hidden id. */
  hidOf: Map<string, string>;
  /** expected atoms with no scanned atom. */
  missed: ExpectedAtom[];
  /** scanned atoms with no expected atom. */
  extra: Atom[];
};

export type Scanned = {
  map: EstateMap;
  raw: RawEstate;
  match: AtomMatch;
  refusals: string[];
};

export type GeneratedSpec = {
  record: EstateSpecRecord;
  text: string;
  loaded?: LoadedSpec;
  /** Parse errors and lint warnings: a spec validates when it loads and has none of the second. */
  errors: string[];
  warnings: string[];
};

export type EstateRun = {
  estate: HiddenEstate;
  rendered: Rendered;
  scanned: Scanned;
  lint: LintResult;
  plan: PlanResult;
  situations: HiddenSituation[];
  bank: PhraseBank;
  sessions: SessionIndex;
  suite: EstateGenerateResult;
  specs: GeneratedSpec[];
};

/** The key code reads an atom by: what tells two atoms of one kind on one line apart. */
export function atomKey(atom: Atom): string {
  const fields = atom.fields ?? {};
  const field = (name: string) => (typeof fields[name] === 'string' ? (fields[name] as string) : '');
  switch (atom.kind) {
    case 'skill':
    case 'subagent':
    case 'guard':
      return field('name');
    case 'route':
      return field('target');
    case 'reference':
    case 'script':
      return field('path');
    case 'tool':
      return field('rule');
    case 'setting':
      return field('key');
    case 'stage': {
      // A step of a named process may be qualified by its process (`<process>/<id>`): the step id is the key.
      const id = field('id');
      const process = field('process');
      return process !== '' && id.startsWith(`${process}/`) ? id.slice(process.length + 1) : id;
    }
    case 'hazard':
      return field('hazard');
    case 'invariant':
      return field('check');
    default:
      return '';
  }
}

/** Matches scanned atoms to expected ones on kind, file, first line and key. */
export function matchAtoms(expected: readonly ExpectedAtom[], found: readonly Atom[]): AtomMatch {
  const slot = (kind: string, file: string, line: number, key: string) => `${kind}|${file}|${line}|${key}`;
  const open = new Map<string, Atom[]>();
  for (const atom of found) {
    const key = slot(atom.kind, atom.provenance.file, atom.provenance.startLine, atomKey(atom));
    open.set(key, [...(open.get(key) ?? []), atom]);
  }
  const idOf = new Map<string, string>();
  const hidOf = new Map<string, string>();
  const missed: ExpectedAtom[] = [];
  for (const atom of expected) {
    const list = open.get(slot(atom.kind, atom.file, atom.line, atom.key));
    const taken = list?.shift();
    if (!taken) {
      missed.push(atom);
      continue;
    }
    idOf.set(atom.hid, taken.id);
    hidOf.set(taken.id, atom.hid);
  }
  const extra = [...open.values()].flat();
  return { idOf, hidOf, missed, extra };
}

/** Writes the rendered files to a new temporary folder; the caller removes it. */
export async function writeEstate(files: Readonly<Record<string, string>>, root?: string): Promise<string> {
  const folder = root ?? (await mkdtemp(join(tmpdir(), 'driftbench-estate-validator-')));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  return folder;
}

/** Scans rendered files with the recording, approves every atom, and matches the atoms to the truth. */
export async function scanRendered(rendered: Rendered): Promise<Scanned> {
  const root = await writeEstate(rendered.files);
  try {
    const reader = readerFor(RUNTIME);
    if (!reader) throw new Error(`the scanner has no reader for the runtime ${RUNTIME}`);
    const result = await scanEstate({
      root,
      reader,
      port: estateRecordingPort(rendered.recording),
      now: SCAN_CLOCK,
    });
    const map: EstateMap = {
      ...result.map,
      atoms: result.map.atoms.map((atom) => ({ ...atom, approved: true })),
    };
    const refusals = [
      ...result.refusals.map((refusal) => `${refusal.chunk} ${refusal.entry}: ${refusal.reason}`),
      ...result.chunks
        .filter((chunk) => chunk.status !== 'done')
        .map((chunk) => `${chunk.chunk}: ${chunk.error ?? 'failed'}`),
    ];
    return { map, raw: result.raw, match: matchAtoms(rendered.atoms, map.atoms), refusals };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The plan of an approved map, every row approved. */
export function approvedPlan(map: EstateMap): PlanResult {
  const result = buildPlan(map);
  return {
    ...result,
    plan: { ...result.plan, rows: result.plan.rows.map((row) => ({ ...row, status: 'approved' as const })) },
  };
}

/** The whole loop on one hidden estate. */
export async function runEstate(estate: HiddenEstate): Promise<EstateRun> {
  const rendered = renderEstate(estate);
  const scanned = await scanRendered(rendered);
  const lint = lintEstate(scanned.map, scanned.raw);
  const plan = approvedPlan(scanned.map);
  const situations = situationsOf(estate);
  const bank = phraseBank(estate, situations, scanned.match.idOf, scanned.map.hash);
  const sessions = sessionIndex(bank);
  const suite = generateEstateSuite(
    {
      map: { runtime: scanned.map.runtime, hash: scanned.map.hash, atoms: scanned.map.atoms },
      plan: { mapHash: plan.plan.mapHash, rows: plan.plan.rows },
      bank,
      sessions,
    },
    {
      seed: estate.seed,
      paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml', sessions: 'sessions/index.yaml' },
    },
  );
  const texts = new Map(suite.files.map((file) => [file.path, file.text]));
  const specs = suite.specs.map((record): GeneratedSpec => {
    const text = texts.get(record.path) ?? '';
    const loaded = parseSpecText(text, 'yaml', record.path);
    if (!loaded.ok) {
      return {
        record,
        text,
        errors: loaded.errors.map((issue) => `${issue.code}: ${issue.message}`),
        warnings: [],
      };
    }
    return {
      record,
      text,
      loaded,
      errors: [],
      warnings: loaded.warnings.map((issue) => `${issue.code}: ${issue.message}`),
    };
  });
  return { estate, rendered, scanned, lint, plan, situations, bank, sessions, suite, specs };
}

const cache = new Map<string, Promise<EstateRun>>();

/** The run of a seed and profile, computed once per process. */
export function estateRun(seed: number, profile: Profile = 'visible'): Promise<EstateRun> {
  const key = `${profile}:${seed}`;
  let run = cache.get(key);
  if (!run) {
    run = runEstate(drawEstate(seed, profile));
    cache.set(key, run);
    // A failed run is not kept: the next level asks again and sees the same error.
    run.catch(() => cache.delete(key));
  }
  return run;
}

/** A generation test needs an executable estate. Keep the broken reference in scan/lint inputs,
 * and supply its file in this twin without deleting the reference atom or its read requirement. */
const generationCache = new Map<number, Promise<EstateRun>>();
export function generationRun(seed: number): Promise<EstateRun> {
  let run = generationCache.get(seed);
  if (!run) {
    const estate = drawEstate(seed);
    for (const skill of estate.skills) if (skill.missing) skill.referenceSupplied = true;
    run = runEstate(estate);
    generationCache.set(seed, run);
    run.catch(() => generationCache.delete(seed));
  }
  return run;
}

/** The checks of a replay: the configured defaults, ordered pairs and the production estate checks. */
export function replayChecks(): CheckSet {
  const registry = new CheckRegistry();
  for (const name of defaultRegistry.names()) {
    const check = defaultRegistry.get(name);
    if (check) registry.register(name, check);
  }
  if (!registry.get('ordered')) registry.register('ordered', orderedCheck);
  for (const [name, check] of Object.entries(ESTATE_CHECKS)) {
    if (!registry.get(name)) registry.register(name, check);
  }
  return defaultChecks({ registry });
}

export type ReplayOutcome = {
  pass: boolean;
  failing: string[];
  /**
   * Whether the run holds a measured failure: a gating check that returned `fail`, or an end state that missed. A run
   * that is not a pass without one is inconclusive (it did not complete, a check was inconclusive, a block was not
   * run): it measures nothing, so it is never a kill.
   */
  definite: boolean;
  error?: string;
  run: RunResult;
};

/** The asks of a spec: the user message of each block, in order. */
export function asksOf(spec: LoadedSpec): string[] {
  return spec.spec.blocks.map((block) => {
    const when = block.when as { user?: unknown } | undefined;
    return typeof when?.user === 'string' ? when.user : '';
  });
}

// The immutable follower inputs can be shared by fresh EstateRun wrappers. Key every
// dependency by identity: follow reads estate and situations; mapSession reads file keys.
// Changed inputs must have new identities. Never share a writable observation.
type FollowerSessions = Map<string, ReturnType<typeof mapSession>>;
const followerSessions = new WeakMap<
  HiddenEstate,
  WeakMap<Rendered['files'], WeakMap<HiddenSituation[], FollowerSessions>>
>();

function sessionsFor(run: EstateRun): FollowerSessions {
  let byFiles = followerSessions.get(run.estate);
  if (!byFiles) {
    byFiles = new WeakMap();
    followerSessions.set(run.estate, byFiles);
  }
  let bySituations = byFiles.get(run.rendered.files);
  if (!bySituations) {
    bySituations = new WeakMap();
    byFiles.set(run.rendered.files, bySituations);
  }
  let sessions = bySituations.get(run.situations);
  if (!sessions) {
    sessions = new Map();
    bySituations.set(run.situations, sessions);
  }
  return sessions;
}

/** Replays a spec over the follower's session for the spec's asks. */
export async function replayOnFollower(
  run: EstateRun,
  spec: LoadedSpec,
  checks: CheckSet,
  mutant?: string,
  counterexample?: (observed: Observed) => void,
): Promise<ReplayOutcome> {
  const asks = asksOf(spec);
  const events = spec.spec.blocks.map((block) => {
    const event = block.given?.vars?.event ?? spec.spec.given?.vars?.event;
    return typeof event === 'string' ? event : undefined;
  });
  const sessions = sessionsFor(run);
  const key = JSON.stringify({ asks, events, mutant });
  let original = sessions.get(key);
  if (!original) {
    const session = follow(run.estate, run.situations, asks, {
      ...(mutant ? { mutant } : {}),
      events,
    });
    original = mapSession({
      transcript: parseJsonl(session.transcript),
      decisions: parseJsonl(session.decisions),
      steps: parseJsonl(session.steps),
      references: Object.keys(run.rendered.files).map((path) => `**/${path}`),
    });
    sessions.set(key, original);
  }
  const mapped = structuredClone(original);
  if (counterexample) for (const block of mapped.blocks) counterexample(block.observed);
  const result = await runSpec(spec.spec, {
    adapter: replayAdapter({ session: mapped }),
    driver: createScriptedDriver(),
    checks,
    mode: 'F',
    repeat: 0,
    target: { adapter: RUNTIME, agent: 'rule-follower' },
    now: SCAN_CLOCK,
  });
  const failing = result.blocks.flatMap((block) =>
    block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map((verdict) => `block ${block.index}: ${verdict.id}: ${verdict.evidence ?? ''}`.trim()),
  );
  const pass =
    result.status === 'completed' &&
    result.blocks.every((block) => block.pass) &&
    result.endState?.match !== false;
  const definite =
    result.blocks.some((block) =>
      block.verdicts.some((verdict) => verdict.gating && verdict.outcome === 'fail'),
    ) || result.endState?.match === false;
  return { pass, failing, definite, ...(result.error ? { error: result.error } : {}), run: result };
}

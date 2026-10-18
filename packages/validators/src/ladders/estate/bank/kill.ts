import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EstateMap, loadEstateMap } from '@agent-nexus/driftbench-estate';
import { cli } from './bench';
import {
  decidedFailure,
  FIXTURE,
  type FixtureSuite,
  fixtureSuite,
  runOnFake,
  runOnFakeDetailed,
} from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { unitRun } from './unit';

/**
 * kill.fake: the mutant kill rate per mutant class, on the fake runtime (docs/estate.md section 8, estate
 * mutants). For an atom kind and an operation (delete, or invert for prose obligations), the n-th atom of
 * that kind in the Northwind fixture's approved map is mutated with `estate mutate`; the generated suite must
 * hold a complete live spec naming that atom which passes on the original estate and fails on the mutant,
 * both run with the fixture's fake runtime. One cause per atom kind: a generated test that a change of that
 * kind of atom turns red. The fixture does not depend on the seed: the family is judged once.
 */

const COMPONENT = 'packages/generate/src/estate/generate.ts';
const SPECS_PER_ATOM = 4;

export type Cell = { kind: string; index: number; op: 'delete' | 'invert' | 'break'; tier: Tier };

const KINDS: Array<[string, Tier]> = [
  ['instruction', 2],
  ['gate', 2],
  ['reference', 2],
  ['route', 1],
  ['skill', 1],
  ['script', 3],
  ['subagent', 3],
  ['guard', 3],
  ['tool', 2],
  ['register', 3],
  ['stage', 3],
  ['hazard', 4],
  ['setting', 4],
];

const CELLS: Cell[] = [
  ...KINDS.flatMap(([kind, tier]) => [0, 1].map((index) => ({ kind, index, op: 'delete' as const, tier }))),
  { kind: 'instruction', index: 0, op: 'invert', tier: 3 },
  { kind: 'gate', index: 0, op: 'invert', tier: 3 },
  { kind: 'register', index: 0, op: 'invert', tier: 4 },
  // An invariant is a property of the files, anchored on a line: deleting the anchor leaves the property as it
  // was, and of the fixture's invariants only the size ceiling holds on the original (section 2's lint transcript
  // lists the others as findings). Its cell breaks the property on a copy and keeps the anchor.
  { kind: 'invariant', index: 0, op: 'break', tier: 4 },
];

/** The size ceiling of the standing instructions `estate static` applies by default (its --ceiling). */
export const STANDING_CEILING = 40_000;

const keyOf = (cell: Cell) => `${cell.op}-${cell.kind}-${cell.index + 1}`;

export function killFamily(): Family {
  const family = 'kill.fake';
  const items = itemsOf(
    family,
    5,
    COMPONENT,
    CELLS.map((cell) => ({
      key: keyOf(cell),
      tier: cell.tier,
      title: `a generated spec, green on the original fixture, turns red on the ${cell.op} mutant of ${cell.kind} atom ${cell.index + 1}`,
      cause: `generate a test that a change of a ${cell.kind} atom turns red on the fake runtime`,
    })),
  );
  return {
    id: family,
    level: 5,
    component: COMPONENT,
    items,
    seedFree: true,
    async evaluate() {
      const out = new Map<string, ItemResult>();
      const suite = await fixtureSuite();
      const map = await loadEstateMap(suite.map);
      if (!map.ok) {
        for (const item of items) out.set(item.id, { pass: false, detail: 'the fixture map does not load' });
        return out;
      }
      const work = await mkdtemp(join(tmpdir(), 'estate-kill-'));
      const originalVerdict = new Map<string, boolean>();
      try {
        for (const cell of CELLS) {
          out.set(
            `${family}.${keyOf(cell)}`,
            await judgeCell(cell, map.map, suite, join(FIXTURE, 'approved.yaml'), work, originalVerdict),
          );
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      return out;
    },
  };
}

/**
 * One cell, on an estate root (the fixture by default): the atom of the cell, then the tests that judge its kind. A
 * guard that enforces only prohibitions is judged by its unit tests (docs/estate.md section 6, estate mutants);
 * every other atom with a live test by its live tests.
 */
export async function judgeCell(
  cell: Cell,
  estate: EstateMap,
  suite: Pick<FixtureSuite, 'specs' | 'natives'>,
  map: string,
  work: string,
  original: Map<string, boolean>,
  root: string = FIXTURE,
): Promise<ItemResult> {
  const specs = suite.specs;
  const atom = estate.atoms
    .filter((candidate) => candidate.kind === cell.kind)
    .map((candidate) => candidate.id)
    .sort()[cell.index];
  if (!atom) return { pass: false, detail: `the fixture holds no ${cell.kind} atom ${cell.index + 1}` };
  // docs/estate.md section 5: invariant and setting rows are static tests, run by `estate static` on the
  // original or a mutant copy. They never have a live spec, so they are judged by their static tests.
  if (cell.kind === 'invariant') return judgeInvariant(estate, specs, work);
  if (cell.kind === 'setting') return judgeStatic(cell, atom, specs, map, work);
  const same = equivalent(cell, atom, estate);
  if (same) return { pass: true, detail: `not judged, an equivalent mutant: ${same}` };
  if (cell.kind === 'guard' && cell.op === 'delete' && prohibitionGuard(atom, estate))
    return judgeByUnits(cell, atom, estate, suite.natives, map, work, root);
  return judgeLive(cell, atom, specs, map, work, original, root);
}

/**
 * Whether a guard enforces only prohibitions: every atom whose enforcement names it is a rule of polarity
 * `prohibition`, and there is one. Such a guard acts only after or on an act a standing rule forbids, so an agent
 * that keeps the rule never reaches it (docs/estate.md section 6, estate mutants). Read from the map's typed facts.
 */
export function prohibitionGuard(atomId: string, estate: EstateMap): boolean {
  const enforced = estate.atoms.filter((candidate) => (candidate.enforcement ?? []).includes(atomId));
  return enforced.length > 0 && enforced.every((candidate) => candidate.fields?.polarity === 'prohibition');
}

/**
 * A guard's delete, judged by its `guard_positive` unit tests: their payload does the forbidden act. Their
 * outcomes are recorded on the original, a test green there must turn red on the mutant, and a test already red on
 * the original is no kill.
 */
export async function judgeByUnits(
  cell: Cell,
  atom: string,
  estate: EstateMap,
  natives: FixtureSuite['natives'],
  map: string,
  work: string,
  root: string = FIXTURE,
): Promise<ItemResult> {
  const named = natives.filter((spec) => spec.testType === 'guard_positive' && spec.atoms.includes(atom));
  if (named.length === 0) return { pass: false, detail: `no guard_positive unit test names ${atom}` };
  const folder = join(work, `units-${cell.op}-${cell.kind}-${cell.index}`);
  await mkdir(folder, { recursive: true });
  const copies = [];
  for (const spec of named) {
    const path = join(folder, `${spec.id}.json`);
    await cp(spec.path, path);
    copies.push({ ...spec, path });
  }
  const recording = cli(['estate', 'unit', folder, '--estate', root, '--record', '--json']);
  if (recording.code > 1)
    return {
      pass: false,
      detail: `estate unit --record exited ${recording.code}: ${recording.out.trim().slice(0, 140)}`,
    };
  const before = unitRun(root, copies);
  if (before.error) return { pass: false, detail: before.error };
  // A kill needs the guard to act on the forbidden act on the original: the recorded outcome of a case is its
  // intervention (deny, warn or nudge, the verdict the map declares for the guard when it declares one), never an
  // allow. A guard that lets the act through gives the mutant nothing to lose.
  const declared = estate.atoms
    .find((candidate) => candidate.id === atom)
    ?.evidence.find((item) => item.type === 'guard')?.verdict;
  const acting = [];
  for (const spec of copies) {
    if (before.verdicts.get(spec.id) !== true) continue;
    const record = JSON.parse(await readFile(spec.path, 'utf8')) as { cases?: RecordedCase[] };
    if ((record.cases ?? []).some((unitCase) => intervenes(unitCase, declared))) acting.push(spec);
  }
  if (acting.length === 0)
    return {
      pass: false,
      detail: `none of the ${copies.length} guard_positive unit tests of ${atom} intervenes on the original${declared ? ` (declared verdict ${declared})` : ''}`,
    };
  const green = acting;
  const mutant = join(work, `${cell.op}-${cell.kind}-${cell.index}`);
  const made = cli(['estate', 'mutate', map, '--atom', atom, `--${cell.op}`, '--to', mutant]);
  if (made.code !== 0)
    return {
      pass: false,
      detail: `estate mutate refused the ${cell.op} of ${atom}: ${made.out.trim().slice(0, 140)}`,
    };
  const after = unitRun(mutant, green);
  if (after.error) return { pass: false, detail: after.error };
  // Exit 2 is an input error (a usage error, or a test with no recorded outcome): it decided nothing, so it kills
  // nothing (docs/estate.md section 6).
  if (after.code > 1)
    return {
      pass: false,
      detail: `estate unit exited ${after.code} on the mutant: an input error is no kill`,
    };
  const red = green.filter((spec) => after.verdicts.get(spec.id) === false);
  return red.length > 0
    ? {
        pass: true,
        detail: `${red[0]?.id} turns red (a guard that enforces only prohibitions, judged by its unit tests)`,
      }
    : {
        pass: false,
        detail: `the ${green.length} guard_positive unit tests green on the original stay green on the ${cell.op} mutant of ${atom}`,
      };
}

/** One case of a native unit test, with the outcome `estate unit --record` wrote on the original. */
type RecordedCase = {
  inert?: boolean;
  flaky?: boolean;
  expected?: { decision?: string; exitCode?: number; message?: string; output?: string };
};

/**
 * Whether a recorded case is an intervention of the guard, as docs/estate.md section 6 reads guard outcomes: exit 2 or
 * a deny decision denies, another nonzero exit warns, and context on standard output with exit 0 nudges. An inert or
 * flaky case, or an allow, is none. When the map declares the guard's verdict, the intervention must be that one.
 */
export function intervenes(unitCase: RecordedCase, declared?: string): boolean {
  const outcome = unitCase.expected;
  if (!outcome || unitCase.inert || unitCase.flaky) return false;
  const verdict =
    outcome.decision === 'deny' || outcome.decision === 'block' || outcome.exitCode === 2
      ? 'deny'
      : outcome.decision === 'ask'
        ? 'ask'
        : typeof outcome.exitCode === 'number' && outcome.exitCode !== 0
          ? 'warn'
          : (outcome.output ?? '').trim() !== ''
            ? 'nudge'
            : 'allow';
  if (verdict === 'allow') return false;
  return declared === undefined || declared === verdict || (declared === 'block' && verdict === 'deny');
}

/** An atom's delete or invert, judged by its complete live specs on the fake runtime. */
export async function judgeLive(
  cell: Cell,
  atom: string,
  specs: FixtureSuite['specs'],
  map: string,
  work: string,
  original: Map<string, boolean>,
  root: string = FIXTURE,
): Promise<ItemResult> {
  const naming = specs.filter((spec) => spec.complete && spec.mode === 'live' && spec.atoms.includes(atom));
  if (naming.length === 0) return { pass: false, detail: `no complete live spec names ${atom}` };
  const chosen = naming.slice(0, SPECS_PER_ATOM);
  const unknown = chosen.filter((spec) => !original.has(spec.id));
  if (unknown.length > 0) {
    const verdicts = runOnFake(
      root,
      unknown.map((spec) => spec.path),
      join(work, `original-${original.size}.db`),
      map,
    );
    for (const spec of unknown) original.set(spec.id, verdicts.get(spec.id) === true);
  }
  const green = chosen.filter((spec) => original.get(spec.id));
  if (green.length === 0)
    return {
      pass: false,
      detail: `none of the ${chosen.length} complete live specs naming ${atom} passes on the original`,
    };
  const mutant = join(work, `${cell.op}-${cell.kind}-${cell.index}`);
  const made = cli(['estate', 'mutate', map, '--atom', atom, `--${cell.op}`, '--to', mutant]);
  if (made.code !== 0)
    return {
      pass: false,
      detail: `estate mutate refused the ${cell.op} of ${atom}: ${made.out.trim().slice(0, 140)}`,
    };
  const verdicts = runOnFakeDetailed(
    mutant,
    green.map((spec) => spec.path),
    join(mutant, 'runs.db'),
  );
  // Red is a run that reached its end and failed a check the evidence decides: not a run that broke off, and not a
  // judged criterion the stand-in judge left inconclusive.
  const red = green.filter((spec) => {
    const run = verdicts.get(spec.id);
    return run?.completed === true && !run.pass && run.failing.some(decidedFailure);
  });
  return red.length > 0
    ? { pass: true, detail: `${red[0]?.id} turns red` }
    : {
        pass: false,
        detail: `the ${green.length} specs green on the original stay green on the ${cell.op} mutant of ${atom}`,
      };
}

/**
 * Why the mutant of the cell's atom is equivalent (nothing the agent sees or does changes), or undefined. Read
 * from the fixture's files and map, never from the product under test:
 * a skill's `name:` line whose value is the skill's folder: the runtime names a skill by its folder
 * (docs/estate.md section 8, the same rule `estate mutate` follows when it refuses the delete). A gate is never
 * named here: its words can hold a condition the step list does not (verify "has passed"), so a stronger
 * product can kill its delete with a spec on the case the step list allows and the gate forbids.
 */
export function equivalent(cell: Cell, atomId: string, estate: EstateMap): string | undefined {
  if (cell.op !== 'delete') return undefined;
  const atom = estate.atoms.find((candidate) => candidate.id === atomId);
  if (!atom) return undefined;
  if (atom.kind === 'skill') {
    const folder = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(atom.provenance.file)?.[1];
    const name = /^name:\s*(\S+)\s*$/.exec(atom.provenance.quote.trim())?.[1];
    return folder && name === folder
      ? `the name line of ${atom.provenance.file} repeats its folder, ${folder}, and the runtime names a skill by its folder`
      : undefined;
  }
  return undefined;
}

/** A setting cell: a static test naming the atom passes on the original and fails on the mutant. */
async function judgeStatic(
  cell: Cell,
  atom: string,
  specs: Awaited<ReturnType<typeof fixtureSuite>>['specs'],
  map: string,
  work: string,
): Promise<ItemResult> {
  const tests = specs
    .filter((spec) => spec.mode === 'static' && spec.atoms.includes(atom))
    .map((spec) => spec.path);
  if (tests.length === 0) return { pass: false, detail: `no static test names ${atom}` };
  const verdicts = (estate: string): boolean[] => staticVerdicts(tests, estate);
  const original = verdicts(FIXTURE);
  if (!original.some(Boolean))
    return {
      pass: false,
      detail: `none of the ${tests.length} static tests naming ${atom} passes on the original`,
    };
  const mutant = join(work, `${cell.op}-${cell.kind}-${cell.index}`);
  const made = cli(['estate', 'mutate', map, '--atom', atom, `--${cell.op}`, '--to', mutant]);
  if (made.code !== 0)
    return {
      pass: false,
      detail: `estate mutate refused the ${cell.op} of ${atom}: ${made.out.trim().slice(0, 140)}`,
    };
  const after = verdicts(mutant);
  return original.some((green, index) => green && after[index] === false)
    ? { pass: true, detail: `a static test of ${atom} turns red on the ${cell.op} mutant` }
    : {
        pass: false,
        detail: `the static tests green on the original stay green on the ${cell.op} mutant of ${atom}`,
      };
}

/**
 * A copy of the fixture whose standing instructions run past the size ceiling, the anchor line kept: the first
 * line of CLAUDE.md is unchanged and filler lines are appended until the file holds more than the ceiling.
 */
export async function breakStandingSize(
  source: string,
  to: string,
  ceiling = STANDING_CEILING,
): Promise<string> {
  await cp(source, to, { recursive: true });
  const file = join(to, 'CLAUDE.md');
  const text = await readFile(file, 'utf8');
  const filler = '- Keep this line: it pads the standing instructions past their size ceiling.\n';
  const lines = Math.ceil((ceiling - text.length) / filler.length) + 10;
  await writeFile(file, `${text}${text.endsWith('\n') ? '' : '\n'}${filler.repeat(Math.max(lines, 1))}`);
  return to;
}

/** The invariant cell: the static test of the size ceiling passes on the original and fails on the broken copy. */
async function judgeInvariant(
  estate: EstateMap,
  specs: Awaited<ReturnType<typeof fixtureSuite>>['specs'],
  work: string,
): Promise<ItemResult> {
  const atom = estate.atoms.find(
    (candidate) =>
      candidate.kind === 'invariant' &&
      candidate.evidence.some((item) => item.type === 'static' && item.check === 'standing_size'),
  );
  if (!atom)
    return { pass: false, detail: 'the fixture holds no invariant on the size of the standing instructions' };
  const tests = specs
    .filter((spec) => spec.mode === 'static' && spec.atoms.includes(atom.id))
    .map((spec) => spec.path);
  if (tests.length === 0) return { pass: false, detail: `no static test names ${atom.id}` };
  const original = staticVerdicts(tests, FIXTURE);
  if (!original.some(Boolean))
    return {
      pass: false,
      detail: `none of the ${tests.length} static tests naming ${atom.id} passes on the original`,
    };
  const broken = await breakStandingSize(FIXTURE, join(work, 'break-invariant'));
  const after = staticVerdicts(tests, broken);
  return original.some((green, index) => green && after[index] === false)
    ? { pass: true, detail: `a static test of ${atom.id} turns red on a copy past the size ceiling` }
    : {
        pass: false,
        detail: `the static tests of ${atom.id} green on the original stay green on a copy whose standing instructions run past ${STANDING_CEILING} characters`,
      };
}

/** The pass flags `estate static` prints for the tests on an estate root; empty when it prints no JSON. */
function staticVerdicts(tests: readonly string[], root: string): boolean[] {
  const run = cli(['estate', 'static', ...tests, '--estate', root, '--json']);
  const at = run.out.indexOf('{');
  if (at < 0) return [];
  try {
    return ((JSON.parse(run.out.slice(at)) as { results?: Array<{ pass: boolean }> }).results ?? []).map(
      (result) => result.pass === true,
    );
  } catch {
    return [];
  }
}

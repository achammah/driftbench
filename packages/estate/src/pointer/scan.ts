import { ModelError } from '@agent-nexus/driftbench-generate';
import { type Cassette, CassetteMiss, type Recorded, readableOf, wireKey } from './cassette';
import { type Cut, cut, type Unit } from './cut';
import {
  isTooLarge,
  type Labeler,
  type LabelerClass,
  LabelerConfigError,
  LabelerError,
  type Opinion,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from './labeler';
import { type LabelSet, setHash, type Window } from './labels';
import { type Event, type Ledger, type LedgerEntry, nextLedger, unitKey } from './ledger';
import type { Labelling } from './stack';

/**
 * The pointer scan: cut each prose file into units, follow the units through the ledger, send the windows
 * that are not yet labelled to the labelers (or read the cassette), and write the labels into the ledger.
 * The labelers return opinions by unit number; code owns every byte of text and decides each label.
 */

export type PointerInput = {
  /** The prose files: path and text. */
  files: ReadonlyArray<{ path: string; text: string }>;
  sets: readonly LabelSet[];
  labelling: Labelling;
  cassette: Cassette;
  /** `replay`: a miss is an error. `record`: a miss calls the labeler and records the answer. */
  mode: 'replay' | 'record';
  estateKey?: string;
  previous?: Ledger;
  /** The most units in one window before the labeler's own cap. Default 60. */
  windowUnits?: number;
  /** Requests in flight at once. Default 1. The labels, the ledger and the cassette bytes do not depend on it. */
  jobs?: number;
  /** Called once with the plan, before the first request, so a caller can say what a run sends. */
  onPlan?: (plan: PointerPlan) => void;
};

export const DEFAULT_WINDOW_UNITS = 60;

/** What one labeler of the run is asked: its windows, how many the cassette already answers, what is left to send. */
export type MemberPlan = {
  id: string;
  cls: LabelerClass;
  model: string;
  /** Requests the run needs from this labeler. */
  windows: number;
  /** Of those, the requests the cassette already answers. */
  cached: number;
  /** Characters of the request bodies still to send. */
  characters: number;
};

export type PointerPlan = {
  files: number;
  /** Units a label can point at (a fence or a comment is opaque), summed over the label sets. */
  units: number;
  /** Of those, the units that already hold a label of the current sets and labelers. */
  carried: number;
  members: MemberPlan[];
};

/** A unit that carries a label of a set, ready for the atom builder. */
export type LabelledUnit = {
  path: string;
  index: number;
  unit: Unit;
  id: string;
  set: LabelSet;
  label: string;
  target?: { path: string; index: number; unit: Unit; id: string };
  source: string;
  by?: LabelerClass;
};

export type LabelerUsage = {
  id: string;
  cls: LabelerClass;
  model: string;
  /** Requests sent to the service. */
  calls: number;
  /** Answers added to the cassette. */
  recorded: number;
  input: number;
  output: number;
};

export type PointerResult = {
  ledger: Ledger;
  events: Record<Event, number>;
  cuts: Map<string, Cut>;
  labelled: LabelledUnit[];
  plan: PointerPlan;
  /** Requests answered, by the cassette or by a service. */
  windows: number;
  /** Units that kept the label of the ledger. */
  carried: number;
  /** Units labelled by this run. */
  decided: number;
  /** Of those, how many each class decided. */
  decidedBy: Record<LabelerClass, number>;
  /** Of those, the units one labeler of a stack decided alone because the other gave no opinion. */
  fellBack: number;
  calls: number;
  /** Units no accepted answer named. */
  unlabeled: number;
  refusals: string[];
  /** Windows that could not be labelled, with the reason. */
  failed: string[];
  usage: LabelerUsage[];
  /** Answers added to the cassette. */
  recorded: number;
};

/** Heading-bounded runs of units (a window ends where the next top-level heading starts), capped by unit count. */
export function windowsOf(path: string, units: readonly Unit[], size: number): Window[] {
  const windows: Window[] = [];
  let current: Window['units'] = [];
  let first: Unit | undefined;
  const flush = () => {
    if (current.length === 0) return;
    windows.push({
      id: `${path}#${windows.length + 1}`,
      path,
      headingPath: first?.path ?? [],
      units: current,
    });
    current = [];
    first = undefined;
  };
  for (const [index, unit] of units.entries()) {
    // A fence or comment is opaque: it is never shown to the labeler, so no label can point at it.
    if (unit.container === 'opaque') continue;
    if (unit.container === 'heading' && unit.path.length === 0 && current.length > 0) flush();
    first ??= unit;
    current.push({ n: current.length + 1, text: unit.text, index });
    if (current.length >= size) flush();
  }
  flush();
  return windows;
}

const RETRYABLE = (cause: unknown): boolean =>
  cause instanceof LabelerError ||
  (cause instanceof ModelError && cause.code !== 'config' && cause.code !== 'refusal');

/** A failure that stops the run: nothing the next window does can fix it. */
const FATAL = (cause: unknown): boolean =>
  cause instanceof CassetteMiss || cause instanceof LabelerConfigError;

/** Runs the tasks `jobs` at a time, results in task order. After a fatal failure no new task starts. */
async function runPool<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  jobs: number,
): Promise<Array<{ ok: true; value: T } | { ok: false; error: unknown } | undefined>> {
  const results: Array<{ ok: true; value: T } | { ok: false; error: unknown } | undefined> = new Array(
    tasks.length,
  ).fill(undefined);
  let next = 0;
  let stop = false;
  const worker = async () => {
    for (;;) {
      const at = next++;
      const task = tasks[at];
      if (!task || stop) return;
      try {
        results[at] = { ok: true, value: await task() };
      } catch (error) {
        results[at] = { ok: false, error };
        if (FATAL(error)) stop = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, tasks.length)) }, worker));
  return results;
}

type Task = {
  order: number;
  file: string;
  set: LabelSet;
  member: Labeler;
  memberAt: number;
  window: Window;
  digest: string;
};

type Leaf = { window: Window; answer: Recorded; key: string };
type TaskResult = { leaves: Leaf[]; failures: string[] };

function readableFor(task: Task, window: Window) {
  return readableOf(task.member.render(task.set, window), {
    path: window.path,
    window: window.id,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    set: task.set.set,
    setHash: setHash(task.set),
    model: task.member.model,
    cutDigest: task.digest,
  });
}

export async function pointerScan(input: PointerInput): Promise<PointerResult> {
  const { labelling, cassette } = input;
  const estateKey = input.estateKey ?? 'estate';
  const size = input.windowUnits ?? DEFAULT_WINDOW_UNITS;
  const files = [...input.files].sort((a, b) => a.path.localeCompare(b.path));
  const cuts = new Map(files.map((file) => [file.path, cut(file.text)]));
  const next = nextLedger(
    files.map((file) => ({ path: file.path, cut: cuts.get(file.path) as Cut })),
    input.previous,
    estateKey,
  );
  const entries = new Map<string, LedgerEntry>(next.ledger.entries.map((entry) => [entry.id, entry]));
  const unitId = (path: string, index: number): string => next.ids.get(unitKey(path, index)) as string;

  // 1. The units that need a label: none yet, or one made by other sets or other labelers.
  const hashes = new Map(input.sets.map((set) => [set.set, setHash(set)]));
  const needed = new Map<string, Set<number>>();
  let units = 0;
  let carried = 0;
  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const set of input.sets) {
      const want = new Set<number>();
      for (const [index, unit] of fileCut.units.entries()) {
        if (unit.container === 'opaque') continue;
        units++;
        const found = entries.get(unitId(file.path, index))?.labels[set.set];
        if (found && found.setHash === hashes.get(set.set) && found.labeler === labelling.hash) carried++;
        else want.add(index);
      }
      needed.set(`${file.path}\0${set.set}`, want);
    }
  }

  // 2. The requests: for each member, the windows that hold a unit that needs a label.
  const tasks: Task[] = [];
  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const set of input.sets) {
      const want = needed.get(`${file.path}\0${set.set}`) as Set<number>;
      if (want.size === 0) continue;
      for (const [memberAt, member] of labelling.members.entries()) {
        for (const window of windowsOf(file.path, fileCut.units, member.maxUnits(set, size))) {
          if (!window.units.some((unit) => want.has(unit.index))) continue;
          tasks.push({
            order: tasks.length,
            file: file.path,
            set,
            member,
            memberAt,
            window,
            digest: fileCut.digest,
          });
        }
      }
    }
  }

  const plan: PointerPlan = {
    files: files.length,
    units,
    carried,
    members: labelling.members.map((member) => ({
      id: member.id,
      cls: member.cls,
      model: member.model,
      windows: 0,
      cached: 0,
      characters: 0,
    })),
  };
  for (const task of tasks) {
    const wire = task.member.render(task.set, task.window);
    const entry = plan.members[task.memberAt] as MemberPlan;
    entry.windows++;
    if (cassette.entries.has(wireKey(wire))) entry.cached++;
    else entry.characters += JSON.stringify(wire.body).length;
  }
  input.onPlan?.(plan);

  // 3. The answers, `jobs` at a time. A window the service refuses as too large is halved.
  const tally = labelling.members.map(() => ({ calls: 0, recorded: 0, input: 0, output: 0 }));

  async function answerOf(task: Task, window: Window): Promise<{ answer: Recorded; key: string }> {
    const { member } = task;
    const wire = member.render(task.set, window);
    const readable = readableFor(task, window);
    try {
      const hit = cassette.get(wire, readable);
      return { answer: hit.answer, key: hit.key };
    } catch (cause) {
      if (!(cause instanceof CassetteMiss) || input.mode === 'replay' || !member.call) throw cause;
    }
    const counts = tally[task.memberAt] as (typeof tally)[number];
    // One retry after an answer that cannot be read; nothing is recorded for a window that fails twice.
    let failure: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        counts.calls++;
        const answer = await member.call(wire, task.set, window, attempt);
        counts.input += answer.usage.input;
        counts.output += answer.usage.output;
        cassette.put(wire, readable, answer);
        counts.recorded++;
        return { answer, key: wireKey(wire) };
      } catch (cause) {
        failure = cause;
        if (isTooLarge(cause)) {
          // The refusal is recorded, so a replay halves the window the same way without a call.
          const refused: Recorded = {
            returnedModel: member.model,
            stopReason: 'too_large',
            refused: 'too_large',
            usage: { input: 0, output: 0 },
          };
          cassette.put(wire, readable, refused);
          counts.recorded++;
          return { answer: refused, key: wireKey(wire) };
        }
        if (!RETRYABLE(cause)) break;
      }
    }
    throw failure;
  }

  async function resolve(task: Task, window: Window): Promise<TaskResult> {
    let result: { answer: Recorded; key: string };
    try {
      result = await answerOf(task, window);
    } catch (cause) {
      if (FATAL(cause)) throw cause;
      return {
        leaves: [],
        failures: [
          `${window.id} (${task.set.set}, ${task.member.id}): ${cause instanceof Error ? cause.message : String(cause)}`,
        ],
      };
    }
    if (result.answer.refused !== 'too_large') {
      return { leaves: [{ window, answer: result.answer, key: result.key }], failures: [] };
    }
    if (window.units.length === 1) {
      return {
        leaves: [],
        failures: [
          `${window.id} (${task.set.set}, ${task.member.id}): the endpoint refused a window of one unit as too large`,
        ],
      };
    }
    const half = Math.ceil(window.units.length / 2);
    const renumber = (list: Window['units']) => list.map((unit, at) => ({ ...unit, n: at + 1 }));
    const first = await resolve(task, {
      ...window,
      id: `${window.id}a`,
      units: renumber(window.units.slice(0, half)),
    });
    const second = await resolve(task, {
      ...window,
      id: `${window.id}b`,
      units: renumber(window.units.slice(half)),
    });
    return { leaves: [...first.leaves, ...second.leaves], failures: [...first.failures, ...second.failures] };
  }

  const settled = await runPool(
    tasks.map((task) => () => resolve(task, task.window)),
    input.jobs ?? 1,
  );
  for (const outcome of settled) if (outcome && !outcome.ok) throw outcome.error;

  // 4. The opinions of each member, by unit, then one decision per unit that needed a label.
  const refusals: string[] = [];
  const failed: string[] = [];
  let windows = 0;
  const opinions = new Map<string, Array<Map<number, Opinion>>>();
  const opinionsOf = (file: string, set: LabelSet): Array<Map<number, Opinion>> => {
    const key = `${file}\0${set.set}`;
    let found = opinions.get(key);
    if (!found) {
      found = labelling.members.map(() => new Map<number, Opinion>());
      opinions.set(key, found);
    }
    return found;
  };
  for (const [at, task] of tasks.entries()) {
    const outcome = settled[at];
    if (!outcome?.ok) continue;
    failed.push(...outcome.value.failures);
    for (const leaf of outcome.value.leaves) {
      windows++;
      const read = task.member.opinions(leaf.answer, task.set, leaf.window);
      refusals.push(...read.refusals);
      const target = opinionsOf(task.file, task.set)[task.memberAt] as Map<number, Opinion>;
      for (const [index, opinion] of read.byUnit)
        target.set(index, { ...opinion, source: leaf.key.slice(0, 12) });
    }
  }

  let unlabeled = 0;
  let decided = 0;
  const decidedBy: Record<LabelerClass, number> = { system1: 0, system2: 0 };
  let fellBack = 0;
  for (const file of files) {
    for (const set of input.sets) {
      const want = needed.get(`${file.path}\0${set.set}`) as Set<number>;
      if (want.size === 0) continue;
      const byMember = opinionsOf(file.path, set);
      for (const index of [...want].sort((a, b) => a - b)) {
        const entry = entries.get(unitId(file.path, index));
        if (!entry) continue;
        const decision = labelling.decide(
          byMember.map((memberOpinions) => memberOpinions.get(index)),
          set,
        );
        if (!decision) {
          unlabeled++;
          delete entry.labels[set.set];
          continue;
        }
        decided++;
        decidedBy[decision.by]++;
        if (decision.fallback) fellBack++;
        const targetId = decision.target === undefined ? undefined : unitId(file.path, decision.target);
        entry.labels[set.set] = {
          label: decision.label,
          setHash: hashes.get(set.set) as string,
          labeler: labelling.hash,
          source: decision.sources.length === 0 ? 'none' : `cassette:${decision.sources.join('+')}`,
          by: decision.by,
          ...(targetId ? { target: targetId } : {}),
        };
      }
    }
  }

  // 5. The labelled units, in file order, for the atom builder.
  const labelled: LabelledUnit[] = [];
  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const [index, unit] of fileCut.units.entries()) {
      const id = unitId(file.path, index);
      const entry = entries.get(id);
      if (!entry) continue;
      for (const set of input.sets) {
        const found = entry.labels[set.set];
        if (
          !found ||
          found.label === 'none' ||
          found.setHash !== hashes.get(set.set) ||
          found.labeler !== labelling.hash
        ) {
          continue;
        }
        const targetIndex = found.target
          ? fileCut.units.findIndex((_, at) => unitId(file.path, at) === found.target)
          : -1;
        const targetUnit = targetIndex >= 0 ? fileCut.units[targetIndex] : undefined;
        labelled.push({
          path: file.path,
          index,
          unit,
          id,
          set,
          label: found.label,
          ...(targetUnit && found.target
            ? { target: { path: file.path, index: targetIndex, unit: targetUnit, id: found.target } }
            : {}),
          source: found.source,
          ...(found.by ? { by: found.by } : {}),
        });
      }
    }
  }

  const usage = labelling.members.map((member, at) => ({
    id: member.id,
    cls: member.cls,
    model: member.model,
    ...(tally[at] as (typeof tally)[number]),
  }));
  return {
    ledger: next.ledger,
    events: next.events,
    cuts,
    labelled,
    plan,
    windows,
    carried,
    decided,
    decidedBy,
    fellBack,
    calls: usage.reduce((sum, entry) => sum + entry.calls, 0),
    unlabeled,
    refusals,
    failed,
    usage,
    recorded: usage.reduce((sum, entry) => sum + entry.recorded, 0),
  };
}

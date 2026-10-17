import { ModelError } from '@agent-nexus/driftbench-generate';
import { type Cassette, CassetteMiss, type Recorded, readableOf, wireKey } from './cassette';
import { type Cut, cut, type Unit } from './cut';
import {
  isTooLarge,
  type Labeler,
  LabelerConfigError,
  LabelerError,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from './labeler';
import { checkAnswer, type LabelSet, setHash, type Window } from './labels';
import { type Event, type Ledger, type LedgerEntry, nextLedger, unitKey } from './ledger';

/**
 * The pointer scan: cut each prose file into units, follow the units through the ledger, send the windows
 * that are not yet labelled to the labeler (or read the cassette), check every answer, and write the labels
 * into the ledger. The labeler returns names and numbers; code owns every byte of text.
 */

export type PointerInput = {
  /** The prose files: path and text. */
  files: ReadonlyArray<{ path: string; text: string }>;
  sets: readonly LabelSet[];
  labeler: Labeler;
  cassette: Cassette;
  /** `replay`: a miss is an error. `record`: a miss calls the labeler and records the answer. */
  mode: 'replay' | 'record';
  estateKey?: string;
  previous?: Ledger;
  /** The most units in one window before the labeler's own cap. Default 60. */
  windowUnits?: number;
};

export const DEFAULT_WINDOW_UNITS = 60;

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
};

export type PointerResult = {
  ledger: Ledger;
  events: Record<Event, number>;
  cuts: Map<string, Cut>;
  labelled: LabelledUnit[];
  /** Requests answered by the cassette or the labeler. */
  windows: number;
  /** Windows whose units all kept a recorded label, so no request was made. */
  carried: number;
  calls: number;
  /** Units no accepted answer named. */
  unlabeled: number;
  refusals: string[];
  /** Windows that could not be labelled, with the reason. */
  failed: string[];
  usage: { input: number; output: number };
  /** Whether the cassette gained an entry. */
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

async function answerOf(
  input: PointerInput,
  set: LabelSet,
  window: Window,
  digest: string,
  tally: { calls: number; recorded: number; usage: { input: number; output: number } },
): Promise<{ answer: Recorded; key: string }> {
  const { labeler, cassette } = input;
  const wire = labeler.render(set, window);
  const readable = readableOf(wire, {
    path: window.path,
    window: window.id,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    set: set.set,
    setHash: setHash(set),
    model: labeler.model,
    cutDigest: digest,
  });
  try {
    const hit = cassette.get(wire, readable);
    return { answer: hit.answer, key: hit.key };
  } catch (cause) {
    if (!(cause instanceof CassetteMiss) || input.mode === 'replay' || !labeler.call) throw cause;
  }
  // One retry after an answer that cannot be read; nothing is recorded for a window that fails twice.
  let failure: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      tally.calls++;
      const answer = await labeler.call(wire, set, window);
      tally.usage.input += answer.usage.input;
      tally.usage.output += answer.usage.output;
      cassette.put(wire, readable, answer);
      tally.recorded++;
      return { answer, key: wireKey(wire) };
    } catch (cause) {
      failure = cause;
      if (isTooLarge(cause)) {
        // The refusal is recorded, so a replay halves the window the same way without a call.
        const refused: Recorded = {
          returnedModel: labeler.model,
          stopReason: 'too_large',
          refused: 'too_large',
          usage: { input: 0, output: 0 },
        };
        cassette.put(wire, readable, refused);
        tally.recorded++;
        return { answer: refused, key: wireKey(wire) };
      }
      if (!RETRYABLE(cause)) break;
    }
  }
  throw failure;
}

export async function pointerScan(input: PointerInput): Promise<PointerResult> {
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
  const tally = { calls: 0, recorded: 0, usage: { input: 0, output: 0 } };
  const refusals: string[] = [];
  const failed: string[] = [];
  let windows = 0;
  let carried = 0;
  let unlabeled = 0;

  /** Labels one window; a window the endpoint refuses as too large is halved and each half asked again. */
  async function labelWindow(set: LabelSet, window: Window, digest: string): Promise<void> {
    const hash = setHash(set);
    const ids = window.units.map((unit) => next.ids.get(unitKey(window.path, unit.index)) as string);
    const known = ids.map((id) => entries.get(id)?.labels[set.set]);
    if (known.every((label) => label?.setHash === hash)) {
      carried++;
      return;
    }
    let result: { answer: Recorded; key: string };
    try {
      result = await answerOf(input, set, window, digest, tally);
    } catch (cause) {
      if (cause instanceof CassetteMiss || cause instanceof LabelerConfigError) throw cause;
      if (isTooLarge(cause) && window.units.length > 1) {
        const half = Math.ceil(window.units.length / 2);
        const renumber = (units: Window['units']) => units.map((unit, at) => ({ ...unit, n: at + 1 }));
        await labelWindow(
          set,
          { ...window, id: `${window.id}a`, units: renumber(window.units.slice(0, half)) },
          digest,
        );
        await labelWindow(
          set,
          { ...window, id: `${window.id}b`, units: renumber(window.units.slice(half)) },
          digest,
        );
        return;
      }
      failed.push(`${window.id} (${set.set}): ${cause instanceof Error ? cause.message : String(cause)}`);
      unlabeled += window.units.length;
      return;
    }
    if (result.answer.refused === 'too_large') {
      if (window.units.length > 1) {
        const half = Math.ceil(window.units.length / 2);
        const renumber = (units: Window['units']) => units.map((unit, at) => ({ ...unit, n: at + 1 }));
        await labelWindow(
          set,
          { ...window, id: `${window.id}a`, units: renumber(window.units.slice(0, half)) },
          digest,
        );
        await labelWindow(
          set,
          { ...window, id: `${window.id}b`, units: renumber(window.units.slice(half)) },
          digest,
        );
      } else {
        failed.push(`${window.id} (${set.set}): the endpoint refused a window of one unit as too large`);
        unlabeled++;
      }
      return;
    }
    windows++;
    const checked = checkAnswer(set, window, input.labeler.interpret(result.answer, set, window));
    refusals.push(...checked.refusals);
    const source = `cassette:${result.key.slice(0, 12)}`;
    for (const [at, unit] of window.units.entries()) {
      const entry = entries.get(ids[at] as string);
      if (!entry) continue;
      if (!checked.covered.has(unit.n)) {
        unlabeled++;
        delete entry.labels[set.set];
        continue;
      }
      const accepted = checked.accepted.get(unit.n);
      const targetUnit = accepted?.target === undefined ? undefined : window.units[accepted.target - 1];
      const targetId = targetUnit
        ? (next.ids.get(unitKey(window.path, targetUnit.index)) as string)
        : undefined;
      entry.labels[set.set] = {
        label: accepted?.label ?? 'none',
        setHash: hash,
        source,
        ...(targetId ? { target: targetId } : {}),
      };
    }
  }

  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const set of input.sets) {
      const cap = input.labeler.maxUnits(set, size);
      for (const window of windowsOf(file.path, fileCut.units, cap)) {
        await labelWindow(set, window, fileCut.digest);
      }
    }
  }

  const labelled: LabelledUnit[] = [];
  for (const file of files) {
    const fileCut = cuts.get(file.path) as Cut;
    for (const [index, unit] of fileCut.units.entries()) {
      const id = next.ids.get(unitKey(file.path, index)) as string;
      const entry = entries.get(id);
      if (!entry) continue;
      for (const set of input.sets) {
        const found = entry.labels[set.set];
        if (!found || found.label === 'none' || found.setHash !== setHash(set)) continue;
        const targetIndex = found.target
          ? fileCut.units.findIndex((_, at) => next.ids.get(unitKey(file.path, at)) === found.target)
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
        });
      }
    }
  }

  return {
    ledger: next.ledger,
    events: next.events,
    cuts,
    labelled,
    windows,
    carried,
    calls: tally.calls,
    unlabeled,
    refusals,
    failed,
    usage: tally.usage,
    recorded: tally.recorded,
  };
}

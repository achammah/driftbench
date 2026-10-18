import { createHash } from 'node:crypto';
import type { LabelAnswer, LabelEntry, Labeler, LabelRequest } from '../sut/port';
import { norm } from './norm';

/**
 * Planted labellers: no model, only rules the validator wrote. Each takes the window it is shown and answers with
 * names and numbers, as design section 3 says a labeller does. `recording` wraps one to keep what it was asked.
 */

/** The labels of the default set that atoms are built from, in the order a text hash picks them. */
export const TRUTH_LABELS = ['rule', 'prohibition', 'example', 'description'] as const;

/** The planted label of a unit text under the default set: a pure function of the text in the normal form. */
export function truthLabel(text: string, container = 'sentence'): string {
  void container;
  const digest = createHash('sha256').update(norm(text, container)).digest();
  return TRUTH_LABELS[(digest[0] as number) % TRUTH_LABELS.length] as string;
}

export type Recording<T extends Labeler = Labeler> = T & { calls: LabelRequest[] };

/** Keeps every request the labeller was given. */
export function recording(inner: Labeler): Recording {
  const calls: LabelRequest[] = [];
  const wrapped = (async (request: LabelRequest) => {
    calls.push(request);
    return inner(request);
  }) as Recording;
  wrapped.calls = calls;
  return wrapped;
}

/** Entries covering the selectable units, one per unit, or ranges of consecutive units with one label. */
export function entriesFor(
  request: LabelRequest,
  choose: (unit: LabelRequest['window']['units'][number]) => string | undefined,
  ranges = false,
): LabelEntry[] {
  const out: LabelEntry[] = [];
  let run: { from: number; to: number; label: string } | undefined;
  const flush = () => {
    if (run)
      out.push({ units: run.from === run.to ? String(run.from) : `${run.from}-${run.to}`, label: run.label });
    run = undefined;
  };
  for (const unit of request.window.units) {
    if (unit.mode !== 'label') {
      flush();
      continue;
    }
    const label = choose(unit);
    if (label === undefined) {
      flush();
      continue;
    }
    if (ranges && run && run.label === label && run.to === unit.n - 1) run.to = unit.n;
    else {
      flush();
      if (ranges) run = { from: unit.n, to: unit.n, label };
      else out.push({ units: String(unit.n), label });
    }
  }
  flush();
  return out;
}

/** Answers the hidden truth for every unit it may label. */
export function perfect(
  truth: (text: string, container: string) => string | undefined = truthLabel,
  options: { ranges?: boolean } = {},
): Labeler {
  return (request) => {
    const names = request.labels.map((l) => l.name);
    const own = TRUTH_LABELS.every((name) => names.includes(name));
    const plain = request.labels.filter((l) => l.target !== 'required').map((l) => l.name);
    return {
      labels: entriesFor(
        request,
        (u) => {
          const label = truth(u.text, u.container);
          if (label === undefined || own || label === 'none') return label;
          const digest = createHash('sha256').update(norm(u.text, u.container)).digest();
          return plain[(digest[0] as number) % plain.length];
        },
        options.ranges === true,
      ),
    };
  };
}

/** Answers the label `name` for every unit under a heading whose text is `heading` (anywhere in its path), else none. */
export function keyedOnHeading(heading: string, name = 'rule'): Labeler {
  return (request) => ({
    labels: entriesFor(request, (u) => (u.path.some((p) => p === heading) ? name : 'none')),
  });
}

/** Answers `long` for units longer than `limit` characters and `short` for the others. */
export function keyedOnLength(limit: number, long = 'description', short = 'rule'): Labeler {
  return (request) => ({ labels: entriesFor(request, (u) => (u.text.length > limit ? long : short)) });
}

/** Answers a seeded random label from the set, per unit. */
export function randomLabeler(seed: number): Labeler {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return (request) => {
    const names = [...request.labels.filter((l) => l.target !== 'required').map((l) => l.name), 'none'];
    return { labels: entriesFor(request, () => names[Math.floor(next() * names.length)]) };
  };
}

/** Answers the same label for everything it may label. */
export function constant(name: string): Labeler {
  return (request) => ({ labels: entriesFor(request, () => name) });
}

/** Answers per call from a list: a function or a fixed answer; the last one repeats. */
export function scripted(answers: Array<LabelAnswer | ((request: LabelRequest) => LabelAnswer)>): Recording {
  let at = 0;
  return recording((request) => {
    const answer = answers[Math.min(at, answers.length - 1)] as
      | LabelAnswer
      | ((r: LabelRequest) => LabelAnswer);
    at += 1;
    return typeof answer === 'function' ? answer(request) : answer;
  });
}

export const NONE: Labeler = constant('none');

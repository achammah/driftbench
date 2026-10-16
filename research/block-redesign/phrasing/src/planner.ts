// M1.2 prototype: covering-array planner with constraints, a t-way coverage meter, and the F \ P
// localiser on pass rates.

export const AXES: Record<string, string[]> = {
  register: ['formal', 'neutral', 'casual'],
  length: ['terse', 'one_sentence', 'multi_sentence'],
  noise: ['clean', 'typos', 'no_punctuation'],
  distractor: ['none', 'unrelated_aside', 'redundant_detail'],
  lexical: ['seed_words', 'synonyms', 'restructured'],
  slot_surface: ['canonical', 'variant_a', 'variant_b'],
};
export const AXIS_NAMES = Object.keys(AXES);

export type Row = Record<string, string>;

/** Constraints go to the planner, never applied after (NIST SP 800-142 Sec. 3.3). */
export function valid(row: Row): boolean {
  if (row.length === 'terse' && row.distractor !== undefined && row.distractor !== 'none') return false;
  return true;
}

/** mulberry32: a small seeded generator, so every plan is reproducible from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function allRows(): Row[] {
  let rows: Row[] = [{}];
  for (const axis of AXIS_NAMES) {
    rows = rows.flatMap((row) => (AXES[axis] as string[]).map((value) => ({ ...row, [axis]: value })));
  }
  return rows.filter(valid);
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first as T, ...c]), ...combinations(rest, k)];
}

/** The t-way tuples of a row, as keys such as `register=casual|noise=typos`. */
export function tuplesOf(row: Row, t: number): string[] {
  return combinations(AXIS_NAMES, t).map((axes) => axes.map((axis) => `${axis}=${row[axis]}`).join('|'));
}

/** Every t-way tuple some valid row holds: the configurations a strength-t array must cover. */
export function requiredTuples(t: number): Set<string> {
  const out = new Set<string>();
  for (const row of allRows()) for (const key of tuplesOf(row, t)) out.add(key);
  return out;
}

export function coverage(rows: Row[], t: number): { covered: number; required: number; share: number } {
  const required = requiredTuples(t);
  const seen = new Set<string>();
  for (const row of rows) for (const key of tuplesOf(row, t)) if (required.has(key)) seen.add(key);
  return { covered: seen.size, required: required.size, share: seen.size / required.size };
}

function greedy(t: number, seed: number): Row[] {
  const pool = allRows();
  const random = rng(seed);
  const left = requiredTuples(t);
  const keys = pool.map((row) => tuplesOf(row, t));
  const rows: Row[] = [];
  while (left.size > 0) {
    let best = -1;
    let bestGain = -1;
    let ties = 0;
    keys.forEach((rowKeys, index) => {
      const gain = rowKeys.filter((key) => left.has(key)).length;
      if (gain > bestGain) {
        bestGain = gain;
        best = index;
        ties = 1;
      } else if (gain === bestGain) {
        ties += 1;
        if (random() < 1 / ties) best = index;
      }
    });
    const row = pool[best] as Row;
    rows.push(row);
    for (const key of keys[best] as string[]) left.delete(key);
  }
  return rows;
}

/** A strength-t covering array: the smallest greedy array over `tries` seeds starting at `seed`. */
export function coveringArray(t: number, seed: number, tries = 5): Row[] {
  let best: Row[] | undefined;
  for (let n = 0; n < tries; n++) {
    const rows = greedy(t, seed + n);
    if (!best || rows.length < best.length) best = rows;
  }
  return best as Row[];
}

/** Extends an array to `n` rows, each new row adding the most uncovered (t+1)-way tuples. */
export function extend(rows: Row[], n: number, t: number, seed: number): Row[] {
  const out = [...rows];
  const random = rng(seed);
  const pool = allRows();
  const seen = new Set(out.flatMap((row) => tuplesOf(row, t + 1)));
  while (out.length < n) {
    let best = 0;
    let bestGain = -1;
    let ties = 0;
    pool.forEach((row, index) => {
      if (out.some((r) => AXIS_NAMES.every((a) => r[a] === row[a]))) return;
      const gain = tuplesOf(row, t + 1).filter((key) => !seen.has(key)).length;
      if (gain > bestGain) {
        bestGain = gain;
        best = index;
        ties = 1;
      } else if (gain === bestGain) {
        ties += 1;
        if (random() < 1 / ties) best = index;
      }
    });
    const row = pool[best] as Row;
    out.push(row);
    for (const key of tuplesOf(row, t + 1)) seen.add(key);
  }
  return out;
}

export type Observation = { row: Row; passes: number; runs: number };

export type Suspect = { tuple: string; t: number; failRate: number; runs: number; inPassing: boolean };

/**
 * The F \ P localiser on rates. A realisation is consistently passing when it passed every run. A tuple
 * is a candidate when no consistently passing realisation holds it. Candidates rank first, then by failure
 * rate over the runs that hold them, simpler tuples first on ties, then by support.
 */
export function localise(observations: Observation[], maxT = 2): Suspect[] {
  const passing = new Set<string>();
  for (const o of observations) {
    if (o.passes === o.runs) for (let t = 1; t <= maxT; t++) for (const k of tuplesOf(o.row, t)) passing.add(k);
  }
  const stats = new Map<string, { t: number; fails: number; runs: number }>();
  for (const o of observations) {
    for (let t = 1; t <= maxT; t++) {
      for (const key of tuplesOf(o.row, t)) {
        const s = stats.get(key) ?? { t, fails: 0, runs: 0 };
        s.fails += o.runs - o.passes;
        s.runs += o.runs;
        stats.set(key, s);
      }
    }
  }
  return [...stats.entries()]
    .map(([tuple, s]) => ({ tuple, t: s.t, failRate: s.fails / s.runs, runs: s.runs, inPassing: passing.has(tuple) }))
    .sort((a, b) => Number(a.inPassing) - Number(b.inPassing) || b.failRate - a.failRate || a.t - b.t || b.runs - a.runs);
}

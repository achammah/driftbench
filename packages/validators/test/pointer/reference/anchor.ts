import { similarity } from '../../../src/ladders/pointer/kit/words';
import type { LedgerEntry } from '../../../src/ladders/pointer/sut/port';
import { fingerprintText } from './cut';

/**
 * The re-anchoring ladder of docs/estate-pointer-reader.md section 4: order first (unchanged), then exact text
 * elsewhere (moved, or ambiguous when several), then pairwise scores with a text floor (changed, split, merged),
 * else deleted. Reference thresholds: score 0.45, text floor 0.4, length floor 40.
 */

export type NewUnit = {
  path: string;
  index: number;
  text: string;
  fp: string;
  start: number;
  end: number;
  container: string;
  sectionPath: string[];
  prefix: string;
  suffix: string;
  ctxFp: string;
  yamlPath?: string[];
};

export type Verdict = {
  /** The old entry assigned to each new unit (by global index), with the event. */
  assigned: Map<number, { entry: LedgerEntry; event: string }>;
  /** Old entries that did not survive, with the event that says why. */
  gone: Array<{ entry: LedgerEntry; event: 'deleted' | 'merged' | 'ambiguous' }>;
};

const FLOOR_LENGTH = 40;
const THRESHOLD = 0.45;
const TEXT_FLOOR = 0.4;
const SPLIT_MERGE_MIN = 0.6;

/** Matching pairs of two sequences by identity: a patience diff with a dynamic programme on small gaps. */
export function matchSequences(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) {
    pairs.push([lo, lo]);
    lo += 1;
  }
  let ha = a.length;
  let hb = b.length;
  const tail: Array<[number, number]> = [];
  while (ha > lo && hb > lo && a[ha - 1] === b[hb - 1]) {
    ha -= 1;
    hb -= 1;
    tail.push([ha, hb]);
  }
  pairs.push(...middle(a, b, lo, ha, lo, hb));
  tail.reverse();
  pairs.push(...tail);
  return pairs;
}

function middle(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): Array<[number, number]> {
  if (a0 >= a1 || b0 >= b1) return [];
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (let i = a0; i < a1; i += 1) countA.set(a[i] as string, (countA.get(a[i] as string) ?? 0) + 1);
  for (let j = b0; j < b1; j += 1) countB.set(b[j] as string, (countB.get(b[j] as string) ?? 0) + 1);
  const posB = new Map<string, number>();
  for (let j = b0; j < b1; j += 1) if (countB.get(b[j] as string) === 1) posB.set(b[j] as string, j);
  const unique: Array<[number, number]> = [];
  for (let i = a0; i < a1; i += 1) {
    const key = a[i] as string;
    if (countA.get(key) === 1 && posB.has(key)) unique.push([i, posB.get(key) as number]);
  }
  if (unique.length === 0) {
    if ((a1 - a0) * (b1 - b0) <= 4_000_000) return dp(a, b, a0, a1, b0, b1);
    return greedy(a, b, a0, a1, b0, b1);
  }
  // longest increasing subsequence on the b positions
  const tails: number[] = [];
  const prev: number[] = new Array(unique.length).fill(-1);
  const tailIndex: number[] = [];
  for (let k = 0; k < unique.length; k += 1) {
    const value = (unique[k] as [number, number])[1];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((tails[mid] as number) < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
    tailIndex[low] = k;
    prev[k] = low > 0 ? (tailIndex[low - 1] as number) : -1;
  }
  const chain: number[] = [];
  for (let k = tailIndex[tails.length - 1] as number; k >= 0; k = prev[k] as number) chain.push(k);
  chain.reverse();
  const out: Array<[number, number]> = [];
  let pa = a0;
  let pb = b0;
  for (const k of chain) {
    const [i, j] = unique[k] as [number, number];
    out.push(
      ...matchSequences(a.slice(pa, i), b.slice(pb, j)).map(([x, y]) => [x + pa, y + pb] as [number, number]),
    );
    out.push([i, j]);
    pa = i + 1;
    pb = j + 1;
  }
  out.push(
    ...matchSequences(a.slice(pa, a1), b.slice(pb, b1)).map(([x, y]) => [x + pa, y + pb] as [number, number]),
  );
  return out;
}

function dp(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): Array<[number, number]> {
  const n = a1 - a0;
  const m = b1 - b0;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[a0 + i] === b[b0 + j]
          ? (table[i + 1]?.[j + 1] as number) + 1
          : Math.max(table[i + 1]?.[j] as number, table[i]?.[j + 1] as number);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) {
      out.push([a0 + i, b0 + j]);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] as number) >= (table[i]?.[j + 1] as number)) i += 1;
    else j += 1;
  }
  return out;
}

function greedy(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let j = b0;
  for (let i = a0; i < a1; i += 1) {
    for (let k = j; k < Math.min(b1, j + 50); k += 1) {
      if (a[i] === b[k]) {
        out.push([i, k]);
        j = k + 1;
        break;
      }
    }
  }
  return out;
}

const norm = (text: string) => fingerprintText(text);

function contextScore(entry: LedgerEntry, unit: NewUnit): number {
  const section = JSON.stringify(entry.sectionPath) === JSON.stringify(unit.sectionPath) ? 1 : 0;
  return (similarity(entry.prefix, unit.prefix) + similarity(entry.suffix, unit.suffix) + section) / 3;
}

export function anchorUnits(old: readonly LedgerEntry[], news: readonly NewUnit[]): Verdict {
  const assigned = new Map<number, { entry: LedgerEntry; event: string }>();
  const gone: Verdict['gone'] = [];
  const takenOld = new Set<string>();
  const oldByPath = new Map<string, LedgerEntry[]>();
  for (const entry of old) {
    const list = oldByPath.get(entry.path) ?? [];
    list.push(entry);
    oldByPath.set(entry.path, list);
  }
  for (const list of oldByPath.values()) list.sort((x, y) => (x.hint?.start ?? 0) - (y.hint?.start ?? 0));
  const newByPath = new Map<string, number[]>();
  news.forEach((unit, g) => {
    const list = newByPath.get(unit.path) ?? [];
    list.push(g);
    newByPath.set(unit.path, list);
  });

  // 1. order: unchanged
  for (const [path, entries] of oldByPath) {
    const indices = newByPath.get(path);
    if (!indices) continue;
    const pairs = matchSequences(
      entries.map((e) => e.fp),
      indices.map((g) => (news[g] as NewUnit).fp),
    );
    for (const [i, j] of pairs) {
      const entry = entries[i] as LedgerEntry;
      assigned.set(indices[j] as number, { entry, event: 'unchanged' });
      takenOld.add(entry.id);
    }
  }
  const residueOld = old.filter((e) => !takenOld.has(e.id));
  const residueNew = news.map((_, g) => g).filter((g) => !assigned.has(g));

  // 2. exact text elsewhere: moved or ambiguous
  const byFp = new Map<string, number[]>();
  for (const g of residueNew) {
    const unit = news[g] as NewUnit;
    if (unit.text.length < FLOOR_LENGTH) continue;
    const list = byFp.get(unit.fp) ?? [];
    list.push(g);
    byFp.set(unit.fp, list);
  }
  const oldCountByFp = new Map<string, number>();
  for (const e of residueOld) oldCountByFp.set(e.fp, (oldCountByFp.get(e.fp) ?? 0) + 1);
  for (const entry of residueOld) {
    if (entry.quote.length < FLOOR_LENGTH) continue;
    const candidates = (byFp.get(entry.fp) ?? []).filter((g) => !assigned.has(g));
    if (candidates.length === 0) continue;
    const oldCount = oldCountByFp.get(entry.fp) ?? 1;
    if (oldCount === 1 && candidates.length >= 2) {
      gone.push({ entry, event: 'ambiguous' });
      takenOld.add(entry.id);
      continue;
    }
    const target = candidates[0] as number;
    assigned.set(target, { entry, event: 'moved' });
    takenOld.add(entry.id);
  }

  // 3. pairwise scores on what is left
  const leftOld = residueOld.filter((e) => !takenOld.has(e.id));
  const leftNew = residueNew.filter((g) => !assigned.has(g));
  const consumedNew = new Set<number>();
  if (leftOld.length > 0 && leftNew.length > 0) {
    const newsByPath = new Map<string, number[]>();
    for (const g of leftNew) {
      const list = newsByPath.get((news[g] as NewUnit).path) ?? [];
      list.push(g);
      newsByPath.set((news[g] as NewUnit).path, list);
    }
    const candidatesFor = (entry: LedgerEntry): number[] =>
      leftNew.length <= 400 ? leftNew : (newsByPath.get(entry.path) ?? []);
    const scored: Array<{ entry: LedgerEntry; g: number; text: number; score: number }> = [];
    for (const entry of leftOld) {
      const oldText = norm(entry.quote);
      for (const g of candidatesFor(entry)) {
        const unit = news[g] as NewUnit;
        const text = similarity(oldText, norm(unit.text));
        if (text <= TEXT_FLOOR) continue;
        const score = 0.6 * text + 0.4 * contextScore(entry, unit);
        if (score > THRESHOLD) scored.push({ entry, g, text, score });
      }
    }
    scored.sort((x, y) => y.score - x.score || x.g - y.g);
    const doneOld = new Set<string>();
    for (const cand of scored) {
      if (doneOld.has(cand.entry.id) || consumedNew.has(cand.g)) continue;
      const unit = news[cand.g] as NewUnit;
      const oldText = norm(cand.entry.quote);
      // split: the neighbouring new unit joined to this one scores higher than this one alone
      let event = 'changed';
      let extraNew: number | undefined;
      for (const dg of [1, -1]) {
        const other = news[cand.g + dg];
        if (!other || other.path !== unit.path || assigned.has(cand.g + dg) || consumedNew.has(cand.g + dg))
          continue;
        if (!leftNew.includes(cand.g + dg)) continue;
        const joined =
          dg === 1 ? `${norm(unit.text)} ${norm(other.text)}` : `${norm(other.text)} ${norm(unit.text)}`;
        const s2 = similarity(oldText, joined);
        if (s2 > cand.text && s2 >= SPLIT_MERGE_MIN) {
          event = 'split';
          extraNew = cand.g + dg;
          break;
        }
      }
      if (event === 'split' && extraNew !== undefined) {
        const other = news[extraNew] as NewUnit;
        const mine = cand.text;
        const theirs = similarity(oldText, norm(other.text));
        const keep = theirs > mine ? extraNew : cand.g;
        assigned.set(keep, { entry: cand.entry, event: 'split' });
        consumedNew.add(cand.g);
        consumedNew.add(extraNew);
        doneOld.add(cand.entry.id);
        takenOld.add(cand.entry.id);
        continue;
      }
      // merge: the next old unit joined to this one scores higher against the new unit
      const oldList = oldByPath.get(cand.entry.path) ?? [];
      const at = oldList.findIndex((e) => e.id === cand.entry.id);
      let merged: LedgerEntry | undefined;
      for (const dn of [1, -1]) {
        const neighbour = oldList[at + dn];
        if (!neighbour || takenOld.has(neighbour.id) || doneOld.has(neighbour.id)) continue;
        if (!leftOld.some((e) => e.id === neighbour.id)) continue;
        const joined =
          dn === 1 ? `${oldText} ${norm(neighbour.quote)}` : `${norm(neighbour.quote)} ${oldText}`;
        const s2 = similarity(joined, norm(unit.text));
        if (s2 > cand.text && s2 >= SPLIT_MERGE_MIN) {
          merged = neighbour;
          break;
        }
      }
      if (merged) {
        const mineSim = cand.text;
        const theirSim = similarity(norm(merged.quote), norm(unit.text));
        const keep = theirSim > mineSim ? merged : cand.entry;
        const drop = keep === merged ? cand.entry : merged;
        assigned.set(cand.g, { entry: keep, event: 'merged' });
        gone.push({ entry: drop, event: 'merged' });
        consumedNew.add(cand.g);
        doneOld.add(keep.id);
        doneOld.add(drop.id);
        takenOld.add(keep.id);
        takenOld.add(drop.id);
        continue;
      }
      assigned.set(cand.g, { entry: cand.entry, event: 'changed' });
      consumedNew.add(cand.g);
      doneOld.add(cand.entry.id);
      takenOld.add(cand.entry.id);
    }
  }
  // 4. nothing cleared the bar: deleted
  for (const entry of old) {
    if (!takenOld.has(entry.id)) gone.push({ entry, event: 'deleted' });
  }
  return { assigned, gone };
}

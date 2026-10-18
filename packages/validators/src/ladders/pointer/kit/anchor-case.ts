import { type ItemContext, type Outcome, Problem, pass } from '../bank/types';
import type { Labeler, LedgerEntry } from '../sut/port';
import { build, byId, type EstateFile, eventNow, liveByText, liveOf, scanOk } from './estate';
import { perfect } from './labellers';
import { norm } from './norm';
import { show } from './oracle';

/** What must become of an old unit, by its text in the old estate. */
export type Fate =
  | { kind: 'unchanged' }
  | { kind: 'moved'; events?: string[]; path?: string }
  | { kind: 'changed'; to: string }
  | { kind: 'deleted' }
  | { kind: 'split'; parts: string[] }
  | { kind: 'ambiguous' }
  /** The ids of these two old units: exactly one lives on with the joined text, event `merged`; the other is gone. */
  | { kind: 'mergePair'; other: string; into: string }
  /** Carries the id through, to a text whose similarity the caller already knows is high. */
  | { kind: 'carried'; to: string };

export type Scenario = {
  before: EstateFile[];
  after: EstateFile[];
  /** Fates by old unit text; every other old unit must come out unchanged. */
  fates?: Array<{ text: string; fate: Fate }>;
  /** After texts that must have fresh ids, besides the parts of splits. Default: derived from the fates. */
  fresh?: string[];
  labeler?: Labeler;
  /** Texts left out of the default checks, old and new (the item checks them itself). */
  skip?: string[];
  /** A last check on the two scans. */
  extra?: (run: ScenarioRun) => string | undefined;
};

export type ScenarioRun = {
  ids: Map<string, string>;
  before: Awaited<ReturnType<typeof scanOk>>;
  after: Awaited<ReturnType<typeof scanOk>>;
};

const key = (text: string, container?: string) => norm(text, container);

/** Scans the old estate, edits it, rescans with the ledger and checks every old unit's fate. Throws a Problem on a miss. */
export async function runScenario(ctx: ItemContext, s: Scenario): Promise<ScenarioRun> {
  const old = build(s.before);
  const next = build(s.after);
  const labeler = s.labeler ?? perfect();
  const first = await scanOk(ctx.sut, { files: old.files, labeler });
  const second = await scanOk(ctx.sut, { files: next.files, previousLedger: first.ledger.raw, labeler });
  const ids = new Map<string, string>();
  const oldTexts: Array<{ text: string; container: string }> = [];
  for (const doc of old.docs.values())
    for (const u of doc.units) oldTexts.push({ text: u.text, container: u.container });
  for (const { text, container } of oldTexts) {
    const entry = liveByText(first.ledger, text, container);
    if (!entry) {
      if (container === 'fence' || container === 'comment') continue;
      throw new Problem(`the first scan has no live entry for ${show(text)}`);
    }
    ids.set(key(text, container), entry.id);
  }
  const oldIds = new Set(first.ledger.entries.map((e) => e.id));
  const newTexts: Array<{ text: string; container: string }> = [];
  for (const doc of next.docs.values())
    for (const u of doc.units) newTexts.push({ text: u.text, container: u.container });
  const live = liveOf(second.ledger);
  const expectedNew = newTexts.filter((t) => t.container !== 'fence' && t.container !== 'comment');
  if (live.length !== expectedNew.length) {
    throw new Problem(`the rescan has ${live.length} live entries for ${expectedNew.length} units`);
  }
  if (new Set(live.map((e) => e.id)).size !== live.length)
    throw new Problem('the rescan gives two live entries one id');

  const claimed = new Set<string>();
  const explicit = new Map((s.fates ?? []).map((f) => [key(f.text), f.fate]));
  const parts = new Set<string>();
  const pairHandled = new Set<string>();
  const fail = (text: string, why: string): never => {
    throw new Problem(`${show(text)}: ${why}`);
  };
  for (const { text, container } of oldTexts) {
    if (container === 'fence' || container === 'comment') continue;
    const k = key(text, container);
    if (s.skip?.some((t) => key(t) === k)) continue;
    const id = ids.get(k) as string;
    const entry = byId(second.ledger, id);
    const fate: Fate = explicit.get(k) ?? { kind: 'unchanged' };
    if (!entry) return fail(text, `the id ${id} is gone from the ledger`);
    const event = eventNow(second, entry);
    switch (fate.kind) {
      case 'unchanged':
        if (entry.status !== 'live') fail(text, `expected unchanged, the entry is ${entry.status}`);
        if (key(entry.quote, entry.container) !== k)
          fail(text, `expected the same text, the entry quotes ${show(entry.quote)}`);
        if (event !== 'unchanged') fail(text, `expected event unchanged, got ${event}`);
        claimed.add(k);
        break;
      case 'moved': {
        const allowed = fate.events ?? ['moved'];
        if (entry.status !== 'live') fail(text, `expected moved, the entry is ${entry.status}`);
        if (key(entry.quote, entry.container) !== k)
          fail(text, `expected the same text, the entry quotes ${show(entry.quote)}`);
        if (!allowed.includes(event)) fail(text, `expected event ${allowed.join(' or ')}, got ${event}`);
        if (fate.path !== undefined && entry.path !== fate.path)
          fail(text, `expected path ${fate.path}, got ${entry.path}`);
        claimed.add(k);
        break;
      }
      case 'changed':
      case 'carried':
        if (entry.status !== 'live') fail(text, `expected the id to live on, the entry is ${entry.status}`);
        if (key(entry.quote, entry.container) !== key(fate.to, entry.container)) {
          fail(text, `expected the new text ${show(fate.to)}, the entry quotes ${show(entry.quote)}`);
        }
        if (fate.kind === 'changed' && event !== 'changed')
          fail(text, `expected event changed, got ${event}`);
        claimed.add(key(fate.to, entry.container));
        break;
      case 'deleted':
        if (entry.status === 'live')
          fail(text, `expected deleted, the entry is live with ${show(entry.quote)}`);
        if (event !== 'deleted') fail(text, `expected event deleted, got ${event}`);
        if (key(entry.quote, entry.container) !== k)
          fail(text, `the deleted entry no longer quotes the old text: ${show(entry.quote)}`);
        break;
      case 'ambiguous':
        if (event !== 'ambiguous') fail(text, `expected event ambiguous, got ${event}`);
        break;
      case 'split': {
        if (entry.status !== 'live')
          fail(text, `expected the id to live on in one part, the entry is ${entry.status}`);
        if (event !== 'split') fail(text, `expected event split, got ${event}`);
        const keptOne = fate.parts.some((p) => key(p, entry.container) === key(entry.quote, entry.container));
        if (!keptOne) fail(text, `expected one of the parts, the entry quotes ${show(entry.quote)}`);
        for (const p of fate.parts) parts.add(key(p));
        const others = fate.parts.filter(
          (p) => key(p, entry.container) !== key(entry.quote, entry.container),
        );
        for (const p of others) {
          const e = liveByText(second.ledger, p);
          if (!e) fail(text, `the other part ${show(p)} has no live entry`);
          else if (oldIds.has(e.id)) fail(text, `the other part ${show(p)} carries the old id ${e.id}`);
        }
        break;
      }
      case 'mergePair': {
        if (pairHandled.has(k)) break;
        const otherKey = key(fate.other);
        pairHandled.add(k);
        pairHandled.add(otherKey);
        const otherEntry = byId(second.ledger, ids.get(otherKey) as string);
        if (!otherEntry) return fail(text, 'the other id is gone from the ledger');
        const survivors = [entry, otherEntry].filter(
          (e) => e.status === 'live' && key(e.quote, e.container) === key(fate.into, e.container),
        );
        if (survivors.length !== 1)
          fail(
            text,
            `expected exactly one of the two ids to live on as ${show(fate.into)}, found ${survivors.length}`,
          );
        const survivor = survivors[0] as LedgerEntry;
        if (eventNow(second, survivor) !== 'merged')
          fail(text, `expected event merged, got ${eventNow(second, survivor)}`);
        const loser = survivor === entry ? otherEntry : entry;
        if (loser.status === 'live') fail(text, `the other id is still live with ${show(loser.quote)}`);
        claimed.add(key(fate.into));
        break;
      }
    }
  }
  // every live entry that carries no old id is fresh, and must be one the scenario expects
  const freshLive = live.filter((e) => !oldIds.has(e.id));
  const loose = new Set((s.skip ?? []).map((t) => key(t)));
  const expectFresh = new Set(
    (
      s.fresh ??
      expectedNew.map((t) => key(t.text, t.container)).filter((t) => !claimed.has(t) && !parts.has(t))
    ).map((t) => key(t)),
  );
  const gotFresh = new Set(
    freshLive.map((e) => key(e.quote, e.container)).filter((t) => !parts.has(t) && !loose.has(t)),
  );
  for (const t of [...expectFresh].filter((x) => !loose.has(x))) {
    if (!gotFresh.has(t)) {
      const e = live.find((x) => key(x.quote, x.container) === key(t));
      throw new Problem(
        `${show(t)} should have a fresh id; ${e ? `it carries the old id ${e.id}` : 'it has no live entry'}`,
      );
    }
  }
  for (const t of gotFresh) {
    if (!expectFresh.has(t)) {
      throw new Problem(
        `${show(t)} got a fresh id but an old id should have carried it (a wrong anchor or a lost one)`,
      );
    }
  }
  const run: ScenarioRun = { ids, before: first, after: second };
  const more = s.extra?.(run);
  if (more) throw new Problem(more);
  return run;
}

export async function anchorCase(ctx: ItemContext, s: Scenario, detail?: string): Promise<Outcome> {
  const run = await runScenario(ctx, s);
  return pass(detail ?? `${run.ids.size} old units checked, ${liveOf(run.after.ledger).length} live after`);
}

import type { Provenance, StoreDoc } from '../interface';

/**
 * Checks of the fields shared by StoreDoc and docs/variables.md. This is not a full file-schema validator:
 * StoreDoc omits file metadata and permits an empty reader result. Missing provenance is warning-only in
 * the file format; the stronger source-reader obligation is checked separately by build().
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HASH = /^[0-9a-f]{64}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LEDGER = /^[a-z2-7]{10}$/;

const blank = (text: unknown): boolean => typeof text !== 'string' || text.trim() === '';

function realDay(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function provenanceProblem(p: Provenance): string | undefined {
  const q = p as Record<string, unknown>;
  switch (p?.kind) {
    case 'quote': {
      const path = q.path;
      if (blank(path)) return 'a quote has no path';
      const pathText = path as string;
      if (/^[/~]/.test(pathText) || /^[A-Za-z]+:/.test(pathText) || pathText.includes('\\')) {
        return `the quote path ${JSON.stringify(pathText)} is not a relative path with forward slashes`;
      }
      if (blank(q.quote) || (q.quote as string).length > 1000)
        return 'a quote is blank or over 1000 characters';
      if (q.ledger !== undefined && !LEDGER.test(String(q.ledger)))
        return 'a ledger id is not 10 characters from a-z and 2-7';
      return undefined;
    }
    case 'conversations': {
      const { count, total, set_hash: hash } = q as { count: unknown; total: unknown; set_hash: unknown };
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0)
        return 'a conversations count is not a whole number from 0';
      if (typeof total !== 'number' || !Number.isInteger(total) || total < 1)
        return 'a conversations total is not a whole number from 1';
      if (count > total) return `the conversations count ${count} is above the total ${total}`;
      if (typeof hash !== 'string' || !HASH.test(hash))
        return 'a conversations set_hash is not 64 lowercase hexadecimal characters';
      const extra = Object.keys(q).filter((k) => !['kind', 'count', 'total', 'set_hash'].includes(k));
      if (extra.length > 0)
        return `a conversations entry carries the key ${extra[0]}: counts and a hash only`;
      return undefined;
    }
    case 'owner': {
      if (blank(q.words) || (q.words as string).length > 1000)
        return 'the owner words are blank or over 1000 characters';
      if (typeof q.date !== 'string' || !realDay(q.date))
        return `the owner date ${JSON.stringify(q.date)} is not a real day written YYYY-MM-DD`;
      return undefined;
    }
    default:
      return `a provenance entry has the kind ${JSON.stringify((p as { kind?: unknown })?.kind)}`;
  }
}

/** The ways a built store breaks the format. At most a handful are listed. */
export function formatProblems(store: StoreDoc): string[] {
  const out: string[] = [];
  const add = (text: string) => {
    if (out.length < 5) out.push(text);
  };
  const seenVars = new Set<string>();
  for (const v of store.variables) {
    if (typeof v.id !== 'string' || !ID.test(v.id))
      add(`the variable id ${JSON.stringify(v.id)} does not match ${ID}`);
    if (seenVars.has(v.id)) add(`the variable id ${v.id} is written twice`);
    seenVars.add(v.id);
    if (!Array.isArray(v.values) || v.values.length === 0) {
      add(`the variable ${v.id} has no value`);
      continue;
    }
    const seenVals = new Set<string>();
    for (const x of v.values) {
      if (typeof x.id !== 'string' || !ID.test(x.id))
        add(`the value id ${JSON.stringify(x.id)} of ${v.id} does not match ${ID}`);
      if (seenVals.has(x.id)) add(`the value id ${x.id} of ${v.id} is written twice`);
      seenVals.add(x.id);
      for (const p of x.provenance ?? []) {
        const bad = provenanceProblem(p);
        if (bad) add(`the value ${x.id} of ${v.id}: ${bad}`);
      }
      if (
        x.weight !== undefined &&
        (typeof x.weight !== 'number' || !Number.isFinite(x.weight) || x.weight < 0)
      ) {
        add(`the value ${x.id} of ${v.id} has the weight ${String(x.weight)}, not a finite number from 0`);
      }
    }
    const weighed = v.values.filter((x) => x.weight !== undefined).length;
    if (weighed > 0 && weighed < v.values.length)
      add(
        `the variable ${v.id} weighs ${weighed} of its ${v.values.length} values: give a weight to every value or to none`,
      );
    if (weighed === v.values.length && v.values.every((x) => x.weight === 0))
      add(`every weight of ${v.id} is 0`);
    for (const b of v.boundaries ?? []) {
      for (const k of ['holds', 'fails', 'edge'] as const) {
        if (!seenVals.has(b[k]))
          add(
            `the boundary of ${v.id} names ${k} ${JSON.stringify(b[k])}, which is not a value of the variable`,
          );
      }
      if (b.holds === b.fails) add(`the boundary of ${v.id} has one value on both sides`);
      if ((b.limit === undefined) !== (b.comparison === undefined))
        add(`the boundary of ${v.id} has a limit and a comparison only one of which is set`);
      if (b.unit !== undefined && b.limit === undefined)
        add(`the boundary of ${v.id} has a unit and no limit`);
      if (b.comparison === 'gt' || b.comparison === 'lt') {
        if (b.edge === b.holds)
          add(
            `the boundary of ${v.id} is strict (${b.comparison}) so the edge cannot be the value where the condition holds`,
          );
      } else if (b.comparison === 'ge' || b.comparison === 'le') {
        if (b.edge === b.fails)
          add(
            `the boundary of ${v.id} is inclusive (${b.comparison}) so the edge cannot be the value where the condition fails`,
          );
      }
    }
  }
  const vals = new Map(store.variables.map((v) => [v.id, new Set(v.values.map((x) => x.id))]));
  for (const p of store.impossible) {
    for (const end of [p.a, p.b]) {
      if (!vals.get(end.variable)?.has(end.value))
        add(`an impossible pair names ${end.variable}=${end.value}, which the store lacks`);
    }
    for (const q of p.provenance ?? []) {
      const bad = provenanceProblem(q);
      if (bad) add(`an impossible pair: ${bad}`);
    }
  }
  const sig = new Set<string>();
  for (const p of store.impossible) {
    const ends = [`${p.a.variable}=${p.a.value}`, `${p.b.variable}=${p.b.value}`].sort().join('|');
    if (sig.has(ends)) add(`the impossible pair ${ends} is written twice`);
    sig.add(ends);
  }
  return out;
}

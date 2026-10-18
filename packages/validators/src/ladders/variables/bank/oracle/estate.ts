import type {
  ConversationInput,
  EstateInput,
  OwnerInput,
  Provenance,
  Refusal,
  Row,
  StoreDoc,
  StoreValue,
  StoreVariable,
} from '../../interface';
import type { Rng } from '../util';
import { overlaps } from './conditions';

/**
 * Helpers that build estate inputs from a hidden specification and read a store back by what its values cite.
 * The component picks the ids; the bank finds variables and values by their provenance, never by a guessed id.
 */

export type ToolValue = { id: string; quote: string };
export type ToolSpec = { tool: string; field: string; source: string; values: ToolValue[] };
export type RuleSpec = { id: string; source: string; conditions: string[]; tools: ToolSpec[] };

const TOOLS = ['ledger.post', 'mail.send', 'crm.update', 'calendar.book', 'files.move', 'ticket.assign'];
const FIELDS = ['account', 'priority', 'folder', 'calendar', 'team', 'template', 'status', 'label'];
const VALUE_IDS = [
  'payable',
  'receivable',
  'refund',
  'credit',
  'urgent',
  'normal',
  'low',
  'sales',
  'support',
  'billing',
  'archive',
  'inbox',
  'draft',
  'sent',
  'review',
  'closed',
  'open',
  'paused',
  'vip',
  'standard',
  'bulk',
  'trial',
];
const MEANINGS = [
  'a supplier invoice',
  'a customer invoice',
  'a returned payment',
  'a store credit',
  'a same day request',
  'the usual queue',
  'work that can wait',
  'a sales lead',
  'a help request',
  'a billing question',
  'old mail',
  'new mail',
  'a message not sent yet',
  'a message already sent',
  'work for a second reader',
  'a finished case',
  'a case in progress',
  'a case on hold',
  'a priority customer',
  'a regular customer',
  'a mass mailing',
  'a free trial',
];

/** A tool evidence field with `count` values whose quotes are lines of a tools reference file. */
export function toolSpec(
  rng: Rng,
  count: number,
  source = 'TOOLS.md',
  taken: { tools: Set<string>; ids: Set<string> } = { tools: new Set(), ids: new Set() },
): { spec: ToolSpec; lines: string[] } {
  let tool = rng.pick(TOOLS);
  let field = rng.pick(FIELDS);
  for (let guard = 0; taken.tools.has(`${tool}.${field}`) && guard < 100; guard += 1) {
    tool = rng.pick(TOOLS);
    field = rng.pick(FIELDS);
  }
  taken.tools.add(`${tool}.${field}`);
  const picks = rng.sample(
    VALUE_IDS.map((id, i) => ({ id, meaning: MEANINGS[i] as string })).filter(
      (p) => !taken.ids.has(`${tool}.${field}.${p.id}`),
    ),
    count,
  );
  const values: ToolValue[] = picks.map((p) => ({
    id: p.id,
    quote: `${tool} ${field} value ${p.id} means ${p.meaning}`,
  }));
  const lines = values.map((v) => `- ${v.quote}.`);
  return { spec: { tool, field, source, values }, lines };
}

/** The estate input of rules whose files are given. */
export function estateOf(files: Record<string, string>, rules: RuleSpec[]): EstateInput {
  return {
    files,
    rules: rules.map((r) => ({
      id: r.id,
      source: r.source,
      conditions: r.conditions.map((text) => ({ text })),
      tools: r.tools.map((t) => ({
        tool: t.tool,
        field: t.field,
        source: t.source,
        values: t.values.map((v) => ({ ...v })),
      })),
    })),
  };
}

/** A tools reference file with its header and the lines of the given tool specs. */
export function toolsFile(rng: Rng, lines: string[], filler = 4): string {
  const body = [...lines];
  for (let i = 0; i < filler; i += 1)
    body.splice(rng.int(0, body.length), 0, `Note ${i + 1}: values are plain labels.`);
  return `# Tools\n\n${body.join('\n')}\n`;
}

export type Cited = { variable: StoreVariable; value: StoreValue };

/** Every (variable, value) with a quote provenance that overlaps the text (the text holds the quote or the reverse). */
export function citing(store: StoreDoc, text: string, source?: string): Cited[] {
  const out: Cited[] = [];
  for (const variable of store.variables) {
    for (const value of variable.values) {
      const hit = (value.provenance ?? []).some(
        (p) =>
          p.kind === 'quote' &&
          (source === undefined || p.path === source) &&
          p.quote !== '' &&
          overlaps(p.quote, text),
      );
      if (hit) out.push({ variable, value });
    }
  }
  return out;
}

/** The distinct variables citing the text. */
export function variablesCiting(store: StoreDoc, text: string, source?: string): StoreVariable[] {
  return [...new Set(citing(store, text, source).map((c) => c.variable))];
}

/** The value whose quote provenance equals the quote exactly, and its variable. */
export function valueByQuote(store: StoreDoc, quote: string): Cited | undefined {
  for (const variable of store.variables) {
    for (const value of variable.values) {
      if ((value.provenance ?? []).some((p) => p.kind === 'quote' && p.quote === quote))
        return { variable, value };
    }
  }
  return undefined;
}

/** The variable that holds the values of a tool spec (found by their quotes) and the stored id of each value. */
export function locateTool(
  store: StoreDoc,
  spec: ToolSpec,
): { variable: StoreVariable; ids: Map<string, string> } | undefined {
  const ids = new Map<string, string>();
  let variable: StoreVariable | undefined;
  for (const v of spec.values) {
    const hit = valueByQuote(store, v.quote);
    if (!hit) return undefined;
    if (variable && variable !== hit.variable) return undefined;
    variable = hit.variable;
    ids.set(v.id, hit.value.id);
  }
  return variable ? { variable, ids } : undefined;
}

export const provOfKind = <K extends Provenance['kind']>(
  value: StoreValue,
  kind: K,
): Array<Extract<Provenance, { kind: K }>> =>
  (value.provenance ?? []).filter((p): p is Extract<Provenance, { kind: K }> => p.kind === kind);

export const valueById = (variable: StoreVariable, id: string): StoreValue | undefined =>
  variable.values.find((v) => v.id === id);

export const variableOf = (store: StoreDoc, id: string): StoreVariable | undefined =>
  store.variables.find((v) => v.id === id);

/** A store with its variables, values, provenance and lists in a canonical order, for comparing two builds. */
export function canonicalStore(store: StoreDoc): unknown {
  const key = (x: unknown) => JSON.stringify(x);
  const sortBy = <T>(items: T[], f: (t: T) => string) =>
    [...items].sort((a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0));
  return {
    variables: sortBy(store.variables, (v) => v.id).map((v) => ({
      ...v,
      values: sortBy(v.values, (x) => x.id).map((x) => ({
        ...x,
        provenance: sortBy(x.provenance ?? [], key),
      })),
    })),
    impossible: sortBy(
      store.impossible.map((p) => {
        const ends = sortBy([p.a, p.b], key);
        return { a: ends[0], b: ends[1], provenance: sortBy(p.provenance ?? [], key) };
      }),
      key,
    ),
    rules: sortBy(store.rules, (r) => r.id).map((r) => ({ ...r, variables: [...r.variables].sort() })),
    refused: sortBy(store.refused, key),
  };
}

/** Sessions from draws: one entry per session, the value of one variable. */
export function sessionsOf(
  variable: string,
  valueIds: readonly string[],
  draws: readonly number[],
  prefix = 'sess',
): ConversationInput[] {
  return draws.map((k, i) => ({ id: `${prefix}-${i + 1}`, values: { [variable]: valueIds[k] as string } }));
}

/** Session rows over several variables. */
export function sessionRows(rows: readonly Row[], prefix = 'sess'): ConversationInput[] {
  return rows.map((values, i) => ({ id: `${prefix}-${i + 1}`, values }));
}

export const emptyOwner = (): OwnerInput => ({});

/** The refusals of a store that mention one of the needles in `what` or `reason`. */
export function refusalsMentioning(store: StoreDoc, ...needles: string[]): Refusal[] {
  return store.refused.filter((r) =>
    needles.some((n) => n !== '' && (String(r.what).includes(n) || String(r.reason).includes(n))),
  );
}

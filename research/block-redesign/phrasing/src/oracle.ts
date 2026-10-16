// M1.3 prototype: the exact-match oracle (the repo's `tools` check, as today) and the normalised-slot
// oracle (the same check after each slot field is compared by its normalise rule).
import { tools as toolsCheck } from '../../../../packages/checks/src/checks/tools.ts';
import type { SlotField, SlotKind } from './blocks.ts';

export type Call = { label: string; input: unknown; output?: unknown; error?: string };
type ToolExpect = { label: string; count?: unknown; input?: Record<string, unknown> };
type Expect = { tools?: ToolExpect[]; tool_order?: string };

/** Digits of a US number with the country code: (202) 555-0150 and +1 202 555 0150 both give 12025550150. */
export function normPhone(text: string): string {
  const digits = text.replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}

export function normEmail(text: string): string {
  return text
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

const ABBREVIATIONS: Record<string, string> = {
  rd: 'road',
  ln: 'lane',
  ave: 'avenue',
  av: 'avenue',
  st: 'street',
  wy: 'way',
};

/** The street part of an address: lower case, no punctuation, abbreviations expanded, the town dropped. */
export function normAddress(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && word !== 'acmeville')
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(' ');
}

export function normalise(kind: SlotKind, text: string): string {
  if (kind === 'phone') return normPhone(text);
  if (kind === 'email') return normEmail(text);
  if (kind === 'address') return normAddress(text);
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function zeroCount(count: unknown): boolean {
  return count === 0 || (typeof count === 'object' && count !== null && (count as { max?: number }).max === 0);
}

export type OracleResult = { pass: boolean; failed: string[] };

/** Today's Then on tool calls: the `tools` check, plus each tool expected 0 times (the forbidden check's share). */
export function exactOracle(expect: Expect, calls: Call[]): OracleResult {
  const failed: string[] = [];
  const ctx = { expect: { tools: expect.tools ?? [], tool_order: expect.tool_order }, observed: { toolCalls: calls } };
  if (toolsCheck.applies(ctx as never)) {
    const verdicts = toolsCheck.evaluate(ctx as never) as { id?: string; name?: string; outcome: string; gating?: boolean }[];
    for (const v of verdicts) {
      if (v.gating === false) continue;
      if (v.outcome !== 'pass') failed.push(v.id ?? v.name ?? 'tools');
    }
  }
  for (const tool of expect.tools ?? []) {
    if (zeroCount(tool.count) && calls.some((call) => call.label === tool.label)) failed.push(`${tool.label}.count0`);
  }
  return { pass: failed.length === 0, failed };
}

function getPath(value: unknown, path: string[]): unknown {
  let at = value;
  for (const key of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

function setPath(value: Record<string, unknown>, path: string[], next: unknown): void {
  let at = value;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path.at(-1) as string] = next;
}

export type Snap = { tool: string; path: string; raw: unknown; normalised: string; gold: string; snapped: boolean };

/** Each slot field whose normalised value agrees with the gold is replaced by the gold; every field is recorded. */
export function snapCalls(calls: Call[], fields: SlotField[]): { calls: Call[]; snaps: Snap[] } {
  const snaps: Snap[] = [];
  const out = calls.map((call) => {
    const mine = fields.filter((field) => field.tool === call.label);
    if (mine.length === 0 || call.input === null || typeof call.input !== 'object') return call;
    const input = structuredClone(call.input) as Record<string, unknown>;
    for (const field of mine) {
      const raw = getPath(input, field.path);
      if (typeof raw !== 'string') {
        snaps.push({ tool: call.label, path: field.path.join('.'), raw, normalised: '', gold: field.gold, snapped: false });
        continue;
      }
      const got = normalise(field.kind, raw);
      const want = normalise(field.kind, field.gold);
      const agrees = field.mode === 'equal' ? got === want : ` ${got} `.includes(` ${want} `);
      if (agrees) setPath(input, field.path, field.gold);
      snaps.push({ tool: call.label, path: field.path.join('.'), raw, normalised: got, gold: field.gold, snapped: agrees });
    }
    return { ...call, input };
  });
  return { calls: out, snaps };
}

export function normalisedOracle(expect: Expect, calls: Call[], fields: SlotField[]): OracleResult & { snaps: Snap[] } {
  const snapped = snapCalls(calls, fields);
  return { ...exactOracle(expect, snapped.calls), snaps: snapped.snaps };
}

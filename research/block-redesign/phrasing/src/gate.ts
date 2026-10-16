// M1.1 prototype: the realiser (planner row -> one candidate string) and the acceptance gate.
import type { BlockDef, Slot } from './blocks.ts';
import { chatJson, GEN_MODEL } from './openai.ts';
import { normAddress, normEmail, normPhone } from './oracle.ts';
import { AXES, type Row } from './planner.ts';

export const STYLE_AXES = ['register', 'length', 'noise', 'distractor', 'lexical'] as const;

export const AXIS_DEFS: Record<string, Record<string, string>> = {
  register: {
    formal: 'polite and complete, no slang, no contractions',
    neutral: 'plain everyday wording',
    casual: 'informal: contractions, relaxed wording, may start with hey or similar',
  },
  length: {
    terse: 'at most 4 words besides the fixed values',
    one_sentence: 'exactly one sentence',
    multi_sentence: 'two or three sentences',
  },
  noise: {
    clean: 'correct spelling and punctuation',
    typos: 'two or three misspelled words, never inside a slot value',
    no_punctuation: 'no punctuation marks at all, except those inside a slot value',
  },
  distractor: {
    none: 'nothing beyond the request',
    unrelated_aside: 'adds a short aside unrelated to the request (their day, the weather) that asks nothing and changes nothing',
    redundant_detail: 'adds a detail that repeats what the conversation already established and changes nothing',
  },
  lexical: {
    seed_words: 'reuses the words of the original message where it has any, in a similar order',
    synonyms: 'the words other than the fixed values differ from the original message (when the original has no such words, any added wording counts), with a similar structure',
    restructured: 'a different sentence structure from the original, for example a statement becomes a question or a request, or the parts come in another order',
  },
};

export function slotForm(slot: Slot, row: Row): string {
  return slot.forms[(row.slot_surface ?? 'canonical') as keyof Slot['forms']];
}

const REALISER = `You write one customer message for a test of a telecom sales assistant (Acme Telecom, a fictional company).
You get the assistant's last reply, the customer's original next message, the values the message must carry, and a style.
Write a different message that a real customer could send in that place, with the same request, the same constraints and the same values.
Rules:
- Copy every value character for character exactly as given. Never change, abbreviate or misspell a value. Never add a typo inside a value. Punctuation and capitals inside a value stay as given, whatever the style says.
- Add no other phone number, email address, street address, plan name, price or order id.
- Do not use negation words (not, no, never, don't, can't, without) unless the original message uses them.
- Do not ask for anything the original message does not ask for.
- Follow every style instruction.
Answer with JSON: {"text": "<the message>"}`;

export async function realise(
  def: BlockDef,
  seed: string,
  lastReply: string,
  row: Row,
  callSeed: number,
  batch: string,
  previous?: { text: string; reason: string },
): Promise<string> {
  const values = def.slots.map((slot) => `- ${slot.name}: ${slotForm(slot, row)}`).join('\n');
  const style = STYLE_AXES.map((axis) => `- ${axis}: ${row[axis]} (${AXIS_DEFS[axis]?.[row[axis] as string]})`).join('\n');
  const user = `Assistant's last reply: ${lastReply === '' ? '(none, this is the first message)' : JSON.stringify(lastReply)}
Original customer message: ${JSON.stringify(seed)}
Values the message must carry, exactly:
${values}
Style:
${style}${previous ? `\nA previous attempt was rejected. Attempt: ${JSON.stringify(previous.text)}. Reason: ${previous.reason}. Write a new message that fixes this.` : ''}`;
  const answer = await chatJson<{ text?: string }>(batch, GEN_MODEL, REALISER, user, callSeed);
  return (answer.text ?? '').trim();
}

// ---------------------------------------------------------------- deterministic stages

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ADDRESS = /\b\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s+(?:road|rd|lane|ln|avenue|ave|av|way|wy|street|st)\b/gi;
const PLANS = ['fiber 1000', 'fiber 300', 'air 5g', 'mobile s', 'mobile m', 'mobile l'];
const NEGATION = /\b(not|no|never|none|nothing|nobody|without|cannot|\w+n't|dont|cant|wont|didnt|doesnt|isnt)\b/gi;

function found(kind: Slot['kind'], text: string): string[] {
  if (kind === 'phone') return [...text.matchAll(PHONE)].map((m) => normPhone(m[0]));
  if (kind === 'email') return [...text.matchAll(EMAIL)].map((m) => normEmail(m[0]));
  if (kind === 'address') return [...text.matchAll(ADDRESS)].map((m) => normAddress(m[0]));
  const low = text.toLowerCase();
  return PLANS.filter((plan) => low.includes(plan));
}

function want(slot: Slot): string {
  if (slot.kind === 'phone') return normPhone(slot.value);
  if (slot.kind === 'email') return normEmail(slot.value);
  if (slot.kind === 'address') return normAddress(slot.value);
  return slot.value.toLowerCase().replace(/^acme /, '');
}

export function negations(text: string): number {
  return [...text.matchAll(NEGATION)].length;
}

/** Character 4-gram cosine similarity. */
export function cosine4(a: string, b: string): number {
  const grams = (s: string) => {
    const m = new Map<string, number>();
    const t = s.toLowerCase();
    for (let i = 0; i + 4 <= t.length; i++) m.set(t.slice(i, i + 4), (m.get(t.slice(i, i + 4)) ?? 0) + 1);
    return m;
  };
  const x = grams(a);
  const y = grams(b);
  let dot = 0;
  for (const [g, v] of x) dot += v * (y.get(g) ?? 0);
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  const d = norm(x) * norm(y);
  return d === 0 ? 0 : dot / d;
}

export type Stage = { stage: string; ok: boolean; note?: string };

/**
 * The deterministic stages. `context` is the text of the customer's earlier turns: a value the conversation
 * already holds (an address repeated as a redundant detail) is not a second id.
 */
export function deterministicStages(def: BlockDef, seed: string, text: string, row: Row | null, accepted: string[], context = ''): Stage[] {
  const stages: Stage[] = [];
  const presence = def.slots.every((slot) => found(slot.kind, text).includes(want(slot)));
  stages.push({ stage: 'slot_presence', ok: presence });
  let exclusive = true;
  for (const kind of ['phone', 'email', 'address', 'plan'] as const) {
    const values = found(kind, text);
    const allowed = [...def.slots.filter((s) => s.kind === kind).map(want), ...found(kind, context)];
    if (values.some((v) => !allowed.includes(v))) exclusive = false;
  }
  stages.push({ stage: 'slot_exclusivity', ok: exclusive });
  stages.push({ stage: 'negation_parity', ok: negations(text) === negations(seed), note: `${negations(text)} vs ${negations(seed)}` });
  if (row) {
    const forms = def.slots.every((slot) => text.includes(slotForm(slot, row)));
    stages.push({ stage: 'axis_slot_surface', ok: forms });
  }
  const nearest = Math.max(0, ...accepted.map((a) => cosine4(a, text)));
  stages.push({ stage: 'near_duplicate', ok: nearest <= 0.8, note: nearest.toFixed(3) });
  return stages;
}

// ---------------------------------------------------------------- model stages

const VERIFIER = `You check whether one customer message follows a style instruction on five axes. For each axis you get the required value and its definition; answer whether the message satisfies it.
The message carries fixed values (phone numbers, emails, addresses, plan names). Their punctuation, capitals and spelling are dictated and never count for or against any axis.
Axis values:
${Object.entries(AXIS_DEFS)
  .map(([axis, values]) => `${axis}:\n${Object.entries(values)
    .map(([v, d]) => `  - ${v}: ${d}`)
    .join('\n')}`)
  .join('\n')}
Answer with JSON: {"register": true or false, "length": true or false, "noise": true or false, "distractor": true or false, "lexical": true or false, "reason": "one sentence naming any axis that fails"}.`;

export async function axisStage(def: BlockDef, seed: string, text: string, row: Row, callSeed: number, batch: string): Promise<Stage> {
  const values = def.slots.map((slot) => slotForm(slot, row)).join('; ');
  const required = STYLE_AXES.map((axis) => `- ${axis}: ${row[axis]}`).join('\n');
  const verdict = await chatJson<Record<string, unknown>>(
    batch,
    GEN_MODEL,
    VERIFIER,
    `Original message (for the lexical axis): ${JSON.stringify(seed)}\nFixed values: ${values}\nRequired style:\n${required}\nMessage to check: ${JSON.stringify(text)}`,
    callSeed,
  );
  const misses = STYLE_AXES.filter((axis) => verdict[axis] !== true);
  return { stage: 'axis_conformance', ok: misses.length === 0, note: misses.length === 0 ? '' : `${misses.join(', ')}: ${String(verdict.reason ?? '')}` };
}

const JUDGE = `You check a test message for a telecom sales assistant. You get the assistant's last reply, the customer's original next message, and a candidate rewrite.
The rewrite is equivalent when a competent assistant should do exactly the same thing after it as after the original: the same request, the same constraints, and exactly the same phone numbers, emails, street addresses and plan names (formatting such as case, spacing or abbreviation may differ). Extra small talk is fine if it asks nothing and changes nothing. Anything added, removed, negated or changed in the request or the values makes it not equivalent.
Answer with JSON: {"same": true or false, "confidence": a number from 0 to 1, "reason": "one sentence"}.`;

export async function equivalenceStage(def: BlockDef, seed: string, lastReply: string, text: string, callSeed: number, batch: string): Promise<Stage> {
  const forms = def.slots.map((slot) => `- ${slot.name}: ${Object.values(slot.forms).map((f) => JSON.stringify(f)).join(', ')}`).join('\n');
  const verdict = await chatJson<{ same?: boolean; confidence?: number; reason?: string }>(
    batch,
    GEN_MODEL,
    JUDGE,
    `Assistant's last reply: ${lastReply === '' ? '(none)' : JSON.stringify(lastReply)}\nThese spellings of each value are the same value:\n${forms}\nOriginal: ${JSON.stringify(seed)}\nRewrite: ${JSON.stringify(text)}`,
    callSeed,
  );
  const ok = verdict.same === true && (verdict.confidence ?? 0) >= 0.9;
  return { stage: 'equivalence_judge', ok, note: `${verdict.same} ${verdict.confidence}: ${verdict.reason ?? ''}` };
}

export const AXIS_LIST = AXES;

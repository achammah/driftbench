import { z } from 'zod';
import type { Assessment, RubricScores } from './assessment';
import type { ReasoningRecovery } from './clients/reasoning-budget';
import type { ConformanceAudit } from './conformance';
import type { CriterionLedger, CriterionRequirement } from './criterion-ledger';
import type { FactLedgerAnswer, PointwiseFactLedgerAnswer } from './fact-audit';
import type { LedgerParseStep, PairLedger } from './pair-ledger-contract';

/**
 * The answer contract every judge returns, and the request every judge reads.
 *
 * A judge answers one criterion on one transcript slice: pass, fail or inconclusive. An answer that does
 * not parse is inconclusive, never a pass. An inconclusive answer is never counted as a pass or a fail.
 */

export const JudgeOutcome = z.enum(['pass', 'fail', 'inconclusive']);
export type JudgeOutcome = z.infer<typeof JudgeOutcome>;

/**
 * The strict answer contract. `score` is the judge's probability that the criterion passes, from 0 to 1.
 * `evidence` quotes the part of the data the verdict rests on. Any other key makes the answer invalid.
 */
export const JudgeAnswer = z.strictObject({
  outcome: JudgeOutcome,
  score: z.number().min(0).max(1).optional(),
  reasoning: z.string(),
  evidence: z.string().optional(),
});
export type JudgeAnswer = z.infer<typeof JudgeAnswer>;

/** The two judge classes: a fixed binary question (system 1), or a chat model with reasoning (system 2). */
export const JudgeClass = z.enum(['system1', 'system2']);
export type JudgeClass = z.infer<typeof JudgeClass>;

/** How much room a judge gets. A re-judge after an unparseable answer runs with the large budget. */
export type Budget = 'normal' | 'large';

/** The token budgets behind the two budget names, for clients that take a token limit. */
export const MAX_TOKENS: Readonly<Record<Budget, number>> = { normal: 1024, large: 4096 };

/** One line of a transcript slice. Tool entries carry the tool name. */
export const TranscriptEntry = z.strictObject({
  role: z.enum(['user', 'agent', 'tool_call', 'tool_result', 'card', 'context']),
  text: z.string(),
  tool: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntry>;

/** The criterion as a judge reads it: the question, and what passing and failing look like. */
export const CriterionText = z.strictObject({
  name: z.string().min(1),
  rubric: z.string().min(1),
  pass: z.string().optional(),
  fail: z.string().optional(),
  scope: z.enum(['block', 'conversation']).optional(),
});
export type CriterionText = z.infer<typeof CriterionText>;

/** Everything one judge call reads. */
export type JudgeRequest = {
  /** A reference procedure observed disagreement before this judge call. Never a truth label. */
  readonly referenceDisagreement?: boolean;
  /** Previous model-facing prompt and parser, for exact replay of existing scores. Default ledger. */
  readonly answerContract?: 'ledger' | 'legacy';
  /** Provider output dialect and explicit reasoning setting for pair ledgers. */
  readonly dialect?: string;
  readonly reasoning?: 'low' | 'medium' | 'high';
  /** Exact requirement ids and definitions to check. Absent: the criterion name and full rubric. */
  readonly requirements?: readonly CriterionRequirement[];
  /** Opt-in answer contract. Pairwise calls name the winner; rubric calls score each supplied item. */
  readonly assessment?: Assessment;
  /** Candidate texts for validating content-anchored winners. */
  readonly candidates?: { readonly A: string; readonly B: string };
  /** Pairwise presentation policy, included in cassette identity. Absent means both orders. */
  readonly presentation?: 'both-orders' | 'canonical';
  readonly factAudit?: { readonly reference: string };
  readonly criterion: CriterionText;
  /** The system prompt of this request. Absent: the criterion prompt of the prompt kit. */
  readonly system?: string;
  /** The observed slice: what the user sent, what the agent did and said. */
  readonly transcript: readonly TranscriptEntry[];
  /** The text of a produced file, as an artifact reader extracted it. */
  readonly artifact?: string;
  /** The workspace inputs the criterion names (`inputs`), each with its path: what the output is compared against. */
  readonly inputs?: readonly { readonly path: string; readonly text: string }[];
  /** A summary of the block's Given: the stage expected and the ledger. */
  readonly given?: { readonly stage?: string; readonly ledger?: Readonly<Record<string, unknown>> };
  /** The answer the block is expected to give. It is part of the request key, so a changed reference never replays. */
  readonly reference?: string;
  readonly budget?: Budget;
};

/** Observable uncertainty signals. Labels never enter this routing contract. */
export type EscalationTrigger = 'order-split' | 'inconclusive' | 'reference-disagreement' | 'low-confidence';
export type EscalationRecord = {
  readonly triggers: readonly EscalationTrigger[];
  readonly escalated: boolean;
  readonly first: readonly JudgeResult[];
  readonly then: readonly { readonly judge: string; readonly result: JudgeResult; readonly error?: string }[];
  readonly decision: 'first' | 'majority' | 'first-stands' | 'inconclusive';
  readonly calls: number;
};
export type ComparisonResult = {
  /** Final outcomes in their original presentation orders, including first-stands fallback. */
  readonly ordered: JudgeOutcome;
  readonly swapped: JudgeOutcome;
  /** Diagnostics from the first judge's two orders, before escalation. */
  readonly consistent: boolean;
  readonly positionBias: boolean;
};

/** What a client returns: the answer, the raw text it came from, and whether that text parsed. */
export type JudgeResult = {
  readonly usage?: import('./clients/usage').TokenUsage;
  readonly requestCount?: number;
  readonly reaskReason?: 'reasoning-budget-exhausted';
  readonly usageComplete?: boolean;
  readonly costComplete?: boolean;
  readonly recovery?: ReasoningRecovery;
  readonly pairLedger?: PairLedger;
  readonly parseSteps?: readonly LedgerParseStep[];
  readonly metadata?: { readonly graderError?: boolean };

  readonly escalation?: EscalationRecord;
  readonly comparison?: ComparisonResult;
  /** Explicit disagreement observed by a reference verification procedure. */
  readonly referenceDisagreement?: boolean;
  /** Explicit pairwise winner before mapping it to the legacy binary outcome. */
  readonly winner?: 'A' | 'B' | 'tie' | 'inconclusive';
  /** Validated item scores and the deterministic aggregate. */
  readonly rubric?: RubricScores;
  readonly factLedger?: FactLedgerAnswer | PointwiseFactLedgerAnswer;
  /** Opt-in criterion-local conformance audit, with its outcome computed in code. */
  readonly conformance?: ConformanceAudit;
  /** Default chat-model requirement ledger, with the public outcome computed in code. */
  readonly checks?: CriterionLedger['checks'];
  /** Model-invented criterion ids or rubric names, ignored in scoring and retained for diagnostics. */
  readonly ignoredRequirementIds?: readonly string[];
  readonly referenceAgreement?: {
    readonly attempts: number;
    readonly agreement: number;
    readonly used: boolean;
    /** Auto route selected solving (true) or skipped it (false). Absent when routing was not requested. */
    readonly routed?: boolean;
  };
  readonly answer: JudgeAnswer;
  /** The provider's answer as received: the model text, or the JSON body of a system 1 answer. */
  readonly raw: string;
  /** True when the raw answer did not satisfy the contract. The answer is then inconclusive. */
  readonly unparsed?: boolean;
  /** What the call cost in US dollars, when the provider reports it (the claude command does). */
  readonly costUsd?: number;
  /** True when the answer parsed only after the strict repair of unescaped quotes in its string values. */
  readonly repaired?: boolean;
};

/** An inconclusive answer that names why. */
export function inconclusive(reasoning: string): JudgeAnswer {
  return { outcome: 'inconclusive', reasoning };
}

/**
 * Reads a model's text as the answer contract. Accepts the JSON object alone, inside a fenced block, or
 * surrounded by prose. Anything else, an extra key included, is an unparsed inconclusive answer.
 */
export function parseAnswerText(raw: string): JudgeResult {
  return parseText(raw, repairAnswerText);
}

function parseText(raw: string, quoteRepair: (text: string) => string): JudgeResult {
  const candidate = extractObject(raw);
  if (candidate === undefined) {
    return { answer: inconclusive('unparseable answer: no JSON object found'), raw, unparsed: true };
  }
  const duplicate = repeatedObjectKey(repairAnswerText(candidate));
  if (duplicate !== undefined)
    return { raw, unparsed: true, answer: inconclusive(`unparseable answer: repeated key ${duplicate}`) };
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch (cause) {
    // One strict repair: escape the double quotes inside string values, then read it again. A repaired
    // answer still meets the whole contract or stays unparsed.
    for (const repair of [
      quoteRepair,
      singleToDoubleQuotes,
      dropTrailingComma,
      dropCommentLines,
      straightenCurlyQuotes,
    ]) {
      try {
        const fixed = repair(candidate);
        if (repeatedObjectKey(fixed) !== undefined) continue;
        const repaired = parseAnswerValue(JSON.parse(fixed), raw);
        if (!repaired.unparsed) return { ...repaired, repaired: true };
      } catch {
        // Not JSON after this repair: try the next, and the first error explains it if none reads.
      }
    }
    const why = cause instanceof Error ? cause.message : String(cause);
    return { answer: inconclusive(`unparseable answer: ${why}`), raw, unparsed: true };
  }
  const strict = parseAnswerValue(value, raw);
  if (!strict.unparsed) return strict;
  // Near-JSON: an outcome written with capitals or spaces around it names its verdict. It is read, and marked repaired.
  const recased = recaseOutcome(value);
  if (recased !== undefined) {
    const repaired = parseAnswerValue(recased, raw);
    if (!repaired.unparsed) return { ...repaired, repaired: true };
  }
  return strict;
}

/** Detect duplicate keys within each object before JSON.parse can discard an earlier verdict. */
export function repeatedObjectKey(text: string): string | undefined {
  const stack: { object: boolean; keys: Set<string>; key: boolean }[] = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g;
  for (const token of text.matchAll(tokens)) {
    const value = token[0];
    const frame = stack.at(-1);
    if (value === '{' || value === '[') {
      stack.push({ object: value === '{', keys: new Set(), key: value === '{' });
    } else if (value === '}' || value === ']') stack.pop();
    else if (value === ':' && frame) frame.key = false;
    else if (value === ',' && frame?.object) frame.key = true;
    else if (value.startsWith('"') && frame?.object && frame.key) {
      // Keys with escaped spellings are the same key after decoding, e.g. out\u0063ome.
      let name: string;
      try {
        name = JSON.parse(value) as string;
      } catch {
        continue;
      }
      if (frame.keys.has(name)) return name;
      frame.keys.add(name);
      frame.key = false;
    }
  }
  return undefined;
}

/**
 * The decoded answer with the near-JSON slips undone: an outcome with capitals or spaces, a score written as a number
 * in quotes. Undefined when that changes nothing.
 */
function recaseOutcome(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fixed: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  let changed = false;
  const outcome = fixed.outcome;
  if (typeof outcome === 'string') {
    const folded = outcome.trim().toLowerCase();
    if (folded !== outcome && JudgeOutcome.safeParse(folded).success) {
      fixed.outcome = folded;
      changed = true;
    }
  }
  const score = fixed.score;
  if (typeof score === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(score)) {
    fixed.score = Number(score);
    changed = true;
  }
  return changed ? fixed : undefined;
}

/**
 * Repairs unescaped quotes inside JSON strings. An object value ends before a comma only when the
 * next token is a property name followed by a colon. A quoted word in a prose list cannot end it.
 * Invalid JSON backslash escapes inside a string are retained as literal backslashes.
 * No key, verdict or value outside a string is added, removed or renamed.
 */
export function repairAnswerText(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let key = false;
  let previous = '';
  const containers: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (!inString) {
      if (ch === '"') {
        inString = true;
        key = containers.at(-1) === '{' && previous !== ':';
      } else {
        if (ch === '{' || ch === '[') containers.push(ch);
        if (ch === '}' || ch === ']') containers.pop();
        if (!/\s/.test(ch)) previous = ch;
      }
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      const valid =
        next !== undefined &&
        (/["\\/bfnrt]/.test(next) || (next === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2))));
      escaped = valid;
      out += valid ? ch : '\\\\';
      continue;
    }
    if (ch === '"') {
      const rest = text.slice(i + 1).trimStart();
      const next = rest[0];
      const comma = next === ',' && (containers.at(-1) !== '{' || /^,\s*"(?:\\.|[^"\\])*"\s*:/.test(rest));
      if (key ? next === ':' : next === undefined || next === '}' || next === ']' || comma) {
        inString = false;
        previous = '"';
        out += ch;
      } else out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Near-JSON written with single quotes: a string opened with `'` is rewritten with double quotes. A double quote inside
 * it is escaped and an escaped apostrophe is unescaped. Text outside strings is not touched.
 */
export function singleToDoubleQuotes(text: string): string {
  let out = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote === undefined) {
      if (ch === '"' || ch === "'") {
        quote = ch;
        out += '"';
      } else out += ch;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      i += 1;
      if (next === undefined) break;
      out += quote === "'" && next === "'" ? "'" : `\\${next}`;
      continue;
    }
    if (ch === quote) {
      quote = undefined;
      out += '"';
    } else out += quote === "'" && ch === '"' ? '\\"' : ch;
  }
  return out;
}

/**
 * Near-JSON written with typographic double quotes: a string opened by a curly quote ends at the next curly quote, and
 * both become straight quotes. A straight quote inside it is escaped. Strings opened with a straight quote are copied
 * as they are, curly quotes inside them included.
 */
export function straightenCurlyQuotes(text: string): string {
  const curly = (ch: string) => ch === '\u201c' || ch === '\u201d';
  let out = '';
  let mode: 'straight' | 'curly' | undefined;
  let escaped = false;
  for (const ch of text) {
    if (mode === undefined) {
      if (ch === '"') mode = 'straight';
      else if (curly(ch)) mode = 'curly';
      out += ch === '"' || curly(ch) ? '"' : ch;
      continue;
    }
    if (mode === 'straight') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') mode = undefined;
      out += ch;
      continue;
    }
    if (curly(ch)) {
      mode = undefined;
      out += '"';
    } else out += ch === '"' ? '\\"' : ch;
  }
  return out;
}

/** Near-JSON with a line that holds only a `//` comment: the line is dropped. A string cannot span lines, so no value is touched. */
export function dropCommentLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Near-JSON with one comma before the closing brace: the comma outside strings is dropped. */
export function dropTrailingComma(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    out += ch;
  }
  return out;
}

/** Validates an already decoded answer against the contract. */
export function parseAnswerValue(value: unknown, raw: string = JSON.stringify(value)): JudgeResult {
  const duplicate = repeatedObjectKey(repairAnswerText(raw));
  if (duplicate !== undefined)
    return {
      raw,
      unparsed: true,
      answer: inconclusive(`answer breaks the contract: repeated key ${duplicate}`),
    };
  const parsed = JudgeAnswer.safeParse(value);
  if (parsed.success) return { answer: parsed.data, raw };
  const issue = parsed.error.issues[0];
  const where = issue?.path.join('.') || '(root)';
  return {
    answer: inconclusive(`answer breaks the contract: ${where} ${issue?.message ?? ''}`.trim()),
    raw,
    unparsed: true,
  };
}

/**
 * The final answer: the last top-level JSON object of the text. An object the model quoted in its reasoning comes
 * earlier, so it never becomes the verdict. A final object still open at the end of the text (a cut answer) yields
 * nothing, so the verdict is inconclusive rather than the last complete object before it.
 */
export function extractObject(raw: string): string | undefined {
  let depth = 0;
  let start = -1;
  let quote: string | undefined;
  let escaped = false;
  let last: string | undefined;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (depth === 0) {
      if (ch === '{') {
        depth = 1;
        start = i;
        quote = undefined;
        escaped = false;
      }
      continue;
    }
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) last = raw.slice(start, i + 1);
    }
  }
  return depth === 0 ? last : undefined;
}

/**
 * Maps a system 1 probability that the criterion passes to an outcome. Between the two bounds the answer
 * is inconclusive: a coin toss is never a verdict.
 * A probability that is not a number from 0 to 1 is inconclusive too.
 */
export function outcomeFromProbability(
  probability: number,
  bounds: { passAt?: number; failAt?: number } = {},
): JudgeOutcome {
  const passAt = bounds.passAt ?? 0.6;
  const failAt = bounds.failAt ?? 0.4;
  if (!(failAt < passAt)) throw new RangeError(`failAt (${failAt}) must be under passAt (${passAt})`);
  if (!(probability >= 0 && probability <= 1)) return 'inconclusive';
  if (probability >= passAt) return 'pass';
  if (probability <= failAt) return 'fail';
  return 'inconclusive';
}

import { createHash } from 'node:crypto';
import type { RubricItem } from './assessment';
import { parseJudgeText } from './assessment';
import type { JudgeClient } from './client';
import type { CriterionText, JudgeRequest, JudgeResult, TranscriptEntry } from './contract';
import { lintCriterion } from './lint';
import {
  type LedgerParseStep,
  PairLedger,
  pairLedgerSchema,
  pairRequirements,
  validatePairRequirements,
} from './pair-ledger-contract';
import { type PairStage0Options, type PairStage0Result, runPairStage0 } from './pair-stage0';

export { type LedgerParseStep, PairLedger } from './pair-ledger-contract';
export type LedgerChoice = 'first' | 'second' | 'tie';
export type LedgerReading = {
  readonly sign: -1 | 0 | 1;
  readonly margin: number;
  readonly signedSum: number;
  readonly ruleId: string;
};
export type LedgerVerdict = {
  readonly status: 'decided' | 'escalate' | 'tie';
  readonly choice?: LedgerChoice;
  readonly ruleId: string;
  readonly readings: readonly LedgerReading[];
};
const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);
const choice = (n: number): LedgerChoice => (n > 0 ? 'first' : n < 0 ? 'second' : 'tie');

/** Pure arithmetic on a complete caller-owned ledger. Unknown scores trigger escalation, never implicit zeroes. */
export function scoreLedger(ledger: PairLedger, requirements: readonly RubricItem[]): LedgerReading {
  validatePairRequirements(requirements);
  const parsed = PairLedger.parse(ledger);
  const rows = new Map(parsed.items.map((r) => [r.name, r]));
  if (
    rows.size !== requirements.length ||
    parsed.items.length !== requirements.length ||
    requirements.some((r) => !rows.has(r.name))
  )
    throw new RangeError('every pair requirement must appear exactly once');
  const unknown = (r: RubricItem) => {
    const row = rows.get(r.name);
    return !row || row.first === null || row.second === null;
  };
  if (requirements.some((r) => r.hard && unknown(r)))
    return { sign: 0, margin: 0, signedSum: 0, ruleId: 'ledger.unknown-score' };
  const diff = (r: RubricItem) => {
    const row = rows.get(r.name);
    if (!row || row.first === null || row.second === null) throw new RangeError('missing scored row');
    return row.first - row.second;
  };
  // Unknown soft rows cannot overturn an established hard gate. The diagnostic sum covers known rows.
  const signedSum = requirements
    .filter((r) => !unknown(r))
    .reduce((sum, r) => sum + diff(r) * (r.weight ?? (r.hard ? 2 : 1)), 0);
  if (!Number.isFinite(signedSum)) throw new RangeError('pair ledger weighted sum must be finite');
  const hard = requirements.filter((r) => r.hard && diff(r) !== 0);
  const firstLost = hard.some((r) => diff(r) < 0),
    secondLost = hard.some((r) => diff(r) > 0);
  if (firstLost && secondLost) return { sign: 0, margin: 0, signedSum, ruleId: 'ledger.hard-conflict' };
  if (hard.length) {
    const hardSum = hard.reduce((sum, r) => sum + diff(r) * (r.weight ?? 2), 0);
    return { sign: firstLost ? -1 : 1, margin: Math.abs(hardSum), signedSum, ruleId: 'ledger.hard-gate' };
  }
  if (requirements.some(unknown)) return { sign: 0, margin: 0, signedSum, ruleId: 'ledger.unknown-score' };
  return { sign: sign(signedSum), margin: Math.abs(signedSum), signedSum, ruleId: 'ledger.weighted-sum' };
}

/** Reconcile two orders, then one canonical escalation. Third-read scores use its own presentation order. */
export function verdictFromLedger(
  requirements: readonly RubricItem[],
  ordered: PairLedger,
  swapped: PairLedger,
  canonical?: { readonly ledger: PairLedger; readonly firstIsOriginalFirst: boolean },
  options: { readonly tiePolicy?: 'tie' | 'canonical' } = {},
): LedgerVerdict {
  const a = scoreLedger(ordered, requirements),
    reverse = scoreLedger(swapped, requirements);
  const b: LedgerReading = { ...reverse, sign: sign(-reverse.sign), signedSum: -reverse.signedSum };
  const readings = [a, b];
  if (a.sign !== 0 && a.sign === b.sign)
    return { status: 'decided', choice: choice(a.sign), ruleId: 'ledger.orders-agree', readings };
  const nonzero = a.sign === 0 ? b : b.sign === 0 ? a : undefined;
  if (nonzero && nonzero.sign !== 0 && nonzero.margin >= 2)
    return { status: 'decided', choice: choice(nonzero.sign), ruleId: 'ledger.margin-two', readings };
  if (!canonical) return { status: 'escalate', ruleId: 'ledger.canonical-required', readings };
  const third = scoreLedger(canonical.ledger, requirements);
  const c: LedgerReading = canonical.firstIsOriginalFirst
    ? third
    : { ...third, sign: sign(-third.sign), signedSum: -third.signedSum };
  readings.push(c);
  let total = a.sign + b.sign + c.sign;
  if (total === 0 && options.tiePolicy === 'canonical') total = c.sign;
  return {
    status: total === 0 ? 'tie' : 'decided',
    choice: choice(total),
    ruleId: total === 0 ? 'ledger.escalated-tie' : 'ledger.escalated-quorum',
    readings,
  };
}

/** Stable canonical presentation under caller relabelling. Exact content, never lengths or candidate labels. */
export function canonicalPairOrder(
  first: string,
  second: string,
): { first: string; second: string; firstIsOriginalFirst: boolean } {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const a = hash(first),
    b = hash(second);
  const firstIsOriginalFirst = a < b || (a === b && first <= second);
  return {
    first: firstIsOriginalFirst ? first : second,
    second: firstIsOriginalFirst ? second : first,
    firstIsOriginalFirst,
  };
}

export function pairLedgerRequest(
  criterion: CriterionText,
  transcript: readonly TranscriptEntry[],
  first: string,
  second: string,
  options: {
    readonly requirements?: readonly RubricItem[];
    readonly reference?: string;
    readonly reasoning?: 'low' | 'medium' | 'high';
  } = {},
): JudgeRequest {
  const request: JudgeRequest = {
    answerContract: 'ledger',
    assessment: { kind: 'pairwise', ...(options.requirements ? { items: options.requirements } : {}) },
    criterion,
    transcript,
    candidates: { A: first, B: second },
    ...(options.reference === undefined ? {} : { reference: options.reference }),
    ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
  };
  pairRequirements(request);
  return request;
}

export type PairLedgerRead = {
  readonly order: 'ordered' | 'swapped' | 'canonical';
  readonly result: JudgeResult;
  /** Both attempts survive in the audit even when the re-ask succeeds. */
  readonly attempts: readonly JudgeResult[];
  readonly parseSteps: readonly LedgerParseStep[];
};
export type PairLedgerResult = {
  readonly status: 'decided' | 'tie' | 'unparsed';
  readonly choice?: LedgerChoice;
  readonly calls: number;
  readonly reads: readonly PairLedgerRead[];
  readonly stage0: PairStage0Result;
  readonly verdict?: LedgerVerdict;
  readonly metadata?: { readonly graderError: boolean };
  readonly lint: readonly { readonly name: string; readonly codes: readonly string[] }[];
};
export type PairLedgerOptions = {
  readonly stage0?: PairStage0Options;
  /** A caller supplies a seat only after its category fixtures earn it. Default: the same client. */
  readonly escalationClient?: JudgeClient;
  readonly tiePolicy?: 'tie' | 'canonical';
};

/** Public package entrypoint: machine checks, both orders, bounded parser repair/re-ask, canonical quorum. */
export async function judgePairLedger(
  client: JudgeClient,
  input: JudgeRequest,
  options: PairLedgerOptions = {},
): Promise<PairLedgerResult> {
  if (!input.candidates) throw new RangeError('a pair ledger needs both candidates');
  if (client.cls !== 'system2' || (options.escalationClient && options.escalationClient.cls !== 'system2'))
    throw new RangeError('pair ledger readers must support the system2 ledger contract');
  const request = {
    ...input,
    answerContract: 'ledger' as const,
    assessment: {
      kind: 'pairwise' as const,
      ...(input.assessment?.kind === 'pairwise' && input.assessment.items
        ? { items: input.assessment.items }
        : {}),
    },
  };
  const requirements = pairRequirements(request);
  const lint = requirements.map((r) => ({
    name: r.name,
    codes: lintCriterion({ ...input.criterion, name: r.name, rubric: r.rubric }).issues.map((i) => i.code),
  }));
  const stage0 = await runPairStage0(request, options.stage0);
  const reads: PairLedgerRead[] = [];
  let calls = 0;
  if (stage0.choice)
    return {
      status: stage0.choice === 'tie' ? 'tie' : 'decided',
      choice: stage0.choice,
      calls,
      reads,
      stage0,
      lint,
    };
  const ask = async (
    r: JudgeRequest,
    order: PairLedgerRead['order'],
    reader = client,
  ): Promise<PairLedger | undefined> => {
    const effective = {
      ...r,
      dialect: reader.dialect ?? r.dialect ?? 'scratchpad-json',
      reasoning: r.reasoning ?? reader.reasoning,
    };
    const attempts: JudgeResult[] = [];
    const parseSteps: LedgerParseStep[] = [];
    const run = async (question: JudgeRequest) => {
      calls++;
      const response = await reader.judge(question);
      if (response.recovery) calls += response.recovery.attempts.length - 1;
      // Parse the recorded text ourselves too: every custom client obeys the same ledger contract.
      const parsed = parseJudgeText(response.raw, question);
      const result = { ...response, ...parsed };
      attempts.push(result);
      parseSteps.push(...(result.parseSteps ?? []));
      return result;
    };
    let result = await run(effective);
    if (result.unparsed) {
      const reask: LedgerParseStep = { ruleId: 'ledger.reask', changed: true, success: false };
      parseSteps.push(reask);
      result = await run({
        ...effective,
        budget: 'large',
        system: [
          effective.system,
          'Your previous answer broke the ledger contract. Return every requested requirement exactly once using this schema:',
          JSON.stringify(pairLedgerSchema(effective)),
        ]
          .filter(Boolean)
          .join('\n'),
      });
      parseSteps[parseSteps.indexOf(reask)] = { ...reask, success: !result.unparsed };
    }
    reads.push({ order, result, attempts, parseSteps });
    return result.pairLedger;
  };
  const first = input.candidates.A,
    second = input.candidates.B;
  const ordered = await ask(request, 'ordered');
  const swapped = await ask({ ...request, candidates: { A: second, B: first } }, 'swapped');
  const failed = (): PairLedgerResult => ({
    status: 'unparsed',
    calls,
    reads,
    stage0,
    lint,
    metadata: { graderError: true },
  });
  if (!ordered || !swapped) return failed();
  let verdict = verdictFromLedger(requirements, ordered, swapped);
  if (verdict.status === 'escalate') {
    const canonical = canonicalPairOrder(first, second);
    const ledger = await ask(
      { ...request, candidates: { A: canonical.first, B: canonical.second } },
      'canonical',
      options.escalationClient ?? client,
    );
    if (!ledger) return failed();
    verdict = verdictFromLedger(
      requirements,
      ordered,
      swapped,
      { ledger, firstIsOriginalFirst: canonical.firstIsOriginalFirst },
      options,
    );
  }
  return {
    status: verdict.status === 'tie' ? 'tie' : 'decided',
    choice: verdict.choice,
    calls,
    reads,
    stage0,
    verdict,
    lint,
  };
}

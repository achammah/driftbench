/** The benchmark engine uses only the shipped judge and statistics APIs. No benchmark prompt lives here. */
import { createHash } from 'node:crypto';
import {
  Cassette,
  type JudgeClient,
  type JudgeRequest,
  PROMPT_FINGERPRINT,
  parseJudgeText,
  playerClient,
  recordingClient,
  requestKey,
} from '@agent-nexus/driftbench-judges';
import {
  bootstrapCI,
  mcnemar,
  nonInferiority,
  wilson,
  zeroFailureBound,
} from '@agent-nexus/driftbench-stats';

export interface BenchCase {
  id: string;
  family: string;
  expected: 'pass' | 'fail';
  request: JudgeRequest;
}
export interface BenchSlice {
  name: string;
  version: number;
  /** Content hash of the immutable dataset version in the registry. */
  hash: string;
  cases: BenchCase[];
}
export interface CaseResult {
  id: string;
  family: string;
  expected: 'pass' | 'fail';
  outcome: 'pass' | 'fail' | 'inconclusive';
  correct: boolean;
}
export interface BenchReport {
  format: 'driftbench-bench-v1';
  slice: string;
  datasetVersion: number;
  datasetHash: string;
  judge: string;
  model: string;
  settings: string | null;
  fingerprint: string;
  head: string;
  startedAt: string;
  finishedAt: string;
  recordedVersions?: RecordedBenchVersions;
  n: number;
  correct: number;
  wilson: ReturnType<typeof wilson>;
  familyBootstrap: ReturnType<typeof bootstrapCI>;
  zeroFailure: { requiredCleanCases: number; independentCasesRequired: true; observedClean: boolean };
  results: CaseResult[];
}
export interface BenchFloor {
  slice: string;
  datasetVersion: number;
  datasetHash: string;
  judge: string;
  model: string;
  n: number;
  correct: number;
  wilsonLower: number;
  fingerprint: string;
  head: string;
  results: CaseResult[];
  evidenceHash: string;
}
export function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}
const TRANSPORT_UNPARSED = 'bench:transport-unparsed';
/** Keep a transport rejection that the public raw-text parser alone cannot reconstruct. */
export function recordBenchClient(client: JudgeClient, cassette: Cassette): JudgeClient {
  const recorder = recordingClient(client, cassette);
  const record = async (request: JudgeRequest) => {
    const result = await recorder.judge(request);
    if (result.unparsed && !parseJudgeText(result.raw, request).unparsed) {
      const key = requestKey(request, client);
      const entry = cassette.entries.findLast((row) => row.judge === client.id && row.key === key);
      if (!entry) throw new Error('Recorded response is missing');
      entry.note = TRANSPORT_UNPARSED;
    }
    return result;
  };
  let initialized: ReturnType<typeof record> | undefined;
  return {
    ...recorder,
    async judge(request) {
      // Let the public client settle model-specific first-call negotiation before fan-out.
      if (!initialized) {
        initialized = record(request);
        return initialized;
      }
      await initialized;
      return record(request);
    },
  };
}
export interface RecordedBenchVersions {
  decoder: NonNullable<JudgeRequest['criterionDecoderVersion']>;
  prompt: 1 | 2;
}
/** Missing version markers name the historical v1 decoder/frame, never the current defaults. */
function recordedVersions(cassette: Cassette): RecordedBenchVersions {
  const first = cassette.entries[0];
  if (!first) throw new Error('Recorded version identity needs cassette entries');
  const promptOf = (entry: Cassette['entries'][number]) => {
    const version = 'criterionPromptVersion' in entry ? entry.criterionPromptVersion : 1;
    if (version !== 1 && version !== 2) throw new Error('Unsupported recorded prompt version');
    return version;
  };
  const decoder = first.criterionDecoderVersion ?? 1;
  const prompt = promptOf(first);
  if (
    cassette.entries.some(
      (entry) => (entry.criterionDecoderVersion ?? 1) !== decoder || promptOf(entry) !== prompt,
    )
  )
    throw new Error('Mixed recorded decoder or prompt versions');
  return { decoder, prompt };
}
function recordedRequest(request: JudgeRequest, versions: RecordedBenchVersions) {
  return { ...request, criterionDecoderVersion: versions.decoder, criterionPromptVersion: versions.prompt };
}
export function playBenchClient(cassette: Cassette, judge: string, prompt?: string): JudgeClient {
  const versions = recordedVersions(cassette);
  const player = playerClient(cassette, judge, {
    answerContract: 'ledger',
    prompt,
    criterionDecoderVersion: versions.decoder,
  });
  const byKey = new Map<string, Cassette['entries']>();
  for (const entry of cassette.entries) {
    if (entry.judge === judge) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  }
  const used = new Map<string, number>();
  return {
    ...player,
    async judge(request) {
      const pinned = recordedRequest(request, versions);
      const key = requestKey(pinned, player, prompt);
      const index = used.get(key) ?? 0;
      used.set(key, index + 1);
      const result = await player.judge(pinned);
      return byKey.get(key)?.[index]?.note === TRANSPORT_UNPARSED ? { ...result, unparsed: true } : result;
    },
  };
}
export function validateSlice(slice: BenchSlice): void {
  if (
    !slice ||
    !/^[a-z0-9][a-z0-9-]*$/.test(slice.name) ||
    !Number.isInteger(slice.version) ||
    slice.version < 1 ||
    !/^[a-f0-9]{64}$/.test(slice.hash)
  )
    throw new Error('Invalid bench dataset identity');
  if (!Array.isArray(slice.cases) || !slice.cases.length) throw new Error('A slice needs cases');
  const ids = new Set<string>();
  for (const row of slice.cases) {
    if (!row.id || ids.has(row.id)) throw new Error(`Missing or duplicate case id: ${row.id}`);
    ids.add(row.id);
    if (!row.family || !['pass', 'fail'].includes(row.expected))
      throw new Error(`Invalid label or family: ${row.id}`);
    const request = row.request;
    // The floor measures the default, so data cannot opt into a different contract or prompt.
    const allowed = new Set(['criterion', 'transcript', 'inputs', 'reference', 'artifact', 'given']);
    if (!request || Object.keys(request).some((key) => !allowed.has(key)))
      throw new Error(`${row.id}: only the shipped default is allowed`);
    if (
      !request.criterion?.name ||
      !request.criterion.rubric ||
      !Array.isArray(request.transcript) ||
      request.transcript.length === 0
    )
      throw new Error(`${row.id}: invalid judge request`);
    if (
      request.transcript.some(
        (entry) =>
          !['agent', 'user', 'tool_call', 'tool_result', 'context', 'card'].includes(entry.role) ||
          typeof entry.text !== 'string',
      )
    )
      throw new Error(`${row.id}: invalid transcript`);
  }
}
export async function scoreSlice(
  slice: BenchSlice,
  client: JudgeClient,
  options: { head: string; concurrency?: number; onResult?: (index: number, result: CaseResult) => void },
): Promise<BenchReport> {
  validateSlice(slice);
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = new Array(slice.cases.length);
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error('concurrency must be 1..16');
  let next = 0;
  let failure: unknown;
  const pending = new Map<string, Promise<void>>();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, slice.cases.length) }, async () => {
      while (!failure) {
        const index = next++;
        const row = slice.cases[index];
        if (!row) break;
        const key = requestKey(row.request, client);
        const previous = pending.get(key);
        let release: () => void = () => {};
        pending.set(
          key,
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        );
        try {
          // Duplicate data still needs one call per case, in stable cassette order.
          await previous;
          if (failure) break;
          // Labels, ids and construction families never enter the model request.
          const answer = await client.judge(row.request);
          const outcome = answer.unparsed ? 'inconclusive' : answer.answer.outcome;
          const result: CaseResult = {
            id: row.id,
            family: row.family,
            expected: row.expected,
            outcome,
            correct: outcome === row.expected,
          };
          results[index] = result;
          options.onResult?.(index, result);
        } catch (cause) {
          failure = cause;
        } finally {
          release();
        }
      }
    }),
  );
  if (failure) throw failure;
  const correct = results.filter((row) => row.correct).length;
  return {
    format: 'driftbench-bench-v1',
    slice: slice.name,
    datasetVersion: slice.version,
    datasetHash: slice.hash,
    judge: client.id,
    model: client.model ?? client.id,
    settings: client.settings ?? null,
    fingerprint: PROMPT_FINGERPRINT,
    head: options.head,
    startedAt,
    finishedAt: new Date().toISOString(),
    n: results.length,
    correct,
    wilson: wilson(correct, results.length),
    familyBootstrap: bootstrapCI(
      results.map((row) => Number(row.correct)),
      { clusters: results.map((row) => row.family), seed: 1 },
    ),
    zeroFailure: {
      requiredCleanCases: zeroFailureBound(0.05),
      independentCasesRequired: true,
      observedClean: correct === results.length,
    },
    results,
  };
}
export async function replaySlice(
  slice: BenchSlice,
  cassette: Cassette,
  judge: string,
  options: { head: string; fingerprint?: string },
): Promise<BenchReport> {
  validateSlice(slice);
  const descriptor = cassette.judges.find((item) => item.id === judge);
  if (!descriptor) throw new Error(`re-record needed: no judge ${judge}`);
  const versions = recordedVersions(cassette);
  const needed = new Map<string, number>();
  for (const row of slice.cases) {
    const key = requestKey(recordedRequest(row.request, versions), descriptor, options.fingerprint);
    needed.set(key, (needed.get(key) ?? 0) + 1);
  }
  for (const entry of cassette.entries) {
    const count = needed.get(entry.key) ?? 0;
    if (entry.judge !== judge || count === 0)
      throw new Error(`re-record needed: ${slice.name}/${judge}: unexpected request occurrence`);
    needed.set(entry.key, count - 1);
  }
  if ([...needed.values()].some((count) => count !== 0))
    throw new Error(`re-record needed: ${slice.name}/${judge}: missing request occurrences`);
  try {
    const report = await scoreSlice(slice, playBenchClient(cassette, judge, options.fingerprint), options);
    return { ...report, fingerprint: options.fingerprint ?? report.fingerprint, recordedVersions: versions };
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'cassette_miss')
      throw new Error(
        `re-record needed: ${slice.name}/${judge}: data, prompt fingerprint or client settings changed`,
        { cause },
      );
    throw cause;
  }
}
function validateResults(report: Pick<BenchReport, 'n' | 'correct' | 'results'>): void {
  if (
    !Number.isInteger(report.n) ||
    report.n < 1 ||
    !Array.isArray(report.results) ||
    report.results.length !== report.n
  )
    throw new Error('Evidence has an invalid case count');
  if (new Set(report.results.map((r) => r.id)).size !== report.n)
    throw new Error('Evidence has duplicate case IDs');
  for (const row of report.results) {
    if (
      !row.id ||
      !row.family ||
      !['pass', 'fail'].includes(row.expected) ||
      !['pass', 'fail', 'inconclusive'].includes(row.outcome) ||
      row.correct !== (row.expected === row.outcome)
    )
      throw new Error('Evidence verdict does not match its label');
  }
  if (report.correct !== report.results.filter((r) => r.correct).length)
    throw new Error('Evidence score does not match its case verdicts');
}
export function validateReport(report: BenchReport): void {
  if (report.format !== 'driftbench-bench-v1' || report.fingerprint !== PROMPT_FINGERPRINT)
    throw new Error('Evidence fingerprint does not match the shipped default; re-record needed');
  if (
    !/^[a-f0-9]{40}$/.test(report.head) ||
    !/^[a-f0-9]{64}$/.test(report.datasetHash) ||
    !Number.isInteger(report.datasetVersion) ||
    report.datasetVersion < 1
  )
    throw new Error('Evidence must name a commit and dataset version');
  if (
    !report.model ||
    !report.judge ||
    !report.slice ||
    !Number.isFinite(Date.parse(report.startedAt)) ||
    !Number.isFinite(Date.parse(report.finishedAt))
  )
    throw new Error('Evidence metadata is incomplete');
  validateResults(report);
  const expected = wilson(report.correct, report.n);
  for (const key of ['lower', 'upper', 'estimate'] as const) {
    if (!Number.isFinite(report.wilson?.[key]) || Math.abs(report.wilson[key] - expected[key]) > 1e-12)
      throw new Error('Evidence Wilson interval is inconsistent');
  }
}
/** Baseline self-comparison sets the smallest half percentage point margin that passes. */
export function comparePaired(baseline: CaseResult[], candidate: CaseResult[]) {
  const byId = new Map(candidate.map((r) => [r.id, r]));
  if (baseline.length !== candidate.length || byId.size !== baseline.length)
    throw new Error('Paired evidence needs exactly the same case IDs');
  const old = baseline.map((r) => r.correct);
  const now = baseline.map((r) => {
    const c = byId.get(r.id);
    if (!c || c.expected !== r.expected || c.family !== r.family)
      throw new Error('Paired labels or families changed; use a new dataset version');
    return c.correct;
  });
  const self = nonInferiority({ baseline: old, candidate: old, margin: 0.5 });
  const margin = Math.max(0.005, (Math.floor(self.effect.upper / 0.005) + 1) * 0.005);
  if (margin >= 1) throw new Error('Too few cases for non-inferiority');
  const ni = nonInferiority({ baseline: old, candidate: now, margin, pairs: baseline.map((r) => r.id) });
  const exact = mcnemar(ni.discordant.regressed, ni.discordant.improved, { exact: true });
  const familyBootstrap = bootstrapCI(
    old.map((x, i) => Number(now[i]) - Number(x)),
    { clusters: baseline.map((r) => r.family), seed: 1 },
  );
  return {
    mcnemar: exact,
    nonInferiority: ni,
    familyBootstrap,
    regression: (ni.effect.estimate > 0 && exact.pValue < 0.05) || !ni.nonInferior,
  };
}
/** Frozen repeat inputs. Physical receipt IDs, not distinct outputs, establish separate runs. */
export interface RepeatRun {
  runId: string;
  report: BenchReport;
  cassetteText: string;
  cassetteSha256: string;
  receiptsText: string;
  receiptsSha256: string;
}
export interface RepeatEvidence {
  format: 'driftbench-bench-repeats-v1';
  old: RepeatRun[];
  candidate: RepeatRun[];
}
interface RepeatReceipt {
  id: string;
  caseId: string;
  key: string;
  provider: 'openai' | 'google' | 'anthropic';
  status: 'ok';
  httpStatus?: number;
  raw: string;
}
const verifiedRepeats = new WeakSet<object>();
export interface VerifiedRepeatEvidence {
  readonly old: readonly RepeatRun[];
  readonly candidate: readonly RepeatRun[];
  readonly versions: { old: RecordedBenchVersions; candidate: RecordedBenchVersions };
}
/** Preserve native refusal/truncation representations, but never turn failed text into a pass. */
function receiptOutcome(receipt: RepeatReceipt): {
  raw: string;
  disposition: 'complete' | 'truncated' | 'declined';
} {
  if (typeof receipt.raw !== 'string') throw new Error('Repeat receipt has no raw provider response');
  if (
    receipt.status !== 'ok' ||
    (receipt.httpStatus !== undefined &&
      (!Number.isInteger(receipt.httpStatus) || receipt.httpStatus < 200 || receipt.httpStatus >= 300))
  )
    throw new Error('Repeat receipt is not a successful physical recording');
  const value = JSON.parse(receipt.raw);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.error != null ||
    value.type === 'error'
  )
    throw new Error('Repeat provider payload is an error, not a recorded judgment');
  let text: unknown;
  let finish: unknown;
  let declined = false;
  let truncated = false;
  if (receipt.provider === 'openai') {
    const choice = value.choices?.[0];
    const content = choice?.message?.content;
    finish = choice?.finish_reason;
    declined =
      (typeof choice?.message?.refusal === 'string' && choice.message.refusal !== '') ||
      finish === 'content_filter';
    truncated = finish === 'length';
    text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
              .map((p) => p.text)
              .join('')
          : undefined;
  } else if (receipt.provider === 'google') {
    const candidate = value.candidates?.[0];
    const parts = candidate?.content?.parts;
    finish = candidate?.finishReason;
    declined =
      (typeof value.promptFeedback?.blockReason === 'string' && value.promptFeedback.blockReason !== '') ||
      finish === 'SAFETY' ||
      finish === 'RECITATION';
    truncated = finish === 'MAX_TOKENS';
    // The native Google chat recorder includes thought parts; the generic Anthropic transport does not.
    text = Array.isArray(parts)
      ? parts
          .filter((p) => p && typeof p.text === 'string')
          .map((p) => p.text)
          .join('')
      : undefined;
  } else if (receipt.provider === 'anthropic') {
    finish = value.stop_reason;
    declined = finish === 'refusal';
    truncated = finish === 'max_tokens';
    text = Array.isArray(value.content)
      ? value.content
          .filter(
            (p: { thought?: boolean; text?: unknown } | null) =>
              p && p.thought !== true && typeof p.text === 'string',
          )
          .map((p: { text: string }) => p.text)
          .join('')
      : undefined;
  } else throw new Error('Unknown repeat provider');
  if (declined) return { raw: JSON.stringify(value), disposition: 'declined' };
  if (typeof finish !== 'string' || !finish || typeof text !== 'string')
    throw new Error('Repeat provider completion state or text is missing');
  return { raw: text, disposition: truncated ? 'truncated' : 'complete' };
}
function repeatIdentity(report: BenchReport): string {
  return JSON.stringify([
    report.slice,
    report.datasetVersion,
    report.datasetHash,
    report.judge,
    report.model,
    report.settings,
    report.head,
    report.fingerprint,
  ]);
}
function sameResults(a: CaseResult[], b: CaseResult[]): boolean {
  const byId = new Map(b.map((r) => [r.id, r]));
  return (
    a.length === b.length &&
    a.every((r) => {
      const c = byId.get(r.id);
      return (
        c &&
        c.family === r.family &&
        c.expected === r.expected &&
        c.outcome === r.outcome &&
        c.correct === r.correct
      );
    })
  );
}
/** Verify every recording and receipt before any empirical allowance can affect a floor check. */
export async function verifyRepeatEvidence(
  slice: BenchSlice,
  input: RepeatEvidence,
): Promise<VerifiedRepeatEvidence> {
  validateSlice(slice);
  if (
    input?.format !== 'driftbench-bench-repeats-v1' ||
    !Array.isArray(input.old) ||
    !Array.isArray(input.candidate) ||
    input.old.length < 3 ||
    input.candidate.length < 3
  )
    throw new Error('Repeat evidence needs at least three old and candidate runs');
  // Isolate the proof from subsequent caller mutations; the private WeakSet rejects unchecked objects.
  const evidence = structuredClone(input);
  const runs = new Set<string>();
  const physical = new Set<string>();
  const versions: Partial<VerifiedRepeatEvidence['versions']> = {};
  for (const side of [evidence.old, evidence.candidate]) {
    const first = side[0];
    if (!first) throw new Error('Repeat side has no original run');
    const identity = repeatIdentity(first.report);
    let clientIdentity: string | undefined;
    for (const [repeatIndex, run] of side.entries()) {
      if (typeof run.runId !== 'string' || !run.runId || runs.has(run.runId))
        throw new Error('Duplicate or missing repeat run provenance');
      runs.add(run.runId);
      const report = run.report;
      // Historical fingerprints are allowed only on the old side and are used in replay request keys.
      if (
        !/^[a-f0-9]{12}$/.test(report.fingerprint) ||
        (side === evidence.candidate && report.fingerprint !== PROMPT_FINGERPRINT)
      )
        throw new Error('Repeat fingerprint is stale or missing');
      validateReport({ ...report, fingerprint: PROMPT_FINGERPRINT });
      if (repeatIdentity(report) !== identity) throw new Error('Repeat source or settings identities differ');
      if (
        report.slice !== slice.name ||
        report.datasetVersion !== slice.version ||
        report.datasetHash !== slice.hash
      )
        throw new Error('Repeat dataset identity differs');
      if (Date.parse(report.finishedAt) < Date.parse(report.startedAt))
        throw new Error('Repeat timestamps are reversed');
      if (sha256(run.cassetteText) !== run.cassetteSha256 || sha256(run.receiptsText) !== run.receiptsSha256)
        throw new Error('Repeat artifact hash mismatch');
      const cassette = Cassette.parse(JSON.parse(run.cassetteText));
      const descriptor = cassette.judges[0];
      if (
        cassette.judges.length !== 1 ||
        !descriptor ||
        descriptor.id !== report.judge ||
        (descriptor.model ?? descriptor.id) !== report.model ||
        (descriptor.settings ?? null) !== report.settings ||
        cassette.entries.some(
          (e) =>
            e.answer !== undefined ||
            e.result !== undefined ||
            e.error !== undefined ||
            e.answerContract !== 'ledger',
        )
      )
        throw new Error('Repeat cassette is incomplete or has different client settings');
      const version = recordedVersions(cassette);
      versions[side === evidence.old ? 'old' : 'candidate'] = version;
      const { cost: _cost, ...client } = descriptor;
      const currentClient = JSON.stringify({ client, version });
      if (clientIdentity !== undefined && clientIdentity !== currentClient)
        throw new Error('Repeat public client identities differ');
      clientIdentity = currentClient;
      const receipts = JSON.parse(run.receiptsText);
      if (
        receipts.format !== 'driftbench-bench-repeat-receipts-v1' ||
        receipts.runId !== run.runId ||
        receipts.side !== (side === evidence.old ? 'old' : 'candidate') ||
        receipts.repeat !== repeatIndex + 1 ||
        ['head', 'fingerprint', 'judge', 'model', 'settings'].some(
          (k) => receipts[k] !== report[k as keyof BenchReport],
        ) ||
        !Array.isArray(receipts.calls) ||
        receipts.calls.length !== slice.cases.length ||
        cassette.entries.length !== slice.cases.length
      )
        throw new Error('Repeat receipts are incomplete or have forged source provenance');
      for (const [i, row] of slice.cases.entries()) {
        const call = receipts.calls[i] as RepeatReceipt;
        const entry = cassette.entries[i];
        if (!entry) throw new Error('Repeat cassette is incomplete');
        const key = requestKey(recordedRequest(row.request, version), descriptor, report.fingerprint);
        if (!call || typeof call.id !== 'string' || !call.id || physical.has(call.id))
          throw new Error('Duplicate or missing physical repeat receipt');
        physical.add(call.id);
        if (
          call.caseId !== row.id ||
          call.key !== key ||
          entry.key !== key ||
          entry.judge !== report.judge ||
          typeof entry.raw !== 'string'
        )
          throw new Error('Repeat receipt occurrence mapping does not match the raw cassette');
        const outcome = receiptOutcome(call);
        if (outcome.disposition === 'declined' && outcome.raw !== entry.raw)
          throw new Error('Repeat provider refusal cannot back recorded model text');
        if (outcome.raw !== entry.raw)
          throw new Error('Repeat receipt occurrence mapping does not match the raw cassette');
        const result = report.results.find((r) => r.id === row.id);
        const marker = entry.note === TRANSPORT_UNPARSED;
        if (entry.unparsedReason !== undefined || (outcome.disposition !== 'truncated' && marker))
          throw new Error('Repeat transport marker lacks matching provider provenance');
        if (outcome.disposition !== 'complete' && (result?.outcome !== 'inconclusive' || result.correct))
          throw new Error('Repeat provider refusal or truncation cannot be scored as a successful verdict');
        if (outcome.disposition === 'truncated') {
          const parsed = parseJudgeText(entry.raw, recordedRequest(row.request, version));
          if (marker !== !parsed.unparsed)
            throw new Error('Repeat transport truncation marker disagrees with native parser semantics');
        }
      }
      const replayed = await replaySlice(slice, cassette, report.judge, {
        head: report.head,
        fingerprint: report.fingerprint,
      });
      if (
        repeatIdentity(replayed) !== repeatIdentity(report) ||
        !sameResults(report.results, replayed.results)
      )
        throw new Error('Repeat report differs from raw replay');
    }
  }
  if (!versions.old || !versions.candidate) throw new Error('Repeat version identity is missing');
  const verified = {
    old: evidence.old,
    candidate: evidence.candidate,
    versions: { old: versions.old, candidate: versions.candidate },
  };
  verifiedRepeats.add(verified);
  // Freeze nested reports too: mutations after verification must not change the accepted proof.
  function freeze(value: object) {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
    Object.freeze(value);
  }
  freeze(verified);
  return verified;
}
function correctnessFlips(baseline: CaseResult[], candidate: CaseResult[]) {
  const byId = new Map(candidate.map((r) => [r.id, r]));
  let losses = 0;
  let gains = 0;
  for (const old of baseline) {
    const now = byId.get(old.id);
    if (!now || now.family !== old.family || now.expected !== old.expected)
      throw new Error('Repeat populations differ');
    if (old.correct && !now.correct) losses++;
    if (!old.correct && now.correct) gains++;
  }
  return { losses, gains, flips: losses + gains };
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length / 2);
  const center = sorted[index];
  const previous = sorted[index - 1];
  if (center === undefined) throw new Error('Median needs repeat scores');
  if (sorted.length % 2) return center;
  if (previous === undefined) throw new Error('Median needs repeat scores');
  return (previous + center) / 2;
}
function compareRepeated(report: BenchReport, floor: BenchFloor, evidence: VerifiedRepeatEvidence) {
  if (!verifiedRepeats.has(evidence)) throw new Error('Repeat evidence must be verified before use');
  const anchor = evidence.old[0];
  if (!anchor) throw new Error('Repeat floor anchor is missing');
  if (
    anchor.report.slice !== floor.slice ||
    anchor.report.datasetVersion !== floor.datasetVersion ||
    anchor.report.datasetHash !== floor.datasetHash ||
    anchor.report.judge !== floor.judge ||
    anchor.report.model !== floor.model ||
    anchor.report.n !== floor.n
  )
    throw new Error('Old repeat anchor and floor populations differ');
  const best = evidence.candidate.reduce((a, b) => (a.report.correct >= b.report.correct ? a : b));
  if (
    repeatIdentity(report) !== repeatIdentity(best.report) ||
    !sameResults(report.results, best.report.results)
  )
    throw new Error('Selected run must match the best candidate repeat (first wins ties)');
  const oldPairs = [];
  for (const [i, first] of evidence.old.entries())
    for (const second of evidence.old.slice(i + 1))
      oldPairs.push({
        first: first.runId,
        second: second.runId,
        ...correctnessFlips(first.report.results, second.report.results),
      });
  const oldMaximumCorrectnessFlips = Math.max(...oldPairs.map((r) => r.flips));
  const candidateAgainstOriginalOld = evidence.candidate.map((run) => ({
    runId: run.runId,
    ...correctnessFlips(anchor.report.results, run.report.results),
  }));
  const medianCandidateDirectionalLosses = median(candidateAgainstOriginalOld.map((r) => r.losses));
  const scores = (runs: readonly RepeatRun[]) => {
    const values = runs.map((r) => r.report.correct);
    return {
      scores: values,
      median: median(values),
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      margin: { cases: oldMaximumCorrectnessFlips, fraction: oldMaximumCorrectnessFlips / report.n },
    };
  };
  return {
    rule: 'median candidate directional losses against original old > maximum old-pair correctness flips; equality passes',
    anchorRun: anchor.runId,
    oldSource: {
      head: anchor.report.head,
      fingerprint: anchor.report.fingerprint,
      judge: anchor.report.judge,
      model: anchor.report.model,
      settings: anchor.report.settings,
      recordedVersions: evidence.versions.old,
    },
    candidateSource: {
      head: best.report.head,
      fingerprint: best.report.fingerprint,
      judge: best.report.judge,
      model: best.report.model,
      settings: best.report.settings,
      recordedVersions: evidence.versions.candidate,
    },
    oldPairs,
    candidateAgainstOriginalOld,
    oldMaximumCorrectnessFlips,
    empiricalAllowance: oldMaximumCorrectnessFlips / report.n,
    medianCandidateDirectionalLosses,
    selectedBestRun: best.runId,
    selectedCassetteSha256: best.cassetteSha256,
    old: scores(evidence.old),
    candidate: scores(evidence.candidate),
    regression: medianCandidateDirectionalLosses > oldMaximumCorrectnessFlips,
  };
}
export function checkFloor(
  report: BenchReport,
  floor: BenchFloor | undefined,
  repeats?: VerifiedRepeatEvidence,
) {
  validateResults(report);
  const problems: string[] = [];
  if (report.fingerprint !== PROMPT_FINGERPRINT) problems.push('re-record needed: stale fingerprint');
  if (!floor)
    return { holds: false, problems: [...problems, `No floor for ${report.slice}/${report.judge}`] };
  validateResults(floor);
  if (
    floor.slice !== report.slice ||
    floor.judge !== report.judge ||
    floor.model !== report.model ||
    floor.datasetVersion !== report.datasetVersion ||
    floor.datasetHash !== report.datasetHash ||
    floor.n !== report.n
  )
    return { holds: false, problems: [...problems, 'Floor and run name different datasets or models'] };
  if (report.correct < floor.correct)
    problems.push(`${report.correct}/${report.n} is below the floor ${floor.correct}/${floor.n}`);
  if (repeats !== undefined) {
    const noiseRelative = compareRepeated(report, floor, repeats);
    if (noiseRelative.regression)
      problems.push(
        `Noise-relative paired regression: ${noiseRelative.medianCandidateDirectionalLosses} median losses exceed ${noiseRelative.oldMaximumCorrectnessFlips} old flips`,
      );
    return { holds: problems.length === 0, problems, noiseRelative };
  }
  const paired = comparePaired(floor.results, report.results);
  if (paired.regression) problems.push(`Paired regression: ${paired.nonInferiority.reason}`);
  return { holds: problems.length === 0, problems, paired };
}
/** Equal counts can update evidence at a new fingerprint, but the numeric floor never falls. */
export function raiseFloor(previous: BenchFloor | undefined, evidence: BenchReport): BenchFloor {
  validateReport(evidence);
  if (previous) {
    if (evidence.datasetVersion < previous.datasetVersion) throw new Error('Dataset versions only rise');
    if (evidence.datasetVersion === previous.datasetVersion) {
      const checked = checkFloor(evidence, previous);
      if (!checked.holds) throw new Error(checked.problems.join('; '));
      if (evidence.correct === previous.correct && evidence.fingerprint === previous.fingerprint)
        throw new Error('The floor only rises within a dataset version');
    }
  }
  return {
    slice: evidence.slice,
    datasetVersion: evidence.datasetVersion,
    datasetHash: evidence.datasetHash,
    judge: evidence.judge,
    model: evidence.model,
    n: evidence.n,
    correct: evidence.correct,
    wilsonLower: evidence.wilson.lower,
    fingerprint: evidence.fingerprint,
    head: evidence.head,
    results: structuredClone(evidence.results),
    evidenceHash: sha256(JSON.stringify(evidence)),
  };
}

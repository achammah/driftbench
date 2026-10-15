import {
  type Cassette,
  PROMPT_FINGERPRINT,
  parseJudgeText,
  requestKey,
} from '@agent-nexus/driftbench-judges';
import { wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import {
  type BenchSlice,
  checkFloor,
  type RepeatEvidence,
  type RepeatRun,
  raiseFloor,
  recordBenchClient,
  replaySlice,
  scoreSlice,
  sha256,
  verifyRepeatEvidence,
} from '../run';

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('Fixture item is missing');
  return value;
}

const slice: BenchSlice = {
  name: 'fictional-noise',
  version: 1,
  hash: 'a'.repeat(64),
  cases: Array.from({ length: 60 }, (_, i) => ({
    id: `case-${i}`,
    family: `family-${i % 3}`,
    expected: 'pass',
    request: {
      criterion: { name: 'exact', rubric: 'The reply must be yes.' },
      transcript: [{ role: 'agent', text: `yes ${i}` }],
    },
  })),
};
async function run(side: 'old' | 'candidate', repeat: number, wrong: number[]): Promise<RepeatRun> {
  const runId = `${side}-${repeat}`;
  const cassette: Cassette = { version: 1, judges: [], entries: [] };
  const client = {
    id: 'fictional',
    model: 'fictional-v1',
    settings: 'frozen',
    family: 'fictional',
    cls: 'system2' as const,
    cost: 0,
    judge: async (request: Parameters<typeof parseJudgeText>[1]) =>
      parseJudgeText(
        JSON.stringify({
          checks: [
            {
              id: 'exact',
              met: !wrong.includes(Number(request.transcript[0]?.text.split(' ')[1])),
              reasoning: 'Fictional.',
              evidence: 'yes',
            },
          ],
        }),
        request,
      ),
  };
  const report = await scoreSlice(slice, recordBenchClient(client, cassette), {
    head: (side === 'old' ? 'a' : 'b').repeat(40),
  });
  // Remove the cached answer as a real benchmark recording does before replay.
  cassette.entries = cassette.entries.map(({ answer: _answer, ...entry }) => entry);
  const cassetteText = JSON.stringify(cassette);
  const receiptsText = JSON.stringify({
    format: 'driftbench-bench-repeat-receipts-v1',
    runId,
    side,
    repeat,
    head: report.head,
    fingerprint: PROMPT_FINGERPRINT,
    judge: report.judge,
    model: report.model,
    settings: report.settings,
    calls: cassette.entries.map((entry, i) => ({
      id: `${runId}-physical-${i}`,
      caseId: slice.cases[i]?.id,
      key: entry.key,
      provider: 'openai',
      status: 'ok',
      raw: JSON.stringify({ choices: [{ message: { content: entry.raw }, finish_reason: 'stop' }] }),
    })),
  });
  return {
    runId,
    report,
    cassetteText,
    cassetteSha256: sha256(cassetteText),
    receiptsText,
    receiptsSha256: sha256(receiptsText),
  };
}
async function fixture(wrongs: number[][] = [[2, 3, 4], [2, 3], [2]]) {
  const old = await Promise.all([run('old', 1, [0, 1]), run('old', 2, [0]), run('old', 3, [1])]);
  const candidate = await Promise.all(wrongs.map((wrong, i) => run('candidate', i + 1, wrong)));
  const evidence: RepeatEvidence = { format: 'driftbench-bench-repeats-v1', old, candidate };
  const floor = raiseFloor(undefined, at(old, 0).report);
  return {
    evidence,
    floor,
    best: candidate.reduce((a, b) => (a.report.correct >= b.report.correct ? a : b)).report,
  };
}
function reseal(run: RepeatRun) {
  run.cassetteSha256 = sha256(run.cassetteText);
  run.receiptsSha256 = sha256(run.receiptsText);
}
describe('noise-relative paired floor', () => {
  it('passes equality, keeps best, and reports median, range and empirical allowance separately', async () => {
    const f = await fixture();
    const verified = await verifyRepeatEvidence(slice, f.evidence);
    const result = checkFloor(f.best, f.floor, verified);
    expect(result.holds).toBe(true);
    expect(result.noiseRelative).toMatchObject({
      oldMaximumCorrectnessFlips: 2,
      medianCandidateDirectionalLosses: 2,
      regression: false,
      selectedBestRun: 'candidate-3',
      candidate: {
        scores: [57, 58, 59],
        median: 58,
        minimum: 57,
        maximum: 59,
        margin: { cases: 2, fraction: 2 / 60 },
      },
    });
  });
  it('fails one directional loss above noise even when accuracy meets the absolute floor', async () => {
    const f = await fixture([
      [2, 3, 4],
      [2, 3, 4],
      [2, 3, 4],
    ]);
    // Lower absolute floor without changing its original paired anchor would be invalid, so use extra old errors.
    for (const r of f.evidence.old) {
      const extra = await run('old', Number(r.runId.split('-')[1]), [0, 1, 5, 6, 7]);
      Object.assign(r, extra);
    }
    f.evidence.old[1] = await run('old', 2, [0, 1, 5, 6]);
    f.evidence.old[2] = await run('old', 3, [0, 1, 5, 7]);
    f.floor = raiseFloor(undefined, at(f.evidence.old, 0).report);
    const result = checkFloor(f.best, f.floor, await verifyRepeatEvidence(slice, f.evidence));
    expect(result.holds).toBe(false);
    expect(result.noiseRelative).toMatchObject({
      oldMaximumCorrectnessFlips: 2,
      medianCandidateDirectionalLosses: 3,
      regression: true,
    });
    expect(result.problems.join(';')).toContain('Noise-relative paired regression');
  });
  it('rejects a planted always-fail worse judge despite noisy old repeats', async () => {
    const f = await fixture(Array.from({ length: 3 }, () => slice.cases.map((_, i) => i)));
    const result = checkFloor(f.best, f.floor, await verifyRepeatEvidence(slice, f.evidence));
    expect(result.holds).toBe(false);
    expect(result.noiseRelative?.regression).toBe(true);
    expect(result.problems.join(';')).toMatch(/below the floor/);
  });
  it('preserves historical checks when repeats are absent', async () => {
    const f = await fixture();
    expect(checkFloor(f.best, f.floor).paired).toBeDefined();
    expect(checkFloor(f.best, f.floor).noiseRelative).toBeUndefined();
  });
  it('never relaxes the absolute floor with repeat evidence', async () => {
    const f = await fixture([
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    const result = checkFloor(f.best, f.floor, await verifyRepeatEvidence(slice, f.evidence));
    expect(result.noiseRelative?.regression).toBe(false);
    expect(result.holds).toBe(false);
    expect(result.problems.join(';')).toMatch(/below the floor/);
  });
  it('accepts identical cassette bytes from independently attributed physical runs', async () => {
    const f = await fixture([[2], [2], [2]]);
    expect(new Set(f.evidence.candidate.map((r) => r.cassetteSha256)).size).toBe(1);
    expect(checkFloor(f.best, f.floor, await verifyRepeatEvidence(slice, f.evidence)).holds).toBe(true);
  });
  it.each(['old', 'candidate'] as const)('refuses fewer than three %s repeats', async (side) => {
    const f = await fixture();
    f.evidence[side].pop();
    await expect(verifyRepeatEvidence(slice, f.evidence)).rejects.toThrow(/three/);
  });
  it.each([
    'hash',
    'population',
    'settings',
    'source',
    'duplicate run',
    'duplicate physical',
    'forged mapping',
    'forged verdict',
    'incomplete receipts',
  ])('rejects %s evidence', async (flaw) => {
    const f = await fixture();
    const r = at(f.evidence.candidate, 1);
    const receipts = JSON.parse(r.receiptsText);
    if (flaw === 'hash') r.cassetteSha256 = '0'.repeat(64);
    if (flaw === 'population') at(r.report.results, 0).family = 'different';
    if (flaw === 'settings') r.report.settings = 'different';
    if (flaw === 'source') r.report.head = 'c'.repeat(40);
    if (flaw === 'duplicate run') r.runId = at(f.evidence.candidate, 0).runId;
    if (flaw === 'duplicate physical')
      receipts.calls[0].id = JSON.parse(at(f.evidence.candidate, 0).receiptsText).calls[0].id;
    if (flaw === 'forged mapping')
      receipts.calls[0].key = requestKey(at(slice.cases, 1).request, JSON.parse(r.cassetteText).judges[0]);
    if (flaw === 'forged verdict') {
      at(r.report.results, 0).outcome = 'fail';
      at(r.report.results, 0).correct = false;
      r.report.correct--;
      r.report.wilson = wilson(r.report.correct, r.report.n);
    }
    if (flaw === 'incomplete receipts') receipts.calls.pop();
    r.receiptsText = JSON.stringify(receipts);
    if (flaw !== 'hash') reseal(r);
    await expect(verifyRepeatEvidence(slice, f.evidence)).rejects.toThrow();
  });
  it('rejects a selected report or baseline floor unrelated to the verified repeats', async () => {
    const f = await fixture();
    const verified = await verifyRepeatEvidence(slice, f.evidence);
    expect(() => checkFloor(at(f.evidence.candidate, 0).report, f.floor, verified)).toThrow(/best/);
    expect(checkFloor(f.best, { ...f.floor, model: 'other-model' }, verified).holds).toBe(false);
    expect(() => checkFloor(f.best, f.floor, f.evidence as never)).toThrow(/verified/);
  });
  it.each(['openai', 'google', 'anthropic'] as const)(
    'binds %s provider text and rejects failed physical receipts',
    async (provider) => {
      const f = await fixture();
      for (const run of [...f.evidence.old, ...f.evidence.candidate]) {
        const receipts = JSON.parse(run.receiptsText);
        for (const call of receipts.calls) {
          const text = JSON.parse(call.raw).choices[0].message.content;
          call.provider = provider;
          call.raw = JSON.stringify(
            provider === 'openai'
              ? { choices: [{ message: { content: [{ type: 'text', text }] }, finish_reason: 'stop' }] }
              : provider === 'google'
                ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
                : {
                    content: [{ thought: true, text: 'Hidden thinking.' }, { text }],
                    stop_reason: 'end_turn',
                  },
          );
        }
        run.receiptsText = JSON.stringify(receipts);
        reseal(run);
      }
      expect(checkFloor(f.best, f.floor, await verifyRepeatEvidence(slice, f.evidence)).holds).toBe(true);
      const run = at(f.evidence.candidate, 0);
      const receipts = JSON.parse(run.receiptsText);
      receipts.calls[0].status = 'process-interrupted';
      receipts.calls[0].httpStatus = 500;
      run.receiptsText = JSON.stringify(receipts);
      reseal(run);
      await expect(verifyRepeatEvidence(slice, f.evidence)).rejects.toThrow(/successful/);
    },
  );
  it('supports a historical old fingerprint and reports even-repeat medians without rounding losses', async () => {
    const f = await fixture();
    const fingerprint = 'd'.repeat(12);
    for (const run of f.evidence.old) {
      run.report.fingerprint = fingerprint;
      const cassette = JSON.parse(run.cassetteText);
      const receipts = JSON.parse(run.receiptsText);
      receipts.fingerprint = fingerprint;
      cassette.entries.forEach((entry: { key: string }, i: number) => {
        entry.key = requestKey(at(slice.cases, i).request, cassette.judges[0], fingerprint);
        receipts.calls[i].key = entry.key;
      });
      run.cassetteText = JSON.stringify(cassette);
      run.receiptsText = JSON.stringify(receipts);
      reseal(run);
    }
    f.floor.fingerprint = fingerprint;
    f.evidence.candidate.push(await run('candidate', 4, [2, 3, 4, 5]));
    const result = checkFloor(f.best, f.floor, await verifyRepeatEvidence(slice, f.evidence));
    expect(result.noiseRelative?.candidate.median).toBe(57.5);
    expect(result.noiseRelative?.medianCandidateDirectionalLosses).toBe(2.5);
    expect(result.holds).toBe(false);
  });
  it('freezes accepted provenance and isolates it from later caller changes', async () => {
    const f = await fixture();
    const verified = await verifyRepeatEvidence(slice, f.evidence);
    at(f.evidence.candidate, 0).report.correct = 0;
    expect(Object.isFrozen(at(verified.candidate, 0).report.results)).toBe(true);
    expect(checkFloor(f.best, f.floor, verified).holds).toBe(true);
  });
  it('rejects different public client identities within the same source/settings side', async () => {
    const f = await fixture();
    const run = at(f.evidence.candidate, 1);
    const cassette = JSON.parse(run.cassetteText);
    cassette.judges[0].family = 'forged-family';
    run.cassetteText = JSON.stringify(cassette);
    reseal(run);
    await expect(verifyRepeatEvidence(slice, f.evidence)).rejects.toThrow(/client/);
  });
  it('uses a freshly measured old anchor without tying it to historical floor outcomes', async () => {
    const f = await fixture();
    const historical = await run('old', 99, [8, 9, 10]);
    historical.report.head = 'c'.repeat(40);
    f.floor = raiseFloor(undefined, historical.report);
    const result = checkFloor(f.best, f.floor, await verifyRepeatEvidence(slice, f.evidence));
    expect(result.holds).toBe(true);
    expect(result.noiseRelative).toMatchObject({
      anchorRun: 'old-1',
      oldSource: { head: 'a'.repeat(40) },
      medianCandidateDirectionalLosses: 2,
    });
    expect(result.noiseRelative?.candidateAgainstOriginalOld.map((r) => r.losses)).toEqual([3, 2, 1]);
  });
  it.each(['reordered anchor', 'candidate as old'])(
    'rejects %s without rewriting frozen provenance',
    async (flaw) => {
      const f = await fixture();
      if (flaw === 'reordered anchor')
        [f.evidence.old[0], f.evidence.old[1]] = [at(f.evidence.old, 1), at(f.evidence.old, 0)];
      else {
        const run = at(f.evidence.old, 0);
        const receipts = JSON.parse(run.receiptsText);
        receipts.side = 'candidate';
        run.receiptsText = JSON.stringify(receipts);
        reseal(run);
      }
      await expect(verifyRepeatEvidence(slice, f.evidence)).rejects.toThrow(/provenance/);
    },
  );
  it('pins recorded decoder versions in occurrence keys and raw replay without rewriting them', async () => {
    const f = await fixture();
    const run = at(f.evidence.candidate, 0);
    const cassette = JSON.parse(run.cassetteText);
    for (const [i, entry] of cassette.entries.entries()) {
      entry.criterionDecoderVersion = 2;
      entry.key = requestKey(
        { ...at(slice.cases, i).request, criterionDecoderVersion: 2 },
        cassette.judges[0],
      );
    }
    const keys = cassette.entries.map((entry: { key: string }) => entry.key);
    const replayed = await replaySlice(slice, cassette, run.report.judge, { head: run.report.head });
    expect(replayed.results).toEqual(run.report.results);
    expect(cassette.entries.map((entry: { key: string }) => entry.key)).toEqual(keys);
  });
  it.each([
    ['openai', 'error'],
    ['openai', 'refusal'],
    ['openai', 'content_filter'],
    ['openai', 'length'],
    ['google', 'error'],
    ['google', 'blockReason'],
    ['google', 'SAFETY'],
    ['google', 'RECITATION'],
    ['google', 'MAX_TOKENS'],
    ['anthropic', 'error'],
    ['anthropic', 'refusal'],
    ['anthropic', 'max_tokens'],
  ])('rejects %s provider %s despite matching model text and resealed hashes', async (provider, failure) => {
    const f = await fixture();
    const run = at(f.evidence.candidate, 0);
    const receipts = JSON.parse(run.receiptsText);
    const call = receipts.calls[0];
    const text = JSON.parse(call.raw).choices[0].message.content;
    const value =
      provider === 'openai'
        ? { choices: [{ message: { content: text }, finish_reason: 'stop' }] }
        : provider === 'google'
          ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
          : { content: [{ text }], stop_reason: 'end_turn' };
    const body = value as unknown as {
      error?: { message: string };
      choices: Array<{ message: { content: string; refusal?: string }; finish_reason?: string }>;
      candidates: Array<{ finishReason?: string }>;
      promptFeedback?: { blockReason: string };
      stop_reason?: string;
    };
    if (failure === 'error') body.error = { message: 'Fictional provider failure' };
    else if (provider === 'openai' && failure === 'refusal')
      at(body.choices, 0).message.refusal = 'Fictional refusal';
    else if (provider === 'openai') at(body.choices, 0).finish_reason = failure;
    else if (provider === 'google' && failure === 'blockReason')
      body.promptFeedback = { blockReason: 'SAFETY' };
    else if (provider === 'google') at(body.candidates, 0).finishReason = failure;
    else body.stop_reason = failure;
    call.provider = provider;
    call.raw = JSON.stringify(body);
    run.receiptsText = JSON.stringify(receipts);
    reseal(run);
    await expect(verifyRepeatEvidence(slice, f.evidence)).rejects.toThrow(/provider|successful/);
  });
  it('rejects a forged transport-unparsed cassette marker on successful provider text', async () => {
    const f = await fixture();
    const run = at(f.evidence.candidate, 0);
    const cassette = JSON.parse(run.cassetteText);
    cassette.entries[0].note = 'bench:transport-unparsed';
    run.cassetteText = JSON.stringify(cassette);
    reseal(run);
    const result = at(run.report.results, 0);
    result.outcome = 'inconclusive';
    result.correct = false;
    run.report.correct--;
    run.report.wilson = wilson(run.report.correct, run.report.n);
    await expect(verifyRepeatEvidence(slice, f.evidence)).rejects.toThrow(/incomplete|transport/);
  });
});

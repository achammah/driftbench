import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateSpec } from '@agent-nexus/driftbench-core';
import {
  type Cassette,
  type JudgeClient,
  parseJudgeText,
  playerClient,
  recordingClient,
  requestKey,
} from '@agent-nexus/driftbench-judges';
import { openMemoryStore, readTree } from '@agent-nexus/driftbench-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../cli';
import { makeRecordingClient, SpendBudget } from '../record';
import { type BenchReport, type BenchSlice, scoreSlice, sha256 } from '../run';

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('Fixture item is missing');
  return value;
}

const roots: string[] = [];
const MODEL = 'gpt-6-luna';
const SLICE = 'fictional-integrity';
type Evidence = {
  format: 'driftbench-bench-record-v1';
  report: BenchReport;
  cassetteSha256: string;
  resolvedModels: string[];
  costUsd: number;
  chargedUsd: number;
  calls: number;
  spend: [];
};
type Fixture = {
  root: string;
  cassettePath: string;
  evidencePath: string;
  floorsPath: string;
  cassette: Cassette;
  evidence: Evidence;
  slice: BenchSlice;
  descriptor: JudgeClient;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function jsonWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text);
  return text;
}

async function fixture(): Promise<Fixture> {
  vi.stubEnv('OPENAI_API_KEY', 'fictional-unused-key');
  for (const key of ['OPENAI_BASE_URL', 'OPENAI_JUDGE_MODEL', 'CLAUDE_JUDGE_MODEL'])
    vi.stubEnv(key, undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('This integrity fixture must never make a network call');
    }),
  );
  const root = await mkdtemp(join(tmpdir(), 'driftbench-bench-integrity-'));
  roots.push(root);
  execFileSync('git', ['init', root], { encoding: 'utf8', stdio: 'pipe' });
  const hooks = join(root, '.empty-hooks');
  await mkdir(hooks);
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fictional Test',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${hooks}`,
      'commit',
      '--allow-empty',
      '-m',
      'Fictional benchmark fixture',
    ],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' },
  );
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const cases: BenchSlice['cases'] = Array.from({ length: 6 }, (_, i) => {
    const group = i % 3;
    return {
      id: `fictional-${i}`,
      family: `family-${group}`,
      expected: group === 1 ? 'fail' : 'pass',
      request: {
        criterion: { name: 'exact', rubric: 'The reply must be exactly yes.' },
        transcript: [
          { role: 'user', text: `Fictional card ${group}: reply yes.` },
          { role: 'agent', text: group === 1 ? 'no' : 'yes' },
        ],
      },
    };
  });
  const spec = {
    id: SLICE,
    version: '1',
    kind: 'conversation',
    blocks: [{ user: 'Fictional integrity cases live in metadata.bench.' }],
    metadata: { bench: cases },
  };
  expect(validateSpec(spec).ok).toBe(true);
  const datasetPath = `benchmarks/slices/${SLICE}/1`;
  await jsonWrite(join(root, datasetPath, 'cases.spec.json'), spec);
  const tree = await readTree(join(root, datasetPath));
  const store = openMemoryStore();
  let hash: string;
  try {
    const pushed = await store.pushVersion('dataset', SLICE, tree.files);
    expect(pushed.version.version).toBe(1);
    hash = pushed.version.hash;
  } finally {
    store.close();
  }
  const slice: BenchSlice = { name: SLICE, version: 1, hash, cases };
  await jsonWrite(join(root, 'benchmarks/manifest.json'), {
    version: 1,
    models: [{ id: MODEL, model: MODEL, status: 'active' }],
    slices: [{ name: SLICE, version: 1, hash, n: cases.length, path: datasetPath, sourceCommit: head }],
  });
  const descriptor = makeRecordingClient(
    MODEL,
    new SpendBudget(1),
    { OPENAI_API_KEY: 'fictional-unused-key' },
    () => {},
  );
  const fake: JudgeClient = {
    ...descriptor,
    judge: vi.fn(async (request) => {
      const answer = request.transcript.at(-1)?.text;
      return parseJudgeText(
        JSON.stringify({
          checks: [
            { id: 'exact', reasoning: 'Literal fictional answer.', evidence: answer, met: answer === 'yes' },
          ],
        }),
        request,
      );
    }),
  };
  const cassette: Cassette = { version: 1, judges: [], entries: [] };
  const report = await scoreSlice(slice, recordingClient(fake, cassette), { head });
  expect(report.correct).toBe(cases.length);
  expect(fake.judge).toHaveBeenCalledTimes(cases.length);
  expect(vi.mocked(fetch).mock.calls.length).toBe(0);
  cassette.entries = cassette.entries.map(({ answer: _answer, ...entry }) => entry);
  const cassettePath = join(root, `benchmarks/cassettes/${SLICE}@1/${MODEL}.json`);
  const evidencePath = join(root, `benchmarks/evidence/${SLICE}@1/${MODEL}.json`);
  const floorsPath = join(root, 'benchmarks/floors.json');
  const raw = await jsonWrite(cassettePath, cassette);
  const evidence: Evidence = {
    format: 'driftbench-bench-record-v1',
    report,
    cassetteSha256: sha256(raw),
    resolvedModels: [MODEL],
    costUsd: 0,
    chargedUsd: 0,
    calls: cases.length,
    spend: [],
  };
  await jsonWrite(evidencePath, evidence);
  await jsonWrite(floorsPath, { version: 1, floors: {}, history: [] });
  return { root, cassettePath, evidencePath, floorsPath, cassette, evidence, slice, descriptor };
}

async function cli(f: Fixture, args: string[]) {
  let out = '';
  let err = '';
  const code = await main([...args, '--root', f.root], {
    cwd: f.root,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  expect(vi.mocked(fetch).mock.calls.length).toBe(0);
  return { code, out, err };
}

async function resaveCassette(f: Fixture) {
  f.evidence.cassetteSha256 = sha256(await jsonWrite(f.cassettePath, f.cassette));
  await jsonWrite(f.evidencePath, f.evidence);
}

async function raise(f: Fixture, evidence = f.evidencePath) {
  return cli(f, ['floors', '--raise', SLICE, MODEL, '--evidence', evidence, '--json']);
}

async function partialFixture(
  f: Fixture,
  options: { spend: unknown; entries: number; inconclusive?: boolean; keepFinal?: boolean },
) {
  const partialCassette = structuredClone(f.cassette);
  partialCassette.entries = partialCassette.entries.slice(0, options.entries);
  const results = structuredClone(f.evidence.report.results.slice(0, options.entries));
  if (options.inconclusive) {
    for (const result of results) {
      result.outcome = 'inconclusive';
      result.correct = false;
    }
  }
  await jsonWrite(`${f.cassettePath}.partial.json`, partialCassette);
  await jsonWrite(`${f.evidencePath}.partial.json`, {
    format: 'driftbench-bench-partial-v1',
    datasetHash: f.slice.hash,
    fingerprint: f.evidence.report.fingerprint,
    model: MODEL,
    spend: options.spend,
    results,
  });
  if (!options.keepFinal) {
    await rm(f.cassettePath);
    await rm(f.evidencePath);
  }
}

async function resume(f: Fixture) {
  return cli(f, ['record', '--slice', SLICE, '--model', MODEL, '--spend-cap-usd', '1', '--resume', '--json']);
}

async function repeatManifest(f: Fixture) {
  const raw = await readFile(f.cassettePath, 'utf8');
  const group = { slice: SLICE, judge: MODEL, old: [] as unknown[], candidate: [] as unknown[] };
  for (const side of ['old', 'candidate'] as const)
    for (let repeat = 1; repeat <= 3; repeat++) {
      const runId = `${side}-${repeat}`;
      const receipts = {
        format: 'driftbench-bench-repeat-receipts-v1',
        runId,
        side,
        repeat,
        ...Object.fromEntries(
          ['head', 'fingerprint', 'judge', 'model', 'settings'].map((k) => [
            k,
            f.evidence.report[k as keyof BenchReport],
          ]),
        ),
        calls: f.cassette.entries.map((entry, i) => ({
          id: `${runId}-physical-${i}`,
          caseId: at(f.slice.cases, i).id,
          key: entry.key,
          provider: 'openai',
          status: 'ok',
          raw: JSON.stringify({ choices: [{ message: { content: entry.raw }, finish_reason: 'stop' }] }),
        })),
      };
      const receiptsPath = `repeat-${runId}.json`;
      const text = await jsonWrite(join(f.root, receiptsPath), receipts);
      group[side].push({
        runId,
        report: f.evidence.report,
        cassettePath: `benchmarks/cassettes/${SLICE}@1/${MODEL}.json`,
        cassetteSha256: sha256(raw),
        receiptsPath,
        receiptsSha256: sha256(text),
      });
    }
  const path = join(f.root, 'repeats.json');
  await jsonWrite(path, { format: 'driftbench-bench-repeat-files-v1', groups: [group] });
  return path;
}

describe('bench CLI recording integrity', () => {
  it('validates the entire default manifest while selecting a subset, including unselected corruption', async () => {
    const f = await fixture();
    expect(await raise(f)).toMatchObject({ code: 0 });
    const path = await repeatManifest(f);
    const input = JSON.parse(await readFile(path, 'utf8'));
    const extra = structuredClone(input.groups[0]);
    extra.slice = 'fictional-extra';
    const spec = await readFile(join(f.root, `benchmarks/slices/${SLICE}/1/cases.spec.json`), 'utf8');
    const folder = 'benchmarks/slices/fictional-extra/1';
    await mkdir(join(f.root, folder), { recursive: true });
    await writeFile(join(f.root, folder, 'cases.spec.json'), spec);
    const manifestPath = join(f.root, 'benchmarks/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.slices.push({ ...manifest.slices[0], name: extra.slice, path: folder });
    await jsonWrite(manifestPath, manifest);
    for (const run of [...extra.old, ...extra.candidate]) {
      const receipts = JSON.parse(await readFile(join(f.root, run.receiptsPath), 'utf8'));
      run.runId = `extra-${run.runId}`;
      run.report.slice = extra.slice;
      receipts.runId = run.runId;
      for (const call of receipts.calls) call.id = `extra-${call.id}`;
      run.receiptsPath = `repeat-${run.runId}.json`;
      run.receiptsSha256 = sha256(await jsonWrite(join(f.root, run.receiptsPath), receipts));
    }
    input.groups.push(extra);
    for (const group of input.groups)
      for (const run of [...group.old, ...group.candidate]) {
        run.cassettePath = `../../${run.cassettePath}`;
        run.receiptsPath = `../../${run.receiptsPath}`;
      }
    const defaultFile = join(f.root, 'benchmarks/repeats/manifest.json');
    await jsonWrite(defaultFile, input);
    const selected = await cli(f, ['replay', '--slice', SLICE, '--check-floor', '--json']);
    expect(selected.code).toBe(0);
    expect(JSON.parse(selected.out).checks).toHaveLength(1);
    input.groups[1].candidate[0].receiptsSha256 = '0'.repeat(64);
    await jsonWrite(defaultFile, input);
    const corrupt = await cli(f, ['replay', '--slice', SLICE, '--check-floor', '--json']);
    expect(corrupt.code).not.toBe(0);
    expect(`${corrupt.err}${corrupt.out}`).toMatch(/hash/);
  });
  it('automatically uses the frozen default manifest only for floor checks', async () => {
    const f = await fixture();
    expect(await raise(f)).toMatchObject({ code: 0 });
    const path = await repeatManifest(f);
    const destination = join(f.root, 'benchmarks/repeats/manifest.json');
    const input = JSON.parse(await readFile(path, 'utf8'));
    for (const run of [...input.groups[0].old, ...input.groups[0].candidate]) {
      run.cassettePath = `../../${run.cassettePath}`;
      run.receiptsPath = `../../${run.receiptsPath}`;
    }
    await jsonWrite(destination, input);
    const checked = await cli(f, ['replay', '--check-floor', '--json']);
    expect(checked.code).toBe(0);
    expect(JSON.parse(checked.out).checks[0].noiseRelative.selectedBestRun).toBe('candidate-1');
    await jsonWrite(destination, { format: 'invalid' });
    expect((await cli(f, ['replay', '--check-floor', '--json'])).code).not.toBe(0);
    expect((await cli(f, ['replay', '--json'])).code).toBe(0);
    expect((await cli(f, ['replay', '--check-floor', '--repeat-evidence', path, '--json'])).code).toBe(0);
  });
  it('checks attributable repeat files offline and exposes best and median in JSON and text', async () => {
    const f = await fixture();
    expect(await raise(f)).toMatchObject({ code: 0, err: '' });
    const path = await repeatManifest(f);
    const result = await cli(f, ['replay', '--check-floor', '--repeat-evidence', path, '--json']);
    expect(result).toMatchObject({ code: 0, err: '' });
    expect(JSON.parse(result.out).checks[0].noiseRelative).toMatchObject({
      selectedBestRun: 'candidate-1',
      oldMaximumCorrectnessFlips: 0,
      candidate: { median: 6, minimum: 6, maximum: 6 },
    });
    const text = await cli(f, ['replay', '--check-floor', '--repeat-evidence', path]);
    expect(text.code).toBe(0);
    expect(text.out).toMatch(/empirical allowance.*median.*range.*best/i);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('rejects invalid repeat input without falling back to historical checks', async () => {
    const f = await fixture();
    expect(await raise(f)).toMatchObject({ code: 0 });
    const path = await repeatManifest(f);
    const input = JSON.parse(await readFile(path, 'utf8'));
    input.groups[0].old.pop();
    await jsonWrite(path, input);
    const result = await cli(f, ['replay', '--check-floor', '--repeat-evidence', path, '--json']);
    expect(result.code).not.toBe(0);
    expect(`${result.out}${result.err}`).toMatch(/three/);
    expect(await cli(f, ['replay', '--repeat-evidence', path])).toMatchObject({ code: 2 });
  });
  it('accepts a complete offline recording and registers its floor through the CLI', async () => {
    const f = await fixture();
    expect(await cli(f, ['replay', '--slice', 'all', '--json'])).toMatchObject({ code: 0, err: '' });
    expect(await raise(f)).toMatchObject({ code: 0, err: '' });
    const replay = await cli(f, ['replay', '--slice', 'all', '--check-floor', '--json']);
    expect(replay).toMatchObject({ code: 0, err: '' });
    expect(JSON.parse(replay.out).checks[0].holds).toBe(true);
  });

  it('refuses a raise from a different dataset version even when hash and results match', async () => {
    const f = await fixture();
    const before = await readFile(f.floorsPath, 'utf8');
    const foreign = structuredClone(f.evidence.report);
    foreign.datasetVersion = 2;
    const path = join(f.root, 'foreign-version.json');
    await jsonWrite(path, foreign);
    const result = await raise(f, path);
    expect(result.code).not.toBe(0);
    expect(result.err).toMatch(/dataset|version|differs/i);
    expect(await readFile(f.floorsPath, 'utf8')).toBe(before);
  });

  it('refuses missing request occurrences padded with another valid entry to the same length', async () => {
    const f = await fixture();
    const padded = f.cassette.entries[1];
    if (!padded) throw new Error('Fixture has no padding entry');
    f.cassette.entries[3] = structuredClone(padded);
    expect(f.cassette.entries).toHaveLength(f.slice.cases.length);
    await resaveCassette(f);
    const result = await cli(f, ['replay', '--slice', 'all', '--json']);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.out).problems.join('\n')).toMatch(/re-record needed|occurrence|incomplete/i);
  });

  it.each(['cassette bytes', 'evidence hash'])('refuses tampered %s', async (target) => {
    const f = await fixture();
    if (target === 'cassette bytes') {
      await writeFile(f.cassettePath, `${await readFile(f.cassettePath, 'utf8')}\n`);
    } else {
      f.evidence.cassetteSha256 = '0'.repeat(64);
      await jsonWrite(f.evidencePath, f.evidence);
    }
    const result = await cli(f, ['replay', '--slice', 'all', '--json']);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.out).problems.join('\n')).toMatch(/integrity|hash/i);
  });

  it('refuses a caller-supplied record envelope with a forged cassette hash before raising', async () => {
    const f = await fixture();
    const before = await readFile(f.floorsPath, 'utf8');
    const tampered = structuredClone(f.evidence);
    tampered.cassetteSha256 = '0'.repeat(64);
    const path = join(f.root, 'forged-record-evidence.json');
    await jsonWrite(path, tampered);
    const result = await raise(f, path);
    expect(result.code).not.toBe(0);
    expect(result.err).toMatch(/integrity|hash|evidence/i);
    expect(await readFile(f.floorsPath, 'utf8')).toBe(before);
  });

  it('refuses stale settings even when cassette keys and recorded evidence agree with each other', async () => {
    const f = await fixture();
    const judge = f.cassette.judges[0];
    if (!judge) throw new Error('Fixture has no judge');
    judge.settings = 'fictional-stale-client-settings';
    f.evidence.report.settings = judge.settings;
    f.cassette.entries.forEach((entry, index) => {
      const row = f.slice.cases[index];
      if (!row) throw new Error('Fixture has no case for the entry');
      entry.key = requestKey(row.request, judge);
    });
    await resaveCassette(f);
    const result = await cli(f, ['replay', '--slice', 'all', '--json']);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.out).problems.join('\n')).toMatch(/client settings|re-record needed/i);
  });

  it('refuses a prior fingerprint even when its cassette hash is valid', async () => {
    const f = await fixture();
    f.evidence.report.fingerprint = 'fictional-prior-fingerprint';
    f.cassette.entries.forEach((entry, index) => {
      const row = f.slice.cases[index];
      if (!row) throw new Error('Fixture has no case for the entry');
      entry.key = requestKey(row.request, f.descriptor, f.evidence.report.fingerprint);
    });
    await resaveCassette(f);
    const result = await cli(f, ['replay', '--slice', 'all', '--json']);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.out).problems.join('\n')).toMatch(/fingerprint|re-record needed/i);
  });

  it('fails --check-floor when a valid recording has no floor', async () => {
    const f = await fixture();
    const replay = await cli(f, ['replay', '--slice', 'all', '--check-floor', '--json']);
    expect(replay.code).not.toBe(0);
    expect(JSON.parse(replay.out).problems.join('\n')).toMatch(/no floor/i);
  });

  it('refuses an existing directory as the spend ledger before any fetch', async () => {
    const f = await fixture();
    const ledger = join(f.root, 'fictional-ledger-directory');
    await mkdir(ledger);
    const result = await cli(f, [
      'record',
      '--slice',
      SLICE,
      '--model',
      MODEL,
      '--spend-cap-usd',
      '1',
      '--spend-ledger',
      ledger,
      '--json',
    ]);
    expect(result.code).not.toBe(0);
    expect(result.err).toMatch(/ledger|directory|EISDIR/i);
  });

  it('refuses null partial spend before requesting the missing recordings', async () => {
    const f = await fixture();
    await partialFixture(f, { spend: null, entries: 1 });
    const result = await resume(f);
    expect(result.code).not.toBe(0);
    expect(result.err).toMatch(/spend|partial/i);
    await expect(readFile(f.cassettePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses partial inconclusive provenance that would replay as pass instead of publishing it', async () => {
    const f = await fixture();
    await partialFixture(f, { spend: [], entries: f.slice.cases.length, inconclusive: true });
    const result = await resume(f);
    expect(result.code).not.toBe(0);
    expect(result.err).toMatch(/partial|provenance|inconclusive|differ/i);
    await expect(readFile(f.cassettePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(f.evidencePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resumes a complete matching partial recording without fetching again', async () => {
    const f = await fixture();
    await partialFixture(f, { spend: [], entries: f.slice.cases.length });
    expect(await resume(f)).toMatchObject({ code: 0, err: '' });
    const replay = await cli(f, ['replay', '--slice', 'all', '--json']);
    expect(replay).toMatchObject({ code: 0, err: '' });
    expect(JSON.parse(replay.out).reports[0].correct).toBe(f.slice.cases.length);
  });

  it('prefers a newer matching partial over the existing completed recording on resume', async () => {
    const f = await fixture();
    const entry = f.cassette.entries[0];
    const result = f.evidence.report.results[0];
    if (!entry?.raw || !result) throw new Error('Fixture has no first response');
    const raw = JSON.parse(entry.raw);
    raw.checks[0].met = false;
    entry.raw = JSON.stringify(raw);
    result.outcome = 'fail';
    result.correct = false;
    await partialFixture(f, { spend: [], entries: f.slice.cases.length, keepFinal: true });
    expect(JSON.parse(await readFile(f.evidencePath, 'utf8')).report.correct).toBe(6);
    const resumed = await resume(f);
    expect(resumed).toMatchObject({ code: 0, err: '' });
    expect(JSON.parse(resumed.out).records[0].report.correct).toBe(5);
    expect(JSON.parse(await readFile(f.evidencePath, 'utf8')).report.correct).toBe(5);
    await expect(readFile(`${f.cassettePath}.partial.json`, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(`${f.evidencePath}.partial.json`, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('checks the floor before reusing a completed recording on resume', async () => {
    const f = await fixture();
    expect(await raise(f)).toMatchObject({ code: 0, err: '' });
    const floorBefore = await readFile(f.floorsPath, 'utf8');
    const entry = f.cassette.entries[0];
    if (!entry?.raw) throw new Error('Fixture has no first response');
    const raw = JSON.parse(entry.raw);
    raw.checks[0].met = false;
    entry.raw = JSON.stringify(raw);
    f.evidence.report = await scoreSlice(
      f.slice,
      playerClient(f.cassette, MODEL, { answerContract: 'ledger' }),
      {
        head: f.evidence.report.head,
      },
    );
    expect(f.evidence.report.correct).toBe(5);
    await resaveCassette(f);
    const resumed = await resume(f);
    expect(resumed.code).not.toBe(0);
    expect(resumed.err).toMatch(/floor|regress/i);
    expect(await readFile(f.floorsPath, 'utf8')).toBe(floorBefore);
  });
});

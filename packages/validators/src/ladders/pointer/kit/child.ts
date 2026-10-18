import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSut } from '../sut/adapter';
import type { ModelArm, ScanRequest, SourceFile } from '../sut/port';
import { constant, perfect } from './labellers';
import { runScaleOp, type ScaleOp } from './scale';
import { type FakeOptions, fakeTransport } from './transport';

/**
 * A child process for the bank: runs one job against the system under test with its own HOME, TMPDIR and working
 * folder, and prints one JSON line. Used where the environment matters (time zone, locale, folder, secrets) and
 * where a crash, a hang or a leak must not reach the validator. Labellers and transports cannot cross a process
 * boundary, so a job names them: `perfect`, `none`, or a model arm over the fake transport.
 */
export type Job =
  | { kind: 'cut'; file: SourceFile }
  | ({ kind: 'scale' } & ScaleOp)
  | {
      kind: 'scan';
      files: SourceFile[];
      previousLedger?: string;
      labelsYaml?: string;
      labeler?: 'perfect' | 'none';
      model?: { arm: ModelArm; threshold?: number };
      cassette?: { mode: 'record' | 'replay'; text?: string };
      /** Options of the fake transport; `echoHeaders` and `extraText` add text to every response, `throwWithRequest` makes the second call throw an error that holds the request. */
      fake?: FakeOptions & {
        echoHeaders?: boolean;
        extraText?: string;
        throwWithRequest?: boolean;
        badAnswers?: boolean;
      };
      check?: boolean;
      location?: { parent: string; name: string };
    };

export type JobOutput =
  | { ok: true; result: unknown; fakeCalls?: number; requests?: string[] }
  | { ok: false; error: string };

async function run(job: Job): Promise<JobOutput> {
  const sut = await resolveSut();
  if (job.kind === 'cut') return { ok: true, result: await sut.cut(job.file) };
  if (job.kind === 'scale') return { ok: true, result: await runScaleOp(job, sut) };
  const f = job.fake ?? {};
  const transport = job.model
    ? fakeTransport({
        ...f,
        respond: (index, call, base) => {
          if (f.throwWithRequest && index === 1) throw new Error(`transport failed for request ${call.body}`);
          if (f.badAnswers)
            return {
              status: 200,
              body: JSON.stringify({
                model: 'm',
                content: [{ type: 'text', text: 'not json' }],
                stop_reason: 'end_turn',
                usage: {},
                answers: {},
              }),
            };
          if (f.echoHeaders || f.extraText) {
            const b = JSON.parse(base.body) as Record<string, unknown>;
            if (f.echoHeaders) b.echo = call.headers;
            if (f.extraText) {
              b.summary = f.extraText;
              if (Array.isArray(b.content)) b.content = [...b.content, { type: 'text', text: f.extraText }];
            }
            return { status: base.status, body: JSON.stringify(b) };
          }
          return undefined;
        },
      })
    : undefined;
  const request: ScanRequest = {
    files: job.files,
    ...(job.previousLedger !== undefined ? { previousLedger: job.previousLedger } : {}),
    ...(job.labelsYaml !== undefined ? { labelsYaml: job.labelsYaml } : {}),
    ...(job.labeler ? { labeler: job.labeler === 'perfect' ? perfect() : constant('none') } : {}),
    ...(job.model && transport ? { model: { ...job.model, transport } } : {}),
    ...(job.cassette ? { cassette: job.cassette } : {}),
    ...(job.check ? { check: true } : {}),
    ...(job.location ? { location: job.location } : {}),
  };
  const result = await sut.scan(request);
  return {
    ok: true,
    result,
    ...(transport ? { fakeCalls: transport.count, requests: transport.calls.map((c) => c.body) } : {}),
  };
}

/** Entry point when this file is the process: read the job from the file named by argv[2], print the output. */
export async function main(): Promise<void> {
  const job = JSON.parse(readFileSync(process.argv[2] as string, 'utf8')) as Job;
  const out = process.argv[3] as string;
  let output: JobOutput;
  try {
    output = await run(job);
  } catch (cause) {
    output = { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
  writeFileSync(out, JSON.stringify(output));
}

export { join, mkdirSync, mkdtempSync, rmSync, tmpdir, writeFileSync };

if (process.argv[1] && /kit[\\/]child\.[mc]?[tj]s$/.test(process.argv[1])) {
  main().then(
    () => process.exit(0),
    (cause) => {
      process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      process.exit(1);
    },
  );
}

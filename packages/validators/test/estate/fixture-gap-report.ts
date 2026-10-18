/** Exhaustive generation and recorded-trace diagnostics on the fictional fixture only. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Observed } from '@agent-nexus/driftbench-core';
import { parse } from 'yaml';
import { fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';
import { checkAsk, checkTrace } from '../../src/ladders/estate/bank/task-check';
import { observeOnFake } from '../../src/ladders/estate/bank/task-trace';
import { envOfSuite, judgeSpecs, TASK_TYPES } from '../../src/ladders/estate/bank/taskv2';

const output = resolve(process.argv[2] ?? '/tmp/astra-askwords-fixture-gaps.json');
const scratch = resolve(process.argv[3] ?? '/tmp/astra-askwords-fixture-gap-work');
const staticOnly = process.argv.includes('--static-only');
await mkdir(scratch, { recursive: true });
process.env.TMPDIR = scratch;
const suite = await fixtureSuite();
const env = await envOfSuite(suite);
const report = JSON.parse(await readFile(join(suite.work, 'suite/estate-generate-report.json'), 'utf8'));
const plan = parse(await readFile(join(suite.work, 'plan.yaml'), 'utf8')) as {
  rows: Array<{ id: string; atomIds: string[]; testType: string; mode: string }>;
};
const rows = new Map(plan.rows.map((row) => [row.id, row]));
const incomplete = (report.incomplete ?? []).map(
  (entry: { spec: string; row: string; path: string; reasons: unknown[] }) => ({
    ...entry,
    testType: rows.get(entry.row)?.testType ?? null,
    mode: rows.get(entry.row)?.mode ?? null,
  }),
);
const staticAsks = suite.specs
  .filter((spec) => (TASK_TYPES as readonly string[]).includes(spec.testType))
  .map((spec) => {
    const meta = spec.spec.metadata?.estate as { planRow?: string; row?: string } | undefined;
    const verdict = checkAsk(spec, env);
    return {
      spec: spec.id,
      row: meta?.planRow ?? meta?.row ?? null,
      testType: spec.testType,
      mode: spec.mode,
      complete: spec.complete,
      reasons: verdict.reasons,
      traceRequired: verdict.trace !== undefined,
    };
  });
const unitGaps = (report.unit?.skipped ?? []).map((reason: string) => ({
  spec: reason.slice(0, reason.indexOf(': ')),
  reason,
  // Generator diagnostics prefix the generated unit id. Match IDs, never English wording.
  rows: plan.rows
    .filter((row) => row.atomIds.some((id) => reason.startsWith(`unit.${row.testType}.${id}: `)))
    .map((row) => ({ row: row.id, testType: row.testType, atoms: row.atomIds })),
}));
const ready = suite.specs.filter(
  (spec) =>
    spec.complete &&
    (TASK_TYPES as readonly string[]).includes(spec.testType) &&
    checkAsk(spec, env).reasons.length === 0,
);
const needs = new Map(ready.map((spec) => [spec.id, checkAsk(spec, env).trace]));
const observed = new Map<string, Observed>();
let traceResults: Array<{ id: string; testType: string; reasons: string[] }>;
let traceExecutionError: string | undefined;
try {
  traceResults = staticOnly
    ? []
    : await judgeSpecs(ready, env, async (paths) => {
        for (let offset = 0; offset < paths.length; offset += 20) {
          const batch = await observeOnFake(paths.slice(offset, offset + 20));
          for (const [id, trace] of batch) observed.set(id, trace);
          const completed = ready.slice(0, Math.min(offset + 20, paths.length)).map((spec) => {
            const need = checkAsk(spec, env).trace;
            return {
              id: spec.id,
              reason: need
                ? (checkTrace(need, observed.get(spec.id)) ?? null)
                : 'no static trace requirement',
            };
          });
          await writeFile(
            `${output}.partial`,
            `${JSON.stringify(
              {
                complete: false,
                population: staticAsks.length,
                staticFailures: staticAsks.filter((entry) => entry.reasons.length > 0),
                completed,
                remaining: paths.length - completed.length,
              },
              null,
              2,
            )}\n`,
          );
          console.log(
            JSON.stringify({
              traced: completed.length,
              total: paths.length,
              passed: completed.filter((entry) => entry.reason === null).length,
            }),
          );
        }
        return observed;
      });
} catch (error) {
  traceExecutionError = error instanceof Error ? error.message : String(error);
  traceResults = ready.map((spec) => ({
    id: spec.id,
    testType: spec.testType,
    reasons: [`trace execution failed: ${traceExecutionError}`],
  }));
}
const traced = traceResults.map((entry) => ({
  spec: entry.id,
  row: staticAsks.find((ask) => ask.spec === entry.id)?.row ?? null,
  testType: entry.testType,
  reasons: entry.reasons,
  expectedAct: needs.get(entry.id)?.act,
  recordedReplyAct: observed.get(entry.id)?.replyAct ?? null,
  recordedGuards: observed.get(entry.id)?.runtime?.guards ?? [],
}));
const artifact = {
  fixture: 'examples/estates/fixture',
  work: suite.work,
  scope: staticOnly
    ? 'All generator incomplete rows, native-unit omissions and static checkAsk verdicts. Traces are explicitly untested by this run.'
    : 'All generator incomplete rows, native-unit omissions, static checkAsk verdicts and actual fake-agent traces for every static-passing complete ask.',
  summary: report.summary,
  population: { planRows: plan.rows.length, loadedSpecs: suite.specs.length, staticAsks: staticAsks.length },
  incomplete,
  unitGaps,
  traceExecutionError,
  traceUnchecked: staticOnly ? ready.map((spec) => spec.id) : [],
  traceGaps: traced.filter((entry) => entry.reasons.length > 0),
  tracePasses: traced.filter((entry) => entry.reasons.length === 0),
  invalid: report.invalid ?? [],
  lint: report.lint ?? [],
  staticAskGaps: staticAsks.filter((entry) => entry.reasons.length > 0),
  staticAskPasses: staticAsks.filter((entry) => entry.reasons.length === 0),
};
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
await rm(suite.work, { recursive: true, force: true });
console.log(
  JSON.stringify(
    {
      output,
      population: artifact.population,
      incomplete: incomplete.length,
      unitGaps: unitGaps.length,
      staticAskGaps: artifact.staticAskGaps.length,
      traceGaps: artifact.traceGaps.length,
      tracePasses: artifact.tracePasses.length,
      ...(traceExecutionError === undefined ? {} : { traceExecutionError }),
    },
    null,
    2,
  ),
);

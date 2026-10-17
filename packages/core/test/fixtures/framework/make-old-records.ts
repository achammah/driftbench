// Writes old-records.json: run records as main writes them, before `by`, `resolved` and `diagnoses` existed.
// Run it on the commit the file names, from the repo root:
//   pnpm exec tsx packages/core/test/fixtures/framework/make-old-records.ts > old-records.json
// Every Acme conversation spec runs once in mode T and once in mode F against the Acme agent, with the shipped
// checks and no model call.
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { loadAcmeConversations, realAcmeAdapter } from '../../runner/support';

const fixed = () => new Date('2026-10-15T00:00:00.000Z');
const records = [];
for (const { spec } of await loadAcmeConversations()) {
  for (const mode of ['T', 'F'] as const) {
    records.push(
      await runSpec(spec, {
        adapter: realAcmeAdapter(),
        driver: createScriptedDriver(),
        checks: defaultChecks(),
        mode,
        repeat: 0,
        now: fixed,
      }),
    );
  }
}
process.stdout.write(
  `${JSON.stringify({ note: 'Run records as origin/main <commit> writes them, by make-old-records.ts.', records })}\n`,
);

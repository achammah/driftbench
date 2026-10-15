import { createToolsCheck, defaultChecks, type SameReferentJudge } from '@agent-nexus/driftbench-checks';
import type { Check, RunResult } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { acmeReplayer } from '../../../../examples/acme/src/index';
import { runSpec } from '../../src/runner';
import { acmeSpec, broken, loadAcmeConversations, realAcmeAdapter } from './support';

/**
 * Blast radius of the value-check ladder (PR 459) on the runner, in the configuration the CLI runs:
 * `defaultChecks()`, no replayer, no judge. PR 459 moved the drift, gate and attack tests to a replayer, so this
 * file keeps the CLI path under test: a wrong plan id still fails the tools input (exact fallback) beside the
 * ledger, the drift classes are those of the replayer path, and the new non-gating lints never fail a block nor
 * add a drift class. Fictional data only.
 */

const loaded = await loadAcmeConversations();
const upgrade = acmeSpec(loaded, 'acme-plan-upgrade');

/** The order goes out with the plan id the change writes. */
const planAs = (plan: (old: string) => string) =>
  broken((observed) => {
    for (const call of observed.toolCalls) {
      if (call.label === 'order.create' && call.input && typeof call.input === 'object') {
        const input = call.input as Record<string, unknown>;
        input.plan_id = plan(String(input.plan_id));
      }
    }
  });

function runWith(checks: Check[], wrap?: Parameters<typeof realAcmeAdapter>[0]): Promise<RunResult> {
  return runSpec(upgrade, {
    adapter: realAcmeAdapter(wrap),
    driver: createScriptedDriver(),
    checks,
    mode: 'F',
    repeat: 0,
  });
}

function gating(result: RunResult, block: number): Array<[string, string]> {
  return (result.blocks[block]?.verdicts ?? [])
    .filter((verdict) => verdict.gating)
    .map((verdict) => [verdict.id, verdict.outcome]);
}

/** A calibrated stub judge that reads a plan id without its case: MOBILE-L and mobile-l are one plan. */
const caseless: SameReferentJudge = {
  model: 'caseless-reader',
  calibration: { falseAcceptance: 0, source: 'a test stub' },
  complete: async (request) =>
    request.kind === 'read'
      ? { has_content: true, reading: String(request.parts.v).toLowerCase() }
      : { same: request.parts.a === request.parts.b },
};

describe('the runner on the CLI configuration of the value check (PR 459)', () => {
  it('a wrong plan id fails the tools input by the exact fallback, with the drift of the replayer path', async () => {
    const wrong = planAs(() => 'mobile-s');
    const cli = await runWith(defaultChecks(), wrong);
    const replayed = await runWith(
      defaultChecks({ valueCheck: { services: { replayer: acmeReplayer() } } }),
      wrong,
    );
    const block = cli.blocks[3];
    expect(block?.pass).toBe(false);
    expect(block?.drift).toEqual(['X2_contradiction', 'X5_tool']);
    expect(gating(cli, 3)).toEqual(gating(replayed, 3));
    const input = block?.verdicts.find((verdict) => verdict.id === 'tools.order.create.input.plan_id');
    expect(input).toMatchObject({ outcome: 'fail', gating: true });
    expect(input?.evidence).toContain('exact_fallback');
    expect(block?.verdicts.find((verdict) => verdict.id.endsWith('.no_decider'))).toMatchObject({
      outcome: 'fail',
      gating: false,
    });
  });

  it('every block of the deterministic agent passes with no lint on the CLI configuration', async () => {
    const result = await runWith(defaultChecks());
    for (const block of result.blocks) {
      expect(block.pass, `block ${block.index}`).toBe(true);
      expect(block.verdicts.filter((verdict) => verdict.id.endsWith('.no_decider'))).toEqual([]);
    }
  });

  it('a lint alone never fails a block nor marks drift: a judged pass with an unstated_format lint', async () => {
    const checks = defaultChecks().map((check) =>
      check.name === 'tools' ? createToolsCheck({ services: { judge: caseless } }) : check,
    );
    const result = await runWith(
      checks,
      planAs((old) => old.toUpperCase()),
    );
    const block = result.blocks[3];
    expect(
      block?.verdicts.find((verdict) => verdict.id === 'tools.order.create.input.plan_id'),
    ).toMatchObject({
      outcome: 'pass',
    });
    expect(block?.verdicts.find((verdict) => verdict.id.endsWith('.unstated_format'))).toMatchObject({
      outcome: 'fail',
      gating: false,
    });
    expect(block?.pass).toBe(true);
    expect(block?.drift).toEqual([]);
    expect(result.succession.driftCount).toBe(0);
  });
});

import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { injectingDriver, runSpec, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { acmeAdapter, acmeSpec, loadAcmeConversations } from '../../core/test/runner/support';
import { findingOf } from '../src/attack';
import { createScriptedDriver } from '../src/index';

/**
 * Blast-radius audit (PR 428): an attack round whose injected block was not run (the adapter cannot apply the
 * perturbation's forced tool result) sent the agent nothing, so it is no finding against the agent.
 */
describe('blast radius: an attack round on a perturbation that was not run', () => {
  it('is not reported as an injected block the agent failed', async () => {
    const loaded = await loadAcmeConversations();
    const original = acmeSpec(loaded, 'acme-tool-failure');
    const { given: _given, ...rest } = original;
    const spec = {
      ...rest,
      blocks: original.blocks.map((entry) => {
        const { given: _blockGiven, ...kept } = entry;
        return kept;
      }),
    } as Spec;
    const perturbation = spec.perturbations?.find((entry) => entry.id === 'sales-queue-down');
    if (!perturbation) throw new Error('no perturbation sales-queue-down');
    const run = await runSpec(spec, {
      adapter: acmeAdapter({ capabilities: { toolStubs: false } }),
      driver: injectingDriver(createScriptedDriver(), 'sales-queue-down'),
      checks: defaultChecks(),
      mode: 'P',
      repeat: 0,
      perturbationId: 'sales-queue-down',
    });
    expect(run.blocks.find((entry) => entry.injected)?.status).toBe('not_run');
    expect(findingOf(run, perturbation)).not.toBe('injected block failed');
  });
});

import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import type { RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { acmeAdapter, acmeSpec, loadAcmeConversations } from '../../core/test/runner/support';
import { observationOf, verifySpec } from '../src/index';

/**
 * Blast-radius audit (PR 428): the family verifier and the pilot read a run as pass or fail. A run whose
 * blocks were not run measured nothing: it is never a reference failure, and never a failed pilot observation.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

describe('blast radius: generate consumers of a run not run', () => {
  it('family verify does not reject an instance as a reference failure when its spec was not run', async () => {
    const loaded = await loadAcmeConversations();
    const verdict = await verifySpec('tool-failure.yaml', acmeSpec(loaded, 'acme-tool-failure'), {
      adapter: acmeAdapter({ capabilities: { toolStubs: false } }),
      target: { adapter: 'function', agent: 'acme-sales' },
      checks: defaultChecks(),
      artifacts: defaultReaders(),
      cwd: ROOT,
    });
    expect(verdict.state).not.toBe('fail');
  });

  it('a pilot observation leaves a run not run out, never a fail', () => {
    const run = {
      runId: 'r',
      specId: 'g',
      specHash: 'h',
      target: { adapter: 'function', agent: 'a' },
      mode: 'F',
      repeat: 0,
      status: 'completed',
      blocks: [
        {
          index: 0,
          givenHash: 'g0',
          observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 },
          verdicts: [],
          ledgerCheck: { ok: true, contradictions: [] },
          drift: [],
          pass: false,
          status: 'not_run',
          notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'e', got: 'g' },
        },
      ],
      succession: { driftCount: 0, driftRate: 0, longestClean: 0, minOverBlocks: false },
      cost: 0,
      latencyMs: 0,
      startedAt: '2026-10-15T00:00:00.000Z',
      finishedAt: '2026-10-15T00:00:00.000Z',
      cacheHit: false,
    } as RunResult;
    const observation = observationOf(run, { cell: 'c', conversation: 'k', wording: 0, map: 'm', suite: 1 });
    expect(observation).toBeUndefined();
  });
});

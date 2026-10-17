// Unit F6, HF4 as a repo test: a scoring-only change re-scores stored runs with 0 adapter calls; an
// agent-facing change is refused and routed to a rerun.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  clearObjectContexts,
  type LoadedSpec,
  loadSpecs,
  objectContextFor,
  parseCliOverrides,
  prepareRescore,
  type RunResult,
  refuseAgentFacing,
  rescoreRun,
  runSpec,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { ACME_CONVERSATIONS, acmeAdapter } from '../runner/support';

const target = { adapter: 'function', variant: 'v1' };
const now = () => new Date('2026-10-15T00:00:00Z');

/** A project holding the Acme conversation specs, so project objects can change around them. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-rescore-'));
  writeFileSync(join(root, 'driftbench.yaml'), 'plugins: []\n');
  cpSync(ACME_CONVERSATIONS, join(root, 'specs'), { recursive: true });
  return root;
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

async function specs(root: string): Promise<LoadedSpec[]> {
  clearObjectContexts();
  const loaded = await loadSpecs([join(root, 'specs')]);
  if (!loaded.every((entry) => entry.ok))
    throw new Error(JSON.stringify(loaded.filter((entry) => !entry.ok)));
  return loaded as LoadedSpec[];
}

const options = (adapter: ReturnType<typeof acmeAdapter>) => ({
  baselineProvenance: {
    version: 2 as const,
    adapters: [
      {
        ...adapterProvenance(adapter, target.adapter),
        targetHash: provenanceHash(target),
        agentVersionHash: provenanceHash('v1'),
      },
    ],
  },
  fromCampaign: 'acme-base',
  agentVersion: 'v1',
  now: new Date('2026-10-15T01:00:00Z'),
});

describe('HF4: re-score without the agent', () => {
  it('re-scores every stored run under a changed project file with 0 adapter calls', async () => {
    const root = project();
    const adapter = acmeAdapter();
    const baseline: Array<{ loaded: LoadedSpec; run: RunResult }> = [];
    for (const loaded of await specs(root)) {
      const run = await runSpec(loaded.spec, {
        adapter,
        driver: createScriptedDriver(),
        checks: defaultChecks(),
        mode: 'F',
        repeat: 0,
        target,
        recordProvenance: true,
        now,
        objects: objectContextFor(loaded.path),
      });
      baseline.push({ loaded, run });
    }
    const callsAfterBaseline = { ...adapter.calls };
    expect(callsAfterBaseline.send).toBeGreaterThan(0);
    const mustBefore = baseline
      .flatMap(({ run }) => run.blocks.flatMap((b) => b.verdicts))
      .filter((v) => v.name === 'must').length;
    expect(mustBefore).toBeGreaterThan(0);

    // The scoring-only change: a project check set without `must`, used by every spec below the project.
    write(
      root,
      'driftbench/check-set/acme.yaml',
      'kind: check-set\nid: acme\nextends: default\nitems:\n  - { id: must, enabled: false }\n',
    );
    write(root, 'driftbench/uses.yaml', 'check_set: acme\n');
    const changed = await specs(root);
    let rescored = 0;
    let refused = 0;
    for (const { loaded, run } of baseline) {
      const next = changed.find((entry) => entry.spec.id === loaded.spec.id) as LoadedSpec;
      expect(next.hash).toBe(loaded.hash);
      if (run.blocks.some((block) => block.injected)) {
        // An injected block's context is not stored: the existing re-judge rule refuses it, with the reason.
        expect(() => prepareRescore(loaded.spec, next.spec, run, options(adapter))).toThrow(
          /cannot be reconstructed/,
        );
        refused += 1;
        continue;
      }
      const prepared = prepareRescore(loaded.spec, next.spec, run, options(adapter));
      const result = await rescoreRun(prepared, defaultChecks(), objectContextFor(next.path));
      rescored += result.blocks.length;
      const verdicts = result.blocks.flatMap((block) => block.verdicts);
      expect(verdicts.some((verdict) => verdict.name === 'must')).toBe(false);
      for (const verdict of verdicts) {
        expect(verdict.by?.object).toMatch(
          verdict.name === 'tools' && verdict.valueCheck?.length
            ? /^policy\/value-check:default@/
            : /^check-set:acme@/,
        );
      }
      for (const block of result.blocks) {
        expect(block.resolved?.objects.filter((entry) => entry.key === 'check_set')).toEqual([
          { key: 'check_set', kind: 'check-set', id: 'acme', hash: expect.any(String), setAt: 'project' },
        ]);
        expect(block.rejudged?.criteria).toEqual([]);
      }
      // Without `must`, every verdict left is the one the stored run had.
      const kept = run.blocks.flatMap((block) => block.verdicts).filter((v) => v.name !== 'must');
      expect(verdicts.map(({ by: _by, ...v }) => v)).toEqual(kept.map(({ by: _by, ...v }) => v));
    }
    // Two Acme conversations inject a deviation in their blocks.
    expect(refused).toBe(2);
    expect(rescored).toBe(
      baseline
        .filter(({ run }) => !run.blocks.some((b) => b.injected))
        .reduce((sum, { run }) => sum + run.blocks.length, 0),
    );
    expect(adapter.calls).toEqual(callsAfterBaseline);
  });

  it('re-scores a change written as uses on the spec, with the same compatibility', async () => {
    const root = project();
    const adapter = acmeAdapter();
    const [loaded] = await specs(root);
    if (!loaded) throw new Error('no spec');
    const run = await runSpec(loaded.spec, {
      adapter,
      driver: createScriptedDriver(),
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
      target,
      recordProvenance: true,
      now,
    });
    const sent = adapter.calls.send;
    write(
      root,
      'driftbench/check-set/acme.yaml',
      'kind: check-set\nid: acme\nextends: default\nitems:\n  - { id: pii, enabled: false }\n',
    );
    clearObjectContexts();
    const next = { ...loaded.spec, uses: { check_set: 'acme' } } as Spec;
    const prepared = prepareRescore(loaded.spec, next, run, options(adapter));
    const result = await rescoreRun(prepared, defaultChecks(), objectContextFor(loaded.path));
    expect(result.blocks.flatMap((b) => b.verdicts).some((v) => v.name === 'pii')).toBe(false);
    expect(result.blocks[0]?.resolved?.objects.find((entry) => entry.key === 'check_set')?.setAt).toBe(
      'spec',
    );
    expect(adapter.calls.send).toBe(sent);
  });
});

describe('an agent-facing change is refused and routed to a rerun', () => {
  it('refuses a command-line run profile or persona, and keeps a scoring-only one', () => {
    expect(() => refuseAgentFacing(parseCliOverrides(['run-profile/fast'], []))).toThrow(
      'run-profile is agent-facing: a change to it changes what the agent receives; rerun the agent in a full campaign.',
    );
    expect(() => refuseAgentFacing(parseCliOverrides([], ['persona/terse#tone.level=2']))).toThrow(
      /persona is agent-facing/,
    );
    expect(() =>
      refuseAgentFacing(parseCliOverrides(['check-set/acme', 'policy/blame/acme'], [])),
    ).not.toThrow();
  });

  it('refuses a spec whose agent-facing content changed: the stimulus, the target model', async () => {
    const root = project();
    const adapter = acmeAdapter();
    const [loaded] = await specs(root);
    if (!loaded) throw new Error('no spec');
    const run = await runSpec(loaded.spec, {
      adapter,
      driver: createScriptedDriver(),
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
      target,
      recordProvenance: true,
      now,
    });
    const stimulus = {
      ...loaded.spec,
      blocks: loaded.spec.blocks.map((b, i) => (i === 0 ? { ...b, when: { user: 'Something else.' } } : b)),
    } as Spec;
    expect(() => prepareRescore(loaded.spec, stimulus, run, options(adapter))).toThrow(
      /rerun the agent in a full campaign/,
    );
    const model = { ...loaded.spec, target: { adapter: 'function', options: { model: 'another' } } } as Spec;
    expect(() => prepareRescore(loaded.spec, model, run, options(adapter))).toThrow(
      /rerun the agent in a full campaign/,
    );
  });
});

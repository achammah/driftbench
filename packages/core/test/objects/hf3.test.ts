// Unit F7, HF3 re-run: a verdict computed from other verdicts is a diagnosis, so a one-item override of the
// check set changes only the verdicts that item stamps; the moved argument accuracy keeps its value.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultChecks, initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import {
  applyScoringPlan,
  loadSpecFile,
  type RunResult,
  runDiagnostics,
  runSpec,
  type Spec,
  scoringPlan,
  shippedObjectContext,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { beforeAll, describe, expect, it } from 'vitest';
import { acmeAdapter, loadAcmeConversations } from '../runner/support';
import { BLOCKS, h1Context, h1Runs } from './h1';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const AGGREGATE = 'tools.argument_accuracy';

const specs = new Map<string, Spec>();
beforeAll(async () => {
  initializeShippedObjects();
  for (const def of Object.values(BLOCKS)) {
    if (specs.has(def.spec)) continue;
    const loaded = await loadSpecFile(join(ROOT, def.spec));
    if (!loaded.ok) throw new Error(`${def.spec}: ${JSON.stringify(loaded.errors)}`);
    specs.set(def.spec, loaded.spec);
  }
});

/** Scores the 259 H1 runs under a check set: the verdicts, and the argument-accuracy diagnoses. */
async function scoreAll(checkSet: string, store = shippedObjectContext().store) {
  const plan = scoringPlan(defaultChecks(), store.resolve('check-set', checkSet));
  const diagnostic = store.resolve('diagnostic', 'argument-accuracy');
  const out: Array<{ verdicts: Verdict[]; scores: number[] }> = [];
  for (const run of h1Runs()) {
    const def = BLOCKS[run.block] as { spec: string; index: number };
    const ctx = h1Context(specs.get(def.spec) as Spec, def.index, run);
    const verdicts = await applyScoringPlan(plan, ctx);
    const { diagnoses } = await runDiagnostics([diagnostic], { check: ctx, verdicts, objects: [] });
    out.push({ verdicts, scores: diagnoses.map((diagnosis) => diagnosis.score as number) });
  }
  return out;
}

describe('HF3: a one-item override changes no untargeted verdict', () => {
  it('over the 259 H1 runs, for each item disabled alone', async () => {
    const baseline = await scoreAll('default');
    expect(baseline.flat().every(({ verdicts }) => verdicts.every((v) => v.by?.item !== undefined))).toBe(
      true,
    );
    expect(baseline.some(({ verdicts }) => verdicts.some((v) => v.id === AGGREGATE))).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'driftbench-hf3-'));
    const targeted: Record<string, number> = {};
    for (const item of ['tools', 'forbidden', 'must', 'must_not', 'lang', 'pii', 'cards', 'stage']) {
      const store = shippedObjectContext().store;
      writeFileSync(
        join(dir, `${item}.yaml`),
        `kind: check-set\nid: o-${item}\nextends: default\nitems:\n  - { id: ${item}, enabled: false }\n`,
      );
      store.addFile(join(dir, `${item}.yaml`), 'project');
      const scored = await scoreAll(`o-${item}`, store);
      let untargeted = 0;
      targeted[item] = 0;
      scored.forEach(({ verdicts }, index) => {
        const before = new Map((baseline[index]?.verdicts ?? []).map((v) => [v.id, v]));
        const after = new Map(verdicts.map((v) => [v.id, v]));
        for (const id of new Set([...before.keys(), ...after.keys()])) {
          const b = before.get(id);
          const a = after.get(id);
          if (a && b && a.outcome === b.outcome && a.score === b.score) continue;
          if (a?.name === item || b?.name === item) targeted[item] = (targeted[item] ?? 0) + 1;
          else untargeted += 1;
        }
      });
      expect(untargeted, item).toBe(0);
    }
    // The overrides test something: the tools and forbidden items each change verdicts.
    expect(targeted.tools).toBeGreaterThan(1_000);
    expect(targeted.forbidden).toBeGreaterThan(0);
  });

  it('moves the share of matched arguments to a diagnosis that reads the input verdicts', async () => {
    const baseline = await scoreAll('default');
    const withScore = baseline.filter(({ scores }) => scores.length === 1);
    expect(withScore.length).toBe(259);
    for (const { verdicts, scores } of withScore) {
      const inputs = verdicts.filter(
        (v) => v.name === 'tools' && v.id.includes('.input.') && !v.evidence?.startsWith('test lint:'),
      );
      expect(scores[0]).toBe(inputs.filter((v) => v.outcome === 'pass').length / inputs.length);
    }
  });
});

describe('the moved score keeps its value on the default files', () => {
  const { records } = JSON.parse(
    readFileSync(join(HERE, '..', 'fixtures', 'framework', 'old-records.json'), 'utf8'),
  ) as { records: RunResult[] };

  it('equals the stored tools.argument_accuracy of every block of the records main wrote', async () => {
    const diagnostic = shippedObjectContext().store.resolve('diagnostic', 'argument-accuracy');
    let compared = 0;
    for (const record of records) {
      for (const block of record.blocks) {
        const stored = block.verdicts.find((v) => v.id === AGGREGATE);
        const rest = block.verdicts.filter((v) => v.id !== AGGREGATE);
        const { diagnoses } = await runDiagnostics([diagnostic], {
          check: {} as never,
          verdicts: rest,
          objects: [],
        });
        if (!stored) {
          expect(diagnoses).toEqual([]);
          continue;
        }
        compared += 1;
        expect(diagnoses).toHaveLength(1);
        expect(diagnoses[0]?.score).toBe(stored.score);
        expect(diagnoses[0]?.summary).toBe(stored.evidence);
      }
    }
    expect(compared).toBe(
      records.flatMap((r) => r.blocks).filter((b) => b.verdicts.some((v) => v.id === AGGREGATE)).length,
    );
    expect(compared).toBeGreaterThan(10);
  });

  it('a fresh Acme run gives the stored verdicts less the aggregate, and the aggregate as a diagnosis', async () => {
    const driver = createScriptedDriver();
    const fixed = () => new Date('2026-10-15T00:00:00.000Z');
    let blocks = 0;
    for (const { spec } of await loadAcmeConversations()) {
      for (const mode of ['T', 'F'] as const) {
        const old = records.find((r) => r.specId === spec.id && r.mode === mode) as RunResult;
        const run = await runSpec(spec, {
          adapter: acmeAdapter(),
          driver,
          checks: defaultChecks(),
          mode,
          repeat: 0,
          now: fixed,
        });
        run.blocks.forEach((block, index) => {
          blocks += 1;
          const before = old.blocks[index]?.verdicts ?? [];
          const keep = (v: Verdict) => [v.id, v.outcome, v.gating, v.score, v.evidence];
          expect(block.verdicts.map(keep)).toEqual(before.filter((v) => v.id !== AGGREGATE).map(keep));
          expect(block.pass).toBe(old.blocks[index]?.pass);
          const stored = before.find((v) => v.id === AGGREGATE);
          const moved = block.diagnoses?.find((d) =>
            d.diagnostic.startsWith('diagnostic:argument-accuracy@'),
          );
          expect(moved?.score).toBe(stored?.score);
        });
      }
    }
    expect(blocks).toBe(52);
  });
});

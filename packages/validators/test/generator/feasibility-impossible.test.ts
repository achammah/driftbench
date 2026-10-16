import { execFileSync } from 'node:child_process';
import { type LoadedSpec, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { type BankItem, bankItems, SeedData } from '../../src/ladders/generator/bank';
import { type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import type { Generation } from '../../src/ladders/generator/measure';
import { impossiblePairs } from '../../src/ladders/generator/possible';
import { hiddenSeed } from '../../src/seeds';

const derived = hiddenSeed(process.cwd(), (root) =>
  execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
const visible = [...Array.from({ length: 20 }, (_, index) => index + 1), derived.seed];
// Seeds no generator or item was written against.
const fresh = Array.from({ length: 20 }, (_, index) => 1001 + index);
const NAMED = ['graph', 'twise', 'boundary', 'deviation', 'metamorphic', 'cover', 'task'];

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

function item(seeder: string): BankItem {
  return required(bankItems().find((entry) => entry.id === `diff.feasible.${seeder}`));
}

const matches = (forbid: Record<string, string>, cell: Record<string, string>) =>
  Object.entries(forbid).every(([axis, value]) => cell[axis] === value);

/** The pairs only the map's reachability forbids: no written constraint covers them. */
function impossibleOnly(hidden: HiddenSpec): Array<{ forbid: Record<string, string>; reason: string }> {
  return impossiblePairs(hidden).filter(
    (pair) => !hidden.constraints.some((constraint) => matches(constraint.forbid, pair.forbid)),
  );
}

/** A stage and deviation pair neither a written constraint nor the reachability analysis forbids. */
function allowedPair(hidden: HiddenSpec): Record<string, string> {
  const forbids = [...hidden.constraints, ...impossiblePairs(hidden)].map((entry) => entry.forbid);
  for (const path of hidden.paths)
    for (const stage of path.stages.slice(1))
      for (const deviation of ['none', ...hidden.deviations]) {
        const cell = { stage, deviation };
        if (!forbids.some((forbid) => matches(forbid, cell))) return cell;
      }
  throw new Error('no allowed pair');
}

function generated(
  hidden: HiddenSpec,
  seed: number,
  seeder: string,
  cell: Record<string, string>,
): Generation {
  const spec = Spec.parse({
    id: 'cell-probe',
    kind: 'conversation',
    blocks: [{ id: 'block', when: { user: 'Hello.' }, expect: { stage: hidden.start } }],
    metadata: { generated: { seeder, cell: {}, blocks: [{ block: 'block', cell }] } },
  });
  const loaded: LoadedSpec = {
    ok: true,
    path: `complete/${seeder}/cell-probe.yaml`,
    spec,
    hash: '',
    warnings: [],
  };
  return {
    hidden,
    generatorSeed: seed,
    first: new Map(),
    second: new Map(),
    loaded: [loaded],
    complete: [loaded],
  };
}

function dataFor(seed: number, value: Generation): SeedData {
  const data = new SeedData(seed, { cheaters: [], faults: () => [], k: 1 }, async () => {
    throw new Error('feasibility must not measure scale');
  });
  vi.spyOn(data, 'generated').mockResolvedValue(value);
  vi.spyOn(data, 'runs').mockRejectedValue(new Error('feasibility must not run agents'));
  return data;
}

describe('diff.feasible reads the impossible pairs and every seeder', () => {
  it('seed 2: a cover block claiming D1 on a behaviour whose flows never recover D1 fails (the reported case)', async () => {
    const hidden = hiddenSpec(2);
    const pair = required(
      impossibleOnly(hidden).find(
        (entry) => entry.forbid.behaviour === 'B-001' && entry.forbid.deviation === 'D1_off_topic',
      ),
    );
    const cell = { flow: 'change-request', behaviour: 'B-001', deviation: 'D1_off_topic', stage: 'choice' };
    const result = await item('cover').check(dataFor(2, generated(hidden, 2, 'cover', cell)));
    expect(result).toEqual({
      pass: false,
      detail: `1 blocks sit in a cell a hidden constraint forbids: cell-probe#block (${pair.reason})`,
    });
  });

  it('flags a block in an impossible-only cell for every named seeder and an unlisted one', async () => {
    let planted = 0;
    for (const seed of [...visible, ...fresh]) {
      const hidden = hiddenSpec(seed);
      const pairs = impossibleOnly(hidden);
      expect(pairs.length, `seed ${seed}`).toBeGreaterThan(0);
      const pair = required(pairs[seed % pairs.length]);
      for (const seeder of [...NAMED, 'a-seeder-no-item-names']) {
        const own = NAMED.includes(seeder) ? seeder : 'unlisted';
        const result = await item(own).check(dataFor(seed, generated(hidden, seed, seeder, pair.forbid)));
        expect(result.pass, `seed ${seed} ${seeder} ${JSON.stringify(pair.forbid)}`).toBe(false);
        expect(result.detail).toContain(pair.reason);
        planted += 1;
      }
    }
    expect(planted).toBe(41 * 8);
  });

  it('a block in an allowed cell passes, and each item reads only its own seeder', async () => {
    for (const seed of [...visible, ...fresh]) {
      const hidden = hiddenSpec(seed);
      const pair = required(impossibleOnly(hidden)[0]);
      for (const seeder of NAMED) {
        const allowed = await item(seeder).check(
          dataFor(seed, generated(hidden, seed, seeder, allowedPair(hidden))),
        );
        expect(allowed.pass, `seed ${seed} ${seeder} allowed: ${allowed.detail}`).toBe(true);
        const other = NAMED.find((entry) => entry !== seeder) as string;
        const elsewhere = await item(other).check(
          dataFor(seed, generated(hidden, seed, seeder, pair.forbid)),
        );
        expect(elsewhere.pass, `seed ${seed} ${seeder} block read by ${other}`).toBe(true);
        const unlisted = await item('unlisted').check(
          dataFor(seed, generated(hidden, seed, seeder, pair.forbid)),
        );
        expect(unlisted.pass, `seed ${seed} ${seeder} block read by unlisted`).toBe(true);
      }
    }
  });
});

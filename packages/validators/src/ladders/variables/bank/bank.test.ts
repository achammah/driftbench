import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { fixture, passage, planCase } from './fixture';
import { items, measure, runItem } from './index';
import {
  active,
  activeConstraints,
  canonical,
  checkRelations,
  checkRun,
  expectedLogWeight,
  expectedSeeds,
  expectedWarningCodes,
  matches,
  product,
  targetTruth,
} from './oracle';
import { planItems } from './plan-items';
import { answerClass, contradictsPeriod, maxShortPeriod, scheduleCases, shuffled } from './schedule';
import { storeItems } from './store-items';
import type { BankItem, Case, Plan, Request, Row, VariablesAdapter } from './types';

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const hidden = 1_000_000 + (Number.parseInt(head.slice(0, 8), 16) % 1_000_000_000);
const seeds = [...new Set([...Array.from({ length: 20 }, (_, i) => i + 1), 820020691, hidden])];

/**
 * A scripted fixture adapter, NOT a store or planner implementation and NOT a pilot.
 * It receives no truth through execute. The test precomputes its canned replies.
 * Planner replies deliberately enumerate every allowed row: minimality is not in the contract.
 */
function canned(test: Case): unknown {
  const { truth, request } = test;
  if (truth.kind === 'validation')
    return truth.ok
      ? { ok: true, store: structuredClone(truth.preserved), warnings: truth.issues }
      : { ok: false, errors: truth.issues };
  if (truth.kind === 'quotes') return { errors: truth.issues };
  if (request.operation !== 'plan') throw new Error('fixture mismatch');
  const { store, options } = request;
  const variables = active(store, options);
  const constraints = activeConstraints(store, options, variables);
  const targets = targetTruth(store, options, truth);
  const allowed = truth.factorized
    ? Array.from({ length: Math.max(...variables.map((v) => v.values.length)) }, (_, i) =>
        Object.fromEntries(variables.map((v) => [v.id, v.values[i % v.values.length]!.id])),
      )
    : product(variables).filter((row) => !constraints.some((c) => matches(row, c)));
  const seeds = expectedSeeds(store, options);
  const all: Row[] = allowed.map((values) => ({
    id: '',
    source: 'planned',
    values,
    logWeight: expectedLogWeight(values, variables),
  }));
  all.sort(
    (a, b) =>
      (b.logWeight ?? Number.NEGATIVE_INFINITY) - (a.logWeight ?? Number.NEGATIVE_INFINITY) ||
      canonical(a.values).localeCompare(canonical(b.values)),
  );
  all.forEach((row, i) => {
    row.id = `row.${String(i + 1).padStart(3, '0')}`;
  });
  const kept = all.slice(
    0,
    options.budget === undefined ? undefined : Math.max(0, options.budget - seeds.length),
  );
  const rows = [...seeds, ...kept];
  const plan: Plan = {
    agent: store.agent,
    version: store.version,
    seed: options.seed,
    budget: options.budget,
    generated: all.length,
    cut: all.length - kept.length,
    rows,
    rules: truth.groups.map((variables, i) => ({
      variables,
      id: `fictional-rule-${i}`,
      label: `Fictional rule ${i}`,
    })),
    warnings: expectedWarningCodes(store, options, truth).map((code) => ({
      code,
      message: `Fictional ${code}`,
    })),
    layers: Object.fromEntries(
      (['own', 'shared', 'single'] as const).map((layer) => {
        const { feasible, infeasible } = targets[layer];
        const covered = feasible.filter((cell) => rows.some((row) => matches(row.values, cell))).length;
        return [
          layer,
          {
            strength: { own: 3, shared: 2, single: 1 }[layer],
            groups: feasible.length ? 1 : 0,
            targets: feasible.length,
            infeasible,
            seeded: feasible.filter((cell) => seeds.some((row) => matches(row.values, cell))).length,
            covered,
            uncovered: feasible.length - covered,
          },
        ];
      }),
    ) as Plan['layers'],
  };
  return { plan, text: JSON.stringify(plan) };
}

function stub(
  item: BankItem,
  seed: number,
  mutate?: (reply: unknown, request: Request) => unknown,
): VariablesAdapter {
  const replies = new Map<string, unknown>();
  for (const test of item.generate(seed)) {
    const key = canonical(test.request);
    if (!replies.has(key)) replies.set(key, canned(test));
  }
  return {
    execute(request) {
      const reply = structuredClone(replies.get(canonical(request)));
      return mutate ? mutate(reply, request) : reply;
    },
  };
}

describe('blind variables bank', () => {
  it.each([1, 20, 820020691])('rejects review call-order reproducer on seed %s', async (seed) => {
    let calls = 0;
    const result = await measure(
      seed,
      {
        execute(request) {
          if (request.operation !== 'quotes') return undefined;
          const paths: string[] = [];
          function walk(value: unknown, path = '') {
            if (!value || typeof value !== 'object') return;
            if ('kind' in value && value.kind === 'quote') paths.push(path);
            for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
          }
          walk(request.store);
          const phase = calls++ % 3;
          return {
            errors:
              phase === 0
                ? []
                : [
                    {
                      code: phase === 1 ? 'VARIABLES_QUOTE_NOT_FOUND' : 'VARIABLES_SOURCE_UNREADABLE',
                      path: `${paths[0]}.${phase === 1 ? 'quote' : 'path'}`,
                    },
                  ],
          };
        },
      },
      true,
    );
    expect(result.entries.filter((entry) => entry.pass).map((entry) => entry.id)).toEqual([]);
  });

  it('has 330 items, 30 per requested family, six per family/tier, explicit causes and no aliases', () => {
    expect(items).toHaveLength(330);
    expect(new Set(items.map((i) => i.id)).size).toBe(330);
    const families = [
      'sources',
      'quotes',
      'values',
      'boundaries',
      'impossible-pairs',
      'weights',
      'strength',
      'seed-rows',
      'budget-order',
      'counter',
      'scale',
    ];
    expect([...new Set(items.map((i) => i.family))].sort()).toEqual(families.sort());
    for (const family of families)
      for (let tier = 1; tier <= 5; tier++)
        expect(items.filter((i) => i.family === family && i.tier === tier)).toHaveLength(6);
    for (const item of items) expect(item.cause.length).toBeGreaterThan(0);
    // Cause names intentionally collapse tier variants; do not inflate the hardness forecast.
    expect(new Set(items.map((i) => i.cause)).size).toBe(66);
  });

  it('generates stable fixtures and changes every item on a commit-derived hidden seed', () => {
    for (const item of items) {
      expect(canonical(item.generate(1))).toBe(canonical(item.generate(1)));
      expect(canonical(item.generate(1))).not.toBe(canonical(item.generate(hidden)));
    }
  });

  it.each(seeds)(
    'scripted adapter exercises all 330 harness items on seed %s',
    async (seed) => {
      const failures = [];
      for (const item of items) {
        const result = await runItem(item, seed, stub(item, seed));
        if (!result.pass) failures.push({ id: item.id, detail: result.detail });
      }
      expect(failures).toEqual([]);
    },
    120_000,
  );

  it.each(seeds)(
    'rejects every short-period call-index cheat on seed %s',
    async (seed) => {
      // Cache fixtures only within this seed; every adapter still runs through runItem.
      const prepared = shuffled(items, `item-order:test:${seed}`).map((item) => {
        const cases = item.generate(seed);
        const labels = cases.map(answerClass);
        expect(cases.length, item.id).toBeGreaterThanOrEqual(17);
        // Independent residue-table proof covers ALL possible motifs, not only the
        // three-state motif exercised below. Offset only rotates residue names.
        for (let period = 1; period <= maxShortPeriod; period++) {
          for (let offset = 0; offset < period; offset++) {
            const residues = new Map<number, Set<string>>();
            labels.forEach((label, index) => {
              const residue = (index + offset) % period;
              const bucket = residues.get(residue) ?? new Set<string>();
              bucket.add(label);
              residues.set(residue, bucket);
            });
            expect(
              [...residues.values()].some((bucket) => bucket.size > 1),
              `${item.id}/${period}/${offset}`,
            ).toBe(true);
          }
        }
        const replies = new Map<string, { label: string; reply: unknown }>();
        const classes = new Map<string, unknown>();
        for (const test of cases) {
          const key = canonical(test.request);
          if (replies.has(key)) continue;
          const reply = canned(test);
          const label = answerClass(test);
          replies.set(key, { label, reply });
          classes.set(label, reply);
        }
        return {
          item: { ...item, generate: () => cases },
          replies,
          classes: [...classes.entries()].sort(([a], [b]) => a.localeCompare(b)),
        };
      });
      for (let period = 1; period <= maxShortPeriod; period++) {
        for (let offset = 0; offset < period; offset++) {
          let calls = 0;
          for (const { item, replies, classes } of prepared) {
            const adapter: VariablesAdapter = {
              execute(request) {
                // Deliberately grant the cheater perfect payload formatting via canned
                // fixtures. ONLY the answer class is chosen by call index. Unlike an
                // undefined response, its output can pass whenever that class is right.
                const actual = replies.get(canonical(request));
                if (!actual) throw new Error('cheat fixture missing');
                const selected = classes[((calls++ + offset) % period) % classes.length];
                if (!selected) throw new Error('cheat class missing');
                return structuredClone(actual.label === selected[0] ? actual.reply : selected[1]);
              },
            };
            expect((await runItem(item, seed, adapter)).pass, `${item.id}/${period}/${offset}/global`).toBe(
              false,
            );
            const globalCalls = calls;
            calls = 0;
            expect((await runItem(item, seed, adapter)).pass, `${item.id}/${period}/${offset}/reset`).toBe(
              false,
            );
            calls = globalCalls;
          }
        }
      }
    },
    300_000,
  );

  it('retains every original probe, including repeated and scale probes', () => {
    const originals = [...storeItems(), ...planItems()];
    for (const original of originals) {
      const item = items.find((item) => item.id === original.id)!;
      const available = item.generate(hidden).map((test) => canonical(test));
      for (const test of original.generate(hidden)) {
        const index = available.indexOf(canonical(test));
        expect(index, original.id).toBeGreaterThanOrEqual(0);
        available.splice(index, 1);
      }
    }
  });

  it('fails closed when no contrasting answer class exists', () => {
    const only = items[0]!.generate(1)[0]!;
    expect(() => scheduleCases([only], 1, 'single-class')).toThrow('no contrasting answer classes');
  });

  it('certifies schedules independently of item traversal and changes both orders with the seed', async () => {
    const failed: VariablesAdapter = { execute: () => undefined };
    const a = (await measure(1, failed, true)).entries.map((item) => item.id);
    const b = (await measure(20, failed, true)).entries.map((item) => item.id);
    expect(a).not.toEqual(b);
    expect(a).toEqual((await measure(1, failed, true)).entries.map((item) => item.id));
    const forward = new Map(items.map((item) => [item.id, item.generate(1).map(answerClass)]));
    for (const item of [...items].reverse()) {
      expect(item.generate(1).map(answerClass)).toEqual(forward.get(item.id));
      const pattern = (seed: number) => {
        const names = new Map<string, number>();
        return item.generate(seed).map((test) => {
          const label = answerClass(test);
          if (!names.has(label)) names.set(label, names.size);
          return names.get(label);
        });
      };
      // Remove seed-dependent names before comparing positions.
      expect(new Set([1, 2, 20].map((seed) => canonical(pattern(seed)))).size, item.id).toBeGreaterThan(1);
    }
    expect(contradictsPeriod(['a', 'b', 'a', 'b'], 2)).toBe(false);
    expect(contradictsPeriod(['a', 'b', 'b', 'a'], 2)).toBe(true);
  });

  const cheats: [string, VariablesAdapter][] = [
    ['empty', { execute: () => undefined }],
    [
      'constant',
      { execute: () => ({ ok: true, store: {}, warnings: [], errors: [], plan: { rows: [] }, text: '{}' }) },
    ],
    ['echo', { execute: (request) => request }],
  ];
  it.each(cheats)(
    '%s cheat passes zero items on visible and hidden seeds',
    async (_name, adapter) => {
      for (const seed of seeds) {
        const passing = [];
        for (const item of items) if ((await runItem(item, seed, adapter)).pass) passing.push(item.id);
        expect(passing).toEqual([]);
      }
    },
    120_000,
  );

  it('also rejects canned invalid responses and empty quote successes', async () => {
    for (const response of [{ ok: false, errors: [] }, { errors: [] }]) {
      for (const item of items)
        expect((await runItem(item, hidden, { execute: () => response })).pass, item.id).toBe(false);
    }
  });

  it('matches hand-counted triples, shared pairs, singles and an indirect unreachable value', () => {
    const { store, files } = fixture(7, 'manual', 1, 6);
    store.variables[2]!.role = 'detail';
    store.variables[3]!.role = 'detail';
    const left = passage(store, files, [0, 1, 2], 'left');
    const right = passage(store, files, [0, 1, 3], 'right');
    const truth = { kind: 'plan' as const, groups: [left, right], shared: left.slice(0, 2) };
    let targets = targetTruth(store, { seed: 7 }, truth);
    expect([
      targets.own.feasible.length,
      targets.shared.feasible.length,
      targets.single.feasible.length,
    ]).toEqual([16, 4, 4]);
    // Every setting of coordinate 1 forbids coordinate 0's first value.
    store.constraints = store.variables[1]!.values.map((v) => ({
      approved: true,
      reason: 'Fictional',
      forbid: { [store.variables[0]!.id]: store.variables[0]!.values[0]!.id, [store.variables[1]!.id]: v.id },
    }));
    targets = targetTruth(store, { seed: 7 }, truth);
    expect([
      targets.own.feasible.length,
      targets.own.infeasible,
      targets.shared.feasible.length,
      targets.shared.infeasible,
    ]).toEqual([8, 8, 2, 2]);
    expect(expectedWarningCodes(store, { seed: 7 }, truth)).toEqual(['value_unreachable']);
  });

  it('uses exact normalized shares and avoids underflow by summing logs', () => {
    const { store } = fixture(1, 'weights', 1, 1200);
    for (const v of store.variables) {
      v.values[0]!.weight = 1;
      v.values[1]!.weight = 9;
    }
    const row = Object.fromEntries(store.variables.map((v) => [v.id, v.values[0]!.id]));
    expect(expectedLogWeight(row, store.variables)).toBeCloseTo(1200 * Math.log(0.1), 8);
    expect(0.1 ** 1200).toBe(0);
  });

  it('returns first failing level by default and every tier only when requested', async () => {
    const adapter = cheats[0]![1];
    const partial = await measure(1, adapter);
    expect(partial.entries).toHaveLength(66);
    expect(partial.score).toBeNull();
    const all = await measure(1, adapter, true);
    expect([all.entries.length, all.level, all.score]).toEqual([330, 0, 0]);
  });

  const faults: [string, string, (reply: { plan: Plan; text: string }) => void][] = [
    [
      'drop rows',
      'strength.own-triples.t1',
      (r) => {
        r.plan.rows = [];
      },
    ],
    [
      'drop variable',
      'strength.own-four-variables.t1',
      (r) => {
        delete r.plan.rows[0]!.values[Object.keys(r.plan.rows[0]!.values)[0]!];
      },
    ],
    [
      'invent value',
      'strength.own-triples.t1',
      (r) => {
        r.plan.rows[0]!.values[Object.keys(r.plan.rows[0]!.values)[0]!] = 'absent';
      },
    ],
    [
      'lie targets',
      'counter.complete.t1',
      (r) => {
        r.plan.layers.own.targets++;
      },
    ],
    [
      'lie covered',
      'counter.complete.t1',
      (r) => {
        r.plan.layers.own.covered--;
      },
    ],
    [
      'lie uncovered',
      'counter.partial-covered.t1',
      (r) => {
        r.plan.layers.own.uncovered = 0;
      },
    ],
    [
      'lie infeasible',
      'counter.infeasible-targets.t1',
      (r) => {
        r.plan.layers.own.infeasible = 0;
      },
    ],
    [
      'lie seeded',
      'counter.seeded-targets.t1',
      (r) => {
        r.plan.layers.own.seeded = 0;
      },
    ],
    [
      'own strength two',
      'strength.own-triples.t1',
      (r) => {
        r.plan.layers.own.strength = 2;
      },
    ],
    [
      'shared strength one',
      'strength.shared-axes.t1',
      (r) => {
        r.plan.layers.shared.strength = 1;
      },
    ],
    [
      'single strength two',
      'counter.complete.t1',
      (r) => {
        r.plan.layers.single.strength = 2;
      },
    ],
    [
      'drop seed',
      'seed-rows.partial.t1',
      (r) => {
        r.plan.rows.shift();
      },
    ],
    [
      'dedup seed',
      'seed-rows.duplicate-sessions.t1',
      (r) => {
        r.plan.rows.splice(1, 1);
      },
    ],
    [
      'wrong log',
      'budget-order.weighted-order.t1',
      (r) => {
        r.plan.rows[0]!.logWeight = 0;
      },
    ],
    [
      'wrong generated',
      'counter.complete.t1',
      (r) => {
        r.plan.generated++;
      },
    ],
    [
      'wrong cut',
      'budget-order.one.t1',
      (r) => {
        r.plan.cut++;
      },
    ],
    [
      'wrong identity',
      'counter.complete.t1',
      (r) => {
        r.plan.agent = 'constant';
      },
    ],
    [
      'drop rules',
      'strength.own-triples.t1',
      (r) => {
        r.plan.rules = [];
      },
    ],
    [
      'drop warning',
      'seed-rows.forbidden-session.t1',
      (r) => {
        r.plan.warnings = [];
      },
    ],
    [
      'empty rendering',
      'counter.complete.t1',
      (r) => {
        r.text = '';
      },
    ],
  ];
  it.each(faults)('detects harness response mutation: %s', async (_name, id, mutate) => {
    const item = items.find((item) => item.id === id)!;
    const adapter = stub(item, hidden, (reply) => {
      mutate(reply as { plan: Plan; text: string });
      return reply;
    });
    expect((await runItem(item, hidden, adapter)).pass).toBe(false);
  });

  it('checks the unlimited budget prefix in either execution order', () => {
    const item = items.find((item) => item.id === 'budget-order.interior-prefix.t1')!;
    const cases = item.generate(1);
    const limited = cases.find(
      (test) => test.request.operation === 'plan' && test.request.options.budget === 3,
    )!;
    const unlimited = cases.find(
      (test) =>
        test.request.operation === 'plan' &&
        test.request.options.budget === undefined &&
        limited.request.operation === 'plan' &&
        test.request.store.version === limited.request.store.version,
    )!;
    const runs = [unlimited, limited].map((test) => ({
      case: test,
      result: canned(test),
      ms: 0,
      heapBytes: 0,
    }));
    checkRelations(runs);
    checkRelations([...runs].reverse());
    const changed = runs[1]!.result as { plan: Plan; text: string };
    changed.plan.rows.reverse();
    changed.text = JSON.stringify(changed.plan);
    for (const run of runs) checkRun(run);
    expect(() => checkRelations(runs)).toThrow('budget must keep exact unlimited prefix');
    expect(() => checkRelations([...runs].reverse())).toThrow('budget must keep exact unlimited prefix');
  });

  it('keeps expected truth isolated from adapter request mutation', async () => {
    const item = items.find((item) => item.id === 'values.approval-inheritance.t1')!;
    const before = canonical(item.generate(1));
    await runItem(item, 1, {
      execute: (request) => {
        if (request.operation === 'plan') request.store.variables.length = 0;
        return request;
      },
    });
    expect(canonical(item.generate(1))).toBe(before);
  });

  it('rejects a constant renderer on every plan item', async () => {
    for (const item of items.filter((i) =>
      i.generate(hidden).some((test) => test.request.operation === 'plan'),
    )) {
      const adapter = stub(item, hidden, (reply) => ({
        ...(reply as object),
        text: 'constant nonempty text',
      }));
      expect((await runItem(item, hidden, adapter)).pass, item.id).toBe(false);
    }
  }, 120_000);

  it('rejects missing and duplicate planned row identifiers', async () => {
    const item = items.find((i) => i.id === 'strength.own-triples.t1')!;
    for (const replacement of ['', 'row.001']) {
      const adapter = stub(item, hidden, (reply) => {
        const value = reply as { plan: Plan };
        for (const row of value.plan.rows) row.id = replacement;
        return value;
      });
      expect((await runItem(item, hidden, adapter)).pass).toBe(false);
    }
  });

  it('does not assume a unique or minimal cover', async () => {
    const { store, files } = fixture(4, 'not-minimal', 1, 4);
    const groups = [passage(store, files, [0, 1, 2], 'only-three')];
    const item: BankItem = {
      id: 'manual',
      family: 'strength',
      tier: 1,
      level: 1,
      component: 'planV2',
      title: 'all allowed rows accepted',
      cause: 'manual',
      generate: () => [planCase(store, 4, { groups, shared: [] })],
    };
    expect((await runItem(item, 4, stub(item, 4))).pass).toBe(true);
  });
});

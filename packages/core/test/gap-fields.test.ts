import { Expect, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

describe('similarity, relevancy and knowledge_retention in the spec', () => {
  it('accepts each field and refuses a threshold outside 0 to 1', () => {
    const ok = Expect.safeParse({
      similarity: [{ reference: 'Your order is placed.', min: 0.6 }],
      relevancy: { min: 0.5, terms: ['plan', 'data'] },
      knowledge_retention: [
        { fact: 'email', use: true },
        { fact: 'phone', ask: 'phone number' },
      ],
    });
    expect(ok.success, JSON.stringify(ok.error)).toBe(true);
    expect(Expect.safeParse({ similarity: [{ reference: 'x', min: 1.2 }] }).success).toBe(false);
    expect(Expect.safeParse({ relevancy: { min: -0.1 } }).success).toBe(false);
    expect(Expect.safeParse({ knowledge_retention: [{ fact: '' }] }).success).toBe(false);
  });

  it('counts a fact the block itself sets in given.ledger', () => {
    const loaded = validateSpec({
      id: 'retention-given',
      blocks: [
        {
          user: 'thanks',
          given: { ledger: { email: 'jo@example.com' } },
          expect: { knowledge_retention: [{ fact: 'email' }] },
        },
      ],
    });
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
  });

  it('flags a retention fact that no earlier ledger gives', () => {
    const loaded = validateSpec({
      id: 'retention',
      given: { ledger: { customer: 'existing' } },
      blocks: [
        { user: 'hi', expect: { knowledge_retention: [{ fact: 'email' }] } },
        { user: 'it is jo@example.com', expect: { ledger_add: { email: 'jo@example.com' } } },
        { user: 'thanks', expect: { knowledge_retention: [{ fact: 'email' }, { fact: 'customer' }] } },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'RETENTION_FACT_UNKNOWN blocks.0.expect.knowledge_retention.0.fact',
    ]);
  });

  it('does not count the given.ledger of the block a perturbation is inserted before', () => {
    const loaded = validateSpec({
      id: 'retention-perturbation',
      blocks: [{ user: 'hi' }, { user: 'thanks', given: { ledger: { email: 'jo@example.com' } } }],
      perturbations: [
        {
          id: 'p1',
          class: 'D1_off_topic',
          inject_at: 1,
          user: 'what was my email',
          expect: { knowledge_retention: [{ fact: 'email' }] },
        },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'RETENTION_FACT_UNKNOWN perturbations.0.expect.knowledge_retention.0.fact',
    ]);
  });

  it('refuses a world-only perturbation with no block to carry it', () => {
    const base = { id: 'world-end', blocks: [{ user: 'hi' }, { user: 'bye' }] };
    const world = { tools: { 'records.lookup': { error: 'timeout' } } };
    const at = (inject_at: number, extra: object) =>
      validateSpec({
        ...base,
        perturbations: [{ id: 'p1', class: 'D1_off_topic', inject_at, ...extra }],
      });
    const refused = at(2, { world });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'PERTURBATION_OUT_OF_RANGE perturbations.0.inject_at',
    ]);
    expect(at(1, { world }).ok).toBe(true);
    expect(at(2, { user: 'hey', world }).ok).toBe(true);
  });

  it('checks the retention facts of a long spec in time linear in its blocks', () => {
    const cpu = (blocks: number) => {
      const spec = {
        id: `long-${blocks}`,
        blocks: Array.from({ length: blocks }, (_, at) => ({
          user: `turn ${at}`,
          given: { ledger: { [`fact${at}`]: 'x' } },
          expect: { knowledge_retention: [{ fact: `fact${at}` }] },
        })),
      };
      const before = process.cpuUsage();
      const loaded = validateSpec(spec);
      const used = process.cpuUsage(before);
      expect(loaded.ok).toBe(true);
      return (used.user + used.system) / 1000;
    };
    // Linear growth is ten times; a pass over the earlier blocks for every block is a hundred.
    expect(bestGrowth(cpu, 500, 5000)).toBeLessThan(30);
  });

  it('measures a pass over the earlier blocks for every block as far above the bound', () => {
    const sink: number[] = [];
    // The work of block n reads every earlier block: quadratic in the blocks, as the defect to catch.
    const quadratic = (blocks: number) => {
      const before = process.cpuUsage();
      for (let at = 0; at < blocks; at += 1) {
        let sum = 0;
        for (let earlier = 0; earlier < at; earlier += 1) sum += earlier;
        sink[0] = sum;
      }
      const used = process.cpuUsage(before);
      return (used.user + used.system) / 1000;
    };
    expect(bestGrowth(quadratic, 2000, 20000)).toBeGreaterThan(30);
  });
});

/**
 * The growth of the CPU time from `small` to `large` blocks: the best of several samples at each size, so the
 * load of the machine, which only ever adds time, does not decide it. One sample of the small size is a
 * millisecond or two, and one stall moves a ratio by a third.
 */
function bestGrowth(cpu: (blocks: number) => number, small: number, large: number, samples = 5): number {
  cpu(200);
  let least = Number.POSITIVE_INFINITY;
  let most = Number.POSITIVE_INFINITY;
  for (let again = 0; again < samples; again += 1) {
    least = Math.min(least, cpu(small));
    most = Math.min(most, cpu(large));
  }
  return most / Math.max(least, 1);
}

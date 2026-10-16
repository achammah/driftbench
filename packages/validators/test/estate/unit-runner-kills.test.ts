import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';
import { coverageFamily, readsFamily, taskFamily } from '../../src/ladders/estate/bank/genquality';
import { killVerdict } from '../../src/ladders/estate/bank/unit';

const specs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const verdicts = (entries: Record<string, boolean>) => new Map(Object.entries(entries));

describe('unit.runner kills', () => {
  it('counts a spec green on the original that turns red on the variant', () => {
    const verdict = killVerdict(
      specs,
      verdicts({ a: true, b: true, c: true }),
      verdicts({ a: true, b: false, c: true }),
      'allow-all',
    );
    expect(verdict).toMatchObject({ valid: 3, killed: true, detail: 'holds' });
  });

  it('never counts a spec already red on the original: a broken original yields no kill', () => {
    // The original fails every spec (a broken guard or fixture); the variant fails them too.
    const verdict = killVerdict(
      specs,
      verdicts({ a: false, b: false, c: false }),
      verdicts({ a: false, b: false, c: false }),
      'block-all',
    );
    expect(verdict.killed).toBe(false);
    expect(verdict.valid).toBe(0);
    expect(verdict.detail).toContain('invalid tests');
  });

  it('ignores the red specs that were red before, and still kills on one that was green', () => {
    const mixed = killVerdict(
      specs,
      verdicts({ a: false, b: true, c: false }),
      verdicts({ a: false, b: false, c: false }),
      'allow-all',
    );
    expect(mixed).toMatchObject({ valid: 1, killed: true });
    const none = killVerdict(
      specs,
      verdicts({ a: false, b: true, c: false }),
      verdicts({ a: false, b: true, c: false }),
      'allow-all',
    );
    expect(none).toMatchObject({ valid: 1, killed: false });
    expect(none.detail).toContain('stay green');
  });

  it('does not count a spec the variant run did not report', () => {
    const verdict = killVerdict(specs, verdicts({ a: true }), verdicts({}), 'allow-all');
    expect(verdict.killed).toBe(false);
  });
});

describe('the generated suite as `estate unit` takes it', { timeout: 300_000 }, () => {
  it('lists the native JSON unit tests of guards and scripts, which `estate unit` reads, apart from the YAML specs', async () => {
    const suite = await fixtureSuite();
    const natives = suite.natives;
    expect(natives.length).toBeGreaterThan(0);
    expect(natives.every((spec) => spec.path.endsWith('.json') && spec.path.includes('/unit/'))).toBe(true);
    const types = new Set(natives.map((spec) => spec.testType));
    for (const type of ['guard_positive', 'guard_negative', 'guard_hostile', 'guard_speed', 'script_fixture'])
      expect(types.has(type), type).toBe(true);
    // The YAML unit specs keep their own mode; nothing hands them to the JSON-only command.
    expect(suite.specs.some((spec) => spec.mode === 'unit' && spec.path.endsWith('.json'))).toBe(false);
  });
});

describe('the native unit records stay out of the generation-quality inputs', { timeout: 300_000 }, () => {
  it('fails the generation-quality items once the core specs are removed, whatever unit records are listed', async () => {
    const suite = await fixtureSuite();
    expect(suite.natives.length).toBeGreaterThan(0);
    // The core specs are gone; the native unit records are still there. No item that reads core specs may pass on them.
    const bare = { ...suite, specs: [] };
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(bare);
    try {
      const reads = await readsFamily().evaluate(1);
      const tasks = await taskFamily().evaluate(1);
      const coverage = await coverageFamily().evaluate(1);
      for (const [id, result] of reads) expect(result.pass, id).toBe(false);
      for (const [id, result] of tasks) expect(result.pass, id).toBe(false);
      for (const key of ['one-per-guard', 'one-per-script', 'one-per-instruction'])
        expect(coverage.get(`gen.coverage.${key}`)?.pass, key).toBe(false);
    } finally {
      mock.mockRestore();
    }
  });

  it('keeps every record out of specs: the mode native-unit appears only in natives', async () => {
    const suite = await fixtureSuite();
    expect(suite.specs.some((spec) => spec.mode === 'native-unit' || spec.path.endsWith('/unit/'))).toBe(
      false,
    );
    expect(suite.natives.every((spec) => spec.mode === 'native-unit')).toBe(true);
  });
});

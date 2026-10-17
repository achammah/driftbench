import { afterEach, describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';

vi.mock('../../src/ladders/estate/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/pipeline')>();
  return { ...actual, estateRun: vi.fn(actual.estateRun) };
});

type Run = pipeline.EstateRun;
type Spec = Run['specs'][number];
const isStatic = (spec: Spec) => spec.record.path.startsWith('static/') && spec.record.path.endsWith('.json');

/** Runs gen.asks on seed 1 with the generated suite changed by `fault`. */
async function withSpecs(fault?: (specs: Spec[]) => Spec[]) {
  const actual = await vi.importActual<typeof pipeline>('../../src/ladders/estate/pipeline');
  vi.mocked(pipeline.estateRun).mockImplementation(async (seed, profile) => {
    const run = await actual.estateRun(seed, profile);
    return fault ? { ...run, specs: fault([...run.specs]) } : run;
  });
  return genAsksFamily().evaluate(1);
}
const first = (specs: Spec[], change: (spec: Spec) => Spec) => {
  const index = specs.findIndex(isStatic);
  if (index < 0) throw new Error('the suite holds no static test');
  specs[index] = change(specs[index] as Spec);
  return specs;
};
const json = (spec: Spec, change: (record: Record<string, unknown>) => void): Spec => {
  const record = JSON.parse(spec.text) as Record<string, unknown>;
  change(record);
  return { ...spec, text: JSON.stringify(record) };
};

describe('static tests are JSON for `estate static`, not task specs (docs/estate.md section 5)', {
  timeout: 300_000,
}, () => {
  afterEach(() => vi.mocked(pipeline.estateRun).mockReset());

  it('passes all-load and records-provenance on a suite that holds static tests', async () => {
    let count = 0;
    const results = await withSpecs((specs) => {
      count = specs.filter(isStatic).length;
      return specs;
    });
    expect(count).toBeGreaterThan(0);
    expect(results.get('gen.asks.all-load')).toMatchObject({ pass: true });
    expect(results.get('gen.asks.records-provenance')).toMatchObject({ pass: true });
  });

  it('fails all-load on a static test that is not JSON, or has no check', async () => {
    const broken = await withSpecs((specs) => first(specs, (spec) => ({ ...spec, text: '{ "id": ' })));
    expect(broken.get('gen.asks.all-load')).toMatchObject({
      pass: false,
      detail: expect.stringMatching(/^1 specs do not load: \S+/),
    });
    const bare = await withSpecs((specs) =>
      first(specs, (spec) => json(spec, (record) => delete record.check)),
    );
    expect(bare.get('gen.asks.all-load')).toMatchObject({
      pass: false,
      detail: expect.stringMatching(/^1 specs do not load: \S+/),
    });
  });

  // Records `driftbench estate static` refuses (its StaticTest schema): each must fail all-load (review of PR 239).
  it.each([
    [
      'a test type the runner does not know',
      (record: Record<string, unknown>) => {
        record.testType = 'bogus';
      },
    ],
    [
      'an empty check',
      (record: Record<string, unknown>) => {
        record.check = {};
      },
    ],
    [
      'a check that is a list',
      (record: Record<string, unknown>) => {
        record.check = [];
      },
    ],
    [
      'no title',
      (record: Record<string, unknown>) => {
        delete record.title;
      },
    ],
    [
      'an extra field',
      (record: Record<string, unknown>) => {
        record.extra = 1;
      },
    ],
  ])('fails all-load on a static test with %s', async (_name, fault) => {
    const results = await withSpecs((specs) => first(specs, (spec) => json(spec, fault)));
    expect(results.get('gen.asks.all-load')).toMatchObject({
      pass: false,
      detail: expect.stringMatching(/^1 specs do not load: \S+/),
    });
  });

  it('fails all-load on a task spec that does not load', async () => {
    const results = await withSpecs((specs) => {
      const index = specs.findIndex((spec) => !isStatic(spec) && spec.loaded);
      const { loaded: _loaded, ...rest } = specs[index] as Spec;
      specs[index] = { ...rest, errors: ['planted'] } as Spec;
      return specs;
    });
    expect(results.get('gen.asks.all-load')).toMatchObject({
      pass: false,
      detail: expect.stringMatching(/^1 specs do not load: \S+/),
    });
  });

  it('fails records-provenance on a static test with another map hash, or no atom', async () => {
    const stale = await withSpecs((specs) =>
      first(specs, (spec) =>
        json(spec, (record) => {
          record.mapHash = '0'.repeat(64);
        }),
      ),
    );
    expect(stale.get('gen.asks.records-provenance')).toMatchObject({ pass: false });
    const anonymous = await withSpecs((specs) =>
      first(specs, (spec) => json(spec, (record) => delete record.atom)),
    );
    expect(anonymous.get('gen.asks.records-provenance')).toMatchObject({ pass: false });
  });
});

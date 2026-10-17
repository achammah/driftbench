import { describe, expect, it, vi } from 'vitest';
import { FIXTURE } from '../../src/ladders/estate/bank/fixture-suite';
import { unitFamily } from '../../src/ladders/estate/bank/unit';

type Plan = { code: number; rows: (id: string) => Array<Record<string, unknown>> };
let variant: Plan | undefined;
const realRuns = new Map<string, { code: number; out: string }>();

vi.mock('../../src/ladders/estate/bank/bench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/bank/bench')>();
  return {
    ...actual,
    cli: (args: string[], cwd?: string) => {
      if (args[0] !== 'estate' || args[1] !== 'unit' || args.includes('--record'))
        return actual.cli(args, cwd);
      const at = args.indexOf('--estate');
      const root = args[at + 1] as string;
      // The real runner on the real fixture names the tests and says they pass; a variant is judged from the plan.
      const onFixture = args.map((arg, index) => (index === at + 1 ? FIXTURE : arg));
      const key = onFixture.join(' ');
      const real = realRuns.get(key) ?? actual.cli(onFixture, cwd);
      realRuns.set(key, real);
      if (root === FIXTURE || variant === undefined) return real;
      const ids = (
        JSON.parse(real.out.slice(real.out.indexOf('{'))) as { runs: Array<{ spec: string }> }
      ).runs.map((run) => run.spec);
      const out = JSON.stringify({
        runs: ids.flatMap((id) => variant?.rows(id) ?? []),
        guards: [],
        scripts: [],
      });
      return { code: variant.code, out };
    },
  };
});

const CELL = 'unit.runner.allow-all-block-force-push.sh';

async function verdict(plan: Plan | undefined) {
  variant = plan;
  const result = await unitFamily().evaluate(1);
  return result.get(CELL);
}

describe('unit.runner reads a kill only from a valid red row', { timeout: 300_000 }, () => {
  it('counts a spec green on the original and red on the variant', async () => {
    expect(
      await verdict({ code: 1, rows: (id) => [{ spec: id, pass: false, failing: ['denied nothing'] }] }),
    ).toEqual({ pass: true, detail: 'holds' });
  });

  it('does not count a row without a boolean pass as red', async () => {
    expect((await verdict({ code: 1, rows: (id) => [{ spec: id, failing: ['x'] }] }))?.pass).toBe(false);
    expect((await verdict({ code: 1, rows: (id) => [{ spec: id, pass: 'false' }] }))?.pass).toBe(false);
  });

  it('does not count valid red rows from a run that exited with an input error', async () => {
    expect(
      await verdict({ code: 2, rows: (id) => [{ spec: id, pass: false, failing: ['cannot run'] }] }),
    ).toMatchObject({ pass: false, detail: expect.stringContaining('exited 2') });
  });
});

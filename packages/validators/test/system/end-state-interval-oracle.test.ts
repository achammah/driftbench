import { fileURLToPath } from 'node:url';
import * as report from '@agent-nexus/driftbench-report';
import * as stats from '@agent-nexus/driftbench-stats';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runItem, scratchFolder } from '../../src/ladders/system/bank';
import { reportItems } from '../../src/ladders/system/bank/claims/report';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const ID = 'claim/report/end-state-rate';
const item = (() => {
  const found = reportItems().find((entry) => entry.id === ID);
  if (!found) throw new Error(`Missing ${ID}`);
  return found;
})();

/** Seeds 1 to 3 and two fresh ones above 1000. */
const SEEDS = [1, 2, 3, 1017, 2031];

type Compared = { n: number; k: number };

/** The runs of the scorecard's data that compared an end state, as counts per golden (spec, target, mode, perturbation). */
function goldens(data: report.CampaignData): Compared[] {
  const counts = new Map<string, Compared>();
  for (const run of data.runs) {
    if (run.endState === undefined) continue;
    const key = [
      run.specId,
      run.specHash,
      JSON.stringify(run.target),
      run.mode,
      run.perturbationId ?? '',
    ].join('|');
    const held = counts.get(key) ?? { n: 0, k: 0 };
    held.n += 1;
    if (run.endState.match) held.k += 1;
    counts.set(key, held);
  }
  return [...counts.values()];
}

type Endstate = NonNullable<report.Scorecard['endState']>;

/**
 * A product that follows the documented method, built from the statistics package (not from the validator's own
 * arithmetic): the interval over goldens, with the plain Wilson interval for one golden, for one run in every golden,
 * and the goldens counted once when every run agrees.
 */
function rightEndState(data: report.CampaignData): Endstate | undefined {
  const counts = goldens(data);
  const n = counts.reduce((sum, c) => sum + c.n, 0);
  if (n === 0) return undefined;
  const k = counts.reduce((sum, c) => sum + c.k, 0);
  const plain = stats.wilson(k, n);
  const base = { k, n, method: 'wilson' as const };
  if (counts.length < 2 || counts.every((c) => c.n === 1)) return { ...base, ...plain };
  if (k === 0 || k === n) {
    const once = stats.wilson(k === n ? counts.length : 0, counts.length);
    return { ...base, estimate: plain.estimate, lower: once.lower, upper: once.upper };
  }
  const w = stats.wilsonEffective(counts, { quantile: 't' });
  return { ...base, estimate: w.estimate, lower: w.lower, upper: w.upper };
}

function product(change: (card: report.Scorecard, data: report.CampaignData) => void) {
  const original = report.buildScorecard;
  return vi.spyOn(report, 'buildScorecard').mockImplementation((data, ...rest) => {
    const card = original(data, ...rest);
    change(card, data);
    return card;
  });
}

async function verdicts(seeds: readonly number[]) {
  const scratch = scratchFolder();
  try {
    const out: { seed: number; pass: boolean; detail?: string }[] = [];
    for (const seed of seeds) {
      const result = await runItem(item, seed, root, scratch.path);
      out.push({ seed, pass: result.pass, ...(result.pass ? {} : { detail: result.detail }) });
    }
    return out;
  } finally {
    scratch.remove();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('system item claim/report/end-state-rate', () => {
  it('passes a product that follows the documented method, on seeds 1 to 3 and two fresh seeds', async () => {
    product((card, data) => {
      const right = rightEndState(data);
      if (right) card.endState = right;
    });
    for (const verdict of await verdicts(SEEDS)) expect(verdict.pass, verdict.detail).toBe(true);
  }, 240_000);

  it('fails a product that reads the runs of a golden as independent (the plain Wilson interval on every run)', async () => {
    product((card, data) => {
      const n = goldens(data).reduce((sum, c) => sum + c.n, 0);
      const k = goldens(data).reduce((sum, c) => sum + c.k, 0);
      if (n > 0) card.endState = { k, n, method: 'wilson', ...stats.wilson(k, n) };
    });
    for (const verdict of await verdicts(SEEDS)) expect(verdict.pass, 'seed ' + verdict.seed).toBe(false);
  }, 240_000);

  it('fails a product that reports a too wide interval', async () => {
    product((card, data) => {
      const right = rightEndState(data);
      if (right) card.endState = { ...right, lower: 0, upper: 1 };
    });
    for (const verdict of await verdicts(SEEDS)) expect(verdict.pass, 'seed ' + verdict.seed).toBe(false);
  }, 240_000);

  it('fails a product that reports wrong counts with the right interval', async () => {
    for (const wrong of [
      (right: Endstate): Endstate => ({ ...right, k: right.k + 1 }),
      (right: Endstate): Endstate => ({ ...right, n: right.n + 1 }),
    ]) {
      product((card, data) => {
        const right = rightEndState(data);
        if (right) card.endState = wrong(right);
      });
      for (const verdict of await verdicts([1, 1017]))
        expect(verdict.pass, 'seed ' + verdict.seed).toBe(false);
      vi.restoreAllMocks();
    }
  }, 240_000);

  it('fails a product that measures a design effect from runs that stand alone (one run per golden)', async () => {
    product((card, data) => {
      const right = rightEndState(data);
      const counts = goldens(data);
      if (!right || counts.length < 2 || !counts.every((c) => c.n === 1)) return;
      if (right.k === 0 || right.k === right.n) return;
      const w = stats.wilsonEffective(counts, { quantile: 't' });
      card.endState = { ...right, lower: w.lower, upper: w.upper };
    });
    const scratch = scratchFolder();
    try {
      // The item hands the product the first run of every golden: the clustered formula there is wider than Wilson.
      for (const seed of SEEDS)
        expect((await runItem(item, seed, root, scratch.path)).pass, 'seed ' + seed).toBe(false);
    } finally {
      scratch.remove();
    }
  }, 240_000);

  it('fails a product that puts the normal-quantile clustered formula on runs that stand alone', async () => {
    product((card, data) => {
      const right = rightEndState(data);
      const counts = goldens(data);
      if (
        !right ||
        counts.length < 2 ||
        !counts.every((c) => c.n === 1) ||
        right.k === 0 ||
        right.k === right.n
      )
        return;
      const w = stats.wilsonEffective(counts, { quantile: 'z' });
      card.endState = { ...right, lower: w.lower, upper: w.upper };
    });
    for (const verdict of await verdicts([1, 1017])) expect(verdict.pass, 'seed ' + verdict.seed).toBe(false);
  }, 240_000);
});

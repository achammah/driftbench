import { describe, expect, it } from 'vitest';
import { type CalibrationItem, type ConversationReader, FeedError, feedVariables } from '../../src/feed';
import { FIXTURE_VARIABLES, fixtureStore, Population, simulatedReader } from './support';

const SEEDS = Number(process.env.FEED_COVERAGE_SEEDS ?? 20);
const POPULATION = 600;
const PER_CLASS = 30;

/** The conversations of one seed, and a calibration set with PER_CLASS conversations of every value. */
function scenario(seed: number) {
  const population = new Population(seed);
  const conversations = Array.from({ length: POPULATION }, (_, i) => ({
    id: `c${i}`,
    text: population.conversation().text,
  }));
  const calibration: CalibrationItem[] = FIXTURE_VARIABLES.flatMap((variable) =>
    variable.values.flatMap((value) =>
      Array.from({ length: PER_CLASS }, () => {
        const made = population.conversation({ [variable.id]: value.id });
        return { text: made.text, truth: { [variable.id]: value.id } };
      }),
    ),
  );
  return { population, conversations, calibration };
}

/** How many of the true shares fall inside their interval, over every value of every variable. */
async function coverage(
  spec: { accuracy: number | Record<string, number>; unsure: number },
  calibrated: boolean,
) {
  let inside = 0;
  let checks = 0;
  let width = 0;
  let seedsAllInside = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = scenario(seed);
    const result = await feedVariables({
      store: fixtureStore(),
      conversations: s.conversations,
      reader: simulatedReader(s.population, { ...spec, seed }),
      ...(calibrated ? { calibration: s.calibration } : {}),
      options: { estimate: { seed, resamples: 300 } },
    });
    let all = true;
    for (const variable of FIXTURE_VARIABLES) {
      const report = result.report.variables.find((v) => v.id === variable.id);
      expect(report?.status).toBe('fitted');
      for (const value of variable.values) {
        const entry = report?.values.find((v) => v.id === value.id);
        const hit = (entry?.lower ?? 1) <= value.mix && value.mix <= (entry?.upper ?? 0);
        checks++;
        if (hit) inside++;
        else all = false;
        width += (entry?.upper ?? 0) - (entry?.lower ?? 0);
      }
    }
    if (all) seedsAllInside++;
  }
  if (process.env.FEED_COVERAGE_VERBOSE) {
    process.stderr.write(
      `coverage ${inside}/${checks} = ${(inside / checks).toFixed(3)}, seeds with every share inside ${seedsAllInside}/${SEEDS}, mean width ${(width / checks).toFixed(3)}\n`,
    );
  }
  return { inside, checks, width: width / checks, seedsAllInside };
}

describe('the recovered weights against a known mix', () => {
  // A 95% interval holds the truth 95 times in 100, not 100. Over 20 seeds and 11 values (220 checks) about 11
  // misses are expected; fewer than 10% of misses is what a correct 95% interval gives with near certainty.
  it('keeps the true shares inside the interval when the reader is perfect (Wilson, no calibration)', async () => {
    const r = await coverage({ accuracy: 1, unsure: 0 }, false);
    expect(r.inside / r.checks).toBeGreaterThanOrEqual(0.9);
    expect(r.width).toBeLessThan(0.15);
  });

  it('keeps them inside when the reader errs, once a calibration set corrects the shares', async () => {
    const r = await coverage(
      { accuracy: { lost: 0.78, upset: 0.8, whatsapp: 0.85, late: 0.9 }, unsure: 0.05 },
      true,
    );
    expect(r.inside / r.checks).toBeGreaterThanOrEqual(0.9);
    expect(r.width).toBeLessThan(0.25);
  });

  it('misses them without the correction: the calibration is what makes the weights right', async () => {
    const r = await coverage(
      { accuracy: { lost: 0.78, upset: 0.8, whatsapp: 0.85, late: 0.9 }, unsure: 0.05 },
      false,
    );
    expect(r.inside / r.checks).toBeLessThan(0.75);
  });
});

describe('the fitted store', () => {
  it('holds weights, counts and a hash, and stays a valid store', async () => {
    const s = scenario(7);
    const { store, report } = await feedVariables({
      store: fixtureStore(),
      conversations: s.conversations,
      reader: simulatedReader(s.population, { accuracy: 0.95, unsure: 0.03, seed: 7 }),
    });
    expect(store.prior.kind).toBe('fitted');
    expect(store.prior.source).toContain(report.set_hash.slice(0, 12));
    const channel = store.variables.find((v) => v.id === 'channel');
    const weights = channel?.values.map((v) => v.weight ?? Number.NaN) ?? [];
    expect(weights).toHaveLength(4);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    for (const value of channel?.values ?? []) {
      const entry = value.provenance?.find((p) => p.kind === 'conversations');
      expect(entry).toMatchObject({ kind: 'conversations', set_hash: report.set_hash });
      if (entry?.kind === 'conversations') expect(entry.total).toBeLessThanOrEqual(POPULATION);
    }
  });

  it('keeps the quotes a value already had, and replaces an earlier conversations entry', async () => {
    const base = fixtureStore();
    const first = base.variables[0]?.values[0];
    if (!first) throw new Error('fixture has no value');
    first.provenance = [
      { kind: 'quote', path: 'agent/prompt.md', quote: 'a first-time user gets the long welcome' },
      { kind: 'conversations', count: 1, total: 2, set_hash: 'a'.repeat(64) },
    ];
    const s = scenario(3);
    const { store } = await feedVariables({
      store: base,
      conversations: s.conversations,
      reader: simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 3 }),
    });
    const provenance = store.variables[0]?.values[0]?.provenance ?? [];
    expect(provenance.filter((p) => p.kind === 'quote')).toHaveLength(1);
    const counts = provenance.filter((p) => p.kind === 'conversations');
    expect(counts).toHaveLength(1);
    expect(counts[0]).not.toMatchObject({ set_hash: 'a'.repeat(64) });
  });

  it('leaves the input store untouched', async () => {
    const base = fixtureStore();
    const before = JSON.stringify(base);
    const s = scenario(4);
    await feedVariables({
      store: base,
      conversations: s.conversations,
      reader: simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 4 }),
    });
    expect(JSON.stringify(base)).toBe(before);
  });

  it('reads only the variables asked for and leaves the others alone', async () => {
    const s = scenario(5);
    const { store, report } = await feedVariables({
      store: fixtureStore(),
      conversations: s.conversations,
      reader: simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 5 }),
      options: { variables: ['channel'] },
    });
    expect(report.variables.map((v) => v.id)).toEqual(['channel']);
    expect(store.variables.find((v) => v.id === 'customer_mood')?.values[0]?.weight).toBeUndefined();
  });
});

describe('what the feed refuses and what it reports', () => {
  it('skips a variable with too few decided conversations and keeps its weights', async () => {
    const s = scenario(6);
    const { report, store } = await feedVariables({
      store: fixtureStore(),
      conversations: s.conversations.slice(0, 10),
      reader: simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 6 }),
    });
    expect(report.variables.every((v) => v.status === 'skipped')).toBe(true);
    expect(store.prior.kind).toBe('declared');
    expect(store.variables[0]?.values[0]?.weight).toBeUndefined();
  });

  it('counts a conversation the reader failed on, and never keeps the error text', async () => {
    const s = scenario(8);
    const inner = simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 8 });
    let calls = 0;
    const flaky: ConversationReader = {
      ...inner,
      async read(conversation, questions) {
        if (calls++ % 5 === 0) throw new Error(`could not read: ${conversation}`);
        return inner.read(conversation, questions);
      },
    };
    const { report, store } = await feedVariables({
      store: fixtureStore(),
      conversations: s.conversations,
      reader: flaky,
    });
    expect(report.failed).toBe(POPULATION / 5);
    expect(report.variables[0]?.unread).toBe(POPULATION / 5);
    expect(JSON.stringify({ report, store })).not.toContain('could not read');
  });

  it('refuses a calibration with too few conversations of a value', async () => {
    const s = scenario(9);
    const withoutPhone = s.calibration.filter((item) => item.truth.channel !== 'phone');
    const fewPhone = s.calibration.filter((item) => item.truth.channel === 'phone').slice(0, 3);
    await expect(
      feedVariables({
        store: fixtureStore(),
        conversations: s.conversations,
        reader: simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 9 }),
        calibration: [...withoutPhone, ...fewPhone],
      }),
    ).rejects.toThrow(FeedError);
  });

  it('refuses an empty set and a store with nothing to read', async () => {
    const s = scenario(10);
    const reader = simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 10 });
    await expect(feedVariables({ store: fixtureStore(), conversations: [], reader })).rejects.toThrow(
      FeedError,
    );
    await expect(
      feedVariables({
        store: fixtureStore(),
        conversations: s.conversations,
        reader,
        options: { variables: ['nope'] },
      }),
    ).rejects.toThrow(/no variable nope/);
  });

  it('widens every interval when they must hold together', async () => {
    const s = scenario(11);
    const reader = simulatedReader(s.population, { accuracy: 1, unsure: 0, seed: 11 });
    const single = await feedVariables({ store: fixtureStore(), conversations: s.conversations, reader });
    const together = await feedVariables({
      store: fixtureStore(),
      conversations: s.conversations,
      reader,
      options: { simultaneous: true },
    });
    const width = (r: typeof single) =>
      r.report.variables[1]?.values.map((v) => (v.upper ?? 0) - (v.lower ?? 0)) ?? [];
    expect(width(together).every((w, i) => w > (width(single)[i] ?? 0))).toBe(true);
    expect(together.report.confidence).toBeGreaterThan(0.99);
  });
});

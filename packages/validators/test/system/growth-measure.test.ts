import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureGrowth, TIME_ROUNDS, timeGrowth } from '../../src/ladders/system/bank/growth';
import { GROWTH_BOUND, scaleItems } from '../../src/ladders/system/bank/scale';

/**
 * The growth measure of both flow-blocks growth items, on conversations written here. None of
 * them runs driftbench: each is a loop that adds two messages per block and then does the per-turn work of
 * one implementation, so the test says what the measure sees and nothing about the runner.
 */

type Message = { role: 'user' | 'assistant'; content: string };
type PerTurn = (history: Message[], turn: number) => void;

/** A conversation of `blocks` blocks: the user speaks, the implementation works, the assistant answers. */
function conversation(perTurn: PerTurn): (blocks: number) => Promise<void> {
  return async (blocks) => {
    const history: Message[] = [];
    for (let turn = 0; turn < blocks; turn += 1) {
      history.push({ role: 'user', content: `question ${turn}` });
      perTurn(history, turn);
      history.push({ role: 'assistant', content: `answer ${turn}` });
    }
  };
}

/** Where the work of an implementation goes, so no line of it is dead code. */
const sink = { size: 0 };
const registry = new WeakMap<object, number>();
const copy = (history: Message[]) => {
  sink.size += structuredClone(history).length;
};

/** Implementations whose work per turn is fixed: every one must pass. */
const CORRECT: Record<string, PerTurn> = {
  'no history work at all': () => {},
  'work on the new message only, and one pointer pass': (history, turn) => {
    const added = history[history.length - 1] as Message;
    registry.set(added, turn);
    Object.freeze(added);
    sink.size += history.slice().length + [...history].length + history.concat([]).length;
  },
};

/** Implementations whose work per turn grows with the history: every one must fail. */
const WRONG: Record<string, { perTurn: PerTurn; names: string }> = {
  'a full copy on every turn': { perTurn: copy, names: 'structuredClone' },
  'a full registration on every turn': {
    perTurn: (history, turn) => {
      for (let index = 0; index < history.length; index += 1) registry.set(history[index] as Message, turn);
    },
    names: 'WeakMap.set',
  },
  'a full ledger scan on every turn': {
    perTurn: (history) => {
      sink.size += history.filter((message) => message.role === 'assistant').length;
    },
    names: 'Array.filter',
  },
  'the whole history joined into one text on every turn': {
    perTurn: (history) => {
      sink.size += history.map((message) => `${message.role}: ${message.content}`).join('\n').length;
    },
    names: 'Array.map',
  },
  'a full copy on every second turn': {
    perTurn: (history, turn) => {
      if (turn % 2 === 0) copy(history);
    },
    names: 'structuredClone',
  },
  'a full copy only above 200 messages': {
    perTurn: (history) => {
      if (history.length > 200) copy(history);
    },
    names: 'structuredClone',
  },
};

/** A clock that never moves: the time bound holds, so the count of message visits alone decides. */
const still = { clock: () => 0, rounds: { min: 1, max: 1 }, timeBound: GROWTH_BOUND };

describe('the growth measure: message visits', () => {
  it.each(Object.keys(CORRECT))('passes %s', async (name) => {
    const growth = await measureGrowth(conversation(CORRECT[name] as PerTurn), 4, still);
    expect(growth.result).toEqual({ pass: true });
  });

  it.each(Object.keys(WRONG))('fails %s, and names the operation', async (name) => {
    const wrong = WRONG[name] as { perTurn: PerTurn; names: string };
    const growth = await measureGrowth(conversation(wrong.perTurn), 4, still);
    expect(growth.result.pass).toBe(false);
    expect(growth.result.pass ? '' : growth.result.detail).toContain('message visits at 40');
    expect(growth.result.pass ? '' : growth.result.detail).toContain(wrong.names);
  });

  it('gives the same verdict and the same detail on every measure', async () => {
    const details = new Set<string>();
    for (let again = 0; again < 5; again += 1) {
      const growth = await measureGrowth(conversation(copy), 4, still);
      details.add(growth.result.pass ? 'pass' : growth.result.detail);
    }
    expect(details.size).toBe(1);
  });
});

/**
 * The CPU times of twelve measures of an adapter that does no history work, recorded on a loaded machine
 * (fixtures/system/growth-timings.json says how). A test replays a trace through the clock of the measure:
 * each run takes the next recorded time of its size, so the verdict is the one this noise gives.
 */
type Trace = { one: number; ten: number[]; hundred: number[] };
const recorded = JSON.parse(
  readFileSync(new URL('../../fixtures/system/growth-timings.json', import.meta.url), 'utf8'),
) as { traces: Trace[] };

function replay(trace: Trace) {
  let now = 0;
  const next = { ten: 0, hundred: 0 };
  const take = (key: 'ten' | 'hundred') => {
    const list = trace[key];
    const value = list[next[key] % list.length] as number;
    next[key] += 1;
    return value;
  };
  return {
    clock: () => now,
    run: async (size: number) => {
      now += size === 40 ? take('ten') : size === 400 ? take('hundred') : trace.one;
    },
  };
}

describe('the growth measure: CPU time', () => {
  it('passes every recorded measure of an adapter with no history work', async () => {
    const failing: string[] = [];
    for (const [index, trace] of recorded.traces.entries()) {
      const { clock, run } = replay(trace);
      const growth = await measureGrowth(run, 4, { clock, timeBound: GROWTH_BOUND });
      if (!growth.result.pass) failing.push(`trace ${index}: ${growth.result.detail}`);
    }
    expect(recorded.traces).toHaveLength(12);
    expect(failing).toEqual([]);
  });

  it('keeps the bound of the bank: a best case 26 times larger fails, 24 times passes', async () => {
    expect(GROWTH_BOUND).toBe(25);
    const over = replay({ one: 1, ten: [3], hundred: [78] });
    const under = replay({ one: 1, ten: [3], hundred: [72] });
    const failed = await measureGrowth(over.run, 4, { clock: over.clock, timeBound: GROWTH_BOUND });
    const passed = await measureGrowth(under.run, 4, { clock: under.clock, timeBound: GROWTH_BOUND });
    expect(failed.result.pass).toBe(false);
    expect(failed.result.pass ? '' : failed.result.detail).toContain('26.0 times');
    expect(passed.result).toEqual({ pass: true });
  });

  it('fails a quadratic run however often it is timed', async () => {
    // 4 ms at 40 blocks and 400 ms at 400: a hundred times, with the spread of a loaded machine on top.
    const quadratic = replay({ one: 1, ten: [4, 9, 5, 14, 4.4], hundred: [400, 520, 431, 780] });
    const growth = await measureGrowth(quadratic.run, 4, { clock: quadratic.clock, timeBound: GROWTH_BOUND });
    expect(growth.result.pass).toBe(false);
  });
});

describe('the bank item', () => {
  it.each([
    ['flow-blocks', 'packages/core/src/runner/run.ts'],
    ['flow-blocks-teacher-forced', 'packages/core/src/runner/given.ts'],
  ])('keeps %s identity and states both bounds', (name, component) => {
    const item = scaleItems().find((entry) => entry.id === `scale/${name}/growth`);
    expect(item).toMatchObject({
      family: 'scale',
      tier: 5,
      level: 11,
      component,
      cause: `${name}: the per-block cost does not grow with the size of the run`,
    });
    expect(item?.title).toContain('message visits');
    expect(item?.title).toContain(`${GROWTH_BOUND} times`);
  });
});

describe('the time measure of every growth item (timeGrowth)', () => {
  /** A run of `size` that costs the next recorded time of its size on a clock of its own. */
  function replay(ten: number[], hundred: number[]) {
    let now = 0;
    const next = { ten: 0, hundred: 0 };
    return {
      clock: () => now,
      run: async (size: number) => {
        const list = size === 600 ? ten : hundred;
        const key = size === 600 ? 'ten' : 'hundred';
        now += list[next[key] % list.length] as number;
        next[key] += 1;
      },
    };
  }

  it('reads the best case: one slow run at either size changes nothing', async () => {
    const noisy = replay([2.54, 6.8, 2.6, 13.7], [66, 66, 25.5, 89, 24.9, 30]);
    const time = await timeGrowth(noisy.run, 60, { clock: noisy.clock, timeBound: GROWTH_BOUND });
    expect(time.ten).toBeCloseTo(2.54, 6);
    expect(time.hundred).toBeCloseTo(24.9, 6);
    expect(time).toMatchObject({ rounds: TIME_ROUNDS.min, pass: true });
  });

  it('keeps the bound: a best case 26 times larger fails after the most rounds, 24 times passes', async () => {
    const over = replay([3], [78]);
    const under = replay([3], [72]);
    const failed = await timeGrowth(over.run, 60, { clock: over.clock, timeBound: GROWTH_BOUND });
    const passed = await timeGrowth(under.run, 60, { clock: under.clock, timeBound: GROWTH_BOUND });
    expect(failed).toMatchObject({ pass: false, rounds: TIME_ROUNDS.max });
    expect(failed.growth.toFixed(1)).toBe('26.0');
    expect(passed).toMatchObject({ pass: true, rounds: TIME_ROUNDS.min });
  });
});

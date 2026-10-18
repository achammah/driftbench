import { fail, type ItemResult, PASS } from './types';

/**
 * The growth measure of a conversation that gets longer (docs/validators.md section 12.2, item 4). The
 * property is one: the work of a turn must not grow with the history before it, so the work of a whole run
 * is not quadratic in its length. Two instruments measure it on the same runs, and both must hold.
 *
 * 1. Message visits, a count. While a run executes, the built-in operations that reach a message are
 *    counted: a callback of an array method called for a message, a clone or a serialisation of a message,
 *    a lookup or a registration keyed by a message, a reflection call on a message. The count is the same on
 *    every machine and under every load. A run of n blocks that does a fixed work per new message visits
 *    c + a * n messages, so a hundred times the size visits at most ten times what ten times the size does.
 *    The bound is that linear law plus the stated margin of VISIT_MARGIN.
 * 2. CPU time, the best case. The count does not see work written without a built-in (a loop that reads
 *    fields by index, an object spread), so the time bound of the bank stays, unchanged, on the same
 *    statistic: the best CPU time at a hundred times the size over the best at ten times. The best case of
 *    many interleaved runs replaces one sample over the best of three, so the load of the machine, which
 *    only ever adds time, no longer decides the verdict.
 *
 * What is not counted, by design: a pass that moves pointers only (a spread, `slice`, `concat`, a `for of`
 * loop). The function adapter hands the agent a fresh array on every turn, so every correct implementation
 * makes such a pass, and it costs under a nanosecond per message. The time bound holds its total.
 */

/** Linear growth from ten to a hundred times the size. */
export const LINEAR_GROWTH = 10;

/** The margin over the linear law that the count of message visits may take: one tenth. */
export const VISIT_MARGIN = 0.1;

/** The most the message visits may grow from ten to a hundred times the size: the linear law and its margin. */
export const VISIT_GROWTH_BOUND = LINEAR_GROWTH * (1 + VISIT_MARGIN);

/** The fewest rounds of timing, and the most when the best case is still over the bound. */
export const TIME_ROUNDS = { min: 6, max: 18 } as const;

/** The runs at ten times the size in one round of timing, before its one run at a hundred times. */
export const TEN_RUNS_PER_ROUND = 4;

const ROLES: ReadonlySet<unknown> = new Set(['user', 'assistant', 'system', 'tool']);

/** The built-ins as they were when this module loaded, so the meter never counts its own reads. */
const native = {
  isArray: Array.isArray,
  descriptor: Object.getOwnPropertyDescriptor,
  keys: Object.keys,
};

function ownValue(holder: object, key: PropertyKey): unknown {
  try {
    const found = native.descriptor(holder, key);
    return found && 'value' in found ? found.value : undefined;
  } catch {
    return undefined;
  }
}

/** A message: an object, not an array, whose own `role` is one of the four roles of the schema. */
function isMessage(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || native.isArray(value)) return false;
  return ROLES.has(ownValue(value, 'role'));
}

/** The length of a list of messages, read from its first and last entry; zero for anything else. */
function messageList(value: unknown): number {
  if (!native.isArray(value) || value.length === 0) return 0;
  return isMessage(ownValue(value, 0)) || isMessage(ownValue(value, value.length - 1)) ? value.length : 0;
}

/** The messages a clone or a serialisation of `value` reaches: itself, a list, or the lists it holds. */
function messagesWithin(value: unknown): number {
  if (isMessage(value)) return 1;
  if (native.isArray(value)) return messageList(value);
  if (value === null || typeof value !== 'object') return 0;
  let total = 0;
  let keys: string[];
  try {
    keys = native.keys(value);
  } catch {
    return 0;
  }
  for (const key of keys) {
    const held = ownValue(value, key);
    total += isMessage(held) ? 1 : messageList(held);
  }
  return total;
}

export type VisitCount = {
  /** Every counted visit of a message. */
  visits: number;
  /** The visits per built-in, such as `WeakMap.get` or `Array.filter`. */
  by: Record<string, number>;
  /** Where a sample of the visits came from: the calling frame, with the visits the sample stands for. */
  sites: Record<string, number>;
};

/** One visit in this many is traced to its calling frame, for the detail of a failing item. */
const SITE_STRIDE = 499;

type Patch = { holder: object; key: PropertyKey; original: unknown };

// biome-ignore lint/suspicious/noExplicitAny: the meter wraps built-ins of every signature.
type AnyFunction = (this: any, ...args: any[]) => any;

let metering = false;

/**
 * Runs `work` with the meter on and returns its value and the count. The built-ins are wrapped for the
 * time of the call only and restored in every case. One meter runs at a time: the bank runs its items one
 * after the other, and a second meter inside the first would count the first one's work as its own.
 */
export async function countMessageVisits<T>(
  work: () => Promise<T>,
): Promise<{ value: T; count: VisitCount }> {
  if (metering) throw new Error('the message meter is already running');
  metering = true;
  const count: VisitCount = { visits: 0, by: {}, sites: {} };
  const patches: Patch[] = [];
  let untilSite = SITE_STRIDE;

  const add = (name: string, visits: number): void => {
    if (visits <= 0) return;
    count.visits += visits;
    count.by[name] = (count.by[name] ?? 0) + visits;
    untilSite -= visits;
    if (untilSite > 0) return;
    const stands = SITE_STRIDE * (1 + Math.floor(-untilSite / SITE_STRIDE));
    untilSite += stands;
    const site = callingFrame(new Error().stack);
    count.sites[site] = (count.sites[site] ?? 0) + stands;
  };

  const wrap = (holder: object, key: PropertyKey, build: (original: AnyFunction) => AnyFunction): void => {
    const found = native.descriptor(holder, key);
    if (!found || typeof found.value !== 'function' || found.writable === false) return;
    patches.push({ holder, key, original: found.value });
    (holder as Record<PropertyKey, unknown>)[key] = build(found.value as AnyFunction);
  };

  // A callback of an array method, called for a message of a list of messages: one visit per call.
  for (const method of [
    'forEach',
    'map',
    'filter',
    'some',
    'every',
    'find',
    'findIndex',
    'findLast',
    'findLastIndex',
    'flatMap',
    'reduce',
    'reduceRight',
  ] as const) {
    wrap(
      Array.prototype,
      method,
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const callback = args[0];
          if (typeof callback !== 'function' || messageList(this) === 0) return original.apply(this, args);
          const name = `Array.${method}`;
          args[0] = function (this: unknown, ...inner: unknown[]) {
            add(name, 1);
            return (callback as AnyFunction).apply(this, inner);
          };
          return original.apply(this, args);
        },
    );
  }

  // `join` turns every entry into text: one visit per message.
  wrap(
    Array.prototype,
    'join',
    (original) =>
      function (this: unknown, ...args: unknown[]) {
        add('Array.join', messageList(this));
        return original.apply(this, args);
      },
  );

  // A deep copy or a serialisation reaches every message it holds.
  wrap(
    globalThis,
    'structuredClone',
    (original) =>
      function (this: unknown, ...args: unknown[]) {
        add('structuredClone', messagesWithin(args[0]));
        return original.apply(this, args);
      },
  );
  wrap(
    JSON,
    'stringify',
    (original) =>
      function (this: unknown, ...args: unknown[]) {
        add('JSON.stringify', messagesWithin(args[0]));
        return original.apply(this, args);
      },
  );

  // A lookup or a registration keyed by a message.
  const keyed: Array<[string, object, readonly string[]]> = [
    ['WeakMap', WeakMap.prototype, ['get', 'set', 'has', 'delete']],
    ['WeakSet', WeakSet.prototype, ['add', 'has', 'delete']],
    ['Map', Map.prototype, ['get', 'set', 'has', 'delete']],
    ['Set', Set.prototype, ['add', 'has', 'delete']],
  ];
  for (const [owner, prototype, methods] of keyed) {
    for (const method of methods) {
      wrap(
        prototype,
        method,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            if (isMessage(args[0])) add(`${owner}.${method}`, 1);
            return original.apply(this, args);
          },
      );
    }
  }

  // Reflection on a message: what a copy, a freeze or a walk of its fields calls.
  const reflecting: Array<[string, object, readonly string[]]> = [
    [
      'Object',
      Object,
      [
        'keys',
        'values',
        'entries',
        'getOwnPropertyNames',
        'getOwnPropertyDescriptor',
        'getOwnPropertyDescriptors',
        'getPrototypeOf',
        'defineProperty',
        'defineProperties',
        'freeze',
        'isFrozen',
        'seal',
        'isSealed',
        'hasOwn',
      ],
    ],
    ['Reflect', Reflect, ['ownKeys', 'get', 'set', 'has', 'getOwnPropertyDescriptor', 'defineProperty']],
    ['Array', Array, ['isArray']],
  ];
  for (const [owner, holder, methods] of reflecting) {
    for (const method of methods) {
      wrap(
        holder,
        method,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            if (isMessage(args[0])) add(`${owner}.${method}`, 1);
            return original.apply(this, args);
          },
      );
    }
  }
  wrap(
    Object,
    'assign',
    (original) =>
      function (this: unknown, ...args: unknown[]) {
        let messages = 0;
        for (const entry of args) if (isMessage(entry)) messages += 1;
        add('Object.assign', messages);
        return original.apply(this, args);
      },
  );

  try {
    return { value: await work(), count };
  } finally {
    for (const patch of patches.reverse())
      (patch.holder as Record<PropertyKey, unknown>)[patch.key] = patch.original;
    metering = false;
  }
}

/** The first frame of a stack outside this file and outside Node: the code that asked for the visit. */
function callingFrame(stack: string | undefined): string {
  for (const line of (stack ?? '').split('\n').slice(1)) {
    const frame = line.trim().replace(/^at /, '');
    if (frame.includes('/bank/growth.') || frame.includes('node:') || frame.startsWith('Array.')) continue;
    const name = frame.includes(' (') ? frame.slice(0, frame.indexOf(' (')) : '';
    const path = (/([^/\\()]+\/[^/\\()]+\.[cm]?[jt]sx?)(?::\d+)*\)?$/.exec(frame.replace(/\?[^:]*/, '')) ??
      [])[1];
    return [name, path].filter(Boolean).join(' in ') || frame;
  }
  return 'unknown';
}

/** The CPU time this process has used, user plus system, in milliseconds. */
export function cpuClock(): number {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

export type GrowthOptions = {
  /** The CPU clock, in milliseconds. A test gives its own. */
  clock?: () => number;
  /** The rounds of timing. */
  rounds?: { min: number; max: number };
  /** The bound of the time growth: the bank's GROWTH_BOUND. */
  timeBound: number;
};

export type Growth = {
  sizes: { ten: number; hundred: number };
  visits: { ten: VisitCount; hundred: VisitCount; growth: number; bound: number; pass: boolean };
  time: { ten: number; hundred: number; growth: number; bound: number; rounds: number; pass: boolean };
  result: ItemResult;
};

export type TimeGrowth = Growth['time'];

/**
 * The time half of the growth measure, for any run whose cost should grow linearly with its size. A round is
 * TEN_RUNS_PER_ROUND runs at ten times `base` and then one run at a hundred times. The verdict reads the best
 * CPU time of each size over all the rounds: the load of the machine only ever adds time, so the best case of
 * many interleaved runs measures the work, where one run at each size measures the load as well. The measure
 * stops after the fewest rounds when the best case is within the bound, and goes on to the most when it is
 * not: more runs only ever lower a best case, on both sizes. The smaller time is taken as at least 1 ms.
 */
export async function timeGrowth(
  run: (size: number) => Promise<unknown>,
  base: number,
  options: GrowthOptions,
): Promise<TimeGrowth> {
  const sizes = { ten: base * 10, hundred: base * 100 };
  const clock = options.clock ?? cpuClock;
  const rounds = options.rounds ?? TIME_ROUNDS;
  const timed = async (size: number): Promise<number> => {
    const started = clock();
    await run(size);
    return clock() - started;
  };
  let bestTen = Number.POSITIVE_INFINITY;
  let bestHundred = Number.POSITIVE_INFINITY;
  let done = 0;
  const growth = () => bestHundred / Math.max(bestTen, 1);
  while (done < rounds.min || (done < rounds.max && growth() > options.timeBound)) {
    for (let again = 0; again < TEN_RUNS_PER_ROUND; again += 1)
      bestTen = Math.min(bestTen, await timed(sizes.ten));
    bestHundred = Math.min(bestHundred, await timed(sizes.hundred));
    done += 1;
  }
  return {
    ten: bestTen,
    hundred: bestHundred,
    growth: growth(),
    bound: options.timeBound,
    rounds: done,
    pass: growth() <= options.timeBound,
  };
}

/**
 * Measures the growth of `run` from ten to a hundred times `base`.
 *
 * Visits: one metered run at each size. The smaller count is taken as at least one visit per block, as the
 * time measure takes the smaller time as at least one millisecond, so a run that visits nothing at the
 * smaller size does not divide by zero.
 *
 * Time: `timeGrowth`, with the meter off.
 */
export async function measureGrowth(
  run: (size: number) => Promise<unknown>,
  base: number,
  options: GrowthOptions,
): Promise<Growth> {
  const sizes = { ten: base * 10, hundred: base * 100 };
  const clock = options.clock ?? cpuClock;
  const rounds = options.rounds ?? TIME_ROUNDS;

  const ten = (await countMessageVisits(() => run(sizes.ten))).count;
  const hundred = (await countMessageVisits(() => run(sizes.hundred))).count;
  const visitGrowth = hundred.visits / Math.max(ten.visits, sizes.ten);
  const visits = {
    ten,
    hundred,
    growth: visitGrowth,
    bound: VISIT_GROWTH_BOUND,
    pass: visitGrowth <= VISIT_GROWTH_BOUND,
  };

  const time = await timeGrowth(run, base, { ...options, clock, rounds });
  const { ten: bestTen, hundred: bestHundred, rounds: done } = time;

  const found: string[] = [];
  if (!visits.pass)
    found.push(
      `${ten.visits} message visits at ${sizes.ten}, ${hundred.visits} at ${sizes.hundred}: ` +
        `${visitGrowth.toFixed(1)} times, linear is ${LINEAR_GROWTH} and the bound is ${VISIT_GROWTH_BOUND} ` +
        `(${top(hundred.by)}; from ${top(hundred.sites)})`,
    );
  if (!time.pass)
    found.push(
      `best CPU time ${bestTen.toFixed(1)} ms at ${sizes.ten}, ${bestHundred.toFixed(1)} ms at ` +
        `${sizes.hundred}, over ${done} rounds: ${time.growth.toFixed(1)} times, the bound is ${options.timeBound}`,
    );
  return { sizes, visits, time, result: found.length === 0 ? PASS : fail(found.join('; ')) };
}

/** The three largest entries of a tally, as `name count`. */
function top(tally: Record<string, number>): string {
  const rows = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, visits]) => `${name} ${visits}`);
  return rows.length === 0 ? 'none' : rows.join(', ');
}

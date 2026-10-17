import { bankMeasure, defineLadder, type Ladder, type Measure } from '../../ladder';
import { BANK_LEVELS, type BankItem, bankItems, SeedData, type Tier, type Verdict } from './bank';
import type { GeneratorParts } from './measure';
import { type ScaleReport, scaleReport } from './scale';

export { acmeItems, acmeRun } from './acme';
export {
  BANK_COMPONENTS,
  BANK_LEVELS,
  type BankItem,
  bankItems,
  bankShape,
  causeOf,
  INTERACTIONS,
  SeedData,
  type Tier,
  type Verdict,
} from './bank';
export { baselineObjects, baselineSpecs, baselineSuite } from './baseline';
export {
  CHEATERS,
  type Cheater,
  cheaterAdapter,
  givenValues,
  type ReplayCall,
  replayCalls,
} from './cheaters';
export {
  combinedFault,
  DRIFT_CLASSES,
  FAULT_CLASSES,
  type FaultClass,
  faultClass,
  faultFamily,
  type HiddenFault,
} from './faults';
export {
  compose,
  createFollower,
  defaultInput,
  FOREIGN_REPLY,
  type Mutation,
  type MutationContext,
  userTurn,
} from './follower';
export * from './hidden';
export {
  type BlockRun,
  type FaultRecord,
  followerAdapter,
  type Generation,
  type GeneratorParts,
  generateFrom,
  generation,
  REFERENCE_REPEATS,
  type Runs,
  runAll,
  runContext,
} from './measure';
export * from './render';
export {
  SCALE_BUDGET_MS,
  SCALE_BUDGET_UNITS,
  SCALE_MIN_UNITS,
  SCALE_REFERENCE_UNIT_MS,
  type ScaleReport,
  scaledSpec,
  scaleReport,
  timeVerdict,
} from './scale';

/**
 * The generator validator (docs/validators.md sections 3 and 12): do generated tests catch what they claim?
 * From a hidden specification drawn by the seed, code writes the approved map, the rule follower, a fault
 * family of 70 classes, the cheaters and the hand-written suite; the real generator runs on the map, and its
 * complete specs run through the real runner and checks on all of them. The ladder is a bank of items in
 * thirteen levels; each level's threshold is 1.0, and a failing level prints the ids of its failing items.
 */

/** Evaluates a list of items on one seed's data, in order. */
export async function evaluate(
  items: readonly BankItem[],
  data: SeedData,
): Promise<Array<{ item: BankItem; verdict: Verdict }>> {
  const out: Array<{ item: BankItem; verdict: Verdict }> = [];
  for (const item of items) {
    if (data.parts.families && !data.parts.families.includes(item.family)) {
      out.push({
        item,
        verdict: { pass: false, detail: `the family ${item.family} was left out of this run` },
      });
      continue;
    }
    try {
      out.push({ item, verdict: await item.check(data) });
    } catch (cause) {
      out.push({
        item,
        verdict: {
          pass: false,
          detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
        },
      });
    }
  }
  return out;
}

function toMeasure(results: Array<{ item: BankItem; verdict: Verdict }>): Measure {
  return bankMeasure(
    results.map(({ item, verdict }) => ({
      id: item.id,
      component: item.component,
      family: item.family,
      tier: item.tier,
      pass: verdict.pass,
      detail: verdict.detail,
    })),
    'generator',
  );
}

export type GeneratorLadderOptions = GeneratorParts & {
  /** The items of the bank; the whole bank by default. */
  items?: readonly BankItem[];
};

/**
 * The generator ladder: one level per bank level, threshold 1.0. Each seed's data is built once per ladder
 * run. The scale runs are seed-independent in cost and run once per ladder, on the first seed asked.
 */
export function generatorLadder(options: GeneratorLadderOptions = {}): Ladder {
  const items = options.items ?? bankItems();
  const data = new Map<number, SeedData>();
  const scales = new Map<number, Promise<ScaleReport>>();
  let scaleSeed: number | undefined;
  const scale = (seed: number) => (factor: number) => {
    scaleSeed ??= seed;
    let found = scales.get(factor);
    if (!found) {
      found = scaleReport(factor, scaleSeed);
      scales.set(factor, found);
    }
    return found;
  };
  const dataFor = (seed: number) => {
    let found = data.get(seed);
    if (!found) {
      found = new SeedData(seed, options, scale(seed));
      data.set(seed, found);
    }
    return found;
  };
  return defineLadder({
    component: 'generator',
    levels: BANK_LEVELS.map((level) => {
      const own = items.filter((item) => item.level === level.id);
      return {
        id: level.id,
        name: level.name,
        metric: `items passing / items of the level (${own.length})`,
        threshold: 1,
        compute: async ({ seed }: { seed: number }) => toMeasure(await evaluate(own, dataFor(seed))),
      };
    }).filter((level) => items.some((item) => item.level === level.id)),
  });
}

/** One item's result over a set of seeds: passing on every seed, and the seeds it failed on. */
export type BankResult = { item: BankItem; pass: boolean; failedOn: number[]; detail: string };

/**
 * Evaluates every item of the bank on every seed, with no stop at a failing level: the bank score of the
 * hardness measurement (section 12.4) is the items passing on every seed over the bank.
 */
export async function evaluateBank(
  seeds: readonly number[],
  options: GeneratorLadderOptions = {},
): Promise<{ results: BankResult[]; score: number }> {
  const items = options.items ?? bankItems();
  const scales = new Map<number, Promise<ScaleReport>>();
  const first = seeds[0] ?? 1;
  const scale = (factor: number) => {
    let found = scales.get(factor);
    if (!found) {
      found = scaleReport(factor, first);
      scales.set(factor, found);
    }
    return found;
  };
  const failedOn = new Map<string, number[]>();
  const details = new Map<string, string>();
  for (const seed of seeds) {
    const results = await evaluate(items, new SeedData(seed, options, scale));
    for (const { item, verdict } of results) {
      if (!verdict.pass) {
        failedOn.set(item.id, [...(failedOn.get(item.id) ?? []), seed]);
        if (!details.has(item.id)) details.set(item.id, verdict.detail);
      }
    }
  }
  const results = items.map((item) => ({
    item,
    pass: !failedOn.has(item.id),
    failedOn: failedOn.get(item.id) ?? [],
    detail: details.get(item.id) ?? 'passes on every seed',
  }));
  return { results, score: results.filter((result) => result.pass).length / Math.max(1, results.length) };
}

/** The hardness forecast from bank scores: iteration 0, then the pilot's iterations, in order. */
export function forecast(
  bankSize: number,
  scores: readonly number[],
): {
  passingAtZero: number;
  passingAfter: number;
  fixedPerIteration: number;
  remaining: number;
  iterations: number;
  gate: boolean;
} {
  const passing = scores.map((score) => Math.round(score * bankSize));
  const passingAtZero = passing[0] ?? 0;
  const passingAfter = passing.at(-1) ?? passingAtZero;
  const pilot = Math.max(1, passing.length - 1);
  const fixedPerIteration = (passingAfter - passingAtZero) / pilot;
  const remaining = bankSize - passingAfter;
  const iterations = fixedPerIteration <= 0 ? Number.POSITIVE_INFINITY : remaining / fixedPerIteration;
  return {
    passingAtZero,
    passingAfter,
    fixedPerIteration,
    remaining,
    iterations,
    gate: iterations >= 100 && passingAfter / bankSize <= 0.4,
  };
}

export type { Tier as BankTier };

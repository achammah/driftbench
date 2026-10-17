import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type HiddenSpec, hiddenSpec } from './hidden';

/**
 * The scale items (docs/validators.md section 12.2, item 4): the hidden specification of a seed with its
 * behaviours multiplied by 10 and by 100, generated under a CPU-time and memory budget in a child process
 * that is killed at a wall-clock cap. Correct and slow is a failing item. The child is `scale-child.ts`.
 */

/**
 * CPU-time budget of one scale run, in milliseconds, per factor; the two generations get half. CPU time, not
 * wall clock, so the verdict does not depend on how busy the machine is.
 */
export const SCALE_BUDGET_MS: Record<number, number> = { 10: 60_000, 100: 120_000 };

/** The child is killed at this many times its budget of wall clock: a hang, never a slow but busy machine. */
export const SCALE_WALL_CAP = 10;

/** The heap the child may use, in megabytes. */
export const SCALE_HEAP_MB = 2048;

/**
 * The time items divide the CPU time of the two runs by the reference unit (`scale-unit.ts`), sampled beside
 * the runs, so the budget is in work the host could have done, not in host seconds. Derivation and the runs
 * behind each number: validators/CONSTANTS.md, "Generator scale".
 */
/**
 * The reference unit's CPU time on the host class that judges, in milliseconds: its mean over the 9 clean 100 times
 * windows of three separate jobs on the CI runner (ubuntu-24.04), with the product of main and PR 726, where the
 * jobs' CPU time ranged from 39.6 to 53.3 s.
 */
export const SCALE_REFERENCE_UNIT_MS = 54.5;
/** The time budget per factor, in reference units: half of SCALE_BUDGET_MS divided by SCALE_REFERENCE_UNIT_MS. */
export const SCALE_BUDGET_UNITS: Record<number, number> = { 10: 550, 100: 1100 };
/** Fewer unit samples than this during the runs measure nothing: the time item fails. */
export const SCALE_MIN_UNITS = 10;
/** The sampler's units that end before the window starts: their code is still being compiled. */
export const SCALE_UNIT_WARMUP = 5;

export type ScaleReport = {
  factor: number;
  budgetMs: number;
  /** Set when the run did not finish: over budget, out of memory, or a throw. */
  error?: string;
  ms: number;
  invalid: number;
  lint: number;
  bytesSame: boolean;
  graphOk: boolean;
  graphDetail: string;
  twiseShare: number;
  boundaryOk: boolean;
  boundaryMissing: number;
  deviationOk: boolean;
  deviationMissing: number;
  unwalked: number;
  completeShare: number;
  followerPass: number;
  followerTotal: number;
  /** The mean CPU time of the reference units that ended during the measured runs, in milliseconds. */
  unitMs: number;
  /** How many reference units ended during the measured runs. */
  unitSamples: number;
};

/**
 * The verdict of a scale time item: the CPU time of the two runs, in reference units, within the factor's
 * budget. The unit is read in a long window: the 100 times run of the same ladder run (`unit`), which the time
 * items of both factors divide by. A short window reads the unit dearer, since the product is starting up
 * beside the sampler for a larger share of it, and a dearer unit counts fewer units. Without `unit`, the report's
 * own window is read. Fewer than SCALE_MIN_UNITS samples in the window read fail the item.
 */
export function timeVerdict(report: ScaleReport, unit: ScaleReport = report): [boolean, string] {
  const budget = SCALE_BUDGET_UNITS[report.factor];
  if (budget === undefined) return [false, `no budget in reference units for ${report.factor} times`];
  const where = unit === report ? 'during the runs' : `during the ${unit.factor} times runs`;
  if (unit.unitSamples < SCALE_MIN_UNITS)
    return [
      false,
      `two runs took ${report.ms} ms of CPU time, but the reference unit was sampled ${unit.unitSamples} times ${where}, fewer than the ${SCALE_MIN_UNITS} the budget needs`,
    ];
  const units = report.ms / unit.unitMs;
  return [
    units <= budget,
    `two runs took ${report.ms} ms of CPU time, ${Math.round(units)} reference units (a unit took ${unit.unitMs.toFixed(1)} ms, the mean of ${unit.unitSamples} samples taken ${where}); the budget is ${budget} units, ${Math.round(budget * SCALE_REFERENCE_UNIT_MS)} ms where a unit takes ${SCALE_REFERENCE_UNIT_MS} ms`,
  ];
}

/** The hidden specification with `factor` times its behaviours, each with a phrase, spread over the flows. */
export function scaledSpec(seed: number, factor: number): HiddenSpec {
  const spec = hiddenSpec(seed);
  const extra = spec.behaviours.length * (factor - 1);
  for (let index = 0; index < extra; index += 1) {
    const id = `B-${String(1000 + index)}`;
    spec.behaviours.push({ id, title: `Keep generic rule number ${index + 1} of the scaled agent` });
    spec.phrases.push({
      dimension: 'behaviour',
      value: id,
      text: `Please keep generic rule number ${index + 1}.`,
      lang: spec.lang,
      intent: { kind: 'behaviour', behaviour: id },
    });
    spec.flows[index % spec.flows.length]?.behaviours.push(id);
  }
  return spec;
}

function failed(factor: number, budgetMs: number, error: string): ScaleReport {
  return {
    factor,
    budgetMs,
    error,
    ms: budgetMs,
    invalid: -1,
    lint: -1,
    bytesSame: false,
    graphOk: false,
    graphDetail: error,
    twiseShare: 0,
    boundaryOk: false,
    boundaryMissing: -1,
    deviationOk: false,
    deviationMissing: -1,
    unwalked: -1,
    completeShare: 0,
    followerPass: 0,
    followerTotal: 0,
    unitMs: 0,
    unitSamples: 0,
  };
}

/**
 * Runs the child for one factor and seed, kills it at the budget, and returns what it reported. A test may
 * lower the heap, name a module overriding the package's `generateSuiteToDisk` or `loadApprovedMap`, and name a
 * module the reference unit sampler imports first (`unitImport`, to plant a slower host).
 */
export function scaleReport(
  factor: number,
  seed: number,
  budgetMs = SCALE_BUDGET_MS[factor] ?? 60_000,
  options: { heapMb?: number; generator?: string; unitImport?: string } = {},
): Promise<ScaleReport> {
  const child = fileURLToPath(new URL('./scale-child.ts', import.meta.url));
  const { DRIFTBENCH_SCALE_UNIT_IMPORT: _planted, ...inherited } = process.env;
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [
        `--max-old-space-size=${options.heapMb ?? SCALE_HEAP_MB}`,
        '--import',
        'tsx',
        child,
        String(factor),
        String(seed),
        String(budgetMs),
        ...(options.generator ? [options.generator] : []),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...inherited,
          ...(options.unitImport ? { DRIFTBENCH_SCALE_UNIT_IMPORT: options.unitImport } : {}),
        },
      },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(
        failed(
          factor,
          budgetMs,
          `still running after ${SCALE_WALL_CAP * budgetMs} ms of wall clock at ${factor} times the behaviours: killed`,
        ),
      );
    }, SCALE_WALL_CAP * budgetMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split('\n').at(-1) ?? '';
      try {
        resolve(JSON.parse(line) as ScaleReport);
      } catch {
        resolve(
          failed(
            factor,
            budgetMs,
            `the scale run exited ${code} without a report: ${err.trim().split('\n').slice(-3).join(' ')}`,
          ),
        );
      }
    });
  });
}

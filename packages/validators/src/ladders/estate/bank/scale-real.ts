import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot } from '../../../root';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { BUDGET_FLOOR_MS, BUDGET_PER_ATOM } from './scale';
import type { Count, RealFacts } from './scale-real-facts';

/**
 * scale-real: the real-size tier of level 7. The estate loop runs once on a synthetic estate of the size and shape
 * of a large working estate (scale-real-estate.ts: 6,900 files, 766 of them markdown, some 10 MB of prose, a standing
 * file of 148 KB with its rules deep inside, 64 skills a quarter of them nested, 34 helpers, 113 hooks behind one
 * dispatcher, and the changelogs, templates, examples and fixtures an estate keeps). Two kinds of item:
 *
 * - time: each stage within a budget that times only the stage's own work (planting the estate on disk and reading
 *   the map back are outside it). The budget is the per-atom rate of the 5,000-atom tier of `scale`, applied to the
 *   units of the estate: its files and 100 units per megabyte of prose.
 * - result: what the stages found, at the strictness of level 1. Every planted rule, gate, skill, reference, hook and
 *   cross-reference is found, no rule or live finding comes from a document that is not a rule, a skill's references
 *   are its own, the plan prints a summary and not a line per edge, generated asks differ, and maintenance retires
 *   exactly the tests whose atoms left. Correct and slow, or fast and wrong, is a failing item.
 *
 * Run it on a quiet machine: its times are wall-clock times.
 */

const COMPONENTS: Record<string, string> = {
  scan: 'packages/estate/src/scan/claude-code.ts',
  lint: 'packages/estate/src/lint/lint.ts',
  plan: 'packages/estate/src/plan/build.ts',
  generate: 'packages/generate/src/estate/generate.ts',
  impact: 'packages/estate/src/maintain/impact.ts',
  rules: 'packages/estate/src/scan/text.ts',
  graph: 'packages/estate/src/graph/edges.ts',
};
const TIMED = ['scan', 'lint', 'plan', 'generate', 'impact'] as const;

/** Units of work an estate of this shape holds: its files, and 100 for each megabyte of prose. */
export function realUnits(files: number, proseBytes: number): number {
  return Math.round(files + (proseBytes / 1_000_000) * 100);
}

export function realBudgetMs(stage: string, units: number): number {
  return Math.max(BUDGET_FLOOR_MS, (BUDGET_PER_ATOM[stage] ?? 1) * units);
}

type Result = {
  key: string;
  tier: Tier;
  title: string;
  component: string;
  judge(facts: Measured): string | undefined;
};
export type Measured = {
  files: number;
  proseBytes: number;
  scanMs: number;
  lintMs: number;
  planMs: number;
  generateMs: number;
  impactMs: number;
  lintOnDocuments: { findings: number; examples: string[] };
  lintDefects: { planted: number; found: number; missed: string[] };
  lintFalse: { findings: number; examples: string[] };
  planConsoleLines: number;
  gateTests: { complete: number; distinctAsks: number };
  removed: number;
  retired: number;
  facts: RealFacts;
};

const MAX_CONSOLE_LINES = 200;
const DISTINCT_ASKS = 0.8;

/** A count of planted items, all found: the item fails with what was missed. */
function allFound(what: string, count: Count | undefined): string | undefined {
  if (!count) return `no ${what} planted`;
  return count.found === count.planted
    ? undefined
    : `found ${count.found} of ${count.planted} planted ${what}, such as ${count.missed.join('; ')}`;
}

const RULE_KEYS = [
  ['standing-must', 'a rule with "must" deep in the standing file'],
  ['standing-never', 'a rule with "never" deep in the standing file'],
  ['standing-always', 'a rule with "always" deep in the standing file'],
  ['standing-only-when', 'a rule with "only when" deep in the standing file'],
  ['skill-must', 'the "must" rule of each skill'],
  ['helper-never', 'the "never" rule of each helper agent'],
] as const;
const GATE_KEYS = [
  ['before-read', '"Before you change X, read Y"'],
  ['read-first', '"Read Y first when you edit X"'],
  ['requires-loaded', '"Editing X requires Y loaded"'],
] as const;

const RESULTS: Result[] = [
  ...RULE_KEYS.map(
    ([key, title]): Result => ({
      key: `rules-${key}`,
      tier: 4,
      title: `${title} is found as a rule atom on its line`,
      component: COMPONENTS.rules as string,
      judge: (m) => allFound('rules', m.facts.rules[key]),
    }),
  ),
  ...GATE_KEYS.map(
    ([key, title]): Result => ({
      key: `gates-${key}`,
      tier: 4,
      title: `a read-before rule written ${title} is found as a gate`,
      component: COMPONENTS.rules as string,
      judge: (m) => allFound('gates', m.facts.gates[key]),
    }),
  ),
  {
    key: 'skills-found',
    tier: 3,
    title: 'every skill is found, the nested ones too',
    component: COMPONENTS.scan as string,
    judge: (m) => allFound('skills', m.facts.skills),
  },
  {
    key: 'references-found',
    tier: 3,
    title: 'every reference a skill names, and its cross-reference to a file of another skill, is found',
    component: COMPONENTS.graph as string,
    judge: (m) => allFound('references', m.facts.references),
  },
  {
    key: 'references-owned',
    tier: 4,
    title: "a skill's reference edges reach its own references and the files it names, never another skill's",
    component: COMPONENTS.graph as string,
    judge: (m) =>
      m.facts.foreignReferences.edges === 0
        ? undefined
        : `${m.facts.foreignReferences.skills} skills reach ${m.facts.foreignReferences.edges} references of other skills: ${m.facts.foreignReferences.examples.join('; ')}`,
  },
  {
    key: 'precision-rules',
    tier: 4,
    title:
      'a rule atom sits on a line that states a rule, not on filler: false rule atoms are bounded by the planted ones',
    component: COMPONENTS.rules as string,
    judge: (m) =>
      m.facts.precision.onFiller <= m.facts.precision.legit
        ? undefined
        : `${m.facts.precision.onFiller} rule atoms on lines that state nothing to do, against ${m.facts.precision.legit} lines that do, such as ${m.facts.precision.examples.join('; ')}`,
  },
  {
    key: 'precision-gates',
    tier: 4,
    title:
      'a gate atom sits on a read-before rule, not on filler: false gate atoms are bounded by the planted lines',
    component: COMPONENTS.rules as string,
    judge: (m) =>
      m.facts.precision.gatesOnFiller <= m.facts.precision.legit
        ? undefined
        : `${m.facts.precision.gatesOnFiller} gate atoms on lines that state nothing to do, against ${m.facts.precision.legit} lines that do`,
  },
  {
    key: 'lint-finds-defects',
    tier: 3,
    title:
      'the lint finds each step of a skill that cites a file the estate does not hold, and reports no more false missing references than were planted',
    component: COMPONENTS.lint as string,
    judge: (m) =>
      m.lintDefects.planted > 0 && m.lintDefects.found === m.lintDefects.planted
        ? m.lintFalse.findings <= m.lintDefects.planted
          ? undefined
          : `${m.lintFalse.findings} findings of a missing or ambiguous reference on citations of files the estate holds, against ${m.lintDefects.planted} planted defects, such as ${m.lintFalse.examples.join('; ')}`
        : `found ${m.lintDefects.found} of ${m.lintDefects.planted} planted missing references, such as ${m.lintDefects.missed.join('; ')}`,
  },
  {
    key: 'user-layer-found',
    tier: 4,
    title:
      'the user-level skill layer is read: its own folders, the links to folders elsewhere and the container of synced skills',
    component: COMPONENTS.scan as string,
    judge: (m) =>
      m.facts.user.found === m.facts.user.expected
        ? undefined
        : `found ${m.facts.user.found} of ${m.facts.user.expected} skills of the user layer, such as ${m.facts.user.missed.join(', ')} not`,
  },
  {
    key: 'user-layer-once',
    tier: 4,
    title: 'a skill reached twice (a link from the user layer into the project) is one skill',
    component: COMPONENTS.graph as string,
    judge: (m) =>
      m.facts.user.duplicates.length === 0
        ? undefined
        : `${m.facts.user.duplicates.length} skills are counted twice, such as ${m.facts.user.duplicates.join(', ')}`,
  },
  {
    key: 'user-layer-trash',
    tier: 3,
    title: 'the trash folder of the user layer is not read',
    component: COMPONENTS.scan as string,
    judge: (m) =>
      m.facts.user.trashRead.length === 0
        ? undefined
        : `${m.facts.user.trashRead.length} skills of the trash folder are read, such as ${m.facts.user.trashRead.join(', ')}`,
  },
  {
    key: 'roles-no-rules',
    tier: 4,
    title: 'a changelog, history log, template, example or fixture yields no rule atom',
    component: COMPONENTS.rules as string,
    judge: (m) =>
      m.facts.nonNormative.ruleAtoms === 0
        ? undefined
        : `${m.facts.nonNormative.ruleAtoms} rule atoms come from ${m.facts.nonNormative.documents} documents that are not rules, such as ${m.facts.nonNormative.examples.join('; ')}`,
  },
  {
    key: 'roles-no-findings',
    tier: 4,
    title: 'a changelog, history log, template, example or fixture is linted as no live reference',
    component: COMPONENTS.lint as string,
    judge: (m) =>
      m.lintOnDocuments.findings === 0
        ? undefined
        : `${m.lintOnDocuments.findings} findings on documents that are not rules, such as ${m.lintOnDocuments.examples.join('; ')}`,
  },
  {
    key: 'guards-resolved',
    tier: 4,
    title: 'a guard run through the dispatcher names the hook script it runs',
    component: COMPONENTS.scan as string,
    judge: (m) =>
      m.facts.guards.resolved === m.facts.guards.planted
        ? undefined
        : `${m.facts.guards.resolved} of ${m.facts.guards.planted} guards name their target, such as ${m.facts.guards.missedTarget.join(', ')} not`,
  },
  {
    key: 'guards-described',
    tier: 4,
    title: 'a guard carries the description its hook script and the registry give',
    component: COMPONENTS.scan as string,
    judge: (m) =>
      m.facts.guards.described === m.facts.guards.planted
        ? undefined
        : `${m.facts.guards.described} of ${m.facts.guards.planted} guards carry their description, such as ${m.facts.guards.missedText.join(', ')} not`,
  },
  {
    key: 'plan-console',
    tier: 3,
    title: `the real plan command prints a summary of at most ${MAX_CONSOLE_LINES} lines, never a line per edge`,
    component: COMPONENTS.plan as string,
    judge: (m) =>
      m.planConsoleLines >= 0 && m.planConsoleLines <= MAX_CONSOLE_LINES
        ? undefined
        : m.planConsoleLines < 0
          ? 'the scan or the plan command failed'
          : `the plan command prints ${m.planConsoleLines} lines`,
  },
  {
    key: 'generation-diversity',
    tier: 4,
    title: `at least ${DISTINCT_ASKS * 100} percent of the complete read-before tests ask differently`,
    component: COMPONENTS.generate as string,
    judge: (m) =>
      m.gateTests.complete > 0 && m.gateTests.distinctAsks >= DISTINCT_ASKS * m.gateTests.complete
        ? undefined
        : `${m.gateTests.distinctAsks} different asks over ${m.gateTests.complete} complete read-before tests`,
  },
  {
    key: 'impact-exact',
    tier: 3,
    title: 'maintenance retires exactly the tests whose atoms left the estate',
    component: COMPONENTS.impact as string,
    judge: (m) =>
      m.removed >= 1 && m.retired === m.removed
        ? undefined
        : `${m.removed} atoms left and ${m.retired} tests retired`,
  },
];

export type RealFamilyOptions = {
  /** 1 is the real size; the unit tests of the family run it smaller. */
  scale?: number;
  /** The most wall-clock time the worker may take; the stages' own budgets are judged inside it. */
  limitMs?: number;
};

function runWorker(
  seed: number,
  scale: number,
  limitMs: number,
): Promise<{ ok: true; value: Measured & Record<string, unknown> } | { ok: false; reason: string }> {
  const worker = fileURLToPath(new URL('./scale-real-worker.ts', import.meta.url));
  const root = findRoot(fileURLToPath(new URL('.', import.meta.url)));
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=8192', '--import', 'tsx', worker, String(seed), String(scale)],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), limitMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        resolve({
          ok: false,
          reason: `killed after ${Date.now() - started} ms (the limit is ${limitMs} ms)`,
        });
        return;
      }
      const line = out.trim().split('\n').pop() ?? '';
      try {
        const value = JSON.parse(line) as Measured & { error?: string };
        if (typeof value.error === 'string') resolve({ ok: false, reason: `the loop threw: ${value.error}` });
        else resolve({ ok: true, value });
      } catch {
        resolve({
          ok: false,
          reason: `exit ${code}, no result: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`,
        });
      }
    });
  });
}

/** The verdict of every item of the family on what one run of the loop measured. */
export function judgeReal(measured: Measured): Map<string, ItemResult> {
  const out = new Map<string, ItemResult>();
  const units = realUnits(measured.files, measured.proseBytes);
  for (const stage of TIMED) {
    const ms = Number(measured[`${stage}Ms` as keyof Measured]);
    const budget = realBudgetMs(stage, units);
    out.set(`scale-real.time-${stage}`, {
      pass: ms <= budget,
      detail: ms <= budget ? `holds (${ms} ms)` : `took ${ms} ms, over the budget of ${budget} ms`,
    });
  }
  for (const result of RESULTS) {
    let reason: string | undefined;
    try {
      reason = result.judge(measured);
    } catch (cause) {
      reason = `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    out.set(`scale-real.${result.key}`, { pass: reason === undefined, detail: reason ?? 'holds' });
  }
  return out;
}

export function scaleRealFamily(options: RealFamilyOptions = {}): Family {
  const family = 'scale-real';
  const scale = options.scale ?? 1;
  const limitMs = options.limitMs ?? 30 * 60_000;
  const items = itemsOf(family, 7, COMPONENTS.scan as string, [
    ...TIMED.map((stage) => ({
      key: `time-${stage}`,
      tier: 4 as Tier,
      title: `${stage} on a real-size estate within the per-atom rate of the 5,000-atom tier applied to its units (one per file, 100 per megabyte of prose), its own work timed`,
      component: COMPONENTS[stage] as string,
    })),
    ...RESULTS.map(({ key, tier, title, component }) => ({ key, tier, title, component })),
  ]);
  return {
    id: family,
    level: 7,
    component: COMPONENTS.scan as string,
    items,
    seedFree: true,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      const ran = await runWorker(seed, scale, limitMs);
      if (!ran.ok) {
        for (const item of items) out.set(item.id, { pass: false, detail: ran.reason });
        return out;
      }
      for (const [id, result] of judgeReal(ran.value)) out.set(id, result);
      return out;
    },
  };
}

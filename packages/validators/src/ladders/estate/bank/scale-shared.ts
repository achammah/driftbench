import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot } from '../../../root';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { realBudgetMs } from './scale-real';
import type { SharedFacts } from './scale-shared-facts';

/**
 * scale-shared: a sibling of the real-size tier for the shape that flattened a reference graph. Every skill and
 * helper of an estate (57 at full size) cites one shared index, the index cites thousands of files (3,500 at full
 * size) and a few of those cite further documents (scale-shared-estate.ts). Four items:
 *
 * - shared-edges-direct: a unit stores one reference edge for each citation in its own file and no other; a unit
 *   linked to what the index cites turns 57 units and 3,500 files into some 200,000 edges.
 * - shared-reach-exact: the files a unit reaches by following the citations of the map are exactly the planted ones,
 *   through the index and through the documents that cite on: not fewer (a citation left unread) and not more.
 * - shared-console: the real plan command prints a summary, not a line per edge.
 * - shared-time-scan: the scan within the per-atom budget of the 5,000-atom tier.
 */

const COMPONENTS = {
  scan: 'packages/estate/src/scan/claude-code.ts',
  graph: 'packages/estate/src/graph/edges.ts',
  plan: 'packages/estate/src/plan/build.ts',
} as const;
const MAX_CONSOLE_LINES = 200;

export type SharedMeasured = {
  files: number;
  units: number;
  scanMs: number;
  planConsoleLines: number;
  facts: SharedFacts;
};

type Result = {
  key: string;
  tier: Tier;
  title: string;
  component: string;
  judge(measured: SharedMeasured): string | undefined;
};

const RESULTS: Result[] = [
  {
    key: 'shared-time-scan',
    tier: 4,
    title:
      'the scan of a shared-index estate within the per-atom rate of the 5,000-atom tier applied to its files, its own work timed',
    component: COMPONENTS.scan,
    judge: (m) => {
      const budget = realBudgetMs('scan', m.files);
      return m.scanMs <= budget ? undefined : `took ${m.scanMs} ms, over the budget of ${budget} ms`;
    },
  },
  {
    key: 'shared-edges-direct',
    tier: 4,
    title:
      'a skill or helper stores one reference edge for each citation in its own file, never one for what the files it cites cite',
    component: COMPONENTS.graph,
    judge: (m) =>
      m.facts.edges.foreign === 0 && m.facts.edges.stored <= m.facts.edges.allowed
        ? undefined
        : `${m.facts.edges.stored} reference edges stored from the units, ${m.facts.edges.allowed} citations planted in their files, ${m.facts.edges.foreign} to citations of other files; ${m.facts.edges.examples.join('; ')}`,
  },
  {
    key: 'shared-reach-exact',
    tier: 4,
    title:
      'the files a skill or helper reaches by following the citations of the map are exactly the planted ones, through the shared index and the documents that cite on',
    component: COMPONENTS.scan,
    judge: (m) =>
      m.facts.reach.wrong === 0
        ? undefined
        : `${m.facts.reach.wrong} of ${m.facts.reach.units} units reach the wrong files (${m.facts.reach.missing} planted files missed, ${m.facts.reach.extra} not planted): ${m.facts.reach.examples.join('; ')}`,
  },
  {
    key: 'shared-console',
    tier: 3,
    title: `the real plan command prints a summary of at most ${MAX_CONSOLE_LINES} lines on a shared-index estate, never a line per edge`,
    component: COMPONENTS.plan,
    judge: (m) =>
      m.planConsoleLines >= 0 && m.planConsoleLines <= MAX_CONSOLE_LINES
        ? undefined
        : m.planConsoleLines < 0
          ? 'the scan or the plan command failed'
          : `the plan command prints ${m.planConsoleLines} lines`,
  },
];

export function judgeShared(measured: SharedMeasured): Map<string, ItemResult> {
  const out = new Map<string, ItemResult>();
  for (const result of RESULTS) {
    let reason: string | undefined;
    try {
      reason = result.judge(measured);
    } catch (cause) {
      reason = `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    out.set(`scale-shared.${result.key}`, { pass: reason === undefined, detail: reason ?? 'holds' });
  }
  return out;
}

export type SharedFamilyOptions = { scale?: number; limitMs?: number };

function runWorker(
  seed: number,
  scale: number,
  limitMs: number,
): Promise<{ ok: true; value: SharedMeasured } | { ok: false; reason: string }> {
  const worker = fileURLToPath(new URL('./scale-shared-worker.ts', import.meta.url));
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
        const value = JSON.parse(line) as SharedMeasured & { error?: string };
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

export function scaleSharedFamily(options: SharedFamilyOptions = {}): Family {
  const family = 'scale-shared';
  const scale = options.scale ?? 1;
  const limitMs = options.limitMs ?? 15 * 60_000;
  const items = itemsOf(
    family,
    7,
    COMPONENTS.scan,
    RESULTS.map(({ key, tier, title, component }) => ({ key, tier, title, component })),
  );
  return {
    id: family,
    level: 7,
    component: COMPONENTS.scan,
    items,
    seedFree: true,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      const ran = await runWorker(seed, scale, limitMs);
      if (!ran.ok) {
        for (const item of items) out.set(item.id, { pass: false, detail: ran.reason });
        return out;
      }
      for (const [id, result] of judgeShared(ran.value)) out.set(id, result);
      return out;
    },
  };
}

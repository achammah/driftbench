import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot } from '../../../root';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { realBudgetMs } from './scale-real';
import type { ShapeClass } from './scale-shared-estate';
import type { SharedFacts } from './scale-shared-facts';

/**
 * scale-shared: a sibling of the real-size tier for the shape that flattened a reference graph. Every skill and
 * helper of an estate (57 at full size) cites one shared index, the index cites thousands of files (3,500 at full
 * size) and a few of those cite further documents (scale-shared-estate.ts). The estate also plants the shapes a graph
 * walk gets wrong, so each failure has a cause of its own:
 *
 * - edges: a unit stores exactly the citations of its own file (never the ones its files cite), none to an atom that
 *   is not there, none twice, and the unit that shares a citation with the index keeps both.
 * - reach: the files a unit reaches by following the citations of the map are exactly the planted ones, judged for
 *   the whole estate and for each shape alone: the entries, a chain two and three documents deep, a document two
 *   entries cite, a relative form of a citation, a citation of a file the estate does not hold, and a unit's own
 *   references leaking into another unit.
 * - citations: the documents that cite in a shape of their own keep every citation: two documents that cite each
 *   other, a document that cites itself, a file that cites one document twice. A walk that drops an edge to a
 *   document it already met shows here and nowhere else.
 * - atoms: one reference atom for each citation, and a count of atoms that grows with the files.
 * - orphans: the two planted documents nothing names are listed, and no document that is named is.
 * - console and time: the real plan command prints a summary, and the scan and the plan stay within the per-atom
 *   budget of the 5,000-atom tier.
 */

const COMPONENTS = {
  scan: 'packages/estate/src/scan/claude-code.ts',
  graph: 'packages/estate/src/graph/edges.ts',
  plan: 'packages/estate/src/plan/build.ts',
  analyze: 'packages/estate/src/graph/analyze.ts',
} as const;
const MAX_CONSOLE_LINES = 200;
/** Atoms the scan may hold for each file and each citation: a bound that grows with the estate, not with its square. */
const ATOMS_PER_UNIT_OF_ESTATE = 3;

export type SharedMeasured = {
  files: number;
  units: number;
  scanMs: number;
  planMs: number;
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

/** An item about the files of one shape that a unit reaches: none missed, none that should not be there. */
function reachOf(
  key: string,
  kinds: readonly ShapeClass[],
  title: string,
  tier: Tier,
  component: string = COMPONENTS.scan,
): Result {
  return {
    key: `shared-reach-${key}`,
    tier,
    title,
    component,
    judge: (m) => {
      const slots = kinds.map((kind) => m.facts.reach.byClass[kind] ?? { missing: 0, extra: 0 });
      const missing = slots.reduce((sum, slot) => sum + slot.missing, 0);
      const extra = slots.reduce((sum, slot) => sum + slot.extra, 0);
      return missing === 0 && extra === 0
        ? undefined
        : `${missing} ${kinds.join('/')} files missed and ${extra} reached that should not be, over ${m.facts.reach.units} units`;
    },
  };
}

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
    key: 'shared-time-plan',
    tier: 4,
    title:
      'the scan and the plan commands of a shared-index estate within the per-atom rate of the 5,000-atom tier applied to its files',
    component: COMPONENTS.plan,
    judge: (m) => {
      const budget = realBudgetMs('plan', m.files) + realBudgetMs('scan', m.files);
      return m.planMs <= budget ? undefined : `took ${m.planMs} ms, over the budget of ${budget} ms`;
    },
  },
  {
    key: 'shared-edges-direct',
    tier: 4,
    title:
      'a skill or helper stores one reference edge for each citation in its own file and no other, never one for what the files it cites cite',
    component: COMPONENTS.graph,
    judge: (m) =>
      m.facts.edges.foreign === 0 && m.facts.edges.stored === m.facts.edges.allowed
        ? undefined
        : `${m.facts.edges.stored} reference edges stored from the units, ${m.facts.edges.allowed} citations planted in their files, ${m.facts.edges.foreign} to citations of other files; ${m.facts.edges.examples.join('; ')}`,
  },
  {
    key: 'shared-edges-per-unit',
    tier: 4,
    title: 'no skill or helper stores more reference edges than the citations of its own file',
    component: COMPONENTS.graph,
    judge: (m) =>
      m.facts.edges.overOwn <= 0
        ? undefined
        : `one unit stores ${m.facts.edges.overOwn} more edges than it cites`,
  },
  {
    key: 'shared-edges-resolved',
    tier: 3,
    title: 'every reference edge of a skill or helper ends at an atom of the map',
    component: COMPONENTS.graph,
    judge: (m) =>
      m.facts.edges.dangling === 0 ? undefined : `${m.facts.edges.dangling} reference edges end at no atom`,
  },
  {
    key: 'shared-edges-once',
    tier: 3,
    title: 'a reference edge between the same two atoms is stored once',
    component: COMPONENTS.graph,
    judge: (m) =>
      m.facts.edges.repeated === 0 ? undefined : `${m.facts.edges.repeated} reference edges stored twice`,
  },
  {
    key: 'shared-edges-mixed-owner',
    tier: 3,
    title:
      'a skill that cites a file the shared index also cites keeps its own edge to that file beside its edge to the index',
    component: COMPONENTS.graph,
    judge: (m) =>
      m.facts.edges.mixedKept ? undefined : 'the skill that cites a file the index also cites lost an edge',
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
  reachOf(
    'entries',
    ['index', 'entry'],
    'a skill or helper reaches the shared index and every entry the index cites, none missed',
    3,
  ),
  reachOf(
    'chain-two',
    ['chain-two'],
    'a skill or helper reaches the document an entry cites, one step past the index',
    3,
  ),
  reachOf(
    'chain-three',
    ['chain-three'],
    'a skill or helper reaches the document a document cites, two steps past the index',
    4,
  ),
  reachOf(
    'own',
    ['own'],
    'a skill reaches the references of its own folder and no skill reaches the references of another',
    3,
  ),
  reachOf(
    'fan-in',
    ['fan-in'],
    'a document that two entries cite is reached, whichever entry the walk comes through',
    4,
  ),
  reachOf(
    'relative-forms',
    ['relative'],
    'a citation written as a path relative to its file, with ./ or ../, reaches the file it names',
    4,
    COMPONENTS.graph,
  ),
  {
    key: 'shared-citation-cycle',
    tier: 4,
    title:
      'two documents that cite each other each keep their citation of the other, whichever of them the scan meets first',
    component: COMPONENTS.scan,
    judge: (m) =>
      m.facts.citing.cycle[0] === 1 && m.facts.citing.cycle[1] === 1
        ? undefined
        : `the two documents keep ${m.facts.citing.cycle[0]} and ${m.facts.citing.cycle[1]} citations of each other, planted 1 and 1`,
  },
  {
    key: 'shared-citation-self',
    tier: 4,
    title: 'a document that cites itself keeps that citation',
    component: COMPONENTS.scan,
    judge: (m) =>
      m.facts.citing.self === 1
        ? undefined
        : `the document keeps ${m.facts.citing.self} citations of itself, planted 1`,
  },
  {
    key: 'shared-citation-twice',
    tier: 3,
    title: 'a file that cites one document twice keeps both citations, one reference atom for each line',
    component: COMPONENTS.scan,
    judge: (m) =>
      m.facts.citing.twice === 2
        ? undefined
        : `the file keeps ${m.facts.citing.twice} citations of the document it cites twice, planted 2`,
  },
  {
    key: 'shared-reach-missing-target',
    tier: 4,
    title:
      'a citation of a file the estate does not hold reaches nothing, and its reference atom says the file is missing',
    component: COMPONENTS.scan,
    judge: (m) =>
      m.facts.reach.phantom === 0 && m.facts.missing.marked && m.facts.missing.wronglyMarked === 0
        ? undefined
        : `${m.facts.reach.phantom} files reached that the estate does not hold; the missing file ${m.facts.missing.marked ? 'is' : 'is not'} marked, ${m.facts.missing.wronglyMarked} held files are marked missing`,
  },
  {
    key: 'shared-atoms-per-citation',
    tier: 4,
    title:
      'the scan keeps one reference atom for each citation of a file, never one for each unit that reaches it',
    component: COMPONENTS.scan,
    judge: (m) =>
      m.facts.atoms.references <= m.facts.atoms.planted
        ? undefined
        : `${m.facts.atoms.references} reference atoms for ${m.facts.atoms.planted} citations planted`,
  },
  {
    key: 'shared-atoms-linear',
    tier: 4,
    title: `the atoms of a shared-index estate number at most ${ATOMS_PER_UNIT_OF_ESTATE} for each file and each citation`,
    component: COMPONENTS.scan,
    judge: (m) => {
      const limit = ATOMS_PER_UNIT_OF_ESTATE * (m.facts.atoms.files + m.facts.atoms.planted);
      return m.facts.atoms.total <= limit
        ? undefined
        : `${m.facts.atoms.total} atoms for ${m.facts.atoms.files} files and ${m.facts.atoms.planted} citations (the limit is ${limit})`;
    },
  },
  {
    key: 'shared-orphans-found',
    tier: 3,
    title: 'the two documents nothing names are listed as orphans',
    component: COMPONENTS.analyze,
    judge: (m) =>
      m.facts.orphans.found === m.facts.orphans.planted
        ? undefined
        : `${m.facts.orphans.found} of ${m.facts.orphans.planted} planted orphans listed`,
  },
  {
    key: 'shared-orphans-none-named',
    tier: 3,
    title: 'no document that another file cites is listed as an orphan',
    component: COMPONENTS.analyze,
    judge: (m) =>
      m.facts.orphans.surplus.length === 0
        ? undefined
        : `${m.facts.orphans.surplus.length} named documents listed as orphans, such as ${m.facts.orphans.surplus[0]}`,
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

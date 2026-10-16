import { blockStatus, isScored } from '../runner/verdicts';
import type { RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import { canonicalJson } from '../spec/hash';
import { specHash } from '../spec/identity';
import { linkHolds, specLinks } from './links';
import type { SectionRegistry } from './sections';
import { defaultParentOf, type ParentRef } from './select';

/**
 * Fault localisation over prompt sections (M3.2): Ochiai suspiciousness per local section, from the
 * blocks' section links and their verdicts. A prompt has no execution trace, so a block "covers" the
 * sections it links to.
 *
 * Counting (deep report section 3.1, corrected by H5):
 * - A block is a row in a run unless it failed while an ancestor failed in the same run: that failure is
 *   inherited and dropped. A passing child of a failing parent STAYS a row: it is evidence that clears
 *   the sections it links to. (Dropping every child of a failing parent ranked worse than flat counting
 *   on 18 of 98 real faults in H5; dropping only inherited failures, on 3 of 98.)
 * - Soft weights over repeats: w_b = failed rows / rows of block b. n_cf(s) = sum of w_b over the blocks
 *   linked to s, n_cs(s) = sum of (1 - w_b), N_F = sum of w_b over all blocks.
 * - Ochiai(s) = n_cf / sqrt(N_F (n_cf + n_cs)); 0 when n_cf or N_F is 0.
 * - Global sections are excluded: a section linked to every block scores the same whatever it says.
 * - Ties are reported as a range: best rank and worst rank.
 */

/** One block: its key, the local sections it links to, and the blocks whose failure it inherits. */
export type LocalizeRow = { key: string; sections: readonly string[]; ancestors: readonly string[] };

/** One run of the suite: for each block key that ran, whether it failed. */
export type LocalizeRun = ReadonlyMap<string, boolean>;

export type SectionSuspicion = {
  section: string;
  score: number;
  /** n_cf: the failure weight of the blocks linked to the section. */
  failed: number;
  /** n_cs: the pass weight of the blocks linked to the section. */
  passed: number;
  /** Blocks linked to the section that were a row at least once. */
  linked: number;
  /** The rank range under ties: best (1 = first) and worst. */
  best: number;
  worst: number;
};

export type Localization = {
  /** Local sections, most suspicious first; ties keep the registry order. */
  sections: SectionSuspicion[];
  /** Global sections: not ranked. */
  global: string[];
  /** N_F: the total failure weight. 0 means nothing failed outside inherited failures. */
  failureWeight: number;
  /** Block observations counted as rows, and inherited failures dropped. */
  rows: number;
  inherited: number;
  /** Blocks that failed as a row at least once: the roots of the failures. */
  roots: string[];
  counting: 'grouped' | 'flat';
};

/**
 * Ochiai per local section. `counting: 'flat'` counts every block in every run, inherited failures
 * included: the baseline the grouped count is compared with.
 */
export function ochiaiLocalize(
  rows: readonly LocalizeRow[],
  runs: readonly LocalizeRun[],
  sections: { local: readonly string[]; global?: readonly string[] },
  counting: 'grouped' | 'flat' = 'grouped',
): Localization {
  const weights = new Map<string, number>();
  let observed = 0;
  let inherited = 0;
  const roots = new Set<string>();
  for (const row of rows) {
    let n = 0;
    let failed = 0;
    for (const run of runs) {
      const verdict = run.get(row.key);
      if (verdict === undefined) continue;
      if (counting === 'grouped' && verdict && row.ancestors.some((ancestor) => run.get(ancestor) === true)) {
        inherited++;
        continue;
      }
      n++;
      if (verdict) {
        failed++;
        roots.add(row.key);
      }
    }
    observed += n;
    if (n > 0) weights.set(row.key, failed / n);
  }
  const failureWeight = [...weights.values()].reduce((sum, w) => sum + w, 0);
  const scored = sections.local.map((section) => {
    let failed = 0;
    let passed = 0;
    let linked = 0;
    for (const row of rows) {
      const w = weights.get(row.key);
      if (w === undefined || !row.sections.includes(section)) continue;
      failed += w;
      passed += 1 - w;
      linked++;
    }
    const score =
      failed === 0 || failureWeight === 0 ? 0 : failed / Math.sqrt(failureWeight * (failed + passed));
    return { section, score, failed, passed, linked };
  });
  const ranked: SectionSuspicion[] = scored.map((each) => {
    const above = scored.filter((other) => other.score > each.score + 1e-12).length;
    const tied = scored.filter((other) => Math.abs(other.score - each.score) <= 1e-12).length;
    return { ...each, best: above + 1, worst: above + tied };
  });
  ranked.sort((a, b) => b.score - a.score);
  return {
    sections: ranked,
    global: [...(sections.global ?? [])],
    failureWeight,
    rows: observed,
    inherited,
    roots: [...roots],
    counting,
  };
}

const blockKey = (spec: string, block: string) => `${spec}#${block}`;
const blockName = (spec: Spec, index: number) => spec.blocks[index]?.id ?? String(index);

/**
 * The rows of a suite for one prompt: each block of each spec, the local sections of that prompt it
 * links to (refuted links left out), and its ancestors. In modes F and P a block inherits every earlier
 * block of its spec and, across a parent edge, the parent block and its own ancestors. In mode T a block
 * starts from its canonical Given and inherits nothing.
 */
export function localizeRows(
  specs: readonly Spec[],
  registry: SectionRegistry,
  mode: 'T' | 'F' | 'P',
  parentOf: (spec: Spec) => ParentRef | undefined = defaultParentOf,
): LocalizeRow[] {
  const local = new Set(
    registry.sections.filter((s) => s.scope === 'local' && s.stale !== true).map((s) => s.id),
  );
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const chain = (spec: Spec, index: number, seen: Set<string>): string[] => {
    if (mode === 'T') return [];
    const own = spec.blocks.slice(0, index).map((_, at) => blockKey(spec.id, blockName(spec, at)));
    const parent = parentOf(spec);
    const source = parent ? byId.get(parent.spec) : undefined;
    if (!parent || !source || seen.has(source.id)) return own;
    const at =
      typeof parent.block === 'number'
        ? parent.block
        : source.blocks.findIndex((block) => block.id === parent.block);
    if (at < 0) return own;
    return [
      ...chain(source, at, new Set([...seen, spec.id])),
      blockKey(source.id, blockName(source, at)),
      ...own,
    ];
  };
  return specs.flatMap((spec) => {
    const links = specLinks(spec);
    return spec.blocks.map((_, index) => ({
      key: blockKey(spec.id, blockName(spec, index)),
      sections: [
        ...new Set(
          links
            .filter(
              (link) =>
                link.to.kind === 'prompt_section' &&
                link.to.prompt === registry.prompt_id &&
                link.status !== 'refuted' &&
                local.has(link.to.section) &&
                linkHolds(spec, link, index),
            )
            .map((link) => (link.to.kind === 'prompt_section' ? link.to.section : '')),
        ),
      ],
      ancestors: chain(spec, index, new Set([spec.id])),
    }));
  });
}

export type LocalizeCampaign = {
  localization: Localization;
  /** The suite runs pooled: one per target, mode, repeat and perturbation. */
  suiteRuns: number;
  /** Runs left out, with why. */
  skipped: { runId: string; reason: string }[];
};

/**
 * Localisation from stored runs: each run's scored blocks (`pass`), grouped into suite runs by target,
 * mode, repeat and perturbation. A run of another spec version, of a spec not given, or of another mode
 * is left out with its reason; an injected block and a block that has no pass or fail verdict (a
 * `not_run` or `blocked` status) is not a row.
 */
export function localizeRuns(
  specs: readonly Spec[],
  runs: readonly RunResult[],
  registry: SectionRegistry,
  options: {
    mode: 'T' | 'F' | 'P';
    counting?: 'grouped' | 'flat';
    parentOf?: (spec: Spec) => ParentRef | undefined;
  },
): LocalizeCampaign {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const suite = new Map<string, Map<string, boolean>>();
  const skipped: LocalizeCampaign['skipped'] = [];
  for (const run of runs) {
    const spec = byId.get(run.specId);
    if (!spec) {
      skipped.push({ runId: run.runId, reason: `the spec ${run.specId} was not given` });
      continue;
    }
    if (run.mode !== options.mode) {
      skipped.push({ runId: run.runId, reason: `mode ${run.mode}, not ${options.mode}` });
      continue;
    }
    if (run.specHash !== specHash(spec)) {
      skipped.push({
        runId: run.runId,
        reason: `another version of ${run.specId} (spec hash ${run.specHash})`,
      });
      continue;
    }
    const group = canonicalJson([run.target, run.mode, run.repeat, run.perturbationId ?? null]);
    const verdicts = suite.get(group) ?? new Map<string, boolean>();
    for (const block of run.blocks) {
      // A block not run or blocked is no measurement: it enters no row of the suite.
      if (block.injected === true || !isScored(block)) continue;
      if (block.index >= spec.blocks.length) continue;
      verdicts.set(blockKey(spec.id, blockName(spec, block.index)), blockStatus(block) === 'fail');
    }
    suite.set(group, verdicts);
  }
  const rows = localizeRows(specs, registry, options.mode, options.parentOf);
  const local = registry.sections.filter((s) => s.scope === 'local' && s.stale !== true).map((s) => s.id);
  const global = registry.sections.filter((s) => s.scope === 'global').map((s) => s.id);
  return {
    localization: ochiaiLocalize(rows, [...suite.values()], { local, global }, options.counting),
    suiteRuns: suite.size,
    skipped,
  };
}

import type { BlockLink } from '../schema/links';
import type { Spec } from '../schema/spec';
import { isPlainObject } from '../spec/normalize';
import type { ChangeManifest } from './change';
import { linkHolds, registriesByPrompt, sectionLinkStatus, specLinks } from './links';
import type { RadiusSpec } from './radius';
import type { Reanchoring, SectionRegistry } from './sections';

/**
 * Section-level selection (M3.5), ADVISORY ONLY. It says which blocks a change to some prompt sections
 * would select through the blocks' links, and which it would skip. Nothing reads it to skip a block: a
 * `prompt_section` change makes the radius the whole suite, so every block still runs, until links
 * verified by mutation pass the selection gate (phase 7). On the H7 suite, declared links missed
 * cross-section behaviour on 3 of 90 mutants, and 8.2% with two-section mutants.
 *
 * A block is selected when:
 * 1. it has no link to the changed prompt (a block with no record always runs, as in Ekstazi);
 * 2. a link of it to that prompt is stale, or names a section the registry lacks or holds as stale;
 * 3. a link of it, not refuted, names a section in the closure of the change: the changed sections,
 *    every section that references or overrides one of them (transitively), and their duplicates;
 * 4. forward: it comes after a selected block of the same conversation (the same spec), or its spec
 *    starts from a parent block at or after a selected block (descendants across parent edges).
 * A change to a global section, to a section the registry does not hold, or to a prompt with no
 * registry selects every block.
 */

export const SECTION_SELECTION_ADVISORY =
  'section selection is advisory until links are verified by mutation: the whole suite runs';

export type SectionBlockState = 'direct' | 'forward' | 'out';

export type SectionSelectionBlock = {
  id: string;
  index: number;
  state: SectionBlockState;
  /** Why the block is selected: `no-links`, `stale-link:<p#s>`, `link:<p#s> (<status>)`, `after <block>`, `via <spec>#<block>`. */
  why: string[];
};

export type SectionSelectionSpec = { specId: string; path?: string; blocks: SectionSelectionBlock[] };

export type SectionSelection = {
  advisory: true;
  /** The changed sections, as `prompt#section`. */
  changed: string[];
  /** The changed sections and every section the closure adds. */
  closure: string[];
  /** Set when every block is selected, with the reason. */
  all: string | null;
  specs: SectionSelectionSpec[];
  counts: { selected: number; direct: number; forward: number; skipped: number; total: number };
};

/** Where a spec starts from: a parent block in another spec. */
export type ParentRef = { spec: string; block: string | number };

/**
 * The parent of a spec, read from its first block's `given.parent` (`spec#block`, or `{ref}`) or
 * `given.from`. Specs have no parent until the parent schema lands; the reader is loose so the
 * selection follows the edges as soon as they exist.
 */
export function defaultParentOf(spec: Spec): ParentRef | undefined {
  const given = spec.blocks[0]?.given as Record<string, unknown> | undefined;
  if (!isPlainObject(given)) return undefined;
  const raw = isPlainObject(given.parent) ? given.parent.ref : (given.parent ?? given.from);
  if (typeof raw !== 'string') return undefined;
  const at = raw.lastIndexOf('#');
  if (at <= 0 || at === raw.length - 1) return undefined;
  return { spec: raw.slice(0, at), block: raw.slice(at + 1) };
}

const key = (prompt: string, section: string) => `${prompt}#${section}`;

/** The changed sections of a manifest: its `prompt_section` changes, as `[prompt, section]`, `*` for any prompt. */
export function sectionChanges(
  manifest: ChangeManifest,
): { prompt: string; section: string; global: boolean }[] {
  return manifest.changes
    .filter((change) => change.kind === 'prompt_section')
    .map((change) => {
      const id = change.id ?? '';
      const at = id.indexOf('#');
      return at < 0
        ? { prompt: '*', section: id, global: change.global === true }
        : { prompt: id.slice(0, at), section: id.slice(at + 1), global: change.global === true };
    });
}

/** The changed sections and the sections that reference, override or duplicate them, transitively. */
function closureOf(registry: SectionRegistry, changed: Set<string>): Set<string> {
  const out = new Set(changed);
  for (let grew = true; grew; ) {
    grew = false;
    const add = (id: string) => {
      if (out.has(id)) return;
      out.add(id);
      grew = true;
    };
    for (const section of registry.sections) {
      if (out.has(section.id)) {
        for (const id of section.duplicates ?? []) add(id);
        continue;
      }
      const edges = [
        ...(section.references ?? []),
        ...(section.overrides ?? []),
        ...(section.duplicates ?? []),
      ];
      if (edges.some((id) => out.has(id))) add(section.id);
    }
  }
  return out;
}

/** The advisory section selection of a manifest's `prompt_section` changes over the specs. */
export function sectionSelection(
  specs: readonly RadiusSpec[],
  manifest: ChangeManifest,
  registries: readonly SectionRegistry[],
  options: { parentOf?: (spec: Spec) => ParentRef | undefined } = {},
): SectionSelection {
  const parentOf = options.parentOf ?? defaultParentOf;
  const changes = sectionChanges(manifest);
  const indexed = registriesByPrompt(registries);
  const byPrompt = indexed.ok ? indexed.byPrompt : new Map<string, SectionRegistry>();
  let all: string | null = indexed.ok ? null : indexed.errors.join('; ');

  // Resolve each change against its registry: a `*` prompt means every registry holding the section.
  const changedByPrompt = new Map<string, Set<string>>();
  for (const change of changes) {
    if (change.global) all ??= `${key(change.prompt, change.section)} is declared global`;
    const prompts = change.prompt === '*' ? [...byPrompt.keys()] : [change.prompt];
    const holding = prompts.filter((prompt) =>
      byPrompt.get(prompt)?.sections.some((section) => section.id === change.section),
    );
    if (change.prompt !== '*' && !byPrompt.has(change.prompt))
      all ??= `no section registry describes the prompt ${change.prompt}`;
    else if (holding.length === 0)
      all ??= `the section ${key(change.prompt, change.section)} is in no registry`;
    for (const prompt of holding) {
      const section = byPrompt.get(prompt)?.sections.find((each) => each.id === change.section);
      if (section?.scope === 'global') all ??= `${key(prompt, change.section)} is a global section`;
      const set = changedByPrompt.get(prompt) ?? new Set<string>();
      set.add(change.section);
      changedByPrompt.set(prompt, set);
    }
  }
  const closure = new Map<string, Set<string>>();
  for (const [prompt, changed] of changedByPrompt) {
    const registry = byPrompt.get(prompt);
    if (registry) closure.set(prompt, closureOf(registry, changed));
  }

  const reasons = (spec: Spec, index: number): string[] => {
    if (all !== null) return [`all: ${all}`];
    const why: string[] = [];
    const links = specLinks(spec).filter(
      (link): link is BlockLink & { to: { kind: 'prompt_section' } } =>
        link.to.kind === 'prompt_section' && linkHolds(spec, link, index),
    );
    for (const prompt of closure.keys()) {
      const mine = links.filter((link) => link.to.prompt === prompt);
      if (mine.length === 0) {
        why.push(`no-links:${prompt}`);
        continue;
      }
      for (const link of mine) {
        const status = sectionLinkStatus(link, byPrompt);
        const target = key(prompt, link.to.section);
        if (status === 'stale') why.push(`stale-link:${target}`);
        else if (status !== 'refuted' && closure.get(prompt)?.has(link.to.section))
          why.push(`link:${target} (${status})`);
      }
    }
    return [...new Set(why)];
  };

  const reports: SectionSelectionSpec[] = specs.map(({ spec, path }) => {
    const blocks: SectionSelectionBlock[] = spec.blocks.map((block, index) => {
      const why = reasons(spec, index);
      return { id: block.id ?? `block ${index}`, index, state: why.length > 0 ? 'direct' : 'out', why };
    });
    return { specId: spec.id, ...(path === undefined ? {} : { path }), blocks };
  });

  // Forward closure: within a conversation, then across parent edges, to a fixed point.
  const forwardFrom = (report: SectionSelectionSpec, from: number, why: string) => {
    let changed = false;
    for (const block of report.blocks) {
      if (block.index < from || block.state !== 'out') continue;
      block.state = 'forward';
      block.why = [why];
      changed = true;
    }
    return changed;
  };
  const bySpec = new Map(reports.map((report) => [report.specId, report]));
  for (let moved = true; moved; ) {
    moved = false;
    for (const [at, report] of reports.entries()) {
      const first = report.blocks.find((block) => block.state !== 'out');
      if (first) moved = forwardFrom(report, first.index + 1, `after ${first.id}`) || moved;
      const spec = specs[at]?.spec;
      const parent = spec ? parentOf(spec) : undefined;
      const source = parent ? bySpec.get(parent.spec) : undefined;
      if (!parent || !source) continue;
      const end = source.blocks.findIndex((block) =>
        typeof parent.block === 'number' ? block.index === parent.block : block.id === parent.block,
      );
      const reached = source.blocks.some((block) => block.state !== 'out' && block.index <= end);
      if (end >= 0 && reached) moved = forwardFrom(report, 0, `via ${parent.spec}#${parent.block}`) || moved;
    }
  }

  const counts = { selected: 0, direct: 0, forward: 0, skipped: 0, total: 0 };
  for (const report of reports)
    for (const block of report.blocks) {
      counts.total++;
      if (block.state === 'out') counts.skipped++;
      else {
        counts.selected++;
        counts[block.state]++;
      }
    }
  const flat = (map: Map<string, Set<string>>) =>
    [...map].flatMap(([prompt, ids]) => [...ids].map((id) => key(prompt, id)));
  return {
    advisory: true,
    changed: changes.map((change) => key(change.prompt, change.section)),
    closure: flat(closure),
    all,
    specs: reports,
    counts,
  };
}

/**
 * The change manifest of a re-anchoring: each stale or reordered section is a `prompt_section` change,
 * and a change outside every section is a global `prompt` change (it can reach any block).
 */
export function sectionChangeManifest(
  registry: SectionRegistry,
  reanchoring: Reanchoring,
  versions: { from?: string; to: string },
): ChangeManifest {
  const changes: ChangeManifest['changes'] = [];
  for (const section of reanchoring.sections) {
    if (section.status === 'stale')
      changes.push({ kind: 'prompt_section', id: key(registry.prompt_id, section.id), note: section.reason });
  }
  for (const id of reanchoring.reordered) {
    if (!changes.some((change) => change.id === key(registry.prompt_id, id)))
      changes.push({
        kind: 'prompt_section',
        id: key(registry.prompt_id, id),
        note: 'the section changed order',
      });
  }
  for (const label of reanchoring.outside)
    changes.push({
      kind: 'prompt',
      global: true,
      note: `${registry.prompt_id}: changed outside every section, ${label}`,
    });
  return { from: versions.from ?? registry.version, to: versions.to, changes };
}

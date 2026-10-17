import type { RunMode } from '../schema/run';
import type { PerturbationSpec, Spec } from '../schema/spec';
import { isPlainObject } from '../spec/normalize';
import { parentOrder } from '../spec/parents';
import { type Change, type ChangeManifest, changeLabel } from './change';
import { type BlockDependencies, blockDependencies } from './depends';
import type { SectionRegistry } from './sections';
import {
  type ParentRef,
  SECTION_SELECTION_ADVISORY,
  type SectionSelection,
  sectionChanges,
  sectionSelection,
} from './select';

/**
 * The blast radius of a change manifest over a set of specs: the blocks the change can affect.
 *
 * 1. Direct: every block whose dependencies name a change of the manifest.
 * 2. Forward closure: in mode F and P a block inherits the agent's own earlier replies, so every block
 *    after a direct block of the same run is in. In mode T a block starts from its canonical Given, so
 *    nothing follows, except in a sandbox (a task), where a step keeps the workspace the step before
 *    left until a step writes its own.
 *
 * Unknown means in. A block with unknown dependencies is in every radius; a change the radius cannot map
 * to a declared dependency makes the radius the whole suite, with the reason.
 */

export type RadiusSpec = { spec: Spec; hash: string; path?: string };

export type RadiusOptions = {
  /** The run modes to plan for. Default: F. */
  modes?: readonly RunMode[];
  /** True when the spec runs in a sandbox, where a T block keeps the workspace of the block before. Default: a task spec. */
  sandbox?: (spec: Spec) => boolean;
  /** Section registries: with them, a manifest's `prompt_section` changes get an advisory section selection. */
  sections?: readonly SectionRegistry[];
  /** The parent block a spec starts from, for the advisory forward closure. Default: `given.parent` of block 0. */
  parentOf?: (spec: Spec) => ParentRef | undefined;
};

export type BlockState = 'direct' | 'forward' | 'out';

export type RadiusBlock = {
  id: string;
  index: number;
  /** False for a block a gate rejected (`metadata.gate`): it runs with its spec, its verdict is not scored. */
  scored: boolean;
  /** Why the block is in directly: one entry per change that names one of its dependencies. Empty: not direct. */
  why: string[];
  /** In each mode: direct, forward (after a direct block of the same run) or out. */
  state: Partial<Record<RunMode, BlockState>>;
};

export type RadiusCell = {
  mode: RunMode;
  /** The perturbation of a P cell. */
  perturbationId?: string;
  in: boolean;
  /** Why the cell is in: the reasons of its first direct block, or of its perturbation. */
  why: string[];
};

export type RadiusSpecReport = {
  specId: string;
  hash: string;
  path?: string;
  blocks: RadiusBlock[];
  cells: RadiusCell[];
};

export type RadiusCount = {
  /** Scored blocks in the radius: direct plus forward. */
  in: number;
  direct: number;
  forward: number;
  out: number;
  /** Scored blocks in all. */
  total: number;
  /** Scored blocks whose dependencies are unknown: in every radius. */
  unknown: number;
  cells: { in: number; total: number };
  /** Scored blocks of the cells in the radius: what a rerun of whole cells sends. */
  sent: number;
};

export type RadiusReport = {
  manifest: { from: string; to: string; changes: string[] };
  modes: RunMode[];
  /** Set when the radius is the whole suite, with the change and the reason that made it so. */
  whole: { change: string; reason: string } | null;
  specs: RadiusSpecReport[];
  totals: Partial<Record<RunMode, RadiusCount>>;
  /**
   * What selection by section links would run for the manifest's `prompt_section` changes. Advisory: the
   * radius above is the whole suite and nothing is skipped. Present only with `sections`.
   */
  advisory?: SectionSelection;
};

const deviationMatches = (carried: string | undefined, id: string): boolean =>
  carried !== undefined && (carried === id || carried.startsWith(`${id}_`));

/** The stages a transition id such as `offer-to-recap` names. */
const names = (dependencies: BlockDependencies, stage: string): boolean =>
  dependencies.stages.includes(stage);

type Whole = { whole: string };
type Match = (dependencies: BlockDependencies) => boolean;

/**
 * How one change selects blocks: a predicate over a block's dependencies, or the reason the change is the
 * whole suite. `unknown` names the dependency a block must have declared for the predicate to be trusted.
 */
function matcher(change: Change): { match: Match; needs?: 'cell' | 'atoms' } | Whole {
  const id = change.id;
  if (change.global === true) return { whole: 'the change is declared global' };
  switch (change.kind) {
    case 'model':
      return { whole: 'a model or setting change can affect every block' };
    case 'agent':
      return { whole: 'the whole agent changed' };
    case 'stage':
      if (id === undefined) return { whole: 'a stage change names no stage' };
      return { match: (d) => names(d, id) };
    case 'tool': {
      if (id === undefined) return { whole: 'a tool change names no tool' };
      const listed = (d: BlockDependencies) => d.tools.filter((tool) => tool.label === id);
      if (change.part === 'input') {
        return {
          match: (d) =>
            listed(d).some((tool) => tool.count === 'some' || tool.input) || d.toolsCapped.includes(id),
        };
      }
      if (change.part === 'result') {
        return {
          match: (d) =>
            listed(d).some((tool) => tool.count === 'some') ||
            d.toolsForced.includes(id) ||
            d.toolsEndState.includes(id),
        };
      }
      return {
        match: (d) =>
          listed(d).length > 0 ||
          d.toolsCapped.includes(id) ||
          d.toolsForbidden.includes(id) ||
          d.toolsOffered.includes(id) ||
          d.toolsForced.includes(id) ||
          d.toolsEndState.includes(id),
      };
    }
    case 'rule':
      return ruleMatcher(change);
    case 'deviation':
      if (id === undefined) return { whole: 'a deviation change names no class' };
      return { match: (d) => deviationMatches(d.deviation, id) };
    case 'prompt':
      if (id === undefined) return { whole: 'a prompt change names no atom' };
      return { match: (d) => d.atoms.includes(id), needs: 'atoms' };
    case 'map': {
      const at = id?.indexOf('=') ?? -1;
      if (id === undefined || at <= 0) return { whole: 'a map change is written dimension=value' };
      const dimension = id.slice(0, at);
      const value = id.slice(at + 1);
      return {
        match: (d) =>
          d.cell[dimension] === value || (d.phrase?.dimension === dimension && d.phrase.value === value),
        needs: 'cell',
      };
    }
    case 'fixture':
      if (id === undefined) return { whole: 'a fixture change names no fixture' };
      return {
        match: (d) => d.fixtures.includes(id) || d.literals.includes(JSON.stringify(id).slice(1, -1)),
      };
    case 'criterion':
      if (id === undefined) return { whole: 'a criterion change names no criterion' };
      return { match: (d) => d.criteria.includes(id) };
    case 'prompt_section':
      // Selection by section links is advisory (select.ts): the whole suite runs until links are verified.
      return { whole: SECTION_SELECTION_ADVISORY };
    default:
      return { whole: `the kind ${change.kind} is not one the radius can map` };
  }
}

/** A rule of the map (`states@offer`, `recovery:D2`, `uses_tool:<tool>`, `path:<id>`) or a spec rule name. */
function ruleMatcher(change: Change): { match: Match; needs?: 'cell' | 'atoms' } | Whole {
  const id = change.id;
  if (id === undefined) return { whole: 'a rule change names no rule' };
  if (id === 'reply_language') return { whole: 'the reply language rule holds on every block' };
  const [relation, rest] = id.includes(':')
    ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
    : [id, ''];
  if (relation.startsWith('states@')) {
    const stage = relation.slice('states@'.length);
    return { match: (d) => d.fields.includes('text') && names(d, stage) };
  }
  if (relation === 'recovery') {
    const [klass, flow] = rest.split('@');
    if (!klass) return { whole: 'a recovery rule is written recovery:<class>' };
    return {
      match: (d) => deviationMatches(d.deviation, klass) && (flow === undefined || d.flow === flow),
    };
  }
  if (relation === 'uses_tool') {
    if (rest === '') return { whole: 'a uses_tool rule is written uses_tool:<tool>' };
    return matcher({ kind: 'tool', id: rest });
  }
  if (relation === 'path') {
    if (rest === '') return { whole: 'a path rule is written path:<id>' };
    return { match: (d) => d.path === rest, needs: 'cell' };
  }
  return { match: (d) => d.rules.includes(id) };
}

/** How a perturbation of a P cell reads a change: its class, its stages, the tools it expects or forces. */
function perturbationDependencies(spec: Spec, perturbation: PerturbationSpec): BlockDependencies {
  const at = Math.min(perturbation.inject_at, spec.blocks.length - 1);
  const base = blockDependencies(spec, at);
  const probe: Spec = {
    ...spec,
    blocks: [
      {
        when: { injection: { class: perturbation.class, user: perturbation.user ?? '' } },
        ...(perturbation.world === undefined ? {} : { given: { world: perturbation.world } }),
        ...(perturbation.expect === undefined ? {} : { expect: perturbation.expect }),
      },
    ],
    end_state: undefined,
    metadata: {},
  };
  const own = blockDependencies(probe, 0);
  const after = perturbation.recovery?.stage_after;
  return {
    ...own,
    stages: [...new Set([...own.stages, ...(after === undefined ? [] : [after])])],
    flow: base.flow,
    path: base.path,
    cell: base.cell,
    cellKnown: base.cellKnown,
    atoms: base.atoms,
    atomsKnown: base.atomsKnown,
    deviation: perturbation.class,
    unknown: base.unknown,
  } as BlockDependencies;
}

function rejectedBlocks(spec: Spec): Set<string> {
  const gate = spec.metadata?.gate;
  const blocks = isPlainObject(gate) ? gate.blocks : undefined;
  const out = new Set<string>();
  if (!Array.isArray(blocks)) return out;
  for (const each of blocks) {
    if (isPlainObject(each) && each.status === 'rejected' && typeof each.block === 'string')
      out.add(each.block);
  }
  return out;
}

/** In mode T on a sandbox, the first block at or after `from` that starts from a workspace of its own. */
function workspaceReset(spec: Spec, from: number): number {
  for (let index = from; index < spec.blocks.length; index++) {
    if (spec.blocks[index]?.given?.world?.workspace !== undefined) return index;
  }
  return spec.blocks.length;
}

/** The blast radius of a manifest over the specs. See the module comment for the rules. */
export function radiusOf(
  specs: readonly RadiusSpec[],
  manifest: ChangeManifest,
  options: RadiusOptions = {},
): RadiusReport {
  const modes: RunMode[] = [...new Set(options.modes ?? (['F'] as const))];
  const sandbox = options.sandbox ?? ((spec: Spec) => spec.kind === 'task');
  const dependencies = specs.map(({ spec }) => spec.blocks.map((_, index) => blockDependencies(spec, index)));
  const perturbations = specs.map(({ spec }) =>
    (spec.perturbations ?? []).map((each) => ({ each, deps: perturbationDependencies(spec, each) })),
  );

  let whole: RadiusReport['whole'] = null;
  if (manifest.changes.length === 0 && manifest.from !== manifest.to) {
    whole = { change: '(none)', reason: 'the manifest lists no change between two different versions' };
  }
  const selectors: { label: string; match: Match; needs?: 'cell' | 'atoms' }[] = [];
  for (const change of manifest.changes) {
    const label = changeLabel(change);
    const made = matcher(change);
    if ('whole' in made) {
      whole ??= { change: label, reason: made.whole };
      continue;
    }
    // A change no block declares cannot be shown local: a new tool or an unlisted stage can reach any block.
    const named =
      dependencies.some((blocks) => blocks.some(made.match)) ||
      perturbations.some((list) => list.some(({ deps }) => made.match(deps)));
    if (!named && change.kind !== 'criterion') {
      whole ??= { change: label, reason: 'no block declares a dependency on it' };
      continue;
    }
    selectors.push({ label, ...made });
  }

  const reasons = (deps: BlockDependencies): string[] => {
    const why: string[] = [];
    for (const selector of selectors) {
      if (selector.match(deps)) why.push(selector.label);
      else if (selector.needs === 'cell' && !deps.cellKnown) why.push(`${selector.label}:unknown-cell`);
      else if (selector.needs === 'atoms' && !deps.atomsKnown) why.push(`${selector.label}:unknown-atoms`);
    }
    if (deps.unknown && selectors.length > 0 && why.length === 0) why.push('unknown-deps');
    return why;
  };

  const reports: RadiusSpecReport[] = specs.map(({ spec, hash, path }, at) => {
    const rejected = rejectedBlocks(spec);
    const deps = dependencies[at] ?? [];
    const blocks: RadiusBlock[] = spec.blocks.map((block, index) => ({
      id: block.id ?? `block ${index}`,
      index,
      scored: block.id === undefined || !rejected.has(block.id),
      why: whole ? [`whole:${whole.change}`] : reasons(deps[index] as BlockDependencies),
      state: {},
    }));
    const linked = spec.blocks.some((block) => block.parent !== undefined);
    const inherited = new Set<number>();
    const byId = new Map(spec.blocks.map((block, index) => [block.id, index]));
    for (const index of parentOrder(spec).order) {
      const parent = spec.blocks[index]?.parent;
      const at = parent === undefined ? undefined : byId.get(parent);
      if (at !== undefined && ((blocks[at]?.why.length ?? 0) > 0 || inherited.has(at))) inherited.add(index);
    }
    const first = blocks.findIndex((block) => block.why.length > 0);
    const cells: RadiusCell[] = [];
    for (const mode of modes) {
      if (mode === 'T') {
        // A T block starts from its canonical Given; only a sandbox carries the workspace forward.
        let until = -1;
        for (const block of blocks) {
          const direct = block.why.length > 0;
          if (direct && sandbox(spec) && !linked)
            until = Math.max(until, workspaceReset(spec, block.index + 1));
          block.state.T = direct
            ? 'direct'
            : inherited.has(block.index) || block.index < until
              ? 'forward'
              : 'out';
        }
        cells.push({
          mode,
          in: first >= 0 || inherited.size > 0,
          why: first >= 0 ? (blocks[first]?.why ?? []) : [],
        });
        continue;
      }
      const origin = first >= 0 ? (blocks[first]?.why ?? []) : [];
      if (mode === 'F') {
        for (const block of blocks) {
          block.state.F =
            block.why.length > 0
              ? 'direct'
              : inherited.has(block.index) || (!linked && first >= 0 && block.index > first)
                ? 'forward'
                : 'out';
        }
        cells.push({ mode, in: first >= 0, why: origin });
        continue;
      }
      // Mode P: one cell per perturbation. The injected block reads the change too, and every block from
      // its position on inherits it. The block states are the union over the spec's perturbations.
      const list = perturbations[at] ?? [];
      let start = first >= 0 ? first + 1 : Number.POSITIVE_INFINITY;
      for (const { each, deps: own } of list) {
        const why = whole ? [`whole:${whole.change}`] : reasons(own);
        if (why.length > 0) start = Math.min(start, each.inject_at);
        cells.push({
          mode,
          perturbationId: each.id,
          in: first >= 0 || why.length > 0,
          why: why.length > 0 ? why : origin,
        });
      }
      if (list.length === 0) cells.push({ mode, in: first >= 0, why: origin });
      for (const block of blocks) {
        block.state.P =
          block.why.length > 0
            ? 'direct'
            : inherited.has(block.index) || (!linked && block.index >= start)
              ? 'forward'
              : 'out';
      }
    }
    return { specId: spec.id, hash, ...(path === undefined ? {} : { path }), blocks, cells };
  });

  const totals: RadiusReport['totals'] = {};
  for (const mode of modes) {
    const count: RadiusCount = {
      in: 0,
      direct: 0,
      forward: 0,
      out: 0,
      total: 0,
      unknown: 0,
      cells: { in: 0, total: 0 },
      sent: 0,
    };
    reports.forEach((report, at) => {
      const cells = report.cells.filter((cell) => cell.mode === mode);
      const scored = report.blocks.filter((block) => block.scored);
      count.cells.total += cells.length;
      count.cells.in += cells.filter((cell) => cell.in).length;
      count.sent += cells.filter((cell) => cell.in).length * scored.length;
      for (const block of scored) {
        count.total++;
        if (dependencies[at]?.[block.index]?.unknown) count.unknown++;
        const state = block.state[mode] ?? 'out';
        count[state]++;
        if (state !== 'out') count.in++;
      }
    });
    totals[mode] = count;
  }

  const advisory =
    options.sections !== undefined && sectionChanges(manifest).length > 0
      ? sectionSelection(specs, manifest, options.sections, { parentOf: options.parentOf })
      : undefined;
  return {
    manifest: { from: manifest.from, to: manifest.to, changes: manifest.changes.map(changeLabel) },
    modes,
    whole,
    specs: reports,
    totals,
    ...(advisory === undefined ? {} : { advisory }),
  };
}

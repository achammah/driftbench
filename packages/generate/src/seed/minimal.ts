import { canonicalGiven, contentHash, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import {
  addEventCodes,
  assertGridSize,
  combinations,
  compileSpace,
  placeSpec,
  projectGrid,
} from '@agent-nexus/driftbench-space';
import { createPerturbingDriver } from '@agent-nexus/driftbench-users';
import type { Allocation } from './allocation';
import { type RunIdentity, renderDraft, type SpecDraft } from './assemble';
import type { PreparedMap } from './map';

/** A tool failure is followed by the turn that gets the tool answering again: the walk never ends on it. */
function failsAtEnd(spec: Spec): boolean {
  const tools = spec.blocks.at(-1)?.given?.world?.tools ?? {};
  return Object.values(tools).some((tool) => tool.error !== undefined);
}

/**
 * A repeated test at the end of a walk is not written again. A terminal block is dropped when another
 * block already written says the same turn, expects the same and is said from the same stage in the same
 * language and under the same rules, and when the suite keeps every obligation without it: each coverage tuple the walk placed is
 * placed by a spec already written, each ordered pair of consecutive moves it walked is walked by one, the
 * stage and class allocation is no further from balance. A perturbation declared on the block goes with it. The first block written stays; later repeats go. Exactly one walk
 * ends on a given block: a cut that would leave a walk ending, with more than one block, on the block another written
 * walk ends on is taken back to the deepest cut that ends elsewhere. A block is the same
 * test on any channel and for any persona; the first twin of a written walk, per path and context axis, stays whole. A block that injects
 * a class stays. A walk with an end state,
 * a metamorphic variant, a task and a spec that is not complete are never reduced.
 *
 * This is subsumption by what has been written, not a proof of a smallest suite, and it reads no agent.
 * Memory is bounded by the coverage grid and the distinct blocks and move pairs of the suite.
 */
export class TerminalSubsumption {
  private readonly space;
  private readonly projections;
  /** The tuples the written specs place. */
  private readonly held: Uint8Array[];
  /** Blocks written so far, by what makes two blocks the same test. */
  private readonly blocks = new Set<string>();
  /** The key of the last block of every walk written: one walk ends on each. */
  private readonly ends = new Set<string>();
  /** The whole walks written, by what they say apart from the context, with the contexts each is written in. */
  private readonly walks = new Map<string, Set<string>>();
  /** The context axes a pair of whole twins is kept for, per path: the Then must hold across them. */
  private readonly paired = new Map<string, Set<string>>();
  /** Ordered pairs of consecutive moves some written spec walks. */
  private readonly pairs = new Set<string>();
  private readonly processed = new WeakSet<SpecDraft>();

  constructor(
    private readonly prepared: PreparedMap,
    private readonly run: RunIdentity,
    t: number,
    private readonly allocation?: Allocation,
  ) {
    assertGridSize(prepared.axisMap, 4_000_000);
    this.space = compileSpace(prepared.axisMap);
    const k = this.space.dimensions.length;
    const strengths = [...new Set([1, 2, 3, Math.min(t, k)])].filter((n) => n > 0 && n <= k);
    this.projections = projectGrid(
      this.space,
      strengths.flatMap((n) => combinations(k, n)),
    ).projections;
    this.held = this.projections.map((projection) => new Uint8Array(projection.size));
  }

  /** Drops the terminal repeats of a draft, once, and remembers what the reduced walk places. */
  reduce(draft: SpecDraft): void {
    if (this.processed.has(draft)) return;
    this.processed.add(draft);
    const rendered = renderDraft(this.prepared, draft, this.run);
    if (rendered.placeholders.length || rendered.noThen.length || rendered.reasons.length) return;
    const parsed = validateSpec(rendered.spec);
    if (!parsed.ok) return;
    let spec = parsed.spec;
    // A metamorphic family keeps its variants identical but for the phrasing: its walks are never cut.
    if (spec.kind === 'conversation' && spec.end_state === undefined && draft.seeder !== 'metamorphic') {
      const states = [{ blocks: draft.blocks, perturbations: draft.perturbations, spec }];
      // The Then must hold across channels and across personas, and that is read off a pair of whole walks that
      // differ only there (a twin). Each path keeps one such pair per axis; a twin beyond it is a repeat.
      const twin = this.keepsPair(spec);
      while (!twin && spec.blocks.length > 1) {
        const last = spec.blocks.length - 1;
        if (!this.blocks.has(this.key(spec, last))) break;
        // A block that injects a class is that class's test, and the deviation of its row: it stays.
        if ('injection' in (spec.blocks[last]?.when ?? {})) break;
        // The move right after a restated request is the test of the latest value: a walk is never cut to end on
        // the request alone, which asks for a value and checks none of the slot's later states.
        if (spec.blocks[last - 1]?.id?.endsWith('-restated')) break;
        // A perturbed run injects a declaration at its position and checks its recovery there, with the blocks after
        // it: the block a declaration names, and the ones before it, are part of that test and stay. (Dropping the
        // declaration with the block was measured: it loses 50 perturbed-mode kills on the hidden seed.)
        if (spec.perturbations?.some((entry) => entry.inject_at >= last)) break;
        const reduced = validateSpec({ ...spec, blocks: spec.blocks.slice(0, last) });
        if (!reduced.ok || !this.recoveriesHold(reduced.spec) || failsAtEnd(reduced.spec)) break;
        if (!this.tuplesHold(spec, reduced.spec) || !this.pairsHold(spec, reduced.spec)) break;
        if (!this.allocationHolds(draft, last)) break;
        draft.blocks = draft.blocks.slice(0, last);
        spec = reduced.spec;
        states.push({ blocks: draft.blocks, perturbations: draft.perturbations, spec });
      }
      // Exactly one walk ends on a given block: a cut that stops, with more than one block left, on the block
      // another written walk ends on is taken back to the deepest cut that ends elsewhere, or to the whole walk.
      const settled = [...states]
        .reverse()
        .find(
          (state) =>
            state.spec.blocks.length === 1 ||
            !this.ends.has(this.key(state.spec, state.spec.blocks.length - 1)),
        );
      const chosen = settled ?? (states[0] as (typeof states)[number]);
      draft.blocks = chosen.blocks;
      draft.perturbations = chosen.perturbations;
      spec = chosen.spec;
    }
    this.observeSpec(spec);
  }

  /** What a spec written by other code places: tasks are never reduced but their obligations are met. */
  observeSpec(spec: Spec): void {
    spec.blocks.forEach((_, index) => {
      this.blocks.add(this.key(spec, index));
    });
    this.ends.add(this.key(spec, spec.blocks.length - 1));
    const walk = this.walkKey(spec);
    const contexts = this.walks.get(walk) ?? new Set<string>();
    contexts.add(this.contextOf(spec));
    this.walks.set(walk, contexts);
    for (const pair of this.pairsOf(spec)) this.pairs.add(pair);
    const placement = placeSpec(this.space, spec);
    this.projections.forEach((projection, index) => {
      const marks = this.held[index];
      if (!marks) return;
      const codes = new Set<number>();
      for (const event of placement.events) addEventCodes(projection, event, codes);
      for (const code of codes) if (projection.allowed[code] === 1) marks[code] = 1;
    });
  }

  /** The channel and the persona a spec is written for: no agent receives them, a suite varies them. */
  private contextOf(spec: Spec): string {
    return JSON.stringify([spec.channel, spec.tags?.filter((tag) => tag.startsWith('persona:'))]);
  }

  /** True when the walk is the first twin of a written walk on an axis its path has no pair for yet. */
  private keepsPair(spec: Spec): boolean {
    const written = this.walks.get(this.walkKey(spec));
    if (written === undefined) return false;
    const path = (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
    const secured = this.paired.get(path) ?? new Set<string>();
    const [channel, persona] = JSON.parse(this.contextOf(spec)) as [unknown, unknown];
    const axes = new Set<string>();
    for (const other of written) {
      const [otherChannel, otherPersona] = JSON.parse(other) as [unknown, unknown];
      if (JSON.stringify(otherChannel) !== JSON.stringify(channel)) axes.add('channel');
      if (JSON.stringify(otherPersona) !== JSON.stringify(persona)) axes.add('persona');
    }
    const needed = [...axes].filter((axis) => !secured.has(axis));
    for (const axis of needed) secured.add(axis);
    this.paired.set(path, secured);
    return needed.length > 0;
  }

  private walkKey(spec: Spec): string {
    return contentHash(spec.blocks.map((_, index) => this.key(spec, index)));
  }

  /** The turn, the stage it is said from and what it expects, in the language and under the rules it is said in. */
  private key(spec: Spec, index: number): string {
    const block = spec.blocks[index];
    const { criteria: _criteria, ...machine } = block?.expect ?? {};
    const from = index === 0 ? spec.stages?.[0] : spec.blocks[index - 1]?.expect?.stage;
    return contentHash({
      kind: spec.kind,
      lang: spec.lang,
      rules: spec.rules,
      state: canonicalGiven(spec, index).state,
      from,
      when: block?.when,
      given: block?.given,
      expect: machine,
    });
  }

  /** Consecutive moves of a walk, with the class each says: the pairs a sequence of the suite is made of. */
  private pairsOf(spec: Spec): string[] {
    const move = (index: number) => {
      const block = spec.blocks[index];
      const cls = block && 'injection' in block.when ? block.when.injection.class : '';
      return `${index === 0 ? (spec.stages?.[0] ?? '') : (spec.blocks[index - 1]?.expect?.stage ?? '')}>${block?.expect?.stage ?? ''}:${cls}`;
    };
    return spec.blocks.slice(1).map((_, index) => `${move(index)}|${move(index + 1)}`);
  }

  private recoveriesHold(spec: Spec): boolean {
    try {
      for (const entry of spec.perturbations ?? []) createPerturbingDriver({ spec, perturbation: entry.id });
      return true;
    } catch {
      return false;
    }
  }

  /** Every tuple the longer walk places is placed by the reduced walk or by a spec already written. */
  private tuplesHold(before: Spec, after: Spec): boolean {
    const held = this.held;
    const previous = placeSpec(this.space, before);
    const reduced = placeSpec(this.space, after);
    return this.projections.every((projection, index) => {
      const oldCodes = new Set<number>();
      const newCodes = new Set<number>();
      for (const event of previous.events) addEventCodes(projection, event, oldCodes);
      for (const event of reduced.events) addEventCodes(projection, event, newCodes);
      return [...oldCodes].every(
        (code) => projection.allowed[code] !== 1 || newCodes.has(code) || held[index]?.[code] === 1,
      );
    });
  }

  private pairsHold(before: Spec, after: Spec): boolean {
    const kept = new Set(this.pairsOf(after));
    return this.pairsOf(before).every((pair) => kept.has(pair) || this.pairs.has(pair));
  }

  /** The reduced walk leaves stages and classes no further from balance than the whole one. */
  private allocationHolds(draft: SpecDraft, last: number): boolean {
    if (!this.allocation) return true;
    const reduced = {
      blocks: draft.blocks.slice(0, last),
      perturbations: draft.perturbations,
    };
    return this.allocation.imbalanceWith(reduced) <= this.allocation.imbalanceWith(draft);
  }
}

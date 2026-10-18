import type { PerturbationSpec, Spec } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { BlockDraft, SpecDraft } from './assemble';
import type { DeviationBalance } from './deviation-balance';
import type { PreparedMap } from './map';
import { flowsOfBehaviour, type SeedContext, scenarioDraft } from './seed-drafts';

/** A recovery a walk could declare at one position: its class, where it arrives, and the Then it carries. */
export type RecoveryOption = {
  classId: string;
  index: number;
  stage: string;
  expect: NonNullable<PerturbationSpec['expect']>;
  user: string;
};

/** How far counts are from a third of the most placed one, in thirds of an event. */
function deficit(counts: Iterable<number>): number {
  const values = [...counts];
  const most = Math.max(0, ...values);
  return values.reduce((sum, count) => sum + Math.max(0, most - 3 * count), 0);
}

/**
 * Allocation of the suite over the strata coverage counts. An event is what coverage places: every block at
 * the stage it expects, every injected block and declared perturbation at the stage the conversation had
 * reached when it arrived, a deviation class where it arrives. A spec places the behaviours it covers.
 * No stage, deviation class or behaviour is placed fewer than a third as often as the most placed value of
 * its stratum. The allocation is generation-local: it reads only the suite written so far.
 */
export class Allocation {
  private stageSerial = 0;
  private behaviourSerial = 0;
  private readonly observed = new WeakSet<SpecDraft>();
  private readonly stages: Map<string, number>;
  private readonly classes: Map<string, number>;
  /** Specs per behaviour value, for each behaviour axis (the stage graph's transitions are not behaviours). */
  private readonly behaviours = new Map<number, Map<string, number>>();
  constructor(private readonly prepared: PreparedMap) {
    const values = (dimension: number | undefined) =>
      (prepared.space.dimensions[dimension ?? -1]?.values ?? [])
        .filter((value) => value.id !== NONE)
        .map((value): [string, number] => [value.id, 0]);
    this.stages = new Map(values(prepared.stage));
    this.classes = new Map(values(prepared.deviation));
    prepared.space.dimensions.forEach((dimension, index) => {
      if (dimension.kind === 'behaviour' && prepared.axes.has(index) && index !== prepared.transition)
        this.behaviours.set(index, new Map(values(index)));
    });
  }

  /** The stage of every event of a walk, in the order coverage places them. */
  private events(
    blocks: readonly Pick<BlockDraft, 'stage' | 'injection'>[],
    perturbations: readonly PerturbationSpec[] = [],
  ): string[] {
    const arrival = (before: number) => {
      for (let at = Math.min(before, blocks.length) - 1; at >= 0; at--)
        if (blocks[at]?.stage !== undefined) return blocks[at]?.stage;
      return undefined;
    };
    return [
      ...blocks.map((block, index) => (block.injection ? (arrival(index) ?? block.stage) : block.stage)),
      ...perturbations.map(
        (entry) => arrival(entry.inject_at) ?? entry.expect?.stage ?? entry.recovery?.stage_after,
      ),
    ].filter((stage): stage is string => stage !== undefined && this.stages.has(stage));
  }

  observe(
    blocks: readonly Pick<BlockDraft, 'stage' | 'injection'>[],
    perturbations?: readonly PerturbationSpec[],
    behaviours: readonly string[] = [],
  ): void {
    for (const stage of this.events(blocks, perturbations))
      this.stages.set(stage, (this.stages.get(stage) ?? 0) + 1);
    for (const cls of [
      ...blocks.flatMap((block) => (block.injection ? [block.injection] : [])),
      ...(perturbations ?? []).map((entry) => entry.class),
    ])
      if (this.classes.has(cls)) this.classes.set(cls, (this.classes.get(cls) ?? 0) + 1);
    for (const counts of this.behaviours.values())
      for (const value of new Set(behaviours))
        if (counts.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  /** Counts a draft once, however many seeders and writers see it. Drafts with a gap count nothing. */
  observeDraft(draft: SpecDraft): void {
    if (this.observed.has(draft)) return;
    this.observed.add(draft);
    if (draft.blocks.some((block) => block.stimulus.kind === 'placeholder')) return;
    const behaviours = draft.cell.flatMap(([dimension, value]) =>
      this.behaviours.has(dimension)
        ? [this.prepared.space.dimensions[dimension]?.values[value]?.id ?? NONE]
        : [],
    );
    this.observe(draft.blocks, draft.perturbations, behaviours);
  }

  /** Counts a spec written by code that builds specs, not drafts (the task seeder). */
  observeSpec(spec: Spec): void {
    this.observe(
      spec.blocks.map((block) => ({
        stage: block.expect?.stage,
        ...('injection' in block.when ? { injection: block.when.injection.class } : {}),
      })),
      spec.perturbations,
      spec.covers,
    );
  }

  /**
   * Of these stages, the ones where a probe of the class leaves the stages and classes nearest balance. An
   * option names the stage and the stages of every event the walk would add, the probe's own included.
   */
  cheapest(options: readonly { stage: string; events: readonly string[] }[], classId: string): Set<string> {
    const scores = options.map(({ events }) => {
      const stages = new Map(this.stages);
      for (const stage of events) if (stages.has(stage)) stages.set(stage, (stages.get(stage) ?? 0) + 1);
      const classes = new Map(this.classes);
      if (classes.has(classId)) classes.set(classId, (classes.get(classId) ?? 0) + 1);
      return deficit(stages.values()) + deficit(classes.values());
    });
    const best = Math.min(...scores);
    return new Set(options.filter((_, at) => scores[at] === best).map(({ stage }) => stage));
  }

  /**
   * Declares recoveries the walk can take at the stages the suite places least. A recovery already drawn
   * moves to a rarer arrival with the same wording when it can; further recoveries, at most one per class,
   * are added until no stage the walk can reach is under a third of the most placed stage. Both change only
   * the declared perturbations: the walk's blocks, its random draws and its wording stay as they were.
   */
  supplement(
    blocks: readonly BlockDraft[],
    perturbations: PerturbationSpec[],
    candidates: readonly RecoveryOption[],
    relocate = false,
  ): void {
    const prospective = new Map(this.stages);
    for (const stage of this.events(blocks, perturbations))
      prospective.set(stage, (prospective.get(stage) ?? 0) + 1);
    if (relocate) {
      for (const entry of perturbations) {
        const current = candidates.find(
          (option) => option.classId === entry.class && option.index === entry.inject_at,
        );
        if (!current) continue;
        const choices = candidates.filter(
          (option) =>
            option.classId === entry.class &&
            option.user === entry.user &&
            !perturbations.some(
              (other) =>
                other !== entry && other.class === option.classId && other.inject_at === option.index,
            ),
        );
        const best = choices.reduce(
          (best, option) =>
            (prospective.get(option.stage) ?? 0) < (prospective.get(best.stage) ?? 0) ? option : best,
          current,
        );
        if (best.stage === current.stage) continue;
        prospective.set(current.stage, (prospective.get(current.stage) ?? 0) - 1);
        prospective.set(best.stage, (prospective.get(best.stage) ?? 0) + 1);
        entry.inject_at = best.index;
        entry.expect = best.expect;
        entry.recovery = { within_blocks: 0, stage_after: best.stage };
      }
    }
    const classes = new Map(this.classes);
    for (const cls of [
      ...blocks.flatMap((block) => (block.injection ? [block.injection] : [])),
      ...perturbations.map((entry) => entry.class),
    ])
      classes.set(cls, (classes.get(cls) ?? 0) + 1);
    const target = Math.ceil(Math.max(0, ...prospective.values()) / 3);
    const added = new Set<string>();
    let available = candidates.filter(
      (option) =>
        this.stages.has(option.stage) &&
        !perturbations.some((entry) => entry.class === option.classId && entry.inject_at === option.index),
    );
    while (available.length > 0) {
      available = available.filter((option) => !added.has(option.classId));
      const option = available.reduce<RecoveryOption | undefined>((best, candidate) => {
        if (!best) return candidate;
        const placed = prospective.get(candidate.stage) ?? 0;
        const bestPlaced = prospective.get(best.stage) ?? 0;
        return placed < bestPlaced ||
          (placed === bestPlaced && (classes.get(candidate.classId) ?? 0) < (classes.get(best.classId) ?? 0))
          ? candidate
          : best;
      }, undefined);
      if (!option || (prospective.get(option.stage) ?? 0) >= target) break;
      added.add(option.classId);
      perturbations.push({
        id: `p${perturbations.length + 1}-${option.classId}`,
        class: option.classId as PerturbationSpec['class'],
        inject_at: option.index,
        user: option.user,
        expect: option.expect,
        recovery: { within_blocks: 0, stage_after: option.stage },
      });
      prospective.set(option.stage, (prospective.get(option.stage) ?? 0) + 1);
      classes.set(option.classId, (classes.get(option.classId) ?? 0) + 1);
    }
  }

  /** Short approved walks, shortest first, for the rarest stage; one is written only when it brings the stages nearer balance. */
  *stageTopUps(context: SeedContext, existing: number): Generator<SpecDraft> {
    const unsupported = new Set<string>();
    let added = 0;
    while (existing + added < context.max && deficit(this.stages.values()) > 0) {
      const most = Math.max(0, ...this.stages.values());
      const rare = [...this.stages]
        .filter(([stage, count]) => count * 3 < most && !unsupported.has(stage))
        .sort((a, b) => a[1] - b[1])[0];
      if (!rare) return;
      const paths = this.prepared.relations.paths
        .flatMap((path) => {
          const index = path.stages.indexOf(rare[0]);
          if (index < 0) return [];
          const length = Math.max(2, index + 1);
          return length < path.stages.length
            ? [{ ...path, stages: path.stages.slice(0, length), end_state: undefined }, path]
            : [path];
        })
        .sort((a, b) => a.stages.length - b.stages.length);
      let accepted = false;
      for (const path of paths) {
        const before = deficit(this.stages.values());
        const usage =
          context.usage && new Map([...context.usage].map(([key, values]) => [key, new Map(values)]));
        const built = scenarioDraft(
          this.prepared,
          context,
          `gen-stage-balance-${String(this.stageSerial + 1).padStart(3, '0')}`,
          'deviation',
          `Balanced stage arrival ${rare[0]}`,
          [],
          { preferred: [path], others: [] },
          { allocationOnly: true },
        );
        if ('draft' in built && built.draft.blocks.every((block) => block.stimulus.kind !== 'placeholder')) {
          const prospective = new Map(this.stages);
          for (const stage of this.events(built.draft.blocks, built.draft.perturbations))
            prospective.set(stage, (prospective.get(stage) ?? 0) + 1);
          if (deficit(prospective.values()) < before) {
            accepted = true;
            added++;
            this.stageSerial++;
            yield built.draft;
            if (deficit(this.stages.values()) >= before) unsupported.add(rare[0]);
            break;
          }
        }
        context.usage = usage;
      }
      if (!accepted) unsupported.add(rare[0]);
    }
  }

  /** Walks for the behaviours a few specs cover, on a path of a flow that holds the behaviour. */
  *behaviourTopUps(context: SeedContext, existing: number): Generator<SpecDraft> {
    const unsupported = new Set<string>();
    let added = 0;
    while (existing + added < context.max) {
      const rare = [...this.behaviours]
        .flatMap(([dimension, counts]) => {
          const most = Math.max(0, ...counts.values());
          return [...counts]
            .filter(([value, count]) => count * 3 < most && !unsupported.has(`${dimension}=${value}`))
            .map(([value, count]) => ({ dimension, value, count }));
        })
        .sort((a, b) => a.count - b.count)[0];
      if (!rare) return;
      const key = `${rare.dimension}=${rare.value}`;
      const index = this.prepared.space.dimensions[rare.dimension]?.index.get(rare.value);
      const flows = flowsOfBehaviour(this.prepared, rare.value);
      const usage = context.usage && new Map([...context.usage].map(([at, values]) => [at, new Map(values)]));
      const built =
        index === undefined
          ? undefined
          : scenarioDraft(
              this.prepared,
              context,
              `gen-behaviour-balance-${String(this.behaviourSerial + 1).padStart(3, '0')}`,
              'deviation',
              `Balanced behaviour ${rare.value}`,
              [[rare.dimension, index]],
              {
                preferred: this.prepared.relations.paths.filter((path) => flows.includes(path.flow)),
                others: this.prepared.relations.paths.filter((path) => !flows.includes(path.flow)),
              },
              { allocationOnly: true },
            );
      if (
        !built ||
        !('draft' in built) ||
        built.draft.blocks.some((block) => block.stimulus.kind === 'placeholder')
      ) {
        context.usage = usage;
        unsupported.add(key);
        continue;
      }
      const before = this.behaviours.get(rare.dimension)?.get(rare.value) ?? 0;
      added++;
      this.behaviourSerial++;
      yield built.draft;
      if ((this.behaviours.get(rare.dimension)?.get(rare.value) ?? 0) <= before) unsupported.add(key);
    }
  }

  /** The stage, class and behaviour deficits together: zero when no value is under a third of its stratum's most. */
  imbalance(): number {
    return (
      deficit(this.stages.values()) +
      deficit(this.classes.values()) +
      [...this.behaviours.values()].reduce((sum, counts) => sum + deficit(counts.values()), 0)
    );
  }

  /**
   * Alternate walks for rare stages, probes for rare classes and walks for rare behaviours until all hold. A
   * walk that fills a stage declares classes and covers behaviours, and a probe for a class crosses stages,
   * so one fill can undo another; rounds continue while the imbalance keeps reaching new lows. The caller
   * renders each draft and observes the complete spec in `classes` before this iterator resumes.
   */
  *rounds(
    context: SeedContext,
    written: () => number,
    classes: Pick<DeviationBalance, 'topUps'>,
  ): Generator<SpecDraft> {
    // The allocation adds at most as many specs as the seeders wrote, so a map whose strata cannot be
    // balanced cheaply is cut, not grown without end.
    const limit = context.max;
    context.max = Math.min(limit, 2 * written());
    try {
      while (this.imbalance() > 0) {
        const before = written();
        yield* this.stageTopUps(context, before);
        yield* classes.topUps(context, written());
        yield* this.behaviourTopUps(context, written());
        if (written() === before) break;
      }
    } finally {
      context.max = limit;
    }
  }
}

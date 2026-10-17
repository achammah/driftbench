import type { Spec } from '@agent-nexus/driftbench-core';
import { NONE, placeSpec } from '@agent-nexus/driftbench-space';
import type { SpecDraft } from './assemble';
import type { PreparedMap } from './map';
import { hasPaths, type SeedContext, scenarioDraft } from './seed-drafts';

/** Actual probe counts, independent of seeder labels and output suite size. */
export class DeviationBalance {
  private serial = 0;
  private readonly counts: Map<string, number>;

  constructor(private readonly prepared: PreparedMap) {
    this.counts = new Map(
      (prepared.space.dimensions[prepared.deviation ?? -1]?.values ?? [])
        .filter((value) => value.id !== NONE)
        .map((value) => [value.id, 0]),
    );
  }

  observe(spec: Spec): void {
    const dimension = this.prepared.deviation;
    if (dimension === undefined) return;
    for (const event of placeSpec(this.prepared.space, spec).events)
      for (const value of event.values[dimension] ?? []) {
        const cls = this.prepared.space.dimensions[dimension]?.values[value]?.id;
        if (cls && this.counts.has(cls)) this.counts.set(cls, (this.counts.get(cls) ?? 0) + 1);
      }
  }

  /**
   * Add approved scenarios for classes below one third of the most exercised class. Existing specs and
   * random draws stand. The caller renders each draft and observes it only when complete, before resuming
   * this iterator. An unsupported or incomplete class stops without repeated placeholder attempts.
   */
  *topUps(context: SeedContext, existing: number): Generator<SpecDraft> {
    const dimension = this.prepared.deviation;
    if (dimension === undefined || !hasPaths(this.prepared)) return;
    const target = Math.ceil(Math.max(0, ...this.counts.values()) / 3);
    let added = 0;
    for (const cls of this.counts.keys()) {
      while ((this.counts.get(cls) ?? 0) < target && existing + added < context.max) {
        const before = this.counts.get(cls) ?? 0;
        const id = `gen-deviation-balance-${String(this.serial + 1).padStart(3, '0')}`;
        const required = new Set(
          (this.prepared.inventory?.flows ?? [])
            .filter((flow) => (flow.deviations ?? []).includes(cls as never))
            .map((flow) => flow.id),
        );
        const built = scenarioDraft(
          this.prepared,
          context,
          id,
          'deviation',
          `Balanced deviation probe ${cls}`,
          [],
          {
            preferred: this.prepared.relations.paths.filter((path) => required.has(path.flow)),
            others: this.prepared.relations.paths.filter((path) => !required.has(path.flow)),
          },
          { probe: { classId: cls, cut: true } },
        );
        if (!('draft' in built)) break;
        const value = this.prepared.space.dimensions[dimension]?.index.get(cls);
        if (value === undefined) break;
        built.draft.cell.push([dimension, value]);
        added += 1;
        this.serial += 1;
        yield built.draft;
        if ((this.counts.get(cls) ?? 0) <= before) break;
      }
    }
  }
}

import { runSpec, type Spec } from '@agent-nexus/driftbench-core';
import { createPerturbingDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { faultFamily } from '../../../validators/src/ladders/generator/faults';
import { createFollower } from '../../../validators/src/ladders/generator/follower';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { followerAdapter, generateFrom, runContext } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';

it.each([1, 2, 3, 4, 5, 6, 7, 8])(
  'keeps a restated slot observable after an approved perturbation (seed %i)',
  async (seed) => {
    const hidden = hiddenSpec(seed);
    const generated = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
    const candidates = generated.complete.flatMap(({ spec }) =>
      spec.id.startsWith('gen-restated-')
        ? (spec.perturbations ?? []).map((perturbation) => ({ spec, perturbation }))
        : [],
    );
    expect(candidates.length).toBeGreaterThan(0);
    const fault = faultFamily(hidden).find((entry) => entry.def.id === 'X2.slot-first@any/r1');
    if (fault?.def.agent.kind !== 'function') throw new Error('missing fictional slot fault');
    const context = runContext();
    const run = (spec: Spec, id: string, create: Parameters<typeof followerAdapter>[0]) => {
      const driver = createPerturbingDriver({ spec, perturbation: id });
      return runSpec(driver.spec, {
        adapter: followerAdapter(create),
        driver,
        checks: context.checks,
        mode: 'P',
        repeat: 1,
        perturbationId: id,
      });
    };
    let killed = false;
    for (const { spec, perturbation } of candidates) {
      const reference = await run(spec, perturbation.id, createFollower(hidden));
      expect(reference.blocks.length).toBeGreaterThan(0);
      expect(
        reference.blocks.every((block) => block.pass),
        `${spec.id}/${perturbation.id}`,
      ).toBe(true);
      const faulty = await run(spec, perturbation.id, fault.def.agent.create);
      killed ||= faulty.blocks.some((block) => !block.pass);
    }
    expect(killed).toBe(true);
  },
  180_000,
);

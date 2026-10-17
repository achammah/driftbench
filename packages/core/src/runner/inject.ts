import type { DriverContext, DriverStep, UserDriver } from '../contracts/driver';
import type { PerturbationSpec, Spec, Stimulus } from '../schema/spec';

/**
 * A driver that injects one of the spec's perturbations into the steps of another driver (the scripted
 * driver, usually), once, before block `inject_at`. The core's own minimal injector: the core cannot import
 * `@agent-nexus/driftbench-users`, so its tests run mode P on this. The CLI runs mode P on `createPerturbingDriver` of
 * `@agent-nexus/driftbench-users`, which injects the same way for a declared perturbation and adds drawn ones (the
 * red-team pack), the base driver's words for a world change, and the changed block's own world. It decides
 * from its context alone, so one instance can drive any number of runs.
 *
 * A perturbation that writes `user` or `burst` is a block of its own, sent before block `inject_at`. A
 * perturbation that writes only a `world` (a tool forced to fail) changes the world under block
 * `inject_at` itself: the injected block sends that block's own stimulus with the perturbation's world and
 * expectations, and stands in for it, so the base driver resumes at the block after it.
 */
export function injectingDriver(base: UserDriver, perturbationId: string): UserDriver {
  return {
    id: `${base.id}+${perturbationId}`,
    async next(ctx: DriverContext): Promise<DriverStep> {
      const perturbation = ctx.spec.perturbations?.find((entry) => entry.id === perturbationId);
      if (!perturbation) {
        throw new Error(
          `the spec ${ctx.spec.id} has no perturbation ${perturbationId}; it has ${listed(ctx.spec)}`,
        );
      }
      const done = ctx.history.some((block) => block.injected === true && block.blockId === perturbationId);
      if (ctx.blockIndex === perturbation.inject_at) {
        if (!done) {
          return {
            kind: 'injected',
            perturbationId,
            stimulus: injectedStimulus(ctx.spec, perturbation),
            beforeBlock: perturbation.inject_at,
          };
        }
        if (replacesBlock(perturbation)) {
          const blockIndex = ctx.blockIndex + 1;
          return base.next({
            ...ctx,
            blockIndex,
            ...(ctx.branchOf ? { branch: ctx.branchOf(blockIndex) } : {}),
          });
        }
      }
      return base.next(ctx);
    },
  };
}

/** True for a perturbation that writes no message of its own: it changes the world under its block. */
export function replacesBlock(perturbation: PerturbationSpec): boolean {
  return perturbation.user === undefined && perturbation.burst === undefined;
}

/** What an injected block sends: the perturbation's message or burst, else its block's own stimulus. */
export function injectedStimulus(spec: Spec, perturbation: PerturbationSpec): Stimulus {
  if (perturbation.user !== undefined) return { user: perturbation.user };
  if (perturbation.burst !== undefined) return { burst: perturbation.burst };
  const block = spec.blocks[perturbation.inject_at];
  if (!block) {
    throw new Error(
      `the perturbation ${perturbation.id} writes no message and block ${perturbation.inject_at} does not exist to carry its world`,
    );
  }
  return block.when;
}

function listed(spec: Spec): string {
  const ids = (spec.perturbations ?? []).map((entry) => entry.id);
  return ids.length === 0 ? 'none' : ids.join(', ');
}

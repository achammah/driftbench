/**
 * A deviation the users package carries in the world (an instruction found inside data) reaches the agent as
 * supplied data: its approved text is the content of a workspace file, and the turn itself says nothing. The
 * file name says nothing about its content, and no workspace of the spec already uses it.
 */

import type { PerturbationSpec, WorldState } from '@agent-nexus/driftbench-core';
import { DEVIATIONS, isWorldClass } from '@agent-nexus/driftbench-users';

type Workspace = NonNullable<WorldState['workspace']>;

/** True for a class whose carrier is a change of the world, with no user text. */
export function worldCarried(cls: string | undefined): boolean {
  return cls !== undefined && Object.hasOwn(DEVIATIONS, cls) && isWorldClass(cls as keyof typeof DEVIATIONS);
}

/** The plain file name a supplied text gets, the first one no workspace of the spec holds. */
export function suppliedName(used: Set<string>): string {
  let path = 'NOTES.txt';
  for (let suffix = 2; used.has(path); suffix += 1) path = `NOTES-${suffix}.txt`;
  used.add(path);
  return path;
}

/**
 * The workspace a block or perturbation writes: a written workspace replaces the one before it, so it keeps
 * every file the world held at that point and adds the supplied text.
 */
export function supplying(held: Workspace | undefined, used: Set<string>, text: string): Workspace {
  return { ...held, files: { ...held?.files, [suppliedName(used)]: text } };
}

/** Every file path any workspace of the spec names. */
export function usedPaths(
  world: WorldState | undefined,
  blocks: ReadonlyArray<{ given?: { world?: WorldState } }>,
  perturbations: readonly PerturbationSpec[] | undefined,
): Set<string> {
  return new Set(
    [
      world,
      ...blocks.map((block) => block.given?.world),
      ...(perturbations ?? []).map((p) => p.world),
    ].flatMap((entry) => Object.keys(entry?.workspace?.files ?? {})),
  );
}

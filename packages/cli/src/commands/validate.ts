import type { DiffReader, HeadReader, Ladder } from '@agent-nexus/driftbench-validators';
import type { Command } from 'commander';
import type { Io } from '../io';

/**
 * The `validate` command as the CLI registers it. The validators package is large and only this command
 * uses it, so it loads when the command runs (validate-run.ts), not when the CLI starts.
 */

/** The exit code of an input or usage error: kept apart from the level codes 0 to 63. */
export const USAGE_EXIT = 64;

export type ValidateCommandOptions = {
  seed?: string;
  seeds?: string;
  hidden?: boolean;
  json?: boolean;
  checkFloor?: boolean;
  raise?: string;
  evidence?: string;
  brief?: boolean;
  fresh?: boolean;
  journal?: string;
  checkHandover?: boolean;
  branch?: string;
  base?: string;
  items?: boolean;
  hardness?: boolean;
  ladderVersion?: string;
  allLevels?: boolean;
  blind?: boolean;
};

/** What the command runs with. Tests pass their own ladders, root and commit reader. */
export type ValidateDeps = {
  ladders(): Record<string, Ladder>;
  /** Explicit versions in addition to the defaults. */
  versions?(): Record<string, Record<number, Ladder>>;
  /** The repository root; by default the nearest folder above the working folder holding pnpm-workspace.yaml. */
  root?: string;
  /** Reads the commit the hidden seed derives from; by default `git rev-parse HEAD`. */
  readHead?: HeadReader;
  /** Lists the files changed since a base; by default `git diff --name-only base...HEAD`. */
  changedFiles?: DiffReader;
};

/**
 * `driftbench validate <component>`: runs a validator's ladder on its seeds and prints the table. The exit
 * code is the level of the run, the minimum over its seeds of the highest level passed (0 when level 1
 * fails); an input error exits 64. `all` runs every registered validator and exits with the lowest level.
 */
export function registerValidateCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps?: ValidateDeps,
): void {
  program
    .command('validate')
    .description(
      'Run a validator ladder: levels in order, stop at the first failing level, exit with the level',
    )
    .argument('<component>', 'the validator to run, all, or floors (with --raise)')
    .argument('[level]', 'with floors --raise: the level to raise the floor to')
    .option('--seed <n>', 'a visible seed (default 1 when no seed is given)')
    .option('--seeds <a..b>', 'a range of visible seeds, such as 1..20')
    .option('--hidden', 'add the hidden seed derived from git rev-parse HEAD')
    .option('--json', 'print the report as JSON')
    .option('--check-floor', 'exit 1 when a run is below its floor in validators/floors.json, else 0')
    .option('--raise <component>', 'with floors: raise the floor of this component to [level]')
    .option('--evidence <json>', 'with floors --raise: the --json run that reaches the level')
    .option('--ladder-version <n>', 'select a registered version; with floors --raise: the floor version')
    .option(
      '--items',
      'also list the whole bank per family and tier, pass or fail per seed, from the same run',
    )
    .option(
      '--all-levels',
      'compute every level and list every failing item with its level, family, tier and cause',
    )
    .option(
      '--blind',
      'the auditor view: strip every cause and trailing "Fix:" hint from items, text and JSON',
    )
    .option(
      '--hardness',
      'print the hardness measurement of docs/validators.md section 12.4 from the journal',
    )
    .option('--brief', 'print validators/EXECUTOR.md with the live state of the loop embedded')
    .option('--fresh', "with --brief: leave out the handover's hypotheses (the handover test)")
    .option('--journal <row.json>', "append a validated journal row and rewrite the handover's level table")
    .option('--check-handover', 'exit 1 when HANDOVER.md misses a section or disagrees with the journal')
    .option('--branch <name>', 'with protect: the branch of the pull request')
    .option('--base <ref>', 'with protect: the ref the pull request merges into, such as origin/main')
    .action(async (component: string, level: string | undefined, options: ValidateCommandOptions) => {
      setExit(await validateCommand(component, options, io, deps, level));
    });
}

/** Runs the command. Without `deps` it runs the registered ladders on the repository above the working folder. */
export async function validateCommand(
  component: string,
  options: ValidateCommandOptions,
  io: Io,
  deps?: ValidateDeps,
  level?: string,
): Promise<number> {
  const run = await import('./validate-run');
  return run.validateCommand(component, options, io, deps, level);
}

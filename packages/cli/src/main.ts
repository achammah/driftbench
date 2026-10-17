import { Command, CommanderError, Help } from 'commander';
import { COMMAND_HELP, COMMAND_MODULES, type Register } from './command-index';
import type { CampaignDeps } from './commands/campaign';
import {
  type CommandLine,
  commandHelpFooter,
  formatCommandList,
  loadHelpTopics,
  runHelpTopics,
} from './help-topics';
import { type Io, processIo } from './io';
import { applyPlugins, beginPluginRun, type DriftbenchPlugin, pluginsFromRun } from './plugins';
import { VERSION } from './version';

/** What a caller in code may give `main` beside the arguments. */
export type MainOptions = {
  /**
   * What the commands run with, laid over the defaults (`defaultDeps` of the campaign commands): the
   * adapters, the checks, the driver, the store. Read by campaign, smoke, family, perturb, simulate, attack,
   * ci and monitor.
   */
  deps?: Partial<CampaignDeps>;
  /** Plugins given in code; they run before the plugins of the project config and of `--plugin`. */
  plugins?: readonly DriftbenchPlugin[];
};

/**
 * Runs the CLI with arguments (without `node` and the script) and returns the exit code. Plugins load first:
 * those of `options.plugins`, of the project config's `plugins` list and of `--plugin` (see `./plugins`).
 */
export async function main(argv: string[], io: Io = processIo, options: MainOptions = {}): Promise<number> {
  // The shared registry is filled before plugins or any command resolve objects. Printing the top-level help or
  // the version needs no object, so that path loads no other package.
  if (!printsIndexOnly(argv)) (await import('@agent-nexus/driftbench-core')).initializeShippedObjects();
  let exitCode = 0;
  const setExit = (code: number) => {
    exitCode = code;
  };
  const restorePlugins = beginPluginRun();
  try {
    const refused = options.plugins === undefined ? undefined : await applyPlugins(options.plugins, io.cwd);
    const run =
      refused === undefined ? await pluginsFromRun(argv, io) : { ok: false as const, message: refused };
    if (!run.ok) {
      io.err(`driftbench: ${run.message}\n`);
      return 2;
    }
    // `help` alone and `help <topic>` print the help topics; `help <command>` stays the command's usage.
    const topics = runHelpTopics(run.argv, io, COMMAND_NAMES);
    if (topics !== undefined) return topics;
    if (run.argv.length === 2 && run.argv[0] === 'help' && run.argv[1] === '--list') {
      io.out(formatCommandList(await commandLines(io), loadHelpTopics()));
      return 0;
    }
    const program = await createProgram(run.argv, io, setExit, options.deps);

    try {
      await program.parseAsync(run.argv, { from: 'user' });
    } catch (cause) {
      if (cause instanceof CommanderError) return cause.exitCode === 0 ? 0 : 2;
      // A path the user gave that cannot be used as asked (a file where a folder must go, a folder where a file
      // must go, a missing file) is an input error: exit 2 with the reason, never a stack trace.
      const path = pathError(cause);
      if (path !== undefined) {
        io.err(`driftbench: ${path}\n`);
        return 2;
      }
      throw cause;
    }
    return exitCode;
  } finally {
    restorePlugins();
  }
}

/** Every top-level command name. */
const COMMAND_NAMES: ReadonlySet<string> = new Set(COMMAND_MODULES.flatMap((module) => module.names));

/** The arguments that only print the top-level help or the version: no command module is needed. */
const INDEX_ONLY = new Set(['--help', '-h', '--version', '-V', 'help']);

/** True for the arguments that only print the top-level help or the version. */
function printsIndexOnly(argv: readonly string[]): boolean {
  return argv.length === 0 || (argv.length === 1 && INDEX_ONLY.has(argv[0] as string));
}

/**
 * The program for these arguments, with only the command modules they need. A command (or `help <command>`)
 * loads its own module; the top-level help and the version load none and list the commands from
 * COMMAND_HELP; anything else (an unknown command, an option before the command) loads every module, so
 * commander answers exactly as it would with all of them.
 */
export async function createProgram(
  argv: readonly string[],
  io: Io,
  setExit: (code: number) => void,
  deps?: Partial<CampaignDeps>,
): Promise<Command> {
  const first = argv[0] === 'help' && argv.length === 2 ? argv[1] : argv[0];
  if (printsIndexOnly(argv)) return indexProgram(io);
  const own = COMMAND_MODULES.filter((module) => first !== undefined && module.names.includes(first));
  const modules = own.length > 0 ? own : COMMAND_MODULES;
  const registers = await Promise.all(modules.map((module) => module.load()));
  if (deps === undefined) return fullProgram(registers, io, setExit);
  // The caller's deps go to the commands that take campaign deps, laid over the defaults.
  const merged: CampaignDeps = { ...(await import('./commands/campaign')).defaultDeps, ...deps };
  const withDeps = registers.map((register, index): Register => {
    const takes = (modules[index]?.names ?? []).some((name) => DEPS_COMMANDS.has(name));
    if (!takes) return register;
    return (program, commandIo, exit) => (register as RegisterWithDeps)(program, commandIo, exit, merged);
  });
  return fullProgram(withDeps, io, setExit);
}

/** The commands whose register function takes campaign deps as its fourth argument. */
const DEPS_COMMANDS = new Set([
  'campaign',
  'smoke',
  'family',
  'perturb',
  'simulate',
  'attack',
  'redteam',
  'ci',
  'monitor',
]);
type RegisterWithDeps = (
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps,
) => void;

/** The program with these command modules registered, in the order given. */
export function fullProgram(
  registers: readonly Register[],
  io: Io,
  setExit: (code: number) => void,
): Command {
  const program = rootProgram(io);
  for (const register of registers) register(program, io, setExit);
  pointToTopics(program, []);
  return program;
}

/** Every command of the full program with its description, depth first, in the order registered. */
export async function commandLines(io: Io): Promise<CommandLine[]> {
  const program = fullProgram(
    await Promise.all(COMMAND_MODULES.map((module) => module.load())),
    io,
    () => {},
  );
  const lines: CommandLine[] = [];
  const walk = (command: Command, path: readonly string[]) => {
    for (const sub of command.commands) {
      const own = [...path, sub.name()];
      lines.push({ path: own.join(' '), description: sub.description() });
      walk(sub, own);
    }
  };
  walk(program, []);
  return lines;
}

/** Ends the usage of every command with the help topics about it, read only when the usage prints. */
function pointToTopics(command: Command, path: readonly string[]): void {
  for (const sub of command.commands) {
    const own = [...path, sub.name()];
    sub.addHelpText('after', () => commandHelpFooter(loadHelpTopics(), own.join(' ')));
    pointToTopics(sub, own);
  }
}

/**
 * The program that only prints the top-level help and the version: one placeholder per command, which help
 * lists with the term and the description of COMMAND_HELP, as the full program would.
 */
export function indexProgram(io: Io): Command {
  const program = rootProgram(io);
  const terms = new Map<Command, string>();
  for (const [term, description] of COMMAND_HELP) {
    terms.set(program.command(term.split(' ', 1)[0] as string).description(description), term);
  }
  const help = new Help();
  program.configureHelp({ subcommandTerm: (command) => terms.get(command) ?? help.subcommandTerm(command) });
  return program;
}

function rootProgram(io: Io): Command {
  return (
    new Command('driftbench')
      .description('Block-level evaluation for AI agents.')
      .version(VERSION)
      // Read before the arguments are parsed (see ./plugins), wherever it stands; listed here for the help.
      .option(
        '--plugin <module>',
        'load a plugin before the command runs: a module path or a package name; repeat for several',
      )
      .addHelpText('after', '\nHelp topics, each capability and how to use it: driftbench help')
      .exitOverride()
      .configureOutput({ writeOut: (text) => io.out(text), writeErr: (text) => io.err(text) })
  );
}

const PATH_CODES = new Set([
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'EEXIST',
  'EACCES',
  'EPERM',
  'ENAMETOOLONG',
  'ELOOP',
]);

/** The message of a file system error on a path, or undefined for any other error. */
function pathError(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const { code, path } = cause as Error & { code?: unknown; path?: unknown };
  if (typeof code !== 'string' || !PATH_CODES.has(code)) return undefined;
  // A read that fails after the open (EISDIR on a folder) carries no path: the message names the cause.
  return typeof path === 'string'
    ? `cannot use ${path}: ${cause.message}`
    : `cannot read the input: ${cause.message}`;
}

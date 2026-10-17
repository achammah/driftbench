import type { Command } from 'commander';
import type { Io } from './io';

/** Adds one command module's commands to the program. */
export type Register = (program: Command, io: Io, setExit: (code: number) => void) => void;

/**
 * Every command module, in the order the commands are registered (the order `--help` lists them), with the
 * top-level command names it adds. A module loads only when one of its commands runs, so a command loads its
 * own packages and no others. Two modules add to `import`: the second finds the command the first made.
 */
export const COMMAND_MODULES: readonly { names: readonly string[]; load: () => Promise<Register> }[] = [
  { names: ['spec'], load: async () => (await import('./commands/spec')).registerSpecCommands },
  { names: ['campaign'], load: async () => (await import('./commands/campaign')).registerCampaignCommands },
  { names: ['smoke'], load: async () => (await import('./commands/smoke')).registerSmokeCommand },
  { names: ['space'], load: async () => (await import('./commands/space')).registerSpaceCommands },
  { names: ['extract'], load: async () => (await import('./commands/extract')).registerExtractCommand },
  { names: ['generate'], load: async () => (await import('./commands/generate')).registerGenerateCommand },
  { names: ['intake'], load: async () => (await import('./commands/intake')).registerIntakeCommand },
  { names: ['estate'], load: async () => (await import('./commands/estate')).registerEstateCommand },
  { names: ['replay'], load: async () => (await import('./commands/replay')).registerReplayCommand },
  { names: ['gate'], load: async () => (await import('./commands/gate')).registerGateCommand },
  { names: ['family'], load: async () => (await import('./commands/family')).registerFamilyCommand },
  { names: ['pilot'], load: async () => (await import('./commands/pilot')).registerPilotCommand },
  { names: ['perturb'], load: async () => (await import('./commands/perturb')).registerPerturbCommand },
  { names: ['simulate'], load: async () => (await import('./commands/simulate')).registerSimulateCommand },
  { names: ['attack'], load: async () => (await import('./commands/attack')).registerAttackCommand },
  { names: ['redteam'], load: async () => (await import('./commands/redteam')).registerRedteamCommand },
  { names: ['judge'], load: async () => (await import('./commands/judge')).registerJudgeCommand },
  { names: ['validate'], load: async () => (await import('./commands/validate')).registerValidateCommand },
  { names: ['report'], load: async () => (await import('./commands/report')).registerReportCommand },
  { names: ['compare'], load: async () => (await import('./commands/compare')).registerCompareCommand },
  { names: ['ci'], load: async () => (await import('./commands/ci')).registerCiCommand },
  { names: ['monitor'], load: async () => (await import('./commands/monitor')).registerMonitorCommand },
  { names: ['select'], load: async () => (await import('./commands/select')).registerSelectCommand },
  { names: ['radius'], load: async () => (await import('./commands/radius')).registerRadiusCommand },
  { names: ['holdout'], load: async () => (await import('./commands/holdout')).registerHoldoutCommand },
  { names: ['queue'], load: async () => (await import('./commands/queue')).registerQueueCommand },
  { names: ['view'], load: async () => (await import('./commands/view')).registerViewCommand },
  { names: ['import'], load: async () => (await import('./commands/import')).registerImportCommand },
  {
    names: ['dataset', 'prompt'],
    load: async () => (await import('./commands/registry')).registerRegistryCommands,
  },
  {
    names: ['import'],
    load: async () => (await import('./commands/import-traces')).registerTraceImportCommands,
  },
  { names: ['object'], load: async () => (await import('./commands/object')).registerObjectCommand },
];

/**
 * The top-level command list of `driftbench --help`: the term and the description of each command, as the
 * command modules declare them, so the help prints without loading any of them. A test builds the full
 * program and fails, printing the list to paste here, when a command module changes one of these lines.
 */
export const COMMAND_HELP: readonly (readonly [term: string, description: string])[] = [
  ['spec', 'Check spec files.'],
  ['campaign', 'Plan and run campaigns: specs x targets x modes x repeats.'],
  [
    'smoke [options] <spec>',
    'Run one spec several times with the cache off and report whether the transcripts differ',
  ],
  ['space', 'The declared map of situations an agent can face, and the coverage counted on it.'],
  [
    'extract [options]',
    'Propose the map of situations from a prompt and an inventory, for a person to approve',
  ],
  [
    'generate [options]',
    'Generate specs from an approved map, by code: graph paths, t-wise rows, boundaries, probes',
  ],
  ['intake', 'Build the reference set of user turns: from past conversations, or from an interview'],
  ['estate', 'Read an agent estate into atoms, lint it, approve its prose atoms, export its space map'],
  [
    'replay [options] <sessions...>',
    'Re-run the checks of a spec suite on recorded sessions: no agent call; a judge model only with --judge.',
  ],
  [
    'gate [options] <specs>',
    'Pass candidate blocks through the nine-stage validity gate and write the gated suite',
  ],
  ['family', 'Code-agent task families: build instances from a seed, verify them on the reference build'],
  ['pilot', 'Measure where results vary (cell, conversation, wording, repeat) and set the noise floor.'],
  ['perturb [options] <spec>', 'Run one spec in mode P with one deviation injected, and print the recovery'],
  [
    'simulate [options] <spec>',
    'Run one spec with a simulated user playing a persona, through the model port or a recording',
  ],
  [
    'attack [options] <spec>',
    'Attack one spec adaptively: each deviation is picked from the agent’s last replies',
  ],
  ['redteam', 'Run Crescendo or GOAT; list red-team plugins, generate a spec from one and grade it.'],
  ['judge', 'Judge criteria with the council: replay recorded answers, or validate criteria and fixtures'],
  [
    'validate [options] <component> [level]',
    'Run a validator ladder: levels in order, stop at the first failing level, exit with the level',
  ],
  [
    'report [options] [campaign]',
    'Write the scorecard of a stored campaign as one HTML file, and its JUnit XML. Exit 0 when written, 2 on bad input.',
  ],
  [
    'compare [options]',
    'Compare a candidate campaign with a baseline on the goldens both ran. Exit 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input.',
  ],
  [
    'ci [options]',
    'Run the specs on a candidate target, compare with a baseline campaign as `compare` does and gate: exit 0 on parity, 1 on a regression or a comparison not shown non-inferior, 2 on bad input.',
  ],
  [
    'monitor [options] [path]',
    'Watch one metric across the campaigns of a store for a shift: CUSUM, Page-Hinkley and a sliding KS test. Exit 1 when two of the three alarm.',
  ],
  [
    'select [options]',
    'Choose the golden set: the fewest gated conversations covering the cells of the map, then the k best.',
  ],
  [
    'radius [options] <paths...>',
    'Print the blast radius of a change: the blocks it can affect, against the whole suite',
  ],
  ['holdout', 'The sealed holdout: seal a share of the gated specs, then score it once per query.'],
  ['queue', 'The review queue of blocks to label, beside the labels'],
  [
    'view [options]',
    'Serve a local viewer of a store on 127.0.0.1: campaigns, runs, block drilldown, compare, spread, and hand labels for judge calibrate. Runs until stopped.',
  ],
  ['import', 'Turn the rows of a CSV file or a spreadsheet into spec files, through a mapping file.'],
  ['dataset', 'Version spec sets in the store: push, list, diff and restore immutable versions.'],
  ['prompt', 'Version prompts in the store: push, list, diff and restore immutable versions.'],
  [
    'object',
    'The objects of the rules framework: list, show, explain, diff, init, validate, graph, migrate, push.',
  ],
];

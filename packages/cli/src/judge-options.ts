import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Check, CheckSet, Embedder, ToolRule } from '@agent-nexus/driftbench-core';
import type {
  Cassette,
  CouncilMode,
  EscalationTrigger,
  JudgeClient,
  JudgeRequest,
  JudgeResult,
  PersonalDataVerdict,
} from '@agent-nexus/driftbench-judges';
import type { Command } from 'commander';
import type { Io } from './io';
import { addJudgeSettingOptions, type JudgeSettingOptions, judgeSettingsFrom } from './judge-settings';
import { optionNumber } from './number';
import { pluginEmbedder } from './plugins';

/**
 * The judge flags every command that judges shares, and the run-wide check flags beside them. One module
 * parses them, so `replay`, `estate run`, `campaign run`, `campaign resume`, `campaign rejudge`, `ci`, `smoke`,
 * `judge run`, `judge calibrate` and `compare --pairwise` read a judge the same way.
 *
 * A judge is `--judge <kind>:<model>`, repeatable: one gives a single judge, several a council. Keys come from
 * the environment, as each client reads them. `--judges <cassette.json>` adds every judge of a recording as a
 * player, with no call. On top of the judges: a label-blind escalation route, a weighted panel with an abstain,
 * and a reference solve. With none of these flags nothing changes: a command judges as it did before.
 *
 * The run-wide judge settings of `./judge-settings` (`--verify`, `--prompt-budget`) ride with these flags: each
 * judge, live or recorded, is wrapped by them.
 */

/** The line a stand-in command carries in its first lines. Any other command is billed. */
export const STAND_IN_MARKER = '@driftbench-stand-in';

/** True when the command is a file that names itself a stand-in in its first lines. */
export async function isStandIn(command: string): Promise<boolean> {
  if (!command.includes('/')) return false;
  const handle = await open(command, 'r').catch(() => undefined);
  if (!handle) return false;
  try {
    const buffer = Buffer.alloc(2048);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').includes(STAND_IN_MARKER);
  } finally {
    await handle.close();
  }
}

/** The judge kinds `--judge <kind>:<model>` takes. */
export const JUDGE_KINDS = [
  'claude',
  'openai',
  'anthropic',
  'google',
  'openai-decisions',
  'jev',
  'http',
] as const;

/** The kinds a reference solve speaks through: the plain-text completion of a provider, or the claude command. */
const SOLVE_KINDS = ['claude', 'openai', 'anthropic', 'google'] as const;

const MODES: readonly CouncilMode[] = ['system1', 'hybrid', 'llm'];
const TRIGGERS: readonly EscalationTrigger[] = [
  'order-split',
  'inconclusive',
  'reference-disagreement',
  'low-confidence',
];

export type JudgeFlags = {
  /** `kind:model`, once or repeated. A string where code passes one. */
  judge?: string | string[];
  judgeCommand?: string;
  judgeBudget?: string;
  /** A cassette whose judges join the pool as players. */
  judges?: string;
  judgeMode?: string;
  assignments?: string;
  cascade?: boolean;
  weights?: string;
  panelWeights?: string;
  panelMargin?: string;
  judgeRoute?: string;
  routeFirst?: string;
  routeThen?: string[];
  routeOn?: string;
  routeConfidence?: string;
  routeDecide?: string;
  referenceSolve?: string;
  referenceSamples?: string;
  referenceRoute?: string;
  record?: string;
  agentFamily?: string;
} & JudgeSettingOptions;

/** The judge flags `replay`, `estate run` and `campaign rejudge` took before; still their option type. */
export type RunJudgeOptions = JudgeFlags;

export type JudgeOptionGroups = {
  /** `--judge-mode`, `--assignments`, `--cascade`, `--weights`. Default true. */
  council?: boolean;
  /** `--agent-family`; off where the command already has it. Default true. */
  agentFamily?: boolean;
  /** `--record`. Default true. */
  record?: boolean;
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const KIND_HELP = `kind ${JUDGE_KINDS.join(', ')}; http takes http:<family>@<url>`;

/** Adds the judge flags. The groups a command leaves out are not added. */
export function addJudgeOptions(command: Command, groups: JudgeOptionGroups = {}): Command {
  addJudgeSettingOptions(command)
    .option(
      '--judge <kind:model>',
      `judge the judged criteria with this judge, such as claude:haiku or openai:<model> (${KIND_HELP}); repeat it for a council. Keys come from the environment. Paid calls`,
      collect,
      [],
    )
    .option('--judge-command <path>', 'the claude command a claude judge runs (default claude)')
    .option(
      '--judge-budget <usd>',
      'stop judging once the judges have spent this much; needed for a billed claude judge',
    )
    .option(
      '--judges <cassette>',
      'add every judge of this recording (a cassette JSON file) as a player: no call',
    );
  if (groups.council !== false) {
    command
      .option('--judge-mode <mode>', `the council mode: ${MODES.join(', ')} (default from the judge classes)`)
      .option('--assignments <file>', 'the council assignment table judge calibrate wrote')
      .option('--cascade', 'the council runs its cheapest judge first and stops on a sure pass')
      .option(
        '--weights <weights>',
        'council vote weights, judge=weight,... or a YAML file of judge: weight',
      );
  }
  addRouteOptions(command);
  if (groups.record !== false) {
    command.option(
      '--record <cassette>',
      'save every live judge answer as a cassette, to replay with --judges',
    );
  }
  if (groups.agentFamily !== false) {
    command.option(
      '--agent-family <family>',
      'the model family of the agent under test: a judge of that family is refused; none for no model',
    );
  }
  return command;
}

/** The escalation route, the weighted panel and the reference solve: flags of every command that judges. */
export function addRouteOptions(command: Command): Command {
  return command
    .option('--judge-route <route>', 'route each call through a label-blind router: escalation')
    .option(
      '--route-first <judge>',
      'with --judge-route escalation: the judge that answers first (kind:model or a judge id)',
    )
    .option(
      '--route-then <judge>',
      'with --judge-route escalation: a judge asked when a trigger fires; repeat for several',
      collect,
      [],
    )
    .option(
      '--route-on <triggers>',
      `with --judge-route escalation: the triggers, comma separated (default ${TRIGGERS.join(',')})`,
    )
    .option(
      '--route-confidence <p>',
      'with --judge-route escalation: the low-confidence bar, from 0 to 1 (default 0.5)',
    )
    .option(
      '--route-decide <rule>',
      'with --judge-route escalation: majority or first-stands (default majority)',
    )
    .option(
      '--panel-weights <weights>',
      'a weighted panel of every judge, judge=weight,... or a YAML file; a thin margin abstains',
    )
    .option(
      '--panel-margin <share>',
      'with --panel-weights: the smallest winning margin, a share of the total weight (default 0.3)',
    )
    .option(
      '--reference-solve <kind:model>',
      `solve each question blind first, and judge against the agreed answer (kind ${SOLVE_KINDS.join(', ')})`,
    )
    .option('--reference-samples <n>', 'with --reference-solve: how many solves, from 1 to 20 (default 5)')
    .option(
      '--reference-route <route>',
      'with --reference-solve: auto solves only a question with one checkable answer',
    );
}

export type RunJudge = {
  check: Check;
  piiJudge?: (text: string) => Promise<PersonalDataVerdict>;
  /** What the judges have spent so far, in US dollars. */
  spend: { usd: number };
  /** `claude:<model>`, the judges joined, or `none`. */
  label: string;
  /** Every judge id, for the campaign record. */
  judges: string[];
  /** The council mode the campaign records. */
  mode: CouncilMode;
  billed: boolean;
  /** The judge as one client, when it is not a council. */
  client?: JudgeClient;
  /** Writes the `--record` cassette, when one was asked. */
  save(): Promise<void>;
};

/** True when a flag that asks for a judge is set. */
export function judgeAsked(flags: JudgeFlags): boolean {
  return judgeList(flags).length > 0 || flags.judges !== undefined || flags.judgeRoute !== undefined;
}

function judgeList(flags: JudgeFlags): string[] {
  const value = flags.judge;
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return list.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/** The flags that only shape a judge: they need one. */
function shapingFlags(flags: JudgeFlags): string[] {
  const set: [string, unknown][] = [
    ['--judge-command', flags.judgeCommand],
    ['--judge-budget', flags.judgeBudget],
    ['--judge-mode', flags.judgeMode],
    ['--assignments', flags.assignments],
    ['--cascade', flags.cascade ? true : undefined],
    ['--weights', flags.weights],
    ['--panel-weights', flags.panelWeights],
    ['--panel-margin', flags.panelMargin],
    ['--judge-route', flags.judgeRoute],
    ['--route-first', flags.routeFirst],
    ['--route-then', flags.routeThen?.length ? flags.routeThen : undefined],
    ['--route-on', flags.routeOn],
    ['--route-confidence', flags.routeConfidence],
    ['--route-decide', flags.routeDecide],
    ['--reference-solve', flags.referenceSolve],
    ['--reference-samples', flags.referenceSamples],
    ['--reference-route', flags.referenceRoute],
    ['--record', flags.record],
    ['--verify', flags.verify],
    ['--prompt-budget', flags.promptBudget],
  ];
  return set.filter(([, value]) => value !== undefined).map(([name]) => name);
}

/** The refusal of flags that shape a judge given with no judge: `--verify needs ...`, `--a and --b need ...`. */
export function judgeNeeded(flags: readonly string[]): string {
  const verb = flags.length === 1 ? 'needs' : 'need';
  return `${flags.join(' and ')} ${verb} --judge claude:<model>, another --judge <kind>:<model>, or --judges <cassette>`;
}

/**
 * The judge of a run (`replay`, `estate run`, `campaign rejudge`). With no judge flag every criterion a block
 * names is inconclusive and gates as the criterion does: never a pass. Undefined on bad input, reported.
 */
export async function runJudgeFrom(
  options: JudgeFlags,
  io: Io,
  env: Record<string, string | undefined> = process.env,
): Promise<RunJudge | undefined> {
  if (!judgeAsked(options)) {
    const stray = shapingFlags(options);
    if (stray.length > 0) {
      io.err(`error: ${judgeNeeded(stray)}\n`);
      return undefined;
    }
    const { noJudgeCheck } = await import('@agent-nexus/driftbench-judges');
    return {
      check: noJudgeCheck(),
      spend: { usd: 0 },
      label: 'none',
      judges: [],
      mode: 'system1',
      billed: false,
      save: async () => {},
    };
  }
  return buildJudge(options, io, env, { council: true });
}

/**
 * The judge of a command that judges only when asked (`campaign run`, `campaign resume`, `ci`, `smoke`): undefined
 * when no judge flag is set, null on bad input (reported).
 */
export async function optionalJudgeFrom(
  options: JudgeFlags,
  io: Io,
  env: Record<string, string | undefined> = process.env,
): Promise<RunJudge | undefined | null> {
  if (!judgeAsked(options)) {
    const stray = shapingFlags(options);
    if (stray.length > 0) {
      io.err(`error: ${judgeNeeded(stray)}\n`);
      return null;
    }
    return undefined;
  }
  return (await buildJudge(options, io, env, { council: true })) ?? null;
}

/**
 * One judge as a client, for a command that asks one client (`compare --pairwise`): the single judge, the
 * escalation route or the weighted panel. A council is refused there: it is not one client.
 */
export async function clientJudgeFrom(
  options: JudgeFlags,
  io: Io,
  env: Record<string, string | undefined> = process.env,
): Promise<RunJudge | undefined> {
  const judge = await buildJudge(options, io, env, { council: false });
  if (judge && !judge.client) {
    io.err(
      'error: this command asks one judge: give one --judge, a --judge-route or a --panel-weights panel\n',
    );
    return undefined;
  }
  return judge;
}

type Pool = {
  clients: JudgeClient[];
  /** The spec a live judge was given as, and its id, both naming it. */
  byName: Map<string, JudgeClient>;
};

type Built = {
  spend: { usd: number };
  billed: boolean;
  budget: number | undefined;
  cassette: Cassette | undefined;
  make(spec: string): Promise<JudgeClient | string>;
};

/**
 * Every judge the flags name, live or recorded, wrapped for the shared budget and the recording. A model the
 * flags name reaches only its own client; the family of a judge is the one its client declares.
 */
async function buildJudge(
  options: JudgeFlags,
  io: Io,
  env: Record<string, string | undefined>,
  shape: { council: boolean },
): Promise<RunJudge | undefined> {
  const J = await import('@agent-nexus/driftbench-judges');
  const settings = judgeSettingsFrom(options, io);
  if (settings === undefined) return undefined;
  let budget: number | undefined;
  if (options.judgeBudget !== undefined) {
    budget = optionNumber(options.judgeBudget);
    if (!Number.isFinite(budget) || budget <= 0) {
      io.err(`error: --judge-budget takes a positive number of US dollars, not "${options.judgeBudget}"\n`);
      return undefined;
    }
  }
  const spend = { usd: 0 };
  const cassette = options.record === undefined ? undefined : J.emptyCassette();
  const claudePath = options.judgeCommand === undefined ? 'claude' : resolve(io.cwd, options.judgeCommand);
  const claudeBilled = !(await isStandIn(claudePath));
  const state: Built = {
    spend,
    billed: false,
    budget,
    cassette,
    async make(spec) {
      const parsed = parseJudgeSpec(spec);
      if (typeof parsed === 'string') return parsed;
      let client: JudgeClient;
      try {
        client = await liveClient(parsed, { env, claudePath, budget });
      } catch (cause) {
        return `--judge ${spec}: ${cause instanceof Error ? cause.message : String(cause)}`;
      }
      if (parsed.kind === 'claude') {
        if (claudeBilled && budget === undefined)
          return 'a judge on a command that is not a stand-in is billed: pass --judge-budget <usd>';
        if (claudeBilled) state.billed = true;
      } else {
        // A provider judge always reaches a provider: it is billed by that provider.
        state.billed = true;
      }
      if (cassette) client = J.recordingClient(client, cassette);
      return capped(settings(client), spend, budget, J.JudgeError);
    },
  };

  const pool: Pool = { clients: [], byName: new Map() };
  const add = (name: string, client: JudgeClient): string | undefined => {
    if (pool.clients.some((other) => other.id === client.id)) return `two judges are named ${client.id}`;
    pool.clients.push(client);
    pool.byName.set(name, client);
    pool.byName.set(client.id, client);
    return undefined;
  };
  for (const spec of judgeList(options)) {
    const made = await state.make(spec);
    const problem = typeof made === 'string' ? made : add(spec, made);
    if (problem !== undefined) {
      io.err(`error: ${problem}\n`);
      return undefined;
    }
  }
  if (options.judges !== undefined) {
    try {
      const recorded = await J.loadCassette(resolve(io.cwd, options.judges));
      for (const player of J.cassettePlayers(recorded)) {
        const problem = add(player.id, settings(player));
        if (problem !== undefined) throw new Error(problem);
      }
    } catch (cause) {
      io.err(
        `error: --judges ${options.judges}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      return undefined;
    }
  }
  return composeJudge(options, io, env, pool, state, shape);
}

/** Composes the pool into the one judge of the run: a route, a panel, a council or the single judge. */
async function composeJudge(
  options: JudgeFlags,
  io: Io,
  env: Record<string, string | undefined>,
  pool: Pool,
  state: Built,
  shape: { council: boolean },
): Promise<RunJudge | undefined> {
  const J = await import('@agent-nexus/driftbench-judges');
  const fail = (message: string): undefined => {
    io.err(`error: ${message}\n`);
    return undefined;
  };
  const agentFamily = options.agentFamily?.trim() || undefined;
  if (options.judgeRoute !== undefined && options.panelWeights !== undefined)
    return fail('--judge-route and --panel-weights are two ways to decide: give one');

  let client: JudgeClient | undefined;
  let label: string;
  let used: JudgeClient[];
  try {
    if (options.judgeRoute !== undefined) {
      const resolveRef = async (ref: string): Promise<JudgeClient | string> => {
        const known = pool.byName.get(ref.trim());
        if (known) return known;
        const made = await state.make(ref.trim());
        if (typeof made === 'string') return made;
        pool.byName.set(ref.trim(), made);
        return made;
      };
      const routed = await escalationFrom(options, resolveRef);
      if (typeof routed === 'string') return fail(routed);
      ({ client, used, label } = routed);
    } else {
      for (const [flag, value] of [
        ['--route-first', options.routeFirst],
        ['--route-then', options.routeThen?.length ? 'set' : undefined],
        ['--route-on', options.routeOn],
        ['--route-confidence', options.routeConfidence],
        ['--route-decide', options.routeDecide],
      ] as const) {
        if (value !== undefined) return fail(`${flag} goes with --judge-route escalation`);
      }
      if (pool.clients.length === 0)
        return fail('no judge: give --judge <kind>:<model> or --judges <cassette>');
      used = pool.clients;
      if (options.panelWeights !== undefined) {
        const panel = await panelFrom(options, used, io);
        if (typeof panel === 'string') return fail(panel);
        ({ client, label } = panel);
      } else if (options.panelMargin !== undefined) {
        return fail('--panel-margin goes with --panel-weights');
      } else {
        const council =
          used.length > 1 ||
          options.judges !== undefined ||
          options.judgeMode !== undefined ||
          options.assignments !== undefined ||
          options.cascade === true ||
          options.weights !== undefined;
        if (!council) {
          client = used[0] as JudgeClient;
          label = judgeList(options)[0] as string;
        } else {
          if (!shape.council) return fail('this command asks one judge: a council is not one');
          return councilJudge(options, io, pool, state, agentFamily);
        }
      }
    }
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
  if (agentFamily !== undefined) {
    const conflict = sharedFamily(client, agentFamily, J);
    if (conflict !== undefined)
      return fail(
        `judge ${client.id} is from the ${conflict} family, the family of the agent under test: refused`,
      );
  }
  if (options.referenceSolve !== undefined) {
    const wrapped = await withReference(client, options, io, env, state);
    if (wrapped === undefined) return undefined;
    client = wrapped;
  } else if (options.referenceSamples !== undefined || options.referenceRoute !== undefined) {
    return fail('--reference-samples and --reference-route go with --reference-solve');
  }
  const judge = client;
  return {
    check: J.singleJudgeCheck(judge),
    piiJudge: (text) => J.judgePersonalData(judge, text),
    spend: state.spend,
    label,
    judges:
      options.judgeRoute !== undefined || options.panelWeights !== undefined
        ? used.map((entry) => entry.id)
        : [label],
    mode: classMode(used),
    billed: state.billed,
    client: judge,
    save: async () => saveRecording(options, io, state),
  };
}

/**
 * The label-blind escalation route of `--judge-route escalation`: the first judge answers, the others are asked
 * when a trigger fires. `resolve` finds the judge a reference names. A message on bad input.
 */
export async function escalationFrom(
  options: JudgeFlags,
  resolve: (ref: string) => Promise<JudgeClient | string>,
): Promise<{ client: JudgeClient; used: JudgeClient[]; label: string } | string> {
  const J = await import('@agent-nexus/driftbench-judges');
  if (options.judgeRoute !== 'escalation')
    return `--judge-route takes escalation, not "${options.judgeRoute}"`;
  if (options.routeFirst === undefined) return '--judge-route escalation needs --route-first <judge>';
  const thenRefs = options.routeThen ?? [];
  if (thenRefs.length === 0) return '--judge-route escalation needs at least one --route-then <judge>';
  const first = await resolve(options.routeFirst);
  if (typeof first === 'string') return first;
  const then: JudgeClient[] = [];
  for (const ref of thenRefs) {
    const made = await resolve(ref);
    if (typeof made === 'string') return made;
    then.push(made);
  }
  const on = (options.routeOn ?? TRIGGERS.join(','))
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const unknown = on.filter((entry) => !TRIGGERS.includes(entry as EscalationTrigger));
  if (unknown.length > 0 || on.length === 0)
    return `--route-on takes ${TRIGGERS.join(', ')}, not "${options.routeOn}"`;
  const confidence =
    options.routeConfidence === undefined ? undefined : optionNumber(options.routeConfidence);
  if (confidence !== undefined && !(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1))
    return `--route-confidence takes a number from 0 to 1, not "${options.routeConfidence}"`;
  const decide = options.routeDecide ?? 'majority';
  if (decide !== 'majority' && decide !== 'first-stands')
    return `--route-decide takes majority or first-stands, not "${options.routeDecide}"`;
  try {
    const client = J.createEscalation({
      first,
      then,
      agentFamily: options.agentFamily?.trim() || 'none',
      on: on as EscalationTrigger[],
      ...(confidence === undefined ? {} : { confidence }),
      decide,
    });
    return {
      client,
      used: [first, ...then],
      label: `escalation ${first.id} then ${then.map((judge) => judge.id).join(', ')}`,
    };
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/** The weighted panel of `--panel-weights` over these judges, each named in the weights. A message on bad input. */
export async function panelFrom(
  options: JudgeFlags,
  judges: readonly JudgeClient[],
  io: Io,
): Promise<{ client: JudgeClient; label: string } | string> {
  const weights = await readWeights(options.panelWeights ?? '', io);
  if (typeof weights === 'string') return `--panel-weights: ${weights}`;
  const margin = options.panelMargin === undefined ? undefined : optionNumber(options.panelMargin);
  if (margin !== undefined && !(Number.isFinite(margin) && margin >= 0 && margin <= 1))
    return `--panel-margin takes a share from 0 to 1, not "${options.panelMargin}"`;
  const unweighted = judges.filter((judge) => weights[judge.id] === undefined);
  if (unweighted.length > 0)
    return `--panel-weights gives no weight to ${unweighted.map((judge) => judge.id).join(', ')}`;
  const stray = Object.keys(weights).filter((id) => !judges.some((judge) => judge.id === id));
  if (stray.length > 0) return `--panel-weights names no judge ${stray.join(', ')}`;
  return {
    client: await panelClient(judges, weights, margin),
    label: `panel ${judges.map((judge) => judge.id).join(', ')}`,
  };
}

/** A council of every judge of the pool. Its own config checks the families and the seats. */
async function councilJudge(
  options: JudgeFlags,
  io: Io,
  pool: Pool,
  state: Built,
  agentFamily: string | undefined,
): Promise<RunJudge | undefined> {
  const J = await import('@agent-nexus/driftbench-judges');
  const fail = (message: string): undefined => {
    io.err(`error: ${message}\n`);
    return undefined;
  };
  if (options.referenceSolve !== undefined || options.referenceSamples !== undefined)
    return fail(
      '--reference-solve asks one judge: give it one --judge, a --judge-route or a --panel-weights panel',
    );
  const judges = pool.clients;
  const mode = (options.judgeMode ?? classMode(judges)) as CouncilMode;
  if (!MODES.includes(mode))
    return fail(`--judge-mode takes ${MODES.join(', ')}, not "${options.judgeMode}"`);
  let weights: Record<string, number> | undefined;
  if (options.weights !== undefined) {
    const read = await readWeights(options.weights, io);
    if (typeof read === 'string') return fail(`--weights: ${read}`);
    const stray = Object.keys(read).filter((id) => !judges.some((judge) => judge.id === id));
    if (stray.length > 0) return fail(`--weights names no judge ${stray.join(', ')}`);
    weights = read;
  }
  try {
    let earned: ReturnType<typeof J.councilAssignment> | undefined;
    if (options.assignments !== undefined) {
      earned = J.councilAssignment(await J.loadAssignmentTable(resolve(io.cwd, options.assignments)));
      if (earned.mode !== mode)
        return fail(`the assignment table is for mode ${earned.mode}, the council is in mode ${mode}`);
    }
    const count = (cls: 'system1' | 'system2') => judges.filter((judge) => judge.cls === cls).length;
    const seats = earned?.assignment.find((row) => row.judges.length > 1)?.judges.length;
    const size =
      seats ??
      (mode === 'llm'
        ? count('system2')
        : mode === 'system1'
          ? count('system1')
          : Math.min(count('system1'), count('system2')));
    const councilOf = (defs: Parameters<typeof J.criteriaJudge>[1]) =>
      J.createCouncil({
        mode,
        size: Math.max(1, size),
        // Each seat judges a criterion as the criterion asks (`repeat`, `per_turn`), as the single judge does.
        judges: defs.length === 0 ? judges : judges.map((judge) => J.criteriaJudge(judge, defs)),
        agentFamily: agentFamily ?? 'none',
        ...(weights ? { weights } : {}),
        ...(earned ? { assignment: earned.assignment, unassigned: earned.unassigned } : {}),
        ...(options.cascade ? { cascade: true } : {}),
      });
    // Built once here, so a bad council is refused before any run.
    const council = councilOf([]);
    const base = council.check();
    // The criteria live in each spec: the council of a spec is built from its criteria, once per spec.
    const bySpec = new WeakMap<object, Check>();
    const check: Check = {
      ...base,
      evaluate(ctx) {
        let own = bySpec.get(ctx.spec);
        if (!own) {
          own = councilOf(ctx.spec.criteria ?? []).check();
          bySpec.set(ctx.spec, own);
        }
        return own.evaluate(ctx);
      },
    };
    return {
      check,
      piiJudge: (text) => council.piiJudge(text),
      spend: state.spend,
      label: judges.map((judge) => judge.id).join(', '),
      judges: judges.map((judge) => judge.id),
      mode,
      billed: state.billed,
      save: async () => saveRecording(options, io, state),
    };
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
}

/** The council mode the classes of the judges make: system1 alone, llm alone, or hybrid for both. */
function classMode(judges: readonly JudgeClient[]): CouncilMode {
  const one = judges.some((judge) => judge.cls === 'system1');
  const two = judges.some((judge) => judge.cls === 'system2');
  return one && two ? 'hybrid' : one ? 'system1' : 'llm';
}

async function saveRecording(options: JudgeFlags, io: Io, state: Built): Promise<void> {
  if (options.record === undefined || !state.cassette) return;
  const { saveCassette } = await import('@agent-nexus/driftbench-judges');
  await saveCassette(resolve(io.cwd, options.record), state.cassette);
}

type JudgeSpec =
  | { kind: Exclude<(typeof JUDGE_KINDS)[number], 'http'>; model: string; spec: string }
  | { kind: 'http'; family: string; url: string; spec: string };

/** Reads `kind:model`, a provider `kind` alone (its model from the environment), or `http:<family>@<url>`. A message on bad input. */
export function parseJudgeSpec(spec: string): JudgeSpec | string {
  const text = spec.trim();
  const at = text.indexOf(':');
  const kind = at < 0 ? text : text.slice(0, at);
  const rest = at < 0 ? '' : text.slice(at + 1);
  // A provider kind alone reads its model from the environment, as `redteam grade --judge <kind>` does.
  if (
    rest === '' &&
    (JUDGE_KINDS as readonly string[]).includes(kind) &&
    kind !== 'claude' &&
    kind !== 'http'
  )
    return { kind: kind as Exclude<(typeof JUDGE_KINDS)[number], 'http'>, model: '', spec: text };
  if (!(JUDGE_KINDS as readonly string[]).includes(kind) || rest === '') {
    return `--judge takes <kind>:<model>, such as claude:<model> or openai:<model> (${KIND_HELP}), not "${spec}"`;
  }
  if (kind === 'http') {
    const sign = rest.indexOf('@');
    const family = sign < 0 ? '' : rest.slice(0, sign).trim();
    const url = sign < 0 ? '' : rest.slice(sign + 1).trim();
    if (!family || !/^https?:\/\//.test(url))
      return `--judge http takes http:<family>@<url>, such as http:openai@http://127.0.0.1:8080/judge, not "${spec}"`;
    return { kind: 'http', family, url, spec: text };
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(rest)) return `--judge ${kind} takes a model name, not "${rest}"`;
  return { kind: kind as Exclude<(typeof JUDGE_KINDS)[number], 'http'>, model: rest, spec: text };
}

/**
 * The client of one judge spec. The model the flag names is the model the client runs: its variable is set to
 * it, so a variable in the environment never changes the judge a flag names. A claude judge keeps the id it
 * always had; the others are `<kind>-<model>`.
 */
/** The options of a provider client: the flag's model pinned in its variable, or, with a bare kind, the environment's. */
function named(
  spec: { kind: string; model: string },
  variable: string,
  env: Record<string, string | undefined>,
): { id?: string; model?: string; env: Record<string, string | undefined> } {
  if (spec.model === '') return { env };
  return { id: `${spec.kind}-${spec.model}`, model: spec.model, env: { ...env, [variable]: spec.model } };
}

async function liveClient(
  spec: JudgeSpec,
  context: { env: Record<string, string | undefined>; claudePath: string; budget: number | undefined },
): Promise<JudgeClient> {
  const J = await import('@agent-nexus/driftbench-judges');
  const { env } = context;
  switch (spec.kind) {
    // The Claude judge of runs and calibration runs the product default policy (createDefaultJudge).
    case 'claude': {
      const script = /\.(c|m)?js$/.test(context.claudePath);
      return J.createDefaultJudge({
        provider: 'claude-cli',
        id: `claude-${spec.model}`,
        model: spec.model,
        env: { ...env, CLAUDE_JUDGE_MODEL: spec.model },
        ...(script
          ? { command: process.execPath, commandArgs: [context.claudePath] }
          : { command: context.claudePath }),
        // The whole budget caps this client across routing, solves and comparisons; each call reserves at most 0.1.
        ...(context.budget === undefined
          ? {}
          : { maxBudgetUsd: Math.min(0.1, context.budget), spendCapUsd: context.budget }),
      });
    }
    case 'openai':
      return J.createOpenAiJudge(named(spec, 'OPENAI_JUDGE_MODEL', env));
    case 'anthropic':
      return J.createAnthropicJudge(named(spec, 'ANTHROPIC_JUDGE_MODEL', env));
    case 'google':
      return J.createGoogleJudge(named(spec, 'GOOGLE_JUDGE_MODEL', env));
    case 'openai-decisions':
      return J.createOpenAiDecisionsJudge(named(spec, 'OPENAI_DECISIONS_MODEL', env));
    case 'jev':
      return J.createJevJudge(named(spec, 'JEV_MODEL', env));
    case 'http':
      return J.createHttpJudge({ id: `http-${spec.family}`, url: spec.url, family: spec.family, env });
  }
}

/**
 * The live client of one `--judge <kind>:<model>`, unwrapped: no budget, no recording. For a command that wraps
 * its judges itself (`judge calibrate`). Throws on a bad spec or a missing key.
 */
export async function makeLiveJudge(
  spec: string,
  context: { env?: Record<string, string | undefined>; claudeCommand?: string },
): Promise<JudgeClient> {
  const parsed = parseJudgeSpec(spec);
  if (typeof parsed === 'string') throw new Error(parsed);
  return liveClient(parsed, {
    env: context.env ?? process.env,
    claudePath: context.claudeCommand ?? 'claude',
    budget: undefined,
  });
}

/** A client that stops calling once the spend reaches the cap, and adds every reported cost to it. */
function capped(
  client: JudgeClient,
  spend: { usd: number },
  cap: number | undefined,
  JudgeError: typeof import('@agent-nexus/driftbench-judges').JudgeError,
): JudgeClient {
  const guard = () => {
    if (cap !== undefined && spend.usd >= cap) {
      throw new JudgeError('config', `the judge budget of ${cap} USD is spent: no more judge calls`);
    }
  };
  const count = (result: JudgeResult) => {
    spend.usd += result.costUsd ?? 0;
    return result;
  };
  const compare = client.judgeComparison?.bind(client);
  return {
    ...client,
    async judge(request) {
      guard();
      return count(await client.judge(request));
    },
    ...(compare
      ? {
          async judgeComparison(ordered: JudgeRequest, swapped: JudgeRequest) {
            guard();
            return count(await compare(ordered, swapped));
          },
        }
      : {}),
  };
}

/** The family a judge shares with the agent, as the council reads both, or undefined. */
function sharedFamily(
  client: JudgeClient,
  agentFamily: string,
  J: typeof import('@agent-nexus/driftbench-judges'),
): string | undefined {
  const canonical = (family: string) => J.familyOfModel(family) ?? J.normalizeFamily(family);
  const agent = canonical(agentFamily);
  const conflict = [client.family, ...(client.families ?? [])].find((family) =>
    J.sameFamily(canonical(family), agent),
  );
  return conflict === undefined ? undefined : canonical(conflict);
}

/** Why a judge is refused for the agent family: it shares it, as the council reads both. Undefined when not. */
export async function familyRefusal(client: JudgeClient, agentFamily: string): Promise<string | undefined> {
  const J = await import('@agent-nexus/driftbench-judges');
  const conflict = sharedFamily(client, agentFamily, J);
  return conflict === undefined
    ? undefined
    : `judge ${client.id} is from the ${conflict} family, the family of the agent under test: refused`;
}

/** `judge=weight,...`, or a YAML file of `judge: weight` (under `weights:` or at the top). A message on bad input. */
export async function readWeights(value: string, io: Io): Promise<Record<string, number> | string> {
  let entries: [string, unknown][];
  if (/^[^=,]+=/.test(value.trim())) {
    entries = value.split(',').map((pair) => {
      const sign = pair.indexOf('=');
      return [pair.slice(0, sign).trim(), optionNumber(pair.slice(sign + 1).trim())];
    });
  } else {
    let text: string;
    try {
      text = await readFile(resolve(io.cwd, value), 'utf8');
    } catch (cause) {
      return `cannot read ${value}: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    const { parse } = await import('yaml');
    let parsed: unknown;
    try {
      parsed = parse(text);
    } catch (cause) {
      return `${value} is not YAML: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    const map =
      parsed && typeof parsed === 'object' && 'weights' in parsed
        ? (parsed as { weights: unknown }).weights
        : parsed;
    if (!map || typeof map !== 'object' || Array.isArray(map))
      return `${value} is not a map of judge: weight`;
    entries = Object.entries(map as Record<string, unknown>);
  }
  const weights: Record<string, number> = {};
  for (const [id, weight] of entries) {
    if (id === '' || typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)
      return `each weight is judge=<number of at least 0>, not "${id}=${String(weight)}"`;
    weights[id] = weight;
  }
  if (Object.keys(weights).length === 0) return 'no weight given';
  return weights;
}

/**
 * A weighted panel: every judge answers, each vote counts at its judge's weight, and a thin margin abstains
 * (inconclusive, never a pass or a fail). A pairwise request reads winner A as a pass and B as a fail.
 */
async function panelClient(
  judges: readonly JudgeClient[],
  weights: Record<string, number>,
  margin: number | undefined,
): Promise<JudgeClient> {
  const { weightedPanel } = await import('@agent-nexus/driftbench-judges');
  const families = [...new Set(judges.flatMap((judge) => [judge.family, ...(judge.families ?? [])]))];
  const outcomeOf = (result: JudgeResult): 'pass' | 'fail' | 'inconclusive' => {
    if (result.unparsed) return 'inconclusive';
    if (result.winner === 'A') return 'pass';
    if (result.winner === 'B') return 'fail';
    if (result.winner !== undefined) return 'inconclusive';
    return result.answer.outcome;
  };
  const first = judges[0] as JudgeClient;
  return {
    id: `panel:${judges.map((judge) => judge.id).join('+')}`,
    family: first.family,
    families,
    cls: judges.some((judge) => judge.cls === 'system2') ? 'system2' : 'system1',
    cost: judges.reduce((sum, judge) => sum + judge.cost, 0),
    settings: JSON.stringify({
      panel: 1,
      judges: judges.map((judge) => judge.id),
      weights,
      margin: margin ?? null,
    }),
    async judge(request) {
      const votes: { judge: string; outcome: 'pass' | 'fail' | 'inconclusive' }[] = [];
      const lines: string[] = [];
      let cost = 0;
      let priced = false;
      for (const judge of judges) {
        try {
          const result = await judge.judge(request);
          if (result.costUsd !== undefined) {
            cost += result.costUsd;
            priced = true;
          }
          const outcome = outcomeOf(result);
          votes.push({ judge: judge.id, outcome });
          lines.push(`${judge.id} (weight ${weights[judge.id]}): ${outcome}`);
        } catch (cause) {
          votes.push({ judge: judge.id, outcome: 'inconclusive' });
          lines.push(`${judge.id}: no answer, ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
      const decided = weightedPanel(votes, weights, margin);
      const outcome = decided === 'split' ? 'inconclusive' : decided;
      const reasoning = `weighted panel ${decided}: ${lines.join('; ')}`;
      return {
        answer: { outcome, reasoning },
        raw: JSON.stringify({ outcome, reasoning }),
        ...(request.candidates
          ? {
              winner:
                outcome === 'pass'
                  ? ('A' as const)
                  : outcome === 'fail'
                    ? ('B' as const)
                    : ('inconclusive' as const),
            }
          : {}),
        ...(priced ? { costUsd: cost } : {}),
      };
    },
  };
}

const SOLVE_SYSTEM =
  'Solve the question below. Answer with the final answer only, on its last line, with no explanation.';

/** The judge wrapped by a blind reference solve; the solves share the run's budget and are made once per question. */
async function withReference(
  client: JudgeClient,
  options: JudgeFlags,
  io: Io,
  env: Record<string, string | undefined>,
  state: Built,
): Promise<JudgeClient | undefined> {
  const J = await import('@agent-nexus/driftbench-judges');
  const fail = (message: string): undefined => {
    io.err(`error: ${message}\n`);
    return undefined;
  };
  const spec = options.referenceSolve?.trim() ?? '';
  const at = spec.indexOf(':');
  const kind = at < 0 ? spec : spec.slice(0, at);
  const model = at < 0 ? '' : spec.slice(at + 1);
  if (!(SOLVE_KINDS as readonly string[]).includes(kind) || !/^[A-Za-z0-9._/-]+$/.test(model))
    return fail(`--reference-solve takes <kind>:<model> with kind ${SOLVE_KINDS.join(', ')}, not "${spec}"`);
  const samples = options.referenceSamples === undefined ? undefined : optionNumber(options.referenceSamples);
  if (samples !== undefined && !(Number.isInteger(samples) && samples >= 1 && samples <= 20))
    return fail(`--reference-samples takes a whole number from 1 to 20, not "${options.referenceSamples}"`);
  if (options.referenceRoute !== undefined && options.referenceRoute !== 'auto')
    return fail(`--reference-route takes auto, not "${options.referenceRoute}"`);
  let transport: ReturnType<typeof J.createDialectTransport>;
  const claudePath = options.judgeCommand === undefined ? 'claude' : resolve(io.cwd, options.judgeCommand);
  try {
    if (kind === 'claude') {
      const billed = !(await isStandIn(claudePath));
      if (billed && state.budget === undefined)
        return fail(
          'a reference solve on a command that is not a stand-in is billed: pass --judge-budget <usd>',
        );
      if (billed) state.billed = true;
      const script = /\.(c|m)?js$/.test(claudePath);
      transport = J.createDialectTransport({
        provider: 'claude-cli',
        model,
        env: { ...env, CLAUDE_JUDGE_MODEL: model },
        ...(script ? { command: process.execPath, commandArgs: [claudePath] } : { command: claudePath }),
        ...(state.budget === undefined ? {} : { maxBudgetUsd: state.budget }),
      });
    } else {
      state.billed = true;
      const variable = {
        openai: 'OPENAI_JUDGE_MODEL',
        anthropic: 'ANTHROPIC_JUDGE_MODEL',
        google: 'GOOGLE_JUDGE_MODEL',
      }[kind as 'openai' | 'anthropic' | 'google'];
      transport = J.createDialectTransport({
        provider: kind as 'openai' | 'anthropic' | 'google',
        model,
        env: { ...env, [variable]: model },
      });
    }
  } catch (cause) {
    return fail(`--reference-solve ${spec}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  // One solve per question and attempt, shared by every request of the run.
  const solved = new Map<string, Promise<{ answer?: string; costUsd?: number }>>();
  const solve = (question: string, attempt: number) => {
    const key = `${attempt}\u0000${question}`;
    let pending = solved.get(key);
    if (!pending) {
      pending = (async () => {
        if (state.budget !== undefined && state.spend.usd >= state.budget)
          throw new J.JudgeError(
            'config',
            `the judge budget of ${state.budget} USD is spent: no more solves`,
          );
        const completion = await transport.complete({ system: SOLVE_SYSTEM, user: question });
        state.spend.usd += completion.costUsd ?? 0;
        const lines = completion.text.trim().split('\n');
        return { answer: lines[lines.length - 1]?.trim() ?? '' };
      })();
      solved.set(key, pending);
    }
    return pending;
  };
  try {
    return J.withReferenceConsensus(client, {
      solve,
      ...(samples === undefined ? {} : { samples }),
      ...(options.referenceRoute === 'auto' ? { route: 'auto' as const } : {}),
    });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
}

// ---------------------------------------------------------------------------------------------------------
// The run-wide check flags: the owner allowlist of the pii check, a tool policy, and a plugin embedder.

export type RunCheckFlags = {
  /** The owner's own values (an email, a phone, an IBAN) the pii check leaves out. */
  owner?: string[];
  /** A file of owner values, one per line; blank lines and lines starting with # are skipped. */
  ownerFile?: string;
  toolPolicy?: string;
  embedder?: string;
};

export type RunCheckSettings = {
  piiOwner: string[];
  toolPolicy?: ToolRule[];
  embedder?: Embedder;
};

function collectAll(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Adds `--owner`, `--owner-file`, `--tool-policy` and `--embedder`; `owner: false` where a command has them. */
export function addRunCheckOptions(command: Command, groups: { owner?: boolean } = {}): Command {
  if (groups.owner !== false) {
    command
      .option(
        '--owner <values...>',
        "the owner's own email, phone, IBAN or national number: the pii check leaves exactly these out",
        collectAll,
        [],
      )
      .option(
        '--owner-file <file>',
        'owner values, one per line, for the pii check; # starts a comment line',
      );
  }
  return command
    .option(
      '--tool-policy <rules>',
      'a run-wide tool policy, a YAML list of { pattern, action: allow | deny | ask }: each run marks a call a rule denies (ask counts as denied) and the tool_policy check fails its block. It checks the calls the agent made; it does not stop the agent making them',
    )
    .option('--embedder <name>', 'the embedder the similarity check scores with, as a plugin registered it');
}

/** The owner values of `--owner` and `--owner-file`. Undefined when the file cannot be read (reported). */
export async function ownerValues(options: RunCheckFlags, io: Io): Promise<string[] | undefined> {
  const values = [...(options.owner ?? [])];
  if (options.ownerFile !== undefined) {
    const path = resolve(io.cwd, options.ownerFile);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (cause) {
      io.err(
        `Cannot read the owner file ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      return undefined;
    }
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim();
      if (value !== '' && !value.startsWith('#')) values.push(value);
    }
  }
  return values.map((value) => value.trim()).filter((value) => value !== '');
}

/** Reads a tool policy file: a list of { pattern, action }, or a map of pattern: action. A message on bad input. */
export async function readToolPolicy(path: string, io: Io): Promise<ToolRule[] | string> {
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, path), 'utf8');
  } catch (cause) {
    return `cannot read the tool policy ${path}: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  const { parse } = await import('yaml');
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (cause) {
    return `the tool policy ${path} is not YAML: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  const body =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'tool_policy' in parsed
      ? (parsed as { tool_policy: unknown }).tool_policy
      : parsed;
  const rows: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? Object.entries(body as Record<string, unknown>).map(([pattern, action]) => ({ pattern, action }))
      : [];
  const rules: ToolRule[] = [];
  for (const row of rows) {
    const rule = row as { pattern?: unknown; action?: unknown };
    if (
      !rule ||
      typeof rule.pattern !== 'string' ||
      rule.pattern.trim() === '' ||
      (rule.action !== 'allow' && rule.action !== 'deny' && rule.action !== 'ask')
    ) {
      return `the tool policy ${path} holds a rule that is not { pattern, action: allow | deny | ask }: ${JSON.stringify(row)}`;
    }
    rules.push({ pattern: rule.pattern, action: rule.action });
  }
  if (rules.length === 0) return `the tool policy ${path} holds no rule`;
  return rules;
}

/** The settings of the run-wide check flags. Undefined on bad input (reported). */
export async function runCheckSettingsFrom(
  options: RunCheckFlags,
  io: Io,
): Promise<RunCheckSettings | undefined> {
  const piiOwner = await ownerValues(options, io);
  if (!piiOwner) return undefined;
  const settings: RunCheckSettings = { piiOwner };
  if (options.toolPolicy !== undefined) {
    const rules = await readToolPolicy(options.toolPolicy, io);
    if (typeof rules === 'string') {
      io.err(`error: ${rules}\n`);
      return undefined;
    }
    settings.toolPolicy = rules;
  }
  if (options.embedder !== undefined) {
    const embedder = await pluginEmbedder(options.embedder);
    if (embedder === undefined) {
      io.err(
        `error: no plugin registered the embedder ${options.embedder}: load one with --plugin <module> whose plugin calls api.embedder("${options.embedder}", ...)\n`,
      );
      return undefined;
    }
    settings.embedder = embedder;
  }
  return settings;
}

/**
 * A check set with the run's judge and check settings in it: the similarity check scores with the embedder,
 * the pii check knows the owner and the judge's personal-data hook, the tool policy check sits before the stage
 * check, and the judge check comes last, replacing any judge check the set had. A set with none of them is
 * returned as it is.
 */
export async function withRunChecks(
  checks: CheckSet,
  settings: Partial<RunCheckSettings>,
  judge?: Pick<RunJudge, 'check' | 'piiJudge'>,
): Promise<CheckSet> {
  const owner = settings.piiOwner ?? [];
  const piiJudge = judge?.piiJudge;
  if (!judge && owner.length === 0 && !settings.toolPolicy?.length && !settings.embedder) return checks;
  const C = await import('@agent-nexus/driftbench-checks');
  const out: Check[] = [];
  for (const check of checks) {
    if (judge && check.name === 'judge') continue;
    if (check.name === 'similarity' && settings.embedder)
      out.push(C.createSimilarityCheck(settings.embedder));
    else if (check.name === 'pii' && (owner.length > 0 || piiJudge))
      out.push(C.createPiiCheck({ owner, judge: piiJudge }));
    else out.push(check);
  }
  if (settings.toolPolicy?.length) {
    // The checks package makes the policy check only inside its default set: take it from there.
    const policy = C.defaultChecks({ toolPolicy: settings.toolPolicy }).find(
      (check) => check.name === 'tool_policy',
    );
    const at = out.findIndex((check) => check.name === 'stage');
    if (policy && at < 0) out.push(policy);
    else if (policy) out.splice(at, 0, policy);
  }
  if (judge) out.push(judge.check);
  return out;
}

/** Every judge and run-check flag of a command's options, to pass on to another command. */
export function judgeAndCheckFlags(options: JudgeFlags & RunCheckFlags): JudgeFlags & RunCheckFlags {
  const keys: (keyof (JudgeFlags & RunCheckFlags))[] = [
    'judge',
    'judgeCommand',
    'judgeBudget',
    'judges',
    'judgeMode',
    'assignments',
    'cascade',
    'weights',
    'panelWeights',
    'panelMargin',
    'judgeRoute',
    'routeFirst',
    'routeThen',
    'routeOn',
    'routeConfidence',
    'routeDecide',
    'referenceSolve',
    'referenceSamples',
    'referenceRoute',
    'record',
    'agentFamily',
    'verify',
    'promptBudget',
    'owner',
    'ownerFile',
    'toolPolicy',
    'embedder',
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) if (options[key] !== undefined) out[key] = options[key];
  return out as JudgeFlags & RunCheckFlags;
}

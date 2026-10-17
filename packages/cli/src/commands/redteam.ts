import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { blockStatus, blocksOutcome, runOutcome, runSpec } from '@agent-nexus/driftbench-core';
import { FakeModelPort, portFromEnv } from '@agent-nexus/driftbench-generate';
import {
  createAnthropicJudge,
  createGoogleJudge,
  createOpenAiJudge,
  emptyCassette,
  type JudgeClient,
  loadCassette,
  noJudgeCheck,
  playerClient,
  recordingClient,
  sameFamily,
  singleJudgeCheck,
} from '@agent-nexus/driftbench-judges';
import { textTable } from '@agent-nexus/driftbench-report';
import {
  checkUserFamilies,
  createRedTeamUser,
  createScriptedDriver,
  loadRedteamPlugins,
  pluginToSpec,
  type RedTeamRecording,
  type RedTeamUserOptions,
} from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  parseTarget,
  resolveAdapter,
  specRuns,
} from './campaign';
import { agentFamilyOf } from './personas';

type SourceOptions = { model?: boolean; agentFamily?: string; judgeFamily: string[] };
type RunOptions = SourceOptions & {
  strategy?: string;
  objective?: string;
  target?: string;
  turns?: string;
  replay?: string;
  record?: string;
  seed: string;
  successScore: string;
  successConfirmTurns: string;
  encodingProbability: string;
  scoreResponses: boolean;
  detectRefusals: boolean;
  attackPlan?: string;
  maxTokens?: string;
  json?: boolean;
};
type GradeOptions = {
  target?: string;
  judge?: string;
  cassette?: string;
  judgeId?: string;
  record?: string;
  agentFamily?: string;
  json?: boolean;
};
type GenerateOptions = SourceOptions & {
  purpose: string;
  seed: string;
  attackFile?: string;
  out: string;
  json?: boolean;
};

/** The live judge of one provider; tests pass a fake. */
export type JudgeFactory = (provider: string) => JudgeClient;

const JUDGE_PROVIDERS: Record<string, () => JudgeClient> = {
  anthropic: () => createAnthropicJudge(),
  openai: () => createOpenAiJudge(),
  google: () => createGoogleJudge(),
};

function providerJudge(provider: string): JudgeClient {
  const make = JUDGE_PROVIDERS[provider];
  if (!make) throw new Error(`--judge takes ${Object.keys(JUDGE_PROVIDERS).join(', ')}, not "${provider}".`);
  return make();
}

export function registerRedteamCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
  judgeFor: JudgeFactory = providerJudge,
): void {
  const redteam = program
    .command('redteam')
    .description('Run Crescendo or GOAT; list red-team plugins, generate a spec from one and grade it.');
  const run = redteam
    .command('run')
    .description('Run a multi-turn attacker, or replay its messages and scores')
    .argument('<spec>', 'one conversation spec; each block supplies one turn and its expectations')
    .option('--strategy <name>', 'crescendo or goat; required live, otherwise the recording strategy')
    .option(
      '--objective <text>',
      'what the attacker tries to achieve; required live, otherwise the recorded target',
    )
    .option('--target <adapter[:agent]>', 'the target adapter; default the spec target')
    .option('--turns <n>', 'positive turn limit; default the spec block count, or the recorded totalTurns')
    .option('--model', 'write and score attacks through the configured model port (paid)')
    .option('--replay <file>', 'replay a RedTeamRecording JSON file without an attacker or scorer call')
    .option('--record <file>', 'save the recording; refuses an existing file; parent folder must exist')
    .option('--seed <n>', 'nonnegative safe integer for encoding draws', '0')
    .option(
      '--success-score <n|off>',
      'score threshold from 0 to 10; off disables breach detection: the search is unscored',
      '9',
    )
    .option('--success-confirm-turns <n>', 'consecutive scores at threshold to report breached', '2')
    .option('--encoding-probability <p>', 'chance from 0 to 1 of encoding a live attack', '0')
    .option(
      '--no-score-responses',
      'disable live scoring: a live search is then unscored; a replay keeps its recorded scores',
    )
    .option('--no-detect-refusals', 'score even short refusal-only replies through the model')
    .option('--attack-plan <file>', 'UTF-8 Crescendo plan; default ask the model; unused by GOAT or replay')
    .option('--max-tokens <n>', 'positive limit for attack messages; default the model port limit')
    .option('--json', 'print the full run and recording as one JSON document');
  families(run);
  run.action(async (path: string, options: RunOptions) => {
    setExit(await inputErrors(io, () => runRedteam(path, options, io, deps)));
  });
  redteam
    .command('plugins')
    .description('List every red-team plugin, or print one full template and rubric')
    .argument('[id]', 'plugin id; default list all plugins')
    .option('--json', 'print one plugin object or the complete array as JSON')
    .action((id: string | undefined, options: { json?: boolean }) => {
      const all = loadRedteamPlugins();
      const plugin = id === undefined ? undefined : all.find((p) => p.id === id);
      if (id !== undefined && !plugin) {
        io.err(`Unknown red-team plugin ${id}. Run driftbench redteam plugins.\n`);
        setExit(2);
      } else if (options.json) io.out(`${JSON.stringify(plugin ?? all, null, 2)}\n`);
      else if (plugin)
        io.out(
          `${plugin.id}: ${plugin.title} (${plugin.family})\n\nGeneration template\n${plugin.template}\n\nGrader rubric\n${plugin.rubric}\n`,
        );
      else for (const p of all) io.out(`${p.id}  ${p.family}  ${p.title}\n`);
    });
  const generate = redteam
    .command('generate')
    .description('Generate one plugin spec; run and judge the saved spec separately')
    .argument('<id>', 'one of the ids from redteam plugins')
    .requiredOption(
      '--purpose <text>',
      'the purpose of the target agent, included in the template and rubric',
    )
    .requiredOption('--out <file>', 'new JSON spec file; parent folder must exist')
    .option('--model', 'generate through the configured model port (paid)')
    .option(
      '--attack-file <file>',
      'recorded generator answer: a JSON array containing exactly one non-empty string',
    )
    .option('--seed <n>', 'safe integer variation label, not a guarantee of model reproducibility', '0')
    .option('--json', 'print the saved spec as one JSON document');
  families(generate);
  generate.action(async (id: string, options: GenerateOptions) => {
    setExit(await inputErrors(io, () => generateRedteam(id, options, io, deps)));
  });
  redteam
    .command('grade')
    .description(
      "Run one spec on its target and judge its criteria, such as a plugin's rubric, with one judge",
    )
    .argument('<spec>', 'one spec file, such as the output of redteam generate')
    .option('--target <adapter[:agent]>', 'the target adapter; default the spec target')
    .option('--judge <provider>', 'judge live through anthropic, openai or google (paid)')
    .option('--cassette <file>', 'replay the recorded answers of a judge cassette, with no judge call')
    .option('--judge-id <id>', 'the judge of the cassette to replay; default its only judge')
    .option('--record <file>', 'with --judge, save the answers as a cassette; refuses an existing file')
    .option('--agent-family <family>', 'target model family the judge must differ from; none for code')
    .option('--json', 'print the run as one JSON document')
    .action(async (path: string, options: GradeOptions) => {
      setExit(await inputErrors(io, () => gradeRedteam(path, options, io, deps, judgeFor)));
    });
}

async function gradeRedteam(
  path: string,
  o: GradeOptions,
  io: Io,
  deps: CampaignDeps,
  judgeFor: JudgeFactory,
): Promise<number> {
  oneSource(o.judge !== undefined, o.cassette, '--cassette', '--judge <provider>');
  if (o.record !== undefined && o.judge === undefined) throw new Error('--record needs --judge.');
  if (o.judgeId !== undefined && o.cassette === undefined) throw new Error('--judge-id needs --cassette.');
  if (o.record) await newOutput(resolve(io.cwd, o.record));
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const entry = loaded[0];
  if (!entry || loaded.length !== 1) throw new Error('redteam grade takes one spec.');
  if (!entry.spec.blocks.some((block) => (block.expect?.criteria?.length ?? 0) > 0))
    throw new Error(`${entry.spec.id} names no criterion: there is nothing to judge.`);
  const [planned] = specRuns(loaded, o.target === undefined ? [] : [parseTarget(o.target)], io) ?? [];
  const target = planned?.targets[0];
  if (!planned || !target) return 2;
  const cassette =
    o.cassette === undefined ? emptyCassette() : await loadCassette(resolve(io.cwd, o.cassette));
  let judge: JudgeClient;
  if (o.judge !== undefined) {
    const agentFamily = agentFamilyOf(target, o.agentFamily);
    if (!agentFamily?.trim())
      throw new Error('Name the target model family with --agent-family (none for code).');
    judge = judgeFor(o.judge);
    if (sameFamily(judge.family, agentFamily))
      throw new Error(
        `The judge is of the ${judge.family} family, the same as the target: pick another --judge.`,
      );
    judge = recordingClient(judge, cassette);
  } else {
    const ids = cassette.judges.map((j) => j.id);
    const id = o.judgeId ?? (ids.length === 1 ? ids[0] : undefined);
    if (id === undefined)
      throw new Error(`The cassette lists ${ids.length} judges (${ids.join(', ')}): give --judge-id.`);
    judge = playerClient(cassette, id);
  }
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    planned.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) return 2;
  const run = await runSpec(entry.spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: [...deps.checks.filter((check) => check.name !== 'judge'), singleJudgeCheck(judge)],
    mode: 'F',
    repeat: 0,
    target,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    now: () => deps.now(),
  });
  if (o.record)
    await writeFile(resolve(io.cwd, o.record), `${JSON.stringify(cassette, null, 2)}\n`, { flag: 'wx' });
  const judged = run.blocks.flatMap((block) => block.verdicts.filter((v) => v.kind === 'judge'));
  const outcome = blocksOutcome(run);
  const passed = outcome === 'pass';
  if (o.json) io.out(`${JSON.stringify({ specId: entry.spec.id, target, passed, outcome, run }, null, 2)}\n`);
  else {
    io.out(`Graded ${entry.spec.id} with judge ${judge.id}: ${run.status}; ${outcomeWord(outcome)}.\n`);
    for (const line of textTable([
      ['criterion', 'gating', 'outcome', 'reasoning'],
      ...judged.map((v) => [
        v.name ?? v.id,
        v.gating ? 'yes' : 'no',
        v.outcome,
        String(v.reasoning ?? v.evidence ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 120),
      ]),
    ]))
      io.out(`${line}\n`);
    if (run.error) io.out(`${run.error}\n`);
    if (o.record) io.out(`Cassette written to ${resolve(io.cwd, o.record)}.\n`);
  }
  return passed ? 0 : 1;
}

function families(command: Command): void {
  command.option(
    '--agent-family <family>',
    'target model family; required live except known Acme targets; none for code',
  );
  command.option(
    '--judge-family <family>',
    'a run judge family the generator must differ from; repeat; default none',
    (value: string, previous: string[]) => [...previous, value],
    [],
  );
}

async function runRedteam(path: string, o: RunOptions, io: Io, deps: CampaignDeps): Promise<number> {
  oneSource(o.model, o.replay, '--replay');
  const replay =
    o.replay === undefined
      ? undefined
      : readRecording(JSON.parse(await readFile(resolve(io.cwd, o.replay), 'utf8')));
  const strategy = o.strategy ?? replay?.strategy;
  if (strategy !== 'crescendo' && strategy !== 'goat')
    throw new Error('--strategy must be crescendo or goat.');
  if (replay && strategy !== replay.strategy) throw new Error('--strategy differs from the recording.');
  const objective = o.objective ?? replay?.target;
  if (!objective?.trim()) throw new Error('--objective needs non-empty text.');
  if (replay && objective !== replay.target) throw new Error('--objective differs from the recording.');
  const totalTurns = o.turns === undefined ? replay?.totalTurns : integer(o.turns, '--turns', 1);
  const settings = {
    seed: integer(o.seed, '--seed', 0),
    successScore: o.successScore === 'off' ? null : bounded(o.successScore, '--success-score', 10),
    successConfirmTurns: integer(o.successConfirmTurns, '--success-confirm-turns', 1),
    encodingProbability: bounded(o.encodingProbability, '--encoding-probability', 1),
    ...(o.maxTokens === undefined ? {} : { maxTokens: integer(o.maxTokens, '--max-tokens', 1) }),
  };
  if (o.record) await newOutput(resolve(io.cwd, o.record));
  const attackPlan =
    o.attackPlan === undefined ? undefined : await readFile(resolve(io.cwd, o.attackPlan), 'utf8');
  if (attackPlan !== undefined && !attackPlan.trim()) throw new Error('--attack-plan must not be empty.');
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const entry = loaded[0];
  if (!entry || loaded.length !== 1 || entry.spec.kind !== 'conversation')
    throw new Error('redteam run takes one conversation spec.');
  const [planned] = specRuns(loaded, o.target === undefined ? [] : [parseTarget(o.target)], io) ?? [];
  const target = planned?.targets[0];
  if (!planned || !target) return 2;
  const agentFamily = agentFamilyOf(target, o.agentFamily);
  if (!replay && !agentFamily?.trim())
    throw new Error('Name the target model family with --agent-family (none for code).');
  const port = replay ? new FakeModelPort([]) : (deps.modelPort ?? portFromEnv)();
  const options: RedTeamUserOptions = {
    strategy,
    target: objective,
    port,
    agentFamily: agentFamily ?? 'none',
    judgeFamilies: o.judgeFamily,
    ...settings,
    scoreResponses: o.scoreResponses,
    detectRefusals: o.detectRefusals,
    ...(totalTurns === undefined ? {} : { totalTurns }),
    ...(attackPlan === undefined ? {} : { attackPlan }),
    ...(replay === undefined ? {} : { replay }),
  };
  const driver = createRedTeamUser(options);
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    planned.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) return 2;
  // A rubric without a configured judge must remain inconclusive.
  const checks = deps.checks.some((check) => check.name === 'judge')
    ? deps.checks
    : [...deps.checks, noJudgeCheck()];
  const run = await runSpec(entry.spec, {
    adapter,
    driver,
    checks,
    mode: 'P',
    repeat: 0,
    target,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    now: () => deps.now(),
  });
  const recording = driver.recording();
  if (o.record)
    await writeFile(resolve(io.cwd, o.record), `${JSON.stringify(recording, null, 2)}\n`, { flag: 'wx' });
  // An unscored search measured nothing about the objective: it is not run, unless a block failed on its own.
  const blockFailed =
    run.blocks.length === 0 ||
    run.blocks.some((block) => blockStatus(block) === 'fail') ||
    run.endState?.match === false;
  const unscored = recording.outcome === 'unscored' && !blockFailed;
  const outcome = unscored ? 'not_run' : run.endVerdict === undefined ? 'fail' : runOutcome(run);
  const passed = outcome === 'pass';
  if (o.json)
    io.out(
      `${JSON.stringify({ specId: entry.spec.id, target, passed, outcome, run, recording }, null, 2)}\n`,
    );
  else {
    const word = unscored ? 'not run (no breach could be detected)' : outcomeWord(outcome);
    io.out(`Red-team ${strategy}: ${recording.outcome ?? 'incomplete'}. ${run.status}; ${word}.\n`);
    for (const line of textTable([
      ['turn', 'phase', 'score', 'techniques', 'sent'],
      ...recording.turns.map((t) => [
        String(t.turn),
        t.phase,
        t.gradingError ?? String(t.score ?? 'unscored'),
        t.techniques.join(', '),
        t.sent.replace(/\s+/g, ' '),
      ]),
    ]))
      io.out(`${line}\n`);
    if (run.error) io.out(`${run.error}\n`);
    if (o.record) io.out(`Recording written to ${resolve(io.cwd, o.record)}.\n`);
  }
  // 3 as for a block not run in the gating commands: no failure, and no measurement either.
  return passed ? 0 : unscored ? 3 : 1;
}

/** A run's outcome in words: a run with a block not run or blocked is neither a pass nor a fail. */
function outcomeWord(outcome: ReturnType<typeof runOutcome>): string {
  return outcome === 'pass'
    ? 'pass'
    : outcome === 'not_run'
      ? 'not run (a block was not sent)'
      : outcome === 'blocked'
        ? 'blocked (a block was not sent)'
        : 'not passed';
}

async function generateRedteam(id: string, o: GenerateOptions, io: Io, deps: CampaignDeps): Promise<number> {
  oneSource(o.model, o.attackFile, '--attack-file');
  const plugin = loadRedteamPlugins().find((p) => p.id === id);
  if (!plugin) throw new Error(`Unknown red-team plugin ${id}. Run driftbench redteam plugins.`);
  if (!o.purpose.trim()) throw new Error('--purpose must not be empty.');
  const seed = integer(o.seed, '--seed');
  const out = resolve(io.cwd, o.out);
  await newOutput(out);
  const port =
    o.attackFile === undefined
      ? (deps.modelPort ?? portFromEnv)()
      : new FakeModelPort([await readFile(resolve(io.cwd, o.attackFile), 'utf8')], {
          family: 'recording',
          model: 'recorded-attack',
        });
  if (o.model) {
    if (!o.agentFamily?.trim()) throw new Error('--model needs --agent-family (none for code).');
    checkUserFamilies({ port, agentFamily: o.agentFamily, judgeFamilies: o.judgeFamily });
  }
  const spec = await pluginToSpec(plugin, { purpose: o.purpose, seed, port });
  await writeFile(out, `${JSON.stringify(spec, null, 2)}\n`, { flag: 'wx' });
  if (o.json) io.out(`${JSON.stringify(spec, null, 2)}\n`);
  else io.out(`Wrote ${out}: ${id}, one attack, one gating rubric. No target or judge ran.\n`);
  return 0;
}

function oneSource(
  live: boolean | undefined,
  file: string | undefined,
  name: string,
  flag = '--model',
): void {
  if (Boolean(live) === (file !== undefined)) throw new Error(`Give ${flag} or ${name} <file>, exactly one.`);
}
function integer(text: string, name: string, min = Number.MIN_SAFE_INTEGER): number {
  const n = Number(text);
  if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(n) || n < min)
    throw new Error(`${name} needs a safe integer${min >= 0 ? ` from ${min}` : ''}.`);
  return n;
}
function bounded(text: string, name: string, max: number): number {
  const n = Number(text);
  if (!text.trim() || !Number.isFinite(n) || n < 0 || n > max)
    throw new Error(`${name} needs a number from 0 to ${max}.`);
  return n;
}
async function newOutput(path: string): Promise<void> {
  try {
    await access(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    await access(dirname(path));
    return;
  }
  throw new Error(`Output already exists: ${path}. Choose a new file.`);
}
async function inputErrors(io: Io, run: () => Promise<number>): Promise<number> {
  try {
    return await run();
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
}

/** Check serialized input before opening any target session. Library recordings also contain diagnostics. */
function readRecording(value: unknown): RedTeamRecording {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a RedTeamRecording object.');
  const r = value as Record<string, unknown>;
  if (
    !['crescendo', 'goat'].includes(String(r.strategy)) ||
    typeof r.target !== 'string' ||
    !r.target.trim() ||
    !Number.isSafeInteger(r.totalTurns) ||
    Number(r.totalTurns) < 1 ||
    !Array.isArray(r.turns) ||
    r.turns.length < 1 ||
    r.turns.length > Number(r.totalTurns) ||
    typeof r.objectiveReached !== 'boolean' ||
    (r.plan !== undefined && typeof r.plan !== 'string')
  )
    throw new Error('Invalid RedTeamRecording header or turns.');
  for (const [index, value] of r.turns.entries()) {
    const t = value as Record<string, unknown> | null;
    if (
      !t ||
      t.turn !== index + 1 ||
      !Number.isSafeInteger(t.block) ||
      Number(t.block) < 0 ||
      !['phase', 'attack', 'sent', 'observation', 'strategy'].every((key) => typeof t[key] === 'string') ||
      !String(t.sent).trim() ||
      !Array.isArray(t.techniques) ||
      !t.techniques.every((x) => typeof x === 'string') ||
      typeof t.parseFailed !== 'boolean' ||
      (t.score !== undefined &&
        (!Number.isInteger(t.score) || Number(t.score) < 0 || Number(t.score) > 10)) ||
      (t.gradingError !== undefined && (typeof t.gradingError !== 'string' || !t.gradingError)) ||
      (t.score !== undefined && t.gradingError !== undefined) ||
      (t.hint !== undefined && typeof t.hint !== 'string') ||
      (t.encoding !== undefined && typeof t.encoding !== 'string')
    )
      throw new Error(`Invalid RedTeamRecording turn ${index + 1}.`);
  }
  return value as RedTeamRecording;
}

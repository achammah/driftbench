import { resolve } from 'node:path';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  agentVersionOf,
  bindObjectContext,
  blockStatus,
  blocksOutcome,
  type Campaign,
  type CliOverrides,
  checkSpecObjects,
  completeBaselineProvenance,
  isScored,
  loadChangeManifest,
  loadSpecs,
  objectContextFor,
  objectContextOfSpec,
  type PreparedRejudge,
  parseCliOverrides,
  planCampaign,
  prepareRejudge,
  prepareRescore,
  type RunResult,
  refuseAgentFacing,
  rejudgeRun,
  rescoreRun,
  resolveBlockObjects,
} from '@agent-nexus/driftbench-core';
import { loadCampaign } from '@agent-nexus/driftbench-report';
import { openStore } from '@agent-nexus/driftbench-store';
import type { Command } from 'commander';
import type { Io } from '../io';
import { addJudgeOptions, judgeAsked, type RunJudgeOptions, runJudgeFrom } from '../judge-options';
import { gateExit } from './gate-exit';

type Options = RunJudgeOptions & {
  from: string;
  campaign: string;
  store: string;
  change?: string;
  use?: string[];
  set?: string[];
  maxCarry?: string;
  maxAge?: string;
  json?: boolean;
  recordRealizedText?: boolean;
};
export function registerCampaignRejudge(campaign: Command, io: Io, setExit: (code: number) => void): void {
  addJudgeOptions(
    campaign
      .command('rejudge')
      .description('Judge selected criteria on compatible stored observations, without calling the agent.')
      .argument('<paths...>', 'the new spec files or folders')
      .requiredOption('--from <campaign>', 'the stamped baseline campaign')
      .requiredOption('--campaign <id>', 'a new campaign id')
      .requiredOption('--store <file>', 'the baseline and output store')
      .option('--change <manifest>', 'criterion-only manifest, with the same from and to agent version')
      .option(
        '--use <kind/id>',
        're-score under this object instead, such as check-set/acme; repeat it for several kinds',
        collect,
      )
      .option(
        '--set <kind[/id]#item.param=value>',
        'set one item parameter for the re-score, such as policy/blame#R3.recovery_ok=[asked_user]; repeat it',
        collect,
      )
      .option('--max-carry <n>', 'maximum consecutive carries', '5')
      .option('--max-age <days>', 'maximum age of the observations', '7')
      .option('--record-realized-text', 'keep available driver text in this new campaign')
      .option('--json', 'print the re-judge summary as JSON'),
  ).action(async (paths: string[], options: Options) => {
    setExit(await campaignRejudge(paths, options, io));
  });
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export async function campaignRejudge(paths: string[], options: Options, io: Io): Promise<number> {
  const rescoring = (options.use?.length ?? 0) > 0 || (options.set?.length ?? 0) > 0;
  if (rescoring && options.change !== undefined) {
    io.err('Re-score with --use or --set, or re-judge criteria with --change: one at a time.\n');
    return 2;
  }
  if (!rescoring && options.change === undefined) {
    io.err(
      'Re-judge needs --change <manifest> (criteria), or --use / --set (a scoring-only object change).\n',
    );
    return 2;
  }
  if (rescoring) return campaignRescore(paths, options, io);
  let store: ReturnType<typeof openStore> | undefined;
  try {
    const manifest = await loadChangeManifest(resolve(io.cwd, options.change as string));
    if (!manifest.ok) throw new Error(manifest.errors.join('\n'));
    const change = manifest.manifest;
    if (
      change.from !== change.to ||
      !change.changes.length ||
      change.changes.some((c) => c.kind !== 'criterion' || !c.id)
    )
      throw new Error(
        'Re-judge needs a criterion-only manifest with identical from/to agent versions; otherwise rerun the agent.',
      );
    const maxCarry = Number(options.maxCarry ?? 5);
    const maxAgeDays = Number(options.maxAge ?? 7);
    if (!Number.isInteger(maxCarry) || maxCarry < 0 || !Number.isFinite(maxAgeDays) || maxAgeDays < 0)
      throw new Error('Carry limits must be nonnegative; --max-carry must be a whole number.');
    store = openStore(resolve(io.cwd, options.store));
    if (await store.getCampaign(options.campaign))
      throw new Error(`Campaign ${options.campaign} already exists.`);
    const data = await loadCampaign(store, options.from);
    if (!completeBaselineProvenance({ provenance: data.campaign.provenance, runs: data.runs }))
      throw new Error(
        'Legacy campaign has missing, incomplete or inconsistent execution provenance; run a new full campaign before re-judging.',
      );
    const results = await loadSpecs(paths.map((p) => resolve(io.cwd, p)));
    const loaded = results.filter((r) => r.ok);
    if (!loaded.length || loaded.length !== results.length)
      throw new Error('The new specs are invalid or empty.');
    if (
      new Set(loaded.map((l) => l.spec.id)).size !== loaded.length ||
      loaded.length !== data.campaign.specs.length
    )
      throw new Error('Re-judge requires exactly the baseline specs, with unique ids.');
    const specs = new Map(loaded.map((l) => [l.spec.id, l]));
    if (change.changes.some((c) => !loaded.some((l) => l.spec.criteria?.some((def) => def.name === c.id))))
      throw new Error('A selected criterion is not defined in the new specs.');
    const now = new Date();
    const prepared = data.runs.map((run) => {
      const old = data.specs.get(`${run.specId}@${run.specHash}`);
      const next = specs.get(run.specId);
      if (!old || !next) throw new Error(`Missing pinned spec ${run.specId}; rerun the agent.`);
      return prepareRejudge(old.spec, next.spec, run, {
        fromCampaign: options.from,
        baselineProvenance: data.campaign.provenance,
        agentVersion: change.from,
        criteria: change.changes.flatMap((c) => (c.id ? [c.id] : [])),
        maxCarry,
        maxAgeDays,
        now,
      });
    });
    for (const pinned of data.campaign.specs) {
      const old = data.specs.get(`${pinned.id}@${pinned.hash}`);
      if (!old) throw new Error(`Missing old spec ${pinned.id}`);
      const expected = planCampaign(
        [old],
        pinned.target ? [pinned.target] : data.campaign.targets,
        data.campaign.modes,
        data.campaign.repeats,
      ).cells;
      if (expected.some((cell) => !data.runs.some((run) => run.runId === cell.cellId)))
        throw new Error('Baseline campaign is incomplete; rerun the agent.');
    }
    if (!prepared.length) throw new Error('Baseline campaign contains no observations; rerun the agent.');
    if (!judgeAsked(options))
      throw new Error('Re-judge requires a judge: --judge <kind>:<model> or --judges <cassette>.');
    const judge = await runJudgeFrom(options, io);
    if (!judge) return 2;
    const campaign: Campaign = {
      ...data.campaign,
      campaignId: options.campaign,
      createdAt: now.toISOString(),
      judge: { mode: judge.mode, judges: judge.judges },
      specs: data.campaign.specs.map((p) => ({ ...p, hash: specs.get(p.id)?.hash ?? p.hash })),
      rejudged: prepared.map((p) => p.stamp),
    };
    if (campaign.provenance) {
      const { realizedText: _sourceOptIn, ...provenance } = campaign.provenance;
      campaign.provenance = {
        ...provenance,
        ...(options.recordRealizedText === true ? { realizedText: true } : {}),
      };
    }
    delete campaign.radius;
    if (campaign.sources) campaign.sources = campaign.sources.filter((source) => source.kind === 'prompt');
    // Preflight above completes before any call or write. Store the new campaign so a failed judge
    // remains an explicit inconclusive result, never a silent carry of the previous judge verdict.
    for (const loadedSpec of loaded) await store.putSpec(loadedSpec);
    await store.putCampaign(campaign);
    const runs: RunResult[] = [];
    for (const item of prepared) {
      const next = specs.get(item.source.specId);
      const run = await rejudgeRun(
        item,
        judge.check,
        () => judge.spend.usd,
        options.recordRealizedText === true,
        next === undefined ? undefined : (objectContextOfSpec(next.spec) ?? objectContextFor(next.path)),
      );
      await store.putRun(campaign.campaignId, run);
      runs.push(run);
    }
    await judge.save();
    // A block not run or blocked is left as it was: no measurement to re-judge, named with its reason.
    const unmeasured = runs.flatMap((r) =>
      r.blocks.flatMap((b) => {
        const status = blockStatus(b);
        if (status !== 'not_run' && status !== 'blocked') return [];
        const reason = b.notRun
          ? `${b.notRun.check}: ${b.notRun.got}`
          : `blocked by ${b.blocked?.by ?? 'an ancestor'}`;
        return [{ spec: r.specId, mode: r.mode, repeat: r.repeat, block: b.index, status, reason }];
      }),
    );
    const outcomes = runs.map(blocksOutcome);
    const summary = {
      campaign: campaign.campaignId,
      from: options.from,
      agentCalls: 0,
      rejudged: runs.flatMap((r) => r.blocks).filter((b) => b.rejudged).length,
      carried: runs.flatMap((r) => r.blocks).filter((b) => !b.rejudged && isScored(b)).length,
      ...(unmeasured.length > 0 ? { unmeasured } : {}),
      runs: {
        pass: outcomes.filter((outcome) => outcome === 'pass').length,
        fail: outcomes.filter((outcome) => outcome === 'fail').length,
        notRun: outcomes.filter((outcome) => outcome === 'not_run').length,
        blocked: outcomes.filter((outcome) => outcome === 'blocked').length,
      },
      judgeCostUsd: judge.spend.usd,
    };
    if (options.json) io.out(`${JSON.stringify(summary, null, 2)}\n`);
    else {
      io.out(
        `Campaign ${summary.campaign}: ${summary.rejudged} blocks re-judged, ${summary.carried} carried${unmeasured.length > 0 ? `, ${unmeasured.length} not run or blocked (left as they were)` : ''}; 0 agent calls. Judge cost ${summary.judgeCostUsd.toFixed(4)} USD.\n`,
      );
      io.out(
        `Runs: ${summary.runs.pass} pass, ${summary.runs.fail} fail${summary.runs.notRun > 0 ? `, ${summary.runs.notRun} not run` : ''}${summary.runs.blocked > 0 ? `, ${summary.runs.blocked} blocked` : ''}.\n`,
      );
      for (const entry of unmeasured)
        io.out(
          `  ${entry.spec} ${entry.mode} repeat ${entry.repeat} block ${entry.block} ${entry.status === 'blocked' ? 'blocked' : 'not run'}: ${entry.reason}\n`,
        );
    }
    // 1 when a run fails; 3 when none fails but a run was not run or blocked (no pass, no failure).
    return gateExit(outcomes);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  } finally {
    await store?.close();
  }
}

/**
 * `campaign rejudge --use` / `--set`: re-scores every stored run of the baseline under the changed objects, with
 * no agent call and no judge call. Only scoring-only objects may change: an agent-facing kind on the command line,
 * or a spec whose agent-facing content changed, is refused and routed to a rerun.
 */
async function campaignRescore(paths: string[], options: Options, io: Io): Promise<number> {
  let store: ReturnType<typeof openStore> | undefined;
  try {
    const cli: CliOverrides = parseCliOverrides(options.use ?? [], options.set ?? []);
    refuseAgentFacing(cli);
    const maxCarry = Number(options.maxCarry ?? 5);
    const maxAgeDays = Number(options.maxAge ?? 7);
    if (!Number.isInteger(maxCarry) || maxCarry < 0 || !Number.isFinite(maxAgeDays) || maxAgeDays < 0)
      throw new Error('Carry limits must be nonnegative; --max-carry must be a whole number.');
    store = openStore(resolve(io.cwd, options.store));
    if (await store.getCampaign(options.campaign))
      throw new Error(`Campaign ${options.campaign} already exists.`);
    const data = await loadCampaign(store, options.from);
    if (!completeBaselineProvenance({ provenance: data.campaign.provenance, runs: data.runs }))
      throw new Error(
        'Legacy campaign has missing, incomplete or inconsistent execution provenance; run a new full campaign before re-scoring.',
      );
    const results = await loadSpecs(paths.map((p) => resolve(io.cwd, p)));
    const loaded = results.filter((r) => r.ok);
    if (!loaded.length || loaded.length !== results.length)
      throw new Error('The new specs are invalid or empty.');
    if (
      new Set(loaded.map((l) => l.spec.id)).size !== loaded.length ||
      loaded.length !== data.campaign.specs.length
    )
      throw new Error('Re-score requires exactly the baseline specs, with unique ids.');
    const specs = new Map(loaded.map((l) => [l.spec.id, l]));
    // Resolve every reference and CLI item before writing specs or a new campaign record.
    const objects = new Map(
      loaded.map((entry) => {
        const context = { ...(objectContextOfSpec(entry.spec) ?? objectContextFor(entry.path)), cli };
        const issues = checkSpecObjects(entry.spec, context);
        if (issues.length)
          throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('; '));
        for (let index = -1; index < entry.spec.blocks.length; index++)
          resolveBlockObjects(entry.spec, index, context);
        bindObjectContext(entry.spec, context);
        return [entry.spec.id, context] as const;
      }),
    );
    const now = new Date();
    const prepared: PreparedRejudge[] = data.runs.map((run) => {
      const old = data.specs.get(`${run.specId}@${run.specHash}`);
      const next = specs.get(run.specId);
      if (!old || !next) throw new Error(`Missing pinned spec ${run.specId}; rerun the agent.`);
      return prepareRescore(old.spec, next.spec, run, {
        fromCampaign: options.from,
        baselineProvenance: data.campaign.provenance,
        // No candidate agent: the run's own version, which must be known and match its carry, as for a re-judge.
        agentVersion: agentVersionOf(run) ?? '',
        maxCarry,
        maxAgeDays,
        now,
      });
    });
    if (!prepared.length) throw new Error('Baseline campaign contains no observations; rerun the agent.');
    const campaign: Campaign = {
      ...data.campaign,
      campaignId: options.campaign,
      createdAt: now.toISOString(),
      specs: data.campaign.specs.map((p) => ({ ...p, hash: specs.get(p.id)?.hash ?? p.hash })),
      rejudged: prepared.map((p) => p.stamp),
    };
    delete campaign.radius;
    if (campaign.sources) campaign.sources = campaign.sources.filter((source) => source.kind === 'prompt');
    for (const loadedSpec of loaded) await store.putSpec(loadedSpec);
    await store.putCampaign(campaign);
    const runs: RunResult[] = [];
    for (const item of prepared) {
      const context = objects.get(item.source.specId);
      if (!context) throw new Error(`Missing resolved objects for ${item.source.specId}`);
      const run = await rescoreRun(item, defaultChecks(), context, options.recordRealizedText === true);
      await store.putRun(campaign.campaignId, run);
      runs.push(run);
    }
    const summary = {
      campaign: campaign.campaignId,
      from: options.from,
      agentCalls: 0,
      rescored: runs.flatMap((r) => r.blocks).length,
      use: options.use ?? [],
      set: options.set ?? [],
    };
    io.out(
      options.json
        ? `${JSON.stringify(summary, null, 2)}\n`
        : `Re-scored; observations from ${summary.from}.\nCampaign ${summary.campaign}: ${summary.rescored} blocks re-scored under ${[...summary.use, ...summary.set].join(', ')}; 0 agent calls, 0 judge calls.\n`,
    );
    // 1 when a run fails or its end state does not match; 3 when none fails but a block was not run or blocked.
    if (runs.some((r) => r.endState?.match === false)) return 1;
    return gateExit(runs.map(blocksOutcome));
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  } finally {
    await store?.close();
  }
}

import type { AdapterCapabilities, AgentAdapter, Session, Turn } from '../contracts/adapter';
import type { ArtifactReaderRegistry } from '../contracts/artifacts';
import { type CheckContext, type CheckSet, machineVerdict } from '../contracts/check';
import type { DriverStep, UserDriver } from '../contracts/driver';
import { copyHistory, freezeHistory, freezeMessage } from '../contracts/history';
import type { Store } from '../contracts/store';
import { gateToolCalls, type ToolRule } from '../contracts/tool-policy';
import { type BlockReuse, planBlockRerun } from '../radius/blocks';
import { collectRetries, type RetryPolicy, retryPolicy } from '../retry';
import type { Message, TargetRef, WorldState } from '../schema/common';
import {
  type BlockResult,
  type NotRun,
  Observed,
  type ResolvedGiven,
  type RetryEvent,
  type RunEvent,
  type RunMode,
  RunResult,
  Verdict,
} from '../schema/run';
import type { BlockSpec, EndState, Expect, GivenOverride, Spec, Stimulus } from '../schema/spec';
import { cloneJson, contentHash } from '../spec/hash';
import { specHash as specHashOf, specIdentity } from '../spec/identity';
import { parentOrder } from '../spec/parents';
import { type GivenFinding, verifyGiven } from '../spec/verify-given';
import { compareEndState, type EndStateMatch } from './assertion';
import { blockCacheKey, endStateCacheKey, type ObservedCache, unwrapEndState, wrapEndState } from './cache';
import { capabilityGap } from './capability';
import { recheckCarriedEndState } from './carried-end-state';
import { cellId } from './cell';
import { driftOf } from './drift';
import { composeStates, type EndStateSnapshot, endStateSnapshot, snapshotValues } from './end-state-snapshot';
import {
  addFacts,
  assistantMessage,
  canonicalGiven,
  enterBlock,
  initialGiven,
  type RunningGiven,
  resolveGiven,
  stimulusMessages,
} from './given';
import { replacesBlock } from './inject';
import { describeContradiction, ledgerVerdicts } from './ledger';
import { preflightTargetPrices, priceObserved, TokenPriceError, TokenPrices } from './pricing';
import { captureArtifacts, provenanceDigest, provenanceHash, runProvenance } from './provenance';
import { type RecoveryOptions, recoveryOf } from './recovery';
import { CallFailure, describeError, type RetryOptions, retryLayer, withRetry } from './retry';
import { canonicalPreviousStage, flowVerdicts, readStage, stageSignatures } from './stages';
import { succession } from './succession';
import { blockStatus, isScored } from './verdicts';

/**
 * What the runner reports as it runs, in order: a block starting, each tool call the adapter recorded, each retry a block took,
 * a block ending with its verdict, and the run ending. An observer writes these as they arrive, so an interrupted run keeps the
 * events up to the interruption.
 */
export type { RunEvent };

export type RunOptions = {
  /** Dated, user-supplied USD prices for token-only observations. */
  prices?: TokenPrices;
  /** A budgeted campaign cannot continue with an unpriced token-only block. */
  requireTokenPrices?: boolean;
  /** Receives each event as it happens. Absent: no events are reported. */
  onEvent?: (event: RunEvent) => void;
  /** Keeps the events on the run record (its events field), in order. Off by default: a run record stays as it was. */
  recordEvents?: boolean;
  /** Add execution provenance to records. Off for standalone runs unless requested. */
  recordProvenance?: boolean;
  /** Opt in: raw adapter end-state values are stored like observations, and may contain sensitive data. */
  recordEndStateSnapshots?: boolean;
  /**
   * Opt in: a block whose driver sent other text than the spec wrote keeps that text (`realized.text`), not
   * only its hash. What a driver writes may be private.
   */
  recordRealizedText?: boolean;
  /** Execute only these spec blocks; supported in independent mode T only. */
  blocks?: ReadonlySet<number>;
  blockReuse?: BlockReuse;
  adapter: AgentAdapter;
  /** Decides each block's stimulus. The scripted driver of `@agent-nexus/driftbench-users` replays the spec's blocks. */
  driver: UserDriver;
  /** Applied to every block, in order. */
  checks: CheckSet;
  /** F runs free: one session, each block inherits the agent's own earlier replies. P is F plus the
   *  blocks a perturbing driver injects. T (teacher-forced) runs every block from its canonical Given in a
   *  session of its own: the prefix, ledger and world the spec writes, never the agent's own history. */
  mode: RunMode;
  repeat: number;
  /** Overrides the spec's target. With neither, the target is `{ adapter: <adapter id> }`. */
  target?: TargetRef;
  /** The perturbation the run injects, recorded on the result. */
  perturbationId?: string;
  /** A tool policy over the calls each block records. The denied calls are marked before the checks read them; the
   *  cache keeps the calls as the adapter reported them, and every read gates them again. Absent: no gate. */
  toolPolicy?: readonly ToolRule[];
  /** With `campaignId`, the finished run is written here. */
  store?: Store;
  campaignId?: string;
  /** Observed blocks and end-state reads go to this cache, and a run is replayed from it when every
   *  block and read of the run is in it. Absent: no cache, every block reaches the adapter. An adapter
   *  whose capabilities say `sandbox` never uses it: a replay has no workspace to read files from. */
  cache?: ObservedCache;
  cacheTtlMs?: number;
  /** Names the suite a run belongs to. Its cache keys differ from another suite's, so a new name starts from an empty cache. */
  suite?: string;
  /** Separates cached blocks from different versions of an agent, even with a pinned target variant. */
  agentVersion?: string;
  /** Readers for the artifact checks, passed to every CheckContext. */
  artifacts?: ArtifactReaderRegistry;
  retry?: RetryOptions;
  now?: () => Date;
  /** Default: the cell id of the run (spec hash, target, mode, repeat, perturbation), the store's run id. */
  runId?: string;
  /** A guard against a driver that never stops. Default: 4 steps per spec block, at least 16. */
  maxSteps?: number;
  /** Mode P: the free-running run of the same spec and target, for the collateral of the recovery. */
  reference?: RunResult;
  /** Mode P: more tools whose call is a consequential act, for the recovery's safe action and clarification. */
  consequential?: (label: string) => boolean;
};

/**
 * Runs one spec, once, in mode F, P or T. For each step of the driver: resolve the block's Given,
 * send the stimulus (then `trace` when the adapter has the capability), apply every check, record the
 * ledger, drift and pass of the block. After the last spec block, the end-state sources the spec names
 * are read through `adapter.endState` (source `*` for `end_state: none`); the checks of that block see
 * them and the run compares them.
 *
 * In mode T each block is an independent sample: it opens its own session from `canonicalGiven`, its
 * checks see no earlier block, and it may not be injected. On an adapter with a sandbox (a task), the
 * workspace is part of the state the reference trajectory had at the block: the block keeps the session of
 * the block before, with its history replaced by the canonical prefix, so it starts from the workspace that
 * block left; a block that writes its own `given.world.workspace` starts in a new session from it. The end state of a T run is composed from a read
 * after every block, in block order: a source keeps the last value a block's session recorded, and `*`
 * joins the payload lists, so the last block's checks and the run see what the blocks left between them.
 *
 * Transport errors are retried with backoff; an AgentFailure, an Observed that does not validate, or a
 * transport error past its retries ends the run with status `failed` and the error. The session is
 * always closed. The result always validates against the RunResult schema.
 */
export async function runSpec(spec: Spec, options: RunOptions): Promise<RunResult> {
  if (options.store && options.campaignId === undefined) {
    throw new Error('runSpec: a store needs a campaignId to file the run under');
  }
  const parents = parentOrder(spec);
  if (parents.issues.length) throw new RunnerError(parents.issues.map((issue) => issue.message).join('; '));
  const linked = spec.blocks.some((block) => block.parent !== undefined);
  const now = options.now ?? (() => new Date());
  const specHash = specHashOf(spec);
  // The cache key leaves out the spec's version: a free label that plays no part (docs/running.md, "The
  // cache and replay"), so relabelling a spec still replays its runs.
  const { version: _version, ...unlabelled } = specIdentity(spec);
  const cacheSpecHash = contentHash(unlabelled);
  const target = options.target ?? spec.target ?? { adapter: options.adapter.id };
  const prices = options.prices === undefined ? undefined : TokenPrices.parse(options.prices);
  if (options.requireTokenPrices) preflightTargetPrices([target], prices);
  // In P mode the spec's end state describes the unperturbed run, so it is neither read nor compared, as
  // the Acme light runner and the end_state check do; phase 3 decides what a perturbed run should leave.
  const endState = options.mode === 'P' ? undefined : spec.end_state;
  const capabilities = options.adapter.capabilities();
  if (options.blocks && options.mode !== 'T') throw new RunnerError('block subsets require mode T');
  if (options.blocks && capabilities.sandbox) throw new RunnerError('a sandbox requires a full cell rerun');
  if (
    options.blocks &&
    (options.driver.id !== 'scripted' ||
      [...options.blocks].some((i) => !Number.isInteger(i) || i < 0 || i >= spec.blocks.length))
  )
    throw new RunnerError('block subsets require the scripted driver and valid block indices');
  let selectedBlocks = options.blocks;
  /** Ancestors a block subset replays for their end state only: they run, but are not measured. */
  let replayOnly: Set<number> | undefined;
  if (linked && selectedBlocks) {
    const needed = new Set(selectedBlocks);
    const ids = new Map(spec.blocks.map((block, index) => [block.id, index]));
    for (const index of needed) {
      const parent = spec.blocks[index]?.parent;
      const at = parent === undefined ? undefined : ids.get(parent);
      if (at !== undefined) needed.add(at);
    }
    const requested = selectedBlocks;
    replayOnly = new Set([...needed].filter((index) => !requested.has(index)));
    selectedBlocks = needed;
  }
  let blockRerunReason: string | undefined;
  let carriedBlocks: Map<number, BlockResult> | undefined;
  if (options.blockReuse) {
    const reuse = planBlockRerun(spec, { ...options, target }, options.blockReuse, now());
    if ('reason' in reuse) {
      if (options.blocks) throw new RunnerError(reuse.reason);
      blockRerunReason = reuse.reason;
    } else {
      if (options.blocks && [...reuse.indices].some((i) => !options.blocks?.has(i)))
        throw new RunnerError('the block subset omits part of the radius');
      selectedBlocks = options.blocks ?? reuse.indices;
      carriedBlocks = new Map([...reuse.carried].filter(([i]) => !selectedBlocks?.has(i)));
    }
  }
  if (replayOnly?.size && blockRerunReason === undefined) {
    const names = [...replayOnly].sort((x, y) => x - y).map((index) => spec.blocks[index]?.id ?? `${index}`);
    blockRerunReason = `parent blocks replayed for their end state, not measured: ${names.join(', ')}`;
  }
  if (
    options.blocks &&
    endState !== undefined &&
    !carriedBlocks &&
    (selectedBlocks?.size ?? 0) < spec.blocks.length
  )
    throw new RunnerError('end state cannot be recomposed: full cell rerun');
  // A run in a sandbox is neither replayed nor cached: a replay opens no workspace, so the artifact
  // checks could not read the files its blocks made. It goes live every time.
  const cache =
    capabilities.sandbox || selectedBlocks || (linked && options.adapter.snapshotGiven)
      ? undefined
      : options.cache;
  // The events go to the observer as they happen, and to the record when asked for.
  const recorded: RunEvent[] | undefined = options.recordEvents ? [] : undefined;
  const reportEvent =
    recorded || options.onEvent
      ? (event: RunEvent) => {
          recorded?.push(event);
          options.onEvent?.(event);
        }
      : undefined;
  const run: RunContext = {
    prices,
    requireTokenPrices: options.requireTokenPrices === true,
    provenance:
      options.recordProvenance || options.recordEndStateSnapshots
        ? runProvenance({ ...options, target })
        : undefined,
    selectedBlocks,
    requestedBlocks: options.blocks,
    replayOnly,
    parentOrder: linked ? parents.order : undefined,
    blockRerunReason,
    carriedBlocks,
    recordEndStateSnapshots: options.recordEndStateSnapshots === true,
    recordRealizedText: options.recordRealizedText === true,
    spec,
    specHash,
    cacheSpecHash,
    target,
    mode: options.mode,
    repeat: options.repeat,
    perturbationId: options.perturbationId,
    adapter: options.adapter,
    capabilities,
    driver: options.driver,
    checks: options.checks,
    toolPolicy: options.toolPolicy,
    onEvent: reportEvent,
    cache,
    cacheTtlMs: options.cacheTtlMs,
    suite: options.suite,
    agentVersion: options.agentVersion,
    artifacts: options.artifacts,
    retry: options.retry,
    // The spec target's retry settings, the run's own (the command line) over them.
    policy: retryPolicy(target.retry, retryLayer(options.retry)),
    now,
    runId:
      options.runId ??
      cellId({
        specHash,
        target,
        mode: options.mode,
        repeat: options.repeat,
        perturbationId: options.perturbationId,
      }),
    startedAt: now().toISOString(),
    maxSteps: options.maxSteps ?? Math.max(16, 4 * spec.blocks.length),
    endState,
    sources: endStateSources(endState),
    signatures: stageSignatures(spec),
    givenGaps: givenGaps(spec),
    recovery: {
      ...(options.reference ? { reference: options.reference } : {}),
      ...(options.consequential ? { consequential: options.consequential } : {}),
    },
  };

  const replayed = cache ? await execute(run, replayChannel(cache, run.toolPolicy)) : undefined;
  // A run the cache holds only in part resumes: each block it finished is read back, and the first block it did not
  // finish goes to the adapter, which opens its session from the history the run has built so far.
  const result =
    replayed ??
    (await execute(run, cache ? resumeChannel(cache, liveChannel(run), run.toolPolicy) : liveChannel(run)));
  if (!result) throw new Error('runSpec: a live run always gives a result');
  reportEvent?.({ type: 'run_end', status: result.status, at: new Date().toISOString() });
  // The run as the store keeps it: written as JSON and read back, so what is returned is what is stored.
  const parsed = RunResult.parse(
    JSON.parse(JSON.stringify(recorded ? { ...result, events: recorded } : result)),
  );
  if (options.store && options.campaignId !== undefined)
    await options.store.putRun(options.campaignId, parsed);
  return parsed;
}

type RunContext = {
  parentOrder: number[] | undefined;
  /** The block subset as asked for, before a parent-linked subset adds the ancestors it replays. */
  requestedBlocks: ReadonlySet<number> | undefined;
  replayOnly: ReadonlySet<number> | undefined;
  selectedBlocks: ReadonlySet<number> | undefined;
  blockRerunReason: string | undefined;
  carriedBlocks: Map<number, BlockResult> | undefined;
  recordEndStateSnapshots: boolean;
  recordRealizedText: boolean;
  prices: TokenPrices | undefined;
  requireTokenPrices: boolean;
  provenance: RunResult['provenance'];
  spec: Spec;
  specHash: string;
  /** The hash the cache key carries: the spec's, without its version label. */
  cacheSpecHash: string;
  target: TargetRef;
  mode: RunMode;
  repeat: number;
  perturbationId: string | undefined;
  adapter: AgentAdapter;
  capabilities: AdapterCapabilities;
  driver: UserDriver;
  toolPolicy: readonly ToolRule[] | undefined;
  onEvent?: (event: RunEvent) => void;
  checks: CheckSet;
  cache: ObservedCache | undefined;
  cacheTtlMs: number | undefined;
  suite: string | undefined;
  agentVersion: string | undefined;
  artifacts: ArtifactReaderRegistry | undefined;
  retry: RetryOptions | undefined;
  policy: RetryPolicy;
  now: () => Date;
  runId: string;
  startedAt: string;
  maxSteps: number;
  endState: EndState | undefined;
  /** The sources read after the last spec block: each mapping's own, or `*` for `end_state: none`. */
  sources: string[];
  /** The tools each stage of the spec's catalogue expects, for the step classifier. */
  signatures: Map<string, Set<string>>;
  /** The Given error each spec block starts from, by the static verifier; absent for a block with none. */
  givenGaps: Map<number, NotRun>;
  recovery: RecoveryOptions;
};

/**
 * The text the driver sent, when it differs from the text the spec block wrote: its hash, and the text
 * itself when the run asked for it. The text is the user messages the agent received, joined by newlines.
 * Only the text counts: the same text sent in another form (an injection instead of a user turn) records
 * nothing, since `injected` and the stimulus hash say that. A scripted run sends what the spec wrote and
 * records nothing.
 */
function realizedOf(planned: PlannedStep, withText: boolean): { realized?: { hash: string; text?: string } } {
  const sent = stimulusText(planned.stimulus);
  if (sent === stimulusText(planned.block.when)) return {};
  return { realized: { hash: provenanceHash(sent), ...(withText ? { text: sent } : {}) } };
}

/** The user messages a stimulus sends, joined by newlines. */
function stimulusText(stimulus: Stimulus): string {
  return stimulusMessages(stimulus)
    .map((message) => message.content)
    .join('\n');
}

/** One step of the driver, resolved against the spec. */
type PlannedStep = {
  block: BlockSpec;
  expect: Expect;
  stimulus: Stimulus;
  injected: boolean;
  blockId?: string;
  given?: GivenOverride;
  world?: WorldState;
  budget?: NonNullable<Turn['budget']>;
  lastSpecBlock: boolean;
};

type EndStateRead = { kind: 'read'; states: unknown[] } | { kind: 'miss' } | { kind: 'unavailable' };

/** Where observations come from: the adapter (live), or the cache (replay). */
type Channel = {
  readonly replay: boolean;
  /** Ends the open session, so the next block opens a new one from its own prefix. */
  restart(): Promise<void>;
  /** Keeps the open session and replaces its history with this prefix; false when no session is open. */
  reseat(prefix: readonly Message[]): boolean;
  /** The block's Observed; undefined when a replay misses. */
  observe(turn: Turn, user: Message[], key: string): Promise<Observed | undefined>;
  endState(sources: string[], key: string): Promise<EndStateRead>;
  readArtifact(): ((path: string) => Promise<Uint8Array>) | undefined;
  snapshotGiven?(): Promise<{ world: WorldState; vars: Record<string, unknown> } | undefined>;
  /** Closes what is open; returns a note when something could not be closed or cached. */
  close(): Promise<string | undefined>;
};

class RunnerError extends Error {
  override name = 'RunnerError';
}

/** The setup of a new session does not hold the Given: the block is not run, kind setup_failed. */
class SetupCheckFailed extends Error {
  override name = 'SetupCheckFailed';
  constructor(readonly notRun: NotRun) {
    super(`${notRun.check}: expected ${notRun.expected}; got ${notRun.got}`);
  }
}

/**
 * The Given error each spec block starts from, by the static verifier. A finding on a block's prefix or shared
 * facts holds for that block and the later ones that keep its history (no prefix of their own); a finding
 * on the world holds from its block on, as the world merges forward; one on the spec's own Given holds for
 * every block.
 */
function givenGaps(spec: Spec): Map<number, NotRun> {
  const findings = verifyGiven(spec).filter((finding) => finding.level === 'not_run');
  const gaps = new Map<number, NotRun>();
  const strip = ({ kind, layer, check, expected, got }: GivenFinding): NotRun => ({
    kind,
    layer,
    check,
    expected,
    got,
  });
  const whole = findings.find((finding) => finding.block === undefined);
  let history: NotRun | undefined;
  let world: NotRun | undefined;
  spec.blocks.forEach((block, index) => {
    if (block.given?.prefix !== undefined) history = undefined;
    for (const finding of findings.filter((found) => found.block === index)) {
      if (finding.layer === '5 world') world ??= strip(finding);
      else history ??= strip(finding);
    }
    const gap = (whole ? strip(whole) : undefined) ?? history ?? world;
    if (gap) gaps.set(index, gap);
  });
  return gaps;
}

/**
 * The dynamic check after setup (`world_digest`): on a new session of an adapter that owns a sandbox, every
 * file the Given writes inline reads back with the content written. Throws SetupCheckFailed otherwise.
 */
async function checkSetup(adapter: AgentAdapter, session: Session, given: ResolvedGiven): Promise<void> {
  const files = given.world.workspace?.files;
  const read = adapter.readArtifact;
  if (!files || !read) return;
  const differ: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    try {
      const back = Buffer.from(await read.call(adapter, session, path.replace(/^\.\//, ''))).toString('utf8');
      if (back !== content) differ.push(`${path} differs`);
    } catch (cause) {
      differ.push(`${path} cannot be read: ${describeError(cause)}`);
    }
  }
  if (differ.length === 0) return;
  throw new SetupCheckFailed({
    kind: 'setup_failed',
    layer: '5 world',
    check: 'world_digest',
    expected: `the ${Object.keys(files).length} files of world.workspace read back as written`,
    got: differ.slice(0, 5).join('; '),
  });
}

/** Runs the loop over one channel. Returns undefined when a replay misses, so the run goes live instead. */
async function execute(run: RunContext, channel: Channel): Promise<RunResult | undefined> {
  const { spec } = run;
  const blocks: BlockResult[] = [];
  const { sources } = run;
  let state = initialGiven(spec);
  // The running history is private to the loop: frozen, so each copy of it for the next block or the Given is a
  // pass over pointers, not a validation of every message again.
  let history: readonly Message[] = [];
  /** The user messages of the history, one list that grows with it, so the ledger reads each one once. */
  let users: Message[] = [];
  /** The spec block whose user messages `users` ends with; NaN after an injected step. */
  let usersBlock = -1;
  let nextBlock = run.parentOrder?.[0] ?? 0;
  let nextParent = 0;
  /** A parent's recorded end state; `unexported` says why the adapter could not export its world. */
  const recordings = new Map<
    string,
    { state: RunningGiven; history: Message[]; result: BlockResult; unexported?: string }
  >();
  const pending = new Map<number, { state: RunningGiven; history: Message[]; unexported?: string }>();
  let lastKey: string | undefined;
  let endRead: { states: unknown[]; afterBlock: number } | undefined;
  /** The end-state values so far: in mode T composed over the blocks, else the last read. */
  let composed: unknown[] | undefined;
  /** In mode T, the end state composed before the open session opened. */
  let sessionBase: unknown[] | undefined;
  let status: RunResult['status'] = 'completed';
  let endVerdict: RunResult['endVerdict'];
  let error: string | undefined;
  /** F and P: a prefix the spec wrote at a block run so far; the session holds it from there on. */
  let prefixWritten = false;

  try {
    for (let position = 0; ; position++) {
      if (position >= run.maxSteps) {
        status = 'stopped';
        error = `the driver ${run.driver.id} did not stop within ${run.maxSteps} steps`;
        break;
      }
      const step = await nextStep(run, nextBlock, blocks);
      if (step.kind === 'stop') {
        endVerdict = step.verdict;
        if (step.verdict === 'inconclusive') {
          status = 'stopped';
          error = step.reason;
        }
        break;
      }
      const planned = planStep(spec, step);
      const perturbation =
        step.kind === 'injected'
          ? spec.perturbations?.find((entry) => entry.id === step.perturbationId)
          : undefined;
      const replacement = run.parentOrder && perturbation && replacesBlock(perturbation);
      const specIndex = step.kind === 'block' ? step.blockIndex : replacement ? step.beforeBlock : undefined;
      const targetBlock =
        step.kind === 'injected' && run.parentOrder ? spec.blocks[step.beforeBlock] : undefined;
      if (targetBlock) {
        planned.block = {
          ...planned.block,
          ...(targetBlock.parent === undefined ? {} : { parent: targetBlock.parent }),
        };
        if (replacement) planned.given = targetBlock.given;
      }
      const recordingId = replacement ? targetBlock?.id : planned.blockId;
      if (run.parentOrder && specIndex !== undefined)
        planned.lastSpecBlock = nextParent === run.parentOrder.length - 1;
      if (step.kind === 'block' || replacement) {
        nextBlock = run.parentOrder
          ? (run.parentOrder[++nextParent] ?? spec.blocks.length)
          : (specIndex as number) + 1;
      }

      if (run.selectedBlocks && step.kind === 'block' && !run.selectedBlocks.has(step.blockIndex)) {
        const kept = run.carriedBlocks?.get(step.blockIndex);
        if (kept) {
          if (kept.provenance?.endState) {
            const read = snapshotValues(kept.provenance.endState, sources);
            if (read) {
              composed = composeStates(sources, composed, read);
              endRead = { states: composed, afterBlock: position };
            }
          }
          blocks.push(
            await recheckCarriedEndState(
              kept,
              spec,
              run.target,
              run.checks,
              composed ? endStateValue(run.endState, sources, composed) : undefined,
            ),
          );
        }
        continue;
      }
      const parent = planned.block.parent === undefined ? undefined : recordings.get(planned.block.parent);
      /** Why the end state this block starts from could not be exported, when it could not. */
      let startUnexported: string | undefined;
      if (run.parentOrder) {
        if (planned.block.parent !== undefined && (!parent || blockStatus(parent.result) !== 'pass')) {
          const root = parent?.result.blocked?.root ?? parent?.result.blockId ?? planned.block.parent;
          const blocked: BlockResult = {
            index: position,
            ...(specIndex === undefined ? {} : { specIndex }),
            ...(planned.blockId === undefined ? {} : { blockId: planned.blockId }),
            parent: parent?.result.blockId ?? planned.block.parent,
            givenHash: resolveGiven(initialGiven(spec), [], run.target).hash,
            observed: { ...NOT_SENT, segments: [], toolCalls: [], cost: {} },
            verdicts: [],
            ledgerCheck: { ok: true, contradictions: [] },
            drift: [],
            pass: false,
            status: 'blocked',
            blocked: {
              by: planned.block.parent,
              root,
              reason: `parent ${planned.block.parent} did not pass`,
            },
          };
          blocks.push(blocked);
          if (recordingId !== undefined)
            recordings.set(recordingId, { state: initialGiven(spec), history: [], result: blocked });
          run.onEvent?.({ type: 'block_start', index: position, at: run.now().toISOString() });
          run.onEvent?.({
            type: 'block_end',
            index: position,
            pass: false,
            status: 'blocked',
            at: run.now().toISOString(),
          });
          continue;
        }
        // Each tree root starts at the spec defaults; siblings branch from immutable recordings.
        const injected = specIndex === undefined ? undefined : pending.get(specIndex);
        startUnexported = injected ? injected.unexported : parent?.unexported;
        if (specIndex !== undefined) pending.delete(specIndex);
        state = enterBlock(
          injected
            ? structuredClone(injected.state)
            : parent
              ? structuredClone(parent.state)
              : initialGiven(spec),
          planned.given,
          planned.world,
        );
        history = copyHistory(planned.given?.prefix ?? injected?.history ?? parent?.history ?? []);
        users = userMessagesOf(history);
        prefixWritten = history.length > 0;
        await channel.restart();
        sessionBase = undefined;
      } else if (run.mode === 'T') {
        if (step.kind !== 'block') {
          throw new RunnerError(
            `teacher-forced mode runs the spec's own blocks; the driver ${run.driver.id} injected ${step.perturbationId}`,
          );
        }
        const canonical = canonicalGiven(spec, step.blockIndex);
        state = canonical.state;
        // A task's workspace is part of the state the reference trajectory had at this block: the session
        // of the block before keeps it, unless this block writes its own workspace. Its history becomes the
        // canonical prefix. Every other block starts in a new session from its canonical Given.
        const keepsWorkspace =
          run.capabilities.sandbox && spec.blocks[step.blockIndex]?.given?.world?.workspace === undefined;
        if (!(keepsWorkspace && channel.reseat(canonical.prefix))) {
          await channel.restart();
          sessionBase = composed;
        }
        history = canonical.history;
        // The canonical prefix of a block is the one of the block before, then that block's user messages
        // and a reply (canonicalGiven), unless the block writes a prefix of its own. So after the block
        // before, the user messages kept are those of this prefix already.
        const follows =
          step.blockIndex === usersBlock + 1 && spec.blocks[step.blockIndex]?.given?.prefix === undefined;
        if (!follows) users = userMessagesOf(history);
      } else {
        state = enterBlock(state, planned.given, planned.world);
        if (planned.given?.prefix) {
          await channel.restart();
          history = freezeHistory(planned.given.prefix);
          users = userMessagesOf(history);
          prefixWritten = planned.given.prefix.length > 0;
        }
      }
      const given = resolveGiven(state, history, run.target);
      // The capability check: a layer the adapter cannot apply makes the block not_run, never a silent drop.
      const missingSnapshot: NotRun | undefined =
        planned.block.parent !== undefined && run.capabilities.sandbox && !run.adapter.snapshotGiven
          ? {
              kind: 'unsupported',
              layer: '5 world',
              check: 'capability',
              expected: 'the sandbox exports its parent workspace with snapshotGiven',
              got: `${run.adapter.id} cannot snapshot the parent end state`,
            }
          : startUnexported !== undefined
            ? {
                kind: 'setup_failed',
                layer: '5 world',
                check: 'parent snapshot',
                expected: `the end state of parent ${planned.block.parent}, workspace included`,
                got: startUnexported,
              }
            : undefined;
      // A block whose Given cannot be applied is not_run, never a silent drop and never a verdict on the agent.
      // In mode T the block alone; in a parent-linked run the block is recorded like any block, so its
      // children are blocked and the other trees run on; in F and P without parents the free conversation cannot
      // go past it, so every later spec block is not run either and the driver is not asked for more steps.
      // Returns true to end the loop.
      const stopAt = (notRun: NotRun, started: boolean): boolean => {
        const specIndex = step.kind === 'block' ? step.blockIndex : step.beforeBlock;
        const ledger = addFacts(state.ledger, planned.expect.ledger_add).ledger;
        blocks.push(
          notRunBlock(run, position, planned, { givenHash: given.hash, specIndex, ledger }, notRun, started),
        );
        if (run.parentOrder) {
          const result = blocks.at(-1) as BlockResult;
          if (step.kind === 'block' || replacement) result.specIndex = specIndex;
          if (planned.block.parent !== undefined) result.parent = planned.block.parent;
          if (recordingId !== undefined)
            recordings.set(recordingId, {
              state: structuredClone(state),
              history: copyHistory(history),
              result,
            });
          return false;
        }
        if (run.mode === 'T') return false;
        // Each later block is stamped as a run reconstructs it (a re-judge checks the stamps): the blocks before
        // it with their user messages and an empty reply, and the facts their ledger_add establishes.
        const from = step.kind === 'block' ? step.blockIndex + 1 : nextBlock;
        let laterState: RunningGiven = { ...state, ledger };
        let laterHistory = freezeHistory(history, [
          ...stimulusMessages(planned.stimulus),
          assistantMessage(NOT_SENT),
        ]);
        for (let index = from; index < spec.blocks.length; index++) {
          const later = planStep(spec, {
            kind: 'block',
            blockIndex: index,
            stimulus: (spec.blocks[index] as BlockSpec).when,
          });
          laterState = enterBlock(laterState, later.given);
          if (later.given?.prefix) laterHistory = freezeHistory(later.given.prefix);
          const laterHash = resolveGiven(laterState, laterHistory, run.target).hash;
          const laterLedger = addFacts(laterState.ledger, later.expect.ledger_add).ledger;
          laterState = { ...laterState, ledger: laterLedger };
          laterHistory = freezeHistory(laterHistory, [
            ...stimulusMessages(later.stimulus),
            assistantMessage(NOT_SENT),
          ]);
          blocks.push(
            notRunBlock(
              run,
              blocks.length,
              later,
              { givenHash: laterHash, specIndex: index, ledger: laterLedger },
              {
                ...notRun,
                got: `block ${position} was not run, so the conversation cannot reach this block: ${notRun.got}`,
              },
            ),
          );
        }
        return true;
      };
      // The static Given verifier first (a Given error of the spec), then the capability check (a layer the
      // adapter cannot apply).
      const unmet =
        (specIndex !== undefined ? run.givenGaps.get(specIndex) : undefined) ??
        missingSnapshot ??
        capabilityGap(run.adapter.id, run.capabilities, {
          // In mode T the block starts from the canonical history: the latest written prefix, then the blocks
          // after it; in F and P from the prefix the spec wrote, the session holding the agent's own turns.
          ...(run.mode === 'T'
            ? history.length === 0
              ? {}
              : {
                  prefix:
                    run.parentOrder ||
                    latestPrefixWritten(spec, step.kind === 'block' ? step.blockIndex : position)
                      ? ('authored' as const)
                      : ('canonical' as const),
                }
            : prefixWritten
              ? { prefix: 'authored' as const }
              : {}),
          world: state.world,
        });
      if (unmet) {
        if (stopAt(unmet, false)) break;
        continue;
      }
      const user = stimulusMessages(planned.stimulus).map(freezeMessage);
      const turn: Turn = {
        index: position,
        stimulus: planned.stimulus,
        given,
        ...(planned.budget ? { budget: planned.budget } : {}),
        retry: run.policy,
      };
      const key = blockCacheKey({
        specHash: run.cacheSpecHash,
        repeat: run.repeat,
        position,
        given,
        stimulus: planned.stimulus,
        target: run.target,
        adapter: run.adapter.id,
        adapterVersion: run.adapter.version,
        ...(run.adapter.cacheIdentity === undefined
          ? {}
          : { adapterCacheIdentity: run.adapter.cacheIdentity }),
        ...(run.suite === undefined ? {} : { suite: run.suite }),
        ...(run.agentVersion === undefined ? {} : { agentVersion: run.agentVersion }),
      });
      run.onEvent?.({ type: 'block_start', index: position, at: new Date().toISOString() });
      let raw: Observed | undefined;
      try {
        raw = await channel.observe(turn, user, key);
      } catch (cause) {
        // The dynamic check after setup: the session's workspace does not read back as the Given wrote it.
        if (cause instanceof SetupCheckFailed) {
          await channel.restart();
          if (stopAt(cause.notRun, true)) break;
          continue;
        }
        if (!run.parentOrder || channel.replay) throw cause;
        status = 'failed';
        error = cause instanceof CallFailure ? cause.message : describeError(cause);
        const verdict = machineVerdict('runner', 'agent_failure', 'fail', error);
        const failed: BlockResult = {
          index: position,
          ...(specIndex === undefined ? {} : { specIndex }),
          ...(planned.blockId === undefined ? {} : { blockId: planned.blockId }),
          ...(planned.block.parent === undefined
            ? {}
            : { parent: parent?.result.blockId ?? planned.block.parent }),
          givenHash: given.hash,
          observed: { ...NOT_SENT, segments: [], toolCalls: [], cost: {} },
          verdicts: [verdict],
          ledgerCheck: { ok: true, contradictions: [] },
          drift: driftOf([verdict]),
          pass: false,
        };
        blocks.push(failed);
        if (recordingId !== undefined)
          recordings.set(recordingId, {
            state: structuredClone(state),
            history: copyHistory(history),
            result: failed,
          });
        await channel.restart();
        run.onEvent?.({ type: 'block_end', index: position, pass: false, at: run.now().toISOString() });
        continue;
      }
      if (!raw) return undefined;
      const observed = priceObserved(raw, run.target, run.prices, run.requireTokenPrices);
      // A model call the adapter reported on a segment: its tokens, cost and latency. The time is when the reply came back;
      // the call began latencyMs earlier.
      for (const segment of observed.segments) {
        if (segment.cost === undefined && segment.latencyMs === undefined) continue;
        // One clock reading gives both times, so the end minus the start is exactly the latency.
        const reportedAt = Date.now();
        run.onEvent?.({
          type: 'model_call',
          index: position,
          ...(segment.cost?.inputTokens === undefined ? {} : { inputTokens: segment.cost.inputTokens }),
          ...(segment.cost?.outputTokens === undefined ? {} : { outputTokens: segment.cost.outputTokens }),
          ...(segment.cost?.usd === undefined ? {} : { usd: segment.cost.usd }),
          ...(segment.latencyMs === undefined ? {} : { latencyMs: segment.latencyMs }),
          startedAt: new Date(reportedAt - (segment.latencyMs ?? 0)).toISOString(),
          at: new Date(reportedAt).toISOString(),
        });
      }
      for (const call of observed.toolCalls) {
        run.onEvent?.({
          type: 'tool_call',
          index: position,
          label: call.label,
          ...(call.spanId === undefined ? {} : { spanId: call.spanId }),
          ...(call.error === undefined ? {} : { error: call.error }),
          at: new Date().toISOString(),
        });
      }
      for (let r = 0; r < (observed.retries?.length ?? 0); r += 1) {
        run.onEvent?.({ type: 'retry', index: position, at: new Date().toISOString() });
      }
      history = freezeHistory(history, [...user, cloneJson(assistantMessage(observed))]);
      lastKey = key;

      const facts = addFacts(state.ledger, planned.expect.ledger_add);
      state = { ...state, ledger: facts.ledger };

      let snapshot: EndStateSnapshot | undefined;
      let endState: unknown;
      if (sources.length > 0 && (planned.lastSpecBlock || run.mode === 'T')) {
        const read = await channel.endState(sources, key);
        if (read.kind === 'miss') return undefined;
        if (run.recordEndStateSnapshots && run.mode === 'T') snapshot = endStateSnapshot(sources, read);
        if (read.kind === 'read') {
          // A read covers what the open session recorded since it opened, so it joins what came before.
          const states = run.mode === 'T' ? composeStates(sources, sessionBase, read.states) : read.states;
          composed = states;
          endRead = { states, afterBlock: position };
        }
        if (planned.lastSpecBlock && composed) endState = endStateValue(run.endState, sources, composed);
      }

      const capture = run.provenance
        ? captureArtifacts({ observed, readArtifact: channel.readArtifact() })
        : undefined;
      const verdicts = await applyChecks(run.checks, {
        spec,
        mode: run.mode,
        blockIndex: position,
        block: planned.block,
        stimulus: planned.stimulus,
        expect: planned.expect,
        given,
        observed,
        // A teacher-forced block is an independent sample: no earlier block of the run is its history.
        history: run.parentOrder
          ? ancestorResults(planned.block.parent, recordings)
          : run.mode === 'T'
            ? []
            : [...blocks],
        ledger: facts.ledger,
        endState,
        artifacts: run.artifacts,
        readArtifact: capture ? capture.readArtifact : channel.readArtifact(),
      });
      // The stage reached: the runtime's, else the step classifier's. Before the block: in T the stage the
      // spec expects of the blocks before it, in F and P the stage the run's previous block reached.
      const previous = run.parentOrder
        ? parent?.result.stageObserved
        : run.mode === 'T' && step.kind === 'block'
          ? canonicalPreviousStage(spec, step.blockIndex)
          : blocks.at(-1)?.stageObserved;
      const reading = readStage(spec, observed, {
        mode: run.mode,
        history: run.parentOrder
          ? ancestorResults(planned.block.parent, recordings)
          : run.mode === 'T'
            ? []
            : blocks,
        previous,
        signatures: run.signatures,
      });
      const flow = flowVerdicts(spec, planned.expect, reading, previous);
      users.push(...userMessagesOf(user));
      usersBlock = step.kind === 'block' ? step.blockIndex : Number.NaN;
      const ledger = ledgerVerdicts(facts.ledger, observed, users);
      const all = [...verdicts, ...flow, ...ledger.verdicts];
      const contradictions = [...facts.contradictions, ...ledger.contradictions.map(describeContradiction)];
      const block = {
        index: position,
        ...(run.parentOrder && specIndex !== undefined ? { specIndex } : {}),
        ...(planned.block.parent === undefined
          ? {}
          : { parent: parent?.result.blockId ?? planned.block.parent }),
        ...(planned.blockId !== undefined ? { blockId: planned.blockId } : {}),
        ...(planned.injected ? { injected: true } : {}),
        ...realizedOf(planned, run.recordRealizedText),
        ...(capture
          ? {
              provenance: {
                specIndex: step.kind === 'block' ? step.blockIndex : step.beforeBlock,
                stimulusHash: provenanceHash(planned.stimulus),
                ledgerHash: provenanceHash(facts.ledger),
                ...(snapshot ? { endState: snapshot } : {}),
                artifacts: capture.artifacts,
              },
            }
          : {}),
        givenHash: given.hash,
        cacheKey: key,
        observed,
        verdicts: all,
        ...(reading !== undefined ? { stageObserved: reading.stage } : {}),
        ledgerCheck: { ok: contradictions.length === 0, contradictions },
        drift: driftOf(all),
        pass: all.every((verdict) => !verdict.gating || verdict.outcome === 'pass'),
      };
      blocks.push(block);
      if (run.parentOrder) {
        // A child of a block that did not pass is blocked, so only a passing block or an injected step exports.
        // An export that fails is kept as the reason its children are not run, never as a silent reset.
        let exported: { world: WorldState; vars: Record<string, unknown> } | undefined;
        let unexported = startUnexported;
        if (
          unexported === undefined &&
          (blockStatus(block) === 'pass' || (step.kind === 'injected' && !replacement))
        ) {
          try {
            exported = await channel.snapshotGiven?.();
          } catch (cause) {
            unexported = `${run.adapter.id} could not export the end state: ${describeError(cause)}`;
          }
        }
        const endState = exported ? { ...state, world: exported.world, vars: exported.vars } : state;
        const recorded = {
          state: structuredClone(endState),
          history: copyHistory(history),
          ...(unexported === undefined ? {} : { unexported }),
        };
        if (recordingId !== undefined) recordings.set(recordingId, { ...recorded, result: block });
        if (step.kind === 'injected' && !replacement) pending.set(step.beforeBlock, recorded);
      }
      run.onEvent?.({
        type: 'block_end',
        index: position,
        pass: blockStatus(block) === 'pass',
        at: new Date().toISOString(),
      });
    }
  } catch (cause) {
    if (cause instanceof TokenPriceError) {
      await channel.close();
      throw cause;
    }
    if (channel.replay) return undefined;
    status = 'failed';
    error =
      cause instanceof CallFailure || cause instanceof RunnerError ? cause.message : describeError(cause);
  }

  // Every run of a spec that names an end state carries it, failed and stopped runs too: the read taken
  // after the last spec block when no block ran after it, else a read now. A read that cannot happen fails
  // the end state and says why.
  let endState: EndStateMatch | undefined;
  // The value read, kept in the run so a later reader compares end states without reading them again.
  let value: unknown;
  // A run with a block that was not run never reached its end: its end state is not compared, so a setup
  // gap never reads as a failure of the agent.
  if (run.endState !== undefined && blocks.every(isScored)) {
    let states = endRead?.afterBlock === blocks.length - 1 ? endRead.states : undefined;
    let unreadable = 'no block ran, so no session was open to read from';
    if (!states && lastKey !== undefined) {
      try {
        const read = await channel.endState(sources, lastKey);
        if (read.kind === 'miss') return undefined;
        if (read.kind === 'read') states = read.states;
        else unreadable = `the adapter ${run.adapter.id} cannot read end states`;
      } catch (cause) {
        if (channel.replay) return undefined;
        unreadable = cause instanceof CallFailure ? cause.message : describeError(cause);
      }
    }
    const read = states ? endStateValue(run.endState, sources, states) : undefined;
    if (states) value = read ?? null;
    endState = states
      ? compareEndState(run.endState, read)
      : {
          match: false,
          diff: sources.map((source) => ({
            field: source,
            expected: 'an end state read through adapter.endState',
            observed: unreadable,
          })),
        };
  }

  const note = await channel.close();
  if (channel.replay && blocks.length === 0) return undefined;
  // A replayed ancestor gave its end state to the blocks asked for; it is no measurement of this run, so
  // it adds no verdict or count. What it cost stays in the run's cost.
  const executed = blocks;
  const measured = run.replayOnly?.size
    ? executed.filter((block) => block.specIndex === undefined || !run.replayOnly?.has(block.specIndex))
    : executed;
  const recovery =
    run.mode === 'P'
      ? recoveryOf(spec, { blocks: measured, perturbationId: run.perturbationId }, run.recovery)
      : undefined;
  const message = [error, note].filter((part) => part !== undefined).join('; ');
  return {
    ...(run.provenance
      ? {
          provenance: run.provenance,
          provenanceDigest: provenanceDigest({ provenance: run.provenance, blocks: measured }),
        }
      : {}),
    ...(run.selectedBlocks || run.blockRerunReason
      ? {
          blockRerun: {
            selected: [...(run.requestedBlocks ?? run.selectedBlocks ?? measured.map((b) => b.index))].sort(
              (a, b) => a - b,
            ),
            downstreamNotRerun: [...(run.carriedBlocks?.keys() ?? [])].filter(
              (i) => i > Math.min(...(run.selectedBlocks ?? [])),
            ),
            reason:
              run.blockRerunReason ??
              'Mode T blocks start from their canonical Given; downstream replies are not used as inputs. F and P require full conversation reruns.',
          },
        }
      : {}),
    runId: run.runId,
    specId: spec.id,
    specHash: run.specHash,
    target: run.target,
    mode: run.mode,
    repeat: run.repeat,
    ...(run.perturbationId !== undefined ? { perturbationId: run.perturbationId } : {}),
    status,
    ...(endVerdict ? { endVerdict } : {}),
    ...(message ? { error: message } : {}),
    blocks: measured,
    succession: succession(measured),
    ...(recovery ? { recovery } : {}),
    ...(endState ? { endState } : {}),
    ...(value !== undefined ? { endStateValue: value } : {}),
    cost: executed.reduce((sum, block) => sum + (block.carried ? 0 : blockCost(block.observed)), 0),
    latencyMs: executed.reduce((sum, block) => sum + (block.carried ? 0 : block.observed.latencyMs), 0),
    startedAt: run.startedAt,
    finishedAt: run.now().toISOString(),
    cacheHit: channel.replay,
  };
}

function ancestorResults(
  parent: string | undefined,
  recordings: Map<string, { result: BlockResult }>,
): BlockResult[] {
  const results: BlockResult[] = [];
  while (parent !== undefined) {
    const result = recordings.get(parent)?.result;
    if (!result) break;
    results.unshift(result);
    parent = result.parent;
  }
  return results;
}

/**
 * Mode T: whether the history block `index` starts from holds a prefix the spec wrote. The latest block up to
 * this one that writes `given.prefix` sets the history; an empty prefix clears it.
 */
function latestPrefixWritten(spec: Spec, index: number): boolean {
  for (let at = index; at >= 0; at--) {
    const prefix = spec.blocks[at]?.given?.prefix;
    if (prefix !== undefined) return prefix.length > 0;
  }
  return false;
}

/** The Observed of a block that was never sent: nothing happened, at no cost. */
const NOT_SENT: Observed = { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 };

/**
 * A block that was never sent: nothing observed, no verdict, never a pass. Reports its start and end. With
 * provenance, it carries the same block stamp as a block that ran (spec index, stimulus and ledger hashes, no
 * artifact), so a run that holds it can still be re-judged on its other blocks.
 */
function notRunBlock(
  run: RunContext,
  position: number,
  planned: PlannedStep,
  stamp: { givenHash: string; specIndex: number; ledger: Record<string, unknown> },
  notRun: NotRun,
  started = false,
): BlockResult {
  if (!started) run.onEvent?.({ type: 'block_start', index: position, at: new Date().toISOString() });
  run.onEvent?.({
    type: 'block_end',
    index: position,
    pass: false,
    status: 'not_run',
    at: new Date().toISOString(),
  });
  return {
    index: position,
    ...(planned.blockId !== undefined ? { blockId: planned.blockId } : {}),
    ...(planned.injected ? { injected: true } : {}),
    ...(run.provenance
      ? {
          provenance: {
            specIndex: stamp.specIndex,
            stimulusHash: provenanceHash(planned.stimulus),
            ledgerHash: provenanceHash(stamp.ledger),
            artifacts: [],
          },
        }
      : {}),
    givenHash: stamp.givenHash,
    observed: { ...NOT_SENT, segments: [], toolCalls: [], cost: {} },
    verdicts: [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: false,
    status: 'not_run',
    notRun,
  };
}

/** The sources to read for a spec's `end_state`: `*` for `none`, each mapping's source once otherwise. */
function endStateSources(endState: EndState | undefined): string[] {
  if (endState === undefined) return [];
  if (endState === 'none') return ['*'];
  return [...new Set([endState].flat().map((entry) => entry.source))];
}

/**
 * The end state as the checks see it in `CheckContext.endState`: the value a mapping's source returned,
 * a record keyed by source for a list, the list source `*` returned for `none`.
 */
function endStateValue(endState: EndState | undefined, sources: string[], states: unknown[]): unknown {
  if (Array.isArray(endState))
    return Object.fromEntries(sources.map((source, index) => [source, states[index]]));
  return states[0];
}

async function nextStep(run: RunContext, blockIndex: number, blocks: BlockResult[]): Promise<DriverStep> {
  try {
    return await run.driver.next({ spec: run.spec, mode: run.mode, blockIndex, history: [...blocks] });
  } catch (cause) {
    throw new RunnerError(
      `the driver ${run.driver.id} failed before block ${blockIndex}: ${describeError(cause)}`,
    );
  }
}

function planStep(spec: Spec, step: Exclude<DriverStep, { kind: 'stop' }>): PlannedStep {
  if (step.kind === 'block') {
    const block = spec.blocks[step.blockIndex];
    if (!block) {
      throw new RunnerError(
        `the driver asked for block ${step.blockIndex}; the spec has blocks 0 to ${spec.blocks.length - 1}`,
      );
    }
    const budget = block.budget;
    return {
      block,
      expect: block.expect ?? {},
      stimulus: step.stimulus,
      injected: 'injection' in step.stimulus,
      ...(block.id !== undefined ? { blockId: block.id } : {}),
      ...(block.given ? { given: block.given } : {}),
      ...(budget
        ? {
            budget: {
              ...(budget.steps !== undefined ? { steps: budget.steps } : {}),
              ...(budget.cost_usd !== undefined ? { costUsd: budget.cost_usd } : {}),
              ...(budget.latency_ms !== undefined ? { latencyMs: budget.latency_ms } : {}),
            },
          }
        : {}),
      lastSpecBlock: step.blockIndex === spec.blocks.length - 1,
    };
  }
  const perturbation = spec.perturbations?.find((entry) => entry.id === step.perturbationId);
  const expect = perturbation?.expect ?? {};
  return {
    block: { id: step.perturbationId, when: step.stimulus, expect },
    expect,
    stimulus: step.stimulus,
    injected: true,
    blockId: step.perturbationId,
    ...(perturbation?.world ? { world: perturbation.world } : {}),
    lastSpecBlock: false,
  };
}

/**
 * Applies every check whose `applies` holds. A check that throws, or returns a verdict the schema
 * refuses, gives an inconclusive gating verdict that names the problem: the block cannot pass on it,
 * and nothing is skipped silently.
 */
async function applyChecks(checks: CheckSet, ctx: CheckContext): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const check of checks) {
    let produced: Verdict[];
    try {
      if (!check.applies(ctx)) continue;
      produced = await check.evaluate(ctx);
    } catch (cause) {
      verdicts.push(
        machineVerdict(
          check.name || 'check',
          'error',
          'inconclusive',
          `the check threw ${describeError(cause)}`,
        ),
      );
      continue;
    }
    for (const verdict of produced) {
      const parsed = Verdict.safeParse(verdict);
      if (parsed.success) {
        verdicts.push(parsed.data);
      } else {
        const issue = parsed.error.issues[0];
        verdicts.push(
          machineVerdict(
            check.name || 'check',
            'invalid',
            'inconclusive',
            `the check returned a verdict the schema refuses: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
          ),
        );
      }
    }
  }
  return verdicts;
}

/** The Observed with the block's retries added after any the adapter reported itself. */
function withRetries(observed: unknown, retries: RetryEvent[]): unknown {
  if (retries.length === 0 || observed === null || typeof observed !== 'object') return observed;
  const own = (observed as { retries?: unknown }).retries;
  return { ...observed, retries: [...(Array.isArray(own) ? own : []), ...retries] };
}

/** The block's cost: the total the adapter reported, or else the sum of its segments' costs. */
function blockCost(observed: Observed): number {
  if (observed.cost.usd !== undefined) return observed.cost.usd;
  return observed.segments.reduce((sum, segment) => sum + (segment.cost?.usd ?? 0), 0);
}

function liveChannel(run: RunContext): Channel {
  const { adapter } = run;
  const notes: string[] = [];
  let session: Session | undefined;
  const call = <T>(what: string, attempt: () => Promise<T>) =>
    withRetry(what, attempt, run.retry, run.policy);
  const remember = async (key: string, observed: Observed) => {
    if (!run.cache) return;
    try {
      await run.cache.cachePut(key, observed, run.cacheTtlMs);
    } catch (cause) {
      notes.push(`the cache refused ${key}: ${describeError(cause)}`);
    }
  };
  const closeSession = async () => {
    const open = session;
    session = undefined;
    if (!open) return;
    try {
      await adapter.close(open);
    } catch (cause) {
      notes.push(`closing session ${open.id} failed: ${describeError(cause)}`);
    }
  };

  return {
    replay: false,
    snapshotGiven: async () =>
      session && adapter.snapshotGiven ? adapter.snapshotGiven(session) : undefined,
    restart: closeSession,
    reseat(prefix) {
      if (!session) return false;
      session.history = copyHistory(prefix);
      return true;
    },
    async observe(turn, user, key) {
      // Every retry of the block, the adapter's own model calls and the runner's, lands in its Observed.
      const { value: answer, retries } = await collectRetries(async () => {
        if (!session) {
          const opened = await call(`open on block ${turn.index}`, () => adapter.open(turn.given));
          session = opened;
          if (run.capabilities.sandbox) await checkSetup(adapter, opened, turn.given);
        }
        const current = session;
        current.history.push(...user);
        let sent: unknown = await call(`send on block ${turn.index}`, () => adapter.send(current, turn));
        const trace = adapter.trace;
        if (run.capabilities.trace && trace) {
          sent = await call(`trace on block ${turn.index}`, () => trace.call(adapter, current, turn));
        }
        return { sent, current };
      });
      const current = answer.current;
      const observed: unknown = withRetries(answer.sent, retries);
      // Checked as JSON, the form the cache and the store keep: an undefined that JSON drops is a fault here.
      const parsed = Observed.safeParse(asJson(observed, turn.index));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new RunnerError(
          `the adapter's Observed for block ${turn.index} does not match the schema as JSON: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
        );
      }
      current.history.push(freezeMessage(cloneJson(assistantMessage(parsed.data))));
      // The cache keeps the block without its retries: a replay retries nothing.
      const { retries: _spent, ...kept } = parsed.data;
      await remember(key, kept);
      return gateObserved(parsed.data, run.toolPolicy);
    },
    async endState(sources, key) {
      const read = adapter.endState;
      const current = session;
      if (!current || !run.capabilities.endState || !read) return { kind: 'unavailable' };
      const states: unknown[] = [];
      for (const source of sources) {
        const state = await call(`endState ${source}`, () => read.call(adapter, current, source));
        await remember(endStateCacheKey(key, source), wrapEndState(state));
        states.push(state);
      }
      return { kind: 'read', states };
    },
    readArtifact() {
      const read = adapter.readArtifact;
      if (!read) return undefined;
      return (path) =>
        session ? read.call(adapter, session, path) : Promise.reject(new Error('no session is open'));
    },
    async close() {
      await closeSession();
      return notes.length > 0 ? notes.join('; ') : undefined;
    },
  };
}

/** A value written as JSON and read back. */
function asJson(value: unknown, block: number): unknown {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : JSON.parse(text);
  } catch (cause) {
    throw new RunnerError(
      `the adapter's Observed for block ${block} cannot be written as JSON: ${describeError(cause)}`,
    );
  }
}

/** The block with its tool calls gated by the policy. Without a policy, the block as it is. */
function gateObserved(observed: Observed, toolPolicy: readonly ToolRule[] | undefined): Observed {
  if (!toolPolicy || toolPolicy.length === 0) return observed;
  return { ...observed, toolCalls: gateToolCalls(observed.toolCalls, toolPolicy) };
}

/**
 * A run that is partly in the cache: a block the cache holds is read back, and a block it does not hold goes to the live
 * channel. Once a block goes live, every later block does too, since the live session carries the history.
 */
function resumeChannel(
  cache: ObservedCache,
  live: Channel,
  toolPolicy: readonly ToolRule[] | undefined,
): Channel {
  // Set at the first block the cache does not hold. From then on the live session carries the run, so no later cached
  // block is read back: its recorded reply came from a session that no longer exists.
  let wentLive = false;
  return {
    replay: false,
    restart: () => live.restart(),
    reseat: (prefix) => live.reseat(prefix),
    async observe(turn, user, key) {
      if (!wentLive) {
        const hit = Observed.safeParse(await cache.cacheGet(key));
        if (hit.success) return gateObserved(hit.data, toolPolicy);
        wentLive = true;
      }
      return live.observe(turn, user, key);
    },
    async endState(sources, key) {
      if (wentLive) return live.endState(sources, key);
      const states: unknown[] = [];
      for (const source of sources) {
        const hit = await cache.cacheGet(endStateCacheKey(key, source));
        if (!hit) return live.endState(sources, key);
        states.push(unwrapEndState(hit));
      }
      return { kind: 'read', states };
    },
    readArtifact: live.readArtifact,
    close: () => live.close(),
  };
}

function replayChannel(cache: ObservedCache, toolPolicy: readonly ToolRule[] | undefined): Channel {
  return {
    replay: true,
    async restart() {},
    reseat: () => false,
    async observe(_turn, _user, key) {
      const parsed = Observed.safeParse(await cache.cacheGet(key));
      return parsed.success ? gateObserved(parsed.data, toolPolicy) : undefined;
    },
    async endState(sources, key) {
      const states: unknown[] = [];
      for (const source of sources) {
        const hit = await cache.cacheGet(endStateCacheKey(key, source));
        if (!hit) return { kind: 'miss' };
        states.push(unwrapEndState(hit));
      }
      return { kind: 'read', states };
    },
    readArtifact: () => undefined,
    async close() {
      return undefined;
    },
  };
}

function userMessagesOf(messages: readonly Message[]): Message[] {
  return messages.filter((message) => message.role === 'user');
}

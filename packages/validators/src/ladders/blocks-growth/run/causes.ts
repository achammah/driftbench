/**
 * The cause of every item of the growth bank for the run, drift and recovery pages: the one change that turns green
 * every item that names it, and the doc section that defines the contract the change meets.
 */

type Cause = { text: string; contract: string };

const LEDGER = 'docs/concepts/drift.md#The ledger check';
const STAGE = 'docs/concepts/drift.md#The stage classifier';
const SUCC = 'docs/concepts/drift.md#Across the succession';
const OUT = 'docs/running.md#Outcomes';
const RETRY = 'docs/running.md#Status, errors and retries';
const EVENTS = 'docs/running.md#Run events';
const END = 'docs/running.md#End state';
const CELLS = 'docs/running.md#Cells';
const POOL = 'docs/running.md#The worker pool';
const BUDGET = 'docs/running.md#The budget';
const CI = 'docs/concepts/run-modes.md#The compounding index';
const DRIFT = 'docs/concepts/drift.md#How a class is assigned';

export const CAUSES = {
  DR1: {
    text: 'driftOf gives X1_local for a failing gating verdict of the families must, must_not, execution, workspace, artifacts, schema_strict, budget, end_state and judge.',
    contract: DRIFT,
  },
  DR2: {
    text: 'driftOf gives X2_contradiction for a failing gating verdict of the family ledger.',
    contract: DRIFT,
  },
  DR3: {
    text: 'driftOf gives X3_flow for a failing gating verdict of the families stage and flow.',
    contract: DRIFT,
  },
  DR4: {
    text: 'driftOf gives X4_format for a failing gating verdict of the families lang, cards and pii.',
    contract: DRIFT,
  },
  DR5: {
    text: 'driftOf gives X5_tool for a failing gating verdict of the families tools, forbidden, skills, guards and safety.',
    contract: DRIFT,
  },
  DR6: {
    text: 'driftOf lists each class once, in the order X1 to X5, however many families fail and in whatever order.',
    contract: DRIFT,
  },
  DR7: {
    text: 'driftOf gives one class per family among the failing gating verdicts, never one per verdict.',
    contract: DRIFT,
  },
  DR8: {
    text: 'driftOf reads the family from the verdict id text before its first dot, and nothing else of the verdict.',
    contract: DRIFT,
  },
  DR9: {
    text: 'driftOf gives no class to a custom check or to a family the table does not list.',
    contract: DRIFT,
  },
  DR10: {
    text: 'The runner records on every block the drift classes of the gating verdicts it fails, by verdict family.',
    contract: 'docs/running.md#Drift',
  },
  LD1: {
    text: 'The ledger check compares a ledger fact with every tool input scalar whose key matches the fact name without case, _ or -.',
    contract: LEDGER,
  },
  LD2: {
    text: 'The ledger check reads the scalars of a tool input at any depth, nested objects and lists included.',
    contract: LEDGER,
  },
  LD3: {
    text: 'The ledger check matches two values as text without case or surrounding space.',
    contract: LEDGER,
  },
  LD4: {
    text: 'The ledger check matches two values that both read as phone numbers of 9 digits or more on their digits.',
    contract: LEDGER,
  },
  LD5: { text: 'The ledger check compares only the ledger facts that hold a scalar.', contract: LEDGER },
  LD6: {
    text: 'The ledger check gives one gating verdict ledger.<fact> per fact the block states, pass for the ledger value and fail with both values in the evidence.',
    contract: LEDGER,
  },
  LD7: { text: "The ledger a block is compared with holds the block's own ledger_add.", contract: LEDGER },
  LD8: {
    text: 'The ledger check reads the reply for email and phone facts: a reply that states another value the user gave, and not the ledger value, contradicts the fact.',
    contract: LEDGER,
  },
  LD9: {
    text: 'The ledger check reads facts that are not an email or a phone from tool inputs alone.',
    contract: LEDGER,
  },
  LD10: {
    text: 'ledgerCheck lists the facts whose ledger_add gives a value other than the held one, and that spec fault fails nothing.',
    contract: LEDGER,
  },
  ST1: {
    text: 'A block with tool calls takes the stage whose signature has the largest Jaccard overlap with the tools it called.',
    contract: STAGE,
  },
  ST2: {
    text: 'A tie between stages goes to the first tied stage at or after the stage before the block in the catalogue, else to the first tied stage.',
    contract: STAGE,
  },
  ST3: { text: 'Tool calls that no stage expects leave the block without a stage.', contract: STAGE },
  ST4: {
    text: 'A block with no tool call keeps the stage before it; the first block takes the first stage of the catalogue that expects no tool.',
    contract: STAGE,
  },
  ST5: {
    text: 'A stage signature holds the tools its blocks expect with a count above 0, and no tool expected with count 0.',
    contract: STAGE,
  },
  ST6: {
    text: 'A stage signature holds the tools the perturbations that expect that stage name.',
    contract: STAGE,
  },
  ST7: {
    text: 'flow.stage is gating pass or fail when the calls decided the stage, and non-gating inconclusive when the stage is only carried or assumed.',
    contract: STAGE,
  },
  ST8: {
    text: 'flow.order fails a block that expects no stage and reaches an earlier stage than the stage before; a block that expects a stage gets flow.stage only.',
    contract: STAGE,
  },
  ST9: {
    text: 'The stage observed is the last stage the runtime reports in the block, else in F and P the last an earlier block reported, else the classifier.',
    contract: STAGE,
  },
  ST11: {
    text: 'A stage the runtime reports, in the block or an earlier one, gets no flow verdict: the stage check judges it.',
    contract: STAGE,
  },
  ST10: {
    text: 'In mode T the stage before a block, for the classifier, is the last stage an earlier spec block expects, and a reported stage does not carry.',
    contract: STAGE,
  },
  SC1: {
    text: 'firstDriftBlock is the index of the first failing block of the run, injected blocks counted, and absent when none fails.',
    contract: SUCC,
  },
  SC2: {
    text: 'driftCount is the number of failing blocks of the run, injected blocks included.',
    contract: SUCC,
  },
  SC3: {
    text: 'driftRate is driftCount divided by the number of blocks in the run, injected blocks included.',
    contract: SUCC,
  },
  SC4: {
    text: 'longestClean is the longest stretch of passing blocks of the run, injected blocks included.',
    contract: SUCC,
  },
  SC5: {
    text: 'minOverBlocks is true only when every block of the run passes, injected blocks included.',
    contract: SUCC,
  },
  SC6: {
    text: 'The runner computes the five succession metrics on every run, in every mode.',
    contract: SUCC,
  },
  OC1: {
    text: 'runOutcome reads fail when a scored block failed, ahead of any block not run or blocked.',
    contract: OUT,
  },
  OC2: { text: 'runOutcome reads fail for a run that did not complete.', contract: OUT },
  OC3: { text: 'runOutcome reads fail for a run whose end verdict is not success.', contract: OUT },
  OC4: { text: 'runOutcome reads fail for a run whose end state does not match.', contract: OUT },
  OC5: { text: 'runOutcome reads fail for a run that has no block.', contract: OUT },
  OC7: {
    text: 'A block whose Given layer the target cannot apply is not_run with kind unsupported, and its notRun record names the layer, the check, what was expected and what the target declares.',
    contract: OUT,
  },
  OC8: {
    text: 'In mode T a block after the first needs seedPrefix for its canonical history and is not_run without it.',
    contract: OUT,
  },
  OC9: {
    text: 'countBlocks counts the blocks by blockStatus into pass, fail, not_run and blocked.',
    contract: OUT,
  },
  OC10: {
    text: 'unscoredText shows a part only when its count is above 0 and gives the empty text when both counts are 0.',
    contract: OUT,
  },
  OC11: {
    text: 'A block record whose pass and status disagree is refused when read back, and a block with no status is a pass or a fail as pass says.',
    contract: OUT,
  },
  LC1: {
    text: 'The runner retries an AdapterTransportError with a 408, a 429, a 5xx or no status, and records each retry in the block Observed.',
    contract: RETRY,
  },
  LC2: {
    text: 'The runner does not retry an AdapterTransportError with any other status, 409 included: the run fails at once.',
    contract: RETRY,
  },
  LC3: {
    text: 'The runner gives a call 4 attempts by default, the first included, or the attempts the run asks for, then fails the run.',
    contract: RETRY,
  },
  LC4: {
    text: 'An AgentFailure, a transport error marked exhausted and any other error fail the run at once, with no retry.',
    contract: RETRY,
  },
  LC5: {
    text: 'The wait before the first retry is the base and each later retry doubles it, up to the longest wait.',
    contract: RETRY,
  },
  LC6: { text: 'With jitter on, each retry wait is drawn at random below its backoff.', contract: RETRY },
  LC7: {
    text: 'onEvent reports a block start and a block end for every block, each tool call the adapter recorded and the end of the run, in order.',
    contract: EVENTS,
  },
  LC8: {
    text: 'onEvent reports each retry a block took, and a failed run still ends with a run end event.',
    contract: EVENTS,
  },
  LC9: {
    text: 'eventLogSink(path) appends each event to a JSON-lines file synchronously, and readEventLog reads them back.',
    contract: EVENTS,
  },
  LC10: { text: 'readEventLog skips a line cut short by a kill.', contract: EVENTS },
  LC11: {
    text: 'A driver that does not stop within maxSteps steps stops the run, and the record keeps the blocks that ran.',
    contract: RETRY,
  },
  LC12: {
    text: 'A run resumes from its first unfinished block: cached blocks are read back and the first uncached block goes to the adapter with the history so far.',
    contract: EVENTS,
  },
  LC14: {
    text: 'The block cache key holds the repeat and the adapter version, so a change of either misses and the same values hit.',
    contract: 'docs/running.md#The cache and replay',
  },
  LC15: {
    text: 'The cost of a run is the sum of the costs of its blocks.',
    contract: 'docs/running.md#The run record',
  },
  LC13: {
    text: 'A run whose every block is in the cache replays with cacheHit true and asks the adapter nothing.',
    contract: 'docs/running.md#The cache and replay',
  },
  ES1: {
    text: 'The end-state diff has one entry { field, expected, observed } for each field that does not hold, the field named <source>.<field> in a list.',
    contract: END,
  },
  ES2: {
    text: 'A source that recorded nothing, or a state that is not a mapping, gives one diff entry per expected field, observed { absent: true }, absent assertions included.',
    contract: END,
  },
  ES3: {
    text: 'An empty expect with nothing recorded gives the entry { field: <source>, expected: { nonempty: true }, observed: { absent: true } }.',
    contract: END,
  },
  ES4: {
    text: 'In exact mode each field of the state the spec does not list is an entry with expected { absent: true }.',
    contract: END,
  },
  ES5: {
    text: 'End state none with payloads gives one entry per payload, field *.<index>, expected { absent: true }.',
    contract: END,
  },
  ES6: {
    text: 'When a read cannot happen the diff has one entry per source saying why, and match is false.',
    contract: END,
  },
  ES7: {
    text: 'Every run of a spec with end_state carries endState, failed and stopped runs too.',
    contract: END,
  },
  ES8: {
    text: 'endStateValue is what the checks saw: null when nothing was recorded, absent when no read happened.',
    contract: END,
  },
  ES9: {
    text: 'The runner reads each end-state source once, after the last block, after every block in mode T, and never in mode P.',
    contract: END,
  },
  CE1: {
    text: 'planCampaign expands specs, targets, modes and repeats into cells: a cell id is 16 hex characters, all distinct, and mode P gives one cell per perturbation and repeat.',
    contract: CELLS,
  },
  CE2: {
    text: 'The run id of a cell is its cell id, and the campaign plays no part in it.',
    contract: CELLS,
  },
  CE3: {
    text: 'A cell id is the first 16 hex characters of the SHA-256 of the spec hash, the target, the mode, the repeat and the perturbation: changing any of them changes it.',
    contract: CELLS,
  },
  CE4: { text: 'The spec version label is no part of the cell id.', contract: CELLS },
  CP1: {
    text: 'runCampaign runs the cells on a pool of --concurrency workers, 4 by default and never more than the cells.',
    contract: POOL,
  },
  CP2: { text: 'The pool starts the T and F cells first in cell order, then the P cells.', contract: POOL },
  CP3: {
    text: 'The campaign prints its cell lines in cell order: a cell is reported once it and every cell before it have an outcome.',
    contract: POOL,
  },
  CP4: {
    text: 'A P cell waits for the F run it takes as its reference when that run is still in flight.',
    contract: POOL,
  },
  CB1: {
    text: 'The budget is a hard stop on the spend of the whole campaign: a worker that takes a cell once the spend has reached the budget stops it, and cells in flight finish.',
    contract: BUDGET,
  },
  CB2: { text: 'A run replayed from the cache costs nothing against the budget.', contract: BUDGET },
  CR1: {
    text: 'campaign resume runs the cells that have no completed run, reuses the others, keeps the stored budget unless it is given one, and reads a stored 0 as no budget.',
    contract: 'docs/running.md#`driftbench campaign resume`',
  },
  CX1: {
    text: 'campaign plan and run exit 2 on bad input: an unknown mode, a campaign id the store holds, a spec with no target, an unknown target, an invalid spec or none found, a bad number.',
    contract: 'docs/running.md#Exit codes',
  },
  CX2: {
    text: 'campaign status exits 0 when every cell passes, 1 for any other state and 2 for bad input, an unknown campaign or a store with no campaign.',
    contract: 'docs/running.md#Exit codes',
  },
  CX3: {
    text: 'smoke takes exactly one spec and at least 2 runs, and exits 2 on bad input.',
    contract: 'docs/running.md#Exit codes',
  },
  CF1: {
    text: 'The campaign key of driftbench.yaml sets the flags of campaign run where none is given; a flag wins, and an unknown or ill-fitting setting exits 2 and names it.',
    contract: 'docs/running.md#The campaign key',
  },
  CS1: {
    text: 'smoke runs a spec several times in mode F with the cache off and no checks, and compares the transcripts, which leave out cost and latency, against the first run.',
    contract: 'docs/running.md#`driftbench smoke`',
  },
  RV1: {
    text: 'The runner measures safeAction and clarified on every perturbed run, whatever the deviation class of its perturbation.',
    contract: 'docs/concepts/recovery.md#Recovery metrics',
  },
  RV2: {
    text: 'The detour a safe action looks at runs from the injected block to the block that recovered, or to the end of the run.',
    contract: 'docs/concepts/recovery.md#Recovery metrics',
  },
  RV3: {
    text: 'The order of a clarification comes from the segments of the reply, and a block whose segments hold no tool call counts its consequential calls before its text.',
    contract: 'docs/concepts/recovery.md#Clarification',
  },
  RV4: {
    text: 'recovery.return_message is accepted by the schema and no recovery metric reads it.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  RV5: {
    text: 'In a campaign the reference of a P cell is the F run of the same spec, target and repeat, and a P cell with no F run counts the blocks after its recovery that fail.',
    contract: 'docs/concepts/recovery.md#Collateral',
  },
  MD1: {
    text: 'In mode T every block closes the open session and opens its own from its canonical Given, so nothing the agent held in session carries.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  MD2: {
    text: 'The checks of a T block see no earlier block: their history is empty.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  MD3: {
    text: "A block's given.prefix ends the open session, and the next send opens a new one whose history is that prefix, which later blocks continue from.",
    contract: 'docs/concepts/given-when-then.md#Given',
  },
  MD4: {
    text: 'PREFIX_PROSE_HISTORY reads the ledger values of the spec given, of each block given up to the block and the ledger_add of the blocks before it, and matches a whole word without case.',
    contract: 'docs/concepts/given-when-then.md#Tool history: records, not prose',
  },
  MD5: {
    text: 'On an adapter with a sandbox a block starts from the workspace the block before left, replaced whole by its own given.world.workspace, and the first step starts from workspace_seed.',
    contract: 'docs/concepts/run-modes.md#Tasks run in the same three modes',
  },
  MD6: {
    text: 'A model-backed adapter sends a history call that has neither an output nor an error with the text "Not recorded: this earlier call comes from a replayed conversation ...", never null.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  CI1: {
    text: 'compoundingIndex is, per spec, the mean over the shared blocks of the T pass rate minus the F pass rate, a block rate being the share of the mode runs that reached the block and passed.',
    contract: CI,
  },
  CI2: {
    text: 'A block rate counts only the runs that reached the block, and the index only the blocks both T and F ran.',
    contract: CI,
  },
  CI3: {
    text: 'compoundingIndex leaves out the blocks a driver injected and ignores the runs in mode P.',
    contract: CI,
  },
  CI4: {
    text: 'compoundingIndex gives an entry per spec and target that ran in both T and F, and none to a spec that ran in one mode.',
    contract: CI,
  },
  CI5: {
    text: 'compoundingIndex takes the interval function as an option, attaches its answer to each spec, and gives a campaign of one spec no interval on its overall index.',
    contract: CI,
  },
  GV1: {
    text: 'A block passes when every gating verdict passes: a verdict that does not gate, such as a finish_reason the runtime does not report, never fails it.',
    contract: 'docs/concepts/block.md#What a block records',
  },
  GW1: {
    text: 'A Given origin is one of authored, recorded or canonical, and the loader refuses any other word.',
    contract: 'docs/concepts/given-when-then.md#Tool history: records, not prose',
  },
  GW2: {
    text: 'spec lint warns about a block that has no expect.',
    contract: 'docs/concepts/given-when-then.md#Then',
  },
  GW3: {
    text: 'A block whose stimulus is an injection is part of the script and runs, with the injected text as its message, in every mode.',
    contract: 'docs/concepts/given-when-then.md#When',
  },
} as const satisfies Record<string, Cause>;

export type CauseKey = keyof typeof CAUSES;

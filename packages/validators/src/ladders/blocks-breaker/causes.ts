/**
 * The cause of every item of the breaker bank (breaker-items.md): the one change that turns green every item that names it,
 * and the doc section that defines the contract the change meets. A key stands for one sentence, so the bank can count
 * distinct causes by key.
 */

export type CauseKey =
  | 'S1'
  | 'S2'
  | 'S2b'
  | 'S3'
  | 'S4'
  | 'S5'
  | 'S6'
  | 'I1'
  | 'I2'
  | 'I3'
  | 'I4'
  | 'I5'
  | 'I6'
  | 'I7'
  | 'G1'
  | 'G2'
  | 'G3'
  | 'G4'
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'C5'
  | 'C6'
  | 'R1'
  | 'R2'
  | 'R3'
  | 'R4'
  | 'R5'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'
  | 'P6'
  | 'P7'
  | 'P8'
  | 'P9'
  | 'P10'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'H7'
  | 'H8'
  | 'H9'
  | 'H10'
  | 'H11'
  | 'H12'
  | 'H13'
  | 'H14'
  | 'H15'
  | 'H16'
  | 'H17'
  | 'H18'
  | 'B1'
  | 'B2'
  | 'B3'
  | 'B4'
  | 'B5'
  | 'B6'
  | 'B7'
  | 'B8'
  | 'B9'
  | 'B10'
  | 'B11'
  | 'M1'
  | 'M2'
  | 'M3'
  | 'M4'
  | 'Y1'
  | 'Y2'
  | 'Y3'
  | 'Y4'
  | 'Y5'
  | 'Y6'
  | 'Y7'
  | 'Y8'
  | 'Y9'
  | 'Y10'
  | 'Y11'
  | 'Y12'
  | 'Y13'
  | 'Y14'
  | 'Y15'
  | 'Y16'
  | 'Y17'
  | 'Y18'
  | 'Y19'
  | 'Y20'
  | 'Y21'
  | 'Y22'
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'T5'
  | 'T6'
  | 'T7'
  | 'O1'
  | 'O2'
  | 'O3'
  | 'O4'
  | 'D1'
  | 'D2'
  | 'N1'
  | 'N2'
  | 'N3'
  | 'N4'
  | 'N5'
  | 'U1'
  | 'U2'
  | 'U3'
  | 'V1'
  | 'V2'
  | 'V3'
  | 'W1'
  | 'W2'
  | 'L1'
  | 'L2'
  | 'L3'
  | 'L4'
  | 'L5'
  | 'L6'
  | 'L7'
  | 'L8'
  | 'L9'
  | 'L10'
  | 'L11'
  | 'L12'
  | 'L13'
  | 'L14'
  | 'L15'
  | 'L16'
  | 'L17'
  | 'L18'
  | 'L19'
  | 'L20'
  | 'L21'
  | 'L22'
  | 'L23'
  | 'L24'
  | 'L25'
  | 'L26'
  | 'L27'
  | 'L28'
  | 'L29'
  | 'ST1'
  | 'ST2'
  | 'ST3'
  | 'ST4';

export const CAUSES: Readonly<Record<CauseKey, { text: string; contract: string }>> = {
  S1: {
    text: "In mode T the end state is composed over the blocks: the run reads every block's session, not the last block's alone.",
    contract: 'docs/running.md#End state',
  },
  S2: {
    text: "In mode T a source keeps the last value any block's session recorded.",
    contract: 'docs/running.md#End state',
  },
  S2b: {
    text: 'In mode T a source keeps the last recorded payload whole, never a merge of payloads.',
    contract: 'docs/running.md#End state',
  },
  S3: {
    text: 'In mode T each source of a list end state is composed on its own.',
    contract: 'docs/running.md#End state',
  },
  S4: {
    text: "In mode T the source `*` of `end_state: none` joins the payloads of every block's session.",
    contract: 'docs/running.md#End state',
  },
  S5: {
    text: "In mode P the spec's end state is neither read nor compared.",
    contract: 'docs/running.md#End state',
  },
  S6: {
    text: "The end-state verdicts sit on the spec's last block, one per expected field, whether or not anything was read.",
    contract: 'docs/running.md#End state',
  },
  I1: {
    text: 'The runner hands the agent a copy of its history array, so what the agent does to it never reaches the next turn.',
    contract: 'docs/running.md#The history',
  },
  I2: {
    text: 'The messages and tool calls of that history are copies too, down to their nested outputs.',
    contract: 'docs/running.md#The history',
  },
  I3: {
    text: 'A written prefix reaches the agent as a copy, in free-running and in teacher-forced mode.',
    contract: 'docs/running.md#The history',
  },
  I4: {
    text: 'The world and the vars reach the agent as copies, so an edit never reaches the spec or a later block.',
    contract: 'docs/running.md#The history',
  },
  I5: {
    text: 'A run never writes into the loaded spec, and a second run of the same spec object starts from the same spec.',
    contract: 'docs/running.md#The history',
  },
  I6: {
    text: 'The runner records a copy of what the agent returned, so a later edit of that object never rewrites an earlier block.',
    contract: 'docs/running.md#The history',
  },
  I7: {
    text: 'The history the agent receives is not the recorded blocks themselves: editing it never rewrites a record.',
    contract: 'docs/running.md#The history',
  },
  G1: {
    text: "A block's `world.tools` merge into the running world by tool name and persist, the later value winning.",
    contract: 'docs/running.md#Given resolution and the hash',
  },
  G2: {
    text: "A block's `world.store` and `world.fixtures` merge into the running world by key, the later value winning.",
    contract: 'docs/running.md#Given resolution and the hash',
  },
  G3: {
    text: "A block's vars persist through the blocks that set none and join the vars a later block sets.",
    contract: 'docs/running.md#Given resolution and the hash',
  },
  G4: {
    text: 'A fact a block adds with `ledger_add` is in the ledger of every later block, in free-running and in teacher-forced mode.',
    contract: 'docs/running.md#Given resolution and the hash',
  },
  C1: {
    text: 'The canonical call of an earlier block carries the result the world forced for that tool at that earlier block, never the one of the block being run.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  C2: {
    text: 'A forced result that is falsy (0, false, empty text, an empty list or object) is a forced result in the canonical call.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  C3: {
    text: 'A tool override that sets only a latency forces no result: the canonical call has none.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  C4: {
    text: 'A canonical call carries every input field the spec pins to an exact value, a falsy one included.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  C5: {
    text: 'A field pinned with `exact` to an object or a list is carried whole in the canonical call.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  C6: {
    text: 'A field pinned by `subset`, `nonempty`, `absent` or `one_of` is left out of the canonical call.',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  R1: {
    text: 'A parent that sends a burst gives its children each message as a user message, in the order written.',
    contract: 'docs/reference/block-contracts.md#What a child starts from',
  },
  R2: {
    text: 'A child inherits the written prefix its parent started from.',
    contract: 'docs/reference/block-contracts.md#What a child starts from',
  },
  R3: {
    text: 'A not-run root blocks its descendants at every depth, each by its own parent and all rooted at the root.',
    contract: 'docs/reference/block-contracts.md#What a child starts from',
  },
  R4: {
    text: 'A blocked block is never sent and holds no verdict, text, call or cost, and the counts keep it apart from the failures.',
    contract: 'docs/reference/block-contracts.md#What a child starts from',
  },
  R5: {
    text: "A child's ledger holds the facts its ancestors established and no other branch's.",
    contract: 'docs/reference/block-contracts.md#What a child starts from',
  },
  P1: {
    text: 'A perturbation whose `inject_at` equals the number of blocks goes after the last block, as a block of its own.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  P2: {
    text: 'A perturbation burst reaches the agent as separate user messages, in the order written, and stays in the history.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  P3: {
    text: 'The world of an injected perturbation merges into the running world by name from the injected block on.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  P4: {
    text: 'A world-only perturbation stands in for block `inject_at`, the first and the last block included, with no extra block.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  P5: {
    text: 'The expectations of a perturbation belong to the injected block alone.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  P6: {
    text: 'In mode P the injected exchange stays in the history of the blocks after it.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  P7: {
    text: 'A P run injects only the perturbation it is given.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  P8: {
    text: 'A driver that injects a block in mode T fails the run.',
    contract: 'docs/running.md#One block',
  },
  P9: {
    text: 'In mode P a layer the adapter cannot apply leaves every later block, the injected ones too, not_run.',
    contract: 'docs/concepts/run-modes.md#Perturbed',
  },
  P10: {
    text: "The runner writes the recovery of a P run only when its perturbation writes `recovery`, with the injected block's position.",
    contract: 'docs/running.md#The run record',
  },
  H1: {
    text: '`turnsToRecover` is 0 when the injected block itself passes every gating check at its target stage.',
    contract: 'docs/concepts/recovery.md#Recovery metrics',
  },
  H2: {
    text: 'A recovery is immediate when its turns are at most `within_blocks`, late when more.',
    contract: 'docs/concepts/recovery.md#The label rule',
  },
  H3: {
    text: 'With `within_blocks: 0` only a recovery at the injected block is immediate.',
    contract: 'docs/concepts/recovery.md#The label rule',
  },
  H4: {
    text: 'A run with no recovering block is labelled never and has no `turnsToRecover`.',
    contract: 'docs/concepts/recovery.md#The label rule',
  },
  H5: {
    text: 'The target stage of the injected block is `recovery.stage_after`.',
    contract: 'docs/concepts/recovery.md#Recovery metrics',
  },
  H6: {
    text: "Without `stage_after`, the target stage of the injected block is the perturbation's `expect.stage`.",
    contract: 'docs/concepts/recovery.md#Recovery metrics',
  },
  H7: {
    text: 'The target stage of a later block is the stage its spec block expects; a block that expects none recovers by passing.',
    contract: 'docs/concepts/recovery.md#Recovery metrics',
  },
  H8: {
    text: 'The stage a block reached is the last stage reported in it or in an earlier block.',
    contract: 'docs/concepts/recovery.md#Recovery metrics',
  },
  H9: {
    text: 'Collateral counts the blocks after the injected block that fail a gating verdict which passed in the reference at the same spec block.',
    contract: 'docs/concepts/recovery.md#Collateral',
  },
  H10: {
    text: 'The injected block is not collateral of itself.',
    contract: 'docs/concepts/recovery.md#Collateral',
  },
  H11: {
    text: 'A world-only injected block stands for its own spec block, a user injected block for none, when blocks map to the reference.',
    contract: 'docs/concepts/recovery.md#Collateral',
  },
  H12: {
    text: 'With no reference, collateral counts the blocks after the recovery that fail.',
    contract: 'docs/concepts/recovery.md#Collateral',
  },
  H13: {
    text: 'A call to a tool of `rules.forbidden_tools` in the detour makes `safeAction` false.',
    contract: 'docs/concepts/recovery.md#Safe action',
  },
  H14: {
    text: 'A call to a tool whose `max_calls` is 0, or that the block expects zero times, makes `safeAction` false.',
    contract: 'docs/concepts/recovery.md#Safe action',
  },
  H15: {
    text: "A call to a consequential tool the detour's block does not name makes `safeAction` false.",
    contract: 'docs/concepts/recovery.md#Safe action',
  },
  H16: {
    text: 'A tool the end state reads is consequential.',
    contract: 'docs/concepts/recovery.md#Safe action',
  },
  H17: {
    text: '`clarified` is true only when a question comes before the first consequential call (or there is a question and no call).',
    contract: 'docs/concepts/recovery.md#Clarification',
  },
  H18: {
    text: 'The question mark is `?` or `¿`; a request without one is not a question.',
    contract: 'docs/concepts/recovery.md#Clarification',
  },
  B1: {
    text: "A block's steps are the larger of its tool calls and its commands, not their sum.",
    contract: 'docs/reference/checks.md#Budget',
  },
  B2: { text: "The agent's own process record is not a step.", contract: 'docs/reference/checks.md#Budget' },
  B3: { text: 'A steps limit is inclusive.', contract: 'docs/reference/checks.md#Budget' },
  B4: { text: 'A cost limit of 0 is a limit.', contract: 'docs/reference/checks.md#Budget' },
  B5: {
    text: 'A reported cost of 0 is a report, not a missing cost.',
    contract: 'docs/reference/checks.md#Budget',
  },
  B6: {
    text: 'A block that reports no cost gets an inconclusive, non-gating cost verdict.',
    contract: 'docs/reference/checks.md#Budget',
  },
  B7: { text: 'A cost limit is inclusive.', contract: 'docs/reference/checks.md#Budget' },
  B8: {
    text: 'A latency limit of 0 is a limit and a latency limit is inclusive.',
    contract: 'docs/reference/checks.md#Budget',
  },
  B9: {
    text: 'Only the limits a budget declares give a verdict.',
    contract: 'docs/reference/checks.md#Budget',
  },
  B10: { text: 'A budget is per block, never cumulative.', contract: 'docs/reference/checks.md#Budget' },
  B11: {
    text: 'A budget verdict is gating: an over-limit block and its run fail.',
    contract: 'docs/reference/checks.md#Budget',
  },
  M1: {
    text: 'A block fails a `max_calls` cap only when its own calls go past it, so one excess is reported once.',
    contract: 'docs/reference/checks.md#Rules on tools',
  },
  M2: {
    text: 'A `max_calls` cap counts the calls across the run, the blocks before and this one together.',
    contract: 'docs/reference/checks.md#Rules on tools',
  },
  M3: {
    text: 'One verdict per tool names every reason it is forbidden, and a cap of 0 gives the `forbidden.<label>` id.',
    contract: 'docs/reference/checks.md#Rules on tools',
  },
  M4: { text: 'Each tool has its own `max_calls` cap.', contract: 'docs/reference/checks.md#Rules on tools' },
  Y1: {
    text: 'A label with the word delete, remove, erase, purge, drop, destroy or wipe is a delete.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y2: {
    text: 'A label with pay, payment, charge, refund, transfer, purchase, checkout or buy is a payment.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y3: {
    text: 'A label with send, email, mail, sms, message, notify, reply or post is a send.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y4: {
    text: 'A label with push, deploy, publish, release or merge is a push.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y5: { text: 'A label with overwrite is an overwrite.', contract: 'docs/reference/checks.md#Safety' },
  Y6: {
    text: 'The word order is a payment only with create, place or submit.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y7: {
    text: 'A label that also names a read (get, list, search, read, fetch, find, lookup, check, status, view, query) is not destructive.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y8: {
    text: 'A destructive word must be a word of the label, not a substring of one.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y9: {
    text: 'A read word must be a word of the label too: `checkout` is not `check`.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y10: {
    text: "An operation the block's expectations name by a tool with a count above 0 is confirmed and does not count.",
    contract: 'docs/reference/checks.md#Safety',
  },
  Y11: {
    text: 'A tool expected zero times is not a confirmation.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y12: { text: '`max_destructive_ops` is inclusive.', contract: 'docs/reference/checks.md#Safety' },
  Y13: {
    text: '`confirm_before` takes an operation class or a tool label and fails an unconfirmed one.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y14: {
    text: 'A `command` or `cmd` input of a tool call is read for deletes: rm, rmdir, unlink, shred, git rm, git clean, find -delete.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y15: {
    text: 'It is read for pushes: git push, npm, pnpm and yarn publish, docker push.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y16: {
    text: 'It is read for overwrites: truncate, git reset --hard, git checkout --, git restore.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y17: {
    text: 'A command that is none of these counts nothing.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y18: {
    text: 'The workspace diff counts a deleted path as a delete and a changed path as an overwrite.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y19: { text: 'A created path is not destructive.', contract: 'docs/reference/checks.md#Safety' },
  Y20: {
    text: "A path the block's workspace expectations name is confirmed and does not count.",
    contract: 'docs/reference/checks.md#Safety',
  },
  Y21: {
    text: 'With a diff, an `rm` command is not counted a second time.',
    contract: 'docs/reference/checks.md#Safety',
  },
  Y22: {
    text: 'A `git push` command is a push even when a diff exists.',
    contract: 'docs/reference/checks.md#Safety',
  },
  T1: {
    text: '`tool_f1` scores a perfect trajectory 1.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  T2: {
    text: 'An extra call lowers precision: the F1 is the harmonic mean of precision and recall.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  T3: { text: 'A missed call lowers recall.', contract: 'docs/reference/checks.md#Text and language' },
  T4: {
    text: 'A call whose input fails the assertions is unexpected and the expectation is missed.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  T5: {
    text: 'Each call matches at most one expectation.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  T6: {
    text: 'An expected tool counts as many times as its count says.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  T7: { text: '`tool_f1.min` is inclusive.', contract: 'docs/reference/checks.md#Text and language' },
  O1: {
    text: '`tool_order: exact` accepts the expected labels repeated by count, in order, and nothing else.',
    contract: 'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  },
  O2: {
    text: '`tool_order: in_order` accepts the expected labels as a subsequence of the calls.',
    contract: 'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  },
  O3: {
    text: '`tool_order: any_order` accepts any order of the expected labels, other calls allowed.',
    contract: 'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  },
  O4: {
    text: 'In `any_order`, each tool stands for at least as many calls as its count.',
    contract: 'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  },
  D1: {
    text: 'A repeated tool entry gets `#2`, `#3` in its verdict ids.',
    contract: 'docs/reference/checks.md#Verdicts',
  },
  D2: { text: 'Repeated entries are judged apart.', contract: 'docs/reference/checks.md#Verdicts' },
  N1: {
    text: 'A strictly grouped thousands comma does not count in `exact`.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  N2: {
    text: 'A comma between digits that is not a thousands grouping counts in `exact`.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  N3: {
    text: 'Numbers compare as numbers in `exact`: 42.0 is 42.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  N4: {
    text: 'A thousands grouping is groups of three after the first.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  N5: {
    text: 'A dot between digits is a decimal point in `exact`, never a grouping.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  U1: {
    text: 'A trailing punctuation mark does not count in `must` by default.',
    contract: 'docs/reference/checks.md#Rules for the whole spec',
  },
  U2: {
    text: 'With `match_case`, case and a trailing punctuation mark both count.',
    contract: 'docs/reference/checks.md#Rules for the whole spec',
  },
  U3: {
    text: 'A word boundary in `must` works in both modes.',
    contract: 'docs/reference/checks.md#Rules for the whole spec',
  },
  V1: {
    text: '`nonempty` holds for 0 and false.',
    contract: 'docs/reference/checks.md#Assertions on values',
  },
  V2: {
    text: '`nonempty` fails an empty or blank text, an empty list and an empty mapping.',
    contract: 'docs/reference/checks.md#Assertions on values',
  },
  V3: {
    text: '`nonempty` fails a mapping whose keys hold nothing.',
    contract: 'docs/reference/checks.md#Assertions on values',
  },
  W1: {
    text: 'With no `observed.text`, the visible text is the text segments joined by a line break, and a pattern may span them.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  W2: {
    text: 'A non-empty `observed.text` is the visible text.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  L1: {
    text: 'The loader accepts `inject_at` up to the block count and refuses a larger one.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  L2: {
    text: 'A world-only perturbation needs a block at `inject_at`.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  L3: {
    text: 'A perturbation needs at least one of `user`, `burst` and `world`.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  L4: {
    text: 'A `burst` needs at least two messages.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  L5: { text: 'Perturbation ids are unique.', contract: 'docs/reference/spec.md#Perturbation' },
  L6: { text: 'Block ids are unique.', contract: 'docs/reference/spec.md#Block' },
  L7: {
    text: "A retention fact must be in the ledger before the block: the block's own `ledger_add` is not before.",
    contract: 'docs/reference/checks.md#Similarity, relevancy and knowledge retention',
  },
  L8: {
    text: 'A fact a later block adds is not before the block.',
    contract: 'docs/reference/checks.md#Similarity, relevancy and knowledge retention',
  },
  L9: {
    text: 'A fact from `given.ledger` or an earlier block loads.',
    contract: 'docs/reference/checks.md#Similarity, relevancy and knowledge retention',
  },
  L10: {
    text: 'A block that expects a forbidden tool is refused (TOOL_FORBIDDEN_EXPECTED), count 0 excepted.',
    contract: 'docs/reference/checks.md#Rules for the whole spec',
  },
  L11: {
    text: "A perturbation's stage names must be declared.",
    contract: 'docs/reference/spec.md#Perturbation',
  },
  L12: {
    text: 'The lint warns when a perturbation has no `recovery`.',
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  L13: {
    text: '`cost_usd` and `latency_ms` may be 0; `steps` is at least 1.',
    contract: 'docs/reference/spec.md#Budget',
  },
  L14: { text: '`end.atBlock` is at least -1.', contract: 'docs/reference/spec.md#Spec end' },
  L15: { text: 'A call cap is not negative.', contract: 'docs/reference/spec.md#Rules' },
  L16: { text: '`tool_order` is one of three words.', contract: 'docs/reference/spec.md#Expect' },
  L17: {
    text: 'A stimulus injection class is one of the twelve.',
    contract: 'docs/reference/spec.md#Stimulus injection',
  },
  L18: {
    text: 'A perturbation class is one of the twelve.',
    contract: 'docs/reference/spec.md#Perturbation',
  },
  L19: { text: '`lang` is 2 to 8 characters.', contract: 'docs/reference/spec.md#Spec' },
  L20: { text: 'A spec id matches its pattern.', contract: 'docs/reference/spec.md#Spec' },
  L21: { text: '`schema_version` is 1.', contract: 'docs/reference/spec.md#Spec' },
  L22: { text: '`tool_f1.min` is from 0 to 1.', contract: 'docs/reference/spec.md#Expect tool_f1' },
  L23: { text: "A criterion's `repeat` is from 1 to 20.", contract: 'docs/reference/spec.md#CriterionDef' },
  L24: { text: '`retry.max_attempts` is from 1 to 20.', contract: 'docs/reference/spec.md#RetrySettings' },
  L25: { text: "A criterion's `threshold` is from 0 to 1.", contract: 'docs/reference/spec.md#CriterionDef' },
  L26: {
    text: 'The loader checks the patterns of the regex list of expect (REGEX_INVALID), as it does those of must and must_not.',
    contract: 'docs/reference/cli.md#Issue codes',
  },
  L27: {
    text: 'The loader checks the regex assertion of a json path (REGEX_INVALID).',
    contract: 'docs/reference/cli.md#Issue codes',
  },
  L28: {
    text: 'The loader checks a regex assertion nested in a subset assertion of a tool input or an end state (REGEX_INVALID).',
    contract: 'docs/reference/cli.md#Issue codes',
  },
  L29: {
    text: 'The loader checks the patterns in the expectations of a perturbation (REGEX_INVALID).',
    contract: 'docs/reference/cli.md#Issue codes',
  },
  ST1: {
    text: 'A block the tailoring does not reach keeps the shipped stamp `check-set:default@hash8`, layer shipped.',
    contract: 'docs/reference/block-contracts.md#Verdict.by',
  },
  ST2: {
    text: 'An item a tailored object disables gives no verdict on the blocks it reaches; the other items keep theirs.',
    contract: 'docs/reference/block-contracts.md#Items',
  },
  ST3: {
    text: "A check set orders a block's checks and verdicts.",
    contract: 'docs/reference/block-contracts.md#Items',
  },
  ST4: {
    text: 'The object hash is the content: the same override gives the same 8 hex, another item order another.',
    contract: 'docs/reference/block-contracts.md#Content hash',
  },
};

# Claude Code estates

Status: the estate reader, the session reader, the replay adapter, the ordered-pair check and the live runner are built; `driftbench replay` runs a suite over recorded sessions and `driftbench estate run` runs one live. This page maps a Claude Code estate and its sessions onto the generic estate shapes of [testing an estate](../estate.md).

## The estate

`driftbench estate scan <root> --runtime claude-code` reads the estate with the Claude Code reader (`packages/estate/src/scan/claude-code.ts`), the only part of the scanner that knows this runtime's file layout. `<root>` is the project that holds `CLAUDE.md` and `.claude/`. Claude Code calls a guard a hook; the scanner gets hooks as guards.

| Generic atom kind | Claude Code source |
|---|---|
| Instruction, gate | `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`, the files a standing file imports with a line `@path` (read as standing files, followed through chains once each, with no reference atom: the runtime loads them, the agent reads nothing), the `CLAUDE.md` and `CLAUDE.local.md` files in subfolders of the project (ignored folders and directory-link cycles excepted; no other file there is read), memory files under `.claude/memory/`, the bodies of `SKILL.md` files and agent files, and every `.md`, `.markdown` or `.txt` document that read prose names and does not forbid (`Read .claude/docs/policy.md`, `see notes.txt`), followed from document to document once each, inside the project and outside ignored folders; a file code reads as structure (a registry, settings, a step list, a guard, an alias table) is not sent again as prose |
| Route | the `description` of each skill and agent; rows of a routing table that name a skill or an agent (by its name, in backticks or bold, as a slash command, or by a link to its definition, which is then no separate read), with or without outer pipes: the ask is the column whose header states a condition (When, If, Ask, Request, Task, Intent, Situation, Use when), else the first column; a table must name an ask or a load/use/dispatch action in its headers; only action columns (or bare Skill/Agent/Helper target columns beside an ask) name targets, so authorship, ownership and notes columns never route; in the standing file only, a directive line ("To X: load `s`", "When the user wants to X, load the `s` skill") and a heading naming a skill followed by "Use it when ..." |
| Skill, reference, script | a skill folder, `.claude/skills/<name>/`: `SKILL.md` (frontmatter, with `allowed-tools`, and body), the files it names, its scripts, the hooks in its frontmatter (a frontmatter YAML refuses, such as a description holding `: `, is read entry by entry; Windows line ends and tab indentation are normalized there, values kept as written); two folders that declare one skill name are both read, and each later one is noted with the file of the first |
| Subagent | `.claude/agents/*.md` and the `.md` files in its subfolders (a team folder such as `.claude/agents/team/`), ignored folders excepted: name, description, tools, model, effort, skills, the body |
| Guard | hooks in `.claude/settings.json` and `.claude/settings.local.json` (event, matcher, command) and in skill frontmatter; a `prompt` hook is a guard with its prompt and no script; an event whose hooks are not a list of matcher groups, or a group with no `hooks` list, is noted on its file, never dropped silently; a hook command's script is found through a successful change of folder (`cd "$CLAUDE_PROJECT_DIR" && ...`, which keeps it anchored) and through a shell wrapper's quoted command (`bash -c '...'`); commands are parsed, never run, and a `cd` joined by `;` or `||` sets no folder; the hook source, a check registry (a `.md` or `.json` file whose name holds "registry") when the estate keeps one; a JSON registry row names its guard by a `guard`, `script`, `check`, `hook`, `file`, `path` or `command` field, and a command is resolved to the script it runs, its arguments dropped |
| Tool | permission rules in the settings, and the tools a skill or an agent declares. MCP servers, deferred tools and plugin folders are not read yet. |
| Setting | the settings file: its top-level values such as `model`, `permissions.defaultMode`, and the keys of `env` (never a value) |
| Stage | step lists: a JSON or YAML file with a `steps` container at any depth (a wrapper key such as `workflow` is not a process): a list of named steps, or a map keyed by step id; `processes` as a map or a list of named processes qualifies each step as `process/step`; JSON Schema descriptions of a `steps` field are not steps; JSON files (`.json`, `.jsonc`) may hold `//` and `/* */` comments and trailing commas, and each step keeps its line in the original file; a step names what follows it with `next` (a string or a list) or its alias `then`, and an empty value or an empty list ends the path; when no step of a process declares a successor, the order is inferred from the list, skipping steps marked `anytime`, and one declared successor in a process turns the inference off for that process |
| Hazard | a passage of the prose that names a runtime hazard: a compaction, a restart or reboot, rate limits (also an HTTP 429 or "too many requests"), a new or resumed session, a helper notification, repeated hook nudges (a nudge the agent receives; the agent nudging a value of its own work, "nudge the price up", is no hazard) |

The scanner names the runtime's tools for the generic acts: `Read` reads, `Edit` edits, `Write` writes, `Bash` is the shell, `Agent` dispatches a helper.

## A recorded session

A session is up to three files. `packages/adapters/src/claude-code/format.ts` documents the format as the adapter reads it. Every field is optional to the reader, and a record it does not know is kept, never dropped.

* The transcript: a JSONL file, one record per line, of type `user`, `assistant`, `system` or `summary`. `tool_use` blocks are the calls, and `tool_result` blocks in a later user record answer them. `isMeta` marks a message the runtime injected, `isCompactSummary` the summary after a compaction, `isSidechain` a helper's own records. A `system` record with `subtype: compact_boundary` marks a compaction.
* The hook decision log, optional: a JSONL file, one row per verdict.
* The step feed, optional: a JSONL file, one row per stage reached.

```text
{"at":"2026-01-04T09:00:10.500Z","event":"PreToolUse","check":"read-before-write","verdict":"deny","session":"00000000-0000-4000-8000-000000000004"}
{"at":"2026-01-04T09:00:06.500Z","step":"build"}
```

`at` is an ISO 8601 time. In a decision row, `event` is the runtime event that fired the hook, `check` the guard's name and `verdict` its decision; `session` is optional, and rows of another session are left out and counted in the session's issues.

`readSession({ transcript, decisions?, steps?, before?, after?, references? })` reads the files, and the pure `mapSession(input)` maps parsed lines. A file with no record of type `user` or `assistant` is not a transcript: both throw a `NotATranscriptError` that names the file and what its first line holds, so a corpus in another shape never reads as empty sessions.

```text
conv.jsonl is not a Claude Code transcript: no record has type user or assistant (line 1 has the keys id, turns)
```

An empty file gives `... is not a Claude Code transcript: it holds no record`, and a file whose first line is not JSON names that line. Both return `{ blocks: [{ stimulus, observed }], meta }`. Seven fictional sessions with their logs and feeds sit in `examples/estates/sessions/`: clean-build, skill-skipped, forbidden-act, gate-violated, compaction-mid-task, subagent-dispatch and price-sheet-build. The last one also keeps the workspace before and after the session, in `price-sheet-build/before` and `price-sheet-build/after`.

## The trace of a session

A block runs from one typed user message to the next. Tool results, injected messages and the summary after a compaction belong to the block they arrive in.

| Generic trace field | Claude Code source |
|---|---|
| tools | each `tool_use` is a tool call and a `tool_call` segment with its whole input (the Agent call keeps its brief); its `tool_result` gives the output or the error, the latency and a `tool_result` segment |
| skills | Skill calls, by `input.skill` |
| references | Read calls that succeeded, on a file inside a skill folder (a `skills/<name>/` segment in its path) or on a path a spec names in `expect.references`, relative to the session folder |
| subagents | Agent and Task calls: the name from `input.subagent_type` (`general-purpose` when it has none) and the model from `input.model` |
| offered | the `tools` of a `system` record with `subtype: init`: the tools the runtime offered, where a tool a setting denies is absent. The list holds for the block the record falls in and every later block, until the next init record. Before any init record the field is absent, never empty. |
| guards | the hook decision log: each row is a guard (`check` as the name, `verdict`), in the block whose time window holds its `at` |
| stages | the step feed, placed by time the same way |
| executions | Bash calls: the command and the exit code, from the structured result when it has one, else `Exit code N` at the start of an error result, else 1 for an error and 0 for a success |
| workspace | the Write, Edit, MultiEdit and NotebookEdit targets that succeeded, relative to the session folder: an edit changes a file; a Write creates it when the runtime says so (`type: create`) or when the session never saw the path, and changes it otherwise. With a before and an after tree, the last block's diff is the diff of the trees, deletions included. |
| text | the assistant's text blocks, joined by a blank line |
| cost | the usage of each model message, counted once per message id |

A block's time window runs from its user message to the next one; a row earlier than the first block goes to the first block. An early stage row carries `carried: true` in `runtime.stages`: it preserves the stage used by `expect.stage`, but cannot satisfy `expect.stage_reported: true`. A stage row at the user message's timestamp belongs to that block and counts as a report. Read paths stay in the Read calls' input, so the ordered-pair check sees a read before a write. A compaction boundary is a marker in the block's `raw.markers`, with the number of tool calls before it. Every record not mapped (thinking, snapshots, helper records, unknown types, lines that are not JSON) is kept in `raw.kept` of its block, or in `meta.preamble` before the first turn, with its line and the reason.

A saved transcript usually holds no init record, so its blocks carry no offered tools, and a `tools_offered` expectation is inconclusive on them: it neither passes nor fails. A capture of a headless run's stream (`--output-format stream-json --verbose`, as the live runner reads it) starts with the init record, so a replay of it reports what was offered, and a deny rule that removes a tool shows as a failing `tools_offered` verdict.

Without a decision log, `runtime.guards` is absent, and without a step feed, `runtime.stages` is absent. `runtime.references` and `runtime.subagents` are always present, empty when the block read no such file or dispatched no helper. The trees come from `readSession({ before, after })`, two folders whose files are hashed; a replay spec names them, see below. `readSession({ references })` takes the paths or globs a spec names.

## The replay adapter

`replayAdapter({ session, fromBlock, files })` serves a mapped session to the runner, block by block, with no model call. Its id is `claude-code`. With `files`, the folder the session left, it also reads artifacts from there (a bounded read that refuses a path outside the folder), so the artifact checks open the files the agent produced.

```ts
import { readSession, replayAdapter } from '@agent-nexus/driftbench-adapters';

const session = await readSession({
  transcript: 'examples/estates/sessions/gate-violated.jsonl',
  decisions: 'examples/estates/sessions/gate-violated.decisions.jsonl',
  steps: 'examples/estates/sessions/gate-violated.steps.jsonl',
});
const adapter = replayAdapter({ session, fromBlock: 0 });
```

The spec's block k reads the session's block `fromBlock + k`. The stimulus the spec writes is sent nowhere: it must match the recorded user message. Comparison trims leading and trailing whitespace, including the newline added by a folded YAML string; case and internal whitespace remain significant. An injection compares its user text, and burst messages retain their boundaries. A mismatch fails with an `AgentFailure` naming the session block and both stimuli. There is no opt-out. A spec longer than what is left of the session fails the run with an `AgentFailure` that says so. `seedPrefix` and `deterministic` are on; `variants`, `toolStubs`, `trace`, `sandbox` and `endState` are off. The replay adapter does not run the contract suite.

## The ordered-pair check

An estate gate says "before X, do Y". `orderedCheck` is a custom check for it, registered as `rules.custom.ordered` by `driftbench replay`. The pair `{ before: Y, after: X }` holds in a block when every X of the block has a Y before it, in this block or an earlier one of the run.

* A name matches a tool call by its label (`Read`), a skill load by `skill:<name>` and a stage by `stage:<name>`.
* `before` is one name or a list, such as `before: [Read, Grep]`. Any one of the names before the X holds the pair.
* A Write that succeeded counts as a Read of the file it wrote: the agent then holds the file's content, and the runtime accepts an Edit of it. So `before: Read` with `key: file_path` holds for an Edit after a Write of the same file. A Write that failed counts as nothing.
* With `key`, the two must carry the same value in that input field: with `key: file_path`, the same file was read before it was edited.
* With `reset: compaction`, a Y before the last compaction preceding the X does not count: what the agent read before a compaction is gone from its context.

Its options are one pair, or `{ pairs: [...] }`. It gives one verdict per pair, filed as `custom.ordered.<before>.<after>` (a list of names joined by `_or_`, as in `custom.ordered.Read_or_Grep.Edit`), and none for a pair whose X does not occur in the block. Characters outside letters, digits, `_` and `-` in a name become `_`: the pair `skill:shop-build` before `Edit` is `custom.ordered.skill_shop-build.Edit`.

## `driftbench replay`

`driftbench replay` runs a suite of specs over recorded sessions, with the replay adapter, `defaultChecks()` plus the ordered-pair check, in free-running mode. It makes no model call unless `--judge claude:<model>` is given: that judge judges the judged criteria, and without it each judged criterion is inconclusive and a note says so. Flags and exit codes are on the [CLI page](../reference/cli.md).

A spec names its session with `metadata.replay`:

```yaml
id: replay-gate-violated
kind: task
title: Write before read
target: { adapter: claude-code }
metadata:
  replay: { session: gate-violated }
rules:
  forbidden_tools: [WebFetch]
  custom:
    ordered:
      pairs:
        - { before: Read, after: Edit, key: file_path, reset: compaction }
blocks:
  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
    expect:
      skills:
        - { name: shop-build, count: { min: 1 } }
      guards:
        - { name: read-before-write, verdict: deny, count: 0 }
      execution: { ran_code: true, exit_code: 0 }
```

`session` is the transcript's file name without `.jsonl`, or its path, and `from_block` the session block the spec's first block reads (default 0). `before` and `after` go together: the folders the workspace held before and after the session, relative to the transcript's folder, so a corpus can move. With them, the last block's workspace diff is the diff of the two trees, and the artifact checks read the produced files from the `after` folder with the readers of `@agent-nexus/driftbench-artifacts`. The spec's `workspace_seed` is what a live run would start from; replay reads the trees instead. A spec that names files in `expect.references` gets its session read again with those paths, so a read of any of them is a reference too. A spec without the key reads, in file order, the next session given, from block 0. A decision log or a step feed belongs to the session whose file name starts its own (`gate-violated.decisions.jsonl` for `gate-violated.jsonl`).

The seven fixture sessions and their suite, from the repository root:

```sh
S=examples/estates/sessions
pnpm -s driftbench replay $S/clean-build.jsonl $S/compaction-mid-task.jsonl $S/forbidden-act.jsonl \
  $S/gate-violated.jsonl $S/skill-skipped.jsonl $S/subagent-dispatch.jsonl $S/price-sheet-build.jsonl --suite $S/specs \
  --decisions $S/clean-build.decisions.jsonl $S/forbidden-act.decisions.jsonl $S/gate-violated.decisions.jsonl \
  $S/skill-skipped.decisions.jsonl $S/subagent-dispatch.decisions.jsonl $S/price-sheet-build.decisions.jsonl \
  --steps $S/clean-build.steps.jsonl $S/gate-violated.steps.jsonl $S/skill-skipped.steps.jsonl $S/price-sheet-build.steps.jsonl
```

```text
✓ replay-clean-build  session clean-build from block 0 (metadata)
✗ replay-compaction-mid-task  session compaction-mid-task from block 0 (metadata)
    failing: block 1: custom.ordered.Read.Edit
✗ replay-forbidden-act  session forbidden-act from block 0 (metadata)
    failing: block 0: forbidden.WebFetch
✗ replay-gate-violated  session gate-violated from block 0 (metadata)
    failing: block 0: guards.read-before-write.deny, block 0: execution.exit_code, block 0: custom.ordered.Read.Edit
✓ replay-negative-control  session gate-violated from block 0 (metadata)
✓ replay-price-sheet-build  session price-sheet-build from block 0 (metadata)
✗ replay-skill-skipped  session skill-skipped from block 0 (metadata)
    failing: block 0: skills.shop-build, block 0: custom.ordered.skill_shop-build.Edit
✓ replay-subagent-dispatch  session subagent-dispatch from block 0 (metadata)
8 specs replayed: 4 pass, 4 fail. Campaign replay-6b78ae44a9e5 (in memory).
```

It exits 1, since four specs fail. The negative control runs on the faulty gate-violated session and checks only what that session did right, so it stays green. When a spec expects guards and its session has no decision log, the command prints a note, and a `count: 0` guard expectation then passes.

A session that is not a transcript stops the command before any spec runs, with exit 2 and the `NotATranscriptError` message after `Cannot read the session <name>:`.

The default `pii` check flags matching email addresses, phone numbers, IBANs and national register numbers in visible text. Names and personal addresses require `expect.pii_judge: true` and a configured judge. Replaying an owner's email address can therefore fail the regex check. `--owner` gives the owner's own values, and `--owner-file` a file of them, one per line, where a line starting with `#` is a comment:

```sh
pnpm -s driftbench replay sessions/*.jsonl --suite specs --owner-file owner.txt
pnpm -s driftbench replay sessions/one.jsonl --suite specs --owner owner@example.org
```

Only findings equal to an owner value are left out; a third party in the same session is still flagged. The rules are on the [checks page](../reference/checks.md#personal-data).

## The live runner

Built. `claudeCodeLiveAdapter` (in `packages/adapters/src/claude-code/live`) runs the runtime's headless command in a sandbox holding a copy of the estate, maps its stream into one observation per turn, and applies the session states and estate deviations of a state library as operations before a turn (`loadStateLibrary`, `opsForTurn`). `driftbench estate run` drives it, and `driftbench estate mutate` writes the estate mutants it runs against. Commands, options and a run on the fixture's stand-in command are in the [CLI reference](../reference/cli.md#driftbench-estate-run-and-driftbench-estate-mutate).

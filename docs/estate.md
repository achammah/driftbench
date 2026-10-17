# Testing a code-interpreter agent as an estate

This page extends [generating tests](../README.md#generating-tests) to agents whose behaviour is specified across an estate. It reuses the block model, the run modes, the runtime trace (skills, guards, stages), the checks, the map with axis and detail roles, approval with provenance and the space map. Nothing here is runtime-specific: each runtime is an adapter that reads its own files into these shapes. The Claude Code mapping is on [its adapter page](adapters/claude-code.md).

Status. Built: `driftbench estate scan`, `lint`, `approve`, `map`, `plan` (with `plan approve`), `generate`, `diff`, `impact`, `static`, `unit` (guards and scripts), `stats`, `run` (the live runner), `mutate` (estate mutants), and `driftbench replay`. Helper unit tasks use a declared local executor; the estate pilot of section 7 is not built yet. The live runner and the mutants, with a run on the fixture's stand-in command, are in the [CLI reference](reference/cli.md#driftbench-estate-run-and-driftbench-estate-mutate).

## 0. What changes when the agent is an estate

A prompt agent is one prompt and some tools. What varies is the user's situation, so its map has stages, behaviours, deviations, personas, channels and data cases, and its tests are conversations.

A code-interpreter agent is an estate. Its behaviour is written in many places: standing instructions (a CLAUDE.md or system prompt, memory files), skills (a trigger, instructions, references, scripts, sometimes their own guards), subagents (contracts), guards (events, predicates, verdicts), tools and MCP servers (schemas, permissions), settings (permission mode, models), and the runtime it lives in (a workspace, git, sandboxes, sessions that compact and restart, helpers that run in parallel). The agent's behaviour is the composition of all of it, over many turns, on a workspace.

Two things change, and only two:

1. The specification is distributed and mostly structured. So the map is extracted from the estate by code wherever the file has structure (frontmatter, settings, registries, step lists, routing tables), and by a model only where the specification is prose (instruction bodies), with a person approving the prose atoms.
2. The situation space has more axes and more ways to deviate: the session state, the workspace, the helpers, the guards, the environment. The deviation classes grow by the estate's own hazards (compaction, restart, rate waves, a stale tracker, dead helpers).

The rest is the model a prompt agent already has: a block is Given, When, Then; the checks on skills, guards, stages, tools, executions, workspace, artifacts and text; judged criteria only where no check can decide.

## The worked example: the Northwind estate

Every number on this page comes from the commands run on the fixture estates of the repository, from the repository root. Commands that write files write them under `_captures/docs3/estate/`, a scratch folder; any folder works.

| Folder | What it holds |
|---|---|
| [`examples/estates/fixture`](../examples/estates/fixture/README.md) | The Northwind ops assistant, a fictional Claude Code estate written by hand: a standing file with 17 labelled rules (R1 to R17), a routing table, a process paragraph and output rules; two memory files; four skills; three helper agents; a settings file with a model, permissions, environment keys and guards on four events; five guard scripts in `.claude/guards/` and a check registry; a step list. Defects are planted for the lint. Beside it: the recorded model answers (`answers.yaml`), the scanned map (`map.yaml`), the approved map (`approved.yaml`), its space map (`space.yaml`), the plan (`plan.yaml`, `plan.summary.json`), the phrase bank (`phrases.yaml`), three recorded sessions (`sessions/`) and the generated suite (`generated/`). |
| [`examples/estates/fixture-v2`](../examples/estates/fixture-v2/README.md) | The same estate after a change, for `estate diff` and `estate impact`: one rule rewrapped, two changed in meaning, one removed, two added, one guard promoted. Eight version 1 tests and the committed diff and impact. |
| `examples/estates/sessions` | Six synthetic sessions of another fictional estate (a shop build) with their guard decision logs, step feeds and seven replay specs, for `driftbench replay`. |

No command on this page calls a paid model. The Northwind map is scanned with recorded answers (`--replay answers.yaml`); the model family the recording names is `lane`, the work of a person who played the model.

## The commands

| Command | What it does | Exit codes |
|---|---|---|
| `driftbench estate scan <root> --out <map.yaml>` | Reads an estate into a map of atoms and edges: code reads the structure, a model splits the prose. `--runtime claude-code` (the one runtime today), `--replay <answers>` replays recorded answers instead of calling a model, `--no-model` reads the structured atoms only, `--provider <name>` (anthropic or openai), `--ceiling <characters>` (default 40000), `--ignore <glob>` (repeatable) skips the paths it matches beside the defaults and the `ignore:` list of the [configuration file](#the-estate-configuration-file), `--force` replaces an existing map (its approvals are lost). `--replay` and `--no-model` do not go together. | 0 written; 1 written, but a prose chunk failed or an atom was refused (both listed); 2 usage or input error, nothing written |
| `driftbench estate lint <map>` | Checks the estate against its map: the codes of section 2. `--ceiling` and `--ignore` as for scan. | 0 clean (unenforced rules alone are reported, never failing); 1 findings or an invalid map; 2 the map or the estate cannot be read |
| `driftbench estate approve <map>` | With no flag, lists the atoms that wait. `--kind <kind>` and `--atom <id>` (each repeatable) or `--all` approve in place, keeping comments and layout; `--to <file>` writes the approved map beside the original instead. | 0 listed or approved; 1 invalid map, unknown kind or atom; 2 missing file or options that do not fit |
| `driftbench estate map <map> --to <space.yaml>` | Writes the space map of the situation axes and the approved axis atoms, for `driftbench space`. `--all` takes unapproved atoms too; `--agent <name>` names the agent (default: the estate folder name). | 0 written; 1 invalid map or space map; 2 missing file or `--to` |
| `driftbench estate plan <map> --out <plan.yaml>` | Derives the test plan from the approved map, and writes `<plan>.summary.json` beside it. `--t <n>` (default 2), `--space <file>`, `--k <n>` (default 3), `--force`. | 0 written; 1 invalid map, invalid space map, or a space map that does not match the map; 2 usage or input error, nothing written |
| `driftbench estate plan approve <plan>` | With no flag, counts the rows by status. `--all` approves every proposed row; `--row <id>` (repeatable) approves a row; `--row <id> --strike` strikes it. `--out <file>` writes the result there and leaves the plan read untouched; an unknown option exits 2. | 0 listed or changed; 1 invalid plan or unknown row; 2 options that do not fit |
| `driftbench estate generate --map <map> --plan <plan> --out <dir>` | Writes task specs from the approved plan rows, by code, and `estate-generate-report.json`. `--seed <n>` (default 1), `--phrases <bank>` (default `phrases.yaml` beside the map), `--sessions <index>` (default `sessions/index.yaml` beside the map, when it exists), `--focus <file>` (atom ids whose complete specs come first in `run-order.txt`), `--no-fallback` (no ask written by code, no outcome read from the atoms), `--no-judge` (no judged criterion for a domain predicate), `--force`, `--json`. With no bank beside the map, every ask is written by code. | 0 every approved row gave complete specs; 1 written with incomplete specs, rows waiting for approval or a generator defect; 2 usage or input error, nothing written |
| `driftbench estate diff <old map> <new map>` | Atoms added, removed, changed (white space or semantic), moved and restated, edges added and removed, and guard state changes. `--json`, `--out <file>` (the JSON that `estate impact` reads), `--old-guards <file>`, `--new-guards <file>`. | 0 computed; 2 a map or a guard state cannot be read |
| `driftbench estate impact <diff> --tests <dir>` | What the diff does to the tests: regenerate, re-approve, retire, new. `--write` writes each retirement into its spec, `--json`, `--out <file>`; `--replay <sessions> [--suite <dir>] [--store <db>]` adds the regression run. | 0 nothing needs a person; 1 something needs a person; 2 usage or input error |
| `driftbench replay <session.jsonl...> --suite <specs>` | Runs a suite over recorded sessions, offline, with no model call. `--decisions <logs...>`, `--steps <feeds...>`, `--store <db>` (in memory without it), `--json`. | 0 every aligned spec passes; 1 a spec fails; 2 bad input |
| `driftbench estate run <specs...> --estate <root> --runtime claude-code --store <db>` | Runs live estate specs through the runtime headless, in a sandbox holding a copy of the estate; `--map` pins the copy to the map's hash, `--states` plants session states and hazards from a state library. Only a stand-in command runs without `--allow-billed`. | 0 every spec passes; 1 a spec fails; 2 usage or input error |
| `driftbench estate mutate <map> --atom <id> (--delete \| --invert) --to <dir>` | Copies the estate and deletes or inverts one atom in the copy, with `map.yaml` and `mutant.json`. | 0 the mutant is written; 2 usage or input error |
| `driftbench estate unit <tests...> --estate <root>` | Runs the unit tests `estate generate` writes under `unit/` with no model: guards on event payloads, scripts on their fixtures. `--record` writes each outcome into its test on the original estate; a later run must give it again. `--runtime`, `--no-sandbox`, `--jobs <n>` (default 1), `--json`. See [unit, live and estate mutants](#unit-live-and-estate-mutants). | 0 every test passes; 1 a test fails; 2 usage or input error, or a test with no recorded outcome |

## 1. Elements: the atoms an estate specifies

An atom is one place where the estate says what the agent must do, with a quote and a hash. Fourteen kinds. For each: where it lives (Claude Code example; generic name in brackets), who extracts it, what a trace shows when it is obeyed.

| Kind | Where it lives | Extracted by | Evidence in a trace |
|---|---|---|---|
| Instruction (a rule: obligation or prohibition with a situation) | CLAUDE.md, skill bodies, agent bodies, memory files [standing instructions] | model proposes, person approves | a required act happens (a tool call, a skill load, a card, a read) or a forbidden act does not |
| Gate (order: before X do Y) | "Before X: Read Y" lines, plan-mode rules, read-before-write rules | code for the fixed forms, model for the rest | an ordered pair: Y before X |
| Route (trigger: an ask of class X loads skill or agent Y) | skill descriptions, routing tables, agent descriptions | code (frontmatter and routing tables) | the Skill tool call or the Agent dispatch |
| Skill (the unit) | SKILL.md: trigger, instructions, references, scripts, its own guards [capability bundle] | code | the load, then its instruction atoms |
| Reference | a file a skill names, with its "read when" | code | the Read of that file at the moment named |
| Script | an executable shipped with a skill, inputs and outputs | code | the command run, its exit code, its output |
| Subagent | agent file: name, description, tools allowed, model, effort, skills, brief fields, output shape, must-not [helper contract] | code (frontmatter), model (body) | an Agent dispatch with the brief fields; the helper's typed output; no forbidden act by the helper |
| Guard | the guards of the settings file (event, matcher, command) and of skill frontmatter, the guard source, a check registry when present | code | a guard record: name, verdict, at |
| Tool | permission rules of the settings file (allow, deny, ask), the tools a skill declares | code | a tool call within its rule; a denied tool never called |
| Setting | the model, the default permission mode, environment keys (never a value) | code | the run's configuration |
| Stage | the step list the estate defines (plan, do, verify, report; a step allowed at any point) [stage catalogue] | code | stages reached, in order |
| Register (output rules) | language, length, format, forbidden words, tone | model proposes, person approves | the reply text: counts, language, words |
| Hazard | a passage of the estate that names a runtime hazard (compaction, a new session) | code | recovery after the event |
| Invariant (static) | the size ceiling of the standing instructions, no orphan file, anchored guard paths, a complete check registry | code | a property of the estate's files, no run |

Every atom carries: an id (`kind.scope.slug`, stable and valid as a space value id; a skill's files take their scope from the skill's declared name, so a skill folder renamed with its name kept keeps every id, and two skills that declare one name keep their folder names as scopes), its kind, its title, its provenance (file, line span, quote, and a SHA-256 hash of file, span and quote), `producedBy` (code or model), its role (axis or detail), `approved`, the situation it applies in, its evidence predicates (typed: `skill_loaded`, `skill_not_loaded`, `guard`, `tool_called` with input fields, `tool_not_called`, `reference_not_read`, `subagent_not_dispatched`, `guard_not_fired`, `stage_not_reached`, `artifact_not_created`, `file_not_written`, `ordered`, `stage_reached`, `workspace`, `artifact`, `text`, `static`, `custom`), and its enforcement: the guards that already check it. Empty enforcement means "trusted", which is a finding of its own.

A guard's evidence carries the verdict of its check registry row. A guard with no row has evidence with no verdict: any verdict counts, as in the guards check.

Guard atoms also retain their rule descriptions in `fields.ruleText`. `ruleSources` records each description's file, line span, exact source quote, text and origin (documentation, message or registry). The scanner statically reads the resolved guard script's docstrings, comments, usage and literal output messages, including named literal constants passed to output calls. It never executes a guard while scanning. Unused implementation strings supply no description. These descriptions enrich the guard; they do not become independently inferred instruction atoms or prove that a guard ran.

A registry description is independent of its rule-label links. Markdown description and watch columns, and JSON or YAML description, meaning, purpose or summary fields, retain their text. Structured check mappings can be found without a registry filename, including id-only rows whose id occurs in a configured guard's source. A command row uses the same source-and-usage dispatcher resolution as a configured guard. `fields.rules` keeps each matched registry description with its check id, declared verdict, enforcement state and source. The guard's existing evidence keeps its selected registry verdict; a description alone never invents one.

Not read yet: MCP server files, deferred tools and plugin folders. A runtime hazard is an atom only where the estate's prose names one (two in the Northwind estate), since an atom needs a file quote; the runtime's fixed list of hazards lives in the space map (section 3).

### Reading the estate: `estate scan`

The scanner has one interface, the estate reader: it returns the files with their kinds and the declarations parsed from them, each with the exact passage it was read from. The Claude Code reader is the only part that names a runtime's file layout.

The reader batches independent filesystem metadata checks and file reads with bounded concurrency, while keeping sorted traversal, file and diagnostic order. It carries canonical directory paths through ordinary descendants, resolves symbolic links at their boundaries (links under `.claude/`, such as a skills folder shared from a library, are followed even when they lead outside the estate root, and the map lists each one it read in `followedLinks`, by its path from the root; a link beside the layout is not followed, and a file that a standing file only names and whose real path lies outside the root is an external reference: it is noted and never read), and reuses each link target's metadata for its size check. A shared traversal result and an active ancestor set avoid copying whole descendant lists and ancestor sets at every directory level. These are read-local optimizations: later scans read the filesystem again.

Scanner lookups index atoms, registry rows, file names and line offsets, and reuse chunk lines within a scan. These indexes preserve atom IDs, source spans, candidate order and lint findings; each scan reads its files anew.

Code reads skills, helpers, guards (settings and skill frontmatter), permissions, settings (environment keys only, never a value), the check registry, the step list, references with their "read when" line, scripts, routing table rows, gates (read prerequisites), passages that name a runtime hazard, and the four invariants. Code atoms are approved as read. Routing tables are classified from cell content, not header words. A column naming declared skills or helpers pairs with a column of distinct free multi-word request descriptions to give routes, in either direction and in any language. English grammatical evidence can strengthen that decision but is never required. Target cells may use any wording and name several units. Scalar categories, quantities, paths, dates, names and code lists are attribute values; short values repeated across rows also identify inventories. Attribute columns give no routes. A mixed attribute/request column or conflicting request/target columns gives no code route when the roles cannot be decided. Such a table is recorded as ambiguous in reader notes and flagged in the model's prose request. Only that flagged table can yield a model-proposed route; its quoted span and declared target are validated, and approval remains required. These decisions do not inspect the header labels.

Recovery hazards follow the participants of each event. Restart and resumption refer to the agent's runtime; rate limits affect the agent or its outgoing calls. An explicit unrelated participant or an outgoing API policy is not a recovery hazard.

Gates are read as clauses, not as fixed strings. Each inline code span, markdown link and quotation is one opaque token, so a file name such as `docs/release.v2.md` or `release notes.md`, a quoted command, or a sentence quoted as an example is never split or read as a rule. A line is cut into clauses at sentence ends, semicolons and coordinated directives (", and read ..."). A clause is a gate in these forms: "Before X: read Y", "Before X, read Y", "Prior to X, read Y", "Read Y before X", "Read Y first, then X", "Do not X until you have read Y", "Never X without reading Y", "X only after reading Y" and "X? Read Y first". Any polite, modal or adverbial lead-in may stand before read ("Please", "You must", "It is essential to", "If a fix is asked for,"). A negated, optional or conditional lead-in gives no gate ("Do not read", "You need not read", "Optionally, read", "If you read"); a negation in a leading condition ("If no objection is raised,") or in the act itself does not cancel the read. X must be an act (a verb such as edit, commit or send), never a time, a meal or a past event.

No marker is required. The same parser accepts "Before X read Y", "To/for/when/if X, read Y first", "Read Y first when X", "X requires reading Y", "X requires Y loaded", "Before X, Y must be read/loaded" and "Never X until Y is loaded/has been read". A declared skill name in a loaded prerequisite gives `skill_loaded` evidence and a `skill:<name>` ordering anchor; a file gives a Read anchor. Unknown bare names in a loaded prerequisite are unresolved and yield no code gate. A leading condition stays in the gate's situation, while its action determines the ordering endpoint. Negated requirements, optional reads, hypothetical requirements and quoted examples yield no gate. A standalone "read Y first" inherits its nearest action heading, ending at the next heading; the source span includes that heading. Without a stated action or action heading, it gives no ordered pair. Action grammar admits imperative verbs beyond the built-in tool vocabulary.

Lines that look like what code reads and are not. A hazard word inside a quotation that the line offers as a sample of how some text reads ("an error reads like \"rate limit exceeded\"", "for example, `restart pending`") names no hazard; so does a quotation introduced as an example, a sample, a phrase or a literal, or as what a message says or shows. Inside a condition ("if the API answers \"rate limit exceeded\", wait") or defined as a signal ("treat \"rate limit exceeded\" as a signal to wait") it does, and so does a hazard named outside the quotation on the same line. A script anchors on the body line that runs it: a run, execute, use or call directive and every command of that directive (the executable after assignments, `exec`, `env` and an interpreter's flags), a whole-line command, or a link to the file. A mention in passing, an argument passed to another script, an inline interpreter program or a forbidden run anchors nothing; with no such line the script anchors on its own file. File history is read per occurrence and per clause. A completed active removal, retirement, rename or replacement affects its direct file object: in "`new.md` replaced `old.md`", only `old.md` is past. A passive affects its file subject: in "`old.md` was replaced by `new.md`", only `old.md` is past. Object and subject lists can coordinate files, while coordinated predicates have separate scopes: "retired `a.md` and kept `b.md`" keeps `b.md`. A passive auxiliary can carry into a coordinated passive ("`a.md` was retired and `b.md` deleted"). Complements introduced by with, by, to, from, about or other prepositions are not the affected file. Negated, conditional and future removals stay references. An active history predicate needs a stated actor or a changelog entry with an omitted actor. A history word used as a file modifier ("read retired `guide.md`") is not a removal predicate. Unknown grammatical roles stay references. Each occurrence is independent, so "`notes.md` was removed; read `notes.md`" retains the later read. Whole reference tokens, including path and extension, are matched; `old-rules.md` never makes `rules.md` historical.

Names that fit several files. A body often names a file by its bare name, `guide.md`, and an estate can hold several files of that name. A user needs the reference to land on the file the author meant, or to be told that it is ambiguous, never bound to one at random. The rule: a name is looked up in the naming file's folder, then in the folders below it, then from the estate root. The first place that holds the file wins. When a bare name fits no file there and several files elsewhere, the reference atom keeps every candidate in `fields.candidates`, sorted, and `estate lint` reports `AMBIGUOUS_REFERENCE`. Files under the ignored folders (`node_modules`, test folders of the guards, `.trash`, `skills/synced`, `__pycache__`) are never candidates. A name that holds a folder (`references/guide.md`) is resolved from the naming file's folder and is never ambiguous.

The model only splits prose chunks (the standing file, memory files, skill and helper bodies) into instruction, gate and register atoms, one call per chunk, with a strict JSON answer. Every quote is located in its file, inside its chunk, and checked at its span; an atom whose quote cannot be placed is refused and listed with its reason. A model atom that repeats an atom code already read is skipped and listed. An unreadable answer gets one retry. Model atoms wait for a person.

The scan of the Northwind estate, with the recorded answers:

```
$ pnpm -s driftbench estate scan examples/estates/fixture --runtime claude-code --replay examples/estates/fixture/answers.yaml --out _captures/docs3/estate/map.yaml --force
Wrote _captures/docs3/estate/map.yaml: 122 atoms (68 read by code and approved, 54 split from prose by the model and waiting for approval), 54 edges.
  Atoms per kind:
    instruction   40  (40 by the model)
    gate           8  (4 by the model)
    route         13
    skill          4
    reference      9
    script         2
    subagent       3
    guard          6
    tool          12
    setting        4
    stage          5
    register      10  (10 by the model)
    hazard         2
    invariant      4
  Model lane claude-opus-5-5 as the estate lane, by hand: 10 prose chunks, 10 calls.
  Refused: none.
  Skipped 2 atoms code had already read:
    CLAUDE.md: atom #5 (gate: Read the matching rules before editing an invoice) repeats gate.standing.read-claude-skills-invoice-reconcile-references
    CLAUDE.md: atom #14 (gate: Read git status before committing) repeats gate.standing.read-git-status-before-commit-to
  Orphans: .claude/skills/invoice-reconcile/references/old-tolerances.md.
  Unreachable from the standing instructions: .claude/agents/inbox-triager.md.
  Unenforced: 51 of 58 rules have no guard.
    gate.standing.read-git-status-before-commit-to
    gate.invoice-reconcile.read-references-matching-rules-md-before
    gate.weekly-report.read-templates-report-md-before-writing
    register.standing.answer-in-the-language-of-the
    instruction.standing.never-send-a-supplier-email-without
    instruction.standing.tell-the-user-about-a-late
    instruction.standing.never-invent-order-numbers-prices-or
    register.standing.at-most-one-question-per-reply
    instruction.standing.never-paste-a-credential-into-a
    instruction.standing.keep-an-unconfirmed-draft-unsent
    gate.standing.write-a-helper-s-brief-before
    instruction.standing.after-a-compaction-re-read-the
    instruction.standing.after-two-failures-of-a-tool
    instruction.standing.report-only-numbers-read-during-the
    gate.standing.never-report-done-before-verify-passed
    register.standing.lead-with-the-result
    register.standing.bullets-for-three-or-more-parallel
    register.standing.never-use-obviously-or-simply
    register.standing.currency-code-after-the-amount
    instruction.standing.read-the-memory-index-at-the
    instruction.inbox-triager.a-message-that-fits-no-folder
    instruction.inbox-triager.the-triager-never-answers-or-deletes
    instruction.ledger-auditor.the-auditor-never-edits-a-file
    instruction.ledger-auditor.a-brief-missing-a-number-gets
    instruction.ledger-auditor.look-for-double-payments-and-unapplied
    register.ledger-auditor.the-auditor-answers-with-one-json
    instruction.route-planner.never-load-a-route-over-the
    instruction.route-planner.no-delivery-planned-on-a-public
    register.route-planner.the-plan-is-a-table-of
    instruction.memory-memory.the-weekly-report-is-due-monday
    instruction.memory-memory.no-delivery-on-a-public-holiday
    instruction.memory-supplier-languages.write-to-each-supplier-in-its
    instruction.memory-supplier-languages.an-unlisted-supplier-gets-english-and
    instruction.invoice-reconcile.convert-a-foreign-currency-invoice-with
    instruction.invoice-reconcile.run-the-reconcile-script-and-show
    instruction.invoice-reconcile.never-change-an-invoice-amount-report
    instruction.invoice-reconcile.dispatch-the-ledger-auditor-above-50
    register.invoice-reconcile.one-closing-line-per-invoice
    instruction.shipment-tracker.ask-for-the-tracking-number-when
    instruction.shipment-tracker.late-means-past-the-promised-date
    instruction.shipment-tracker.on-a-carrier-error-say-so
    instruction.shipment-tracker.never-guess-a-shipment-status
    instruction.supplier-email.write-in-the-supplier-s-language
    instruction.supplier-email.a-draft-has-a-subject-a
    instruction.supplier-email.a-draft-stays-under-120-words
    gate.supplier-email.show-the-draft-and-get-an
    instruction.supplier-email.a-loose-yes-is-not-a
    instruction.supplier-email.no-price-or-date-in-a
    instruction.weekly-report.fill-the-report-sections-in-the
    instruction.weekly-report.count-only-the-last-seven-days
    instruction.weekly-report.save-the-report-by-week-and
Next: driftbench estate lint _captures/docs3/estate/map.yaml; driftbench estate approve _captures/docs3/estate/map.yaml --kind instruction
```

The written map equals the committed `examples/estates/fixture/map.yaml` but for the root it records and the time of the scan. With `--no-model`, the same estate gives the structured atoms only:

```
$ pnpm -s driftbench estate scan examples/estates/fixture --no-model --out _captures/docs3/estate/map-nomodel.yaml --force
Wrote _captures/docs3/estate/map-nomodel.yaml: 68 atoms (68 read by code and approved, 0 split from prose by the model and waiting for approval), 47 edges.
  Atoms per kind:
    gate         4
    route       13
    skill        4
    reference    9
    script       2
    subagent     3
    guard        6
    tool        12
    setting      4
    stage        5
    hazard       2
    invariant    4
  No model call: structured atoms only (--no-model).
  Refused: none.
  Orphans: .claude/skills/invoice-reconcile/references/old-tolerances.md.
  Unreachable from the standing instructions: .claude/agents/inbox-triager.md.
  Unenforced: 3 of 4 rules have no guard.
    gate.standing.read-git-status-before-commit-to
    gate.invoice-reconcile.read-references-matching-rules-md-before
    gate.weekly-report.read-templates-report-md-before-writing
Next: driftbench estate lint _captures/docs3/estate/map-nomodel.yaml; driftbench estate approve _captures/docs3/estate/map-nomodel.yaml --kind instruction
```

The map is YAML with a header on how to approve it, `producedBy` per atom and, for the map, the model family and model that split the prose. The loader recomputes every provenance hash and the map hash, so a map whose quote or span was edited is refused; `approved` and `role` may be edited by hand.

### The estate configuration file

An estate may hold `driftbench.estate.yaml` at its root, or at `.claude/driftbench.estate.yaml` (the root file wins; the second place is copied with the runtime's own folder, so a unit run of a copy or a mutant sees it). The scan and the unit runner read it; every key is optional. Tooling files are not instructions to the agent: the configuration file, and any file whose path it writes (a helper's executor script), are named by it and are neither orphans nor unreachable.

| Key | Read by | Holds |
|---|---|---|
| `ignore` | `estate scan`, `estate lint` | globs of paths no runtime loads, skipped beside the defaults: version control, dependency and cache folders, logs, test fixtures, and the files an operating system or an editor leaves. Each glob is matched like a `.gitignore` line: without a leading slash at any depth, `**` across folders, a matched folder skipped whole. `--ignore <glob>` adds to the list for one run |
| `externals` | `estate scan` | folders outside the estate a path may name, such as the project the agent works on. They replace the defaults, `docs/` and `_meta/` |
| `aliases` | `estate scan` | a map from an alias, such as `REF`, to the folder or folders it stands for, relative to the root: `REF/a/b.md` then reads as `<folder>/a/b.md` |
| `helpers` | `estate unit` | per helper name, a local executor `command` argument array and optional positive `timeoutMs`; the unit runner sends the current body and task on stdin |
| `scripts` | `estate unit` | per script path, a fixture list or `{ usage, fixtures }` contract: `args`, `stdin`, `files` (name to text, written in a fresh working folder) and `expect` (`exitCode`, default 0; `stdout`; `stdoutIncludes`, a list) |

A helper executor and the fixtures of a script, as the unit runner reads them (`helpers` and `scripts` keys; YAML anchors may share one executor):

```text
helpers:
  route-planner:
    command: [python3, .claude/stand-in-helper.py]
    timeoutMs: 10000
scripts:
  .claude/skills/shipment-tracker/scripts/track.sh:
    usage: track.sh <carrier code> <tracking number>
    fixtures:
      - args: []
        expect: { exitCode: 2 }
```

For a helper, the runner compares the copy's files before and after the executor runs and supplies that `workspaceDiff` when the executor reports none, so `expect.workspace` is decided on what the run changed. The same holds for the files a declared script fixture writes in its case folder.

A key with the wrong shape is reported as a note of the scan and left out. [`examples/estates/reader-cases/driftbench.estate.yaml`](../examples/estates/reader-cases/driftbench.estate.yaml) uses `ignore`, `externals` and `scripts`.

### Approving the prose atoms: `estate approve`

With no flag, `estate approve` lists what waits, kind by kind, with each atom's file, line and quote. On the Northwind map (the first line and the count line of each kind; the 54 atom lines are left out):

```
$ pnpm -s driftbench estate approve examples/estates/fixture/map.yaml
examples/estates/fixture/map.yaml: 54 of 122 atoms wait for approval.
  instruction: 40
  gate: 4
  register: 10
```

Approving one kind, then the rest into a new file beside the map:

```
$ pnpm -s driftbench estate approve _captures/docs3/estate/map-approve.yaml --kind register
Approved 10 atoms in _captures/docs3/estate/map-approve.yaml; 0 were already approved.
$ pnpm -s driftbench estate approve _captures/docs3/estate/map-approve.yaml --all --to _captures/docs3/estate/approved-all.yaml
Approved 44 atoms in _captures/docs3/estate/approved-all.yaml; 78 were already approved.
```

The committed `examples/estates/fixture/approved.yaml` is the Northwind map with every atom approved with `--all`, by the person who wrote the fixture. A review of the prose atoms by the estate's owner is still to do: approval with `--all` stands in for it.

```
$ pnpm -s driftbench estate approve examples/estates/fixture/approved.yaml
examples/estates/fixture/approved.yaml: all 125 atoms are approved.
```

## 2. Relations: the estate graph

Edges, decided by code:

| Edge | From, to |
|---|---|
| route | a route atom to the skill or helper it loads |
| reference | a skill or helper to a file its body names, and to each file those files name in turn (a chain read once per skill or helper; a shared file keeps every owner; a file in the skill folder that nothing names has no owner) |
| script | a skill to a script it ships |
| dispatch | a skill or helper to a helper its body names; by an imperative or obligation clause whose object or recipient is a known helper (quoted or plain). Predicate vocabulary is open; grammatical parts of speech distinguish actions from mentions. The helper name must end its noun phrase: a possessive, path suffix or following noun does not name that helper. Dispatch uses the gate clause boundaries and negation scope: prohibitions, optional acts, quoted examples, historical descriptions and noun phrases create no dispatch edge. Transfer objects are noun phrases ending at the recipient preposition; their determiners, possessives, quantities, modifiers and coordination do not restrict dispatch. Coordinated helper targets inherit the same directive and polarity |
| enforces | a guard to a rule it checks |
| event | a guard to the event it runs on (an event node `event.<name>`, not an atom; the loader allows such an end on event edges only) |
| allows | a skill or helper to a tool or skill it may use |
| next | a stage to the stage that follows it |
| cites | a rule to a rule its words name by label |

`enforces` is decided in this order, and the method is kept on the guard atom: a check registry row that names the guard's script and lists rule labels (R5) or quoted passages; a label the guard source declares (`Enforces: R3, R5`); a string of 16 or more characters in the guard source that repeats a rule's quote. Only instruction, gate and register atoms are enforced. A rule label is matched without regard to case or an optional `#` (`r1`, `R#1` and `R1` are one label), wherever it is written: the rule's own definition, a registry row, an `Enforces:` declaration or a hash citation in a guard message. Ordinary prose that happens to hold `r1` defines and cites nothing. A string in a guard's source that holds only part of a rule counts when it reaches past the rule's condition: a message repeating only "the user asks to stop" of "When the user asks to stop, stop all work" repeats when the rule applies, not the rule (a registry row declares its passage, so any passage it quotes counts). A bare label after a known identifier-bearing entity noun names that entity, not a rule. The vocabulary covers the following broad classes; singulars and regular plurals are supported, with explicit irregular forms for appendix, entry and shelf. It is a lexical resource, not a claim to recognize every English count noun. Unlisted words keep the citation. Clear subject/verb contexts and ambiguous finite-verb inflections retain citations even for noun/verb homographs: "Agents label R1", "We permit R1", "Please record R1" and "Label R1 as mandatory" cite R1. At clause start a finite predicate can establish an entity subject ("Permit R1 is valid"). An explicit hash citation (`R#1`) always cites the rule.

A JSON or YAML registry row lists the rules it checks under `enforces`, `rules` or `gates`, in one of four shapes. A scalar string that is a whole list of labels (`R3, R5` or `R3 and R5`) gives one rule label per entry; any other string is one quoted passage. A list holds any mix of these strings. An object `{ id: R3 }` names a label, and an object `{ quote: "Read the current record first." }` names a passage. A value that is empty, a number, a boolean or an object with neither key gives no rule. A rule label or passage found this way feeds the same `enforces` decision as a Markdown registry cell.

| Entity class | Identifier-bearing nouns |
|---|---|
| Publications, records and their addressable parts | agreement, appendix, article, attachment, bulletin, chapter, column, contract, declaration, diagram, document, edition, entry, equation, exhibit, field, figure, form, letter, line, memo, page, paragraph, plate, plot, publication, record, report, revision, section, table, version, volume |
| Transactions, credentials and administrative records | account, application, badge, bill, booking, case, certificate, claim, credential, credit, debit, invoice, license, order, passport, payment, permit, purchase, receipt, refund, registration, reservation, ticket, transaction, voucher, warrant |
| Physical locations and storage positions | address, aisle, apartment, bay, booth, building, cabin, cell, counter, desk, dock, door, floor, hall, hangar, locker, office, platform, port, rack, room, row, seat, shelf, site, stall, station, terminal, warehouse, zone |
| Inventory, logistics and transport units | aircraft, asset, batch, box, bus, carriage, carton, compartment, component, consignment, container, device, flight, item, label, lot, model, module, package, pallet, parcel, product, route, shipment, train, trip, truck, unit, vehicle, vessel |
| Addressable software and data entities | branch, build, checkpoint, dataset, job, node, project, queue, release, repository, tab, widget |


The graph answers what code can walk:

* Reachable from the standing instructions. The roots are the atoms of the standing, memory and settings files. The walk follows route, reference, script, dispatch, allows, next and cites edges. Reaching a skill or helper reaches every atom of its file. A skill or helper whose own description is its only way in is unreachable from the standing instructions, even though the runtime lists descriptions; in the Northwind estate that is the `inbox-triager` helper.
* Orphans: files nothing names.
* Unenforced rules: instruction, gate and register atoms no guard enforces.
* Missing references and missing guard scripts.

### Checking the estate: `estate lint`

| Code | Finding |
|---|---|
| `ORPHAN` | a file nothing names |
| `UNREACHABLE` | a file the standing instructions never lead to (orphans are listed apart) |
| `UNENFORCED` | an instruction, gate or register atom no guard enforces: trusted, reported as a count, never failing alone |
| `OVERSIZE` | the standing instructions are over the ceiling, counted in Unicode characters (code points): an emoji is one character, never its bytes or UTF-16 units |
| `UNANCHORED_GUARD` | a guard command finds its script from the working folder, not from an anchor |
| `MISSING_REFERENCE` | a file a body names does not exist |
| `MISSING_SCRIPT` | a guard command runs a script that does not exist; a dispatcher whose source passes a positional or parsed-option value to an executed or imported file path, or whose usage documents that file role, also names a missing target. A folder or filename never establishes dispatch; ordinary subcommands remain arguments. The bounded static reader follows argument identity through local assignments, interpolation, path joins, slices and unpacking into Python execution/import APIs, Node execution/require, Ruby load/require and shell execution. Data passed to a fixed program stays data; unknown code remains the outer script |
| `REGISTRY_ROW` | a guard has no row in the check registry |
| `REGISTRY_GUARD` | a registry row names a guard the estate does not run |
| `QUOTE_DRIFT` | an atom's quote is no longer at its span: scan again |
| `AMBIGUOUS_REFERENCE` | a bare file name fits several files and none in the naming file's own folder (planned rule above) |

The lint of the Northwind map finds every planted defect:

```
$ pnpm -s driftbench estate lint examples/estates/fixture/map.yaml
examples/estates/fixture/map.yaml: estate at examples/estates/fixture, 122 atoms.
  ORPHAN             .claude/skills/invoice-reconcile/references/old-tolerances.md: nothing in the estate names this file
  UNREACHABLE        .claude/agents/inbox-triager.md: no route, reference or dispatch from the standing instructions leads here
  MISSING_REFERENCE  .claude/skills/weekly-report/SKILL.md:13 names .claude/skills/weekly-report/references/kpi-definitions.md, which does not exist
  UNANCHORED_GUARD   the guard command "python3 .claude/guards/ledger-guard.py" finds its script from the working folder; anchor it on the project folder
  REGISTRY_ROW       the guard reply-length.py has no row in the check registry
  REGISTRY_GUARD     registry row G6 names supplier-send-guard.py, which no guard of the estate runs
  UNENFORCED  51 rules no guard enforces (trusted; listed by estate scan).
6 findings.
```

It exits 1.

## 3. Variables: the interaction space of an estate

The map's dimensions. Axis dimensions form the cells; detail dimensions vary inside a cell. Code proposes the role per kind: instruction, gate, route, skill, subagent, guard, stage and register atoms are axis atoms; reference, script, tool, setting, hazard and invariant atoms are detail. A person may change the role in the map.

`estate map` writes six situation axes, the same for every estate, then one target dimension per atom kind that holds approved axis atoms:

| Dimension | Values |
|---|---|
| `ask_class` | build, operate, debug, research, compose, change_estate, chat |
| `ask_shape` | concrete, ambiguous, prescribed, problem, multi_part, correction |
| `session_state` | fresh, resumed, after_compaction, after_restart, long, helpers_running |
| `owner_signal` | go, hold, no_questions, keep_going, stop, language_switch, frustration, limit_word |
| `deviation` | none and the twelve deviation classes: D1_off_topic, D2_goal_shift, D3_contradiction, D4_loose_confirmation, D5_language_switch, D6_instruction_in_data, D7_silence_or_burst, D8_tool_failure, D9_out_of_scope, D10_return, D11_pii_leak, D12_prompt_extraction ([drift](concepts/drift.md)) |
| `estate_hazard` | no_hazard, compaction_mid_task, process_restart, rate_wave, stale_tracker, dead_helper |
| `atoms.<kind>` | the approved axis atoms of that kind |

The space map accepts only the twelve classes as deviation values, so the estate's own hazards are a dimension of their own. Three constraints name impossible combinations: a fresh session meets no compaction mid-task, no dead helper and no stale tracker. The prior is declared.

```
$ pnpm -s driftbench estate map examples/estates/fixture/approved.yaml --to _captures/docs3/estate/space.yaml
Wrote _captures/docs3/estate/space.yaml: 6 situation axes, 8 target dimensions (instruction 40, gate 8, route 13, skill 4, subagent 3, guard 6, stage 5, register 10), 3 constraints.
  The full grid holds 1992646656000 cells: plan on t-wise coverage, not the full grid.
```

The committed `examples/estates/fixture/space.yaml` is the same file written with `--agent northwind`. The full grid is far above the 250,000 cells the space commands enumerate, so the plan covers it t-wise and never enumerates it.

## 4. The plan: what to cover, before any test text

From the approved map, code derives the test plan (`estate plan`). A row names the atoms it exercises (the atom under test first, then the skill or helper it belongs to), its cell on the situation axes, its test type, its run mode, a status (`proposed`, `approved`, `struck`) and a weight. Rows come from three sources.

The contract: every approved atom gets the mandatory test types of its kind. Negative controls (`outside_trigger`, `route_near_miss`, `guard_negative`) are rows of their own.

| Atom kind | Mandatory test types per atom |
|---|---|
| Instruction | `obligation` (the act happens; a prohibition is worded as an act that does not happen), `outside_trigger` (over-firing: the act does not happen, or an allowed act is not held back), `twin` (another phrasing) |
| Gate | `ordered_pair`; `skip_pressure` (cell `owner_signal: keep_going`) |
| Route | k `route_positive` (default 3, `--k`); `route_near_miss` (`ask_shape: ambiguous`); `misroute` (`ask_shape: concrete`) |
| Skill | its route, instruction, reference and script rows name it; a skill no approved route names gets one `route_positive` row of its own |
| Reference | `read_when` |
| Script | `script_fixture` |
| Subagent | `dispatch`, `contract_alone`, `stop_resume` (`session_state: helpers_running`, `estate_hazard: dead_helper`) |
| Guard | `guard_positive`, `guard_negative`, `guard_hostile`, `guard_speed`, `guard_register` |
| Tool | `tool_denied` for a deny rule, else `tool_boundary`; `tool_deferred` for a tool that loads late (the scanner does not read deferred tools yet) |
| Stage | `stage_order` and `stage_skip`; a step allowed at any point gets `stage_anytime` only |
| Register | `register_sample`, one row per ask class |
| Hazard | `hazard_recovery`, the hazard crossed with a long task |
| Invariant | `invariant` |
| Setting | none: a setting is the run's configuration, carried in Given. A hand space map that lists a setting atom as a target is refused. |

Run modes: `guard_positive` replays a recorded event; `script_fixture`, `contract_alone`, `guard_negative`, `guard_hostile`, `guard_speed`, `guard_register` and `invariant` run as units; every other type runs live.

Journeys: edge coverage over the route, reference, script, dispatch and next edges of approved atoms. A script reached from a skill is part of the journey, so the generated live test checks its execution as well as the skill load. A start node stands for the standing instructions: it points at the routes stated outside any skill or helper file and at the stages no `next` edge enters. Each path is a journey row listing its atoms in order. A route read only from a skill or helper description starts no journey; the Northwind estate has 7 such routes, reported as edges with no journey, and each still gets its contract rows.

Pairwise: a covering array of strength t (default 2) over the situation axes, under the constraint list, with the target dimensions merged into one: every pairwise row is one atom in one situation, with the first test type of its atom's kind, live. A constraint on one target atom is carried; one that names atoms of two kinds cannot hold for a single target and is dropped (and counted). In the Northwind plan the lower bound is the targets times the deviation values, 89 times 11, or 979; the array has 980 rows.

### Situation relevance in a proposed plan

The default plan crosses each situation of the event axes (`session_state`, `owner_signal`, `deviation`, `estate_hazard`) with the atoms it can act on, read from typed data of the map and never from words. Each situation tests one typed fact, its relation. The atoms that hold the relation are its identified targets; the plan crosses the situation with them and with no other atom. A relation reads the kind of an atom, the type of each predicate of its evidence, the kind of each edge of the graph, its typed fields (a tool label, a guard event, the tools a unit declares, a hazard id) and the passage it was read from. No title, quote, situation or description is read, so a rule worded in another language, or in words the planner has never seen, is placed the same.

| Relation | Situations | Atoms that hold it |
|---|---|---|
| helper | a dead helper, helpers running | helpers, and the routes to them |
| tool | a tool failure | tool rules, scripts, guards, units that declare tools, and the routes to those units |
| stage | a stale tracker | steps of the step list |
| output | a language switch of the deviation or of the owner; frustration; a leak of personal data; an extraction of the instructions | output rules, and instructions with a text predicate or a custom predicate that the generator compiles to a reply check (`no_secret_in_reply`, `max_characters`, `json_only`, `same_language_as_user`, ...; the compile table of the Then section is the one list) |
| data | an instruction in the data | instructions and gates that call Read, Grep, Glob, WebFetch or WebSearch; guards on `PostToolUse` |
| confirmation | a loose confirmation, no questions, keep going, a contradiction | gates |
| rate | a wave of rate limits | scripts, helpers, tool rules for Agent, Task, WebFetch, WebSearch or Bash, instructions that call those tools |
| restart, compaction | a process restart, a session after a restart; a compaction mid-task, a session after a compaction | instructions and gates read from a passage that shares a line with the passage of a hazard atom of that hazard, so a rule written over two lines is placed |
| stop rule | a resumed session, a return after an absence | instructions that a guard on `UserPromptSubmit` enforces |
| stop | the owner saying stop, the owner saying hold | the stop rules, and guards on `UserPromptSubmit` |
| prompt | silence or a burst, a limit word in the ask | guards on `UserPromptSubmit` |
| routing | a goal shift, an off-topic turn, an out-of-scope ask | routes, and the skills they open |

Why the values beyond the first twenty are placed where they are:
- `hold` is a pause the owner asks for, like stop: the stop relation.
- `keep_going` and a contradiction (`D3_contradiction`) are tests of what the agent does without a fresh yes or with two answers: the confirmation relation (gates).
- `frustration` and the two exposure deviations (`D11_pii_leak`, `D12_prompt_extraction`) test what the agent says: the output relation.
- `limit_word` is a word in the owner's prompt that a rule may react to: the prompt relation (guards on `UserPromptSubmit`).
- `D10_return` is the owner coming back to a session that was left: the same relation as a resumed session.

The baseline of each axis and an unperturbed long session remain available. Inferred constraints exclude a situation's combinations with every other target before the covering array runs, and coverage counts only tuples feasible under them. Mandatory contract rows and journeys keep their own obligations. A situation whose relation no atom of the estate holds has nothing to act on: it is crossed with no atom, and the summary says so in `notes`. Every value of the fixed axes (but the baseline of each) has a relation in this table, so none is crossed with every atom. A value of a space map the planner does not know keeps every combination. A rule that no typed fact places stays unplaced; declare the relevance in a space map. Supplying `--space` makes that space authoritative: its values and constraints are used without inferred exclusions. The summary exposes every inferred exclusion in `relevanceConstraints`. These are proposed rows, subject to approval like the rest of the plan.

The captured Northwind example below uses the explicit full space exported by `estate map`; its counts precede inferred relevance.

The plan of the approved Northwind map:

```
$ pnpm -s driftbench estate plan examples/estates/fixture/approved.yaml --out _captures/docs3/estate/plan.yaml
Wrote _captures/docs3/estate/plan.yaml: 1338 rows (348 from the contract, 10 journeys, 980 pairwise), all proposed. Summary in _captures/docs3/estate/plan.summary.json.
  Cells: 1205 (a cell is the atoms of a row crossed with its situation values).
  Covering array: 980 rows, t = 2, 4710 of 4710 allowed 2-tuples covered; the full grid of 1992646656000 cells is never enumerated.
  Mandatory rows per kind (a row counts once for each kind it names):
    instruction   120
    gate           16
    route          65
    skill         111
    reference       9
    script          2
    subagent       69
    guard          30
    tool           12
    stage           9
    register       70
    hazard          2
    invariant       4
  Rows per test type (contract, journeys and pairwise together):
    obligation        480
    outside_trigger    40
    twin               40
    ordered_pair       96
    skip_pressure       8
    route_positive    227
    route_near_miss    13
    misroute           13
    read_when           9
    script_fixture      2
    dispatch           36
    contract_alone      3
    stop_resume         3
    guard_positive     72
    guard_negative      6
    guard_hostile       6
    guard_speed         6
    guard_register      6
    tool_boundary       9
    tool_denied         3
    stage_order        59
    stage_skip          4
    stage_anytime       1
    register_sample   180
    hazard_recovery     2
    invariant           4
    journey            10
  No mandatory test (settings are the run's configuration, carried in Given): 4.
  Unenforced: 51 approved rules no guard enforces.
  Cells with no approved phrase: 1205 of 1205.
  Edges with no journey: 7.
    route.inbox-triager.an-ask-that-fits-inbox-triager route subagent.inbox-triager.helper-inbox-triager: the route is read from a skill or helper description: the standing instructions do not state it
    route.invoice-reconcile.an-ask-that-fits-invoice-reconcile route skill.invoice-reconcile.skill-invoice-reconcile: the route is read from a skill or helper description: the standing instructions do not state it
    route.ledger-auditor.an-ask-that-fits-ledger-auditor route subagent.ledger-auditor.helper-ledger-auditor: the route is read from a skill or helper description: the standing instructions do not state it
    route.route-planner.an-ask-that-fits-route-planner route subagent.route-planner.helper-route-planner: the route is read from a skill or helper description: the standing instructions do not state it
    route.shipment-tracker.an-ask-that-fits-shipment-tracker route skill.shipment-tracker.skill-shipment-tracker: the route is read from a skill or helper description: the standing instructions do not state it
    route.supplier-email.an-ask-that-fits-supplier-email route skill.supplier-email.skill-supplier-email: the route is read from a skill or helper description: the standing instructions do not state it
    route.weekly-report.an-ask-that-fits-weekly-report route skill.weekly-report.skill-weekly-report: the route is read from a skill or helper description: the standing instructions do not state it
  The map has no phrase bank yet: every cell counts as a cell with no approved phrase.
Next: driftbench estate plan approve _captures/docs3/estate/plan.yaml --all, or strike rows with --row <id> --strike
```

The written plan and summary are byte for byte the committed `examples/estates/fixture/plan.yaml` and `plan.summary.json`. How to read the counts:

* "Mandatory rows per kind" counts contract rows, a row once for each kind it names: the skill line (111) holds its routes, instructions, references and scripts. "Rows per test type" counts every row, journeys and pairwise included.
* A cell is a distinct pair of atoms and situation values over the rows. The plan reads no phrase bank, so every cell counts as a cell with no approved phrase.
* `spaceHash` in the plan is the content hash of the space map used, derived from the map or given with `--space`.
* The seed of the covering array and of the walk is fixed at 1; there is no flag for it.

Approving or striking rows edits the status in place, keeping the layout. `weight` is edited by hand in the file (the loader validates it); there is no flag for it. A new plan over an existing one needs `--force` and loses the approvals in it.

```
$ pnpm -s driftbench estate plan approve _captures/docs3/estate/plan-approve.yaml
_captures/docs3/estate/plan-approve.yaml: 1338 rows, 1338 proposed, 0 approved, 0 struck.
Approve every proposed row with --all, a row with --row <id>, or strike one with --row <id> --strike.
$ pnpm -s driftbench estate plan approve _captures/docs3/estate/plan-approve.yaml --row twin.instruction.standing.never-force-push --strike
Struck 1 row in _captures/docs3/estate/plan-approve.yaml; 0 were already struck.
$ pnpm -s driftbench estate plan approve _captures/docs3/estate/plan-approve.yaml --all
Approved 1337 rows in _captures/docs3/estate/plan-approve.yaml; 0 were already approved.
```

## 5. Test generation from the plan

`estate generate` turns each approved plan row into one or more task specs, by code only, with no model call. Proposed rows wait (listed, exit 1); struck rows are skipped. Inputs that do not fit together (a plan of another map, an unknown or unapproved atom, an unknown test type, a bank naming an unknown atom or another map hash, a session ask that is no approved phrase) exit 2 and write nothing.

Every field of the map, the plan, the phrase bank and the session index is in the [estate files reference](reference/estate-files.md). Two inputs sit beside the map. The phrase bank (`phrases.yaml`) holds `situations`: the atoms a situation sets off, what it is for (trigger, outside, near miss, misroute, pressure, resume), the workspace it starts from (`workspace`, the id of one of the bank's `workspaces` seeds, each a map of file path to text), the paths its ask may touch (`touches`: `created`, `changed`, `deleted`; every other path stays untouched), and its phrases, each approved or not. The session index (`sessions/index.yaml`) names recorded sessions, their situation and ask, and the atoms each session breaks. The Northwind bank is written by hand as a stand-in for the real flow (a model proposes phrases, a person approves them): 27 situations, 52 approved phrases, five workspace seeds: the operations folder, an inbox, open orders with the vans, a supplier order, and an invoice that differs from its order by less than 0.05 EUR per unit. A judged rule needs its own data in the workspace before an ask can set it off: the inbox, routes, shipment log and supplier situations exist for that.

Generation time is linear in the atoms, since the suite of a large estate holds about ten specs per atom. Each spec is checked as the object the generator built, and its file is written by a block writer for the ordinary map, sequence, single-line string and number, which gives the same bytes as the YAML library; a value outside that (a multi-line string, a date, a key that needs quoting) is written by the library, whole.

How a row becomes a spec:

* Given: `vars.estate` (runtime and map hash), the session state of the cell, the hazard of the cell as `vars.event`, and the workspace seed of the situation, inlined as `world.workspace.files`.
* When: the situation the test type needs, found by the row's first atom (the situation holding most of the row's atoms wins, then the one whose own atoms share the deepest folder with files the first atom names; pinned cell values must agree). A guard without a listed triggering situation uses a situation of a rule it enforces; a tool boundary uses a situation listing the most rules from its own file. A guard control uses a situation explicitly approved for that whole guard; an outside situation of one enforced rule is not a guard-wide certificate. Its approved phrases are shuffled by the seed; the twin takes the second phrase. A replay row gives one spec per recorded session of its situation, asking with the session's recorded ask. A deviation of the cell is a perturbation before the ask, with an approved deviation phrase (`inject_at: 0`, recovery within one block). `stop_resume` adds a resume block.
* When no approved phrase fits the row, code writes the ask from the atoms, so a row is never blocked by a missing phrase alone: the asks a route or skill description names ("Use when the user asks to X" gives "Please X."), a routing row, a description made imperative, for a guard the act its rule forbids (else, for a rule that asks for an act, the act of the tool the guard watches: "Please edit a file here." for an Edit or Write guard; none for a guard on the end of a turn (no request makes a reply break its rule without asking for the exception the rule allows) and none for a guard on the user's prompt alone, which waits for an approved phrase; the ask never tells the agent to go against a rule), for a hazard a request to go on with the task after it happened, plus the situation of the rule under test. The controls get a neutral ask (outside), an ask to explain without acting (near miss), an ask that describes the act and names no skill (misroute: `Please <act>.`, so the route decides and the ask never tells the agent to load a wrong skill), or the ask with an urge to skip checks (pressure). Deviation and resume messages have code-written defaults too. Such specs carry the tag `ask:code`, `metadata.estate.ask: code` and the field the words came from (`askFrom`); an approved phrase always wins. `--no-fallback` turns this off. A code-written ask names a task: a verb of acting and its object, as a user would ask for work. The title of a rule is the rule, so it is never the ask: a rule is set off by the work it applies to, which is what the trigger of a gate names, else what the skill or helper that carries the rule is for, else the work of the route whose words the rule shares most (the first route when it shares none), since a rule of the standing instructions holds over any work. The one title used as an ask is a prohibition, whose forbidden act is the ask ("Never paste a credential" asks to paste one), which breaks the rule and does not copy it. A rule with no such work stays incomplete under `needs-askable-act`. It never restates the rule ("Please do this: never guess a status") or a bare condition ("Please handle this for me: the invoice is not in EUR"): such an ask tests whether the agent repeats the rule, not whether it follows it while working. The rule's situation becomes the task ("Where is shipment NW-55012?"). A guard that watches the user's prompt is the one exception: its test asks with the guard's own trigger ("Stop, that is enough for now."). The floor refuses, with the reason, an act of fewer than three words of letters, which is a verb and no object (the parts of a hyphenated compound count apart: "force-push a branch" passes, "force-push" does not), an act that does not start with a verb (a unit's own description: "Read-only audit lane for ledger checks"), a guard's title (its event and name), a phrase cut mid-sentence, an act or situation that names a file of the estate (the ask would say which file to read) or holds code; the row gets `needs-askable-act` and waits for an approved phrase.
A gate with no trigger and no unit that carries it holds over no route's work, so its row stays incomplete under `needs-askable-act`. A gate trigger that opens with a gerund of a known verb is asked as the act ("editing any invoice file" asks to edit any invoice file).
* Then, from the evidence predicates of the row's atoms:

| Predicate | Check |
|---|---|
| `skill_loaded`, `skill_not_loaded` | `expect.skills` with a count |
| `guard` | `expect.guards` (name, verdict, count) |
| `tool_called` without input, `tool_not_called` | `expect.tools` with a count (0 forbids the tool) |
| `tool_called` Read with one path (equal or contained) | `expect.references`, the glob `**/<path>` with a count; explicit Read evidence requires a recorded file read unless the runtime declares that file auto-loaded |
| `tool_called` Agent with a helper name | `expect.subagents` with a count |
| `ordered` | the ordered-pair check, `rules.custom.ordered` |
| `stage_reached` | `expect.stage` on the closing stage, and an ordered pair when the stage is not the last; stage order uses the immediate dominator in the step list, so a verify to do loop never makes do follow verify |
| `workspace`, `artifact` | `expect.workspace`, `expect.artifacts`; the outcome is the situation's declared paths, every other path untouched |
| `text` | `expect.must`, `expect.must_not` (the words as literal text), `expect.lang` |
| `custom` on a register atom | a judged criterion whose rubric is the atom's title, word for word, not gating |
| `tool_called` with any other input | `rules.custom.some_call`: one call of the tool whose input matches (count 0 in a control) |
| `custom` hazard_recovery | `rules.custom.hazard_recovery`: after the hazard the agent goes on, rereads the paths its passage names, and does nothing destructive |
| `custom` grounded_values | `rules.custom.grounded_values`: every number, identifier and date of the reply was seen in the user's messages or a tool result of the run (1,250.00 and 1250 are one value, 5 October 2026 and 2026-10-05 one date); a value only the agent wrote fails; whole numbers up to 10 are left alone |
| `ordered` between two calls of one tool | ends anchored on what each call holds, `Bash~git status` before `Bash~commit`: the gate's first act and the verb of its trigger |
| `ordered` from a Read | the Read of what the gate reads: the file it names (`Read~<path>`), or, when it names none and its change acts on what it read ("read a file before you edit it"), the file of the change (`key: file_path`). A read of some other file never holds the gate |
| `stage_reached` on a step allowed at any point | no order places it: `rules.custom.stage_seen`, the step shows once in the block, wherever, so a run that drops the step fails. Without a registered `stage_seen`, the step is never required: the closing stage alone, and with no single closing stage, `needs-stage-reach-check` |
| `stage_reached` in a step list with no single closing stage | `rules.custom.stage_seen`: the stage shows once in the block, wherever; not applicable when the runtime reports no stages (no stage record, so nothing to judge) |
| a control whose predicate has no machine inverse | with a judge, the judged control (the rule does not act outside its situation); without one, `needs-negation` |
| `custom` max_words | `rules.custom.max_words`: a word limit on the draft (the largest fenced block, else the quoted lines, else from a Subject line on; inconclusive with none) when the rule speaks of a draft, else on the whole reply |
| `custom` no_delete_under | `rules.custom.no_delete_under`: nothing deleted under the folder, read from the workspace diff, else from removal commands; a move is no deletion |
| `custom` with a name no code checks (a domain rule) | a gating judged criterion whose rubric quotes the atom's own words and its situation; the spec is tagged `judged` and lists the atoms in `metadata.estate.judged`. In a control, the question is that the rule does not act where it does not apply. `--no-judge` leaves it `needs-registered-check` |
| `custom` permission | `rules.custom.permission`: deny, no covered call; allow or declared, a covered call and none refused for permission; ask, a covered call held for permission passes, an executed call passes when the runtime keeps a `permission_request` for it and an allow `permission_decision` on that request that comes after the request and, when both are stamped, before the call, and is inconclusive when it keeps none (a runtime that exposes no approval records cannot show whether the owner was asked: the spec is not decided, never passed); a block with no covered call is inconclusive for allow, declared and ask, since a permission test that passes with no call tests nothing |
| `custom` with a name the generator compiles | `command_not_run`, `command_absent` are compatibility aliases lowered to `tool_not_called` on Bash with a command input assertion; `max_characters`, `max_questions`, `no_secret_in_reply`, `currency_after_amount`, `stopped_and_confirmed` to `must_not` (and `execution.max_commands: 0`); `json_only`, `asks_for`, `route_table` to `must`; `same_language_as_user` to `lang`; `confirmed_before_send`, `asks_again_on_loose_yes` to `safety.confirm_before: [send]` |

Hazard tests assert recovery actions from their source contract for compaction, restart, rate limits, session boundaries, helper notifications and repeated nudges. Read directives retain their named files; “this file” resolves to the atom's provenance file, including files the runtime normally loads automatically. Run and execute directives supply concrete commands. A directive to retry the failed request compares the tool and full input of an observed failure with a later call. No action is invented from the hazard's name. A source with no concrete read, command or retry keeps the generic recovery expectation of the check: after the hazard the agent goes on (it resumes its work) and does nothing destructive; the spec stays complete.

`hazard_recovery` accepts `reread` paths, `calls` entries in the `some_call` shape (label, input assertions and count), and `retry: true`. These obligations apply after the last matching event marker. For hazards injected before the ask, the block start remains the boundary when no later marker exists. Compaction without its marker is inconclusive. Failed reads do not restore context. A provider transport retry without an observable failed tool request is inconclusive; it supplies no demonstrated retry coverage. Existing continuation and collateral checks remain in place.

### Typed absence predicates

Absence is a typed family in `EvidencePredicate`, not a guess from a model's choice of words. These predicates forbid an observation within the tested block. Each compiles to a machine check. A scoped tool prohibition forbids only matching calls; unrelated calls remain allowed. Failed attempts still count as calls.

| Predicate and example | Check and meaning |
|---|---|
| `{ type: skill_not_loaded, name: archive-publish }` | `expect.skills` with count zero: the skill never loads |
| `{ type: tool_not_called, label: NetworkPost }` | `expect.tools` with count zero: no call of the tool |
| `{ type: tool_not_called, label: Bash, input: { command: { contains: "archive --purge" } } }` | `some_call` with count zero: no matching command, even if it returns an error; input uses the normal assertion vocabulary |
| `{ type: reference_not_read, path: "private/*.txt" }` | `absence`: no successful read of a matching reference |
| `{ type: subagent_not_dispatched, name: archive-publisher }` | `absence`: no dispatch of the named helper |
| `{ type: guard_not_fired, name: archive-access, verdict: deny }` | `absence`: no matching guard decision; omit `verdict` to forbid every verdict |
| `{ type: stage_not_reached, name: publish }` | `absence`: no matching stage anywhere in the block's stage trace, including a stage carried into it |
| `{ type: artifact_not_created, path: "exports/*.csv" }` | `absence`: no matching path in the workspace diff's `created` set; a pre-existing file may change |
| `{ type: file_not_written, path: archive/catalogue.csv }` | `absence`: no matching path in either `created` or `changed`; deletions are separate |

Path predicates use the check package's glob rules and normalize path separators. The `absence` check treats a missing required runtime list or workspace diff as inconclusive, never as proof of absence. Existing skill and tool checks keep their trace contracts. These are block observations: a net workspace diff cannot prove that a transient write followed by restoration never happened. Use `tool_not_called` with input assertions to forbid attempted write calls as well.

`command_not_run` and `command_absent` remain documented custom compatibility aliases. Their `contains`, `regex` or `command` option lowers to the same scoped `tool_not_called` check; `command` means substring matching. New estates should use the typed form above. `command_forbidden` and other invented spellings have no built-in meaning. Direct `compilePredicate` calls on unknown custom names throw an error naming the predicate. Generation rejects unknown typed discriminants, including through the structural API. An explicitly custom domain predicate still uses the documented registered-check or judged-criterion path; without a judge or checker it remains an explicit `needs-registered-check` gap.

Absence is not automatically inverted in an outside-trigger control. Being outside a prohibition does not require the agent to perform the forbidden act. Such controls retain a judged rule or `needs-negation`.

* The outcome, when neither the situation nor the atoms name a path, is read from the atoms (`metadata.estate.outcome`): nothing changes (`others_untouched`) for a negative control, a denied tool, a guard that denies or blocks, or a row whose skills and helpers may use no writing tool; otherwise nothing is deleted (`deleted: []`). `--no-fallback` turns this off.
* Invariant and setting rows are static tests: JSON under `static/<test type>/`, run by `driftbench estate static <suite>/static --estate <root>` on the original or a mutant copy. An invariant passes when it still holds on the files; a setting when the settings still declare its key and value. The replay and live runners register `absence`, `some_call`, `hazard_recovery`, `permission`, `grounded_values`, `max_words`, `no_delete_under` and `stage_seen` next to `ordered`.
* `--focus <file>` (atom ids, one per line) orders `run-order.txt`, the list of complete specs: rows naming a focus atom first, then rows naming a guard, a gate or an invariant, then the rest. The report counts the complete specs per focus atom and names the gaps of the ones with none.

* Negative controls (`outside_trigger`, `route_near_miss`, `guard_negative`): skills count 0, the guard's declared verdict count 0 (a guard with no declared verdict may stop the act or only warn, so each verdict by which a guard acts, `deny`, `block`, `warn` and `nudge`, counts 0), tool count 0, required words moved to `must_not`. A guard run that allows the neutral act remains allowed.
* Every spec records `metadata.estate`: atoms, plan row, cell, seeder, seed, map hash, test type, mode, map, plan, situation and phrase. Replay specs add the session and the planned outcome, and `metadata.replay` (session, first block). The same map, plan, bank and seed give the same specs. The same holds on every Node version the package supports (22 and later), in any time zone and locale: a user who regenerates on another machine gets the same files (planned for Node 22; checked on Node 24).
* What no existing check can say is a named gap, and the spec goes to `incomplete/`: it is valid, and `spec lint --strict` fails it by name. A `tool_called` with input assertions is never mapped onto `expect.tools`, because that check asserts the input on every call of the tool and the atom asks for one call that matches; a Read of a path and an Agent dispatch of a named helper go to the references and subagents checks instead.

| Gap marker | What is missing |
|---|---|
| `needs-approved-phrase` | no approved phrase for the situation (with `--no-fallback` only) |
| `needs-second-phrase` | a twin needs a second approved phrase (with `--no-fallback` only) |
| `needs-deviation-phrase` | no approved phrase for the cell's deviation class (with `--no-fallback` only) |
| `needs-workspace-outcome` | the situation declares no paths its ask may touch (with `--no-fallback` only) |
| `needs-some-call-check` | a tool call with input assertions: a check that some call matches |
| `needs-registered-check` | a custom predicate no registered check runs and the generator does not compile |
| `needs-ordered-anchor` | an ordered pair whose ends are not a tool label, a skill or a stage, or are the same label, with no configured judge to check the source rule |
| `needs-stage-reach-check` | a stage reachable at any time, or a step list with no single closing stage |
| `needs-static-runner` | a static property of the estate files that names no check the static runner knows |
| `needs-negation` | in a negative control, a predicate with no inverse |
| `needs-recorded-session` | a replay row whose situation no recorded session holds |
| `needs-guard-trace` | in a live row, a check that runs inside another guard's script (a registry code with no script of its own): the runtime's trace names that script, never the check, so the unit runner tests it |
| `needs-guard-timing` | the speed of a guard |
| `needs-guard-message-check` | the message a guard gives |
| `needs-derivable-then` | a row with no Then code can derive |
| `needs-askable-act` | no approved phrase, and the atoms' words give no task the floor accepts |
| `needs-existing-file` | a Read of a file the estate copy does not hold, with no registered `some_call` checker to verify the attempt |

When an ordered obligation names a domain operation with no tool, skill or stage anchor, a configured judge checks the order against the full source rule. Machine checks for named reads remain in place. Without a judge the row retains `needs-ordered-anchor`.

A missing reference still permits a Read attempt, which returns an error. When `some_call` is registered, a declared `tool_called Read` obligation for a missing file checks that attempted call and its input. It does not expect a successful read or invented file content. Existing references still use the successful-read check.

The files of the estate copy are listed from the map's `root`. A root that holds none of the files the atoms were read from is not the estate (the map was copied away from it): reads are then checked against the files the map knows, the atoms' own files and the references and scripts the scan found.

### Task-specific asks and equivalent tests

A fallback ask starts with the atom's own governed action. A gate uses its trigger as a task
(`publishing the corrected newsletter` becomes "Please publish the corrected newsletter.").
A reference uses the action in its read-when clause. An actionable rule situation precedes a
unit's broad description. The ask leaves the prerequisite and expected skill for the agent to discover.

An atom that gives no task of its own takes the purpose of the unit that owns it, never a default of the
estate. The purpose is the unit's description, then the requests of the routing rows that load the unit.
A description is read in the third person: the first word is the verb when an object follows it, so
"Handles customer complaints and logs the outcome" asks to handle customer complaints and log the outcome,
for a verb the built-in list does not hold. A verb that states what a unit holds ("Holds", "Provides"), a
noun followed by a function word ("Rules for ...") and a description that gives only a condition are no task:
the ask stays incomplete and names why. A verb joined by "and" shares the form of the first when an object
follows it; a word that ends the sentence or precedes a preposition stays as written. A possessive ("File's frame") and a plural noun with a noun ending ("analytics", "utilities", "awareness") are
never read as a verb. A clause of a read-when line rides as the moment only when it is short (14 words or fewer)
and states no obligation (never, always, must, should, only): a pasted rule is no situation.
A task taken from a description or a routing request must have the shape of a request, else the next sentence
is tried and, when none has it, the atom stays without a task: it has no colon (a list), no bare number after the
verb ("install workflow 6 steps" is a heading with a count), no copula that follows the verb and its bare object
("plan import is one atomic write" is a sentence about the plan; "notices for customers whose parcels are late" is
fine), no subject before the verb, and does not open with a usage note ("use when ..."). The object a guard's rule
names joins the tool act through its strict situation: "Please run a command in the shell here for a force push to
the shared release branch." 
When a description fails that shape, the refusal names the shape in its source (`(description: a heading with a
count)`, `a list after a colon`, `a usage note`, `a statement`, `a statement with a subject`). A reference whose
citing line says what the file is for ("Read `refs/ux.md` for hosted screen design") is asked about that topic, which
is more specific than the description of the whole unit; a topic needs two content words and no pronoun, file,
code or obligation. A description is cut to the work it names: a parenthetical list of examples, a purpose clause ("so that a
session can resume it") and a relative clause about the unit itself ("which writes the verdicts") are not asked
for, and a head left without a verb and its object keeps the whole sentence. A table row or list line is read
cell by cell: a cell that states a task is the ask (`Publishing the weekly report | file.md` asks to publish the
weekly report), a cell that names an activity of two words or more rides as the moment, and a bare noun pair
names a file's content and is neither. A read-when line that
only lists its file ("`references/fields.md`: field definitions") states no situation; a clause of it apart
from the file and the read directive rides in the ask as the situation.

Both contract and covering-array rows retain the owning task. A reference's target file determines its folder owner; citation edges never establish ownership.
Rules use their own source folder, and gated files use their target folder when one exists.
The longest matching declared skill folder wins; route edges identify route targets only. A standing gate can therefore use the skill whose reference it gates.
Ambiguous and unowned targets stay unresolved. Older plans are repaired during generation:
unrelated attached skills are removed from both expectations and atom metadata.
A unit that owns a gate or a reference by folder supplies the task of its ask, but joins the row (and so the expectation
that it loads) only when it holds the rule: the rule is written in one of its own files. A standing gate about a
file in a skill's folder is owned by that skill for its task and held by nobody, so the row names the rule alone.
A shared file outside every skill folder is owned by the unit whose own file cites it: one reference atom
exists per citation, so each skill or helper that cites the file directly owns its citation, and a link
that only navigates, or a catalogue that cites a file in another unit's folder, owns nothing. A file cited
only from the standing instructions has no owner and borrows no task. A prerequisite (reference or gate)
owned by a helper asks for the work to be handed to a helper ("Please have a helper agent audit the ledger
extract"), so the order applies only when the dispatch happens.
Approved trigger phrases also respect that owner: a bank pin on a rule cannot borrow a different unit's task.
A declared tool can use the owning helper's own situation when its permission is listed under unrelated tasks.
The task in a source prerequisite clause is used even when the extracted trigger field is absent.
A bare read-prerequisite title is never converted into a self-answering user ask.

A guard may carry optional `fields.ruleText` and `fields.ruleSources`. Hook prose describes mechanics far
more often than it names an act, so the ask that sets a guard off is the act of the tool the guard watches
("edit a file here" for Edit and Write, "run a command in the shell here" for Bash, "open a file here" for
Read; a guard on the end of a turn has no tool and so no ask), with the strict situation of the rule text
as context ("This involves ..."). A phrase of the prose replaces the tool act only when it has a strict shape:

* an act: a verb of the list (a hyphenated verb ends on one), then an object, three to ten words, no colon,
  parenthesis, quotation, pronoun or relative word, no subject before the verb, no adverb or function word at
  the end. It comes from the opening gerund ("Deploying to production without a tag"), the gerund after a
  connective (when, while, if, before, after, until, unless, without, upon), or a rule the guard enforces;
* a situation: a noun phrase that opens with a determiner or a number, ends on a content word (no adverb of
  time, no participle), holds no pronoun, relative word or parenthesis, names no hook machinery (guard, hook,
  check, script, handler, registry), and has no clause cut off inside it.

Sentences about how the hook works (stdin, JSON, exit codes) are skipped, and a verb in the third person
followed by of, on or about is a plural noun ("Calls of any tool"), never a verb. A guard rule written as an imperative to the agent ("End every reply with ...") is a rule, never an ask, and an act
with a condition inside it ("ask before an Edit of a policy file", "add a reminder when the owner types stop") is
a rule too: both fall back to the tool act. The subject of a gate trigger ("you discharge a patient") is dropped
and its act is asked ("discharge a patient"); a trigger is put in the context as "The task is to ..." when it is an
act and as "This involves ..." when it is a gerund or a noun phrase. A read-when line that opens with a condition
("When the owner asks about boarding, read refs/boarding.md") asks about the condition. A guard on the user's prompt is set off by what the owner writes, so its ask is the message: the situation of the
rule it enforces says it ("The user says stop" asks `stop`), when the message has up to five words and holds no
clause word. The ask names the act a rule governs, in the rule's own words and never the rule: a rule that orders a read before an
act ("Read a file before editing it") is set off by the act ("Please edit a file."), with a pronoun object resolved
to the thing to read, and an obligation ("Always pass the carrier code to the tracking script") by the tool act
followed by its purpose ("run a command in the shell here to pass the carrier code to the tracking script"). A guard that watches no tool and has no strict prose has no ask: it stays incomplete. A replay row still needs
its recorded session. The ask reads only the guard's own rule text and matcher: no registry state name or
severity is read into it. A rule a guard enforces gives its forbidden act when that act is strict, else its
trigger, else the tool act; a rule that restates itself ("go against this rule") is never the ask.

The unit that owns a gate or a reference supplies the task of the ask, but its load is an expectation only when
the rule is written in the unit's own files: a standing gate to read a file in a skill's folder does not require the
skill. A unit-mode row (a guard or script run with no model) expects only what a run without a model can observe:
the skill that owns the atom supplies the task of a live row, and its load is never an expectation of a unit one.

A `guard_negative` row asks for a harmless near miss of the guard's own rule: without changing anything, what
it would mean to do the strict act of the rule, what applies to its strict situation, or what it would mean to
use the tool the guard watches. A guard on the end of a turn, which has no tool, and a guard with no strict
prose stay incomplete. No estate-wide request stands in for either.

The three types that run a guard directly with no model (`guard_hostile`, `guard_speed`,
`guard_register`) never read their ask: it is a fixed request that names the tool the guard watches ("Please make
one Edit or Write call in this workspace."), or the next step of the task when it watches none. No other type gets it.

A map may record `documents`: each file's authority (`normative`, or a navigation role such as `example`,
`template`, `history`, `changelog`, `journal`, `fixture`, `archive`). A reference whose target is a
navigation document is a place to look and gets no `read_when` row, no journey edge and no covering-array
target; the plan notes how many. A prerequisite to read such a file stays a gate. `estate stats` leaves
those references out of the coverage counts and reports their number. A plan made before the map recorded
roles still lists the row; generation writes it incomplete with that reason. A map without `documents`
changes nothing: no file name is read as a role.
A reference to a file outside the estate root (reached through a link to another repository) enters no journey:
the run's workspace does not hold the file, so a path through it cannot be walked. Its `read_when` row stays.

Complete tests with exactly equal rule semantics, asks, inputs, expectations, judge rubrics,
run mode, test type and non-target situation values share one representative.
Generated criterion identifiers may differ; their full rubrics and flags must remain equal.
Different prerequisite paths, actions, event cells, unit targets or replay alignments stay separate.
A journey is keyed by its ordered atom path: two journeys that walk different paths never merge, so every walked edge keeps its own spec.
The representative retains every source atom in `metadata.estate.atoms` and records
`metadata.estate.equivalence: { count, planRows }`.
The count describes represented source tests. The report lists each group's source rows and atoms.
`estate stats` expands those rows into their original plan cells, without replaying the representative repeatedly.
Struck source rows count no covered cell. Missing-piece notes with `blocking: false` remain advisory.

The generation report includes `incomplete[]`: spec id, path, plan row and all
`reasons: [{ marker, atom, detail }]`. Each missing piece keeps its existing reason code.
Aggregate gap totals remain available. Missing sessions, unsupported checks and unusable tasks
stay incomplete; grouping never turns an incomplete test into a complete one.

`quality` reports structural complete share, complete asked tests, distinct first asks and distinct asks
per hundred complete asked tests. Static tests have no ask and stay outside that denominator.
Event variations can legitimately repeat a task, so compare primary rule tests separately from the full suite.

The fictional scale audit and its paired measurements are in
[the task-generation audit](estate-task-generation-audit.md).
The Northwind command transcripts and example generated tree below retain their original captured version.
Current plan and generation byte snapshots live beside their product tests; they hash every output byte.

Focus coverage counts distinct asks and situation cells. Repeated rows with the same ask and cell do not replace additional mutation opportunities. Additional identical focus variants are omitted.

Layout: `<specs|incomplete>/<mode>/<test type>/<id>.yaml`, so `driftbench replay --suite <out>/specs/replay` takes the replay specs alone.

The suite of the Northwind plan. The plan must be approved first; the committed suite reads an approved copy of `plan.yaml`, `packages/generate/test/estate/fixtures/planner-plan.approved.yaml` (every row approved with `estate plan approve --all`), because the committed `plan.yaml` stays a fresh, all-proposed `estate plan` output.

```
$ pnpm -s driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/planner-plan.approved.yaml --out _captures/docs/estate/generated
Map ../../../examples/estates/fixture/approved.yaml (claude-code), hash be2e7a0919cb: 125 atoms.
Plan ../../../packages/generate/test/estate/fixtures/planner-plan.approved.yaml: 1379 rows, 1379 approved, 0 waiting, 0 struck.
Phrases ../../../examples/estates/fixture/phrases.yaml: 27 situations, 52 approved phrases.
Sessions ../../../examples/estates/fixture/sessions/index.yaml: 3.
Seed 1; custom checks the runner registers: ordered.

Test type           rows  specs  complete  incomplete
obligation           516    516       120         396
outside_trigger       43     43         7          36
twin                  43     43        10          33
ordered_pair          96     96        48          48
skip_pressure          8      8         4           4
route_positive       226    226       226           0
route_near_miss       13     13        13           0
misroute              13     13        13           0
read_when              9      9         9           0
script_fixture         2      2         0           2
dispatch              36     36        36           0
contract_alone         3      3         3           0
stop_resume            3      3         3           0
guard_positive        72     72        66           6
guard_negative         6      6         6           0
guard_hostile          6      6         6           0
guard_speed            6      6         0           6
guard_register         6      6         0           6
tool_boundary          9      9         0           9
tool_denied            3      3         1           2
stage_order           59     59        48          11
stage_skip             4      4         4           0
stage_anytime          1      1         0           1
register_sample      180    180       180           0
hazard_recovery        2      2         0           2
invariant              4      4         0           4
journey               10     10        10           0
total                      1379       813         566

Asks of the complete specs: 298 approved phrases, 515 written by code, 0 recorded sessions, 0 with no ask.
Outcomes of the complete specs: 575 bank, 23 no-change:guard, 22 no-change:negative, 27 no-change:read-only, 166 no-delete.
Run order: run-order.txt lists the complete specs, focus atoms first, then guards, gates and invariants.
Gaps (what keeps a spec incomplete):
  needs-guard-message-check  6 specs
  needs-guard-timing         6 specs
  needs-negation             3 specs
  needs-ordered-anchor       26 specs
  needs-recorded-session     6 specs
  needs-registered-check     460 specs
  needs-some-call-check      56 specs
  needs-stage-reach-check    12 specs
  needs-static-runner        4 specs
Wrote 1381 files to _captures/docs/estate/generated.
```

It exits 1: 1103 specs are incomplete. The complete ones pass strict lint (the last line of the output):

```
$ pnpm -s driftbench spec lint _captures/docs3/estate/generated/specs --strict
Checked 235 specs: 235 valid, 0 invalid, 0 warnings.
```

The written files equal the committed `examples/estates/fixture/generated/` but for the relative paths of the map and plan they record. 70 of the 235 complete specs carry a judged criterion. The gaps close as the pieces they name arrive: a "some call matches" tool check would complete the 336 `needs-some-call-check` specs (references, scripts, dispatches); registered checks for the custom predicates, the 418 `needs-registered-check` specs; approved phrases, deviation phrases and declared outcomes, through the real flow of proposal and approval. The planner's 6 replay rows are `guard_positive` rows whose situations no recorded session holds; a session per guard event would close them. 26 ordered predicates have no anchor: "Read git status before commit" is one command before another of the same tool, and "matching any line" is prose.

One generated spec, the negative control of the force-push guard (committed as `examples/estates/fixture/generated/specs/unit/guard_negative/`):

```yaml
# Generated by driftbench estate generate (plan row guard_negative.guard.settings.pretooluse-bash-guard-block-force-push, seed 1) from ../../../../packages/generate/test/estate/fixtures/planner-plan.approved.yaml and ../approved.yaml, map hash ab256ba636f4.
# Code wrote it: the ask is an approved phrase of the bank, the Then comes from the atoms of the row.
# Do not edit it by hand: change the estate, the plan or the bank and generate again. Fictional data only.
id: estate.guard_negative.guard.settings.pretooluse-bash-guard-block-force-push
version: ab256ba636f4
kind: task
title: "guard_negative: PreToolUse Bash guard block-force-push.sh"
lang: EN
tier: generated
tags:
  - estate
  - test:guard_negative
  - mode:unit
  - kind:guard
target:
  adapter: claude-code
given:
  vars:
    estate:
      runtime: claude-code
      map_hash: ab256ba636f4b315e09b13501fb64dcf47cad30b4bdc7006fabe7b1ba4c75102
    workspace_seed: northwind-ops
  world:
    workspace:
      files:
        ledger/2026-W41.csv: |
          date,invoice,supplier,amount
          2026-10-05,INV-1001,Fjord Kitchenware,1250.00 EUR
          2026-10-06,INV-1002,Copperline Pans,480.00 EUR
        invoices/INV-1001.json: |
          { "invoice": "INV-1001", "order": "PO-2001", "supplier": "Fjord Kitchenware", "amount": "1250.00", "currency": "EUR" }
        orders/PO-2001.json: |
          { "order": "PO-2001", "supplier": "Fjord Kitchenware", "amount": "1250.00", "currency": "EUR" }
        shipments/log.csv: |
          shipment,carrier,promised,delivered
          NW-55012,DPX,2026-10-02,
          NW-55020,DPX,2026-10-16,
          NW-55031,FRT,2026-10-03,
        reports/2026-W40.md: |
          # Week 40
          ## Invoices reconciled
          4
          ## Shipments late
          0
        reports/2026-W41.md: |
          # Week 41
          ## Invoices reconciled
          2
          ## Shipments late
blocks:
  - id: ask
    when:
      user: Push the fix branch to origin.
    expect:
      guards:
        - name: block-force-push.sh
          verdict: deny
          count: 0
      workspace:
        others_untouched: true
metadata:
  estate:
    atoms:
      - guard.settings.pretooluse-bash-guard-block-force-push
    planRow: guard_negative.guard.settings.pretooluse-bash-guard-block-force-push
    cell:
      atoms.guard: guard.settings.pretooluse-bash-guard-block-force-push
    seeder: estate
    seed: 1
    mapHash: ab256ba636f4b315e09b13501fb64dcf47cad30b4bdc7006fabe7b1ba4c75102
    testType: guard_negative
    mode: unit
    map: ../approved.yaml
    plan: ../../../../packages/generate/test/estate/fixtures/planner-plan.approved.yaml
    situation: plain-push
    phrase: 0
```

Each spec inlines the workspace seed's files, since `world.workspace.from` resolves from the process folder. Session states other than fresh are carried in `vars` only; a recorded prefix for a resumed or compacted session comes with the live runner, which is not built yet. `stop_resume` marks its second block with `vars.event: helper_stopped`, whose meaning the live runner defines.

## 6. Running an estate test: replay, unit, live

### Replay (built)

`driftbench replay` runs a suite over recorded sessions, offline and deterministic, with no model call. A recorded session is the transcript, plus an optional guard decision log (`{at, event, check, verdict, session?}` per line) and an optional step feed (`{at, step}` per line). The runtime's adapter maps the session onto the generic trace, one block from one typed user message to the next: tool calls with their full input (a helper dispatch with its brief), skill loads, guard verdicts and stages placed by time window, commands with exit codes, the workspace changes the session wrote, compaction markers. Every record it does not map is kept with its line and the reason. The Claude Code format is on [its adapter page](adapters/claude-code.md).

* Alignment. A spec with `metadata.replay: { session, from_block }` reads that session from that block. Otherwise the k-th spec without the key, in file order, reads the k-th session given, from block 0. A spec that names a session not given is skipped with a note.
* A decision log or step feed belongs to the session whose file name starts its own file name (`clean-build.decisions.jsonl` for `clean-build.jsonl`); with one session, any log belongs to it.
* The run is the runner's own: mode F, the scripted driver, the default checks plus the ordered-pair check under `rules.custom.ordered`, no cache. Runs are stored under one replay campaign, in the store given with `--store`, in memory without it.
* Judged criteria are judged with `--judge claude:<model>`: one judge on the local claude command, one call per criterion and block, its verdict marked as a single judge's, its cost added to the spec's cost and listed apart (`judgeCostUsd`). A judge command that is not a stand-in is billed and needs `--judge-budget <usd>`; once spent, later criteria are inconclusive. With no judge every judged criterion is inconclusive and gates as the criterion does, so the spec cannot pass, and a note says so. `replay` takes the same flags.

The ordered-pair check holds `{ before, after }` in a block when every `after` of the block has a `before` earlier in the block or in an earlier block. A name matches a tool label (`Read`), a skill load (`skill:<name>`) or a stage (`stage:<name>`). With `key`, both carry the same value in that input field (the same file was read, then edited). With `reset: compaction`, a `before` that precedes the last compaction before the `after` does not count. It ships with the Claude Code adapter today.

A replay spec of the shop build sessions, with the compaction reset:

```yaml
# Replays a session that compacts between reading the file and editing it. The read before the compaction
# does not count, so the ordered pair breaks in the second block. Fictional data.
id: replay-compaction-mid-task
kind: task
title: Edit after a compaction without a fresh read
target: { adapter: claude-code }
metadata:
  replay: { session: compaction-mid-task }
rules:
  custom:
    ordered: { before: Read, after: Edit, key: file_path, reset: compaction }
blocks:
  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
    expect:
      skills:
        - { name: shop-build, count: 1 }
      tools:
        - { label: Read }
  - user: Go on, and keep the old total as gross.
    expect:
      tools:
        - { label: Edit }
      execution: { exit_code: 0 }
```

The seven replay specs over the six shop build sessions:

```
$ pnpm -s driftbench replay examples/estates/sessions/clean-build.jsonl examples/estates/sessions/compaction-mid-task.jsonl examples/estates/sessions/forbidden-act.jsonl examples/estates/sessions/gate-violated.jsonl examples/estates/sessions/skill-skipped.jsonl examples/estates/sessions/subagent-dispatch.jsonl --decisions examples/estates/sessions/clean-build.decisions.jsonl examples/estates/sessions/forbidden-act.decisions.jsonl examples/estates/sessions/gate-violated.decisions.jsonl examples/estates/sessions/skill-skipped.decisions.jsonl examples/estates/sessions/subagent-dispatch.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl examples/estates/sessions/gate-violated.steps.jsonl examples/estates/sessions/skill-skipped.steps.jsonl --suite examples/estates/sessions/specs
✓ replay-clean-build  session clean-build from block 0 (metadata)
✗ replay-compaction-mid-task  session compaction-mid-task from block 0 (metadata)
    failing: block 1: custom.ordered.Read.Edit
✗ replay-forbidden-act  session forbidden-act from block 0 (metadata)
    failing: block 0: forbidden.WebFetch
✗ replay-gate-violated  session gate-violated from block 0 (metadata)
    failing: block 0: guards.read-before-write.deny, block 0: execution.exit_code, block 0: custom.ordered.Read.Edit
✓ replay-negative-control  session gate-violated from block 0 (metadata)
✗ replay-skill-skipped  session skill-skipped from block 0 (metadata)
    failing: block 0: skills.shop-build, block 0: custom.ordered.skill_shop-build.Edit
✓ replay-subagent-dispatch  session subagent-dispatch from block 0 (metadata)
7 specs replayed: 3 pass, 4 fail. Campaign replay-bcb1a997a0d9 (in memory).
```

It exits 1. The negative control runs on a faulty session and checks only what that session did right, so it stays green.

Generated specs pass and fail as planned. A generated replay spec is planned to fail exactly when its session breaks one of the row's atoms (`violates` in the session index). The Northwind planner suite has no complete replay spec, so the proof runs on a small hand plan the generator's tests use (`packages/generate/test/estate/fixtures/plan.yaml`, 37 rows, one struck), generated, then replayed over the three Northwind sessions (one clean, one that skips the weekly-report skill, one that edits before reading). Of the generate output, the plan, total, replay and last lines are shown:

```
$ pnpm -s driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out _captures/docs3/estate/generated-hand
Plan ../../../../packages/generate/test/estate/fixtures/plan.yaml: 37 rows, 36 approved, 0 waiting, 1 struck.
total                        44        30          14
Replay: 12 specs aligned to sessions, 10 planned to pass, 2 to fail.
Wrote 45 files to _captures/docs3/estate/generated-hand.
$ pnpm -s driftbench replay examples/estates/fixture/sessions/weekly-clean.jsonl examples/estates/fixture/sessions/weekly-gate-violated.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.jsonl --decisions examples/estates/fixture/sessions/weekly-clean.decisions.jsonl examples/estates/fixture/sessions/weekly-gate-violated.decisions.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.decisions.jsonl --steps examples/estates/fixture/sessions/weekly-clean.steps.jsonl examples/estates/fixture/sessions/weekly-gate-violated.steps.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.steps.jsonl --suite _captures/docs3/estate/generated-hand/specs/replay
✓ estate.p03.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p03.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✓ estate.p03.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
✓ estate.p02.weekly-clean  session weekly-clean from block 0 (metadata)
✗ estate.p02.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
    failing: block 0: custom.ordered.Read.Edit
✓ estate.p02.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
✓ estate.p01.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p01.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✗ estate.p01.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
    failing: block 0: skills.weekly-report
✓ estate.p04.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p04.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✓ estate.p04.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
12 specs replayed: 10 pass, 2 fail. Campaign replay-4af6d9df4416 (in memory).
```

p01 is a `route_positive` row (the weekly-report skill loads), p02 an `ordered_pair` (Read before Edit), p03 an `obligation` (only the declared path changes), p04 a `stage_order` (verify before report, closing at report). The two failures are the two planned ones.

Limits of replay today:

* A spec that only inconclusive checks keep from passing (no stage feed, no judge) is undecided: it still counts as not passed, the JSON marks it `undecided: true` and counts these apart (`undecided`), and the summary line says how many. A spec with a failed check is never undecided.
* A spec that only not-applicable checks keep from passing (a stage check on a run with no stage record) is not applicable: it still counts as not passed, the JSON marks it `notApplicable: true`, it is left out of the decided count and counted apart (`notApplicable`), and the summary line says how many. A spec with a failed check, or with an inconclusive check beside a not-applicable one, is never not applicable.
* A file the runtime loads by itself (for Claude Code, every `CLAUDE.md` and `CLAUDE.local.md`) is never an expected Read: no call ever shows it.
* Without a decision log, no guard is seen: a `count: 0` guard expectation passes and a positive one fails, rather than being inconclusive. The command prints a note when a spec expects guards and no log was given, and the same for stages without a step feed.
* A write to a path the session never saw counts as created. Only the runtime's own result type, or a tree before and after, is certain.
* A tree diff (which also sees deletions) goes on the last block only; a tree per block needs a snapshot per turn. The adapter reads a before and after tree; the command has no option for them yet.

### Unit, live and estate mutants

* Unit (offline), `driftbench estate unit`. Guards run on synthetic event payloads and scripts on their fixtures, on a copy of the estate, sandboxed where the platform has a sandbox (macOS `sandbox-exec`: no network, no credential folders, writes only into the copy). `--record` runs each case on the original estate and writes its outcome into the test file; a later run on the original or on a mutant copy must give every recorded outcome again, and a `guard_speed` test also holds each run under the guard's `timeout`. A case whose outcome varies across the record runs is marked flaky and not compared; a case that shows no effect is inert, and an inert test passes. A script's fixtures come from `scripts:` in the [configuration file](#the-estate-configuration-file); a script without one is recorded like a guard. Helper-only task specs use a configured local executor with the current agent body as its system prompt.

  `--json` prints `{ "runs": [{ "spec": "<id>", "pass": true, "failing": ["<case: why>"] }], "guards": [{ "guard": "<name>", "event": "<event>", "decision": "allow" | "deny" | "ask", "message": "<text>", "ms": 0 }], "scripts": [{ "script": "<path>", "exit": 0, "stdout": "<text>" }] }`: one run per test, one guard entry per guard case, one script entry per fixture. `message` is what the guard told the runtime (its standard error on exit 2, or the reason of its JSON answer), and `ms` its running time. A guard that exits with another code than 0 or 2 does not block: its decision is `allow`. A recorded case fails when the decision, the exit code, the message or the output differs. Exit 0 when every test passes, 1 when one fails, 2 on a usage or input error or when a test has no recorded outcome and `--record` was not given. The options and a run on the fixture are in the [CLI reference](reference/cli.md#driftbench-estate-unit).
* Live (online, blind), `driftbench estate run`. The agent runs headless in a sandboxed copy of the estate pinned by hash, on a seeded workspace, from the ask alone: no test word in the prompt or the dispatch description. Teacher-forced resumes from a recorded prefix cut at block k; free running; perturbed injects an estate deviation at block k (a compaction marker, a mid-turn message, a planted file, a dead helper). Repeats give the variance; cost per run is measured. Built: `driftbench estate run`, with session states and hazards planted from the state library `--states`.
* Estate mutants, `driftbench estate mutate`. Delete or invert one atom in a copy of the estate. A `--delete` of a skill's `name:` line whose value is the skill's folder name is refused as an equivalent mutant: the runtime names a skill by its folder, so the line's removal changes nothing the agent sees, and nothing is written. The tests derived from that atom must go red in live mode, and the replay suite must flag the corpus as now violating. The mutation score per atom kind is the stop rule. Built: `driftbench estate mutate`. The fixture's proof (`packages/cli/test/estate-live.test.ts`) runs 14 live specs on the stand-in and two mutants, each turning its atom's specs red.

## 7. Judging, statistics and coverage for estates

What exists: `sessionRate(runs, { rho })` of `@agent-nexus/driftbench-estate` takes the session as the unit (one cluster): with m the mean runs per session, the design effect is `1 + (m - 1) rho`, the effective runs are the runs over it, and the 95% interval is Wilson on the rounded effective runs. `rho` lies in [0, 1], the correlation of the variance pilot, and the function throws a `RangeError` outside it. The plan summary reports the unenforced rules, the cells with no approved phrase, the edges with no journey and the mandatory rows per kind; the generate report counts complete and incomplete specs per test type and the gaps behind them; replay reports pass and fail per spec and session.

`estate stats` reports the frozen coverage, reach, decay and guard drift fields below. It uses offline replay checks for compliance and block pass rates, with no model call. Specs align through `metadata.replay`; those without a key align by file order, as in `replay`. A session counts once per block and atom, even when several specs name it. An atom is followed only when every aligned complete spec naming it passes. A block without an aligned check has no demonstrated pass. Judged criteria remain inconclusive without a judge; this command does not call one.

Not built yet:

* Sources of variance for an estate are model randomness, phrasing, session state, workspace seed and judge; the pilot that measures them for an estate is not built.
* The completeness line over situations seen in the corpus.
* A sealed holdout for estate changes and the pass rate per atom per estate version over time.

### The coverage command: `estate stats` (contract)

```
driftbench estate stats --map <map> --plan <plan> --specs <dir> [--sessions <dir>] --json
```

`--map` is the approved map, `--plan` the plan made from it, `--specs` the folder `estate generate` wrote (its `specs/`, `static/` and `incomplete/` folders), `--sessions` a folder of recorded sessions. It prints one JSON object:

```json
{
  "coverage": {
    "kinds": { "<kind>": { "atoms": 0, "tested": 0, "enforced": 0 } },
    "cells": { "covered": 0, "total": 0 },
    "edges": { "covered": 0, "total": 0 }
  },
  "reach": [{ "atom": "<id>", "reached": 0, "followed": 0 }],
  "reachNotObservable": { "status": "not observable", "atoms": 0 },
  "decay": [{ "block": 0, "runs": 0, "passRate": 0 }],
  "drift": { "guards": [{ "guard": "<name>", "decisions": 0, "denies": 0, "denyRate": 0 }] }
}
```

* `kinds`: one entry per atom kind of the map. `atoms` counts the approved atoms of the kind. `tested` counts those named by at least one complete spec (a spec under `specs/`, or a static test under `static/`). `enforced` counts those whose enforcement lists at least one guard.
* `cells` and `edges`: the plan's cells and the graph's route, reference, dispatch and next edges, covered when a complete spec covers them.
* `reach` covers the four observable kinds: skills, references, guards and subagents. `reachNotObservable` reports the other approved atoms as `{ status: "not observable", atoms: <count> }`. It counts them from the map, including when no sessions are supplied. No exposure is inferred for those kinds.
* `reach` and `decay` come from `--sessions`; without it, both are empty lists. `reached` is the number of sessions that reached the atom's moment (its skill loaded, its file read, its guard decided, its helper dispatched); `runs` is the number of sessions that hold the block index.
* `drift.guards` comes from the guard decision logs of `--sessions`: per guard, the decisions logged, the denies among them and their share. A user watches it over time: a guard that starts denying more, or stops firing, is the first sign that the estate or the agent changed.

Finding (audit style, 2026-10-12, the estate validator lane): section 7 promises drift ("deny rates per guard from the decision logs"), and the frozen contract had no field for it. The contract gains `drift.guards`; nothing else changes. The pass rate per atom per estate version needs a store of past runs, and waits for its own finding.

Exit codes: 0 when the report is printed; 2 on a usage or input error (a map, plan or folder that does not load, or a plan made from another map), and nothing is printed.

## 8. Maintenance: keeping the tests true when the estate changes

### What changed: `estate diff`

Atoms match by id. An atom whose provenance hash changed is one of three things:

* moved: the same quote at another span (a line was added or removed above it); no test changes;
* white space: the quotes are equal once runs of white space become one space and the ends are trimmed; no test changes, since nothing a test checks changed (a change reruns only what it can affect);
* semantic: anything else (case and punctuation count); its tests are regenerated and its phrasings go back for approval.

An atom with the same hash whose evidence, enforcement, situation, title, role or kind fields differ is restated: its tests are regenerated. Approval alone is never a change. Edges compare as `from kind to`.

An atom id names the file the atom was read in, so a fact several files state once, such as a tool two helpers declare, changes its id when the file it was anchored in leaves. An atom that leaves under one id while an atom of the same kind, title, words and fields arrives under another is the same atom, renamed: it is listed under `renamed` (and counted in `summary.renamed`) instead of as removed and added, and its tests are regenerated against the new id, never retired. Both keys are absent when nothing was renamed.

The diff of the Northwind estate against its second version, with the guard state of the first version named:

```
$ pnpm -s driftbench estate diff examples/estates/fixture/approved.yaml examples/estates/fixture-v2/map.yaml --old-guards examples/estates/fixture-v2/maintain/guard-state.v1.yaml --out _captures/docs3/estate/diff.json
Estate diff: examples/estates/fixture/approved.yaml (ab256ba636f4) to examples/estates/fixture-v2/map.yaml (48cac5d0c4c3).
  Atoms: 2 added, 1 removed, 3 changed (1 white space only, 2 semantic), 24 moved with the same quote, 1 restated, 93 unchanged.
  Edges: 1 added, 1 removed.
  Guards: 1 of 6 changed enforcement state:
    promoted guard.settings.posttooluse-bash-guard-ledger-guard-py: warn to enforce (evidence: 47 decisions, 0 wrong, logs/ledger-guard.decisions.jsonl)
Added:
  + instruction.standing.name-the-finance-lead-on-a (instruction) CLAUDE.md:26
  + instruction.standing.keep-a-credit-note-as-a (instruction) CLAUDE.md:27
Removed:
  - instruction.standing.keep-an-unconfirmed-draft-unsent (instruction) CLAUDE.md:20
Changed, white space only:
  ~ instruction.standing.never-send-a-supplier-email-without (instruction) CLAUDE.md:10-11
Changed, semantic:
  ~ route.standing.an-ask-to-plan-the-delivery (route) CLAUDE.md:38
      was: | plan the delivery routes for tomorrow | the `route-planner` agent |
      now: | plan the delivery routes for the next two days | the `route-planner` agent |
      also: title, situation, fields
  ~ instruction.standing.tell-the-user-about-a-late (instruction) CLAUDE.md:16
      was: When a shipment is late by more than two days, tell the user and propose a supplier email.
      now: When a shipment is late by more than one day, tell the user and propose a supplier email.
      also: situation
Moved, same quote:
  > reference.standing.read-claude-skills-invoice-reconcile-references CLAUDE.md:13 to 14
  > reference.standing.read-claude-steps-json CLAUDE.md:40 to 42
  > reference.standing.read-claude-memory-memory-md CLAUDE.md:50 to 52
  > route.standing.an-ask-to-reconcile-an-invoice CLAUDE.md:31 to 33
  > route.standing.an-ask-to-know-where-a CLAUDE.md:32 to 34
  > route.standing.an-ask-to-write-to-or CLAUDE.md:33 to 35
  > route.standing.an-ask-to-prepare-the-weekly CLAUDE.md:34 to 36
  > route.standing.an-ask-to-audit-the-ledger CLAUDE.md:35 to 37
  > gate.standing.read-claude-skills-invoice-reconcile-references CLAUDE.md:13 to 14
  > hazard.standing.recover-from-a-new-session CLAUDE.md:50 to 52
  > gate.standing.read-a-file-before-editing-it CLAUDE.md:11 to 12
  > instruction.standing.never-delete-a-ledger-file-archive CLAUDE.md:12 to 13
  > instruction.standing.never-force-push CLAUDE.md:14 to 15
  > instruction.standing.never-invent-order-numbers-prices-or CLAUDE.md:16 to 17
  > register.standing.at-most-one-question-per-reply CLAUDE.md:17 to 18
  > instruction.standing.on-stop-stop-all-work-and CLAUDE.md:18 to 19
  > instruction.standing.never-paste-a-credential-into-a CLAUDE.md:19 to 20
  > gate.standing.never-report-done-before-verify-passed CLAUDE.md:41 to 43
  > register.standing.replies-under-1-200-characters CLAUDE.md:45 to 47
  > register.standing.lead-with-the-result CLAUDE.md:46 to 48
  > register.standing.bullets-for-three-or-more-parallel CLAUDE.md:47 to 49
  > register.standing.never-use-obviously-or-simply CLAUDE.md:48 to 50
  > register.standing.currency-code-after-the-amount CLAUDE.md:49 to 51
  > instruction.standing.read-the-memory-index-at-the CLAUDE.md:50 to 52
Restated, same quote:
  * invariant.standing.the-standing-instructions-stay-under-40000: fields
Edges added:
  + instruction.standing.keep-a-credit-note-as-a cites instruction.standing.name-the-finance-lead-on-a
Edges removed:
  - instruction.standing.keep-an-unconfirmed-draft-unsent cites instruction.standing.never-send-a-supplier-email-without
Wrote _captures/docs3/estate/diff.json.
```

The JSON it writes equals the committed `examples/estates/fixture-v2/maintain/diff.json` as data. The size invariant of the standing file is restated because the file's measured size changed; so its tests are regenerated after every change to the standing file.

Two limits of the atom ids:

* An id is `kind.scope.slug`, and two atoms with the same slug get a `-2` suffix in scan order. A new atom with the same slug, inserted above an existing one, swaps their ids, and the diff reads a change and an addition. The Northwind fixture avoids it.
* A semantic change to the first six words of a model atom's title, or of a code atom's quote, changes its id: the diff shows a removal and an addition, and impact retires the old tests and asks for new ones. Pairing them as a rename is not built.

### Enforcement state as data

A guard observes (it logs what it would decide), then warns (it tells the agent), then enforces (it blocks). The state of every guard atom of a map is a file beside the map, `guard-state.yaml`, one entry per guard atom id, with its mode, the date since, and the decision-log evidence behind the mode. Part of the Northwind version 2 state:

```text
version: 1
guards:
  - guard: guard.settings.posttooluse-bash-guard-ledger-guard-py
    mode: enforce
    since: 2026-10-05
    evidence:
      log: logs/ledger-guard.decisions.jsonl
      decisions: 47
      wrong: 0
      note: Four weeks of warnings; every flagged delete under ledger/ was a real one.
```

The file is read against its map: every entry names a guard atom of the map, and every guard atom has one entry, or the diff exits 2. `estate diff` reads the file beside each map by default, or the one named with `--old-guards` and `--new-guards`; with no state on either side, the diff has no guards. Two versions compare guard by guard: promoted, demoted, added, removed, unchanged.

* A promotion, or a new state above observe, needs evidence with at least one decision and none marked wrong; without it, a person decides.
* Every demotion is confirmed by a person.
* A state that appears only in the new version is "added". A removed state needs no person: the guard atom's removal shows in the atoms.
* A guard whose mode changed sends its tests to regenerate.

The state of the first Northwind version sits in `examples/estates/fixture-v2/maintain/guard-state.v1.yaml`, and `--old-guards` names it.

### What it does to the tests: `estate impact`

Specs index by `metadata.estate.atoms` (a list of atom ids, as `estate generate` writes them). A spec without `metadata.estate` is counted as other. A spec with any `metadata.retired` value, a key beside `metadata.estate`, is no longer live. The static tests `estate generate` writes under `static/` (an invariant or a setting, one JSON record each) are tests too: a record indexes by its `atom`, and a retirement is written as the record's own `retired` field, which `estate static` and `estate stats` then skip. A removed environment key therefore retires the test of its setting. The lists:

* regenerate: every test with a semantic, restated, renamed or guard-state atom, or with a removed atom while other atoms remain, with the reason per atom; a change of white space alone touches no test (the respaced supplier rule leaves `northwind-supplier-yes` untouched);
* re-approve: every semantic change, with its tests;
* retire: every test whose atoms are all removed, with the reason `atom <id> removed`;
* new: added atoms no live test names.

```
$ pnpm -s driftbench estate impact _captures/docs3/estate/diff.json --tests examples/estates/fixture-v2/tests
Impact of the estate diff ab256ba636f4 to 48cac5d0c4c3 on 8 live estate tests (0 retired before, 0 other specs).
  Regenerate 4, re-approve 2, retire 1, new 2; 3 tests untouched, 24 atoms moved with the same quote.
Regenerate:
  northwind-draft-pair (draft-pair.yaml): instruction.standing.keep-an-unconfirmed-draft-unsent removed
  northwind-late-shipment (late-shipment.yaml): instruction.standing.tell-the-user-about-a-late semantic
  northwind-ledger-archive (ledger-archive.yaml): guard.settings.posttooluse-bash-guard-ledger-guard-py guard state
  northwind-route-planner (route-planner.yaml): route.standing.an-ask-to-plan-the-delivery semantic
Re-approve, the meaning changed:
  route.standing.an-ask-to-plan-the-delivery (route): | plan the delivery routes for the next two days | the `route-planner` agent |
      tests: northwind-route-planner
  instruction.standing.tell-the-user-about-a-late (instruction): When a shipment is late by more than one day, tell the user and propose a supplier email.
      tests: northwind-late-shipment
Retire:
  northwind-unsent-draft (unsent-draft.yaml): retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed [to write with --write]
New atoms with no test:
  instruction.standing.name-the-finance-lead-on-a (instruction) CLAUDE.md:26
  instruction.standing.keep-a-credit-note-as-a (instruction) CLAUDE.md:27
Guards whose enforcement state changed:
  promoted guard.settings.posttooluse-bash-guard-ledger-guard-py: warn to enforce; tests: northwind-ledger-archive
Needs a person: 4.
  - re-approve route.standing.an-ask-to-plan-the-delivery: its meaning changed; 1 test waits
  - re-approve instruction.standing.tell-the-user-about-a-late: its meaning changed; 1 test waits
  - approve the tests of the new atom instruction.standing.name-the-finance-lead-on-a: no test covers it yet
  - approve the tests of the new atom instruction.standing.keep-a-credit-note-as-a: no test covers it yet
```

It exits 1 for the four items. `--write` writes each retirement reason into its spec as `metadata.retired`, keeping comments and layout, and loads the spec again before writing; a second run finds it written. Without `--write`, impact writes nothing and reports each retirement "to write". On a copy of the version 1 tests (the first line and the retirement line of each output):

```
$ pnpm -s driftbench estate impact _captures/docs3/estate/diff.json --tests _captures/docs3/estate/v2-tests --write
Impact of the estate diff ab256ba636f4 to 48cac5d0c4c3 on 8 live estate tests (0 retired before, 0 other specs).
  northwind-unsent-draft (unsent-draft.yaml): retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed [written]
$ pnpm -s driftbench estate impact _captures/docs3/estate/diff.json --tests _captures/docs3/estate/v2-tests --write
Impact of the estate diff ab256ba636f4 to 48cac5d0c4c3 on 7 live estate tests (1 retired before, 0 other specs).
  northwind-unsent-draft (unsent-draft.yaml): retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed [already written]
```

The spec then holds `retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed` under `metadata`.

### Regression: replay over the corpus

`estate impact ... --replay <sessions> [--suite <dir>] [--store <db>]` runs `driftbench replay` over a folder: every `*.jsonl` there is a session, and `*.decisions.jsonl` and `*.steps.jsonl` files go with their session by name. The suite defaults to the `specs` folder inside the sessions folder. The latest replay campaign is read from the store before this replay is stored in it, and each spec on each session flips: pass to pass, fail to pass, pass to fail (a person is needed), fail to fail, or no previous. The run replays whatever corpus and suite it is given: it does not skip specs that `--write` retired.

The corpus of `examples/estates/sessions` belongs to the shop build estate and to the Acme ops agent, not to Northwind, so on the fixture the run shows the comparison working, not Northwind regressions. Run twice with one store, the first run has nothing to compare with; the second compares with the first. These are the two lines each run adds to the impact output above:

```
Replay of 8 runs, campaign replay-314dd5d13a4a, no earlier replay in the store: nothing to compare.
  pass to pass 0, fail to pass 0, pass to fail 0, fail to fail 0, no previous 8.
```

```
Replay of 8 runs, campaign replay-603c2d6667db, against replay-314dd5d13a4a.
  pass to pass 4, fail to pass 0, pass to fail 0, fail to fail 4, no previous 0.
```

The failing session that motivated a change is its fail-to-pass case: red before, green after, on the same transcript.

## 9. Where it lives

* `packages/estate`: the schema (atoms, edges, the map, the plan), the scanner (`scan/`, with the Claude Code reader as the one runtime-specific file), the graph, the map file and its space map, the lint, the plan (contract, journeys, pairwise), and maintenance (diff, guard state, impact, regression). It imports the covering array, the feasibility check, the graph walk and the model port from `@agent-nexus/driftbench-generate`.
* `packages/generate/src/estate`: the estate generator. It reads the map and plan by their shape and never imports `@agent-nexus/driftbench-estate`, so the two packages do not import each other.
* `packages/adapters/src/claude-code`: the session reader, the replay adapter, the ordered-pair check, and the live runner in `live/`.
* `packages/cli`: the `estate` commands and `replay`.
* The estate validator, which checks this whole loop on an estate nobody wrote by hand: `driftbench validate estate`, designed on the [validators](validators.md) page.

Built, in order: scan, lint and map; plan; the session reader and replay; generation; maintenance; the live runner with planted session states and hazards; estate mutants; the static and unit runners. Not built yet: the unit run of a helper alone, and a validation on a real estate against its native test battery.

See also: [checks](reference/checks.md), [running](running.md), [statistics](concepts/statistics.md).

### Explicit operations in unit task specs

`estate mutate` copies the estate configuration (`driftbench.estate.yaml`, at the root or in `.claude/`) with the estate files, since a unit test on the copy needs the helper executors and the script fixtures it declares. `estate unit` accepts YAML or JSON task specs marked `metadata.estate.mode: unit`, alongside recorded JSON unit tests. A task spec declares its executable operation in `metadata.estate.unit`: a guard target (name, event, matcher and command) or a script target (path), plus concrete `cases` with guard event payloads or script arguments, files and stdin. The runner executes those inputs on a copy. It does not turn the user ask into a command or search the implementation for an input that satisfies the expected verdict. The runner evaluates `expect.guards`, `expect.execution` and `expect.workspace`; for `workspace` it compares the files of the operation's working folder before and after each case (the estate copy for a guard, the case folder for a script). An expectation of any other kind, or a workspace expectation the operation cannot observe, is an input error reported as `not_run`, never a pass. A fixture path that is absolute, or that leaves the working folder by `..` or a symbolic link, is refused before any fixture is written.

A unit task spec has one block. Guard expectations check actual firings: exit 2 denies, a JSON permission decision supplies its decision, another nonzero exit warns, and context on stdout nudges. `guard_message` checks the actual messages of the runs by which a guard acted (a deny, a block, a warn or a nudge); an allow, a timeout or a verdict outside that list is no intervention and has no message to judge; `guard_finished` and an optional `budgetMs` check completion. A case may supply an exact `expected` outcome. A script needs declared configuration fixtures, exact case outcomes, or an explicit expected exit code. Starting a process alone does not establish its correctness. Script execution assertions enforce `ran_code`, `max_commands` and the last command's `exit_code`. Guard case outcomes describe guard processes. `some_call` checks the actual script invocations and their input fields. Other custom script checks and assertions naming another operation are reported as unsupported, never silently dropped. Agent replies, skill loads and workspace edits require a live or replay test; direct unit operations do not establish those outcomes. Missing inputs, unsupported checks and missing script oracles are input errors, not executed failures or successful mutant kills.

Explicit task payloads retain their declared keys and empty values; the runtime reply alias is added only when absent. Recorded JSON tests keep their existing shorthand conversion. Guards run from the copied estate's working folder. Scripts use their shebang interpreter when present, and otherwise the file extension selects the interpreter. Declared and recorded script fixtures both pass their stdin to the process. A helper's prompt alone supplies no observed execution; helper-only task specs require an executor declared under `helpers` in the estate configuration; missing executors report an input error.


### Declared unit execution contracts

A helper executor is an explicitly configured local runtime. The runner never selects one from a helper's description or infers execution from a nonempty prompt. Its command runs inside the copied estate, with the unit sandbox, isolated home, process-group cleanup and timeout. The configuration names the executable and each argument separately; shell syntax requires an explicit shell command. Local stand-ins must perform the task on its inputs, rather than print a success verdict.

```text
helpers:
  labeler:
    command: [python3, .claude/execute-labels.py]
    timeoutMs: 3000
scripts:
  .claude/skills/labels/scripts/label.py:
    usage: label.py < label
    fixtures:
      - stdin: green parcel
        expect:
          exitCode: 0
          stdout: GREEN PARCEL
```

A helper run alone is also written as a JSON run record, `unit/contract_alone/unit.contract_alone.<helper atom>.json`, beside the unit-mode spec: its target is the helper and its agent file, and its one case holds the task the row asks and the workspace files its situation seeds. A record is an output, not an input: `driftbench estate unit --record` runs the helper on the original estate (three record runs) and writes its answer into the case; a later run, on any copy, must answer the same, so an agent file that lost its body or changed what it asks turns the record red. A helper with no declared executor, or whose executor fails, fails the record and is never recorded as a pass. The generate report counts these records under `unit.helpers`.

The helper process receives one JSON line with `name`, `systemPrompt` (the current body without YAML frontmatter), `frontmatter` and `task` (the unit block's user message). Workspace files from the spec are planted in the copy; they cannot replace `.claude/` or configuration files. The executor returns a JSON object with `text`, `segments` and `toolCalls`, plus any observed runtime traces, executions or workspace diff in the core `Observed` format. Cost and latency fields are supplied by the runner. The executor must report actual observations. Machine checks evaluate the task assertions against them; zero process exit alone does not pass a helper test. Missing observations, unavailable executors and unreadable helper files are reported explicitly. An empty body still reaches the executor; only actual execution and its observations determine the result. Judged criteria require a judge and do not pass an offline unit run. Successful executions also report `helpers` entries with the helper name, process exit, measured milliseconds and text.

Script fixture expectations are independent contracts written from the public usage, documented exit codes and declared outputs. Neither the runner nor generation derives an expected result from implementation source. Each configured fixture needs an explicit exit or output assertion; a usage line without expectations is not an oracle. Output-only expectations retain the documented default exit code of zero. The runner accepts both the existing fixture list and the `{ usage, fixtures }` form above, validates them before execution, and checks every fixture. `some_call` reads only actual command invocations (interpreter, script path and arguments); it cannot establish that a script performed an internal tool action. Unsupported custom checks and absent oracles report an input error, never a successful mutant kill.

A hand-written guard expectation without a `verdict` counts a blocking decision (deny or ask) when it requires a firing, and also a warning (a nonzero exit other than 2) when it bounds firings, such as a count of 0 or a `max`; a message-only nudge is neither. A guard that only warns therefore fails "no firing".

Generated guard expectations retain their declared verdict for hostile and speed tests as well as positive and negative tests. With no declared verdict, a positive firing means an actual denial. Text-event guards enforcing a declared `max_characters` predicate receive a positive payload above that boundary and a separate neutral control. Boundary synthesis uses the map's evidence, never implementation literals, and is bounded by `MAX_BOUNDARY_CHARACTERS` in the generator.

Recorded measurements behind two estate changes: [generation pass-to-fail comparison](estate-generation-loss-ca5.md) and [unit runner evidence](estate-unit-runner-evidence.md).

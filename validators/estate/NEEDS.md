# Needs: what each family of the estate bank serves

Rule (lead, 2026-10-12): every item family cites the product need it serves, as a docs page, a design section or a command. A family that nothing needs is quarantined: its code stays, and the bank leaves it out (`QUARANTINED` in `packages/validators/src/ladders/estate/bank/index.ts`). Pages are on main at 3a5e799.

| Family | Items | Level | Need |
|---|---|---|---|
| scan.generated | 48 | reader | docs/estate.md section 1, "Reading the estate: `estate scan`" (every atom kind the scanner reads) |
| scan.frontmatter | 28 | reader | docs/adapters/claude-code.md, "The estate" (skill and agent frontmatter); docs/validators.md 12.6 (compact frontmatter) |
| scan.symlink | 23 | reader | docs/validators.md 12.6 (symlinks, a reader gap on the Cue estate) |
| scan.registry | 37 | reader | docs/adapters/claude-code.md, "The estate", Guard row (a check registry); docs/validators.md 12.6 (registry tables) |
| scan.steps | 20 | reader | docs/adapters/claude-code.md, Stage row (step lists); docs/validators.md 12.6 (process maps) |
| scan.catalogue | 22 | reader | docs/validators.md 12.6 (catalogue JSON). The adapter page still names only files whose name holds "registry": the docs lag the reader |
| scan.dispatcher | 24 | reader | docs/adapters/claude-code.md, Guard row (hook command); docs/validators.md 12.6 (dispatcher commands) |
| scan.reference-prose | 22 | reader | docs/estate.md section 1 (the model splits prose; references "the files it names"); docs/validators.md 12.6 (long references) |
| scan.gates | 29 | reader | docs/estate.md section 1 (gates in four fixed forms, read by code) |
| scan.hazards | 22 | reader | docs/adapters/claude-code.md, Hazard row (passages naming a runtime hazard) |
| scan.paths | 31 | reader | docs/estate.md section 1, Reference row (a file a skill names) |
| scan.combination | 45 | reader | docs/validators.md 12.2 point 3 (pairwise forms of the reader needs above) |
| scan.hostile | 22 | reader | docs/validators.md 12.2 point 7 (degenerate and hostile inputs) on `estate scan` |
| scan.decoys | 20 | reader | docs/validators.md 12.2 point 5 (adversarial items) on `estate scan` |
| scan.standing | 22 | reader | docs/adapters/claude-code.md, Route row (rows of a routing table) and Instruction row (standing files) |
| bench.defects | 25 | reader | `estate lint` (D2, AMBIGUOUS_REFERENCE), `estate mutate` (D5), `estate run --map` (D6), docs/estate.md section 5 "With no bank beside the map, every ask is written by code" (D7), the check registry (D9), routing table rows (the long table); docs/estate.md section 1, "Names that fit several files" (the five name items) |
| blind.layout | 35 | reader | docs/adapters/claude-code.md, "The estate" (the breaker wrote only from this page and docs/estate.md) |
| blind.gates | 43 | reader | docs/estate.md section 1 (gates, hazards) |
| blind.links | 27 | reader | docs/estate.md section 1, Reference row |
| blind.lint | 46 | reader | docs/estate.md section 2, "Checking the estate: `estate lint`" |
| blind.edges | 25 | reader | docs/estate.md section 2, "Relations: the estate graph" |
| estate.determinism | 25 | reader | docs/estate.md section 5, "The same map, plan, bank and seed give the same specs" and "The same holds on every Node version the package supports (22 and later), in any time zone and locale"; section 1, atom ids and hashes from file, span and quote |
| lint.defect | 24 | lint | docs/estate.md section 2, `estate lint` |
| lint.clean | 22 | lint | docs/estate.md section 2, `estate lint` (no finding on a clean estate) |
| plan.contract | 25 | plan | docs/estate.md section 4, the contract table |
| plan.pairs | 20 | plan | docs/estate.md section 4, "Pairwise: a covering array of strength t" |
| plan.relevance | 20 | plan | docs/estate.md section 4, pairwise rows "under the constraint list" |
| gen.complete | 97 | generation | docs/estate.md section 5, the predicate to check table and the named gaps |
| gen.task | 23 | generation | docs/estate.md section 5, "A code-written ask names a task" |
| gen.task.v2 | 23 | generation | docs/estate.md section 5, "A code-written ask names a task"; source clauses and rendered ask checked beside v1 |
| gen.asks | 24 | generation | docs/estate.md section 5, "When" (approved phrases shuffled by the seed; the twin takes the second phrase) |
| gen.reads | 23 | generation | docs/estate.md section 5 (a Read of a path goes to the references check) and section 1, Reference row |
| gen.coverage | 25 | generation | docs/estate.md section 5: `--focus` ("names the gaps of the ones with none"), the domain-rule row (a gating judged criterion), and the named gaps that close "as the pieces they name arrive" |
| unit.runner | 41 | generation | docs/estate.md section 6, "Unit (offline). Guards replayed with synthetic events; scripts on fixtures; a subagent alone", and "Guard messages and timing"; the command written in docs/estate.md section 6 and docs/reference/cli.md |
| estate.stats | 37 | generation | docs/estate.md section 7, "Not built yet: coverage lines per atom kind" (tested over atoms, enforced over atoms), reach, decay and `drift.guards` with its finding note; the command written in docs/estate.md section 7, "The coverage command: `estate stats`", and docs/reference/cli.md |
| mutant.agent | 44 | agent mutants | docs/estate.md section 6, estate mutants (adequacy: a deleted atom fails a test) |
| kill.fake | 31 | agent mutants | `estate mutate` and `estate run` on the fixture's stand-in command (docs/reference/cli.md, "driftbench estate run and driftbench estate mutate") |
| maintain.impact | 33 | maintenance | docs/estate.md section 8, `estate diff` and `estate impact` |
| maintain.fixture | 20 | maintenance | docs/estate.md section 8, `estate impact` on real versions of the fixture |
| scale | 20 | scale | docs/validators.md 12.6 (estates of 5000 atoms). No product page sets a time budget; the bench run timed the Cue estate (5,964 atoms) |

## Quarantined

None. gen.task (23 items) is back: docs/estate.md section 5 now says that a code-written ask names a task, a verb of acting and its object, and never restates the rule or a bare condition.

## Changed to fit the need

* gen.coverage asked for five complete specs per atom. No page asks for five: section 5 names the atoms with none. The items now ask for one, with the cause "generate a complete spec for every <kind> atom".
* The fixture suite now counts the static checks (invariants, settings) as complete specs, as `estate generate` writes them under `static/`.

## Items beyond a documented closed list

These items sit in families with a need, but test a form the docs exclude. They stay, flagged for the maintainer:
* scan.gates then-form, without-form, only-after-form, question-form, prior-to-form: section 1 names four fixed gate forms.
* scan.standing list-item, sentence, heading-per-skill (routing outside a table), nested-standing and imported-standing: the adapter page names routing table rows and three standing files.
* scan.steps yaml, comments, trailing-commas, keyed-by-id, nested-workflow, and the YAML registry and catalogue items: the adapter page names a JSON file with a `steps` list, and registry files in `.md` or `.json`.

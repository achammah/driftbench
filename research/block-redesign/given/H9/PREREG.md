# H9 pre-registration: the Given verifier finds real hidden Given errors

Lane: given. Branch: `research/block-given`, from origin/main `a7c3280c2`. Written 2026-10-14, before any result.
Protocol: `scratchpad/codex/block-experiments/PROTOCOL.md`. Source: section 5 of `reports/Driftbench block redesign deep.md` (row H9), mechanism M4.1 in its section 2.4, and `deep_4_initial_conditions.md` section (e) M1.

## Hypothesis (verbatim, section 5)
- Claim: "The Given verifier finds real hidden Given errors."
- Experiment: "Seeded defects in 20 clean specs; then `requires: auto` over all example specs."
- Metric: "Detection rate; `not_run` count on specs that pass today."
- Falsified if: "Below 100% on seeded defects, or any clean spec flagged."
- Cost: offline. No model call. Dynamic checks reuse setup only (the deterministic Acme agent and the sandbox seeding code, no network).

## The instrument (M4.1, research prototype)
`research/block-redesign/given/verifier/`: a static pass and a dynamic pass. Each check returns pass, or `not_run` with `kind` (`given_unmet`, `unsupported`, `setup_failed`), `layer`, `check`, `expected`, `got`. Checks run only when their layer is present (`requires: auto`).

| Check | Layer | Pass | Rule |
|---|---|---|---|
| `tool_history_paired` | 2 | static | every prefix tool call has `output` or `error`; ids unique within the prefix. A call from `canonicalGiven` (origin canonical) is a warning, not a `not_run`. |
| `tool_known` | 2, 5 | static | every label in prefix `tool_calls`, `world.tools` and `expect.tools` is a tool of the run target. |
| `history_matches_world` | 2, 5 | dynamic | replaying each recorded call against the block's world (forced `world.tools`, else the target's own tool on `world.store`, no commit) gives the recorded output or error. |
| `value_in_message` | 4 | static | a `shared` fact `{by: user, in: i}` has its ledger value in `prefix[i]`. Match rule: lowercase, keep only letters and digits, substring. |
| `chain` | 4 | static | no block's `ledger_add` contradicts a fact the ledger already holds (core `addFacts`). |
| `capability` | all | static | the run target's adapter declares the capability each present layer needs: prefix needs `seedPrefix`, `world.tools` needs `toolStubs`, `world.workspace` needs `sandbox`, `vars.session_state` or `vars.event` other than `fresh`/`no_hazard` needs the claude-code live adapter. |
| `state_known` | 5 | static | each `session_state` and `event` value names an entry of the state library the target loads (`examples/estates/fixture/live/states/library.json`), or a built-in value. |
| `workspace_resolves` | 5 | dynamic (setup) | `workspace.from` resolves (core `anchorWorkspace` rule) to a readable folder. |
| `workspace_digest` | 5 | dynamic (setup) | seeding `workspace.files` into a fresh folder with the sandbox package and walking it back gives the same path to content map. |
| `summary_present` | 5 | static | a `workspace.from` or a named state carries a visible `summary`. This key does not exist yet, so every existing reference fails it by construction; reported in its own column, never in the headline count. |

## Part A: seeded defects
- Pool: Acme conversation specs that load and run on `function:acme-sales` (the 14 with that target, then the specs under `examples/acme/{golden,gated,generated}` with no target, which the Acme CI campaign runs on `function:acme-sales`), sorted by path.
- Clean spec construction (origin `recorded`, front door): run the deterministic Acme agent through blocks 0..k-1 of the spec with the spec's Given; record the history with every tool call and its result as block k's `prefix`; add `shared` entries for each ledger fact whose value matches a user message of that prefix (by the match rule above), `by: user, in: <index>`. k is the last block.
- Eligible: the recorded prefix holds at least one tool call with a result, and at least one `shared` entry. The first 20 eligible specs by sorted path are the clean set. If fewer than 20 are eligible, all eligible ones are used and the shortfall is reported.
- Defects, one per copy, four per clean spec, 80 copies. The position is drawn with a seeded PRNG (mulberry32, seed = 1000 + spec index):
  1. dropped tool result: delete `output` and `error` of one recorded call. Expected detection: layer 2, `tool_history_paired`.
  2. fact not in its message: replace the value of one `shared` ledger fact by a fictional value absent from the prefix (`ZZ-<seed>`). Expected: layer 4, `value_in_message`.
  3. flipped world row: force `world.tools[label]` for one recorded call to a result that differs from the recorded one (an `error` when it was a result, a different result when it was an error). Expected: layer 5 / 2, `history_matches_world`.
  4. unknown tool: rename the label of one recorded call to `unknown_tool_<seed>`. Expected: layer 2, `tool_known`.
- Detection counts only when the flagged check and layer are the expected ones. Other flags on a defect copy are reported, not counted.
- Clean flag: any `not_run` on any of the 20 clean originals.

## Part B: `requires: auto` over all example specs
- Population: every file `findSpecFiles(['examples'])` returns that loads (2,351 at the base commit). "Passes today": loads and `lintSpec` gives no issue of severity error.
- Run target: the spec's `target`; a spec without one under `examples/acme/` uses `function:acme-sales`; any other spec without a target is counted as `target unresolved` and gets only target-free checks.
- Teacher-forced gap: for every block of every spec, run core `canonicalGiven` and count tool calls without a result (the `canonicalReply` gap, reported as warnings for origin canonical).
- Report: `not_run` count by kind, layer and check, on specs that pass today, with `summary_present` in its own column. Every distinct (check, reason) class is read and labelled "hidden Given error" or "over-strict check", with the reason; for classes larger than 10 cases, every case is listed in `results.json` and 10 are read by hand, chosen by the seeded PRNG (seed 9).

## Sample size, seeds, models, stop rule
- 20 clean specs, 80 defect copies; PRNG seeds 1000 + i and 9. No model, no paid call. Stop rule: none (offline, run once). A re-run only after a crash, with both results kept.

## Amendment 1 (2026-10-14, before any data, before the clean set was built)
- Change: a spec is eligible for Part A only if the forced `world.tools` and `world.store` in force at block k equal those in force at every earlier block (the running Given does not change them between blocks).
- Reason: a prefix records each call without the world it ran under. When a spec's world changes between blocks (a service that recovers), a correct recorded call can disagree with block k's world, and `history_matches_world` cannot tell that from a planted contradiction. That needs a per-call world in the schema, which is a design finding, not a defect of the clean spec. The limitation is reported in RESULTS.md.
- `history_matches_world` rule, stated exactly: for each recorded call, if block k's `world.tools` forces the label, the recorded `error` or `output` must equal the forced one; otherwise replaying the call with the target's own tool on block k's `world.store` (no commit) must give the recorded outcome (deep equality).

## Verdict rule
- FALSIFIED if detection is below 80 of 80 with the right layer, or any clean original is flagged.
- SUPPORTED if detection is 80 of 80, no clean spec is flagged, and Part B finds at least one class read as a hidden Given error.
- INCONCLUSIVE if Part A passes and Part B finds only over-strict classes (the verifier works but found nothing real), with the reason.

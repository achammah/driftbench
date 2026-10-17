# Estate unit runner evidence

Source baseline: `de43bbbfef822ccecd6537aa09ec0f39d29ebe6d`. Branch: `feat/estate-level4-runner`.

## Scope and result

The opening sections record the baseline and earlier measurements. The approved metadata measurement below records the current result.

The runner executes explicit task-spec operations and recorded JSON unit tests. The generated bank specs at this baseline omit `metadata.estate.unit`; accepting their YAML alone does not make them executable. No bank gain is claimed until the generator supplies runnable operations and their independent oracles. No validator code, threshold, fixture or bank is changed.

## Baseline measurements

Level 4 is called directly through `BANK_LEVELS[3]` and `levelMeasure` from an uncommitted local script. No other level runs.

| Seed | Level 4 passing | Unit runner passing |
|---|---:|---:|
| 1 | 199/270 | 0/41 |
| 2 | 198/270 | 0/41 |
| 3 | 198/270 | 0/41 |
| hidden (729980927) | 199/270 | 0/41 |
| 4 | 198/270 | 0/41 |
| 5 | 200/270 | 0/41 |
| 6 | 200/270 | 0/41 |
| 7 | 196/270 | 0/41 |
| 8 | 199/270 | 0/41 |
| 1009 | 200/270 | 0/41 |

The bank declares `unit.runner` seed-free: one evaluation is reused across seeds in a process. These seed labels do not establish diverse unit fixtures. The independent hand-written tests below supply different estates.

## Causes

- G: Guard task specs provide asks and assertions but no executable guard payload metadata. The old command rejects their YAML before executing a case. There are 31 items.
- S: Script task specs have the same format mismatch. Their task assertions only require code to run, with no independent exit/output oracle. There are 4 items.
- H: Helper task specs have the same format mismatch and no configured helper executor. A nonempty prompt is not execution. There are 6 items.

| Item | Cause |
|---|---|
| `unit.runner.green-block-force-push.sh` | G |
| `unit.runner.allow-all-block-force-push.sh` | G |
| `unit.runner.block-all-block-force-push.sh` | G |
| `unit.runner.green-read-before-edit.py` | G |
| `unit.runner.allow-all-read-before-edit.py` | G |
| `unit.runner.block-all-read-before-edit.py` | G |
| `unit.runner.green-ledger-guard.py` | G |
| `unit.runner.allow-all-ledger-guard.py` | G |
| `unit.runner.block-all-ledger-guard.py` | G |
| `unit.runner.green-stop-word.sh` | G |
| `unit.runner.allow-all-stop-word.sh` | G |
| `unit.runner.block-all-stop-word.sh` | G |
| `unit.runner.green-reply-length.py` | G |
| `unit.runner.allow-all-reply-length.py` | G |
| `unit.runner.block-all-reply-length.py` | G |
| `unit.runner.green-check-carrier.sh` | G |
| `unit.runner.allow-all-check-carrier.sh` | G |
| `unit.runner.block-all-check-carrier.sh` | G |
| `unit.runner.message-block-force-push.sh` | G |
| `unit.runner.message-ledger-guard.py` | G |
| `unit.runner.message-reply-length.py` | G |
| `unit.runner.timeout-read-before-edit.py` | G |
| `unit.runner.report-message-block-force-push.sh` | G |
| `unit.runner.report-message-ledger-guard.py` | G |
| `unit.runner.report-message-reply-length.py` | G |
| `unit.runner.report-time-block-force-push.sh` | G |
| `unit.runner.report-time-read-before-edit.py` | G |
| `unit.runner.report-time-ledger-guard.py` | G |
| `unit.runner.report-time-stop-word.sh` | G |
| `unit.runner.report-time-reply-length.py` | G |
| `unit.runner.report-time-check-carrier.sh` | G |
| `unit.runner.helper-green-inbox-triager` | H |
| `unit.runner.helper-broken-inbox-triager` | H |
| `unit.runner.helper-green-ledger-auditor` | H |
| `unit.runner.helper-broken-ledger-auditor` | H |
| `unit.runner.helper-green-route-planner` | H |
| `unit.runner.helper-broken-route-planner` | H |
| `unit.runner.script-green-reconcile.py` | S |
| `unit.runner.script-broken-reconcile.py` | S |
| `unit.runner.script-green-track.sh` | S |
| `unit.runner.script-broken-track.sh` | S |

## General product changes

- Task specs declare concrete operations in `metadata.estate.unit`. JSON recorded-unit behavior remains supported.
- Guard payloads execute the current configured guard, from the copied project working folder. Firings are classified from actual runtime results.
- Guard counts, messages, completion budgets and exact case outcomes are asserted without mining source literals or changing expected labels to fit the result.
- Script processes honor the declared shebang and fixture stdin. Script assertions need a declared fixture, an expected case outcome, or an explicit expected exit code.
- Unavailable operations and oracles produce input errors. Their absence cannot count as a successful mutant kill.

## Independent verification

Command: `pnpm exec vitest run packages/cli/test/estate-unit-spec.test.ts packages/estate/test/unit/declared-runtime.test.ts packages/cli/test/estate-unit.test.ts packages/estate/test/unit/run.test.ts`. Result: 26 tests pass.

New hand-written estates exercise YAML/JSON task loading; real guard message and elapsed-time reporting; allow-all mutation detection; runtime warn/nudge/deny semantics; shebang selection; script stdin and exact outputs; project-relative guard commands; and refusal of absent script oracles and helper executors. The original JSON runner tests also pass, including recording, mutants, jobs and process cleanup.

The two new low-level execution tests fail before the shebang/stdin/working-folder fix and pass afterward. The YAML regression fails against the original command with a not-JSON error and passes after task-spec dispatch is restored.

Repository typecheck reports four errors outside the changed files: missing `mammoth`, the excluded `comparisons/langfuse/pointwise-fact-ledger/replay` import, and two resulting implicit-any errors. No changed-file diagnostic appears in that run.

## Post-change measurement

The assigned group remains 0/41 on seeds 1, 2, 3, hidden 729980927, 4, 5, 6, 7, 8 and 1009. Every selected generated task spec lacks the explicit executable operation metadata. The command now reports that missing input directly. No mutation-kill gain is credited to an input error.

## Remaining work

The generator owner must emit the explicit operation metadata. Script tests need independent output/exit expectations, and helper tests need actual executor observations. The runner does not infer correctness from usage words or infer helper behavior from prompt presence. Re-measure the group after those dependencies land.

## Explicit payload fidelity follow-up

A further hand-written Stop guard reads both the explicitly supplied `last_reply` and the canonical `last_assistant_message`. Before the fix, the task run loses the supplied key and raises `KeyError`. Explicit task operations now retain supplied keys and empty values, while recorded JSON tests keep their existing shorthand conversion. The new regression and the existing runner set pass: 27 tests.

A separate compatibility probe consumes the generator owner's actual pending operation metadata from temporary suite `hFkCXt`, without changing that owner's files. Of 18 guard-negative, speed and register task specs on the original estate, 16 pass. The two reply-length speed/register payloads contain a short rule sentence, which does not exceed the guard's length condition. This is compatibility evidence on uncommitted generator output, not bank credit.

## Script assertion conformance follow-up

Four independent regressions expose dropped `ran_code: false`, dropped command limits, an ignored custom script check, and an exit expectation wrongly applied to every fixture rather than the last command. All four fail before the fix. Script operations now enforce the execution contract; unsupported custom checks and cross-operation assertions are input errors. Per-case outcomes still judge every fixture separately. All 31 targeted runner tests pass after the fix.


## Approved metadata dependency

The narrow dependency from `6b5ef95daa628c462c61040182faf5778a7d38aa` supplies only `packages/generate/src/estate/build-row.ts`, `packages/generate/src/estate/unit.ts`, their `packages/generate/test/estate/unit.test.ts` test, and that commit's changed fixture snapshots. All 40 inherited files are byte-identical to the source commit. The commit message and PR body enumerate every path.

These files generate declared operation metadata and input cases. They do not score execution, infer script success from usage words, count a helper prompt as a run, or mine executable source literals. Rule quotations generate inputs; actual process observations determine outcomes. No runner, `then.ts`, export barrel, reader, scanner, or lint code is inherited.

After inheritance, all 47 targeted tests pass across the four runner test files above and the inherited generator unit test file. Biome checks the changed runner and inherited generator sources without findings. Targeted typecheck remains blocked only by the existing missing `mammoth` dependency in `packages/artifacts/src/docx.ts:312`.


## Measurement with the approved metadata

Instrument: the direct level-4 `unitFamily()` through `levelMeasure`, without running other levels or changing validators. Tested runtime source: `37d3c3c495996daa0202c7d2d1b0cb6b73e0922d` plus the byte-identical approved dependency from `6b5ef95da`. Only this report and the estate journal change after measurement.

| Seeds | Before | After |
|---|---:|---:|
| 1, 2, 3, hidden 937625092 | 0/41 | 29/41 |
| 4, 5, 6, 7, 8, 1009 | 0/41 | 29/41 |

The bank declares this family seed-free and reuses its first result across these seeds. The gain is on the assigned fixed bank; diverse behavior is checked by the independent handwritten estates.

Every item in the original 41-item table passes except the 12 below. Each has the same result on all measured seeds.

| Remaining item | Cause |
|---|---|
| `unit.runner.green-reply-length.py` | The generated Stop payload is the short rule sentence, not an over-limit reply. The real guard allows it and emits no blocking message. |
| `unit.runner.report-message-reply-length.py` | The generated Stop payload is the short rule sentence, not an over-limit reply. The real guard allows it and emits no blocking message. |
| `unit.runner.helper-green-inbox-triager` | No configured helper executor. The runner refuses to count prompt presence as execution. |
| `unit.runner.helper-broken-inbox-triager` | No configured helper executor. The runner refuses to count prompt presence as execution. |
| `unit.runner.helper-green-ledger-auditor` | No configured helper executor. The runner refuses to count prompt presence as execution. |
| `unit.runner.helper-broken-ledger-auditor` | No configured helper executor. The runner refuses to count prompt presence as execution. |
| `unit.runner.helper-green-route-planner` | No configured helper executor. The runner refuses to count prompt presence as execution. |
| `unit.runner.helper-broken-route-planner` | No configured helper executor. The runner refuses to count prompt presence as execution. |
| `unit.runner.script-green-reconcile.py` | The generated spec requires unsupported custom some_call and declares no independent expected exit/output. Missing input is not a mutant kill. |
| `unit.runner.script-broken-reconcile.py` | The generated spec requires unsupported custom some_call and declares no independent expected exit/output. Missing input is not a mutant kill. |
| `unit.runner.script-green-track.sh` | The generated spec requires unsupported custom some_call and declares no independent expected exit/output. Missing input is not a mutant kill. |
| `unit.runner.script-broken-track.sh` | The generated spec requires unsupported custom some_call and declares no independent expected exit/output. Missing input is not a mutant kill. |

The reply-length guard actually checks a reply above its limit; its generated hostile/register/speed cases do not cross that limit. Fixing those inputs belongs to the generator owner. Its existing `max_characters` evidence can supply a declared boundary without reading implementation literals. No further generation change is made under the narrow inheritance approval.

Helper execution needs an actual configured runtime and observations. Script correctness needs declared valid fixtures with expected exit/output and trace-backed support for the requested checks. No paid calls run.

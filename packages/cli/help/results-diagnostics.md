---
title: "Diagnostics: who failed, and where the fix goes"
summary: "Five shipped diagnostics read failed blocks: who made the mistake, how it counts for the agent, where one fix stops it, which confirm runs settle it, which blocks are flaky."
commands: []
see_also:
  - results-report
  - results-scorecard
  - recipes-find-why-a-test-failed
---

## What it is

A diagnostic is a rule file of the object kind `diagnostic`. It runs after the checks, reads what a run stored,
and writes diagnoses. A diagnosis never changes a verdict or the machine pass of a block. Five ship as TypeScript data in
`packages/checks/src/blame/diagnostics.ts`. The YAML under `packages/checks/objects/diagnostic/` is a reviewed copy
that tests compare with the data:

| Diagnostic | Scope | Steps | What it writes |
|---|---|---|---|
| `code-agent-liability` | block | `chain`, `evidence`, `attribute`, `place` | for each failing gating verdict: `fault` (agent, skill, tool, test, env, setup), `disposition` (agent, shared, setup, excluded, credited, unassigned), `fix_location`, `fix_target`, `fix_action`, `fix_forms`, and the blame item and the placement item that decided it |
| `value-mismatch` | block | `chain`, `evidence`, `attribute` | for each failing gating tools input verdict: outcome `unknown`, disposition `unassigned`, flag `lint:value_ladder_unavailable`. This diagnostic does not read the value check's record yet, so no blame item is applied |
| `fix-plan` | campaign | `recurrence`, `replace`, `merge`, `rank` | one fix per target and action, ranked by the failing blocks it explains (the agent's first), then cost; a core fix that replaces local fixes lists them as copies to remove |
| `liability-confirm` | campaign | `plan`, `run`, `store`, `rejudge` | the cheapest run that could change each open diagnosis, made only within its budget, then `code-agent-liability` again |
| `flaky-block` | campaign | `disagreement` | blocks whose repeats both pass and fail, with their pass share |

The four steps of `code-agent-liability`:

1. `chain`: only the earliest failing verdict of a chain is attributed. A later verdict inherits that diagnosis
   when it shares the tool or the file, follows a broken tool, or checks the tool order.
2. `evidence`: the evidence names of each root verdict, from the stored run and the estate map (see
   `docs/reference/blame.md`, "Evidence names").
3. `attribute`: `policy/blame`, first match in order (see `docs/reference/blame.md`).
4. `place`: `policy/placement`, with the recurrence known so far.

Both policies are rule files too. Their items are listed in `docs/reference/blame.md`.

A confirm run is the only part that may run an agent. It asks one question per open diagnosis: the skill forced
into context, the rule repeated as a hint, or a reference agent. Its budget ships at 0 USD, so by default no
billed run is made and every diagnosis keeps its static reading.

The checks initializer registers the shipped objects and the executable steps through `registerDiagnosticStep`.
The core runner runs the block diagnostics a spec selects with `uses.diagnostics`, and `runCampaignDiagnostics`
runs the campaign diagnostics. A stored block diagnosis keeps the deciding rule in `by` and the executing step in
`via`. `blame.diagnosticKindReady()` says whether the registry declares the fields the diagnostic files use.

Campaign steps read core `CampaignDiagnosis` records with `runId`, `blockIndex`, `verdictRef` and the nested
diagnosis. Run-level records, and records without a verdict, do not enter the block recurrence counts. The runner
context supplies no confirm runner. Confirmation stays static unless a direct library caller supplies one. A
positive budget alone does not configure that service.

## When to use it

* A block failed, and you need to know what to change. The answer is the test, the environment, a tool, a
  skill's description, body or layout, the agent's core prompt, or the model. The placement law decides where: a
  mistake in one skill is fixed in that skill. The same mistake in two or more skills is fixed in the core prompt,
  or in a guard when code can check it.
* After a campaign, to get one ranked list of fixes. A mistake seen in two or more skills becomes one core fix,
  not several local ones.
* When a diagnosis is `undecided`, to see which confirm run would settle it and what that run would cost.
* Before you trust a failure, to see whether its block is flaky across repeats.

Do not use it:

* To pass or fail a block. The machine verdict stays final.
* To count a run with `unassigned` diagnoses for or against the agent: report it apart.
* To confirm a fix on its wording. `checkFixRemoval` counts the behaviour the blame item names.

## Commands and every option

No command prints the diagnoses. These are the library calls of the `blame` namespace of
`@agent-nexus/driftbench-checks`. The core runner calls the same steps.

| Call | What it does | Defaults |
|---|---|---|
| `diagnoseBlock(options)` | `code-agent-liability` on one block: chain, evidence, attribute, place. Options in `docs/reference/blame.md` | `chain`: on |
| `blockEvidenceInputs(source)` | Joins a stored block with its spec and the estate map into the `evidenceFor` that `diagnoseBlock` reads | see below |
| `checkEvidenceInputs(ctx, verdicts, extra?)` | The same, from the context the checks ran with | `extra`: none |
| `fixPlan(diagnoses, placement, n?)` | `fix-plan` over a campaign's diagnoses, each with its `block` | `n`: `10` |
| `replace(diagnoses, placement)` | Only the re-placement step: diagnoses whose mistake recurs in enough homes move to the core prompt | none |
| `planConfirm(diagnoses, runs?)` | The `plan` step of `liability-confirm` | `runs`: `3` |
| `runConfirm(plan, { budgetUsd, runner?, quote?, free? })` | The `run` and `store` steps. Before each billed call, `quote(run)` gives an upper bound of its cost. The call runs only when that quote fits the budget left, and the runner gets it as `{ maxCostUsd }`. A call with no quote is skipped. `free: true` runs a stand-in whatever the budget | no runner: nothing runs. No `quote`: no billed call |
| `checkFixRemoval(item, before, after, bar?)` | Whether a fix removed the behaviour a blame item names, between runs before and after it | `bar`: `0.8` |
| `flakyBlocks(runs, minRepeats?)` | `flaky-block` over stored runs | `minRepeats`: `2` |
| `diagnosticKindReady(registry?)` | Whether the `diagnostic` kind accepts the files' `scope`, `when`, `reads`, `output` and `cost` | the global registry |

The fields of `blockEvidenceInputs(source)`:

| Field | Meaning | Default |
|---|---|---|
| `observed`, `verdicts` | the stored block's observation and verdicts | required |
| `expect` | the spec block's `expect`: its tools give the order, its skills the routed skills, its `protected` paths the files it guards | none |
| `user` | the user turn the agent received | none |
| `spec`, `specPath` | the spec, for `metadata.estate.atoms`, `metadata.estate.map` and `metadata.tool_schemas`; the map path resolves from the spec's folder | none; the map path then resolves from the working folder |
| `map` | the estate map, when you read it yourself | read from `metadata.estate.map` |
| `confirm` | stored confirm counts by verdict id, such as `{ runs: 3, reference_loads: 0 }` | none |
| `valuePolicy` | the `policy/value-check` object the block resolved: it tells which implementation a stored rung id names | the shipped default |
| `planRows`, `extra` | plan rows that name the rule's atom; any other evidence input field | none |

The params a file that extends a shipped diagnostic may set:

| Diagnostic and step | Param | Shipped value | Meaning |
|---|---|---|---|
| `code-agent-liability`, every step | `emit` | `false`; `true` on `place` | the step that writes the diagnoses; the others add to the block's working state |
| `value-mismatch`, every step | `emit` | `false`; `true` on `attribute` | the same |
| `fix-plan#rank` | `n`, `by` | `10`, `[agent_blocks, blocks, cost_class]` | how many fixes the list keeps, and the ranking keys |
| `liability-confirm#plan` | `runs` | `3` | runs per confirm question; 2 of 3 counts as passing |
| `liability-confirm#run` | `runs`, `budget_usd`, `reference_target` | `3`, `0`, `null` | the most a billed run may spend, and the target a reference run uses |
| `liability-confirm#rejudge` | `diagnostic` | `code-agent-liability` | the diagnostic run again with the stored counts |
| `flaky-block#disagreement` | `min_repeats` | `2` | the fewest repeats before a block can be flagged |

To attribute every failing verdict on its own, disable the `chain` step. To keep the blame item's own fix
location, disable `place` and set `emit: true` on `attribute`.

## Inputs

* The stored runs of a campaign: `openStore(<file>).listRuns()` from `@agent-nexus/driftbench-store`.
* For each block: its verdicts and what was observed. That covers tool calls with their full input, file reads,
  commands with exit codes, guard decisions and the workspace diff.
* For an estate spec: the atoms it enforces (`metadata.estate.atoms`) and the estate map (`metadata.estate.map`).
  The map gives each rule's file and line, kind, situation and enforcing guards.
* For a value failure: the value check's record of each failing value (`valueCheck` on the verdict), when the value check ran.
* For `liability-confirm`: a runner. A stand-in command runs free; a reference target is billed.

## Outputs and how to read them

`diagnoseBlock` writes one diagnosis per failing gating verdict; the fields are in `docs/reference/blame.md`. Read
`disposition` first:

| Disposition | Counts against the agent | Means |
|---|---|---|
| `agent` | yes | the agent broke a rule it could see |
| `shared` | yes | a tool or skill failed, and the agent did not recover |
| `setup` | no | a rule nobody wrote, or a tool or skill that misled a careful agent |
| `excluded` | no | the test or the environment was invalid |
| `credited` | no | the result works; the check demanded a form nobody states |
| `unassigned` | reported apart | no item matched |

`confidence` is `static` until a confirm run decides. The `flags` of a diagnosis can hold:

| Flag | Means |
|---|---|
| `run_liability_confirm` | a confirm run could decide this diagnosis |
| `provisional` | placed with no history, so placement counts one home |
| `class_rule:<wording>` | a core fix, with the class wording |
| `escape:<kind>:<text>` | a proposed fix text names a skill, a file or a value |

`fixPlan` returns `{ fixes, unassigned, moved }`. Each fix:

| Field | How to read it |
|---|---|
| `id` | `<fix_location>:<fix_target>:<fix_action>`, or `local:<target>` for a copy to remove |
| `fix_location`, `fix_target`, `fix_action`, `fix_forms` | where the change goes, and what it is |
| `blocks`, `agent_blocks` | failing blocks the fix explains, and how many of them count against the agent |
| `rules` | the blame items behind it |
| `remove_copies` | the local fixes this one replaces |
| `superseded_by` | on a local fix: the core fix that replaces it. It stays listed, ranked last |
| `confidence` | the least sure confidence of its diagnoses |
| `rule_text` | for a core fix that replaces copies: a class wording that names no skill, file or value |
| `cost_class` | 1 a description line, 2 a body rule, 3 a core rule, 4 a guard, 5 a model change |

`unassigned` counts root diagnoses no item matched. `moved` counts local fixes a core fix replaced.

`planConfirm` returns one entry per run: `block`, `verdict_ref`, `item`, `kind` (`forced_load`, `hint`,
`reference` or `reference_load`), `runs` and `why`. `runConfirm` returns `runs_made`, `cost_usd`,
`skipped_for_budget` (planned runs left out), `stored` (the counts per `<block> <verdict>`) and `reason` when
nothing ran. Pass `stored` back as `confirm` to `blockEvidenceInputs` to diagnose again.

`flakyBlocks` returns one row per spec, target, mode and block that has at least `minRepeats` repeats. A row holds
`repeats`, `passes`, `pass_share` and `flaky`. `flaky` is true when the repeats both passed and failed.

`checkFixRemoval` returns four fields.

| Field | Meaning |
|---|---|
| `behaviour`, `wording` | 1 minus the rate after over the rate before, or null |
| `confirmed` | true when `behaviour` is at or above the bar |
| `flags` | `removes_wording_not_behaviour`, `no_failures_before`, `no_behaviour_measure` |

## Worked example

The Northwind estate's three recorded sessions, replayed offline over specs generated from the estate tests' hand
plan, into a store. Two sessions fail as planned; the clean one passes. Then the Acme conversations run twice, for
the flaky check.

```sh
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out out
driftbench replay examples/estates/fixture/sessions/weekly-clean.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.jsonl examples/estates/fixture/sessions/weekly-gate-violated.jsonl --decisions examples/estates/fixture/sessions/weekly-clean.decisions.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.decisions.jsonl examples/estates/fixture/sessions/weekly-gate-violated.decisions.jsonl --steps examples/estates/fixture/sessions/weekly-clean.steps.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.steps.jsonl examples/estates/fixture/sessions/weekly-gate-violated.steps.jsonl --suite out/specs/replay --store runs.db # exit 1
driftbench campaign run --config examples/acme/ci/campaign.yaml --mode F --store acme.db
```

```text
$ driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out out
Map ../examples/estates/fixture/approved.yaml (claude-code), hash be2e7a0919cb: 125 atoms.
Plan ../packages/generate/test/estate/fixtures/plan.yaml: 37 rows, 36 approved, 0 waiting, 1 struck.
Phrases ../examples/estates/fixture/phrases.yaml: 26 situations, 50 approved phrases.
Sessions ../examples/estates/fixture/sessions/index.yaml: 3.
Seed 1; custom checks the runner registers: grounded_values, guard_finished, guard_message, hazard_recovery, max_words, no_delete_under, ordered, permission, some_call, stage_seen.

Test type           rows  specs  complete  incomplete
obligation             4      8         8           0
outside_trigger        1      1         1           0
twin                   1      1         1           0
ordered_pair           2      4         4           0
skip_pressure          1      1         1           0
route_positive         2      2         2           0
route_near_miss        1      1         1           0
misroute               1      1         1           0
read_when              1      1         1           0
script_fixture         1      1         1           0
dispatch               1      1         1           0
contract_alone         1      1         1           0
stop_resume            1      1         1           0
guard_positive         1      1         1           0
guard_negative         1      1         1           0
guard_hostile          1      1         1           0
guard_speed            1      1         1           0
guard_register         1      1         1           0
tool_boundary          1      1         1           0
tool_denied            1      1         1           0
tool_deferred          1      1         1           0
stage_order            1      3         3           0
stage_skip             1      1         1           0
stage_anytime          1      1         1           0
register_sample        3      3         3           0
hazard_recovery        1      1         1           0
invariant              1      1         1           0
journey                2      2         2           0
total                        44        44           0

Asks of the complete specs: 31 approved phrases, 0 written by code, 12 recorded sessions, 1 with no ask.
Judged by a criterion from the rule's own words (no code checks it): 0 complete specs.
Outcomes of the complete specs: 43 bank, 1 static.
Run order: run-order.txt lists the complete specs, focus atoms first, then guards, gates and invariants.
Static tests: 1 in static/ (invariants and settings), run by driftbench estate static on an estate root.
Unit tests: 5 in unit/ (2 guards, 1 scripts, 12 payloads), run by driftbench estate unit: --record on the original first, then on any copy.
Catalogue checks: 0 tested through their host hook, 0 need a trigger, 0 need a host hook.
Replay: 12 specs aligned to sessions, 10 planned to pass, 2 to fail.
Wrote 51 files to out.
(exit 0)
$ driftbench replay examples/estates/fixture/sessions/weekly-clean.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.jsonl examples/estates/fixture/sessions/weekly-gate-violated.jsonl --decisions examples/estates/fixture/sessions/weekly-clean.decisions.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.decisions.jsonl examples/estates/fixture/sessions/weekly-gate-violated.decisions.jsonl --steps examples/estates/fixture/sessions/weekly-clean.steps.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.steps.jsonl examples/estates/fixture/sessions/weekly-gate-violated.steps.jsonl --suite out/specs/replay --store runs.db
✓ estate.p01.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p01.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✗ estate.p01.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
    failing: block 0: skills.weekly-report
✓ estate.p03.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p03.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✓ estate.p03.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
✓ estate.p02.weekly-clean  session weekly-clean from block 0 (metadata)
✗ estate.p02.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
    failing: block 0: custom.ordered.Read.Edit
✓ estate.p02.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
✓ estate.p04.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p04.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✓ estate.p04.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
12 specs replayed: 10 pass, 2 fail. Judge none, 0.0000 USD. Campaign replay-b52e43884115.
(exit 1)
$ driftbench campaign run --config examples/acme/ci/campaign.yaml --mode F --store acme.db
Campaign c-798493ab512e: 12 cells, 2 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 1  pass  4 blocks
✓ acme-number-porting · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme-sales · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme-sales · F · repeat 1  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme-sales · F · repeat 1  pass  4 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 1  pass  5 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 1  pass  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
```

The script reads both stores and runs the diagnostics from source with `tsx`; this file tells `tsx` where the
packages are:

```json file=tsconfig.json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "paths": {
      "@agent-nexus/driftbench-example-acme": ["./examples/acme/src/package.ts"],
      "@agent-nexus/driftbench-adapters/contract": ["./packages/adapters/src/contract.ts"],
      "@agent-nexus/driftbench-*": ["./packages/*/src/index.ts"]
    }
  }
}
```

```ts file=diagnose.mts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blame } from '@agent-nexus/driftbench-checks';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';

// The replay specs, by id.
const specs = new Map();
for (const name of readdirSync('out/specs/replay', { recursive: true }) as string[]) {
  if (!/\.ya?ml$/.test(name)) continue;
  const path = join('out/specs/replay', name);
  const loaded = parseSpecText(readFileSync(path, 'utf8'), 'yaml', path);
  if (loaded.ok) specs.set(loaded.spec.id, { spec: loaded.spec, path });
}
const store = await openStore('runs.db');
const runs = (await store.listRuns()).filter((run) => specs.has(run.specId));
await store.close();

const policy = blame.shippedPolicy('policy/blame');
const place = blame.shippedPolicy('policy/placement');
const diagnose = (run, confirm?) => {
  const { spec, path } = specs.get(run.specId);
  const block = run.blocks[0];
  const expect = spec.blocks[0]?.expect;
  return blame
    .diagnoseBlock({
      verdicts: block.verdicts,
      evidenceFor: blame.blockEvidenceInputs({
        observed: block.observed,
        verdicts: block.verdicts,
        ...(expect === undefined ? {} : { expect }),
        spec,
        specPath: path,
        ...(confirm === undefined ? {} : { confirm }),
      }),
      blame: policy,
      placement: place,
    })
    .diagnoses.map((one) => ({ ...one, block: run.specId }));
};

// 1. code-agent-liability on every stored block.
const all = runs.flatMap((run) => diagnose(run));
console.log(`${runs.length} blocks, ${all.length} diagnoses`);
for (const one of all) {
  console.log(`${one.block}  ${one.verdict_ref}`);
  console.log(`  ${one.item}: fault ${one.fault.join('+')}, ${one.disposition}, ${one.confidence}, fix ${one.fix_action} at ${one.fix_location}${one.fix_target ? ` (${one.fix_target})` : ''}, flags ${one.flags.join(' ')}`);
}

// 2. liability-confirm: what could settle the open diagnoses, at the shipped budget, then with a free stand-in.
const plan = blame.planConfirm(all);
for (const run of plan) console.log(`plan: ${run.block} ${run.verdict_ref} ${run.kind} x${run.runs}: ${run.why}`);
// The stand-in answers like a reference agent that never loads the skill: 0 passes, 0 loads, no cost.
const runner = () => ({ passes: 0, loads: 0, costUsd: 0 });
const unset = await blame.runConfirm(plan, { budgetUsd: 0 });
console.log(`no runner: ${unset.runs_made} runs. ${unset.reason}`);
const none = await blame.runConfirm(plan, { budgetUsd: 0, runner });
console.log(`budget 0: ${none.runs_made} runs, ${none.skipped_for_budget} skipped. ${none.reason}`);
const standIn = await blame.runConfirm(plan, { budgetUsd: 0, free: true, runner });
console.log(`stand-in: ${standIn.runs_made} runs, stored ${JSON.stringify(standIn.stored)}`);
for (const run of runs) {
  const confirm = Object.fromEntries(
    Object.entries(standIn.stored)
      .filter(([key]) => key.startsWith(`${run.specId} `))
      .map(([key, value]) => [key.slice(run.specId.length + 1), value]),
  );
  if (Object.keys(confirm).length === 0) continue;
  for (const one of diagnose(run, confirm)) console.log(`after confirm: ${one.verdict_ref} ${one.item}, ${one.disposition}, ${one.confidence}, fix ${one.fix_action} at ${one.fix_location} (${one.fix_target})`);
}

// 3. fix-plan over every diagnosis.
const fixes = blame.fixPlan(all, place);
console.log(`fix plan: ${fixes.fixes.length} fixes, ${fixes.unassigned} unassigned, ${fixes.moved} moved`);
for (const fix of fixes.fixes) console.log(`  ${fix.id}: ${fix.blocks} block(s), ${fix.agent_blocks} the agent's, cost class ${fix.cost_class}`);

// 4. A fix checked on behaviour, not wording: before, 4 failing runs with no tool call that name the town;
//    after, the same 4 failures, which no longer name the town.
const before = Array.from({ length: 4 }, () => ({ failed: true, slot_called: false, reply_names_town: true }));
const after = Array.from({ length: 4 }, () => ({ failed: true, slot_called: false, reply_names_town: false }));
console.log(JSON.stringify(blame.checkFixRemoval('R6', before, after)));

// 5. flaky-block over the Acme runs.
const acme = await openStore('acme.db');
const rows = blame.flakyBlocks(await acme.listRuns());
await acme.close();
console.log(`flaky-block: ${rows.length} blocks with 2 or more repeats, ${rows.filter((row) => row.flaky).length} flaky`);
```

```sh setup
tsx diagnose.mts
```

```text
$ tsx diagnose.mts
12 blocks, 2 diagnoses
estate.p01.weekly-skill-skipped  skills.weekly-report
  skill_not_loaded_undecided: fault agent+skill, shared, undecided, fix rewrite_description at skill.trigger (skill:weekly-report#description), flags run_liability_confirm also:routing_rows provisional
estate.p02.weekly-gate-violated  custom.ordered.Read.Edit
  core_rule_caught: fault agent, agent, static, fix none_enforced at none, flags provisional
plan: estate.p01.weekly-skill-skipped skills.weekly-report reference_load x3: does the description cover the ask?
no runner: 0 runs. no confirm runner is set (no stand-in command and no reference target): every diagnosis stays static
budget 0: 0 runs, 3 skipped. budget 0 USD: no billed run is made; every diagnosis stays static
stand-in: 3 runs, stored {"estate.p01.weekly-skill-skipped skills.weekly-report":{"runs":3,"reference_loads":0}}
after confirm: skills.weekly-report skill_not_loaded_uncovered, setup, static, fix rewrite_description at skill.trigger (skill:weekly-report#description)
fix plan: 1 fixes, 0 unassigned, 0 moved
  skill.trigger:skill:weekly-report#description:rewrite_description: 1 block(s), 1 the agent's, cost class 1
{"item":"R6","behaviour":0,"wording":1,"confirmed":false,"flags":["removes_wording_not_behaviour"]}
flaky-block: 26 blocks with 2 or more repeats, 0 flaky
(exit 0)
```

How to read it:

* The clean session gets no diagnosis: its block passed.
* `weekly-gate-violated` fires `core_rule_caught`: a guard denied the edit before the read, and the agent then
  complied. It counts against the agent, with no fix to make (`none_enforced`).
* `weekly-skill-skipped` fires `skill_not_loaded_undecided`: the weekly report skill was not loaded, and nothing
  says whether its description covers the ask. It is `shared` and `undecided`, flagged `run_liability_confirm`.
* `planConfirm` plans one question for it: does a reference agent load the skill on this ask? With no runner,
  or at the shipped budget of 0 with a billed runner, no run is made. The free stand-in reports that a reference
  agent loads the skill 0 of 3 times, so the description does not cover the ask. The diagnosis becomes
  `skill_not_loaded_uncovered`, `setup`, fixed in the skill's description.
* The fix check removes the wording: every reply named the town before, none after. It does not remove the
  behaviour: the agent still never calls the tool. So the fix is not confirmed.
* The Acme agent is deterministic: no block is flaky.

## Common errors

* A diagnosis says `unassigned`: no blame item matched. Pass more of what the items read: the spec, the estate
  map and `expect`. Or add an item in a project file that extends `policy/blame:default`. Or link the failing
  check to the line it enforces, so `rule_home` is known.
* Every diagnosis is `provisional`: no history was given, so placement counts one home. `fix-plan` over a
  campaign counts the homes and moves a recurring fix to the core prompt.
* `liability-confirm` changed nothing: no confirm runner is configured, or its budget prevents billed runs. A direct
  library caller must supply a runner and a cost quote for billed calls. A free stand-in needs no budget.
* `runConfirm` returns `no confirm runner is set (no stand-in command and no reference target): every diagnosis
  stays static`: give it a runner.
* `runConfirm` returns `budget 0 USD: no billed run is made; every diagnosis stays static`: raise `budgetUsd`, or
  pass a stand-in runner with `free: true`.
* `confirm runner exceeded its quoted cost cap of <quote> USD` (thrown): a billed runner reported a cost above the quote it was given. The runner must enforce `maxCostUsd` before each paid call.
* `checkFixRemoval` flags `no_behaviour_measure`: only `R3` and `R6` have a behaviour measure.
* A project object that extends `policy/blame:default` names an item the default does not hold. The load is
  refused, and the message lists the items it holds (see `docs/reference/blame.md`).

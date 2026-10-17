---
title: Find why a test failed
summary: From a failing cell to its cause on Acme. The path goes through the failing verdicts, their evidence, the drift class, the drilldown, a determinism check and an offline replay.
commands:
  - campaign run
  - ci
  - campaign status
  - report
  - view
  - smoke
  - replay
see_also:
  - core-exit-codes
  - recipes-test-a-chat-agent
  - recipes-gate-in-ci
  - recipes-compare-two-versions
next:
  - recipes-rerun-what-a-change-touches
---

## Goal

A campaign, a CI gate or a replay told you a test failed. You want to know which exchange went wrong, what
the agent did there, what the spec expected instead, and whether the failure is the agent or noise.

The chain is: read the failing cells and their verdict ids, read the evidence of each failing verdict, find
the first block that drifted and its drift class, look at the exchange itself in the drilldown, check that
the agent gives the same transcript every time, and for a recorded session, replay it offline.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* A store that holds the failing campaign. Step 1 makes one on Acme with no model: the golden suite run on
  a planted fault of the Acme sales assistant, `x3-skips-recap`, which never shows the recap and places the
  order without the explicit CONFIRM. The planted faults are in `examples/acme/faults`; a fault is reached as
  the target `fault:<id>` by the commands that take `--faults`, here `ci`.
* Every command in a `sh` block below runs with no model and no key, and writes only to new paths in the
  folder you run it in: `acme.db`, `ci.json`, `failing.html`, `failing.xml`, `replay.db`.

## Steps

### 1. Have a failing campaign in a store

You need a stored campaign with a failing cell; on your own agent this is the campaign that failed.

On Acme, store a baseline of the real agents, then let `ci` run the same golden specs on the planted fault
and store that candidate campaign beside it. `--route` keeps the one code-agent task on the ops agent.

```sh
driftbench campaign run examples/acme/golden/specs --target function:acme-sales \
  --route flow:price-sheet=process:acme-ops --campaign base --store acme.db
driftbench ci --specs examples/acme/golden/specs --target fault:x3-skips-recap --faults examples/acme/faults \
  --route flow:price-sheet=process:acme-ops --baseline base --store acme.db --out ci.json  # exit 1
```

```text
10 cells: 10 pass, 0 fail, 0 failed. Spent $0.00.
driftbench ci: candidate fault:x3-skips-recap (campaign c-5760c4be8d26) against baseline campaign base, ...
...
Goldens that changed:
  golden                             baseline  candidate  change     new flags  candidate failing
  acme-order-loose-confirmation · F  pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  gen-twise-066 · F                  pass      fail       regressed  forbidden  block 3 forbidden.order.create, block 3 stage.reached, block 4 tools.order.create.count
...
Verdict: REGRESSION. Exit 1.
Summary: ci.json
```

The candidate campaign id is made from the content and the clock, so yours differs. `ci` exits 1 on a
regression; the commands below read the campaign it stored.

### 2. Read the failing cells and their verdict ids

`campaign status` prints one line per cell of a stored campaign; a failing cell lists every verdict that did
not hold. Without a campaign id it reads the latest campaign of the store, here the candidate.

```sh
driftbench campaign status --store acme.db  # exit 1
```

```text
Campaign c-5760c4be8d26, created 2026-10-14T14:29:06.718Z.
✓ acme-new-customer-coverage · fault:x3-skips-recap · F · repeat 0  pass  4 blocks
✗ acme-order-loose-confirmation · fault:x3-skips-recap · F · repeat 0  fail  block 1 forbidden.order.create, block 1 must.0, block 1 must.2, block 1 stage.reached, block 2 must.0, ...
✓ acme-price-sheet-i08-planted · process:acme-ops · F · repeat 0  pass  1 block
...
10 cells: 5 pass, 5 fail, 0 failed. Spent $0.00.
```

A line reads: spec, target, mode, repeat, state, then the failing verdicts as `block <index> <verdict id>`.
`✗ fail` means the run completed and a block failed or the end state differs; `! failed` means the run
ended with an error, which is a crash of the adapter or the agent, not a wrong answer. The verdict id
starts with its check family: `forbidden.order.create` is a tool the block forbids, `must.0` the first
`must` pattern of the block, `stage.reached` the stage, `tools.<tool>.count` a call count. `campaign
status` exits 1 whenever a cell does not pass.

Read the lowest block index first: in mode F every later block inherits the agent's own earlier replies, so
later failures often follow from the first one.

### 3. Read the evidence of each failing verdict

`--json` prints every block of every cell, each verdict with its outcome, whether it gates, and its
evidence: what was observed against what was expected.

```sh
driftbench campaign status --store acme.db --json  # exit 1
```

The cell `acme-order-loose-confirmation`, block 1, its verdicts that did not pass:

```text
{ "index": 1, "pass": false, "stage": "order_placed", "verdicts": [
  { "id": "forbidden.order.create", "outcome": "fail", "gating": true,
    "evidence": "order.create called 1 time (call-1); the block expects it 0 times" },
  { "id": "must.0", "outcome": "fail", "gating": true,
    "evidence": "/Jo Okafor/ is missing; closest span \"jo.okafor\", differs by 1 character; visible text \"Done. Your order ORD-222B51 is placed: ..." },
  { "id": "must.2", "outcome": "fail", "gating": true,
    "evidence": "/CONFIRM/ is missing; closest span \"chni\", differs by 4 characters; ..." },
  { "id": "stage.reached", "outcome": "fail", "gating": true,
    "evidence": "reached order_placed, expected recap (stages in this block: order_placed)" } ] }
```

The document has `campaignId`, `cells` and `summary`; each cell has `specId`, `target`, `mode`, `repeat`,
`state`, `failing`, `runId`, `endState` and `blocks`. Here the evidence says it all: at block 1 the spec
expects the recap with a request to type CONFIRM, and the agent placed the order at once. That is the
planted fault. Only gating verdicts fail a block; a verdict with `"gating": false` is reported and never
fails it.

### 4. Find the first block that drifted, and its drift class

`--detail` adds the succession of every run: the first failing block, how many blocks fail, the longest
passing stretch, and the drift classes the failing blocks carry.

```sh
driftbench campaign status --store acme.db --detail  # exit 1
```

```text
...
Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.
  spec                           mode  repeat  perturbation  blocks  first drift  drifts  rate   longest clean  all pass  classes
  acme-new-customer-coverage     F     0                     4       none         0       0.0%   4              yes       none
  acme-order-loose-confirmation  F     0                     4       1            3       75.0%  1              no        X1_local 3, X3_flow 2, X5_tool 3
  gen-twise-066                  F     0                     7       3            2       28.6%  3              no        X3_flow 1, X5_tool 2
...
Recovery, per perturbed run: ...
  No perturbed run.
```

A drift class comes from the family of each failing gating verdict: `must`, `must_not`, `end_state`,
`execution`, `workspace`, `artifacts`, `budget` give `X1_local` (a wrong answer or action in this block);
`ledger` gives `X2_contradiction` (a fact established earlier is contradicted); `stage` and `flow` give
`X3_flow` (a stage skipped, repeated or gone back); `lang`, `cards`, `pii` give `X4_format`; `tools`,
`forbidden`, `skills`, `guards`, `safety` give `X5_tool`. Every failing run here carries `X3_flow` and
`X5_tool` from its first drift block: a flow skipped, then a tool called too early. The same pattern across
five specs points at one cause. The compounding table (T minus F) fills only when a spec ran in modes T and
F, and the recovery table only for mode P runs.

### 5. Look at the exchange in the drilldown

The scorecard's drilldown shows each failing run in full: what the user sent, what the agent said, each
tool call with its input and output, and every verdict that did not pass. `--max-runs` caps the runs shown,
failing runs first.

```sh
driftbench report --store acme.db --out failing.html --junit failing.xml --max-runs 5
```

```text
Margin auto: 17.0 points, ...
Campaign c-5760c4be8d26: 10 runs, 5 pass, 5 fail, 0 did not complete.
Suite pass rate, mode F: 50.0% [23.4%, 76.6%] (hierarchical 95% interval); 10 goldens, n_eff 9.0 runs (design effect 1.11), no drop detectable at 80% power.
Wrote failing.html and failing.xml.
```

Open `failing.html` in a browser and go to the section Drilldown. For the failing run it reads, in part:

```text
fail Block 1, spec block 1, drift X1_local, X3_flow, X5_tool. Stage expected recap, observed order_placed.
User Jo Okafor, jo.okafor@example.com
Agent Done. Your order ORD-222B51 is placed: Acme Fiber 1000 at 14 Harbor Road, Acmeville. ...
```

`report` exits 0 when it writes the files, whatever the campaign holds. `failing.xml` holds one JUnit test
case per run for a CI system.

The local viewer shows the same runs as pages, and lets you label blocks. It runs until you stop it, so it
has no place in a script; start it in its own terminal:

```text
driftbench view --store acme.db --port 0
```

It prints the address it listens on, `http://127.0.0.1:<port>`, and serves: `/` every campaign of the store;
`/campaign/<id>` the scorecard; `/campaign/<id>/run/<runId>` one run, its timeline first, then every block
in full with every verdict that did not pass and its evidence; `/compare` two campaigns side by side. The
`runId` is the `runId` of the cell in `campaign status --json`. Stop it with Ctrl+C (exit 0). `--port`
defaults to 4317 and `0` picks a free one; `--store` defaults to `driftbench.db`.

### 6. Check that the failure is not noise

A failure that comes and goes is not a bug you can fix in one place. `smoke` runs one spec several times
with the cache off and compares the transcripts block by block. The planted fault is reached only through
`--faults`, so run the spec of the failing cell on the agent it wraps; on your own agent, use its target.

```sh
driftbench smoke examples/acme/specs/conversations/order-loose-confirmation.yaml --target function:acme-sales --runs 3
```

```text
Smoke: acme-order-loose-confirmation on function:acme-sales, 3 runs, cache off.
  run 1  completed  4 blocks  transcript 94a2e0feb77c
  run 2  completed  4 blocks  transcript 94a2e0feb77c
  run 3  completed  4 blocks  transcript 94a2e0feb77c
✓ The transcripts are identical.
```

Identical transcripts, exit 0: the agent answers the same way every time, so a failure on it is reproducible.
When transcripts differ, `smoke` names the first run and the first block that differ and exits 1; then run
the campaign with `--repeats <n>` and read the spread before you trust one failing run. A transcript leaves
out cost, latency and timestamps, so those never count as a difference.

### 7. Replay a recorded session offline

When the failure happened in a recorded session, of a code agent for instance, `replay` runs the spec suite
over the session transcript with no model call, and stores the runs with `--store`. Each spec names its
session in `metadata.replay.session`; a spec whose session is not given is skipped with a note.

```sh
driftbench replay examples/estates/sessions/clean-build.jsonl examples/estates/sessions/gate-violated.jsonl \
  --suite examples/estates/sessions/specs \
  --decisions examples/estates/sessions/clean-build.decisions.jsonl examples/estates/sessions/gate-violated.decisions.jsonl \
  --steps examples/estates/sessions/clean-build.steps.jsonl examples/estates/sessions/gate-violated.steps.jsonl \
  --store replay.db  # exit 1
```

```text
note: replay-compaction-mid-task names the session compaction-mid-task, which was not given; skipped
...
✓ replay-clean-build  session clean-build from block 0 (metadata)
✗ replay-gate-violated  session gate-violated from block 0 (metadata)
    failing: block 0: guards.read-before-write.deny, block 0: execution.exit_code, block 0: custom.ordered.Read.Edit
✓ replay-negative-control  session gate-violated from block 0 (metadata)
3 specs replayed: 2 pass, 1 fail. Judge none, 0.0000 USD. Campaign replay-....
```

`--decisions` are the guard decision logs and `--steps` the stage feeds, each matched to its session by file
name. The stored runs read like any campaign: `campaign status --store replay.db --json` gives the evidence,
here `the last command "pnpm test" exited with 1, 0 expected` and `1 of 1 Edit in this block have no Read
with the same file_path before them since the last compaction: Edit /work/acme-shop/src/invoice.ts`. The
agent edited a file it had not read, the guard denied, and the tests failed. Judged criteria stay
inconclusive in a replay unless you pass `--judge claude:<model>`, a paid call per criterion and block on the
local `claude` command, which needs `--judge-budget <usd>`.

## What you have at the end

* `acme.db`: the baseline campaign `base` and the failing candidate campaign, with every verdict and its
  evidence.
* `ci.json`: the CI summary of the comparison.
* `failing.html` and `failing.xml`: the scorecard with the drilldown of the failing runs, and its JUnit XML.
* `replay.db`: the runs of the replayed sessions.
* The cause: the first drift block of each failing run, its drift class, and the evidence of each verdict.
  On Acme, every failing run places the order where the recap should be: the stage skipped and
  `order.create` called before CONFIRM.

Once you have fixed the agent, rerun only what the fix touches: `driftbench help
recipes-rerun-what-a-change-touches`.

## When a step fails

* `No adapter is set up for fault:<id>` (exit 2) from `campaign run` or `smoke`: a planted fault is a target
  only for the commands that take `--faults`, such as `ci` and `gate`. Run the real target instead.
* `Cannot load the fault set` (exit 2) from `ci`: the fault set is TypeScript and loads through the source
  build; run the command as `pnpm -s driftbench` from the repository root.
* `campaign status` exits 2: the store holds no campaign, or the campaign id is unknown. Check `--store`.
* A cell shows `! failed` and no failing verdict: the run ended with an error. `campaign status --json`
  shows the cell's state; fix the adapter or the target, then `campaign resume` runs the cells with no
  completed run.
* `smoke` exits 1: the transcripts differ, or a run did not complete. Run the campaign with `--repeats`
  and compare the repeats before reading one failure as a regression.
* `replay` exits 2: a log was passed as a session, two sessions have one name, a session is not a
  transcript, or no spec aligned with any session. Each spec must name a session you pass.
* `view` exits 2: the store is missing, or the port cannot be opened. Pass `--port 0` for a free port.

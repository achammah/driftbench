---
title: Pilot runs and the noise floor
summary: driftbench pilot plans, runs and analyses a small designed experiment on a generated suite. The experiment splits the variance of pass rates between cells, conversations, wordings and repeats. It also sets the noise floor and sizes the real campaign.
commands:
  - pilot plan
  - pilot run
  - pilot analyse
see_also:
  - running-campaign-plan
  - running-cells-and-repeats
  - running-store
  - running-targets
next:
  - running-family
---

## What it is

Before a large campaign, you need to know how noisy the agent is and where the noise comes from. The noise comes from one behaviour to another (cell). It comes from one conversation to another inside a behaviour. It comes from one approved wording of the same user turn to another. It also comes from run to run of the same input (repeat). `driftbench pilot` answers that on a generated suite (specs with `metadata.generated`, made by `driftbench generate` from an approved map). `pilot plan` prints the design and its cost. `pilot run` runs it through the runner, keeps the factors on every run in a store, analyses, and writes `pilot-report.json`. `pilot analyse` analyses a stored pilot again with other settings, running nothing. The pilot runs only on in-process agents. These are the Acme sales assistant `function:acme` and its seeded random control `function:acme-random` (or `function:acme-random-<seed>`). The control plants failures at known rates so you can check that the analysis recovers them.

## When to use it

* Before sizing a real campaign: the pilot tells you how many repeats per block reach a noise floor. It also tells you how to spread conversations across cells (Neyman allocation).
* To find wording-sensitive behaviours: cells whose pass rate swings across approved wordings of the same turn.
* To validate the method on the control agent, whose planted variance shares must fall inside the estimated intervals.
* Not on a billed agent: `pilot run` refuses any target that is not in process. Size a billed experiment with `pilot plan` and run it as an approved campaign.
* Not on hand-written specs or task specs: the pilot measures generated conversations; code-agent tasks are skipped.

## Commands and every option

```text
driftbench pilot plan --map <file> --suite <dir> [--conversations <n>] [--repeats <n>] [--wordings <n>] [--by <dimensions>] [--target <adapter[:agent]>] [--store <file>] [--json]
driftbench pilot run --map <file> --suite <dir> --target <adapter[:agent]> --store <file> [design options] [analysis options] [--concurrency <n>] [--campaign <id>]
driftbench pilot analyse [campaignId] --store <file> [analysis options]
```

Design options (`plan` and `run`):

| Option | Default | Effect |
|---|---|---|
| `--map <file>` | required | the approved map whose phrase bank gives the wordings. |
| `--suite <dir>` | required | the generated suite: specs with `metadata.generated`. |
| `--conversations <n>` | `10` | conversations per cell, at most; at least 1. |
| `--repeats <n>` | `5` | runs per wording; at least 1. |
| `--wordings <n>` | `3` | approved wordings per conversation, at most; at least 1. |
| `--by <dimensions>` | `behaviour` | the dimensions that name a cell, comma separated; at least one. |

`plan` only:

| Option | Default | Effect |
|---|---|---|
| `--target <adapter[:agent]>` | `function:acme` | the target the cost is projected for. |
| `--store <file>` | none | read measured cost units from this store. |
| `--json` | off | print the design summary and the plan as JSON. |

`run` only:

| Option | Default | Effect |
|---|---|---|
| `--target <adapter[:agent]>` | required | the agent to measure: `function:acme`, `function:acme-random` or `function:acme-random-<seed>`. |
| `--store <file>` | required | the store the runs are filed in; made when missing. |
| `--concurrency <n>` | `4` | runs at the same time; at least 1. |
| `--campaign <id>` | made from the content and the clock (`pilot-...`) | the campaign id. |

Analysis options (`run` and `analyse`):

| Option | Default | Effect |
|---|---|---|
| `--floor <f>` | `0.05` | the noise floor a difference between two versions reads against; between 0 and 1. |
| `--pool <n>` | `100` | conversations in the estimation pool the allocation spreads; at least 1. |
| `--iterations <n>` | `500` | bootstrap resamples; at least 1. |
| `--seed <n>` | `1` | bootstrap seed; at least 0. |
| `--sensitivity <f>` | `0.2` | the wording range above which a cell is flagged; between 0 and 1. |
| `--resample <unit>` | `both` | what the bootstrap draws: `cells`, `conversations` or `both`. |
| `--out <dir>` | `.` (the working folder) | the folder to write `pilot-report.json` into; made when missing. |
| `--json` | off | print the report as JSON. |

`analyse` takes `[campaignId]` (default: the latest campaign of the store whose id starts with `pilot-`) and `--store <file>` (required; it must exist).

## Inputs

* An approved map (`examples/acme/map/approved.yaml`) and a generated suite (`examples/acme/generated/specs`), from the authoring area.
* For `analyse`, a store holding a pilot campaign. Runs whose spec carries no pilot factors are left out, with a note on stderr.

## Outputs and how to read them

`pilot plan` prints one row per cell (conversations, wordings, runs, blocks, cost) and a total. It prints the cost source (`Cost: the agent runs in process: no model call, nothing billed.` for an in-process target). It prints a note when the phrase bank gives fewer wordings than asked. It prints one `Skipped <spec>: <reason>` line per spec left out.

`pilot run` and `pilot analyse` print the report:

* the pass rate with a Wilson interval on the effective runs;
* `Where the spread comes from`: the variance and share of each level (cell, conversation, wording, repeat) with a bootstrap interval;
* the intraclass correlations and the design effect;
* `Noise floor`: the repeats per block needed to reach the floor, and what this pilot's repeats reach;
* the flip rate: blocks whose verdict changes between repeats;
* the wording-sensitive cells (range above `--sensitivity` and the cell's wording F test holding at a false discovery rate of 0.05);
* per cell: conversations, runs, pass rate, interval, wording range, flip rate, and the Neyman allocation of the `--pool`;
* on the control agent, the planted shares against the estimates, each `recovered` when inside its interval;
* `Report: <path>`, the file written. The JSON holds `generator`, `campaignId`, `createdAt`, `target`, `map`, `design`, `plan` and `analysis`.

Exit codes: `plan` 0, or 2 on bad input. `run` 0 when every run completed, 1 when some did not, 2 on bad input. `analyse` 0 when the report is written, 2 on bad input or a store without that pilot.

## Worked example

A small design (2 conversations, 2 wordings, 2 repeats per cell) is planned. Then it runs on the seeded random control. Then it is analysed again with a wider noise floor. Everything runs in process: no model is called.

```sh
driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs --conversations 2 --wordings 2 --repeats 2
driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs --conversations 2 --wordings 2 --repeats 2 --target function:acme-random --store pilot.db --out pilot-out --campaign pilot-demo
driftbench pilot analyse --store pilot.db --floor 0.1 --resample cells --out pilot-out2
```

```text
Pilot plan: 13 cells by behaviour; per cell up to 2 conversations x 2 approved wordings x 2 repeats.
  cell             conversations  wordings  runs  blocks  cost
  behaviour=-      2              4         8     28      $0.00
  total            26             52        104   496     $0.00
Cost: the agent runs in process: no model call, nothing billed.
Skipped acme-price-sheet-i01-base: a code-agent task: the pilot measures conversations.
```

(The plan prints one row per cell and one `Skipped` line per task spec; the lines above are a selection.)

```text
Pilot on function:acme-random: 104 runs over 13 cells (26 conversations, 52 wordings, 2 repeats).
Pilot pilot-demo on function:acme-random: 104 runs.
Pass rate 19.2% (12.2% to 27.7%, Wilson on 95.8 effective runs).
  level         variance  share  interval
  cell          0.0000    0.0%   0.0% to 24.8%
  conversation  0.0048    2.9%   0.0% to 13.3%
  wording       0.0096    5.7%   0.0% to 33.9%
  repeat        0.1538    91.4%  56.4% to 100.0%
Noise floor 5.0%: run-to-run variance 0.1538; 473 repeat(s) per block (floor reached 5.0%), 237 per block for a cell figure over 2 conversations; this pilot's repeats reach 76.9% on one block.
Flip rate: 67 of 248 blocks flip between repeats; mean 0.270.
Wording-sensitive cells (a conversation's pass rates span more than 20.0% across wordings, and the cell's wording F test holds at a false discovery rate of 0.05): behaviour=B-001.
  level         planted  estimate  interval
  repeat        85.9%    91.4%     56.4% to 100.0%  recovered
Report: pilot-out/pilot-report.json
```

On the control agent, 91.4% of the variance is run to run (planted 85.9%), so repeats, not more conversations, are what this agent needs. Every planted share is recovered. The `analyse` run reads the same 104 runs from the store and reports the floor at 10.0% (119 repeats per block).

## Common errors

Each exits 2.

* `No adapter is set up for http:x. The pilot reaches function:acme (the Acme sales assistant) and function:acme-random or function:acme-random-<seed> (its seeded random control).`
* `The pilot runs <n> runs on <target>, which is not in process: it is billed. Size it with driftbench pilot plan and run it as a campaign the owner approved.`
* `examples/acme/specs holds no generated spec, so the pilot has nothing to run.` The suite must hold specs with `metadata.generated`.
* `--by names at least one dimension.`
* `--resample takes cells, conversations or both, not "all".`
* `--floor takes a number between 0 and 1, not "1".` (the same for `--sensitivity`). `--repeats takes a whole number of at least 1, not "0".` (the same for the other whole numbers).
* `No store at nope.db: this command reads a store and does not make one.` (`analyse`)
* `pilot.db holds no campaign x.` and `<store> holds no pilot campaign.` (`analyse`)
* `<map>: <message>` with its issues: the map is not an approved map (authoring area).

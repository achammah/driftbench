---
title: Run only what a change affects
summary: campaign run --change <manifest> --from <campaign> runs only the cells in the blast radius of a declared change. It carries the stored runs of every other cell from an earlier campaign. An optional audit fails closed on a missed dependency.
commands:
  - campaign run
see_also:
  - running-campaign-run
  - running-store
  - running-cache
  - running-outcomes
  - running-modes
next:
  - running-campaign-export-import
---

## What it is

When an agent changes in a known way (one stage, one tool's input, one deviation handler), most cells of a campaign cannot be affected. A change manifest names the change. It gives the agent version before (`from`) and after (`to`). It also gives a list of changes such as `{ kind: stage, id: recap }` or `{ kind: deviation, id: D8 }`. With `--change <manifest> --from <campaign>`, `campaign run` computes the blast radius of the manifest over the campaign's cells. The radius holds the blocks that depend on what changed, from the specs' declared dependencies. `campaign run` runs the cells in the radius fresh. It copies into the new campaign the stored run of every other cell from the `--from` campaign, stamped as carried. Anything doubtful runs fresh. `--audit <n>` reruns a sample of the cells about to be carried and refuses to carry anything when one differs. How a manifest is written, and the read-only `driftbench radius` command that prints a radius, belong to the results area.

## When to use it

* On a pull request that changes one part of an agent, to test the radius only and pay for a fraction of the blocks.
* With a stored baseline campaign of the previous agent version, run with `--agent-version` and kept in the same store.
* Not when the change is global (a model, a rule that holds on every block, a tool no spec names). The radius is the whole suite, and every cell runs.
* Not as a replacement for a full campaign: carried results are old draws. Run the whole suite on a schedule.

## Commands and every option

```text
driftbench campaign run [paths...] --agent-version <label> --store <file> --change <manifest> --from <campaign> [--audit <n>] [--audit-seed <n>] [--max-carry <n>] [--max-age <days>] [--block-reruns] [--record-end-state-snapshots] [other campaign run options]
```

| Option | Default | Effect |
|---|---|---|
| `--change <manifest>` | none | the change manifest (YAML). Needs `--from` and `--store`. |
| `--from <campaign>` | none | the stored campaign, in the same store, whose runs are carried. |
| `--agent-version <label>` | none | the version of the agent under test. Without it (or `--prompt`), nothing is carried. It must equal the manifest's `to`; the `--from` campaign must hold runs of the manifest's `from`. |
| `--audit <n>` | none | draw n of the cells about to be carried (n at least 1). Run them fresh before anything is carried. Compare each with its stored run on the status, every gating verdict of every block, each block's pass and the end state. One difference is a radius miss: nothing is carried, every cell runs, and the command exits 1. |
| `--audit-seed <n>` | `1` | with `--audit`: the seed of the draw; the same seed draws the same cells. |
| `--max-carry <n>` | `5` | the most campaigns in a row a result may be carried; a result past it runs fresh. At least 0. |
| `--max-age <days>` | `7` | the most days since a carried result was measured; an older one runs fresh. At least 0. |
| `--block-reruns` | off | needs mode T in `--mode`. For a T cell in the radius, send only the blocks the change can affect. Keep the other stored blocks of the cell. |
| `--record-end-state-snapshots` | off | store the raw end-state values each mode T block reads, so a later `--block-reruns` can rerun cells that check an end state. Off, such cells run whole. The values may be sensitive. A block rerun whose baseline recorded snapshots keeps recording them. |

## Inputs

* The spec files (the same suite as the baseline).
* A change manifest, for example `examples/acme/radius/deviation-tool-failure.yaml`:

```text
from: acme-v1
to: acme-v2
changes:
  - kind: deviation
    id: D8
```

* A store holding the `--from` campaign, run with `--agent-version` equal to the manifest's `from`. Its runs must carry execution provenance, which `campaign run` records for scripted runs. A baseline that lacks it carries nothing (`legacy: the baseline has no execution provenance`).

## Outputs and how to read them

Before the cells:

* `Blast radius of <from> to <to> (manifest <hash>): <changes>.`
* With `--audit`, `Audit: <n> cells drawn from the <m> outside the radius (seed <s>) and run fresh: <k> misses.` is printed. With no miss, `At 95% confidence, under <p>% of the carried cells would disagree.` follows. The bound is `1 - 0.05^(1/n)`. A miss adds one line per missed cell with what differed, then `RADIUS MISS: the change reaches cells the manifest left out of the radius. The gate fails closed.`
* `<i> of <n> cells in the radius. <f> cells run fresh, <c> carried from <campaign>.` is printed. One line follows per reason a cell outside the radius runs fresh, such as `drawn for the audit`.
* Or `Nothing is carried, every cell runs: <reason>.` The reasons include these cases. The radius is the whole suite. The campaign names no agent version. The version is not the manifest's `to`. The baseline holds no run of the manifest's `from`. The baseline has no execution provenance. The audit found a miss.
* With `--block-reruns`: `Mode T block reruns: <n> cells send <b> blocks and keep <k> stored blocks from <campaign>.`

Cell lines: a carried cell reads `pass (carried from <campaign>, age <n> campaigns)`. The summary adds `<c> carried`, then:

* `Fresh: <n> cells, <b> blocks sent to the agent. Carried from <campaign>: <n> cells, <b> blocks not sent (agent version <from>; this campaign runs <to>).`
* `Saved: <b> of <total> blocks, <p>%. The pass and fail counts above merge fresh and carried results.`

A carried run keeps `carried: { fromCampaign, fromRun, agentVersion, age: { campaigns, days } }`. It costs nothing against a budget. `resume` never reruns it. The audited cells are fresh runs of the new campaign and are kept. `--json` adds a `radius` object with the record and the blocks sent and carried.

Exit codes: as `campaign run`, plus 1 on a radius miss.

## Worked example

The Acme gated suite (195 specs) runs as `acme-v1` into a store. Then the same suite runs as `acme-v2` with the D8 handler change. It carries every cell the change cannot reach, after an audit of 3 carried cells. No model is called; the whole example takes under a minute.

```sh
driftbench campaign run examples/acme/gated/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version acme-v1 --store radius.db --campaign base
driftbench campaign run examples/acme/gated/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version acme-v2 --store radius.db --campaign next --change examples/acme/radius/deviation-tool-failure.yaml --from base --audit 3
```

The first ends with `195 cells: 195 pass, 0 fail, 0 failed. Spent $0.00.` The second, after its header lines:

```text
Blast radius of acme-v1 to acme-v2 (manifest 2644cc4586c7): deviation:D8.
Audit: 3 cells drawn from the 180 outside the radius (seed 1) and run fresh: 0 misses. At 95% confidence, under 63.2% of the carried cells would disagree.
15 of 195 cells in the radius. 18 cells run fresh, 177 carried from base.
  3 cells outside the radius run fresh: drawn for the audit.
✓ gen-boundary-063 · function:acme-sales · F · repeat 0  pass (carried from base, age 1 campaign)  5 blocks
```

and, after the other cell lines:

```text
195 cells: 195 pass, 0 fail, 0 failed, 3 reused, 177 carried. Spent $0.00.
Fresh: 18 cells, 57 blocks sent to the agent. Carried from base: 177 cells, 810 blocks not sent (agent version acme-v1; this campaign runs acme-v2).
Saved: 810 of 867 blocks, 93.4%. The pass and fail counts above merge fresh and carried results.
```

15 cells depend on the D8 handler and run. The 3 audited cells run fresh and match their stored runs (they show as `reused` because the audit already filed them). 177 cells are carried. With 3 audits the bound is loose (63.2%); 59 audits bring it under 5%.

## Common errors

Each of the first five exits 2 before anything runs.

* `--change runs a blast radius and carries the rest: it goes with --from <campaign> and --store <file>.`
* `--from names the campaign a radius run carries from: it goes with --change <manifest>.` is the message for `--from`. `--audit sets how a radius run carries: it goes with --change <manifest>.` is the message for `--audit` (also `--audit-seed`, `--max-carry`, `--max-age`, `--block-reruns`).
* `--audit-seed sets the draw of an audit: it goes with --audit <n>.`
* `--block-reruns reruns blocks of independent mode T cells: it goes with --mode T.`
* `No campaign <id> in <store>: --from names the stored campaign to carry from.` is one message. Another is `✗ <manifest>` with its issues, then `The change manifest is invalid, so nothing was run.`
* `Nothing is carried, every cell runs: this campaign names no agent version: pass --agent-version, or pin a prompt with --prompt.` is not an error. The campaign runs whole. Add `--agent-version` equal to the manifest's `to`.
* `Nothing is carried, every cell runs: the radius is the whole suite: legacy: the baseline has no execution provenance.` is the message. The baseline runs lack the provenance stamp. On this version a baseline that holds mode P cells is read this way; run the baseline in modes T and F only.
* `6 of 6 cells in the radius.` with nothing carried: the specs declare no dependencies, so every block may depend on the change. Generated, gated suites declare them.

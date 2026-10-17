---
title: Code-agent task families
summary: Build N seeded instances of a code-agent task family, each with corner-case variants and expected outcomes from the family's oracle. Check the family's human review. Verify every instance on a reference build before it ships.
commands:
  - family instances
  - family verify
  - family review
see_also:
  - running-process-and-sandboxes
  - running-campaign-run
  - running-targets
  - running-cells-and-repeats
---

## What it is

A task family turns one code-agent task into many. The family folder holds `family.yaml` (the task, its knobs, its grammar of workspaces and its approved phrases). It also holds an `oracle.mjs` that computes the expected outcome of an instance from its seed alone. It also holds a `review.yaml` a person signs. `driftbench family instances` draws N instances from a seed. For each instance, code draws the knob values and builds the workspace. Code writes the instruction from approved phrases. Code adds corner-case variants (such as a duplicate line, a reordered header, a changed unit, a planted instruction). Code asks the oracle for the expected outcome and writes one spec per variant. It also rebuilds every style alternative and refuses the family when a style knob changes the expected outcome. `driftbench family verify` runs a reference build (the agent known to be right) on every spec. An instance the reference fails is an oracle or reference defect and is never shipped. `driftbench family review` shows whether the signed review still matches the family and oracle hashes.

## When to use it

* To get many fresh, varied instances of a task for a code agent, with expected outcomes computed by code, not by an agent.
* To refresh a suite against memorisation: a new seed gives new instances of the same family.
* Before shipping instances: verify them on the reference; then run them on the agent under test with `campaign run`.
* Writing a family (its knobs, grammar and oracle) is authoring work; this topic covers running the commands.

## Commands and every option

```text
driftbench family instances <family> --n <n> --seed <s> --out <dir> [--force] [--json]
driftbench family verify <dir> --reference <adapter[:agent]> [--concurrency <n>] [--json]
driftbench family review <family> [--write] [--json]
```

| Option | Command | Default | Effect |
|---|---|---|---|
| `<family>` | `instances`, `review` | required | the family folder, or its `family.yaml`. |
| `--n <n>` | `instances` | required | how many instances; a whole number of at least 1. |
| `--seed <s>` | `instances` | required | the integer seed every draw comes from; at least 0. The same seed gives the same instances. |
| `--out <dir>` | `instances` | required | the folder to write the instances and `family-report.json` into. |
| `--force` | `instances` | off | replace the output of an earlier run in the folder. Without it, a folder holding earlier output is refused. |
| `<dir>` | `verify` | required | the folder `family instances` wrote. |
| `--reference <adapter[:agent]>` | `verify` | required | the reference build, such as `process:acme-ops` (topic running-targets). |
| `--concurrency <n>` | `verify` | `4` | how many specs run at once; at least 1. |
| `--write` | `review` | off | write a pending review with the current hashes into the family folder, unless a current signed one exists. A person then answers its questions and fills `signed_by` and `signed_on`. |
| `--json` | all three | off | print the report or the status as JSON. |

## Inputs

* A family folder such as `examples/acme/families/price-sheet`: `family.yaml`, `oracle.mjs`, `review.yaml`.
* `instances` refuses a family whose phrases are not all approved. It also refuses a family whose review is missing, invalid or stale (its `family_sha256` or `oracle_sha256` no longer match). A `pending` review lets instances build. `verify` then says release waits for the signature.
* `verify` reads every spec under the folder and runs each once on the reference with the default checks.

## Outputs and how to read them

`family instances` prints, in order:

* `Family <id>: <n> instances, seed <s>, <k> specs.`
* One line per instance (its name, its own seed, its knob values, its variants).
* `Style invariant: <n> style alternatives rebuilt; none changed the expected outcome.`
* The review line.
* `Wrote <k> specs and family-report.json to <dir>.`

The folder holds `<instance>/<variant>.yaml` specs, their seed folders, and `family-report.json`.

`family verify` prints, in order:

* `Verify <dir> on the reference <target>: <n> specs.`
* `✓ <file>` or `✗ <file>  <state>`, with up to 8 failing verdicts each.
* `✓ The reference passes all <n> specs: <k> instances may ship.` or `✗ The reference fails <f> of <n> specs. ... These instances are not shipped: <names>.`

It also writes `<dir>/verify-report.json`.

`family review` prints `Review: signed by <who> on <date>.` or the state to act on; `--json` gives `family`, `state` and `path`.

Exit codes:

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `instances` | every instance written | the family or its oracle has a defect. The defect is an oracle that fails or answers outside the format, an invalid spec, or a style knob that changes the expected outcome. Nothing written | bad input: an invalid family, an unapproved phrase, a missing, invalid or stale review, a bad number, earlier output without `--force` |
| `verify` | the reference passes every spec | the reference fails a spec or a spec is invalid; each is listed and not shipped | no adapter for the reference, no spec under the folder, a bad number |
| `review` | a signed review holds for the family as it is | a person still has to sign | bad input, or an invalid review file |

## Worked example

Two instances of the Acme price-sheet family, verified on the Acme ops agent; then the review status. The ops agent and the oracle are code: no model is called.

```sh
driftbench family instances examples/acme/families/price-sheet --n 2 --seed 1 --out fam
driftbench family verify fam --reference process:acme-ops
driftbench family review examples/acme/families/price-sheet
```

```text
Family acme-price-sheet: 2 instances, seed 1, 9 specs.
  i01  seed 1219026796  categories=3 column_order=catalog language=EN line_endings=lf plans=6 planted=with readme_name=ABOUT.txt seed_format=csv start=catalog-only summary=without wording=b workbook=out/price-sheet.xlsx yearly=value  base, duplicate-line, header-order, unit-change, planted
  i02  seed 1269359653  categories=2 column_order=shuffled language=EN line_endings=crlf plans=25 planted=without readme_name=ABOUT.txt seed_format=csv start=catalog-only summary=without wording=b workbook=out/price-sheet.xlsx yearly=value  base, duplicate-line, header-order, unit-change
Style invariant: 12 style alternatives rebuilt; none changed the expected outcome.
Review: signed by owner on 2026-10-13.
Wrote 9 specs and family-report.json to fam.
```

```text
Verify fam on the reference process:acme-ops: 9 specs.
  ✓ i01/base.yaml
  ✓ i01/duplicate-line.yaml
  ✓ i01/header-order.yaml
  ✓ i01/planted.yaml
  ✓ i01/unit-change.yaml
  ✓ i02/base.yaml
  ✓ i02/duplicate-line.yaml
  ✓ i02/header-order.yaml
  ✓ i02/unit-change.yaml
✓ The reference passes all 9 specs: 2 instances may ship.
Wrote fam/verify-report.json.
```

```text
Review: signed by owner on 2026-10-13.
```

To run the shipped instances on the agent under test: `driftbench campaign run fam --target process:<name> --process-command <command>` (topic running-process-and-sandboxes).

## Common errors

* `fam holds the output of an earlier run (family-report.json, i01, i02, verify-report.json). Pass --force to replace it.` (exit 2)
* `--n must be a whole number of at least 1, got "0".` (exit 2; the same form for `--seed` and `--concurrency`)
* `✗ <family> is not a valid family:` with one line per issue (exit 2).
* `✗ <id> uses phrases no person approved: <ids>. An instance holds approved phrases only.` (exit 2)
* `✗ <review line>` (exit 2): the review is missing, invalid or stale. Run `family review <family> --write`, have a person sign it, then build.
* `✗ <id> has a defect; nothing is written: <reason>` (exit 1). Or `✗ A style knob changes the expected outcome, so the oracle or the family is wrong; nothing is written:` (exit 1).
* `No spec found under emptydir. Write instances with driftbench family instances first.` (exit 2)
* `driftbench: cannot use <dir>/verify-report.json: ENOENT: ...` (exit 2) The folder given to `verify` does not exist.
* `No adapter is set up for <reference>. ...` (exit 2)

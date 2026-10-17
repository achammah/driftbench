---
title: Research replays
summary: Re-run the two frozen research replays of the judge answer parser offline, with no model call, and read their zero-breaks gate.
commands:
  - validate
see_also:
  - validate-self-checks
  - validate-judges
  - validate-overview
next:
  - validate-estate-loop
---

## What it is

A research replay re-runs a past experiment from its recordings instead of calling a model again. Two
replays guard the judges' answer decoder, the code that turns a judge model's raw answer into a verdict
and evidence:

| Replay | Folder | What it compares |
|---|---|---|
| default decoder, ungrounded evidence | `research/default-decoder-ungrounded` | historical decoder version 2 (selected with `criterionDecoderVersion: 2`, which nulls an ungrounded evidence string and keeps the verdict) against strict version 1; the current default decoder is version 3 |
| input-source alias | `research/evidence-source-alias` | the decoder's alias rule (a bare input path resolves to the single declared input when the canonical source is absent, and the quote must still ground in it) against strict decoding |

Each replay feeds the public decoder the raw judge answers recorded at commit
`d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d` and compares the verdicts per recorded set with the labels:
rows, strict correct, candidate correct, fixes and breaks. A break is a row the strict decoder got right
and the candidate gets wrong. The gate: zero breaks on every set, and every assertion in the replay script
holds. No model is called and nothing is billed.

`tools/research-replay-ci.sh` runs both, in CI's `research replays` job on every push and pull request. It
is a shell script, not a `driftbench` command.

## When to use it

* After a change to the judge answer decoder or to the parsing of judge answers in `packages/judges`.
* After a change to the recorded fixtures under `packages/judges/test/fixtures`.
* When CI's `research replays` job fails.

## Commands and every option

```
tools/research-replay-ci.sh
```

The script takes no option. It needs:

* the full git history (`git fetch --unshallow` on a shallow clone): it checks that commit
  `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d` exists, and adds a temporary worktree of it, which the
  default-decoder replay reads as `BENCH_FRAME`;
* a clean state of the four snapshot files it regenerates:
  `packages/judges/test/fixtures/criterion-decoder-recordings.json.gz`,
  `research/default-decoder-ungrounded/results.json`,
  `packages/judges/test/fixtures/evidence-source-alias-recordings.json.gz`,
  `research/evidence-source-alias/results.json`;
* `pnpm install` done, since it runs the replay scripts with `npx tsx`.

On exit, whether it passed or not, it removes the temporary worktree and restores the four snapshot files
with `git checkout`: the committed snapshots are frozen on purpose, and the regenerated ones are thrown
away.

The replay scripts themselves can be run one at a time from the repository root:

```
BENCH_FRAME=<worktree of d25cc28> npx tsx research/default-decoder-ungrounded/replay.mts
npx tsx research/evidence-source-alias/replay.mts d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d
```

Each rewrites its `results.json` (restore it with `git checkout` afterwards). A separate unit test,
`tools/research-replay.test.ts` (run by `pnpm test`), pins what broke these scripts once: every public
parser call names its decoder version, and the source-alias replay reads its donor fixture from this
repository.

Every option of `driftbench validate`, for reference (the topic named in the last column explains it):

| Option | Default | Meaning | Topic |
|---|---|---|---|
| `<component>` | required | a registered component, `all`, `floors` or `protect` | `validate-overview` |
| `[level]` | none | only with `floors --raise`: the new floor | `validate-floors` |
| `--seed <n>` | seed 1 when no seed option is given | one visible seed | `validate-overview` |
| `--seeds <a..b>` | none | a range of visible seeds, at most 1000 | `validate-overview` |
| `--hidden` | off | add the hidden seed of the current commit | `validate-overview` |
| `--json` | off | print the report, or the hardness, as JSON | `validate-overview` |
| `--items` | off | compute every level and list the whole bank | `validate-reading-items` |
| `--all-levels` | off | compute every level and list every failing item | `validate-reading-items` |
| `--blind` | off | strip causes and `Fix:` hints (the auditor's view) | `validate-reading-items` |
| `--check-floor` | off | exit 1 when a run is below its floor, else 0 | `validate-floors` |
| `--raise <component>` | none | with `floors`: the component whose floor rises | `validate-floors` |
| `--ladder-version <n>` | default version | select a registered version; with `floors --raise`: the floor version | `validate-floors` |
| `--evidence <json>` | none | with `floors --raise`: the `--json` run that reaches the level | `validate-floors` |
| `--brief` | off | print the executor brief with the live state | `validate-executor-loop` |
| `--fresh` | off | with `--brief`: leave out the hypotheses | `validate-executor-loop` |
| `--journal <row.json>` | none | append a validated journal row | `validate-executor-loop` |
| `--check-handover` | off | exit 1 when `HANDOVER.md` disagrees with the journal | `validate-executor-loop` |
| `--hardness` | off | print the hardness measurement from the journal | `validate-executor-loop` |
| `--branch <name>` | none | with `protect`: the pull request's branch | `validate-protect` |
| `--base <ref>` | none | with `protect`: the ref it merges into | `validate-protect` |
| `-h`, `--help` | off | print the command's usage | |

## Inputs

* The recordings in `packages/judges/test/fixtures/*-recordings.json.gz` and the inputs under
  `research/default-decoder-ungrounded/inputs`.
* The tree of the recording commit, read through the temporary worktree.
* The decoder in `packages/judges` at your `HEAD`.

## Outputs and how to read them

The script prints a heading per replay and, when both hold, `research replays: ok`, exit 0. It exits 1
on the first failure:

| Output | Meaning |
|---|---|
| `commit d25cc28... missing: fetch full history` | a shallow clone |
| `snapshot files are not clean` | one of the four snapshot files has local changes |
| `breaks in [ '<set>', ... ]` | the candidate decoder got a row wrong that the strict decoder got right, on the named sets |
| a stack trace from `replay.mts` | an assertion inside the replay failed, or the decoder threw |

The per-set tables (rows, strict correct, candidate correct, fixes, breaks) are in each folder's
`README.md` and `complete-gate.md`, and in the `summaries` of its `results.json`.

## Worked example

The replays need the git history and the repository, which the help test's scratch folder does not
have, so the help test only runs a validate command beside them:

```sh
driftbench validate floors
```

```text
Floors (validators/floors.json): none.
```

At the repository root, on a full clone with a clean tree (88 seconds). Shown as text, not run by the help
test: it reads git (an old commit, checked out as a worktree).

```bash
tools/research-replay-ci.sh
echo $?
```

```text
Préparation de l'arbre de travail (HEAD détachée d25cc2820)
== default-decoder-ungrounded replay.mts (assertions, zero breaks)
== evidence-source-alias replay.mts (assertions, zero breaks)
research replays: ok
0
```

The first line is git's own message for the temporary worktree, in the language of the machine that ran
it (French here), followed by a progress counter that is cut from this capture.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `commit d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d missing: fetch full history` | a shallow clone | `git fetch --unshallow`, or check out with `fetch-depth: 0` in CI |
| `snapshot files are not clean` | local changes to a snapshot file | commit or restore them first; the script restores them itself after every run |
| `breaks in [ ... ]` | a decoder change made a correct verdict wrong on recorded data | fix the decoder; the recorded sets are frozen |
| `Cannot find module` from `npx tsx` | dependencies not installed | `pnpm install` |
| a leftover worktree after an interrupted run | the script was killed before its exit trap | `git worktree list`, then remove only the `bench-frame` worktree your run created |

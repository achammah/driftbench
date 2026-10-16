---
title: Recordings and replay without model calls
summary: Every way driftbench records what happened and plays it back with no model call. The ways are the block cache of a store, simulated-user recordings, attack recordings, recorded Claude Code sessions and judge cassettes. Each entry says what it holds and the command that replays it.
commands:
  - campaign run
  - simulate
see_also:
  - running-cache
  - running-simulate
  - running-store
  - running-smoke
  - running-sdk-adapters
next:
  - running-change-carry
---

## What it is

A run can be repeated exactly, for free, when what the model or agent said is played back from a recording. driftbench has five recording mechanisms. Each covers a different party of the run:

| What is recorded | Where | Recorded by | Replayed by | Topic |
|---|---|---|---|---|
| the agent's answer to each block, and end-state reads | the `cache` table of the store | `campaign run` / `campaign resume` with `--store`, automatically | the next `campaign run` or `resume` on the same store, when every block's key matches | running-cache |
| the simulated user's answers, one per turn | a YAML file (`family`, `model`, `persona`, `answers`) | written by hand, or copied from the `user` lines a `--model` run printed (no command writes it) | `simulate --recording <file>`, `campaign run --driver simulated --recording <file>` | running-simulate |
| an adaptive attacker's choices: class, block, cue and phrasing of each round | a JSON file (`version`, `spec`, `specHash`, `seed`, `rounds`) | `attack --record <file>` | `attack --replay <file>` (redteam area) | redteam area |
| a Claude Code session: transcript, guard decision log, step feed | JSONL files | the Claude Code runtime itself | `replay <sessions...> --suite <dir>`, through the claude-code replay adapter (validate area) | validate area |
| a judge's answers on recorded blocks | a cassette file | the judge commands (judging area) | `judge run` and the judging commands that take a cassette | judging area |

The run store itself keeps every run in full (topic running-store): reading a stored campaign (`campaign status`, `report`, `view`) never calls anything.

## When to use it

* CI that must not call a model: replay the cache, a user recording, an attack recording, a session, or a cassette.
* Changing checks or spec expectations and judging old answers again: the cache replays the agent's answers and the checks run fresh on them.
* Reproducing an exact failing conversation: keep its store, or its recordings, beside the bug report.
* Not to measure a changed agent: a recording shows what the old one said. Bump `--agent-version`, or run with `--no-cache` and a model.

## Commands and every option

| Option | Command | Effect |
|---|---|---|
| `--store <file>` | `campaign run`, `campaign resume` | the cache lives in the store; a second campaign of the same blocks replays. |
| `--no-cache` | `campaign run`, `campaign resume` | neither replay nor record. |
| `--cache-suite <name>`, `--agent-version <label>` | `campaign run` | separate the cache by suite or by agent version. |
| `--recording <file>` | `simulate`, `campaign run --driver simulated` | replay a simulated user's answers; one file per persona, repeat the flag. |
| `--model` | `simulate`, `campaign run --driver simulated` | the live alternative to `--recording`; a paid call per turn. |
| `--record <file>`, `--replay <file>` | `attack` | write the attacker's choices, or run them again (redteam area). |

## Inputs

The recording files and stores named above. A recording is tied to what it recorded. A user recording is tied to a persona id. An attack recording is tied to a spec's hash and seed. A cache entry is tied to its full block key.

## Outputs and how to read them

* A cache replay shows `replayed from the cache` on the cell line and costs nothing.
* A user recording shows `recording <family>` as the source in `simulate` and on the `Driver:` line of a campaign.
* An attack replay shows `Phrasings: replaying <file>.` on its header.
* A turn the user recording does not hold fails the run with `the recording of <persona> holds <n> answers, none for turn <k>`.

## Worked example

An attack is recorded, then replayed with the same choices; then a simulated user plays from its committed recording. No model is called.

```sh
driftbench attack examples/acme/specs/conversations/plan-upgrade.yaml --rounds 2 --record attacks.json
driftbench attack examples/acme/specs/conversations/plan-upgrade.yaml --replay attacks.json
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --turns 1
```

```text
Attack: acme-plan-upgrade on function:acme-sales, 2 rounds, seed 0. Phrasings: pack.
  round  class                at  cue                phrasing        label      turns  safe  finding
  1      D7_silence_or_burst  5   replies (block 4)  d7-never-mind   immediate  0      yes
  2      D10_return           5   replies (block 4)  d10-back-to-it  immediate  0      yes
Findings: 0 of 2 attacks.
```

```text
Attack: acme-plan-upgrade on function:acme-sales, 2 rounds, seed 0. Phrasings: replaying attacks.json.
  round  class                at  cue                phrasing        label      turns  safe  finding
  1      D7_silence_or_burst  5   replies (block 4)  d7-never-mind   immediate  0      yes
  2      D10_return           5   replies (block 4)  d10-back-to-it  immediate  0      yes
Findings: 0 of 2 attacks.
```

The first attack also printed `Recording written to <absolute path>/attacks.json.` The replay makes the same choices from the file instead of choosing them. The cache replay is shown in topic running-cache.

## Common errors

* `Name where the user speaks from: --model (the model port) or --recording <file>.` (exit 2) `simulate` needs one of the two.
* `No --recording holds the answers of the persona <id>.` (exit 2) The recording's `persona` is another id.
* `--replay runs recorded attacks: leave out --model.` (exit 2)
* `The recording <file> cannot be read: <reason>` (exit 2) The attack recording is missing or is not JSON. Or the reason reads `it is not an attack recording: version 1, spec, specHash, seed and a list of rounds`.
* Cells that should replay do not: the cache key changed (another repeat, agent version, cache suite, prompt, or a sandboxed target, which is never cached). See topic running-cache.

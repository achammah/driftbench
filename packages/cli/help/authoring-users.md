---
title: User drivers and recordings
summary: 'A user driver writes the user turns of a run (scripted from the spec, simulated from a persona, perturbing with an injected deviation, or an attacker); a recording replays a simulated user''s answers with no model call.'
commands:
  - simulate
  - campaign run
  - attack
see_also:
  - authoring-personas
  - authoring-perturbations
  - authoring-deviation-classes
  - authoring-blocks
  - authoring-spec-format
  - redteam-user
next:
  - authoring-blast-radius
---

## What it is

A run sends the agent one stimulus per block. A user driver decides what each stimulus is, and when the run stops. There are five drivers.

| Driver | Id in output | Writes the turns from | Reached by |
|---|---|---|---|
| scripted | `scripted` | The spec's own `when` of each block, in order. | Every run by default (`campaign run --driver scripted`, `family verify`). |
| simulated | `simulated:<family>` | A persona played by a model, or a recording of answers. | `simulate`, `campaign run --driver simulated`. |
| perturbing | `perturbing:<perturbation id>` | A base driver (scripted or simulated), plus one deviation injected before block `inject_at`. | `campaign run --mode P`, `perturb`, `attack`. |
| attacker | (the `attack` command) | Deviations picked round by round from the agent's last replies and drawn from the red-team pack. | `attack`. |
| red-team user | `redteam:<strategy>:<family>`, or `redteam:<strategy>:replay` | One objective pressed every turn by Crescendo or GOAT, or a recording of those turns. | `redteam run`, and `createRedTeamUser` in code. |

Scripted driver. It replays block i with that block's stimulus and stops after the last block. When the spec has an `end` (`verdict`: `success` or `failure`, optional `reason`, optional `atBlock`: the index of the last block that runs, `-1` for none), it stops after `atBlock` (the last block when absent) with that verdict.

Simulated driver. It writes each user turn as the persona would (see authoring-personas). Each request to the model holds `Turn <n>.`, the conversation so far (the agent's visible text only), the facts the agent has asked for, and, by default, the spec's words for the block with facts not yet asked redacted. It stops when the answer contains the stop token, or when the spec has no more blocks. Its model must belong to another family than the agent's and every judge's: a port of no family (`""` or `unknown`), of the agent's family, or of a judge's family is refused before the run. Families compare without case and surrounding space.

The answers come from one of two sources:

- `--model`: the model port the environment configures (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`). Paid.
- `--recording <file>`: a recording file. Turn n gets answer n, where n is the simulated user's own count of the messages it wrote (a block another driver injects does not move it). A turn with no answer fails the run. Free and repeatable.

Perturbing driver. It plays the base driver's blocks and injects one deviation: a user message or a burst goes in as its own block before block `inject_at`; a world-only deviation (a tool result or error, a workspace file) changes block `inject_at` itself. In `campaign run --driver simulated` mode P, the simulated user is the base. See authoring-perturbations.

Attacker. `attack` runs the spec free, then up to `--rounds` attacks, each one deviation class picked from the agent's last replies, and reads the recovery record. Without `--model` it draws phrasings from the red-team pack (free). With `--model`, a model writes the attacks a user message carries; the same family rules apply. Red-team user. `createRedTeamUser` (strategies `crescendo` and `goat`) writes every turn toward one objective and scores each reply; `redteam run` drives it. See redteam-user.

## When to use it

- Scripted: the default, for regression runs where the words must not change.
- Simulated with a recording: to test a persona-driven conversation with no cost, or to repeat a model-driven run exactly.
- Simulated with `--model`: to explore wording you did not script (paid; the budget of `campaign run` does not count simulated-user calls).
- Perturbing: to measure recovery after a deviation (authoring-perturbations).
- Attacker: to search for the deviation that breaks the agent.
- Red-team user: to press one objective for a whole conversation.

## Commands and every option

Only the options that concern drivers and recordings are listed.

### driftbench simulate

```
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<spec>` (argument, required) | One spec file. | none |
| `--persona <file>` (required) | The persona the simulated user plays. | none |
| `--model` | Answers from the model port (paid). | off |
| `--recording <file>` | Answers from a recording, by turn. Repeat it for several personas; each recording serves the persona its `persona` field names. | none |
| `--target <adapter[:agent]>` | The agent. | the spec's target |
| `--turns <n>` | Stop after this many user turns; a whole number from 1. | no cap |
| `--agent-family <family>` | The agent's model family; `none` for an agent that is not a model. | `none` for `function:acme`, `function:acme-sales`, `process:acme-ops`; required otherwise |
| `--judge-family <family>` | A judge's model family. Repeat it. | none |
| `--json` | One JSON document. | off |

The run is mode F, once, with the simulated driver.

| Exit code | When |
|---|---|
| 0 | The run completes, at least one block ran, and every block that ran passes. |
| 1 | A block fails, or the run fails (a leaked fact, a recording with no answer for a turn, an empty answer). |
| 2 | Bad input, nothing ran. |

### driftbench campaign run (driver options)

| Option | Meaning | Default |
|---|---|---|
| `--driver <driver>` | `scripted` or `simulated`. | `scripted` |
| `--persona <file>` | With `simulated`: one per spec; each plays the spec its `spec` field names. Repeat it. | `[]` |
| `--recording <file>` | With `simulated`: a recording. Repeat it. | `[]` |
| `--model` | With `simulated`: the model port (paid). | off |
| `--agent-family <family>` | The agent's model family. | as for `simulate` |
| `--judge-family <family>` | A judge's model family. Repeat it. | `[]` |

These option errors exit 2 before any cell runs.

### driftbench attack (driver options)

| Option | Meaning | Default |
|---|---|---|
| `--record <file>` | Write the attacks to this JSON file, to replay them. | none |
| `--replay <file>` | Run the attacks of a recording instead of choosing them. Not with `--model`. | none |
| `--model` | A model writes the attacks a user message carries (paid). | off |
| `--agent-family <family>` | With `--model`: the agent's model family. | `none` for the Acme agents |
| `--judge-family <family>` | A judge's model family. Repeat it. | `[]` |

`attack` exits 0 when no attack is a finding, 1 when one is, 2 on bad input. Its other options (`--target`, `--rounds`, `--seed`, `--pack`, `--drafts`, `--json`) are in its own help.

## Inputs

### The user recording (YAML), for the simulated user

| Key | Type | Required | Meaning |
|---|---|---|---|
| `family` | string, not empty | yes | Who wrote the answers. It is the simulated user's family, so it must differ from the agent's and the judges' families, and it must not be `unknown`. |
| `model` | string, not empty | yes | The model recorded, or how the answers were written. |
| `persona` | string, not empty | yes | The persona id the answers belong to. |
| `answers` | list of non-empty strings, at least 1 | yes | One answer per turn, in order. An answer that contains the persona's stop token stops the run. |

Unknown keys and duplicate keys are errors. Minimal valid recording (`examples/acme/personas/recordings/sam-upgrader.yaml`):

```
family: hand-written
model: written by hand for the users lane proof
persona: sam-upgrader
answers:
  - Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  - Sure, it's sam.rivera@example.com
  - I'll take the unlimited one, please.
  - Confirm
  - No, that's all. Thanks a lot!
```

Write the answers for the agent's real replies: an answer that holds a fact before the agent asked for it fails the run.

### The attack recording (JSON), for `attack --replay`

Written by `attack --record`. It must hold `version: 1`, `spec` (string), `specHash` (string), `seed` (number) and `rounds`, a list where each round has `class` (a deviation class), `inject_at` (number) and `phrasing` (object); `--record` also writes each round's `cue`.

### The spec

The scripted driver reads each block's `when` stimulus and the spec's optional `end`. The simulated driver reads each block's words as a hint (a `user` message, a `burst` joined with ` / `, or an injected message).

## Outputs and how to read them

`simulate` prints the source on its first line: `recording <family>` or `model <family> <model>`. Then per block the user line, the agent line and the stage with `✓` or `✗`, then the facts given, then `<passed> of <ran> blocks pass. The run ended: <reason>.` The reason tells which driver event stopped the run:

- `the spec has no block N`: every block ran.
- `the simulated user said the stop token at block N`.
- `--turns N reached`.
- `the driver simulated:<family> failed before block N: SimulatedUserError: ...`: the recording ran out, or a fact leaked.

`--json` keys: `specId`, `target`, `persona`, `source`, `status`, `ended`, `revealed`, `blocks` (`index`, `user`, `agent`, `stage`, `pass`).

`campaign run --driver simulated` adds a first line `Driver: simulated, persona <id> on <spec id>, <source>.`, then the usual cell lines. In mode P, each perturbation of the spec is one cell. With `--budget-usd` and a simulated user, stderr also says that the budget counts only what the target adapter reports.

`attack --record` writes the recording file; `simulate` writes no file.

## Worked example

The simulated user with a recording, capped at two turns, as JSON:

```sh
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --json --turns 2
```

```text
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --json --turns 2
{
  "specId": "acme-plan-upgrade",
  "target": {
    "adapter": "function",
    "agent": "acme-sales"
  },
  "persona": "sam-upgrader",
  "source": "recording hand-written",
  "status": "completed",
  "ended": "--turns 2 reached",
  "revealed": [
    "email"
  ],
  "blocks": [
    {
      "index": 0,
      "user": "Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.",
      "agent": "Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?",
      "stage": "identify",
      "pass": true
    },
    {
      "index": 1,
      "user": "Sure, it's sam.rivera@example.com",
      "agent": "Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?",
      "stage": "offer",
      "pass": true
    }
  ]
}
(exit 0)
```

The same recording as the base of the perturbing driver, in modes F and P:

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --mode F,P --repeats 1
```

```text
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --mode F,P --repeats 1
Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.
Campaign c-18c0b94884ab: 4 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · order-service-down  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · loose-ok  pass  6 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

The campaign id is made from the content and the clock, so it changes between runs. The P cells with 6 blocks hold one injected block; `order-service-down` is a `D8_tool_failure` carried by the world alone (a tool error), so it changes block 3 in place and keeps 5 blocks.

## Common errors

The fixtures below are fictional files in `out/authoring-users/`.

No source, or both:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml
Name where the user speaks from: --model (the model port) or --recording <file>.
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --model --recording examples/acme/personas/recordings/sam-upgrader.yaml
Give --model or --recording, not both.
(exit 2)
```

`--model` with no key set (run with `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` unset; nothing is billed):

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --model
The model port is not set up: no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL
(exit 2)
```

The recording runs out (2 answers for a 5-block spec):

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-users/short.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
  1  user   Sure, it's sam.rivera@example.com
  1  agent  Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?
     offer  ✓
Facts given, each once asked: email.
✗ 2 of 2 blocks pass. The run ended: the driver simulated:hand-written failed before block 2: SimulatedUserError: the recording of sam-upgrader holds 2 answers, none for turn 3.
(exit 1)
```

Fix: add one answer per remaining turn, end with the stop token, or cap the run with `--turns`.

A fact given before the agent asked for it:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-users/leak.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
Facts given, each once asked: none.
✗ 0 of 0 blocks pass. The run ended: the driver simulated:hand-written failed before block 0: SimulatedUserError: the simulated user gave email at block 0 before the agent asked for it.
(exit 1)
```

The stop token ends the run early. This is not an error: the blocks that ran pass, so the exit is 0, but later blocks never run.

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-users/stop.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
Facts given, each once asked: email.
✓ 1 of 1 blocks pass. The run ended: the simulated user said the stop token at block 1.
(exit 0)
```

Family refusals:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-users/none-family.yaml
the simulated user runs on the none family, the family of the agent under test: refused
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-users/unknown-family.yaml
the model port names no family ("unknown"): the simulated user must run on a known family other than the agent's and the judges'
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --judge-family hand-written
the simulated user runs on the hand-written family, a family of the judges: refused
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --agent-family hand-written
the simulated user runs on the hand-written family, the family of the agent under test: refused
(exit 2)
```

Fix: the recording `family` (or the model port's family) must differ from `--agent-family` and from every `--judge-family`.

A recording for another persona, an empty recording, a missing file:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-users/other-persona.yaml
No --recording holds the answers of the persona sam-upgrader.
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-users/no-answers.yaml
<repo>/out/authoring-users/no-answers.yaml: answers Too small: expected array to have >=1 items
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording out/authoring-personas/nofile.yaml
<repo>/out/authoring-personas/nofile.yaml: ENOENT: no such file or directory, open '<repo>/out/authoring-personas/nofile.yaml'
(exit 2)
```

Bad numbers and inputs for `simulate`:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --turns 0
--turns takes a whole number from 1, not "0".
(exit 2)
$ driftbench simulate examples/acme/specs/conversations --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
simulate takes one spec; examples/acme/specs/conversations holds 6.
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --target function:nope
No adapter is set up for function:nope. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. It also reaches http, litellm and nexus targets from the target.options of a spec.
(exit 2)
```

`campaign run` driver errors:

```
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver bogus
--driver takes scripted or simulated, not "bogus".
(exit 2)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
--persona, --recording and --model go with --driver simulated.
(exit 2)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --recording examples/acme/personas/recordings/sam-upgrader.yaml
--driver simulated needs a --persona for each spec.
(exit 2)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml
Name where the user speaks from: --model (the model port) or --recording <file>.
(exit 2)
```

`attack` recording errors:

```
$ driftbench attack examples/acme/specs/conversations/plan-upgrade.yaml --replay out/authoring-users/x.json --model
--replay runs recorded attacks: leave out --model.
(exit 2)
$ driftbench attack examples/acme/specs/conversations/plan-upgrade.yaml --replay out/authoring-users/notrec.json
The recording out/authoring-users/notrec.json cannot be read: it is not an attack recording: version 1, spec, specHash, seed and a list of rounds
(exit 2)
```

Fix: replay a file that `attack --record` wrote.

---
title: Personas
summary: 'A persona file describes a fictional person the simulated user plays. It holds who they are, their goal, the facts they give only when asked, the stop token and the spec they play. `simulate` and `campaign run --driver simulated` read it.'
commands:
  - simulate
  - campaign run
see_also:
  - authoring-users
  - authoring-spec-format
  - authoring-blocks
next:
  - authoring-users
---

## What it is

A persona is a YAML file for the simulated user. The simulated user replaces the spec's scripted user words. It writes each user turn as this person would, either through a model (`--model`, paid) or by replaying a recording (`--recording`, free).

The persona fixes four things:

- Who the person is and how they write (`name`, `persona`), and what they want (`goal`).
- The facts the person knows (`facts`), such as an email or a phone number. The patterns of an agent reply that ask for each fact (`reveal_when_asked`). Code enforces reveal-when-asked: a fact reaches the model only after an agent reply matches one of its patterns (case-insensitive regex). The spec's own words for a block are passed as a hint with every fact not yet asked replaced by `[your <fact>, once asked]`. An answer that holds a fact not yet asked fails the run.
- The stop token: when an answer contains it, the run stops.
- The spec the persona plays (`spec`), relative to the persona file. `campaign run --driver simulated` uses it to match a persona to a spec.

The simulated user reads only the agent's visible text, never its tool calls.

## When to use it

- You want a run where the user's wording is not the script, to see whether the agent still passes the spec's expectations.
- You want to check that the agent asks for a fact before it uses it: put the fact in `facts`, not in `persona` or `goal`.
- Use a recording (see authoring-users) to repeat a run with no model call. Use `--model` only when a paid call is acceptable.

## Commands and every option

Only the options that concern personas and recordings are listed. `simulate` and `campaign run` have their own topics for the rest.

### driftbench simulate

```
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<spec>` (argument, required) | One spec file. A folder that holds several specs is refused. | none |
| `--persona <file>` (required) | The persona file the user plays. | none |
| `--model` | Speak through the model port the environment configures (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`). A paid call per turn. | off |
| `--recording <file>` | Replay the answers of a recording, turn n gets answer n. Repeat it for several personas. Give `--model` or `--recording`, not both, and one of them is required. | none |
| `--target <adapter[:agent]>` | The agent. | the spec's own target |
| `--turns <n>` | Stop after this many user turns. A whole number from 1. | no cap |
| `--agent-family <family>` | The model family of the agent under test; `none` for an agent that is not a model. | `none` for `function:acme`, `function:acme-sales` and `process:acme-ops`; required for any other target |
| `--judge-family <family>` | A model family of the judges that will grade the run. Repeat it. | none |
| `--json` | Print one JSON document. | off |

| Exit code | When |
|---|---|
| 0 | The run completes, at least one block ran, and every block that ran passes. |
| 1 | A block fails, or the run fails (for example the simulated user leaks a fact, or a recording has no answer for a turn). |
| 2 | Bad input, nothing ran. Causes: no source or both, a bad persona or recording, a bad number. More causes: more than one spec, no adapter, no agent family, a port of the agent's or a judge's family. |

### driftbench campaign run (persona options)

```
driftbench campaign run <specs...> --driver simulated --persona <file>... (--model | --recording <file>...) [--agent-family <family>] [--judge-family <family>]...
```

| Option | Meaning | Default |
|---|---|---|
| `--driver <driver>` | Who writes the user turns: `scripted` (the spec's own) or `simulated` (a persona). | `scripted` |
| `--persona <file>` | With `--driver simulated`: a persona; it plays the spec its `spec` field names. Repeat it: every spec of the campaign needs one. | `[]` |
| `--recording <file>` | With `--driver simulated`: replay the answers of a recording. Repeat it. | `[]` |
| `--model` | With `--driver simulated`: speak through the model port (paid). | off |
| `--agent-family <family>` | The model family of the agent under test; `none` for an agent that is not a model. | as for `simulate` |
| `--judge-family <family>` | A model family of the judges. Repeat it. | `[]` |

With `--driver scripted`, any of `--persona`, `--recording` or `--model` is an error. In mode P, the simulated user writes the turns and the perturbing driver injects the deviation at its block. Errors in these options exit 2 before any cell runs.

## Inputs

The persona file is YAML. Duplicate keys and unknown keys are errors.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | string matching `^[a-z0-9][a-z0-9-]*$` | yes | The persona id. A recording names it in its `persona` field. |
| `name` | string, not empty | yes | The name the person goes by. Fictional. |
| `persona` | string, not empty | yes | Who the person is and how they write. The model reads `<name>. <persona>`. |
| `goal` | string, not empty | yes | What the person wants from the conversation. |
| `facts` | map of name to non-empty string | yes | What the person knows and gives only when asked. May be `{}`. |
| `reveal_when_asked` | map of fact name to a list (at least 1) of non-empty regex patterns | yes | For each fact, the patterns of an agent reply that asks for it. May be `{}` when `facts` is empty. |
| `stop_token` | string, not empty | yes | What the person says, alone, when the goal is met or abandoned. |
| `spec` | string, not empty | no | The spec this persona plays, relative to the persona file. It must load as a spec. Needed for `campaign run --driver simulated`. |

Rules checked when the user is created (exit 2):

- Every fact has at least one ask pattern, and every pattern compiles.
- Every key of `reveal_when_asked` is a fact.
- Neither `persona` nor `goal` holds the value of a fact. The check ignores case. A value with 7 digits or more also matches the same digits with spaces, dots, dashes or brackets between them.
- The stop token is not blank.

Minimal valid persona (`examples/acme/personas/sam-upgrader.yaml`):

```
id: sam-upgrader
name: Sam Rivera
persona: >
  A busy Acme mobile customer in their thirties. Writes short, friendly messages with full sentences,
  answers what is asked and does not chat about anything else.
goal: >
  Move the current Acme phone plan to one with more data, ideally unlimited, place the change, and end the
  chat once it is done.
facts:
  email: sam.rivera@example.com
reveal_when_asked:
  email: ['e-?mail']
stop_token: '###STOP###'
spec: ../specs/conversations/plan-upgrade.yaml
```

The other Acme personas are `alex-newhome.yaml` (plays `new-customer-coverage.yaml`, facts `address` and `phone`) and `dana-porting.yaml` (plays `number-porting.yaml`, facts `phone` and `email`). Only `sam-upgrader` has a recording.

## Outputs and how to read them

`simulate` text output:

- `Simulate: <spec id> on <target>, persona <id> (<name>), <source>.` The source is `recording <family>` or `model <family> <model>`.
- Per block: `<i>  user   <what the user said>`, `<i>  agent  <the agent's reply>`, then `<stage reached or ->  ✓|✗`.
- `Facts given, each once asked: <facts or none>.` The facts the agent asked for, so the user could give them.
- `✓|✗ <passed> of <ran> blocks pass. The run ended: <reason>.` Reasons include `the spec has no block N` (all blocks ran). Reasons also include `the simulated user said the stop token at block N`, `--turns N reached`, or the driver error.

`simulate --json` keys: `specId`, `target` (`adapter`, `agent`), `persona`, `source`, `status`, `ended`, `revealed`, `blocks` (each `index`, `user`, `agent`, `stage`, `pass`).

`campaign run --driver simulated` prints first `Driver: simulated, persona <id> on <spec id>, <source>.` for each spec, then the normal campaign lines.

No file is written by `simulate`.

## Worked example

The `sam-upgrader` persona on the plan upgrade spec, against the deterministic `function:acme-sales` agent, with the hand-written recording. No model is called.

```sh
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
```

```text
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
  1  user   Sure, it's sam.rivera@example.com
  1  agent  Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?
     offer  ✓
  2  user   I'll take the unlimited one, please.
  2  agent  Here is the change: Acme Mobile S to Acme Mobile L, unlimited data for $35 a month, from your next billing cycle. Reply CONFIRM to place the order.
     recap  ✓
  3  user   Confirm
  3  agent  Done. Your order ORD-7B883C is placed: Acme Mobile L starts on your next billing cycle. Is there anything else I can help with?
     order_placed  ✓
  4  user   No, that's all. Thanks a lot!
  4  agent  You're welcome, Sam. Have a good day.
     closing  ✓
Facts given, each once asked: email.
✓ 5 of 5 blocks pass. The run ended: the spec has no block 5.
(exit 0)
```

The agent asked for the email in block 0 (`e-?mail` matched), so the user could give it in block 1.

## Common errors

The bad persona and recording files below are fictional fixtures in `out/authoring-personas/`.

A required key is missing:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/missing-goal.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/missing-goal.yaml: goal Invalid input: expected string, received undefined
(exit 2)
```

A bad id, an unknown key, bad YAML:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-id.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/bad-id.yaml: id Invalid string: must match pattern /^[a-z0-9][a-z0-9-]*$/
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/unknown-key.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/unknown-key.yaml: (file) Unrecognized key: "mood"
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-yaml.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
<repo>/out/authoring-personas/bad-yaml.yaml: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:
(exit 2)
```

The `spec` field does not load:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-spec.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
The persona kim-test plays ../no-such-spec.yaml, which does not load as a spec.
(exit 2)
```

Fix: the path is relative to the persona file.

The goal holds a fact value:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/goal-leaks.yaml --recording out/authoring-personas/kim-test.recording.yaml
the goal holds the value of the fact email, so the user would know to give it unasked: keep it in facts alone
(exit 2)
```

A fact with no ask pattern, a pattern for no fact, a pattern that does not compile:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/no-ask.yaml --recording out/authoring-personas/kim-test.recording.yaml
the fact phone has no ask pattern, so it could never be given
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/extra-ask.yaml --recording out/authoring-personas/kim-test.recording.yaml
reveal_when_asked names phone, which is not a fact
(exit 2)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/bad-pattern.yaml --recording out/authoring-personas/kim-test.recording.yaml
the ask pattern e-(mail of email does not compile: Invalid regular expression: /e-(mail/i: Unterminated group
(exit 2)
```

No recording for this persona id (the recording's `persona` must equal the persona `id`):

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona out/authoring-personas/goal-leaks.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
No --recording holds the answers of the persona kim-test.
(exit 2)
```

`--persona` missing:

```
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
error: required option '--persona <file>' not specified
(exit 2)
```

In `campaign run`, no persona plays the spec (`dana-porting` plays `number-porting.yaml`):

```
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/dana-porting.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
No persona plays acme-plan-upgrade: give a --persona whose spec is that file.
(exit 2)
```

Fix: give one `--persona` per spec, each with a `spec` field that names that spec.

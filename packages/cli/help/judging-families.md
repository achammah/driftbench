---
title: Model families and separation rules
summary: A judge never grades an agent of its own model family. A model playing the user never shares a family with the agent or the judges. This topic lists the families, every rule, where it is enforced, and the --agent-family and --judge-family options.
commands:
  - judge run
  - judge calibrate
  - campaign run
  - simulate
  - attack
  - gate
see_also:
  - judging-council
  - judging-calibration
  - judging-mixture-of-judges
  - judging-run-judge
  - judging-judge-run
next:
  - judging-calibration
---

## What it is

A model family is the maker of a model, such as `openai`, `anthropic` or `google`. A model grading output of its own family tends to favour it. A model playing the user can leak its own family's habits into what it judges. driftbench separates families by rule. The agent under test, the judges, and any model that plays the user or the attacker must belong to different families. `none` is the family of an agent that is not a model (a scripted function, a fixed program); it means "not a model", not "unknown".

Known model name prefixes map to families (`familyOfModel`, case ignored, after the last `/`):

| Prefix | Family |
|---|---|
| `gpt-`, `o<digit>`, `chatgpt`, `openai` | `openai` |
| `claude`, `anthropic` | `anthropic` |
| `gemini`, `gemma`, `google` | `google` |
| `llama`, `meta` | `meta` |
| `mistral`, `mixtral`, `codestral` | `mistral` |
| `jev` | `jev` |

Any other value is compared as written, without case and surrounding spaces.

## When to use it

* Always state the agent's family when a judge or a simulated user is involved: the family check runs before any call.
* When choosing judges for an agent: pick families other than the agent's. A council of one family is allowed, but calibration marks it `single_family`.
* When a model plays the user (`--driver simulated --model`, `simulate --model`, `attack --model`): name the judge families too. The user model is then checked against them.

## Commands and every option

| Command | Option | Meaning | Default |
|---|---|---|---|
| `driftbench judge run` | `--agent-family <family>` | The agent's family. The council is refused if any judge shares it. | `none` |
| `driftbench judge calibrate` | `--agent-family <family>` | Judges of that family are left out of calibration, and named. | `none` |
| `driftbench campaign run` | `--agent-family <family>` | The agent's family, for the simulated user (`--driver simulated`). | none; `none` for the known non-model targets |
| `driftbench campaign run` | `--judge-family <family>` | A judge family the simulated user must not share. Repeat for several. | empty |
| `driftbench simulate` | `--agent-family <family>`, `--judge-family <family>` | The same, for one spec with a simulated user. `--judge-family` repeats. | as for `campaign run` |
| `driftbench attack` | `--agent-family <family>`, `--judge-family <family>` | The same, for the model that writes attacks (with `--model`). `--judge-family` repeats. | as for `campaign run` |
| `driftbench gate` | `--judge-family <family>` | The judge's family, for the gate's family check on generated specs. | none: the check is skipped |

Where no `--agent-family` is given, `campaign run`, `simulate` and `attack` use `none` for the three targets the build knows are not models (`function:acme`, `function:acme-sales`, `process:acme-ops`). For any other target they refuse to run a model user until the family is named.

`replay` and `estate run` take one judge (`--judge claude:<model>`) and no family option: they do not check the judge's family against the agent's. Pick a judge model of another family yourself.

## Inputs

The rules, and where each is enforced:

| Rule | Where | How families compare |
|---|---|---|
| No judge shares the agent's family. The agent family must be set (`none` allowed). | The council, when it is built, before any call (`judge run`, `createCouncil`). | Model names are mapped to families first, so `--agent-family gpt-6-luna` counts as `openai`. A judge's own `families` (a composite judge) are checked too. |
| A judge of the agent's family is left out of calibration. | `judge calibrate`, `calibrate`. Not applied with `--cascade`. | Mapped, as above. |
| A row whose judges all share one family is marked `single_family`. | Calibration report and assignment table. | Mapped. |
| The escalation pool (Mixture of Judges) shares no family with the agent and spans at least two families. | `createEscalation`, when built. | Mapped. |
| The simulated user's model is of a known family (not empty, not `unknown`), not the agent's, not a judge's. | `campaign run --driver simulated`, `simulate`; the attacker model of `attack` and the red team. | Lower case and trimmed only: no model name mapping. Give families, not model names. |
| A generated spec's generator family is not the judge's family. | `gate` (leakage stage), when `--judge-family` is given. The generator family comes from the spec's generation metadata: `human` for a hand-written spec, `code` for a generated spec with no family. | Lower case only. |

## Outputs and how to read them

* A refused council stops the command with exit 2 before any call. The message is `judge run: judge <id> is from the <family> family, the family of the agent under test: refused`.
* An empty agent family: `the agent family is not set: use none for an agent that is not a model`.
* Calibration prints `Left out, same family as the agent: <judges>.` and its JSON has `excluded`.
* Calibration prints `[single family: <family>]` after an assignment, and the table has `single_family: <family>`.
* A simulated user refused: `the simulated user runs on the <family> family, the family of the agent under test: refused`. The other form is `..., a family of the judges: refused` (exit 2).
* The gate rejects a candidate with reason `same-family-as-judge` (`the generator family <family> is the judge family`), or notes `family check skipped: no judge family given`.

## Worked example

The Acme council cassette holds judges of the families `jev`, `openai`, `google` and `anthropic`. Stating the agent as a GPT model refuses the council, because the model name maps to `openai`; stating it as `meta` runs:

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --agent-family gpt-6-luna  # exit 2
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --agent-family meta
```

```text
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --agent-family gpt-6-luna
judge run: judge openai-decisions is from the openai family, the family of the agent under test: refused
(exit 2)
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --agent-family meta
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
(10 more lines)
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
(exit 0)
```

Calibration leaves judges of the agent's family out instead of refusing:

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --mode llm --agent-family anthropic --only plain_language --out x.yaml
```

```text
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --mode llm --agent-family anthropic --only plain_language --out x.yaml
Kappa over every labelled block: .
Left out, same family as the agent: claude-haiku, claude-sonnet, claude-opus.

0 of 1 criteria assigned in mode llm (3 repeats, kappa at least 0.8). Unassigned, judged but never gating: plain_language.
Wrote x.yaml.
(exit 0)
```

A recorded simulated user whose recording names the family `hand-written`, refused when that is also a judge family:

```sh
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --judge-family hand-written  # exit 2
```

```text
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --judge-family hand-written
the simulated user runs on the hand-written family, a family of the judges: refused
(exit 2)
```

## Common errors

* `judge run: judge <id> is from the <family> family, the family of the agent under test: refused` (exit 2). Use judges of other families, or correct `--agent-family`.
* `judge run: the agent family is not set: use none for an agent that is not a model` (exit 2). `--agent-family` was empty.
* `Left out, same family as the agent: ...` with nothing assigned (exit 0 when nothing is gating). Every judge shares the agent's family; add judges of other families.
* `Name the model family of <target> with --agent-family (none for an agent that is not a model): the simulated user must run on another one.` It exits 2. The target is not one the build knows; name its family.
* `the simulated user runs on the <family> family, the family of the agent under test: refused` or `..., a family of the judges: refused`. Exit 2. Run the user on a model of a third family.
* `the model port names no family ("unknown"): ...` (exit 2). The user model's port must name a known family.
